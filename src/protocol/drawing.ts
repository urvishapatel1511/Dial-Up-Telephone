/** Square 1-bit drawing. grid[row][col] === true means an ink pixel. */
export type Grid = boolean[][];

export const SIZE = 8;

export function emptyGrid(size = SIZE): Grid {
  return Array.from({ length: size }, () => Array<boolean>(size).fill(false));
}

/** n×n grid (n a multiple of 8) → bytes. Row-major, n/8 bytes per row, bit 7 = leftmost pixel. */
export function packGrid(grid: Grid): Uint8Array {
  const n = grid.length;
  if (n === 0 || n % 8 !== 0 || grid.some((row) => row.length !== n)) throw new Error('grid must be square with a side that is a multiple of 8');
  const per = n / 8;
  const out = new Uint8Array(n * per);
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (grid[r][c]) out[r * per + (c >> 3)] |= 0x80 >> (c & 7);
  return out;
}

export function unpackGrid(bytes: Uint8Array, size = SIZE): Grid {
  const per = size / 8;
  if (size % 8 !== 0 || bytes.length !== size * per) throw new Error(`drawing must be ${size * per} bytes`);
  return Array.from({ length: size }, (_, r) =>
    Array.from({ length: size }, (_, c) => (bytes[r * per + (c >> 3)] & (0x80 >> (c & 7))) !== 0),
  );
}
