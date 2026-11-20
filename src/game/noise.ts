import type { Grid } from '../protocol/drawing';
import { TEXT_MAX, type NoiseLevel } from '../protocol/packet';
import { PROMPTS } from './words';

/**
 * Line static: a bad old phone line garbles messages on the way. Applied on
 * screen only (the chirp carries the exact entry) and fully deterministic, so
 * every device in the room, before or after a refresh, sees the same result.
 */

export const NOISE_INFO: Record<NoiseLevel, { icon: string; name: string; blurb: string }> = {
  0: { icon: '📞', name: 'Clear line', blurb: 'messages arrive exactly as sent' },
  1: { icon: '📡', name: 'Crackly', blurb: 'a little static on every hop' },
  2: { icon: '👻', name: 'Haunted', blurb: 'heavy static, total chaos' },
};

/** Squares flipped on a 16×16 drawing per hop. */
export const FLIPS: Record<NoiseLevel, number> = { 0: 0, 1: 8, 2: 24 };

/** Curated, recognizable twists. Static prefers these over random letters. */
export const TWISTS: Readonly<Record<string, readonly string[]>> = {
  cat: ['bat', 'hat', 'car', 'cap'],
  bat: ['cat', 'hat', 'bag'],
  hat: ['cat', 'bat', 'hut'],
  car: ['cat', 'jar', 'star'],
  ghost: ['goat', 'host', 'toast'],
  goat: ['ghost', 'boat', 'coat'],
  toast: ['ghost', 'coast'],
  moon: ['spoon', 'moose', 'noon'],
  house: ['mouse', 'horse'],
  mouse: ['house', 'moose'],
  bone: ['cone', 'phone', 'stone'],
  phone: ['bone', 'cone'],
  boat: ['goat', 'coat'],
  cake: ['snake', 'lake'],
  snake: ['cake', 'snack'],
  fish: ['dish', 'wish'],
  frog: ['fog', 'dog', 'log'],
  dog: ['log', 'frog', 'fog'],
  tree: ['three', 'bee'],
  bee: ['tree', 'key'],
  star: ['car', 'jar', 'scar'],
  sun: ['bun', 'nun'],
  rocket: ['pocket', 'socket'],
  key: ['monkey', 'keg'],
  bell: ['shell', 'ball'],
  ball: ['bell', 'wall'],
  clock: ['lock', 'sock'],
  sock: ['clock', 'rock'],
  duck: ['truck', 'luck'],
  witch: ['watch', 'switch'],
  broom: ['room', 'groom'],
  egg: ['leg', 'keg'],
  crown: ['clown', 'cow'],
  cow: ['owl', 'crow'],
  owl: ['bowl', 'cow'],
  cloud: ['clown', 'crowd'],
  spider: ['cider', 'rider'],
  coffin: ['muffin'],
  candle: ['handle', 'sandal'],
  door: ['floor', 'boar'],
  lamp: ['camp', 'stamp'],
  kite: ['bite', 'knight'],
  book: ['cook', 'hook'],
  chair: ['hair', 'pear'],
  pear: ['bear', 'chair'],
  robot: ['rabbit', 'robin'],
  mummy: ['money', 'tummy'],
  crab: ['cab', 'grab'],
  snail: ['nail', 'sail'],
  pizza: ['plaza'],
  heart: ['hearth', 'cart'],
  skull: ['shell', 'skill'],
  pumpkin: ['bumpkin'],
  zombie: ['zombo'],
  train: ['rain', 'brain'],
  tent: ['tenth', 'dent'],
  shoe: ['show', 'shoo'],
  sad: ['mad', 'bad'],
  dragon: ['wagon'],
  taxi: ['tax', 'maxi'],
  chef: ['chief'],
};

const VOCAB: ReadonlySet<string> = new Set([
  ...Object.values(PROMPTS).flatMap((list) => list.flatMap((w) => w.toLowerCase().split(' '))),
  ...Object.keys(TWISTS),
  ...Object.values(TWISTS).flat(),
]);

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

export interface NoisyText {
  text: string;
  /** Indices of changed characters (only when the length is unchanged). */
  changed: number[];
  kind: 'none' | 'twist' | 'letters';
}

/** Keep the source's case style: "CAT" → "BAT", "Cat" → "Bat", "cat" → "bat". */
function matchCase(src: string, word: string): string {
  if (/[A-Z]/.test(src) && src === src.toUpperCase()) return word.toUpperCase();
  if (/^[A-Z]/.test(src)) return word[0].toUpperCase() + word.slice(1);
  return word;
}

function oneLetterWords(tok: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < tok.length; i++) {
    if (!/[a-z]/.test(tok[i])) continue;
    for (const ch of ALPHA) {
      if (ch === tok[i]) continue;
      const w = tok.slice(0, i) + ch + tok.slice(i + 1);
      if (VOCAB.has(w)) out.push(w);
    }
  }
  return out;
}

function randomLetter(text: string, r: () => number): string {
  const idx = [...text].map((c, i) => (/[a-z]/i.test(c) ? i : -1)).filter((i) => i >= 0);
  if (idx.length === 0) return text;
  const i = idx[Math.floor(r() * idx.length)];
  const lower = text[i].toLowerCase();
  let rep = lower;
  while (rep === lower) rep = ALPHA[Math.floor(r() * ALPHA.length)];
  return text.slice(0, i) + (text[i] === lower ? rep : rep.toUpperCase()) + text.slice(i + 1);
}

/**
 * Garble a guess on its way to the next seat. Crackly changes half of the
 * hops, Haunted all of them. Prefers a curated twist, then a one-letter change
 * into a known word, then a nonsense letter. Haunted may add one more
 * nonsense letter. The result is always valid text of ≤ 12 characters.
 */
export function noisyText(t: string, gameId: number, step: number, level: NoiseLevel): NoisyText {
  const none: NoisyText = { text: t, changed: [], kind: 'none' };
  if (level === 0) return none;
  const r = rng(seedFor(gameId, step, level) ^ 0x51ed);
  if (level === 1 && r() >= 0.5) return none;

  const tokens = t.split(' ');
  let out = [...tokens];
  let kind: NoisyText['kind'] = 'none';
  const fits = (arr: string[]) => arr.join(' ').length <= TEXT_MAX;

  const twistable = tokens.map((tok, i) => (TWISTS[tok.toLowerCase()] ? i : -1)).filter((i) => i >= 0);
  if (twistable.length) {
    const i = twistable[Math.floor(r() * twistable.length)];
    const opts = TWISTS[tokens[i].toLowerCase()];
    const start = Math.floor(r() * opts.length);
    for (let j = 0; j < opts.length && kind === 'none'; j++) {
      const cand = [...out];
      cand[i] = matchCase(tokens[i], opts[(start + j) % opts.length]);
      if (fits(cand)) {
        out = cand;
        kind = 'twist';
      }
    }
  }
  if (kind === 'none') {
    const cands: [number, string][] = [];
    tokens.forEach((tok, i) => oneLetterWords(tok.toLowerCase()).forEach((w) => cands.push([i, w])));
    if (cands.length) {
      const [i, w] = cands[Math.floor(r() * cands.length)];
      out[i] = matchCase(tokens[i], w);
      kind = 'twist';
    }
  }
  let text = out.join(' ');
  if (kind === 'none') {
    text = randomLetter(t, r);
    if (text === t) return none; // no letters at all
    kind = 'letters';
  }
  const letters = text.replace(/[^a-z]/gi, '').length;
  if (level === 2 && (kind === 'letters' ? letters >= 6 : r() < 0.5)) {
    const extra = randomLetter(text, r);
    if (extra !== t) text = extra; // never let the extra letter undo the static
  }

  const changed = text.length === t.length ? [...text].map((c, i) => (c !== t[i] ? i : -1)).filter((i) => i >= 0) : [];
  return { text, changed, kind };
}
