import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { RUNES } from '../src/game/rules';
import { emptyGrid } from '../src/protocol/drawing';
import { decodeMessage, transferKey, type GhostMessage } from '../src/protocol/message';
import {
  houseSend,
  houseStart,
  initialState,
  loadState,
  newGame,
  otherSend,
  receive,
  resendBytes,
  saveState,
  storageKey,
  type GameState,
  type KeyValueStore,
} from '../src/state/transfers';
import { gridArb, messageArb, nameArb } from './arbitraries';

/** Simulates the air: bytes leave one device and are decoded on the other. */
function hear(bytes: Uint8Array): GhostMessage {
  const res = decodeMessage(bytes);
  if (!res.ok) throw new Error(res.error);
  return res.message;
}

function ghostGrid() {
  const g = emptyGrid();
  g[1][2] = g[1][5] = g[4][1] = g[4][6] = g[5][2] = g[5][5] = true;
  return g;
}

function memoryStore(): KeyValueStore {
  const data = new Map<string, string>();
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

/** random = 0 → House keyhole 'star'; Other Side obstacle 'darkness' (needs lantern), rune RUNES[0]. */
const zero = () => 0;

function newTable() {
  let house = initialState('house', 10, zero);
  let other = initialState('other', 200, zero);
  const events: string[] = [];
  const deliver = (to: 'house' | 'other', bytes: Uint8Array) => {
    const r = receive(to === 'house' ? house : other, hear(bytes), 1000);
    if (to === 'house') house = r.state;
    else other = r.state;
    events.push('outcome' in r.event ? r.event.outcome.kind : r.event.type);
  };
  return {
    get house() {
      return house;
    },
    set house(s: GameState) {
      house = s;
    },
    get other() {
      return other;
    },
    set other(s: GameState) {
      other = s;
    },
    events,
    deliver,
  };
}

describe('full game, every trip by sound (R5)', () => {
  it('one mistake in each step uses up all three candles and the ghost fades', () => {
    const t = newTable();

    // Step 1: wrong object, then the right one.
    let out = houseStart(t.house, ghostGrid(), 'Casper', 0x1234, { object: 'bell' }, zero, 0)!;
    t.house = out.state;
    t.deliver('other', out.bytes);
    expect(t.other.other?.ghost?.name).toBe('Casper');
    expect(t.other.other?.ghost?.grid).toEqual(ghostGrid()); // identical drawing on the Other Side
    out = otherSend(t.other)!;
    t.other = out.state;
    t.deliver('house', out.bytes);

    out = houseSend(t.house, { object: 'lantern' })!;
    t.house = out.state;
    t.deliver('other', out.bytes);

    // Step 2: wrong key, then the right one.
    out = otherSend(t.other, { key: 'moon' })!;
    t.other = out.state;
    t.deliver('house', out.bytes);
    out = houseSend(t.house, {})!;
    t.house = out.state;
    t.deliver('other', out.bytes);
    out = otherSend(t.other, { key: 'star' })!;
    t.other = out.state;
    t.deliver('house', out.bytes);

    // Step 3: wrong rune, then the right one.
    out = houseSend(t.house, { rune: RUNES[3].blocks })!;
    t.house = out.state;
    t.deliver('other', out.bytes);
    out = otherSend(t.other)!;
    t.other = out.state;
    t.deliver('house', out.bytes);
    expect(t.house.house?.phase).toBe('faded'); // three mistakes = three candles

    expect(t.events).toEqual([
      'arrived-object-failed', 'object-failed',
      'arrived-object-worked', 'key-wrong',
      'arrived-key-retry', 'door-opened',
      'arrived-rune-failed', 'rune-failed',
    ]);
  });

  it('a perfect run frees the ghost on both devices and keeps the original drawing', () => {
    const t = newTable();
    let out = houseStart(t.house, ghostGrid(), 'Boo', 7, { object: 'lantern' }, zero, 0)!;
    t.house = out.state;
    t.deliver('other', out.bytes);
    out = otherSend(t.other, { key: 'star' })!;
    t.other = out.state;
    t.deliver('house', out.bytes);
    out = houseSend(t.house, { rune: RUNES[0].blocks })!;
    t.house = out.state;
    t.deliver('other', out.bytes);
    out = otherSend(t.other)!;
    t.other = out.state;
    t.deliver('house', out.bytes);

    expect(t.events).toEqual(['arrived-object-worked', 'door-opened', 'arrived-rune-worked', 'freed']);
    expect(t.house.house).toMatchObject({ phase: 'free', energy: 3, grid: ghostGrid() });
    expect(t.other.other).toMatchObject({ phase: 'over', ended: 'free' });
  });

  it('a returning ghost the House never released opens nothing (R5.7)', () => {
    const house = houseStart(initialState('house', 1, zero), ghostGrid(), 'Mine', 1, { object: 'lantern' }, zero, 0)!.state;
    const strangerHouse = houseStart(initialState('house', 2, zero), ghostGrid(), 'Other', 2, { object: 'lantern' }, zero, 0)!;
    const other = receive(initialState('other', 3, zero), hear(strangerHouse.bytes), 0).state;
    const back = otherSend(other, { key: 'star' })!;
    const r = receive(house, hear(back.bytes), 0);
    expect(r.event.type).toBe('not-ours');
    expect(r.state.house?.phase).toBe('away');
  });
});

describe('duplicates and retries (R4)', () => {
  it('hearing the same chirp twice changes nothing the second time', () => {
    const out = houseStart(initialState('house', 0, zero), ghostGrid(), 'Boo', 5, { object: 'bell' }, zero, 0)!;
    const first = receive(initialState('other', 50, zero), hear(out.bytes), 0);
    const second = receive(first.state, hear(out.bytes), 0);
    expect(second.event.type).toBe('duplicate');
    expect(second.state).toBe(first.state);
    expect(first.state.other?.energy).toBe(2); // the wrong object cost exactly one candle
  });

  it('Resend replays byte-identical data', () => {
    const out = houseStart(initialState('house', 0, zero), ghostGrid(), 'Boo', 5, { object: 'bell' }, zero, 0)!;
    expect(Array.from(resendBytes(out.state)!)).toEqual(Array.from(out.bytes));
  });

  it('a correct key heard three times opens the door once', () => {
    const t = newTable();
    let out = houseStart(t.house, ghostGrid(), 'Boo', 9, { object: 'lantern' }, zero, 0)!;
    t.house = out.state;
    t.deliver('other', out.bytes);
    out = otherSend(t.other, { key: 'star' })!;
    t.other = out.state;
    expect(otherSend(t.other, { key: 'star' })).toBeNull(); // once per arrival; use Resend
    t.deliver('house', out.bytes);
    t.deliver('house', resendBytes(t.other)!);
    t.deliver('house', out.bytes);
    expect(t.events).toEqual(['arrived-object-worked', 'door-opened', 'duplicate', 'duplicate']);
    expect(t.house.house?.phase).toBe('rune');
  });

  it('a device ignores its own signal (R3.3, R4.3)', () => {
    const out = houseStart(initialState('house', 0, zero), ghostGrid(), 'Boo', 5, { object: 'bell' }, zero, 0)!;
    const r = receive(out.state, hear(out.bytes), 0);
    expect(r.event.type).toBe('own-echo');
    expect(r.state).toBe(out.state);
  });

  it('property: replays never produce extra accepted events', () => {
    fc.assert(
      fc.property(fc.array(messageArb, { minLength: 1, maxLength: 8 }), fc.array(fc.nat(), { maxLength: 30 }), (msgs, order) => {
        for (const role of ['house', 'other'] as const) {
          let s: GameState = initialState(role, 0, zero);
          let accepted = 0;
          const keys = new Set<string>();
          for (const i of [...order, ...msgs.keys()]) {
            const m = msgs[i % msgs.length];
            keys.add(transferKey(m));
            const r = receive(s, m, 0);
            if (r.event.type !== 'duplicate' && r.event.type !== 'own-echo') accepted++;
            s = r.state;
          }
          expect(accepted).toBe(keys.size);
        }
      }),
    );
  });
});

describe('refresh recovery (R4.4)', () => {
  it('state survives save/load, so a replay after refresh is still a duplicate', () => {
    fc.assert(
      fc.property(gridArb, nameArb, fc.integer({ min: 0, max: 0xffff }), (grid, name, id) => {
        const store = memoryStore();
        const out = houseStart(initialState('house', 0, zero), grid, name, id, { object: 'mirror' }, zero, 0)!;
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
    const house = houseStart(initialState('house', 0, zero), ghostGrid(), 'Boo', 3, { object: 'bell' }, zero, 0)!.state;
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
    store.setItem(storageKey('house'), JSON.stringify({ v: 2, seen: [], sent: [] }));
    expect(loadState(store, 'house', 4, zero)).toEqual(initialState('house', 4, zero));
  });

  it('play again rolls a new haunted room but remembers heard chirps', () => {
    const s = { ...initialState('other', 0, zero), seen: ['1:2:0'] };
    const n = newGame(s, () => 0.99);
    expect(n.other?.room).toEqual({ obstacle: 2, rune: 5 });
    expect(n.seen).toEqual(['1:2:0']);
  });
});
