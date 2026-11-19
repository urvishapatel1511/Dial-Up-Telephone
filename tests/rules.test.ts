import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { houseReceive, houseRelease, newHouse, type House } from '../src/game/house';
import { newOther, otherReceive, otherReturn, type Other } from '../src/game/other';
import {
  blockDistance,
  gridToRune,
  OBJECTS,
  OBSTACLES,
  RUNE_TOLERANCE,
  RUNES,
  runeToGrid,
} from '../src/game/rules';
import { emptyGrid, type Grid } from '../src/protocol/drawing';
import type { GhostMessage } from '../src/protocol/message';
import { gridArb, runeArb } from './arbitraries';

const ghost = (): Grid => {
  const g = emptyGrid();
  g[2][2] = g[2][5] = true;
  return g;
};

const msg = (over: Partial<GhostMessage>): GhostMessage => ({
  direction: 'return',
  stage: 1,
  item: 'none',
  energy: 3,
  ok: false,
  ghostId: 42,
  transferId: 1,
  grid: ghost(),
  name: 'Boo',
  ...over,
});

/** House with keyhole 'star' (random = 0), already away on `stage`. */
function awayHouse(stage: 1 | 2 | 3, over: Partial<House> = {}): House {
  return { ...newHouse(42, 'Boo', ghost(), () => 0, 0), phase: 'away', inFlight: stage, ...over };
}

/** Other Side whose obstacle is darkness (needs lantern) and rune is RUNES[0]. */
function room(): Other {
  return newOther({ obstacle: 0, rune: 0 });
}

function flipBlocks(blocks: boolean[][], n: number): boolean[][] {
  const out = blocks.map((r) => [...r]);
  for (let i = 0; i < n; i++) out[i >> 2][i & 3] = !out[i >> 2][i & 3];
  return out;
}

describe('rules data', () => {
  it('every obstacle needs a different object, and every object solves one obstacle', () => {
    expect(new Set(OBSTACLES.map((o) => o.needs)).size).toBe(OBSTACLES.length);
    for (const o of OBJECTS) expect(OBSTACLES.some((x) => x.needs === o)).toBe(true);
  });

  it('runes are clearly different: no two match within tolerance, even with one mistake each', () => {
    for (const a of RUNES) for (const b of RUNES) if (a !== b) {
      expect(blockDistance(a.blocks, b.blocks)).toBeGreaterThan(2 * RUNE_TOLERANCE);
    }
  });

  it('a rune survives the trip through the 8×8 drawing slot', () => {
    fc.assert(
      fc.property(runeArb, (rune) => {
        expect(gridToRune(runeToGrid(rune))).toEqual(rune);
      }),
    );
  });

  it('block distance is zero to itself and symmetric', () => {
    fc.assert(
      fc.property(gridArb, gridArb, (a, b) => {
        const ra = gridToRune(a);
        const rb = gridToRune(b);
        expect(blockDistance(ra, ra)).toBe(0);
        expect(blockDistance(ra, rb)).toBe(blockDistance(rb, ra));
      }),
    );
  });
});

describe('House', () => {
  it('needs an object to start, then the ghost is away on stage 1', () => {
    const h = newHouse(1, 'A', ghost(), () => 0, 0);
    expect(houseRelease(h, {})).toBeNull();
    const r = houseRelease(h, { object: 'bell' })!;
    expect(r.draft).toMatchObject({ stage: 1, item: 'bell', energy: 3 });
    expect(r.house.phase).toBe('away');
    expect(houseRelease(r.house, { object: 'bell' })).toBeNull(); // can't send while away
  });

  it('copies the drawing so later edits cannot change it', () => {
    const g = ghost();
    const h = newHouse(1, 'A', g, Math.random, 0);
    g[0][0] = true;
    expect(h.grid[0][0]).toBe(false);
  });

  it('the right key opens the door; a wrong key costs a candle', () => {
    const wrong = houseReceive(awayHouse(1), msg({ item: 'moon' }), 5);
    expect(wrong.outcome).toEqual({ kind: 'key-wrong', key: 'moon', faded: false });
    expect(wrong.house).toMatchObject({ phase: 'key-retry', energy: 2 });

    const back = houseRelease(wrong.house, {})!;
    expect(back.draft).toMatchObject({ stage: 2, energy: 2 });

    const right = houseReceive(back.house, msg({ stage: 2, item: 'star', energy: 2 }), 6);
    expect(right.outcome).toEqual({ kind: 'door-opened', key: 'star' });
    expect(right.house.phase).toBe('rune');
  });

  it('an empty-handed return means the object failed; the energy the Other Side reports is kept', () => {
    const r = houseReceive(awayHouse(1), msg({ item: 'none', energy: 2 }), 1);
    expect(r.outcome).toEqual({ kind: 'object-failed', faded: false });
    expect(r.house).toMatchObject({ phase: 'object', energy: 2 });
  });

  it('the rune is sent as 2×2 blocks in the drawing slot, and the original drawing is kept', () => {
    const h = { ...awayHouse(1), phase: 'rune' as const };
    const r = houseRelease(h, { rune: RUNES[2].blocks })!;
    expect(r.draft.stage).toBe(3);
    expect(gridToRune(r.draft.grid)).toEqual(RUNES[2].blocks);
    expect(r.house.grid).toEqual(ghost());
  });

  it('stage 3: ok frees the ghost; not ok means repaint', () => {
    expect(houseReceive(awayHouse(3), msg({ stage: 3, ok: true }), 9).house).toMatchObject({ phase: 'free', endedAt: 9 });
    expect(houseReceive(awayHouse(3), msg({ stage: 3, ok: false, energy: 1 }), 9).house).toMatchObject({
      phase: 'rune',
      energy: 1,
    });
  });

  it('the ghost fades when the last candle goes out', () => {
    const r = houseReceive(awayHouse(1, { energy: 1 }), msg({ item: 'heart', energy: 1 }), 3);
    expect(r.outcome).toEqual({ kind: 'key-wrong', key: 'heart', faded: true });
    expect(r.house).toMatchObject({ phase: 'faded', energy: 0 });
    expect(houseRelease(r.house, {})!.draft.energy).toBe(0); // farewell tells the Other Side
  });

  it('answers for another stage are ignored', () => {
    const h = awayHouse(3);
    const r = houseReceive(h, msg({ stage: 1, item: 'star' }), 0);
    expect(r.outcome.kind).toBe('ignored');
    expect(r.house).toBe(h);
  });
});

describe('Other Side', () => {
  const release = (over: Partial<GhostMessage>) => msg({ direction: 'release', ...over });

  it('the right object clears the room and reveals the keys', () => {
    const r = otherReceive(room(), release({ item: 'lantern' }));
    expect(r.outcome).toEqual({ kind: 'arrived-object-worked', object: 'lantern' });
    expect(r.other).toMatchObject({ phase: 'keys', cleared: true, energy: 3 });
    expect(r.other.ghost?.grid).toEqual(ghost());
  });

  it('the wrong object costs a candle, and the ghost must go home empty-handed', () => {
    const r = otherReceive(room(), release({ item: 'bell' }));
    expect(r.outcome).toEqual({ kind: 'arrived-object-failed', object: 'bell', faded: false });
    expect(r.other).toMatchObject({ phase: 'blocked', energy: 2 });
    const back = otherReturn(r.other, {})!;
    expect(back.draft).toMatchObject({ stage: 1, item: 'none', energy: 2 });
  });

  it('must choose a key before sending', () => {
    const o = otherReceive(room(), release({ item: 'lantern' })).other;
    expect(otherReturn(o, {})).toBeNull();
    expect(otherReturn(o, { key: 'moon' })!.draft).toMatchObject({ stage: 1, item: 'moon' });
  });

  it('checks the painted rune with 1 block of tolerance', () => {
    const o = otherReceive(room(), release({ item: 'lantern' })).other;
    const ok = otherReceive(o, release({ stage: 3, grid: runeToGrid(flipBlocks(RUNES[0].blocks, 1)) }));
    expect(ok.outcome.kind).toBe('arrived-rune-worked');
    expect(otherReturn(ok.other, {})!.draft).toMatchObject({ stage: 3, ok: true });

    const bad = otherReceive(o, release({ stage: 3, grid: runeToGrid(flipBlocks(RUNES[0].blocks, 2)) }));
    expect(bad.outcome).toEqual({ kind: 'arrived-rune-failed', off: 2, faded: false });
    expect(bad.other.energy).toBe(2);
  });

  it('keeps showing the original ghost, not the rune it wears', () => {
    const o = otherReceive(room(), release({ item: 'lantern' })).other;
    const r = otherReceive(o, release({ stage: 3, grid: runeToGrid(RUNES[0].blocks) }));
    expect(r.other.ghost?.grid).toEqual(ghost());
  });

  it('a ghost with no energy left arrives faded', () => {
    const o = otherReceive(room(), release({ item: 'lantern' })).other;
    const r = otherReceive(o, release({ stage: 2, energy: 0 }));
    expect(r.outcome.kind).toBe('arrived-faded');
    expect(r.other).toMatchObject({ phase: 'over', ended: 'faded' });
  });

  it('ignores a stage 2/3 release from a ghost it has never met', () => {
    expect(otherReceive(room(), release({ stage: 3 })).outcome.kind).toBe('ignored');
  });
});
