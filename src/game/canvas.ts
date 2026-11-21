import { emptyGrid, type Grid } from '../protocol/drawing';

/**
 * Drawing model with stroke-level undo/redo. Pure (no DOM).
 *
 * There is no pen/eraser tool: the square where a stroke starts decides it.
 * Starting on an empty square paints, starting on a filled square erases, and
 * that mode stays fixed until the stroke ends. Setting a fixed value is
 * idempotent, so revisiting a square never toggles it back.
 */
export type Brush = 'small' | 'large';

export const UNDO_LIMIT = 50;

export interface Canvas {
  grid: Grid;
  undo: Grid[];
  redo: Grid[];
  /** Snapshot taken at the start of the stroke in progress (null when idle). */
  before: Grid | null;
  /** The stroke's operation: true paints, false erases (null when idle). */
  mode: boolean | null;
  /** Last square the stroke reached, to fill gaps on fast drags. */
  last: [number, number] | null;
}

const copy = (g: Grid): Grid => g.map((r) => [...r]);
const same = (a: Grid, b: Grid) => a.every((row, r) => row.every((v, c) => v === b[r][c]));
const inside = (r: number, c: number, size: number) => r >= 0 && c >= 0 && r < size && c < size;

export function newCanvas(size = 16): Canvas {
  return { grid: emptyGrid(size), undo: [], redo: [], before: null, mode: null, last: null };
}

export const isEmpty = (g: Grid) => !g.some((r) => r.some(Boolean));
export const isStroking = (cv: Canvas) => cv.mode !== null;

/** Squares covered by the brush at (r, c): 1 square, or a 3×3 block clipped to the grid. */
export function brushCells(r: number, c: number, size: number, brush: Brush): [number, number][] {
  if (brush === 'small') return inside(r, c, size) ? [[r, c]] : [];
  const out: [number, number][] = [];
  for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) if (inside(r + dr, c + dc, size)) out.push([r + dr, c + dc]);
  return out;
}

/** Squares on the straight line from a to b (inclusive), so a fast drag leaves no gaps. */
export function lineCells(a: [number, number], b: [number, number]): [number, number][] {
  const out: [number, number][] = [];
  let [r, c] = a;
  const [r1, c1] = b;
  const dr = Math.abs(r1 - r);
  const dc = Math.abs(c1 - c);
  const sr = r < r1 ? 1 : -1;
  const sc = c < c1 ? 1 : -1;
  let err = dc - dr;
  for (;;) {
    out.push([r, c]);
    if (r === r1 && c === c1) return out;
    const e2 = 2 * err;
    if (e2 > -dr) {
      err -= dr;
      c += sc;
    }
    if (e2 < dc) {
      err += dc;
      r += sr;
    }
  }
}

function setCells(cv: Canvas, cells: [number, number][], value: boolean): Canvas {
  if (cells.every(([y, x]) => cv.grid[y][x] === value)) return cv;
  const grid = copy(cv.grid);
  for (const [y, x] of cells) grid[y][x] = value;
  return { ...cv, grid };
}

/** Start a stroke at (r, c). The start square decides: empty → paint, filled → erase. */
export function beginStroke(cv: Canvas, r: number, c: number, brush: Brush): Canvas {
  const size = cv.grid.length;
  if (!inside(r, c, size)) return cv;
  const base = isStroking(cv) ? endStroke(cv) : cv;
  const mode = !base.grid[r][c];
  return setCells({ ...base, before: copy(base.grid), mode, last: [r, c] }, brushCells(r, c, size, brush), mode);
}

/** Continue the stroke to (r, c) with the stroke's fixed mode. Outside the grid is ignored. */
export function strokeTo(cv: Canvas, r: number, c: number, brush: Brush): Canvas {
  const size = cv.grid.length;
  if (!isStroking(cv) || !inside(r, c, size)) return cv;
  const from = cv.last ?? [r, c];
  if (from[0] === r && from[1] === c) return cv;
  const cells = lineCells(from, [r, c]).flatMap(([y, x]) => brushCells(y, x, size, brush));
  return { ...setCells(cv, cells, cv.mode!), last: [r, c] };
}

/** Finish the stroke: one undo step if anything changed. A new action clears redo. */
export function endStroke(cv: Canvas): Canvas {
  if (!cv.before) return { ...cv, mode: null, last: null };
  const idle = { ...cv, before: null, mode: null, last: null };
  if (same(cv.before, cv.grid)) return idle;
  return { ...idle, undo: [...cv.undo, cv.before].slice(-UNDO_LIMIT), redo: [] };
}

/** One keyboard action (Space/Enter): toggle the square, or its brush footprint, as one undo step. */
export function toggle(cv: Canvas, r: number, c: number, brush: Brush): Canvas {
  return endStroke(beginStroke(cv, r, c, brush));
}

export function undo(cv: Canvas): Canvas {
  const settled = isStroking(cv) ? endStroke(cv) : cv;
  const prev = settled.undo[settled.undo.length - 1];
  if (!prev) return settled;
  return { grid: copy(prev), undo: settled.undo.slice(0, -1), redo: [...settled.redo, copy(settled.grid)], before: null, mode: null, last: null };
}

export function redo(cv: Canvas): Canvas {
  const settled = isStroking(cv) ? endStroke(cv) : cv;
  const next = settled.redo[settled.redo.length - 1];
  if (!next) return settled;
  return { grid: copy(next), undo: [...settled.undo, copy(settled.grid)].slice(-UNDO_LIMIT), redo: settled.redo.slice(0, -1), before: null, mode: null, last: null };
}

/** Clear as one undoable action. */
export function clearCanvas(cv: Canvas): Canvas {
  const settled = isStroking(cv) ? endStroke(cv) : cv;
  if (isEmpty(settled.grid)) return settled;
  return { grid: emptyGrid(settled.grid.length), undo: [...settled.undo, copy(settled.grid)].slice(-UNDO_LIMIT), redo: [], before: null, mode: null, last: null };
}
