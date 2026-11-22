import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  arrivedEntry,
  askFor,
  autoAnswer,
  awardOptions,
  canRelay,
  chain,
  chosenWord,
  close,
  entryAt,
  initialState,
  knownMissed,
  knownNames,
  leaveGame,
  loadState,
  matchOver,
  matchStandings,
  missingSteps,
  myStep,
  nameOfSeat,
  nextRound,
  outgoingFor,
  phaseOf,
  promptFor,
  receive,
  resendBytes,
  resendEntry,
  resendStart,
  revealGame,
  saveState,
  scores,
  seatOfStep,
  sendEntry,
  sendResults,
  setProfile,
  setWordDraft,
  startGame,
  STORAGE_KEY,
  withPlayerId,
  type KeyValueStore,
  type Outgoing,
  type Results,
  type State,
} from '../src/game/telephone';
import { suggestWord } from '../src/game/words';
import { emptyGrid, type Grid } from '../src/protocol/drawing';
import { decodePacket, encodePacket, type NoiseLevel, type Packet } from '../src/protocol/packet';
import { SendGate } from '../src/state/sender';
import { gridArb16 as gridArb, packetArb } from './arbitraries';

const hear = (b: Uint8Array): Packet => {
  const r = decodePacket(b);
  if (!r.ok) throw new Error(r.error);
  return r.packet;
};

const sketch = (seed: number): Grid => {
  const g = emptyGrid(16);
  g[seed % 8][(seed * 3) % 8] = g[(seed + 4) % 8][(seed + 1) % 8] = true;
  return g;
};

function memoryStore(): KeyValueStore {
  const data = new Map<string, string>();
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

const NAMES = ['Asha', 'Bo', 'Cy', 'Dee', 'Eli', 'Fay', 'Gus', 'Hal'];

/**
 * A room of N devices (device i sits in seat i + 1). Every chirp reaches
 * every device except the sender and anyone listed as deaf.
 */
function room(n: number, extras: { name: string; seat: number }[] = []) {
  const devices: State[] = [
    ...NAMES.slice(0, n).map((name, i) => (i === 0 ? setProfile(initialState(), { name }) : setProfile(initialState(), { name, mode: 'player', seat: i + 1 }))),
    ...extras.map((x) => setProfile(initialState(), { name: x.name, mode: 'player', seat: x.seat })),
  ];
  const log: string[] = [];
  const r = {
    devices,
    log,
    play(from: number, out: Outgoing | null, deaf: number[] = []) {
      if (!out) throw new Error(`device ${from + 1} could not send`);
      devices[from] = out.state;
      r.broadcast(out.bytes, from, deaf);
      return out;
    },
    broadcast(bytes: Uint8Array, from: number, deaf: number[] = []) {
      devices.forEach((d, i) => {
        if (i === from || deaf.includes(i)) return;
        const res = receive(d, hear(bytes), 1000 + i);
        devices[i] = res.state;
        log.push(`${i + 1}:${res.event.type}`);
      });
    },
    start(opts: { gameId?: number; noise?: NoiseLevel; mode?: 'quick' | 'match'; deaf?: number[] } = {}) {
      return r.play(0, startGame(devices[0], { players: n, gameId: opts.gameId ?? 0x4242, now: 0, noise: opts.noise ?? 0, mode: opts.mode }), opts.deaf);
    },
    /** Device index that plays step k this round. */
    author(k: number) {
      return seatOfStep(devices[0].game!, k) - 1;
    },
    turn(k: number, deaf: number[] = []) {
      const i = r.author(k);
      let d = devices[i];
      if (k === 1) d = setWordDraft(d, { custom: 'pumpkin' });
      const content = k % 2 === 1 ? { drawing: sketch(k) } : { text: k === 2 ? 'pumpkin' : `guess ${k}` };
      return r.play(i, sendEntry(d, content), deaf);
    },
    playAll(deafBy: Record<number, number[]> = {}) {
      for (let k = 1; k <= n; k++) r.turn(k, deafBy[k] ?? []);
    },
    reveal(force = false, deaf: number[] = []) {
      return r.play(0, revealGame(devices[0], 9000, force), deaf);
    },
    results(res: Partial<Results> = {}, deaf: number[] = []) {
      return r.play(0, sendResults(devices[0], { funniest: 0, recognizable: 0, recovery: 0, final: 0, ...res }), deaf);
    },
  };
  return r;
}

describe('joining (lobby and seats)', () => {
  it('ready players join with their seat; the host is seat 1', () => {
    const r = room(4);
    r.start();
    expect(r.devices.map((d) => d.game?.seat)).toEqual([1, 2, 3, 4]);
    expect(r.devices.map((d) => phaseOf(d))).toEqual(['my-turn', 'waiting', 'waiting', 'waiting']);
  });

  it('not ready, or a seat above N: not joined, and not remembered, so a resend can still work', () => {
    const r = room(3, [{ name: 'Zed', seat: 5 }]);
    r.devices.push(setProfile(initialState(), { name: 'Late' }));
    const out = r.start();
    expect(r.log).toContain('4:seat-too-high');
    expect(r.log).toContain('5:not-ready');
    expect(r.devices[3].game).toBeNull();
    r.devices[4] = setProfile(r.devices[4], { mode: 'player', seat: 3 });
    r.devices[4] = receive(r.devices[4], hear(out.bytes), 5).state;
    expect(r.devices[4].game?.seat).toBe(3);
    // the host can resend the start signal byte-identically at any time in the round
    expect(Array.from(resendStart(r.devices[0])!.bytes)).toEqual(Array.from(out.bytes));
  });

  it('a player in an unfinished round ignores other games', () => {
    const r = room(3);
    r.start();
    const other = startGame(setProfile(initialState(), { name: 'Nemo' }), { players: 3, gameId: 0x1111, now: 0 })!;
    const before = r.devices[1];
    const res = receive(before, hear(other.bytes), 1);
    expect(res.event.type).toBe('other-game');
    expect(res.state).toBe(before);
  });
});

describe('a Quick Round', () => {
  it('each player sees only the previous entry; the first drawer chooses the word privately', () => {
    const r = room(4);
    r.start();
    const host = r.devices[0].game!;
    expect(promptFor(host)).toEqual({ kind: 'word', text: suggestWord(0, host.gameId, 0) });
    r.devices[0] = setWordDraft(r.devices[0], { variant: 3 });
    expect(chosenWord(r.devices[0].game!)).toBe(suggestWord(0, host.gameId, 3));
    r.turn(1);
    expect(r.devices[0].game!.word).toBe('pumpkin');
    const p2 = promptFor(r.devices[1].game!);
    expect(p2?.kind).toBe('drawing');
    expect(promptFor(r.devices[2].game!)).toBeNull(); // seat 3 sees nothing yet
    r.turn(2);
    const p3 = promptFor(r.devices[2].game!);
    expect(p3).toEqual({ kind: 'text', text: 'pumpkin', from: 'Bo', altered: false });
    r.turn(3);
    r.turn(4);
    expect(phaseOf(r.devices[0])).toBe('ready-to-reveal');
    r.reveal();
    expect(r.devices.every((d) => phaseOf(d) === 'reveal')).toBe(true);
    const chains = r.devices.map((d) => JSON.stringify(chain(d.game!)));
    expect(new Set(chains).size).toBe(1);
  });

  it('a step can only be sent on your turn, with valid content', () => {
    const r = room(3);
    r.start();
    expect(sendEntry(r.devices[1], { text: 'cat' })).toBeNull(); // not my turn yet
    expect(sendEntry(r.devices[0], { drawing: emptyGrid(16) })).toBeNull(); // empty drawing
    expect(sendEntry(setWordDraft(r.devices[0], { custom: 'x'.repeat(13) }), { drawing: sketch(1) })).toBeNull(); // bad word
  });

  it('sending commits only after playback succeeds (safe send gate)', async () => {
    const r = room(3);
    r.start();
    const out = sendEntry(setWordDraft(r.devices[0], { custom: 'cat' }), { drawing: sketch(1) })!;
    const gate = new SendGate();
    let committed: State | null = null;
    const fail = await gate.run(out, () => Promise.reject(new Error('speaker')), (s) => (committed = s));
    expect(fail.ok).toBe(false);
    expect(committed).toBeNull();
    const ok = await gate.run(out, () => Promise.resolve(1), (s) => (committed = s));
    expect(ok.ok).toBe(true);
    expect(committed!.game!.entries['1']).toBeDefined();
  });
});

describe('missed-message recovery (R1)', () => {
  it('tracks known missed hops per device', () => {
    const r = room(4);
    r.start();
    r.turn(1, [2]); // seat 3 misses step 1
    expect(knownMissed(r.devices[2].game!)).toEqual([]);
    r.turn(2);
    expect(knownMissed(r.devices[2].game!)).toEqual([1]);
    expect(phaseOf(r.devices[2])).toBe('my-turn'); // can still play
  });

  it('BUG FIX: the host is not offered a normal reveal while an earlier hop is missing', () => {
    const r = room(4);
    r.start();
    r.playAll({ 2: [0] }); // the host misses step 2
    expect(phaseOf(r.devices[0])).toBe('missing');
    expect(missingSteps(r.devices[0].game!)).toEqual([2]);
    expect(revealGame(r.devices[0], 1)).toBeNull();
    expect(revealGame(r.devices[0], 1, true)).not.toBeNull(); // labelled fallback
  });

  it('a request is answered automatically by exactly one device: the author', () => {
    const r = room(5);
    r.start();
    r.playAll({ 3: [0] });
    const ask = r.play(0, askFor(r.devices[0], 3));
    expect(hear(ask.bytes)).toEqual({ type: 'need', gameId: 0x4242, step: 3 });
    const answering = r.devices.map((d) => autoAnswer(d, 3).length > 0);
    expect(answering).toEqual([false, false, true, false, false]);
    // others who hold it may relay by hand, but never automatically
    expect(r.devices.map((d) => canRelay(d, 3))).toEqual([false, true, false, true, true]);
    // the answer is byte-identical to the original chirp
    const [packet] = autoAnswer(r.devices[2], 3);
    expect(Array.from(encodePacket(packet))).toEqual(Array.from(resendEntry(r.devices[2], 3)!.bytes));
    r.play(2, outgoingFor(r.devices[2], packet));
    expect(phaseOf(r.devices[0])).toBe('ready-to-reveal');
  });

  it('for every room size and missing hop, at most one device answers automatically', () => {
    for (let n = 2; n <= 8; n++) {
      for (let miss = 1; miss <= n; miss++) {
        const r = room(n);
        r.start();
        r.playAll({ [miss]: [0] });
        const answering = r.devices.map((d, i) => (autoAnswer(d, miss).length > 0 ? i : -1)).filter((i) => i >= 0);
        expect(answering).toEqual([r.author(miss)]);
      }
    }
  });

  it('requests are never remembered as seen, so the same hop can be asked for again', () => {
    const r = room(3);
    r.start();
    const need = encodePacket({ type: 'need', gameId: 0x4242, step: 1 });
    const a = receive(r.devices[1], hear(need), 1);
    const b = receive(a.state, hear(need), 2);
    expect(a.event).toEqual({ type: 'need', step: 1 });
    expect(b.event).toEqual({ type: 'need', step: 1 });
    expect(b.state).toBe(r.devices[1]);
  });

  it('BUG FIX: entries that arrive after the reveal fill gaps and never overwrite', () => {
    const r = room(4);
    r.start();
    r.playAll({ 1: [2] }); // seat 3 misses the first drawing
    r.reveal();
    const g3 = r.devices[2].game!;
    expect(phaseOf(r.devices[2])).toBe('reveal');
    expect(missingSteps(g3)).toEqual([1]);
    expect(chain(g3).cards[1].kind).toBe('missing');
    // seat 3 asks; the host (author of step 1) answers
    r.play(2, askFor(r.devices[2], 1));
    const [answer] = autoAnswer(r.devices[0], 1);
    const res = receive(r.devices[2], answer, 5);
    expect(res.event).toMatchObject({ type: 'entry', step: 1, recovered: true });
    expect(chain(res.state.game!).cards[1].kind).toBe('drawing');
    expect(res.state.game!.word).toBe('pumpkin');
    // a different entry for a filled step changes nothing
    const fake: Packet = { type: 'entry', gameId: 0x4242, step: 2, name: 'Imp', text: 'ghost' };
    const again = receive(res.state, fake, 6);
    expect(again.state).toBe(res.state);
    expect(entryAt(again.state.game!, 2)?.text).toBe('pumpkin');
  });

  it('step 0 asks the host for the reveal and the results', () => {
    const r = room(3);
    r.start();
    r.playAll();
    expect(autoAnswer(r.devices[0], 0)).toEqual([]); // not revealed yet
    r.reveal(false, [1]);
    r.results({ funniest: 2 }, [1]);
    expect(phaseOf(r.devices[1])).toBe('sent');
    const reply = autoAnswer(r.devices[0], 0);
    expect(reply.map((p) => p.type)).toEqual(['reveal', 'results']);
    expect(r.devices.slice(1).every((d) => autoAnswer(d, 0).length === 0)).toBe(true);
    let s = r.devices[1];
    for (const p of reply) s = receive(s, p, 7).state;
    expect(phaseOf(s)).toBe('reveal');
    expect(s.game!.results?.funniest).toBe(2);
  });

  it('a results chirp alone also reveals on a device that missed the reveal', () => {
    const r = room(3);
    r.start();
    r.playAll();
    r.reveal(false, [2]);
    r.results({}, []);
    expect(phaseOf(r.devices[2])).toBe('reveal');
  });

  it('duplicates, own echoes, and stale rounds change nothing', () => {
    const r = room(3);
    const start1 = r.start();
    const e1 = r.turn(1);
    const dup = receive(r.devices[1], hear(e1.bytes), 1);
    expect(dup.event.type).toBe('duplicate');
    expect(dup.state).toBe(r.devices[1]);
    expect(receive(r.devices[0], hear(e1.bytes), 1).event.type).toBe('own-echo');
    r.turn(2);
    r.turn(3);
    r.reveal();
    r.play(0, startGame(r.devices[0], { players: 3, gameId: 0x5151, now: 0 }));
    for (const old of [start1.bytes, e1.bytes]) {
      const res = receive(r.devices[2], hear(old), 2);
      expect(res.event.type).toBe('stale');
      expect(res.state).toBe(r.devices[2]);
    }
  });

  it('property: hearing any packet a second time never changes state', () => {
    fc.assert(
      fc.property(packetArb, (p) => {
        const r = room(3);
        r.start({ gameId: p.gameId });
        const once = receive(r.devices[1], p, 1).state;
        const twice = receive(once, p, 2);
        if (p.type !== 'start') expect(twice.state).toBe(once);
      }),
    );
  });

  it('two phones on the same seat are reported, not merged silently', () => {
    const r = room(3, [{ name: 'Zed', seat: 2 }]);
    r.start();
    r.turn(1);
    r.turn(2); // Bo plays seat 2
    expect(r.log).toContain('4:conflict');
    expect(r.devices[3].game!.conflict).toBe('Bo');
  });

  it('two phones on the same seat with the SAME name are reported too (not taken for an echo)', () => {
    const r = room(3, [{ name: 'Bo', seat: 2 }]);
    r.start();
    r.turn(1);
    r.turn(2); // the first Bo plays seat 2
    expect(r.log).toContain('4:conflict');
    expect(r.devices[3].game!.conflict).toBe('Bo');
  });

  it('Resend replays identical bytes and is ignored by everyone who already heard it', () => {
    const r = room(3);
    r.start();
    const out = r.turn(1);
    expect(Array.from(resendBytes(r.devices[0])!)).toEqual(Array.from(out.bytes));
    const before = r.devices.map((d) => d);
    r.broadcast(resendBytes(r.devices[0])!, 0);
    expect(r.devices).toEqual(before);
  });
});

describe('static on screen (R3)', () => {
  it('Clear passes entries exactly; Haunted changes what the next player sees, never the stored entry', () => {
    for (const noise of [0, 2] as const) {
      const r = room(3);
      r.start({ noise });
      r.turn(1);
      const g = r.devices[1].game!;
      const p = promptFor(g)!;
      expect(p.kind).toBe('drawing');
      expect(entryAt(g, 1)!.drawing).toEqual(sketch(1));
      if (noise === 0) expect(p.kind === 'drawing' && p.drawing).toEqual(sketch(1));
      else expect(p.kind === 'drawing' && p.altered).toBe(true);
    }
  });

  it('every device computes the same static', () => {
    const r = room(4);
    r.start({ noise: 2 });
    r.playAll();
    r.reveal();
    const a = arrivedEntry(r.devices[3].game!, entryAt(r.devices[3].game!, 2)!);
    const b = arrivedEntry(r.devices[0].game!, entryAt(r.devices[0].game!, 2)!);
    expect(a).toEqual(b);
  });
});

describe('scoring, awards, and fairness (R7)', () => {
  it('matching guesses score the drawer and guesser; awards are +1; every device agrees', () => {
    const r = room(4);
    r.start();
    r.playAll();
    r.reveal();
    expect(sendResults(r.devices[1], { funniest: 2, recognizable: 0, recovery: 0, final: 0 })).toBeNull(); // only the host
    expect(sendResults(r.devices[0], { funniest: 1, recognizable: 0, recovery: 0, final: 0 })).toBeNull(); // step 1 is not a response
    expect(sendResults(r.devices[0], { funniest: 0, recognizable: 2, recovery: 0, final: 0 })).toBeNull(); // 2 is not a drawing
    expect(sendResults(r.devices[0], { funniest: 0, recognizable: 0, recovery: 0, final: 1 })).toBeNull(); // even N: no room guess
    r.results({ funniest: 4, recognizable: 3 });
    const all = r.devices.map((d) => JSON.stringify(scores(d.game!)));
    expect(new Set(all).size).toBe(1);
    const pts = Object.fromEntries(scores(r.devices[0].game!).map((s) => [s.seat, s.points]));
    expect(pts).toEqual({ 1: 1, 2: 1, 3: 1, 4: 1 });
    expect(sendResults(r.devices[0], { funniest: 2, recognizable: 0, recovery: 0, final: 0 })).toBeNull(); // once per round
  });

  it('odd player count: the room guesses the last drawing, so its drawer can score', () => {
    const r = room(3);
    r.start();
    r.playAll();
    r.reveal();
    expect(awardOptions(r.devices[0].game!).finalGuess).toBe(true);
    r.results({ final: 1 });
    const s3 = scores(r.devices[1].game!).find((s) => s.seat === 3)!;
    expect(s3.points).toBe(1);
    expect(s3.notes).toContain('the room guessed your final drawing');
  });

  it('Best Recovery is only offered for responses to clues that static changed', () => {
    const clean = room(4);
    clean.start({ noise: 0 });
    clean.playAll();
    clean.reveal();
    expect(awardOptions(clean.devices[0].game!).recovery).toEqual([]);
    const haunted = room(4);
    haunted.start({ noise: 2 });
    haunted.playAll();
    haunted.reveal();
    expect(awardOptions(haunted.devices[0].game!).recovery.length).toBeGreaterThan(0);
  });

  it('retries never change scores', () => {
    const r = room(3);
    r.start();
    r.playAll();
    r.reveal();
    const res = r.results({ funniest: 2, final: 1 });
    const before = r.devices.map((d) => JSON.stringify(scores(d.game!)));
    r.broadcast(res.bytes, 0);
    for (let k = 1; k <= 3; k++) r.broadcast(resendEntry(r.devices[r.author(k)], k)!.bytes, r.author(k));
    expect(r.devices.map((d) => JSON.stringify(scores(d.game!)))).toEqual(before);
  });

  it('close() ignores case, spaces, and punctuation, and allows one typo for 5+ letters', () => {
    expect(close('Witch Hat', 'witchhat')).toBe(true);
    expect(close('pumpkn', 'pumpkin')).toBe(true);
    expect(close('cat', 'bat')).toBe(false);
  });
});

describe('Party Match (R7)', () => {
  function playMatch(n: number) {
    const r = room(n);
    r.start({ mode: 'match', gameId: 0x7000 });
    const firstDrawers: number[] = [];
    for (let round = 1; round <= 3; round++) {
      firstDrawers.push(r.author(1) + 1);
      expect(r.devices.every((d) => d.game?.round === round)).toBe(true);
      r.playAll();
      r.reveal();
      r.results({ funniest: 2, final: n % 2 === 1 ? 1 : 0 });
      if (round < 3) r.play(0, nextRound(r.devices[0], 0x7000 + round, round * 1000));
    }
    return { r, firstDrawers };
  }

  it('the first drawer moves one seat each round', () => {
    expect(playMatch(3).firstDrawers).toEqual([1, 2, 3]);
    expect(playMatch(5).firstDrawers).toEqual([1, 2, 3]);
    expect(playMatch(2).firstDrawers).toEqual([1, 2, 1]);
  });

  it('totals are the same on every device, everyone gets the same chances, and the match ends after round 3', () => {
    const { r } = playMatch(3);
    const totals = r.devices.map((d) => JSON.stringify(matchStandings(d)));
    expect(new Set(totals).size).toBe(1);
    const st = matchStandings(r.devices[0]);
    expect(st.rounds).toBe(3);
    // each round: one scoring chance per seat (all succeed here) + Funniest to the step-2 guesser, who rotates
    expect(st.standings.map((s) => s.points)).toEqual([4, 4, 4]);
    expect(r.devices.every((d) => matchOver(d))).toBe(true);
    expect(nextRound(r.devices[0], 1, 1)).toBeNull();
  });

  it('progress survives a refresh', () => {
    const { r } = playMatch(4);
    const store = memoryStore();
    saveState(store, r.devices[2]);
    const back = loadState(store);
    expect(matchStandings(back)).toEqual(matchStandings(r.devices[2]));
    expect(back.match?.rounds.length).toBe(2);
    expect(matchOver(back)).toBe(true);
  });

  it('the next round needs a revealed round with results, and only the host can start it', () => {
    const r = room(3);
    r.start({ mode: 'match' });
    expect(nextRound(r.devices[0], 9, 0)).toBeNull();
    r.playAll();
    r.reveal();
    expect(nextRound(r.devices[0], 9, 0)).toBeNull(); // no results yet: can't skip them by accident
    r.results({});
    expect(nextRound(r.devices[1], 9, 0)).toBeNull();
    expect(nextRound(r.devices[0], 9, 0)).not.toBeNull();
  });

  it('names learned in earlier rounds are remembered for the next round (names only)', () => {
    const r = room(2);
    r.start({ mode: 'match', gameId: 0x7200 });
    r.playAll();
    r.reveal();
    r.results({});
    r.play(0, nextRound(r.devices[0], 0x7201, 5));
    const host = r.devices[0];
    expect(nameOfSeat(host.game!, 2, 'Asha')).toBeNull(); // Bo hasn't played this round yet
    expect(knownNames(host)).toEqual({ '1': 'Asha', '2': 'Bo' });
    expect(JSON.stringify(knownNames(host))).not.toContain('pumpkin');
  });

  it('a player who missed the reveal still joins the next round of the same match', () => {
    const r = room(3);
    r.start({ mode: 'match', gameId: 0x7100 });
    r.playAll();
    r.reveal(false, [2]);
    r.results({}, [2]);
    expect(phaseOf(r.devices[2])).toBe('sent');
    r.play(0, nextRound(r.devices[0], 0x7101, 5));
    expect(r.devices[2].game?.round).toBe(2);
    expect(myStep(r.devices[2].game!)).toBe(2);
  });

  it('leaving a match round keeps the points; ending the match clears them', () => {
    const r = room(3);
    r.start({ mode: 'match' });
    r.playAll();
    r.reveal();
    r.results({ funniest: 2 });
    expect(leaveGame(r.devices[1]).match?.rounds.length).toBe(1);
    expect(leaveGame(r.devices[1], true).match).toBeNull();
  });
});

describe('persistence (per tab)', () => {
  it('round-trips through storage and rejects other versions', () => {
    const r = room(3);
    r.start();
    r.turn(1);
    const store = memoryStore();
    saveState(store, r.devices[1]);
    expect(loadState(store)).toEqual(r.devices[1]);
    store.setItem(STORAGE_KEY, JSON.stringify({ v: 2, profile: {}, seen: [], sent: [] }));
    expect(loadState(store)).toEqual(initialState());
    store.setItem(STORAGE_KEY, '{not json');
    expect(loadState(store)).toEqual(initialState());
  });

  it('after an update from v3, only the name, role, and seat carry over (old rounds used v3 chirps)', () => {
    const store = memoryStore();
    store.setItem('dialup:v3', JSON.stringify({ v: 3, profile: { name: 'Bo', mode: 'player', seat: 3 }, game: { gameId: 1 }, seen: ['x'], sent: [] }));
    const s = loadState(store);
    expect(s.profile).toEqual({ name: 'Bo', mode: 'player', seat: 3, pid: 0 });
    expect(s.game).toBeNull();
    expect(withPlayerId(s, () => 0x1234).profile.pid).toBe(0x1234);
  });

  it('every tab gets a player ID, never 0, and keeps it', () => {
    let n = 0;
    const seq = [0, 0, 42];
    const s = withPlayerId(initialState(), () => seq[n++]);
    expect(s.profile.pid).toBe(42);
    expect(withPlayerId(s, () => 7)).toBe(s);
  });

  it('drawings survive storage exactly', () => {
    fc.assert(
      fc.property(gridArb, (g) => {
        if (!g.some((row) => row.some(Boolean))) return;
        const r = room(2);
        r.start();
        const out = sendEntry(setWordDraft(r.devices[0], { custom: 'cat' }), { drawing: g })!;
        const store = memoryStore();
        saveState(store, out.state);
        expect(loadState(store).game!.entries['1'].drawing).toEqual(g);
      }),
    );
  });
});
