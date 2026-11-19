/** 8×8 1-bit drawing. grid[row][col] === true means an ink pixel. */
export type Grid = boolean[][];

export const SIZE = 8;

export function emptyGrid(): Grid {
  return Array.from({ length: SIZE }, () => Array<boolean>(SIZE).fill(false));
}

/** Row-major, one byte per row, bit 7 = column 0. */
export function packGrid(grid: Grid): Uint8Array {
  if (grid.length !== SIZE || grid.some((row) => row.length !== SIZE)) {
    throw new Error('grid must be 8×8');
  }
  const out = new Uint8Array(SIZE);
  for (let r = 0; r < SIZE; r++) {
    let byte = 0;
    for (let c = 0; c < SIZE; c++) {
      if (grid[r][c]) byte |= 0x80 >> c;
    }
    out[r] = byte;
  }
  return out;
}

export function unpackGrid(bytes: Uint8Array): Grid {
  if (bytes.length !== SIZE) throw new Error('drawing must be 8 bytes');
  return Array.from({ length: SIZE }, (_, r) =>
    Array.from({ length: SIZE }, (_, c) => (bytes[r] & (0x80 >> c)) !== 0),
  );
}
