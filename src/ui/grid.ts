const controllers = new WeakMap<HTMLElement, AbortController>();

export interface GridOptions {
  /** Accessible name of the whole grid, e.g. "Ghost drawing, 8 by 8". */
  label: string;
  /** Called after every change (editable grids only). */
  onChange?: (grid: boolean[][]) => void;
}

/**
 * Renders an N×N grid. Editable grids are a single tab stop: arrow keys
 * move, Space/Enter toggles, Home/End jump within a row (roving tabindex).
 * Tap, click, or drag paints.
 */
export function renderGrid(host: HTMLElement, grid: boolean[][], opts: GridOptions): void {
  const size = grid.length;
  const { onChange } = opts;
  controllers.get(host)?.abort();
  const ac = new AbortController();
  controllers.set(host, ac);
  const { signal } = ac;

  host.replaceChildren();
  host.classList.add('grid');
  host.style.gridTemplateColumns = `repeat(${size}, 1fr)`;
  host.setAttribute('aria-label', opts.label);

  if (!onChange) {
    host.setAttribute('role', 'img');
    for (const row of grid) {
      for (const on of row) {
        const cell = document.createElement('div');
        cell.className = on ? 'cell on' : 'cell';
        host.appendChild(cell);
      }
    }
    return;
  }

  host.setAttribute('role', 'group');
  let focusIndex = 0;
  let painting: boolean | null = null;
  const cells: HTMLButtonElement[] = [];
  const name = (r: number, c: number) => `Row ${r + 1}, column ${c + 1}`;

  const set = (i: number, value: boolean) => {
    const r = Math.floor(i / size);
    const c = i % size;
    if (grid[r][c] === value) return;
    grid[r][c] = value;
    cells[i].classList.toggle('on', value);
    cells[i].setAttribute('aria-pressed', String(value));
    onChange(grid);
  };
  const focus = (i: number) => {
    cells[focusIndex].tabIndex = -1;
    focusIndex = i;
    cells[i].tabIndex = 0;
    cells[i].focus();
  };

  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const i = r * size + c;
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = grid[r][c] ? 'cell on' : 'cell';
      cell.tabIndex = i === 0 ? 0 : -1;
      cell.setAttribute('aria-label', name(r, c));
      cell.setAttribute('aria-pressed', String(grid[r][c]));
      cell.addEventListener('pointerdown', (e: PointerEvent) => {
        e.preventDefault();
        painting = !grid[r][c];
        set(i, painting);
        cells[focusIndex].tabIndex = -1;
        focusIndex = i;
        cell.tabIndex = 0;
      });
      cell.addEventListener('pointerenter', () => {
        if (painting !== null) set(i, painting);
      });
      cell.addEventListener('click', (e: MouseEvent) => {
        // Keyboard "click" (Enter/Space) arrives with detail 0; pointer clicks were handled on pointerdown.
        if (e.detail === 0) set(i, !grid[r][c]);
      });
      cell.addEventListener('keydown', (e: KeyboardEvent) => {
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
          focus(moves[e.key]);
        }
      });
      cells.push(cell);
      host.appendChild(cell);
    }
  }

  const stop = () => (painting = null);
  window.addEventListener('pointerup', stop, { signal });
  window.addEventListener('pointercancel', stop, { signal });
  // Touch drag: pointerenter does not fire across elements during touch, so hit-test manually.
  host.addEventListener(
    'pointermove',
    (e: PointerEvent) => {
      if (painting === null || e.pointerType === 'mouse') return;
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const i = cells.indexOf(el as HTMLButtonElement);
      if (i >= 0) set(i, painting);
    },
    { signal },
  );
}
