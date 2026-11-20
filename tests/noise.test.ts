import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { FLIPS, noisyDrawing, noisyText } from '../src/game/noise';
import { cleanText } from '../src/protocol/packet';
import { gridArb16, noiseArb, textArb } from './arbitraries';

const id = fc.integer({ min: 0, max: 0xffff });
const step = fc.integer({ min: 1, max: 8 });

describe('line static (R3.3, R3.4)', () => {
  it('is deterministic: the same game, step and level always garble the same way', () => {
    fc.assert(
      fc.property(gridArb16, textArb, id, step, noiseArb, (g, t, gid, k, lvl) => {
        expect(noisyDrawing(g, gid, k, lvl)).toEqual(noisyDrawing(g, gid, k, lvl));
        expect(noisyText(t, gid, k, lvl)).toEqual(noisyText(t, gid, k, lvl));
      }),
    );
  });

  it('flips exactly the documented number of distinct squares, and only those', () => {
    fc.assert(
      fc.property(gridArb16, id, step, noiseArb, (g, gid, k, lvl) => {
        const r = noisyDrawing(g, gid, k, lvl);
        expect(new Set(r.flipped).size).toBe(FLIPS[lvl]);
        let diff = 0;
        for (let i = 0; i < 256; i++) if (r.grid[i >> 4][i & 15] !== g[i >> 4][i & 15]) diff++;
        expect(diff).toBe(FLIPS[lvl]);
        for (const i of r.flipped) expect(r.grid[i >> 4][i & 15]).toBe(!g[i >> 4][i & 15]);
      }),
    );
  });

  it('a clear line changes nothing', () => {
    fc.assert(
      fc.property(gridArb16, textArb, id, step, (g, t, gid, k) => {
        expect(noisyDrawing(g, gid, k, 0)).toEqual({ grid: g, flipped: [] });
        expect(noisyText(t, gid, k, 0)).toEqual({ text: t, changed: [] });
      }),
    );
  });

  it('garbled guesses stay valid text, change only letters, and change the documented count', () => {
    fc.assert(
      fc.property(textArb, id, step, noiseArb, (t, gid, k, lvl) => {
        const r = noisyText(t, gid, k, lvl);
        expect(r.text.length).toBe(t.length);
        expect(cleanText(r.text)).toBe(r.text);
        for (let i = 0; i < t.length; i++) {
          if (r.changed.includes(i)) {
            expect(/[a-z]/i.test(t[i])).toBe(true);
            expect(/[a-z]/i.test(r.text[i])).toBe(true);
            expect(r.text[i].toLowerCase()).not.toBe(t[i].toLowerCase());
          } else expect(r.text[i]).toBe(t[i]);
        }
        const letters = [...t].filter((c) => /[a-z]/i.test(c)).length;
        if (lvl === 2 && letters > 0) expect(r.changed.length).toBe(letters >= 6 ? 2 : 1);
        if (lvl === 1) expect(r.changed.length).toBeLessThanOrEqual(1);
      }),
    );
  });

  it('crackly changes a letter on roughly half of the hops', () => {
    let changed = 0;
    for (let gid = 0; gid < 400; gid++) if (noisyText('pumpkin', gid, 2, 1).changed.length) changed++;
    expect(changed).toBeGreaterThan(120);
    expect(changed).toBeLessThan(280);
  });

  it('different hops get different static', () => {
    const g = Array.from({ length: 16 }, () => Array<boolean>(16).fill(false));
    const patterns = new Set(Array.from({ length: 8 }, (_, k) => noisyDrawing(g, 42, k + 1, 1).flipped.join(',')));
    expect(patterns.size).toBe(8);
  });
});
