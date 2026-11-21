import { beginStroke, clearCanvas, endStroke, isEmpty, newCanvas, redo, strokeTo, toggle, undo, type Brush, type Canvas } from '../game/canvas';
import type { Grid } from '../protocol/drawing';

/** Clicks this soon after a pointer stroke are the browser's synthetic click, not a keyboard action. */
const CLICK_AFTER_POINTER_MS = 400;

/**
 * The drawing editor. Direct touch: the square where a stroke starts decides
 * whether it paints or erases (see src/game/canvas.ts). One pointer handler on
 * the grid serves mouse, touch, and pen alike, with pointer capture so a
 * release outside the grid still ends the stroke. The grid is a single tab
 * stop: arrow keys and Home/End move, Space/Enter toggle, Ctrl/Cmd+Z undoes,
 * Ctrl/Cmd+Shift+Z or Ctrl+Y redoes.
 */
export class DrawingEditor {
  canvas: Canvas;
  brush: Brush = 'small';
  private cells: HTMLButtonElement[] = [];
  private focusIndex = 0;
  private pointerId: number | null = null;
  private lastPointerEnd = -Infinity;
  private readonly size: number;

  constructor(
    private readonly host: HTMLElement,
    private readonly onChange: () => void,
    size = 16,
  ) {
    this.size = size;
    this.canvas = newCanvas(size);
    this.build();
  }

  get grid(): Grid {
    return this.canvas.grid;
  }
  get empty(): boolean {
    return isEmpty(this.canvas.grid);
  }
  get canUndo(): boolean {
    return this.canvas.undo.length > 0;
  }
  get canRedo(): boolean {
    return this.canvas.redo.length > 0;
  }
  get stroking(): boolean {
    return this.pointerId !== null;
  }

  reset(): void {
    this.pointerId = null;
    this.canvas = newCanvas(this.size);
    this.sync();
  }
  setBrush(b: Brush): void {
    this.brush = b;
    this.onChange();
  }
  undo(): void {
    this.endPointer();
    this.canvas = undo(this.canvas);
    this.sync();
  }
  redo(): void {
    this.endPointer();
    this.canvas = redo(this.canvas);
    this.sync();
  }
  /** Asks first when there is something to lose. */
  clear(confirmFn: (msg: string) => boolean = (m) => window.confirm(m)): void {
    if (this.empty || !confirmFn('Clear your whole drawing? (You can undo this.)')) return;
    this.endPointer();
    this.canvas = clearCanvas(this.canvas);
    this.sync();
  }

  private apply(next: Canvas) {
    if (next === this.canvas) return;
    const changed = next.grid !== this.canvas.grid;
    this.canvas = next;
    if (changed) this.sync();
  }

  /** Square under a viewport point, or -1 outside the grid. */
  private cellAt(x: number, y: number): number {
    const box = this.host.getBoundingClientRect();
    if (x < box.left || y < box.top || x >= box.right || y >= box.bottom) return -1;
    const c = Math.min(this.size - 1, Math.floor(((x - box.left) / box.width) * this.size));
    const r = Math.min(this.size - 1, Math.floor(((y - box.top) / box.height) * this.size));
    return r * this.size + c;
  }

  private endPointer() {
    if (this.pointerId === null) return;
    const id = this.pointerId;
    this.pointerId = null;
    this.lastPointerEnd = performance.now();
    if (this.host.hasPointerCapture?.(id)) this.host.releasePointerCapture(id);
    this.canvas = endStroke(this.canvas);
    this.onChange();
  }

  private build() {
    const { host, size } = this;
    host.replaceChildren();
    host.classList.add('grid', 'fine', 'editor');
    host.style.gridTemplateColumns = `repeat(${size}, 1fr)`;
    host.style.gap = '2px';
    host.setAttribute('role', 'group');
    host.setAttribute('aria-label', 'Your drawing, 16 by 16 squares. Arrow keys move, Space toggles a square.');
    this.cells = [];
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        const i = r * size + c;
        const cell = document.createElement('button');
        cell.type = 'button';
        cell.className = 'cell';
        cell.tabIndex = i === 0 ? 0 : -1;
        cell.setAttribute('aria-label', `Row ${r + 1}, column ${c + 1}`);
        cell.setAttribute('aria-pressed', 'false');
        cell.addEventListener('click', (e: MouseEvent) => {
          // Only keyboard activation (Enter/Space) counts here; pointers were handled on the grid.
          if (e.detail !== 0 || performance.now() - this.lastPointerEnd < CLICK_AFTER_POINTER_MS) return;
          this.apply(toggle(this.canvas, r, c, this.brush));
        });
        cell.addEventListener('keydown', (e: KeyboardEvent) => this.key(e, r, c, i));
        this.cells.push(cell);
        host.appendChild(cell);
      }
    }

    host.addEventListener('pointerdown', (e: PointerEvent) => {
      if (this.pointerId !== null) return; // a second finger is ignored during a stroke
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      const i = this.cellAt(e.clientX, e.clientY);
      if (i < 0) return;
      e.preventDefault();
      this.pointerId = e.pointerId;
      try {
        host.setPointerCapture(e.pointerId);
      } catch {
        // Synthetic events in tests may not support capture; the window listeners below still end the stroke.
      }
      this.moveFocus(i, false);
      this.apply(beginStroke(this.canvas, Math.floor(i / size), i % size, this.brush));
    });
    host.addEventListener('pointermove', (e: PointerEvent) => {
      if (e.pointerId !== this.pointerId) return;
      const i = this.cellAt(e.clientX, e.clientY);
      if (i >= 0) this.apply(strokeTo(this.canvas, Math.floor(i / size), i % size, this.brush));
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId === this.pointerId) this.endPointer();
    };
    host.addEventListener('pointerup', end);
    host.addEventListener('pointercancel', end);
    host.addEventListener('lostpointercapture', end);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    window.addEventListener('blur', () => this.endPointer());
    this.sync();
  }

  private key(e: KeyboardEvent, r: number, c: number, i: number) {
    const { size } = this;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) this.redo();
      else this.undo();
      return;
    }
    if (mod && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      this.redo();
      return;
    }
    const moves: Record<string, number> = {
      ArrowLeft: c > 0 ? i - 1 : i,
      ArrowRight: c < size - 1 ? i + 1 : i,
      ArrowUp: r > 0 ? i - size : i,
      ArrowDown: r < size - 1 ? i + size : i,
      Home: r * size,
      End: r * size + size - 1,
    };
    if (e.key in moves) {
      e.preventDefault();
      this.moveFocus(moves[e.key], true);
    }
  }

  private moveFocus(i: number, focus: boolean) {
    this.cells[this.focusIndex].tabIndex = -1;
    this.focusIndex = i;
    this.cells[i].tabIndex = 0;
    if (focus) this.cells[i].focus();
  }

  /** Update every square from the model. */
  private sync() {
    const g = this.canvas.grid;
    this.cells.forEach((cell, i) => {
      const on = g[Math.floor(i / this.size)][i % this.size];
      cell.classList.toggle('on', on);
      cell.setAttribute('aria-pressed', String(on));
    });
    this.onChange();
  }
}
