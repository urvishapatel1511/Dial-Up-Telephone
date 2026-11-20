import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { FLIPS, noisyDrawing, noisyText, TWISTS } from '../src/game/noise';
import { cleanText } from '../src/protocol/packet';
import { gridArb16, noiseArb, textArb } from './arbitraries';

const id = fc.integer({ min: 0, max: 0xffff });
const step = fc.integer({ min: 1, max: 8 });

describe('drawing static (R3.3)', () => {
  it('is deterministic per round, step, and level', () => {
    fc.assert(
      fc.property(gridArb16, id, step, noiseArb, (g, gid, k, lvl) => {
        expect(noisyDrawing(g, gid, k, lvl)).toEqual(noisyDrawing(g, gid, k, lvl));
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

  it('different hops get different static', () => {
    const g = Array.from({ length: 16 }, () => Array<boolean>(16).fill(false));
    const patterns = new Set(Array.from({ length: 8 }, (_, k) => noisyDrawing(g, 42, k + 1, 1).flipped.join(',')));
    expect(patterns.size).toBe(8);
  });
});

describe('text static (R3.1, R3.2)', () => {
  it('a clear line changes nothing', () => {
    fc.assert(
      fc.property(gridArb16, textArb, id, step, (g, t, gid, k) => {
        expect(noisyDrawing(g, gid, k, 0)).toEqual({ grid: g, flipped: [] });
        expect(noisyText(t, gid, k, 0)).toEqual({ text: t, changed: [], kind: 'none' });
      }),
    );
  });

  it('is deterministic, always valid text of ≤ 12 characters, and its kind matches what happened', () => {
    fc.assert(
      fc.property(textArb, id, step, noiseArb, (t, gid, k, lvl) => {
        const r = noisyText(t, gid, k, lvl);
        expect(noisyText(t, gid, k, lvl)).toEqual(r);
        expect(cleanText(r.text)).toBe(r.text);
        expect(r.kind === 'none').toBe(r.text === t);
        if (r.changed.length) {
          expect(r.text.length).toBe(t.length);
          for (let i = 0; i < t.length; i++) expect(r.changed.includes(i)).toBe(r.text[i] !== t[i]);
        }
      }),
    );
  });

  it('Haunted always changes a clue that has letters', () => {
    fc.assert(
      fc.property(textArb, id, step, (t, gid, k) => {
        if (!/[a-z]/i.test(t)) return;
        expect(noisyText(t, gid, k, 2).kind).not.toBe('none');
      }),
    );
  });

  it('prefers curated, recognizable twists: CAT becomes BAT, HAT, CAR, or CAP', () => {
    const seen = new Set<string>();
    for (let gid = 0; gid < 300; gid++) {
      const r = noisyText('CAT', gid, 2, 1);
      if (r.kind === 'none') continue;
      expect(r.kind).toBe('twist');
      seen.add(r.text);
    }
    expect([...seen].every((w) => TWISTS.cat.map((x) => x.toUpperCase()).includes(w))).toBe(true);
    expect(seen.size).toBeGreaterThan(1);
  });

  it('every curated word gets a curated twist on a Crackly line, keeping its case style', () => {
    for (const word of Object.keys(TWISTS)) {
      for (let gid = 0; gid < 20; gid++) {
        const r = noisyText(word[0].toUpperCase() + word.slice(1), gid, 4, 1);
        if (r.kind === 'none') continue;
        expect(r.kind).toBe('twist');
        expect(TWISTS[word].map((w) => w[0].toUpperCase() + w.slice(1))).toContain(r.text);
      }
    }
  });

  it('twists inside phrases keep the other words: "ghost taxi"', () => {
    for (let gid = 0; gid < 50; gid++) {
      const r = noisyText('ghost taxi', gid, 2, 1);
      if (r.kind === 'none') continue;
      const [a, b] = r.text.split(' ');
      expect(a === 'ghost' || b === 'taxi').toBe(true);
    }
  });

  it('words with no known twist fall back to a one-letter word change, then a nonsense letter', () => {
    const r = noisyText('qxzj', 5, 2, 2);
    expect(r.kind).toBe('letters');
    expect(r.text).not.toBe('qxzj');
  });

  it('curated twists are valid, distinct from their source, and fit in 12 characters', () => {
    for (const [from, list] of Object.entries(TWISTS)) {
      for (const to of list) {
        expect(cleanText(to)).toBe(to);
        expect(to).not.toBe(from);
      }
    }
  });

  it('Crackly changes roughly half of the hops', () => {
    let changed = 0;
    for (let gid = 0; gid < 400; gid++) if (noisyText('pumpkin', gid, 2, 1).kind !== 'none') changed++;
    expect(changed).toBeGreaterThan(120);
    expect(changed).toBeLessThan(280);
  });
});
