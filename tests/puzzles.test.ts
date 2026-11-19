import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { hatPuzzle, lockPuzzle, LOCK_HINTS, obeysRule, personalityOf, PERSONALITIES, ruleText, seeded, solveHat, solveLock } from '../src/game/puzzles';
import { allLines, reaction } from '../src/game/reactions';
import {
  blockDistance,
  describeRune,
  gridToRune,
  KEYS,
  mirrorRune,
  OBJECTS,
  OBSTACLES,
  RUNE_TOLERANCE,
  RUNES,
  runeToGrid,
  SPOTS,
} from '../src/game/rules';
import { runeArb } from './arbitraries';

const ghostId = fc.integer({ min: 0, max: 0xffff });

describe('personality (R5.1)', () => {
  it('is deterministic: the same ghost ID always gives the same personality', () => {
    fc.assert(
      fc.property(ghostId, (id) => {
        expect(personalityOf(id)).toBe(personalityOf(id));
      }),
    );
  });

  it('all four personalities occur', () => {
    const seen = new Set(Array.from({ length: 400 }, (_, i) => personalityOf(i)));
    expect([...seen].sort()).toEqual([...PERSONALITIES].sort());
  });

  it('reactions use the ghost name, stay short, and are deterministic', () => {
    for (const p of PERSONALITIES) {
      for (const m of ['arrive', 'solved', 'wrong', 'lastCandle', 'rescued', 'farewell', 'faded', 'hat'] as const) {
        const line = reaction(p, m, 'BOO', 3);
        expect(line).toContain('BOO');
        expect(line).toBe(reaction(p, m, 'BOO', 3));
      }
    }
    for (const l of allLines()) expect(l.length).toBeLessThanOrEqual(80);
  });
});

describe('the lock: guaranteed-solvable deduction (R6.2)', () => {
  it('for every ghost ID, exactly one key fits both halves, and it is the answer', () => {
    fc.assert(
      fc.property(ghostId, (id) => {
        const p = lockPuzzle(id);
        expect(solveLock(p)).toEqual([p.answer]);
      }),
      { numRuns: 2000 },
    );
  });

  it("neither half alone is enough: teeth leave two keys, metal leaves at least two", () => {
    fc.assert(
      fc.property(ghostId, (id) => {
        const p = lockPuzzle(id);
        const byTeeth = KEYS.filter((k) => p.keys[k].teeth === p.notches);
        const byMetal = KEYS.filter((k) => obeysRule(p, p.keys[k].metal));
        expect(byTeeth).toHaveLength(2);
        expect(byMetal.length).toBeGreaterThanOrEqual(2);
      }),
      { numRuns: 2000 },
    );
  });

  it('is the same on both devices (built from the ghost ID only) and uses sensible values', () => {
    fc.assert(
      fc.property(ghostId, (id) => {
        const p = lockPuzzle(id);
        expect(lockPuzzle(id)).toEqual(p);
        expect(p.notches).toBeGreaterThanOrEqual(1);
        expect(p.notches).toBeLessThanOrEqual(4);
        for (const k of KEYS) expect([1, 2, 3, 4]).toContain(p.keys[k].teeth);
        expect(ruleText(p)).toMatch(/SILVER|GOLD/);
      }),
    );
  });

  it("the House's clue text never names a key symbol", () => {
    for (let id = 0; id < 50; id++) {
      const text = ruleText(lockPuzzle(id)) + LOCK_HINTS.join(' ');
      for (const k of ['Star', 'Moon', 'Skull', 'Heart', '★', '☾', '☠', '♥']) expect(text).not.toContain(k);
    }
  });
});

describe('the hat (R6.4)', () => {
  it('each clue names two spots; exactly one spot is on both lists and it is the answer', () => {
    fc.assert(
      fc.property(ghostId, (id) => {
        const p = hatPuzzle(id);
        expect(new Set(p.houseClue).size).toBe(2);
        expect(new Set(p.otherClue).size).toBe(2);
        expect(solveHat(p)).toEqual([p.answer]);
        for (const s of [...p.houseClue, ...p.otherClue]) expect(SPOTS).toContain(s);
      }),
    );
  });
});

describe('the lying mirror (R6.3)', () => {
  it('mirroring twice gives the original; mirroring swaps columns, keeps rows', () => {
    fc.assert(
      fc.property(runeArb, (r) => {
        expect(mirrorRune(mirrorRune(r))).toEqual(r);
        const m = mirrorRune(r);
        for (let row = 0; row < 4; row++) for (let c = 0; c < 4; c++) expect(m[row][c]).toBe(r[row][3 - c]);
      }),
    );
  });

  it('every rune is asymmetric: painting the mirror image unflipped always fails', () => {
    for (const r of RUNES) {
      expect(blockDistance(r.blocks, mirrorRune(r.blocks))).toBeGreaterThanOrEqual(4);
      expect(blockDistance(r.blocks, mirrorRune(r.blocks))).toBeGreaterThan(RUNE_TOLERANCE);
    }
  });

  it('runes are clearly different from each other (and from each other\'s reflections)', () => {
    for (const a of RUNES) {
      for (const b of RUNES) {
        if (a === b) continue;
        expect(blockDistance(a.blocks, b.blocks)).toBeGreaterThan(2 * RUNE_TOLERANCE);
        expect(blockDistance(a.blocks, mirrorRune(b.blocks))).toBeGreaterThan(RUNE_TOLERANCE);
      }
    }
  });

  it('a rune survives the trip through the 8×8 drawing slot', () => {
    fc.assert(
      fc.property(runeArb, (rune) => {
        expect(gridToRune(runeToGrid(rune))).toEqual(rune);
      }),
    );
  });

  it('describes runes row by row for screen readers', () => {
    expect(describeRune(RUNES[0].blocks)).toMatch(/^Row 1: filled, empty, empty, empty\. Row 2: filled, filled/);
  });
});

describe('rules data', () => {
  it('every obstacle needs a different object, and every object solves one obstacle', () => {
    expect(new Set(OBSTACLES.map((o) => o.needs)).size).toBe(OBSTACLES.length);
    for (const o of OBJECTS) expect(OBSTACLES.some((x) => x.needs === o)).toBe(true);
  });

  it('the seeded RNG is deterministic and in [0, 1)', () => {
    const a = seeded(42);
    const b = seeded(42);
    for (let i = 0; i < 100; i++) {
      const x = a();
      expect(x).toBe(b());
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });
});
