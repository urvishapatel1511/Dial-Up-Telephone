import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { beginStroke, brushCells, clearCanvas, endStroke, isEmpty, newCanvas, paint, redo, stamp, undo, UNDO_LIMIT, type Canvas } from '../src/game/canvas';

const on = (cv: Canvas) => cv.grid.flat().filter(Boolean).length;
const stroke = (cv: Canvas, cells: [number, number][], tool: 'pen' | 'eraser' = 'pen', brush: 'small' | 'large' = 'small') =>
  endStroke(cells.reduce((c, [r, k]) => paint(c, r, k, tool, brush), beginStroke(cv)));

describe('drawing tools (R2)', () => {
  it('one pointer stroke is one undo step; redo re-applies it', () => {
    let cv = newCanvas();
    cv = stroke(cv, [[0, 0], [0, 1], [0, 2]]);
    cv = stroke(cv, [[5, 5], [6, 5]]);
    expect(on(cv)).toBe(5);
    expect(cv.undo.length).toBe(2);
    cv = undo(cv);
    expect(on(cv)).toBe(3);
    cv = undo(cv);
    expect(isEmpty(cv.grid)).toBe(true);
    cv = redo(cv);
    expect(on(cv)).toBe(3);
    cv = redo(cv);
    expect(on(cv)).toBe(5);
    expect(redo(cv)).toBe(cv); // nothing left to redo
  });

  it('one keyboard action is one undo step', () => {
    let cv = stamp(newCanvas(), 3, 3, 'pen', 'small');
    cv = stamp(cv, 3, 4, 'pen', 'small');
    expect(cv.undo.length).toBe(2);
    expect(on(undo(cv))).toBe(1);
  });

  it('a new action clears redo; strokes that change nothing add no undo step', () => {
    let cv = stroke(newCanvas(), [[1, 1]]);
    cv = undo(cv);
    expect(cv.redo.length).toBe(1);
    cv = stroke(cv, [[2, 2]]);
    expect(cv.redo.length).toBe(0);
    const same = stroke(cv, [[2, 2]]); // painting an already-on square
    expect(same.undo.length).toBe(cv.undo.length);
  });

  it('the eraser clears squares', () => {
    let cv = stroke(newCanvas(), [[4, 4]], 'pen', 'large');
    expect(on(cv)).toBe(9);
    cv = stroke(cv, [[4, 4]], 'eraser');
    expect(on(cv)).toBe(8);
    cv = stroke(cv, [[4, 4]], 'eraser', 'large');
    expect(isEmpty(cv.grid)).toBe(true);
  });

  it('the large brush is 3×3 and clipped at the edges and corners', () => {
    expect(brushCells(5, 5, 16, 'large').length).toBe(9);
    expect(brushCells(0, 0, 16, 'large').length).toBe(4);
    expect(brushCells(15, 15, 16, 'large').length).toBe(4);
    expect(brushCells(0, 7, 16, 'large').length).toBe(6);
    expect(brushCells(7, 15, 16, 'large').length).toBe(6);
    expect(brushCells(0, 0, 16, 'small')).toEqual([[0, 0]]);
    expect(brushCells(16, 0, 16, 'small')).toEqual([]);
  });

  it('clear is a single undoable action', () => {
    let cv = stroke(newCanvas(), [[1, 1], [2, 2]]);
    cv = clearCanvas(cv);
    expect(isEmpty(cv.grid)).toBe(true);
    expect(on(undo(cv))).toBe(2);
    expect(clearCanvas(newCanvas()).undo.length).toBe(0); // nothing to clear
  });

  it(`history is capped at ${UNDO_LIMIT} steps`, () => {
    let cv = newCanvas();
    for (let i = 0; i < UNDO_LIMIT + 10; i++) cv = stamp(cv, i % 16, Math.floor(i / 16), 'pen', 'small');
    expect(cv.undo.length).toBe(UNDO_LIMIT);
  });

  it('property: undoing every action returns to the empty canvas, and redo restores the result', () => {
    const action = fc.record({
      r: fc.integer({ min: 0, max: 15 }),
      c: fc.integer({ min: 0, max: 15 }),
      tool: fc.constantFrom('pen' as const, 'eraser' as const),
      brush: fc.constantFrom('small' as const, 'large' as const),
    });
    fc.assert(
      fc.property(fc.array(action, { maxLength: 30 }), (acts) => {
        let cv = newCanvas();
        for (const a of acts) cv = stamp(cv, a.r, a.c, a.tool, a.brush);
        const final = cv.grid;
        while (cv.undo.length) cv = undo(cv);
        expect(isEmpty(cv.grid)).toBe(true);
        while (cv.redo.length) cv = redo(cv);
        expect(cv.grid).toEqual(final);
      }),
    );
  });
});
