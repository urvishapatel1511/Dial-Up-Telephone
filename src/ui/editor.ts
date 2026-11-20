import {
  beginStroke,
  clearCanvas,
  endStroke,
  isEmpty,
  newCanvas,
  paint,
  redo,
  stamp,
  undo,
  type Brush,
  type Canvas,
  type Tool,
} from '../game/canvas';
import type { Grid } from '../protocol/drawing';

/**
 * The drawing editor: a single-tab-stop grid of buttons (arrow keys, Home/End,
 * Space/Enter to paint, Ctrl+Z / Ctrl+Y), touch and mouse strokes, and a
 * toolbar with explicit tools. Each stroke or key press is one undo step.
 */
export class DrawingEditor {
  canvas: Canvas;
  tool: Tool = 'pen';
  brush: Brush = 'small';
  private cells: HTMLButtonElement[] = [];
  private focusIndex = 0;
  private stroking = false;
  private readonly size: number;

  constructor(
    private readonly host: HTMLElement,
    private readonly onChange: () => void,
    size = 16,
  ) {
    this.size = size;
    this.canvas = newCanvas(size);
    this.build();
    window.addEventListener('pointerup', () => this.finish());
    window.addEventListener('pointercancel', () => this.finish());
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

  reset(): void {
    this.canvas = newCanvas(this.size);
    this.sync();
  }
  setTool(t: Tool): void {
    this.tool = t;
    this.onChange();
  }
  setBrush(b: Brush): void {
    this.brush = b;
    this.onChange();
  }
  undo(): void {
    this.canvas = undo(this.canvas);
    this.sync();
  }
  redo(): void {
    this.canvas = redo(this.canvas);
    this.sync();
  }
  /** Asks first when there is something to lose. */
  clear(confirmFn: (msg: string) => boolean = (m) => window.confirm(m)): void {
    if (this.empty || !confirmFn('Clear your whole drawing? (You can undo this.)')) return;
    this.canvas = clearCanvas(this.canvas);
    this.sync();
  }

  private apply(next: Canvas) {
    if (next === this.canvas) return;
    this.canvas = next;
    this.sync();
  }

  private finish() {
    if (!this.stroking) return;
    this.stroking = false;
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
    host.setAttribute('aria-label', 'Your drawing, 16 by 16 squares. Arrow keys move, Space paints with the selected tool.');
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
        cell.addEventListener('pointerdown', (e: PointerEvent) => {
          e.preventDefault();
          this.moveFocus(i, false);
          this.stroking = true;
          this.canvas = beginStroke(this.canvas);
          this.apply(paint(this.canvas, r, c, this.tool, this.brush));
        });
        cell.addEventListener('pointerenter', () => {
          if (this.stroking) this.apply(paint(this.canvas, r, c, this.tool, this.brush));
        });
        cell.addEventListener('click', (e: MouseEvent) => {
          // Enter/Space arrive as a click with detail 0; pointer clicks were handled on pointerdown.
          if (e.detail === 0) this.apply(stamp(this.canvas, r, c, this.tool, this.brush));
        });
        cell.addEventListener('keydown', (e: KeyboardEvent) => this.key(e, r, c, i));
        this.cells.push(cell);
        host.appendChild(cell);
      }
    }
    // Touch drag: pointerenter does not fire across elements during touch, so hit-test manually.
    host.addEventListener('pointermove', (e: PointerEvent) => {
      if (!this.stroking || e.pointerType === 'mouse') return;
      const i = this.cells.indexOf(document.elementFromPoint(e.clientX, e.clientY) as HTMLButtonElement);
      if (i >= 0) this.apply(paint(this.canvas, Math.floor(i / size), i % size, this.tool, this.brush));
    });
    this.sync();
  }

  private key(e: KeyboardEvent, r: number, c: number, i: number) {
    const { size } = this;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) this.redo();
      else this.undo();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
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

  /** Update every cell from the model. */
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
