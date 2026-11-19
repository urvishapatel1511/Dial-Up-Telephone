const controllers = new WeakMap<HTMLElement, AbortController>();

/**
 * Builds an N×N grid of cells. Pass onChange to make it editable
 * (tap, click, or drag to paint; Enter/Space with the keyboard).
 */
export function renderGrid(host: HTMLElement, grid: boolean[][], onChange?: (grid: boolean[][]) => void): void {
  const size = grid.length;
  host.replaceChildren();
  host.classList.add('grid');
  host.style.gridTemplateColumns = `repeat(${size}, 1fr)`;
  let painting: boolean | null = null;
  controllers.get(host)?.abort();
  const ac = new AbortController();
  controllers.set(host, ac);
  const { signal } = ac;

  const label = (r: number, c: number, on: boolean) => `row ${r + 1} column ${c + 1} ${on ? 'filled' : 'empty'}`;

  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const cell: HTMLElement = document.createElement(onChange ? 'button' : 'div');
      cell.className = 'cell' + (grid[r][c] ? ' on' : '');
      cell.setAttribute('aria-label', label(r, c, grid[r][c]));
      if (onChange) {
        (cell as HTMLButtonElement).type = 'button';
        const apply = (value: boolean) => {
          if (grid[r][c] === value) return;
          grid[r][c] = value;
          cell.classList.toggle('on', value);
          cell.setAttribute('aria-label', label(r, c, value));
          onChange(grid);
        };
        cell.addEventListener('pointerdown', (e: PointerEvent) => {
          e.preventDefault();
          painting = !grid[r][c];
          apply(painting);
        });
        cell.addEventListener('pointerenter', () => {
          if (painting !== null) apply(painting);
        });
        cell.addEventListener('keydown', (e: KeyboardEvent) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            apply(!grid[r][c]);
          }
        });
      } else {
        cell.removeAttribute('aria-label');
      }
      host.appendChild(cell);
    }
  }

  if (!onChange) {
    host.setAttribute('role', 'img');
    return;
  }
  host.removeAttribute('role');
  const stop = () => (painting = null);
  window.addEventListener('pointerup', stop, { signal });
  window.addEventListener('pointercancel', stop, { signal });
  // Touch drag: pointerenter does not fire across elements during touch, so hit-test manually.
  host.addEventListener(
    'pointermove',
    (e: PointerEvent) => {
      if (painting === null || e.pointerType === 'mouse') return;
      const el = document.elementFromPoint(e.clientX, e.clientY);
      if (el instanceof HTMLElement && el.parentElement === host) {
        const idx = Array.prototype.indexOf.call(host.children, el);
        const r = Math.floor(idx / size);
        const c = idx % size;
        if (grid[r][c] !== painting) {
          grid[r][c] = painting;
          el.classList.toggle('on', painting);
          onChange(grid);
        }
      }
    },
    { signal },
  );
}
