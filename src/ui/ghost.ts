import type { Grid } from '../protocol/drawing';

/**
 * Renders the player's 8×8 drawing as a glowing, floating ghost.
 * Re-renders only when the drawing changes, so animations aren't restarted
 * on every UI update. `materialize` makes the pixels appear one by one.
 */
export function renderGhost(
  host: HTMLElement,
  grid: Grid,
  opts: { energy: number; label: string; materialize?: boolean; sending?: boolean },
): void {
  const sig = grid.map((r) => r.map((v) => (v ? 1 : 0)).join('')).join('|');
  host.classList.add('ghost');
  host.dataset.energy = String(opts.energy);
  host.classList.toggle('sending', !!opts.sending);
  host.setAttribute('role', 'img');
  host.setAttribute('aria-label', opts.label);
  if (host.dataset.sig === sig && !opts.materialize) return;
  host.dataset.sig = sig;

  const body = document.createElement('div');
  body.className = 'ghost-body' + (opts.materialize ? ' materialize' : '');
  let i = 0;
  for (const row of grid) {
    for (const on of row) {
      const cell = document.createElement('span');
      cell.className = on ? 'px on' : 'px';
      if (on) cell.style.setProperty('--i', String(i++));
      body.appendChild(cell);
    }
  }
  host.replaceChildren(body);
}

export function renderCandles(host: HTMLElement, energy: number | null): void {
  host.hidden = energy === null;
  if (energy === null) return;
  host.setAttribute('aria-label', `Spirit energy: ${energy} of 3 candles`);
  host.replaceChildren(
    ...[0, 1, 2].map((i) => {
      const s = document.createElement('span');
      s.className = i < energy ? 'candle lit' : 'candle out';
      s.textContent = '🕯️';
      return s;
    }),
  );
}
