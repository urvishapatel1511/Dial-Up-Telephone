import type { Grid } from '../protocol/drawing';
import type { NoiseLevel } from '../protocol/packet';

/**
 * Line static: a bad old phone line garbles messages on the way. Applied on
 * screen only (the chirp carries the exact entry) and fully deterministic, so
 * every device in the room, before or after a refresh, sees the same garbling.
 */

export const NOISE_INFO: Record<NoiseLevel, { icon: string; name: string; blurb: string }> = {
  0: { icon: '📞', name: 'Clear line', blurb: 'messages arrive exactly as sent' },
  1: { icon: '📡', name: 'Crackly', blurb: 'a little static on every hop' },
  2: { icon: '👻', name: 'Haunted', blurb: 'heavy static, total chaos' },
};

/** Squares flipped on a 16×16 drawing per hop. */
export const FLIPS: Record<NoiseLevel, number> = { 0: 0, 1: 8, 2: 24 };

const ALPHA = 'abcdefghijklmnopqrstuvwxyz';

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const seedFor = (gameId: number, step: number, level: number) =>
  (Math.imul(gameId + 1, 0x9e3779b1) ^ Math.imul(step + 7, 0x85ebca6b) ^ Math.imul(level + 3, 0x27d4eb2f)) >>> 0;

/** Returns the garbled drawing and the flipped cell indices (row * size + col). */
export function noisyDrawing(d: Grid, gameId: number, step: number, level: NoiseLevel): { grid: Grid; flipped: number[] } {
  const n = d.length;
  const total = n * n;
  const k = Math.min(FLIPS[level], total);
  const r = rng(seedFor(gameId, step, level));
  const picked = new Set<number>();
  while (picked.size < k) picked.add(Math.floor(r() * total));
  const flipped = [...picked].sort((a, b) => a - b);
  const grid = d.map((row) => [...row]);
  for (const i of flipped) grid[Math.floor(i / n)][i % n] = !grid[Math.floor(i / n)][i % n];
  return { grid, flipped };
}

/** Returns the garbled guess and the indices of changed characters. Letters are replaced by other letters. */
export function noisyText(t: string, gameId: number, step: number, level: NoiseLevel): { text: string; changed: number[] } {
  if (level === 0) return { text: t, changed: [] };
  const r = rng(seedFor(gameId, step, level) ^ 0x51ed);
  const letters = [...t].map((c, i) => (/[a-z]/i.test(c) ? i : -1)).filter((i) => i >= 0);
  if (letters.length === 0) return { text: t, changed: [] };
  const count = level === 1 ? (r() < 0.5 ? 1 : 0) : letters.length >= 6 ? 2 : 1;
  const chars = [...t];
  const changed: number[] = [];
  while (changed.length < count) {
    const i = letters[Math.floor(r() * letters.length)];
    if (changed.includes(i)) continue;
    const lower = chars[i].toLowerCase();
    let rep = lower;
    while (rep === lower) rep = ALPHA[Math.floor(r() * ALPHA.length)];
    chars[i] = chars[i] === lower ? rep : rep.toUpperCase();
    changed.push(i);
  }
  return { text: chars.join(''), changed: changed.sort((a, b) => a - b) };
}
