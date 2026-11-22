import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { ACK_SLOT_MS, ackDelay, callWindowMs, HELLO_SLOT_MS, helloDelay, REPLY_GAP_MS } from '../src/game/schedule';
import {
  ackPacket,
  askToJoin,
  autoAnswer,
  awaitingAcks,
  callPacket,
  helloPacket,
  initialState,
  openLobby,
  readyStatus,
  receive,
  resendResults,
  revealGame,
  roster,
  scores,
  seatOfStep,
  sendEntry,
  sendResults,
  setProfile,
  setWordDraft,
  startGame,
  type Outgoing,
  type State,
} from '../src/game/telephone';
import { emptyGrid } from '../src/protocol/drawing';
import { decodePacket, encodePacket, NEED_START, seatsToMask, type Packet } from '../src/protocol/packet';

const hear = (b: Uint8Array): Packet => {
  const r = decodePacket(b);
  if (!r.ok) throw new Error(r.error);
  return r.packet;
};
const NAMES = ['Asha', 'Bo', 'Cy', 'Dee', 'Eli'];
const dot = () => {
  const g = emptyGrid(16);
  g[2][2] = true;
  return g;
};

/** Device i gets player ID 0x100 + i, like each browser tab gets its own random ID. */
function room(n: number, extras: { name: string; seat: number }[] = [], names: string[] = NAMES) {
  const d: State[] = [
    openLobby(setProfile(initialState(0x100), { name: names[0], mode: 'host', seat: 1 }), 0x0ab0),
    ...names.slice(1, n).map((name, i) => setProfile(initialState(0x101 + i), { name, mode: 'player', seat: i + 2 })),
    ...extras.map((x, i) => setProfile(initialState(0x100 + n + i), { name: x.name, mode: 'player', seat: x.seat })),
  ];
  const events: Record<number, string[]> = {};
  const play = (from: number, out: Outgoing | null, deaf: number[] = []) => {
    if (!out) throw new Error(`device ${from + 1} could not send`);
    d[from] = out.state;
    d.forEach((s, i) => {
      if (i === from || deaf.includes(i)) return;
      const res = receive(s, hear(out.bytes), 1);
      d[i] = res.state;
      (events[i] ??= []).push(res.event.type);
    });
    return out;
  };
  return { d, play, events };
}

describe('ready check (R9)', () => {
  it('a player counts as ready only once the host heard its ready message', () => {
    const r = room(4);
    expect(roster(r.d[0], 4)).toMatchObject({ canStart: false, missing: [2, 3, 4] });
    r.play(1, helloPacket(r.d[1]));
    r.play(2, helloPacket(r.d[2]), [0]); // the host didn't hear Cy
    expect(readyStatus(r.d[2])).toMatchObject({ helloSent: true, confirmed: false });
    r.play(3, helloPacket(r.d[3]));
    const ro = roster(r.d[0], 4);
    expect(ro.missing).toEqual([3]);
    expect(ro.canStart).toBe(false);
    expect(ro.seats.map((x) => [x.seat, x.status, x.names.join('+')])).toEqual([
      [1, 'host', 'Asha'],
      [2, 'ready', 'Bo'],
      [3, 'missing', ''],
      [4, 'ready', 'Dee'],
    ]);
  });

  it('the ready check confirms heard seats and asks only the others, one at a time', () => {
    const r = room(4);
    r.play(1, helloPacket(r.d[1]));
    const call = r.play(0, callPacket(r.d[0], 4));
    const p = hear(call.bytes);
    expect(p).toMatchObject({ type: 'call', players: 4, confirmed: seatsToMask([1, 2]), duplicate: 0 });
    expect(readyStatus(r.d[1])).toMatchObject({ confirmed: true, host: 'Asha' });
    // Bo stays quiet; Cy and Dee answer in different slots
    const replies = [1, 2, 3].map((i) => helloDelay(r.d[i].profile.seat!, (p as { confirmed: number }).confirmed, 0));
    expect(replies).toEqual([null, REPLY_GAP_MS, REPLY_GAP_MS + HELLO_SLOT_MS]);
    r.play(2, helloPacket(r.d[2]));
    r.play(3, helloPacket(r.d[3]));
    expect(roster(r.d[0], 4).canStart).toBe(true);
    r.play(0, callPacket(r.d[0], 4));
    expect([1, 2, 3].map((i) => readyStatus(r.d[i]).confirmed)).toEqual([true, true, true]);
  });

  it('duplicate seats are shown, block the start, silence both phones, and clear when one moves', () => {
    const r = room(3, [{ name: 'Zed', seat: 3 }]);
    r.play(1, helloPacket(r.d[1]));
    r.play(2, helloPacket(r.d[2]));
    r.play(3, helloPacket(r.d[3]));
    expect(r.events[0]).toContain('hello');
    expect(readyStatus(r.d[2]).clash).toEqual(['Zed']); // Cy heard Zed claim seat 3
    const ro = roster(r.d[0], 3);
    expect(ro.duplicate).toEqual([3]);
    expect(ro.canStart).toBe(false);
    const call = hear(r.play(0, callPacket(r.d[0], 3)).bytes) as Extract<Packet, { type: 'call' }>;
    expect(helloDelay(3, call.confirmed, call.duplicate)).toBeNull();
    expect(readyStatus(r.d[3]).duplicate).toBe(true);
    // Zed moves to seat 4 and says hello again: the roster follows
    r.d[3] = setProfile(r.d[3], { seat: 4 });
    r.play(3, helloPacket(r.d[3]));
    expect(roster(r.d[0], 3)).toMatchObject({ duplicate: [], extra: [4], canStart: true });
    expect(roster(r.d[0], 4).canStart).toBe(true);
    expect(readyStatus(r.d[2]).clash).toEqual([]);
  });

  it('own echoes, repeats, and calls during a round change nothing', () => {
    const r = room(3);
    const hello = helloPacket(r.d[1])!;
    expect(receive(hello.state, hear(hello.bytes), 1).event.type).toBe('own-echo');
    r.play(1, hello);
    const again = receive(r.d[0], hear(hello.bytes), 2);
    expect(again.state).toBe(r.d[0]);
    // a player in an active round ignores ready checks
    r.play(2, helloPacket(r.d[2]));
    r.play(0, startGame(r.d[0], { players: 3, gameId: 0x77, now: 0 }));
    const call = callPacket(r.d[0], 3)!;
    const res = receive(r.d[1], hear(call.bytes), 3);
    expect(res.event.type).toBe('ignored');
    expect(res.state).toBe(r.d[1]);
  });

  it('only a ready player with a player ID can say hello, and saying hello is not the same as being confirmed', () => {
    expect(helloPacket(setProfile(initialState(7), { name: 'Bo' }))).toBeNull();
    expect(helloPacket(setProfile(initialState(7), { name: 'Bo', mode: 'host', seat: 1 }))).toBeNull();
    expect(helloPacket(setProfile(initialState(), { name: 'Bo', mode: 'player', seat: 2 }))).toBeNull(); // no ID yet
    const out = helloPacket(setProfile(initialState(7), { name: 'Bo', mode: 'player', seat: 2 }))!;
    expect(hear(out.bytes)).toMatchObject({ type: 'hello', seat: 2, name: 'Bo', pid: 7 });
    expect(readyStatus(out.state)).toMatchObject({ helloSent: true, confirmed: false });
    expect(out.state.lastSent).toBeNull(); // an automatic message doesn't replace "Resend my last chirp"
  });

  it('a seat above the call’s player count is told so', () => {
    const r = room(3, [{ name: 'Zed', seat: 6 }]);
    r.play(0, callPacket(r.d[0], 3));
    expect(readyStatus(r.d[3]).seatTooHigh).toBe(3);
  });
});

describe('players are tracked by player ID, never by name', () => {
  it('REGRESSION: two players with the same name on different seats both stay in the roster, get confirmed, and score separately', () => {
    // Asha hosts; two different phones are both called "Bo", on seats 2 and 3.
    const r = room(3, [], ['Asha', 'Bo', 'Bo']);
    r.play(1, helloPacket(r.d[1]));
    r.play(2, helloPacket(r.d[2])); // before the fix, this removed the first Bo from seat 2
    const ro = roster(r.d[0], 3);
    expect(ro.seats.map((x) => [x.seat, x.status, x.names.join('+')])).toEqual([
      [1, 'host', 'Asha'],
      [2, 'ready', 'Bo'],
      [3, 'ready', 'Bo'],
    ]);
    expect(ro).toMatchObject({ canStart: true, missing: [], duplicate: [], sameName: ['Bo'] });
    // Neither Bo sees the other as a seat clash: they are on different seats.
    expect(readyStatus(r.d[1]).clash).toEqual([]);
    expect(readyStatus(r.d[2]).clash).toEqual([]);
    // The ready check confirms both seats, and both phones see themselves confirmed.
    const call = hear(r.play(0, callPacket(r.d[0], 3)).bytes) as Extract<Packet, { type: 'call' }>;
    expect(call.confirmed).toBe(seatsToMask([1, 2, 3]));
    expect([readyStatus(r.d[1]).confirmed, readyStatus(r.d[2]).confirmed]).toEqual([true, true]);
    // Hearing either hello again (an echo or a retry) changes nothing.
    const again = receive(r.d[0], hear(helloPacket(r.d[1])!.bytes), 2);
    expect(again.state).toBe(r.d[0]);

    // A full round: both seats play, confirm results, and keep separate scores.
    r.play(0, startGame(r.d[0], { players: 3, gameId: 0x3b0, now: 0 }));
    r.play(0, sendEntry(setWordDraft(r.d[0], { custom: 'cat' }), { drawing: dot() }));
    r.play(1, sendEntry(r.d[1], { text: 'cat' }));
    expect(r.d[2].game!.conflict).toBeNull(); // same name, different seat: not a conflict
    r.play(2, sendEntry(r.d[2], { drawing: dot() }));
    r.play(0, revealGame(r.d[0], 5));
    r.play(0, sendResults(r.d[0], { funniest: 2, recognizable: 3, recovery: 0, final: 2 }));
    r.play(1, ackPacket(r.d[1]));
    r.play(2, ackPacket(r.d[2]));
    expect(awaitingAcks(r.d[0].game!)).toEqual([]);
    expect(r.d[0].game!.acks).toEqual([2, 3]);
    const pts = scores(r.d[0].game!).map((s) => [s.seat, s.name, s.points]);
    // seat 2: guessed the drawing + Funniest · seat 1: its drawing was guessed · seat 3: Most Recognizable
    expect(pts).toEqual([
      [2, 'Bo', 2],
      [1, 'Asha', 1],
      [3, 'Bo', 1],
    ]);
  });

  it('two phones on the same seat with the same name are a duplicate, not one player', () => {
    const r = room(3, [{ name: 'Cy', seat: 3 }]);
    r.play(2, helloPacket(r.d[2]));
    r.play(3, helloPacket(r.d[3]));
    expect(roster(r.d[0], 3)).toMatchObject({ duplicate: [3], canStart: false });
    expect(roster(r.d[0], 3).seats[2].names).toEqual(['Cy', 'Cy']);
    expect(readyStatus(r.d[2]).clash).toEqual(['Cy']);
    expect(readyStatus(r.d[3]).clash).toEqual(['Cy']);
  });

  it('a player who changes seat moves by player ID; another player with the same name stays put', () => {
    const r = room(4, [], ['Asha', 'Bo', 'Cy', 'Bo']);
    r.play(1, helloPacket(r.d[1]));
    r.play(3, helloPacket(r.d[3]));
    r.d[3] = setProfile(r.d[3], { seat: 3 }); // the second Bo moves from seat 4 to seat 3
    r.play(3, helloPacket(r.d[3]));
    expect(roster(r.d[0], 4).seats.map((x) => [x.seat, x.status, x.names.join('+')])).toEqual([
      [1, 'host', 'Asha'],
      [2, 'ready', 'Bo'],
      [3, 'ready', 'Bo'],
      [4, 'missing', ''],
    ]);
    // a player who renames themselves keeps their seat (same ID)
    r.d[1] = setProfile(r.d[1], { name: 'Bob' });
    r.play(1, helloPacket(r.d[1]));
    expect(roster(r.d[0], 4).seats[1].names).toEqual(['Bob']);
  });
});

describe('reply slots never overlap', () => {
  it('property: for any confirmed/duplicate masks, hello slots are distinct and a full slot apart', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 255 }), fc.integer({ min: 0, max: 255 }), (conf, dup) => {
        const delays = [2, 3, 4, 5, 6, 7, 8].map((s) => helloDelay(s, conf, dup)).filter((x): x is number => x !== null).sort((a, b) => a - b);
        delays.forEach((d, i) => i > 0 && expect(d - delays[i - 1]).toBe(HELLO_SLOT_MS));
        if (delays.length) expect(delays[0]).toBe(REPLY_GAP_MS);
        expect(callWindowMs(conf, dup)).toBe(delays.length ? delays[delays.length - 1] + HELLO_SLOT_MS : 0);
      }),
    );
  });

  it('results confirmations go in seat order; the host never confirms', () => {
    expect(ackDelay(1)).toBeNull();
    expect([2, 3, 4, 8].map(ackDelay)).toEqual([REPLY_GAP_MS, REPLY_GAP_MS + ACK_SLOT_MS, REPLY_GAP_MS + 2 * ACK_SLOT_MS, REPLY_GAP_MS + 6 * ACK_SLOT_MS]);
  });
});

/** A started and revealed 3-player round. */
function playedRound(deafToResults: number[] = []) {
  const r = room(3);
  r.play(0, startGame(r.d[0], { players: 3, gameId: 0x99, now: 0 }));
  for (let k = 1; k <= 3; k++) {
    const i = seatOfStep(r.d[0].game!, k) - 1;
    const base = k === 1 ? setWordDraft(r.d[i], { custom: 'cat' }) : r.d[i];
    r.play(i, sendEntry(base, k % 2 ? { drawing: dot() } : { text: 'cat' }));
  }
  r.play(0, revealGame(r.d[0], 5));
  const res = r.play(0, sendResults(r.d[0], { funniest: 2, recognizable: 0, recovery: 0, final: 1 }), deafToResults);
  return { r, res };
}

describe('results confirmation (R11)', () => {
  it('each player confirms; the host tracks who did', () => {
    const { r } = playedRound([2]);
    expect(awaitingAcks(r.d[0].game!)).toEqual([2, 3]);
    r.play(1, ackPacket(r.d[1]));
    expect(awaitingAcks(r.d[0].game!)).toEqual([3]);
    expect(r.d[1].game!.acks).toEqual([2]); // Bo knows its confirmation played
    expect(ackPacket(r.d[2])).toBeNull(); // Cy has no results to confirm
  });

  it('results sent again: confirmed again, never scored twice, and byte-identical', () => {
    const { r, res } = playedRound([2]);
    const before = JSON.stringify(scores(r.d[1].game!));
    const again = resendResults(r.d[0])!;
    expect(Array.from(again.bytes)).toEqual(Array.from(res.bytes));
    const heard = receive(r.d[1], hear(again.bytes), 9);
    expect(heard.event).toEqual({ type: 'results', again: true, ackIn: ackDelay(2) });
    expect(heard.state).toBe(r.d[1]);
    expect(JSON.stringify(scores(heard.state.game!))).toBe(before);
    // Cy missed it the first time: now it gets the results and its own slot
    const cy = receive(r.d[2], hear(again.bytes), 9);
    expect(cy.event).toEqual({ type: 'results', again: false, ackIn: ackDelay(3) });
    expect(JSON.stringify(scores(cy.state.game!))).toBe(before);
  });

  it('confirmations are idempotent and only count for this round', () => {
    const { r } = playedRound();
    const ack = ackPacket(r.d[1])!;
    r.play(1, ack);
    const twice = receive(r.d[0], hear(ack.bytes), 3);
    expect(twice.state.game!.acks).toEqual([2]);
    const other = receive(r.d[0], { type: 'ack', gameId: 0x1234, seat: 3, step: 0 }, 3);
    expect(other.state).toBe(r.d[0]);
    const host = receive(r.d[0], { type: 'ack', gameId: 0x99, seat: 1, step: 0 }, 3);
    expect(host.state).toBe(r.d[0]);
  });
});

describe('missed start signal (R9.7)', () => {
  it('a ready player who missed the start notices the next turn and asks the host to join', () => {
    const r = room(3);
    r.play(0, startGame(r.d[0], { players: 3, gameId: 0x55, now: 0 }), [2]); // Cy missed the start
    expect(r.d[2].game).toBeNull();
    const e1 = sendEntry(setWordDraft(r.d[0], { custom: 'cat' }), { drawing: dot() })!;
    r.play(0, e1);
    expect(r.events[2]).toEqual(['missed-start']);
    const ask = r.play(2, askToJoin(r.d[2], 0x55));
    expect(hear(ask.bytes)).toEqual({ type: 'need', gameId: 0x55, step: NEED_START });
    // only the host answers, with the start signal
    expect(r.d.map((s) => autoAnswer(s, NEED_START).map((p) => p.type))).toEqual([['start'], [], []]);
    const [start] = autoAnswer(r.d[0], NEED_START);
    const joined = receive(r.d[2], start, 4);
    expect(joined.event.type).toBe('joined');
    expect(joined.state.game?.gameId).toBe(0x55);
    // others already in the round keep their state; Bo hasn't played yet, so it confirms again
    const bo = receive(r.d[1], start, 4);
    expect(bo.state).toBe(r.d[1]);
    expect(bo.event).toEqual({ type: 'start-again', ackIn: ackDelay(2) });
  });

  it('the start signal alone never marks anyone as joined on the host', () => {
    const r = room(3);
    r.play(1, helloPacket(r.d[1]));
    r.play(2, helloPacket(r.d[2]));
    r.play(0, startGame(r.d[0], { players: 3, gameId: 0x56, now: 0 }), [1, 2]);
    // the host's game knows nothing about the players until their turns arrive
    expect(Object.keys(r.d[0].game!.entries)).toEqual([]);
    expect(encodePacket(autoAnswer(r.d[0], NEED_START)[0]).length).toBeLessThanOrEqual(17);
  });
});
