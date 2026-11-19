import type { Personality } from '../game/puzzles';
import type { Grid } from '../protocol/drawing';

/**
 * Renders the player's 8×8 drawing as a glowing, floating ghost. The drawing
 * itself is never changed: personality only changes the motion (CSS class)
 * and the hat is a separate overlay. Re-renders only when something visible
 * changes, so animations don't restart on every update.
 */
export function renderGhost(
  host: HTMLElement,
  grid: Grid,
  opts: { energy: number; label: string; personality?: Personality; hat?: boolean; materialize?: boolean; sending?: boolean },
): void {
  const sig = grid.map((r) => r.map((v) => (v ? 1 : 0)).join('')).join('|') + (opts.hat ? '+hat' : '');
  host.classList.add('ghost');
  for (const p of ['shy', 'dramatic', 'mischievous', 'sleepy']) host.classList.toggle(`p-${p}`, opts.personality === p);
  host.dataset.energy = String(opts.energy);
  host.classList.toggle('sending', !!opts.sending);
  host.setAttribute('role', 'img');
  host.setAttribute('aria-label', opts.label + (opts.hat ? ', wearing a tiny rescued hat' : ''));
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
  const parts: HTMLElement[] = [body];
  if (opts.hat) {
    const hat = document.createElement('span');
    hat.className = 'hat';
    hat.textContent = '🎩';
    hat.setAttribute('aria-hidden', 'true');
    parts.push(hat);
  }
  host.replaceChildren(...parts);
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
      s.setAttribute('aria-hidden', 'true');
      return s;
    }),
  );
}
