import { SIZE, type Grid } from '../protocol/drawing';
import type { Item } from '../protocol/message';

/*
 * The haunting, in three steps. Each player owns things the other can't see,
 * and only the ghost can carry things across, by sound.
 *
 *  1. The House gives the ghost an OBJECT that solves the Other Side's OBSTACLE.
 *  2. The Other Side gives the ghost a KEY that fits the House's KEYHOLE.
 *  3. The House paints the RUNE carved on the Other Side's exit onto the ghost.
 *
 * Every mistake costs one candle of spirit energy. At zero, the ghost fades.
 */

export const START_ENERGY = 3;

// ---- objects (House) and obstacles (Other Side) --------------------------

export type GameObject = 'lantern' | 'bell' | 'mirror';
export const OBJECTS: readonly GameObject[] = ['lantern', 'bell', 'mirror'];
export const OBJECT_INFO: Record<GameObject, { icon: string; name: string }> = {
  lantern: { icon: '🏮', name: 'Lantern' },
  bell: { icon: '🔔', name: 'Bell' },
  mirror: { icon: '🪞', name: 'Mirror' },
};

export interface Obstacle {
  id: string;
  needs: GameObject;
  icon: string;
  title: string;
  scene: string;
  solved: string;
}

export const OBSTACLES: readonly Obstacle[] = [
  {
    id: 'darkness',
    needs: 'lantern',
    icon: '🌑',
    title: 'Pitch darkness',
    scene: "You can't see anything. Something is breathing in the corner, and metal clinks on the wall.",
    solved: 'Light fills the room. The breathing was only a black cat, and four keys hang on the wall!',
  },
  {
    id: 'vampire',
    needs: 'mirror',
    icon: '🧛',
    title: 'The vampire',
    scene: 'A vampire stands in front of a cabinet of keys. It hisses and will not move.',
    solved: 'The vampire looks into the mirror, sees no reflection, shrieks, and flees! The key cabinet is open.',
  },
  {
    id: 'clock',
    needs: 'bell',
    icon: '🕰️',
    title: 'The silent clock',
    scene: 'The keys are locked inside a grandfather clock that stopped long ago. A sign reads: "I wake when I hear a chime."',
    solved: 'The bell rings, the clock chimes back, and its door swings open. Four keys are inside!',
  },
];

// ---- keys (Other Side) and keyhole (House) --------------------------------

export type KeySymbol = 'star' | 'moon' | 'skull' | 'heart';
export const KEYS: readonly KeySymbol[] = ['star', 'moon', 'skull', 'heart'];
export const KEY_INFO: Record<KeySymbol, { glyph: string; name: string; hint: string }> = {
  star: { glyph: '★', name: 'Star', hint: 'five sharp points' },
  moon: { glyph: '☾', name: 'Moon', hint: 'a thin curve' },
  skull: { glyph: '☠', name: 'Skull', hint: 'a face with crossed bones' },
  heart: { glyph: '♥', name: 'Heart', hint: 'two round bumps and a point' },
};

export function isObject(item: Item): item is GameObject {
  return (OBJECTS as readonly string[]).includes(item);
}
export function isKey(item: Item): item is KeySymbol {
  return (KEYS as readonly string[]).includes(item);
}

// ---- runes: 4×4 blocks, easy to describe out loud -------------------------

export const RUNE_SIZE = 4;
export type Rune4 = boolean[][];

export interface Rune {
  id: string;
  name: string;
  blocks: Rune4;
}

export function runeFromRows(rows: string[]): Rune4 {
  if (rows.length !== RUNE_SIZE || rows.some((r) => r.length !== RUNE_SIZE)) throw new Error('rune must be 4×4');
  return rows.map((r) => [...r].map((c) => c === '#'));
}

export const RUNES: readonly Rune[] = [
  { id: 'cross', name: 'The Cross', blocks: runeFromRows(['#..#', '.##.', '.##.', '#..#']) },
  { id: 'ring', name: 'The Ring', blocks: runeFromRows(['.##.', '#..#', '#..#', '.##.']) },
  { id: 'stairs', name: 'The Stairs', blocks: runeFromRows(['#...', '##..', '###.', '####']) },
  { id: 'tower', name: 'The Tower', blocks: runeFromRows(['####', '.##.', '.##.', '.##.']) },
  { id: 'claws', name: 'The Claws', blocks: runeFromRows(['##..', '#...', '...#', '..##']) },
  { id: 'gate', name: 'The Gate', blocks: runeFromRows(['#.#.', '#.#.', '#.#.', '####']) },
];

/** Blocks allowed to be wrong when matching a painted rune. */
export const RUNE_TOLERANCE = 1;

export function emptyRune(): Rune4 {
  return Array.from({ length: RUNE_SIZE }, () => Array<boolean>(RUNE_SIZE).fill(false));
}

/** 4×4 blocks → 8×8 pixels (each block is 2×2), so it can travel in the drawing slot. */
export function runeToGrid(rune: Rune4): Grid {
  return Array.from({ length: SIZE }, (_, r) => Array.from({ length: SIZE }, (_, c) => rune[r >> 1][c >> 1]));
}

/** 8×8 → 4×4: a block is on when at least 2 of its 4 pixels are on. */
export function gridToRune(grid: Grid): Rune4 {
  return Array.from({ length: RUNE_SIZE }, (_, r) =>
    Array.from({ length: RUNE_SIZE }, (_, c) => {
      const n = +grid[2 * r][2 * c] + +grid[2 * r][2 * c + 1] + +grid[2 * r + 1][2 * c] + +grid[2 * r + 1][2 * c + 1];
      return n >= 2;
    }),
  );
}

export function blockDistance(a: Rune4, b: Rune4): number {
  let d = 0;
  for (let r = 0; r < RUNE_SIZE; r++) for (let c = 0; c < RUNE_SIZE; c++) if (a[r][c] !== b[r][c]) d++;
  return d;
}

export function pick<T>(list: readonly T[], random: () => number): T {
  return list[Math.min(list.length - 1, Math.floor(random() * list.length))];
}
