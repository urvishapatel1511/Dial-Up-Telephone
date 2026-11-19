import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { hatPuzzle, lockPuzzle } from '../src/game/puzzles';
import { KEYS, mirrorRune, RUNES, SPOTS, type KeySymbol, type Spot } from '../src/game/rules';
import { emptyGrid } from '../src/protocol/drawing';
import { decodeMessage, encodeMessage, transferKey, type GhostMessage } from '../src/protocol/message';
import { SendGate } from '../src/state/sender';
import {
  houseSend,
  houseStart,
  initialState,
  inProgress,
  loadState,
  newGame,
  otherSend,
  receive,
  resendBytes,
  saveState,
  storageKey,
  type GameState,
  type KeyValueStore,
  type Outgoing,
} from '../src/state/transfers';
import { gridArb, messageArb, nameArb } from './arbitraries';

/** Simulates the air: bytes leave one device and are decoded on the other. */
function hear(bytes: Uint8Array): GhostMessage {
  const res = decodeMessage(bytes);
  if (!res.ok) throw new Error(res.error);
  return res.message;
}

const ghostGrid = () => {
  const g = emptyGrid();
  g[1][2] = g[1][5] = g[4][1] = g[4][6] = g[5][2] = g[5][5] = true;
  return g;
};

function memoryStore(): KeyValueStore {
  const data = new Map<string, string>();
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

/** random = 0 → Other Side room: darkness (needs the lantern), rune RUNES[0]. */
const zero = () => 0;
const GHOST = 0x1234;
const lock = lockPuzzle(GHOST);
const hat = hatPuzzle(GHOST);
const wrongKey = KEYS.find((k) => k !== lock.answer)!;
const wrongSpot = SPOTS.find((s) => s !== hat.answer)!;

/** Two devices and the air between them. Every step plays a chirp, then delivers it. */
function table() {
  const t = {
    house: initialState('house', 10, zero),
    other: initialState('other', 200, zero),
    events: [] as string[],
    /** Commit = the chirp finished playing. Then the other device hears it. */
    play(from: 'house' | 'other', out: Outgoing | null, deliver = true) {
      if (!out) throw new Error(`${from} could not send`);
      if (from === 'house') t.house = out.state;
      else t.other = out.state;
      if (deliver) t.deliver(from === 'house' ? 'other' : 'house', out.bytes);
      return out;
    },
    deliver(to: 'house' | 'other', bytes: Uint8Array) {
      const r = receive(to === 'house' ? t.house : t.other, hear(bytes), 1000);
      if (to === 'house') t.house = r.state;
      else t.other = r.state;
      t.events.push('outcome' in r.event ? r.event.outcome.kind : r.event.type);
      return r;
    },
    summonAndAccept() {
      t.play('house', houseStart(t.house, ghostGrid(), 'BOO', GHOST, 0));
      t.play('other', otherSend(t.other, { partner: 7 }, 0));
    },
    house_(choice: Parameters<typeof houseSend>[1]) {
      return t.play('house', houseSend(t.house, choice, 5000));
    },
    other_(key?: KeySymbol) {
      return t.play('other', otherSend(t.other, { key }, 5000));
    },
  };
  return t;
}

describe('full adventure (R6, acceptance)', () => {
  it('perfect run with the hat: both devices agree on every outcome', () => {
    const t = table();
    t.summonAndAccept();
    expect(t.house.house?.partner).toBe(7);
    expect(t.other.other?.ghost?.grid).toEqual(ghostGrid()); // identical drawing on the Other Side
    t.house_({ object: 'lantern' });
    t.other_(lock.answer);
    t.house_({ rune: RUNES[0].blocks });
    t.other_();
    t.house_({ spot: hat.answer });
    t.other_();

    expect(t.events).toEqual(['calling', 'paired', 'object-worked', 'key-right', 'rune-worked', 'rescued', 'hat', 'hat']);
    expect(t.house.house).toMatchObject({ phase: 'free', bonus: 'won', energy: 3, grid: ghostGrid() });
    expect(t.house.house?.solved).toEqual({ obstacle: true, lock: true, rune: true });
    expect(t.other.other).toMatchObject({ phase: 'over', ended: 'free', bonus: 'won', energy: 3 });
    expect(t.other.other?.solved).toEqual({ obstacle: true, lock: true, rune: true });
    expect(inProgress(t.house)).toBe(false);
    expect(inProgress(t.other)).toBe(false);
  });

  it('one wrong answer per stage costs exactly one candle each, then the ghost fades on both devices', () => {
    const t = table();
    t.summonAndAccept();
    t.house_({ object: 'bell' }); // wrong object
    expect(t.other.other?.energy).toBe(2);
    t.other_(); // home empty-handed
    expect(t.house.house).toMatchObject({ phase: 'object', energy: 2 });
    t.house_({ object: 'lantern' });
    t.other_(wrongKey); // wrong key
    expect(t.house.house).toMatchObject({ phase: 'key-retry', energy: 1 });
    t.house_({});
    expect(t.other.other).toMatchObject({ phase: 'keys', energy: 1 });
    t.other_(lock.answer);
    t.house_({ rune: mirrorRune(RUNES[0].blocks) }); // painted the reflection: wrong
    expect(t.other.other).toMatchObject({ phase: 'rune-bad', energy: 0 });
    t.other_();
    expect(t.house.house).toMatchObject({ phase: 'faded', energy: 0, farewellSent: true });
    expect(t.other.other).toMatchObject({ phase: 'over', ended: 'faded' });
  });

  it('a wrong last key fades the ghost on the House, and the farewell chirp tells the Other Side', () => {
    const t = table();
    t.summonAndAccept();
    t.house_({ object: 'mirror' });
    t.other_();
    t.house_({ object: 'bell' });
    t.other_();
    expect(t.house.house?.energy).toBe(1);
    t.house_({ object: 'lantern' });
    t.other_(wrongKey);
    expect(t.house.house).toMatchObject({ phase: 'faded', farewellSent: false });
    t.house_({}); // farewell
    expect(t.other.other).toMatchObject({ phase: 'over', ended: 'faded' });
    expect(houseSend(t.house, {}, 0)).toBeNull(); // only once; Resend repeats it
  });

  it('bonus skipped: an immediate successful ending on both devices', () => {
    const t = table();
    t.summonAndAccept();
    t.house_({ object: 'lantern' });
    t.other_(lock.answer);
    t.house_({ rune: RUNES[0].blocks });
    t.other_();
    expect(t.house.house?.phase).toBe('bonus');
    expect(t.other.other).toMatchObject({ ended: 'free', bonus: null }); // rescued already
    t.house_({ skip: true });
    expect(t.house.house).toMatchObject({ phase: 'free', bonus: 'skipped' });
    expect(t.other.other).toMatchObject({ ended: 'free', bonus: 'skipped' });
  });

  it('bonus failed: escape without the hat, no candle lost, rescue not revoked', () => {
    const t = table();
    t.summonAndAccept();
    t.house_({ object: 'lantern' });
    t.other_(lock.answer);
    t.house_({ rune: RUNES[0].blocks });
    t.other_();
    t.house_({ spot: wrongSpot });
    t.other_();
    expect(t.house.house).toMatchObject({ phase: 'free', bonus: 'lost', energy: 3 });
    expect(t.house.house?.solved.rune).toBe(true);
    expect(t.other.other).toMatchObject({ ended: 'free', bonus: 'lost', energy: 3 });
  });

  it('the rune is checked in true orientation with 1 block of tolerance', () => {
    const t = table();
    t.summonAndAccept();
    t.house_({ object: 'lantern' });
    t.other_(lock.answer);
    const almost = RUNES[0].blocks.map((r) => [...r]);
    almost[0][3] = !almost[0][3];
    t.house_({ rune: almost });
    expect(t.other.other?.phase).toBe('freed');
  });
});

describe('transport problems never cost a candle (C5, R4.7)', () => {
  it('a missed chirp + Resend gives one outcome and one candle loss at most', () => {
    const t = table();
    t.summonAndAccept();
    t.play('house', houseSend(t.house, { object: 'bell' }, 0), false); // played, nobody heard
    expect(t.other.other?.energy).toBe(3);
    t.deliver('other', resendBytes(t.house)!);
    t.deliver('other', resendBytes(t.house)!);
    t.deliver('other', resendBytes(t.house)!);
    expect(t.other.other?.energy).toBe(2);
    expect(t.events.slice(-3)).toEqual(['object-failed', 'duplicate', 'duplicate']);
  });

  it('a corrupted chirp is rejected and changes nothing', () => {
    const t = table();
    t.summonAndAccept();
    const out = houseSend(t.house, { object: 'bell' }, 0)!;
    const bad = out.bytes.slice();
    bad[8] ^= 0x40;
    expect(decodeMessage(bad).ok).toBe(false);
    expect(t.other.other?.energy).toBe(3);
  });

  it('failed playback commits nothing; the retry is byte-identical and safe', async () => {
    const t = table();
    t.summonAndAccept();
    const gate = new SendGate();
    const first = houseSend(t.house, { object: 'bell' }, 0)!;
    const r = await gate.run(first, async () => Promise.reject(new Error('speaker busy')), (s) => (t.house = s));
    expect(r).toMatchObject({ ok: false, reason: 'failed' });
    expect(t.house.house?.phase).toBe('object'); // unchanged
    const retry = houseSend(t.house, { object: 'bell' }, 0)!;
    expect(Array.from(retry.bytes)).toEqual(Array.from(first.bytes));
    // Even if the other device heard the "failed" chirp, the retry is a duplicate: one candle at most.
    t.deliver('other', first.bytes);
    const ok = await gate.run(retry, async () => 2300, (s) => (t.house = s));
    expect(ok).toEqual({ ok: true, ms: 2300 });
    t.deliver('other', retry.bytes);
    expect(t.other.other?.energy).toBe(2);
  });

  it('the send gate allows one send at a time', async () => {
    const gate = new SendGate();
    let release!: () => void;
    const slow = gate.run({ state: 1, bytes: new Uint8Array(1) }, () => new Promise<number>((r) => (release = () => r(1))), () => {});
    expect(gate.busy).toBe(true);
    expect(await gate.run({ state: 2, bytes: new Uint8Array(1) }, async () => 1, () => {})).toEqual({ ok: false, reason: 'busy' });
    release();
    await slow;
    expect(gate.busy).toBe(false);
  });

  it('a device ignores its own chirp', () => {
    const out = houseStart(initialState('house', 0, zero), ghostGrid(), 'BOO', 5, 0)!;
    const r = receive(out.state, hear(out.bytes), 0);
    expect(r.event.type).toBe('own-echo');
    expect(r.state).toBe(out.state);
  });

  it('property: no sequence of replays ever produces more state changes than distinct chirps', () => {
    fc.assert(
      fc.property(fc.array(messageArb, { minLength: 1, maxLength: 8 }), fc.array(fc.nat(), { maxLength: 30 }), (msgs, order) => {
        for (const role of ['house', 'other'] as const) {
          let s: GameState = initialState(role, 0, zero);
          let changes = 0;
          const keys = new Set<string>();
          for (const i of [...order, ...msgs.keys()]) {
            const m = msgs[i % msgs.length];
            keys.add(transferKey(m));
            const r = receive(s, m, 0);
            if (r.state !== s) changes++;
            s = r.state;
          }
          expect(changes).toBeLessThanOrEqual(keys.size);
        }
      }),
    );
  });
});

describe('pairing (R3.4-R3.6)', () => {
  it('the Other Side pairs only after Accept', () => {
    const t = table();
    t.play('house', houseStart(t.house, ghostGrid(), 'BOO', GHOST, 0));
    expect(t.other.other).toMatchObject({ phase: 'calling', ghost: null });
    expect(t.house.house?.phase).toBe('away');
    expect(otherSend(t.other, {}, 0)).toBeNull(); // accept needs a partner tag
    t.play('other', otherSend(t.other, { partner: 3 }, 0));
    expect(t.house.house).toMatchObject({ phase: 'object', partner: 3 });
  });

  it('a paired room ignores a summon from another game nearby', () => {
    const t = table();
    t.summonAndAccept();
    const stranger = houseStart(initialState('house', 50, zero), ghostGrid(), 'ZED', 0x9999, 0)!;
    const r = t.deliver('other', stranger.bytes);
    expect(r.event.type).toBe('not-ours');
    expect(t.other.other?.ghost?.name).toBe('BOO');
  });

  it('a paired room ignores chirps for its ghost carrying another partner tag', () => {
    const t = table();
    t.summonAndAccept();
    const out = houseSend(t.house, { object: 'lantern' }, 0)!;
    const forged = encodeMessage({ ...hear(out.bytes), partner: 8 });
    expect(t.deliver('other', forged).event.type).toBe('not-ours');
    expect(t.other.other?.cleared).toBe(false);
  });

  it('the House ignores an answer from another phone (different partner tag)', () => {
    const t = table();
    t.summonAndAccept();
    t.play('house', houseSend(t.house, { object: 'lantern' }, 0), false);
    const forged = encodeMessage({ ...hear(t.house.lastSent ? Uint8Array.from(t.house.lastSent.bytes) : new Uint8Array()), direction: 'return', partner: 2, item: lock.answer, transferId: 99 });
    t.deliver('house', forged);
    expect(t.house.house?.phase).toBe('away');
  });

  it('a waiting room that hears two summons offers the latest one; accepting pairs with it', () => {
    const other0 = initialState('other', 0, zero);
    const a = houseStart(initialState('house', 1, zero), ghostGrid(), 'A', 1, 0)!;
    const b = houseStart(initialState('house', 2, zero), ghostGrid(), 'B', 2, 0)!;
    const s1 = receive(other0, hear(a.bytes), 0).state;
    const s2 = receive(s1, hear(b.bytes), 0).state;
    expect(s2.other?.candidate?.name).toBe('B');
  });
});

describe('replay and stale chirps (R4.8)', () => {
  it('Play again clears the last chirp and the puzzle, retires the ghost, and keeps dedupe memory', () => {
    const t = table();
    t.summonAndAccept();
    const oldSummon = t.house.lastSent!;
    const h = newGame(t.house, zero);
    expect(h).toMatchObject({ lastSent: null, house: null });
    expect(h.retired).toContain(GHOST);
    expect(h.sent).toContain(oldSummon.key);
    const o = newGame(t.other, () => 0.99);
    expect(o.other).toMatchObject({ ghost: null, phase: 'waiting', room: { obstacle: 2, rune: 5 } });
    expect(o.retired).toContain(GHOST);
  });

  it('chirps from the previous game are ignored after Play again', () => {
    const t = table();
    t.summonAndAccept();
    const object = houseSend(t.house, { object: 'lantern' }, 0)!;
    const other = newGame(t.other, zero);
    // A late or replayed chirp from the old ghost, even with a new transfer ID:
    const late = encodeMessage({ ...hear(object.bytes), transferId: 200 });
    const r = receive(other, hear(late), 0);
    expect(r.event.type).toBe('stale');
    expect(r.state).toBe(other);
    // Even the old summon cannot start a new pairing.
    const oldSummon = encodeMessage({ ...hear(houseStart(initialState('house', 10, zero), ghostGrid(), 'BOO', GHOST, 0)!.bytes), transferId: 201 });
    expect(receive(other, hear(oldSummon), 0).event.type).toBe('stale');
  });

  it('a new ghost never reuses a retired ID', () => {
    const s = { ...initialState('house', 0, zero), retired: [5, 6] };
    expect(houseStart(s, ghostGrid(), 'X', 5, 0)!.state.house?.ghostId).toBe(7);
  });
});

describe('refresh and resume in every stage (R6.6, R4.6)', () => {
  it('saving and loading at every step resumes the same information split', () => {
    const t = table();
    const snapshots: GameState[] = [];
    const snap = () => snapshots.push(t.house, t.other);
    t.play('house', houseStart(t.house, ghostGrid(), 'BOO', GHOST, 0));
    snap();
    t.play('other', otherSend(t.other, { partner: 7 }, 0));
    snap();
    t.house_({ object: 'lantern' });
    snap();
    t.other_(wrongKey);
    snap();
    t.house_({});
    snap();
    t.other_(lock.answer);
    snap();
    t.house_({ rune: RUNES[0].blocks });
    snap();
    t.other_();
    snap();
    for (const s of snapshots) {
      const store = memoryStore();
      saveState(store, s);
      const back = loadState(store, s.role, 99, Math.random);
      expect(back).toEqual(s);
      // The clue each side sees is rebuilt from saved data only.
      if (back.other?.ghost) expect(lockPuzzle(back.other.ghost.ghostId)).toEqual(lock);
      if (back.other) expect(back.other.room).toEqual(s.other!.room);
    }
  });

  it('a replay after a refresh is still a duplicate', () => {
    fc.assert(
      fc.property(gridArb, nameArb, fc.integer({ min: 0, max: 0xffff }), (grid, name, id) => {
        const store = memoryStore();
        const out = houseStart(initialState('house', 0, zero), grid, name, id, 0)!;
        const other = receive(initialState('other', 1, zero), hear(out.bytes), 0).state;
        saveState(store, other);
        const reloaded = loadState(store, 'other', 123, Math.random);
        expect(reloaded).toEqual(other);
        expect(receive(reloaded, hear(out.bytes), 0).event.type).toBe('duplicate');
      }),
    );
  });

  it('House and Other Side are stored separately, so two windows on one laptop can play', () => {
    const store = memoryStore();
    const house = houseStart(initialState('house', 0, zero), ghostGrid(), 'BOO', 3, 0)!.state;
    const other = initialState('other', 0, () => 0.9);
    saveState(store, house);
    saveState(store, other);
    expect(loadState(store, 'house', 0, zero)).toEqual(house);
    expect(loadState(store, 'other', 0, zero)).toEqual(other);
  });

  it('corrupt or old-version storage falls back to a fresh state', () => {
    const store = memoryStore();
    store.setItem(storageKey('house'), '{not json');
    expect(loadState(store, 'house', 4, zero)).toEqual(initialState('house', 4, zero));
    store.setItem(storageKey('house'), JSON.stringify({ v: 3, seen: [], sent: [] }));
    expect(loadState(store, 'house', 4, zero)).toEqual(initialState('house', 4, zero));
  });
});

describe('the original drawing is preserved (C3)', () => {
  it('after the rune trip and the hat, both devices still hold the original drawing', () => {
    const t = table();
    t.summonAndAccept();
    t.house_({ object: 'lantern' });
    t.other_(lock.answer);
    t.house_({ rune: RUNES[0].blocks });
    t.other_();
    t.house_({ spot: hat.answer as Spot });
    t.other_();
    expect(t.house.house?.grid).toEqual(ghostGrid());
    expect(t.other.other?.ghost?.grid).toEqual(ghostGrid());
  });
});
