import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { emptyGrid, packGrid, unpackGrid } from '../src/protocol/drawing';
import { gridArb } from './arbitraries';

describe('drawing pack/unpack (R2.1)', () => {
  it('packs any 8×8 grid into exactly 8 bytes and back, unchanged', () => {
    fc.assert(
      fc.property(gridArb, (grid) => {
        const bytes = packGrid(grid);
        expect(bytes.length).toBe(8);
        expect(unpackGrid(bytes)).toEqual(grid);
      }),
    );
  });

  it('uses row-major order with bit 7 as the leftmost column', () => {
    const g = emptyGrid();
    g[0][0] = true;
    g[7][7] = true;
    g[3][4] = true;
    expect(Array.from(packGrid(g))).toEqual([0x80, 0, 0, 0x08, 0, 0, 0, 0x01]);
  });

  it('rejects grids that are not 8×8', () => {
    expect(() => packGrid([[true]])).toThrow();
    expect(() => unpackGrid(new Uint8Array(7))).toThrow();
  });
});
