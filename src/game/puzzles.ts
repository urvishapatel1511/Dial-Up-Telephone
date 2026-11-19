import { KEYS, SPOTS, type KeySymbol, type Metal, type Spot } from './rules';

/**
 * Puzzles both devices can build from the ghost ID alone, so no secret has
 * to travel and each screen shows only its half.
 */

/** mulberry32: small, fast, deterministic PRNG. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(list: readonly T[], random: () => number): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// ---- personality --------------------------------------------------------------

export type Personality = 'shy' | 'dramatic' | 'mischievous' | 'sleepy';
export const PERSONALITIES: readonly Personality[] = ['shy', 'dramatic', 'mischievous', 'sleepy'];

export function personalityOf(ghostId: number): Personality {
  return PERSONALITIES[Math.floor(seeded(ghostId ^ 0x5eed)() * PERSONALITIES.length)];
}

// ---- the lock (stage 2) -------------------------------------------------------

export interface KeyFacts {
  teeth: number;
  metal: Metal;
}

export interface LockPuzzle {
  answer: KeySymbol;
  /** Seen only by the House. */
  notches: number;
  rule: { kind: 'only' | 'never'; metal: Metal };
  /** Seen only by the Other Side. */
  keys: Record<KeySymbol, KeyFacts>;
}

const other = (m: Metal): Metal => (m === 'silver' ? 'gold' : 'silver');

/**
 * Template (guaranteed solvable):
 *  - the answer and one decoy ("twin") have the lock's number of teeth;
 *  - the answer obeys the metal rule, the twin doesn't;
 *  - one of the remaining keys also obeys the metal rule (so metal alone fails);
 *  - the remaining keys have a different number of teeth.
 */
export function lockPuzzle(ghostId: number): LockPuzzle {
  const rnd = seeded(ghostId ^ 0x10c4);
  const [answer, twin, ally, rest] = shuffle(KEYS, rnd);
  const notches = 1 + Math.floor(rnd() * 4); // 1..4
  const otherTeeth = shuffle([1, 2, 3, 4].filter((n) => n !== notches), rnd);
  const allowed: Metal = rnd() < 0.5 ? 'silver' : 'gold';
  const kind = rnd() < 0.5 ? 'only' : 'never';
  const keys = {
    [answer]: { teeth: notches, metal: allowed },
    [twin]: { teeth: notches, metal: other(allowed) },
    [ally]: { teeth: otherTeeth[0], metal: allowed },
    [rest]: { teeth: otherTeeth[1], metal: rnd() < 0.5 ? allowed : other(allowed) },
  } as Record<KeySymbol, KeyFacts>;
  return { answer, notches, rule: { kind, metal: kind === 'only' ? allowed : other(allowed) }, keys };
}

export function obeysRule(p: LockPuzzle, metal: Metal): boolean {
  return p.rule.kind === 'only' ? metal === p.rule.metal : metal !== p.rule.metal;
}

/** Keys consistent with both halves of the information. */
export function solveLock(p: LockPuzzle): KeySymbol[] {
  return KEYS.filter((k) => p.keys[k].teeth === p.notches && obeysRule(p, p.keys[k].metal));
}

export function ruleText(p: LockPuzzle): string {
  const m = p.rule.metal.toUpperCase();
  return p.rule.kind === 'only' ? `“Only ${m} may enter.”` : `“No ${m} shall touch this lock.”`;
}

export const LOCK_HINTS = [
  'The House can see the lock, and the Other Side can see the keys. Each of you should say what you see.',
  'Count them: the notches in the lock must match the teeth on the key. Two keys will match. The metal rule picks one.',
];

// ---- the hat (bonus) ----------------------------------------------------------

export interface HatPuzzle {
  answer: Spot;
  /** Two spots, one of them right. Seen only by the House. */
  houseClue: [Spot, Spot];
  /** Two spots, one of them right. Seen only by the Other Side. */
  otherClue: [Spot, Spot];
}

export function hatPuzzle(ghostId: number): HatPuzzle {
  const rnd = seeded(ghostId ^ 0x4a7);
  const [answer, a, b] = shuffle(SPOTS, rnd);
  const order = <T>(x: T, y: T): [T, T] => (rnd() < 0.5 ? [x, y] : [y, x]);
  return { answer, houseClue: order(answer, a), otherClue: order(answer, b) };
}

export function solveHat(p: HatPuzzle): Spot[] {
  return p.houseClue.filter((s) => p.otherClue.includes(s));
}
