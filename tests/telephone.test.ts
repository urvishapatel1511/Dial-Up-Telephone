import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  chain,
  initialState,
  leaveGame,
  loadState,
  phaseOf,
  promptFor,
  receive,
  resendBytes,
  revealGame,
  saveState,
  sendEntry,
  setProfile,
  startGame,
  type KeyValueStore,
  type Outgoing,
  type State,
} from '../src/game/telephone';
import { WORDS } from '../src/game/words';
import { emptyGrid, type Grid } from '../src/protocol/drawing';
import { decodePacket, encodePacket, type Packet } from '../src/protocol/packet';
import { SendGate } from '../src/state/sender';
import { gridArb } from './arbitraries';

const hear = (b: Uint8Array): Packet => {
  const r = decodePacket(b);
  if (!r.ok) throw new Error(r.error);
  return r.packet;
};

const sketch = (seed: number): Grid => {
  const g = emptyGrid();
  g[seed % 8][(seed * 3) % 8] = g[(seed + 4) % 8][(seed + 1) % 8] = true;
  return g;
};

function memoryStore(): KeyValueStore {
  const data = new Map<string, string>();
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

const NAMES = ['Asha', 'Bo', 'Cy', 'Dee', 'Eli', 'Fay', 'Gus', 'Hal'];

/** A room of N devices. Every chirp reaches every device except the sender (and anyone listed as deaf). */
function room(n: number) {
  const devices: State[] = NAMES.slice(0, n).map((name, i) =>
    i === 0 ? setProfile(initialState(), { name }) : setProfile(initialState(), { name, mode: 'player', seat: i + 1 }),
  );
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
    start(word = 'pumpkin', gameId = 0x4242) {
      return r.play(0, startGame(devices[0], { players: n, word, gameId, now: 0 }));
    },
    turn(seat: number, deaf: number[] = []) {
      const d = devices[seat - 1];
      const content = seat % 2 === 1 ? { drawing: sketch(seat) } : { text: seat === 2 ? 'pumpkin' : `guess ${seat}` };
      return r.play(seat - 1, sendEntry(d, content), deaf);
    },
  };
  return r;
}

describe('a full round (acceptance)', () => {
  it('5 players: everyone joins by sound, sees only the previous entry, and gets the same reveal', () => {
    const r = room(5);
    r.start();
    expect(r.devices.slice(1).map(phaseOf)).toEqual(['waiting', 'waiting', 'waiting', 'waiting']);
    expect(phaseOf(r.devices[0])).toBe('my-turn');
    expect(promptFor(r.devices[0].game!)).toEqual({ kind: 'word', text: 'pumpkin' });
    expect(r.devices[1].game?.word).toBeNull(); // players never learn the word before the reveal

    for (let seat = 1; seat <= 5; seat++) {
      // Only the seat whose turn it is has something to respond to.
      expect(r.devices.map(phaseOf).filter((p) => p === 'my-turn')).toHaveLength(1);
      expect(phaseOf(r.devices[seat - 1])).toBe('my-turn');
      if (seat > 1) {
        const prompt = promptFor(r.devices[seat - 1].game!)!;
        expect(prompt.kind).toBe(seat % 2 === 0 ? 'drawing' : 'text');
        if (prompt.kind !== 'word') expect(prompt.from).toBe(NAMES[seat - 2]);
      }
      r.turn(seat);
    }
    expect(phaseOf(r.devices[0])).toBe('ready-to-reveal');
    expect(r.devices.slice(1).map(phaseOf)).toEqual(['sent', 'sent', 'sent', 'sent']);

    r.play(0, revealGame(r.devices[0], 9000));
    const chains = r.devices.map((d) => chain(d.game!));
    for (const c of chains) {
      expect(c).toEqual(chains[0]);
      expect(c.cards.map((x) => x.kind)).toEqual(['word', 'drawing', 'text', 'drawing', 'text', 'drawing']);
      expect(c.cards[2].text).toBe('pumpkin');
      expect(c.survivedHops).toBe(3); // the guess at step 4 mutated
      expect(c.perfect).toBeNull(); // odd N ends on a drawing
    }
    expect(r.devices.map(phaseOf).every((p) => p === 'reveal')).toBe(true);
  });

  it('a perfect transmission is detected (case and spacing ignored)', () => {
    const r = room(2);
    r.start('Witch Hat');
    r.turn(1);
    r.play(1, sendEntry(r.devices[1], { text: '  witch  HAT ' }));
    r.play(0, revealGame(r.devices[0], 1));
    expect(chain(r.devices[1].game!)).toMatchObject({ perfect: true, survivedHops: 2 });
  });

  it('every built-in word fits the 12-character limit', () => {
    for (const w of WORDS) expect(w.length).toBeLessThanOrEqual(12);
    expect(new Set(WORDS).size).toBe(WORDS.length);
  });
});

describe('joining (R2)', () => {
  it('a player whose seat is too high does not join, and can join after picking a lower seat', () => {
    const r = room(3);
    r.devices[2] = setProfile(r.devices[2], { seat: 5 });
    const start = r.start();
    expect(r.log).toContain('3:seat-too-high');
    expect(r.devices[2].game).toBeNull();
    r.devices[2] = setProfile(r.devices[2], { seat: 3 });
    r.broadcast(resendBytes(r.devices[0])!, 0); // the host resends the start
    expect(r.devices[2].game?.seat).toBe(3);
    expect(Array.from(resendBytes(r.devices[0])!)).toEqual(Array.from(start.bytes));
  });

  it('a player who is not ready yet is told so, and a resend lets them join', () => {
    const r = room(3);
    r.devices[1] = setProfile(r.devices[1], { mode: null });
    r.start();
    expect(r.log).toContain('2:not-ready');
    r.devices[1] = setProfile(r.devices[1], { mode: 'player', seat: 2 });
    r.broadcast(resendBytes(r.devices[0])!, 0);
    expect(phaseOf(r.devices[1])).toBe('waiting');
  });

  it('a player in an unfinished game ignores starts from another table', () => {
    const r = room(3);
    r.start();
    const other = startGame(setProfile(initialState(), { name: 'Zed' }), { players: 4, word: 'cat', gameId: 7, now: 0 })!;
    const res = receive(r.devices[1], hear(other.bytes), 0);
    expect(res.event.type).toBe('other-game');
    expect(res.state).toBe(r.devices[1]);
  });

  it('entries from another game are ignored', () => {
    const r = room(3);
    r.start();
    const foreign = encodePacket({ type: 'entry', gameId: 999, step: 1, name: 'X', drawing: sketch(1) });
    const res = receive(r.devices[1], hear(foreign), 0);
    expect(res.event.type).toBe('other-game');
    expect(phaseOf(res.state)).toBe('waiting');
  });
});

describe('missed chirps, resends, duplicates (C4)', () => {
  it('if seat 2 misses the drawing, nothing breaks; a resend gives them their turn', () => {
    const r = room(3);
    r.start();
    r.turn(1, [1]); // device of seat 2 is deaf this time
    expect(phaseOf(r.devices[1])).toBe('waiting');
    expect(phaseOf(r.devices[2])).toBe('waiting'); // seat 3 heard step 1 but must wait for step 2
    r.broadcast(resendBytes(r.devices[0])!, 0);
    expect(phaseOf(r.devices[1])).toBe('my-turn');
    expect(r.log.filter((l) => l === '3:duplicate')).toHaveLength(1); // seat 3 heard it twice, nothing changed
  });

  it('a duplicate or own echo returns the same state object', () => {
    const r = room(3);
    const start = r.start();
    const again = receive(r.devices[1], hear(start.bytes), 0);
    expect(again.event.type).toBe('duplicate');
    expect(again.state).toBe(r.devices[1]);
    const echo = receive(r.devices[0], hear(start.bytes), 0);
    expect(echo.event.type).toBe('own-echo');
  });

  it('failed playback commits nothing, and the retry is byte-identical', async () => {
    const r = room(3);
    r.start();
    const gate = new SendGate();
    let host = r.devices[0];
    const first = sendEntry(host, { drawing: sketch(1) })!;
    const res = await gate.run(first, () => Promise.reject(new Error('speaker busy')), (s) => (host = s));
    expect(res).toMatchObject({ ok: false, reason: 'failed' });
    expect(phaseOf(host)).toBe('my-turn');
    const retry = sendEntry(host, { drawing: sketch(1) })!;
    expect(Array.from(retry.bytes)).toEqual(Array.from(first.bytes));
  });

  it('the gate allows one send at a time', async () => {
    const gate = new SendGate();
    let release!: () => void;
    const slow = gate.run({ state: 1, bytes: new Uint8Array(1) }, () => new Promise<number>((ok) => (release = () => ok(1))), () => {});
    expect(await gate.run({ state: 2, bytes: new Uint8Array(1) }, async () => 1, () => {})).toEqual({ ok: false, reason: 'busy' });
    release();
    await slow;
  });

  it('a device that missed a middle entry still reveals, showing "not heard"', () => {
    const r = room(4);
    r.start();
    r.turn(1);
    r.turn(2, [3]); // seat 4's device misses step 2
    r.turn(3);
    r.turn(4);
    r.play(0, revealGame(r.devices[0], 1));
    expect(chain(r.devices[3].game!).cards[2].kind).toBe('missing');
    expect(chain(r.devices[1].game!).cards[2].kind).toBe('text');
  });

  it('property: replays never produce more accepted changes than distinct chirps', () => {
    fc.assert(
      fc.property(fc.array(fc.nat({ max: 4 }), { maxLength: 30 }), (order) => {
        const r = room(4);
        const chirps = [r.start().bytes, r.turn(1).bytes, r.turn(2).bytes, r.turn(3).bytes, r.turn(4).bytes];
        let s = r.devices[2];
        for (const i of order) s = receive(s, hear(chirps[i]), 0).state;
        expect(s).toEqual(r.devices[2]);
      }),
      { numRuns: 50 },
    );
  });
});

describe('secrecy before the reveal (R3.2)', () => {
  it("each player's prompt is only the previous entry", () => {
    fc.assert(
      fc.property(gridArb, (drawing) => {
        const r = room(4);
        r.start();
        r.play(0, sendEntry(r.devices[0], { drawing }));
        r.turn(2);
        const p = promptFor(r.devices[2].game!);
        expect(p).toEqual({ kind: 'text', text: 'pumpkin', from: 'Bo' });
        expect(promptFor(r.devices[3].game!)).toBeNull(); // seat 4 has nothing to respond to yet
      }),
      { numRuns: 20 },
    );
  });

  it('the host cannot reveal before the last step is heard, and players cannot reveal', () => {
    const r = room(3);
    r.start();
    r.turn(1);
    expect(revealGame(r.devices[0], 0)).toBeNull();
    r.turn(2);
    r.turn(3);
    expect(revealGame(r.devices[1], 0)).toBeNull();
    expect(revealGame(r.devices[0], 0)).not.toBeNull();
  });

  it('nobody can send out of turn, or send an empty drawing or guess', () => {
    const r = room(3);
    r.start();
    expect(sendEntry(r.devices[1], { text: 'cat' })).toBeNull(); // seat 2 before step 1
    expect(sendEntry(r.devices[0], { drawing: emptyGrid() })).toBeNull();
    r.turn(1);
    expect(sendEntry(r.devices[1], { text: '   ' })).toBeNull();
  });
});

describe('play again and refresh (R4.4, R5.4)', () => {
  it('play again: players stay ready, join the next start, and stale chirps are ignored', () => {
    const r = room(3);
    r.start();
    const oldDrawing = r.turn(1).bytes;
    r.turn(2);
    r.turn(3);
    r.play(0, revealGame(r.devices[0], 1));
    r.play(0, startGame(r.devices[0], { players: 3, word: 'bat', gameId: 0x4242, now: 2 })); // same random ID is bumped
    expect(r.devices[0].game?.gameId).not.toBe(0x4242);
    expect(r.devices.map(phaseOf)).toEqual(['my-turn', 'waiting', 'waiting']);
    // Heard before: rejected as a duplicate. Never heard (but the game is retired): rejected as stale.
    const replay = receive(r.devices[1], hear(oldDrawing), 0);
    expect(replay.event.type).toBe('duplicate');
    expect(replay.state).toBe(r.devices[1]);
    const neverHeard = { ...r.devices[1], seen: [] };
    const late = receive(neverHeard, hear(oldDrawing), 0);
    expect(late.event.type).toBe('stale');
    expect(late.state).toBe(neverHeard);
  });

  it('leaving clears the game and the last chirp but keeps the profile and dedupe memory', () => {
    const r = room(3);
    r.start();
    const left = leaveGame(r.devices[1]);
    expect(left).toMatchObject({ game: null, lastSent: null });
    expect(left.profile.seat).toBe(2);
    expect(left.retired).toContain(0x4242);
    expect(phaseOf(left)).toBe('ready');
  });

  it('state survives save/load at every step', () => {
    const r = room(4);
    const snaps: State[] = [];
    r.start();
    snaps.push(...r.devices);
    for (let k = 1; k <= 4; k++) {
      r.turn(k);
      snaps.push(...r.devices);
    }
    r.play(0, revealGame(r.devices[0], 1));
    snaps.push(...r.devices);
    for (const s of snaps) {
      const store = memoryStore();
      saveState(store, s);
      expect(loadState(store)).toEqual(s);
    }
  });

  it('corrupt storage falls back to a fresh state', () => {
    const store = memoryStore();
    store.setItem('dialup:v1', '{nope');
    expect(loadState(store)).toEqual(initialState());
  });
});
