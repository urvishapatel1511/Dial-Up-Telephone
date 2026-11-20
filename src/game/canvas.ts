import { emptyGrid, type Grid } from '../protocol/drawing';

/**
 * Drawing model with stroke-level undo/redo. Pure (no DOM): the editor calls
 * beginStroke → paint… → endStroke for each pointer stroke or keyboard action.
 */
export type Tool = 'pen' | 'eraser';
export type Brush = 'small' | 'large';

export const UNDO_LIMIT = 50;

export interface Canvas {
  grid: Grid;
  undo: Grid[];
  redo: Grid[];
  /** Snapshot taken at the start of the stroke in progress. */
  before: Grid | null;
}

const copy = (g: Grid): Grid => g.map((r) => [...r]);
const same = (a: Grid, b: Grid) => a.every((row, r) => row.every((v, c) => v === b[r][c]));

export function newCanvas(size = 16): Canvas {
  return { grid: emptyGrid(size), undo: [], redo: [], before: null };
}

export const isEmpty = (g: Grid) => !g.some((r) => r.some(Boolean));

/** Cells covered by the brush at (r, c): 1 cell, or a 3×3 square clipped to the grid. */
export function brushCells(r: number, c: number, size: number, brush: Brush): [number, number][] {
  if (brush === 'small') return r >= 0 && c >= 0 && r < size && c < size ? [[r, c]] : [];
  const out: [number, number][] = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      const y = r + dr;
      const x = c + dc;
      if (y >= 0 && x >= 0 && y < size && x < size) out.push([y, x]);
    }
  }
  return out;
}

export function beginStroke(cv: Canvas): Canvas {
  return { ...cv, before: copy(cv.grid) };
}

export function paint(cv: Canvas, r: number, c: number, tool: Tool, brush: Brush): Canvas {
  const cells = brushCells(r, c, cv.grid.length, brush);
  const value = tool === 'pen';
  if (cells.every(([y, x]) => cv.grid[y][x] === value)) return cv;
  const grid = copy(cv.grid);
  for (const [y, x] of cells) grid[y][x] = value;
  return { ...cv, grid };
}

/** Finish the stroke: one undo step if anything changed. A new action clears redo. */
export function endStroke(cv: Canvas): Canvas {
  if (!cv.before) return cv;
  if (same(cv.before, cv.grid)) return { ...cv, before: null };
  return { ...cv, before: null, undo: [...cv.undo, cv.before].slice(-UNDO_LIMIT), redo: [] };
}

/** A whole keyboard action (one cell or brush footprint) as a single undo step. */
export function stamp(cv: Canvas, r: number, c: number, tool: Tool, brush: Brush): Canvas {
  return endStroke(paint(beginStroke(cv), r, c, tool, brush));
}

export function undo(cv: Canvas): Canvas {
  const prev = cv.undo[cv.undo.length - 1];
  if (!prev) return cv;
  return { grid: copy(prev), undo: cv.undo.slice(0, -1), redo: [...cv.redo, copy(cv.grid)], before: null };
}

export function redo(cv: Canvas): Canvas {
  const next = cv.redo[cv.redo.length - 1];
  if (!next) return cv;
  return { grid: copy(next), undo: [...cv.undo, copy(cv.grid)].slice(-UNDO_LIMIT), redo: cv.redo.slice(0, -1), before: null };
}

/** Clear as one undoable action. */
export function clearCanvas(cv: Canvas): Canvas {
  if (isEmpty(cv.grid)) return cv;
  return { grid: emptyGrid(cv.grid.length), undo: [...cv.undo, copy(cv.grid)].slice(-UNDO_LIMIT), redo: [], before: null };
}
