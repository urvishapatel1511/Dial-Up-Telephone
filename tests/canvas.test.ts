import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  beginStroke,
  brushCells,
  clearCanvas,
  endStroke,
  isEmpty,
  isStroking,
  lineCells,
  newCanvas,
  redo,
  strokeTo,
  toggle,
  undo,
  UNDO_LIMIT,
  type Brush,
  type Canvas,
} from '../src/game/canvas';

const on = (cv: Canvas) => cv.grid.flat().filter(Boolean).length;
const at = (cv: Canvas, r: number, c: number) => cv.grid[r][c];
/** A whole pointer stroke through the given squares. */
const stroke = (cv: Canvas, cells: [number, number][], brush: Brush = 'small') => {
  let s = beginStroke(cv, cells[0][0], cells[0][1], brush);
  for (const [r, c] of cells.slice(1)) s = strokeTo(s, r, c, brush);
  return endStroke(s);
};
/** A canvas with the given squares filled, and no history. */
const filled = (cells: [number, number][]): Canvas => {
  const cv = newCanvas();
  for (const [r, c] of cells) cv.grid[r][c] = true;
  return cv;
};

describe('direct touch drawing (R2.1)', () => {
  it('a tap on an empty square fills it once; a tap on a filled square empties it once', () => {
    const a = stroke(newCanvas(), [[3, 3]]);
    expect(at(a, 3, 3)).toBe(true);
    expect(on(a)).toBe(1);
    const b = stroke(a, [[3, 3]]);
    expect(at(b, 3, 3)).toBe(false);
    expect(b.undo.length).toBe(2);
  });

  it('starting on empty paints every square it touches, including filled ones (never erases)', () => {
    const cv = filled([[0, 2], [0, 4]]);
    const out = stroke(cv, [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4], [0, 5]]);
    expect([0, 1, 2, 3, 4, 5].map((c) => at(out, 0, c))).toEqual([true, true, true, true, true, true]);
  });

  it('starting on filled erases every square it touches, including empty ones (never paints)', () => {
    const cv = filled([[1, 0], [1, 1], [1, 3]]);
    const out = stroke(cv, [[1, 0], [1, 1], [1, 2], [1, 3], [1, 4]]);
    expect(on(out)).toBe(0);
  });

  it('revisiting squares in one stroke never toggles them again', () => {
    const path: [number, number][] = [[2, 2], [2, 3], [2, 2], [2, 3], [2, 2], [2, 4], [2, 2]];
    const out = stroke(newCanvas(), path);
    expect([2, 3, 4].map((c) => at(out, 2, c))).toEqual([true, true, true]);
    expect(out.undo.length).toBe(1);
  });

  it('the operation is decided again by each new stroke', () => {
    let cv = stroke(newCanvas(), [[5, 5], [5, 6]]); // paints
    cv = stroke(cv, [[5, 5], [5, 7]]); // starts on filled: erases, and (5,7) stays empty
    expect([5, 6, 7].map((c) => at(cv, 5, c))).toEqual([false, false, false]);
    cv = stroke(cv, [[5, 6], [5, 7]]); // starts on empty again: paints
    expect([6, 7].map((c) => at(cv, 5, c))).toEqual([true, true]);
  });

  it('fast drags fill the straight line between samples, with the stroke mode', () => {
    const out = stroke(newCanvas(), [[0, 0], [0, 9]]);
    expect(on(out)).toBe(10);
    expect(lineCells([0, 0], [3, 3])).toEqual([[0, 0], [1, 1], [2, 2], [3, 3]]);
    expect(lineCells([2, 5], [2, 5])).toEqual([[2, 5]]);
  });

  it('moves outside the grid are ignored, and the stroke can come back in', () => {
    let cv = beginStroke(newCanvas(), 0, 0, 'small');
    cv = strokeTo(cv, -1, 3, 'small');
    cv = strokeTo(cv, 0, 1, 'small');
    cv = endStroke(cv);
    expect(on(cv)).toBe(2);
    expect(isStroking(cv)).toBe(false);
  });

  it('the large brush uses the start square to decide, and is clipped at the edges', () => {
    const cv = filled([[4, 4]]);
    const erased = stroke(cv, [[4, 4]], 'large'); // start square filled → erase the 3×3
    expect(on(erased)).toBe(0);
    const painted = stroke(filled([[4, 5]]), [[4, 4]], 'large'); // start empty → paint, (4,5) stays filled
    expect(on(painted)).toBe(9);
    expect(brushCells(0, 0, 16, 'large').length).toBe(4);
    expect(brushCells(15, 15, 16, 'large').length).toBe(4);
    expect(brushCells(0, 7, 16, 'large').length).toBe(6);
    expect(brushCells(16, 0, 16, 'small')).toEqual([]);
  });
});

describe('undo and redo (R2.2)', () => {
  it('one undo reverses one complete stroke; redo restores it', () => {
    let cv = stroke(newCanvas(), [[0, 0], [0, 1], [0, 2]]);
    cv = stroke(cv, [[5, 5], [6, 5]]);
    cv = undo(cv);
    expect(on(cv)).toBe(3);
    cv = undo(cv);
    expect(isEmpty(cv.grid)).toBe(true);
    cv = redo(cv);
    expect(on(cv)).toBe(3);
    cv = redo(cv);
    expect(on(cv)).toBe(5);
    expect(redo(cv)).toBe(cv);
  });

  it('a new action after undo clears redo; a stroke that changes nothing adds no step', () => {
    let cv = stroke(newCanvas(), [[1, 1]]);
    cv = undo(cv);
    expect(cv.redo.length).toBe(1);
    cv = stroke(cv, [[2, 2]]);
    expect(cv.redo.length).toBe(0);
    const before = cv.undo.length;
    const outside = endStroke(strokeTo(cv, 3, 3, 'small')); // no stroke in progress: nothing happens
    expect(outside.undo.length).toBe(before);
  });

  it('an interrupted stroke (cancel, or undo during a stroke) keeps what was drawn as one step', () => {
    let cv = beginStroke(newCanvas(), 0, 0, 'small');
    cv = strokeTo(cv, 0, 3, 'small');
    cv = undo(cv); // ends the stroke first, then undoes it
    expect(isEmpty(cv.grid)).toBe(true);
    expect(cv.redo.length).toBe(1);
  });

  it('keyboard toggle is one undo step', () => {
    let cv = toggle(newCanvas(), 3, 3, 'small');
    cv = toggle(cv, 3, 3, 'small');
    expect(on(cv)).toBe(0);
    expect(cv.undo.length).toBe(2);
    expect(on(undo(cv))).toBe(1);
  });

  it('clear is one undoable action', () => {
    let cv = stroke(newCanvas(), [[1, 1], [2, 2]]);
    cv = clearCanvas(cv);
    expect(isEmpty(cv.grid)).toBe(true);
    expect(on(undo(cv))).toBe(2);
    expect(clearCanvas(newCanvas()).undo.length).toBe(0);
  });

  it(`history is capped at ${UNDO_LIMIT} steps`, () => {
    let cv = newCanvas();
    for (let i = 0; i < UNDO_LIMIT + 10; i++) cv = toggle(cv, i % 16, Math.floor(i / 16), 'small');
    expect(cv.undo.length).toBe(UNDO_LIMIT);
  });

  it('property: a stroke never mixes painting and erasing', () => {
    const sq = fc.tuple(fc.integer({ min: 0, max: 15 }), fc.integer({ min: 0, max: 15 }));
    fc.assert(
      fc.property(fc.array(sq, { maxLength: 40 }), fc.array(sq, { minLength: 1, maxLength: 20 }), (pre, path) => {
        const cv = filled(pre);
        const out = stroke(cv, path as [number, number][]);
        const painting = !cv.grid[path[0][0]][path[0][1]];
        for (let r = 0; r < 16; r++) {
          for (let c = 0; c < 16; c++) {
            if (out.grid[r][c] !== cv.grid[r][c]) expect(out.grid[r][c]).toBe(painting);
          }
        }
      }),
    );
  });

  it('property: undoing every action returns to the empty canvas, and redo restores the result', () => {
    const act = fc.record({ r: fc.integer({ min: 0, max: 15 }), c: fc.integer({ min: 0, max: 15 }), brush: fc.constantFrom<Brush>('small', 'large') });
    fc.assert(
      fc.property(fc.array(act, { maxLength: 30 }), (acts) => {
        let cv = newCanvas();
        for (const a of acts) cv = toggle(cv, a.r, a.c, a.brush);
        const final = cv.grid;
        while (cv.undo.length) cv = undo(cv);
        expect(isEmpty(cv.grid)).toBe(true);
        while (cv.redo.length) cv = redo(cv);
        expect(cv.grid).toEqual(final);
      }),
    );
  });
});
