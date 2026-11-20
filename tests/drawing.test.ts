import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { emptyGrid, packGrid, unpackGrid } from '../src/protocol/drawing';
import { gridArb, gridArb16 } from './arbitraries';

describe('drawing pack/unpack', () => {
  it('8×8 packs into 8 bytes and back, unchanged', () => {
    fc.assert(
      fc.property(gridArb, (grid) => {
        const bytes = packGrid(grid);
        expect(bytes.length).toBe(8);
        expect(unpackGrid(bytes)).toEqual(grid);
      }),
    );
  });

  it('16×16 packs into 32 bytes and back, unchanged', () => {
    fc.assert(
      fc.property(gridArb16, (grid) => {
        const bytes = packGrid(grid);
        expect(bytes.length).toBe(32);
        expect(unpackGrid(bytes, 16)).toEqual(grid);
      }),
    );
  });

  it('uses row-major order with bit 7 as the leftmost column', () => {
    const g = emptyGrid();
    g[0][0] = true;
    g[7][7] = true;
    g[3][4] = true;
    expect(Array.from(packGrid(g))).toEqual([0x80, 0, 0, 0x08, 0, 0, 0, 0x01]);
    const h = emptyGrid(16);
    h[0][9] = true; // second byte of row 0, bit 6
    expect(Array.from(packGrid(h)).slice(0, 2)).toEqual([0, 0x40]);
  });

  it('rejects grids that are not square multiples of 8', () => {
    expect(() => packGrid([[true]])).toThrow();
    expect(() => unpackGrid(new Uint8Array(7))).toThrow();
    expect(() => unpackGrid(new Uint8Array(8), 16)).toThrow();
  });
});
