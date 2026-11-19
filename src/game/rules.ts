import { SIZE, type Grid } from '../protocol/drawing';
import type { Item } from '../protocol/message';

/*
 * The Rescue, in three stages plus a bonus. Each player owns things the other
 * can't see. Talking tells you what is needed, and only the ghost can carry it
 * across, by sound. Every wrong answer puts out one of three candles.
 */

export const START_ENERGY = 3;

// ---- Stage 1: objects (House) vs obstacles (Other Side) ------------------

export type GameObject = 'lantern' | 'bell' | 'mirror';
export const OBJECTS: readonly GameObject[] = ['lantern', 'bell', 'mirror'];
export const OBJECT_INFO: Record<GameObject, { icon: string; name: string }> = {
  lantern: { icon: '🏮', name: 'Lantern' },
  bell: { icon: '🔔', name: 'Bell' },
  mirror: { icon: '🪞', name: 'Mirror' },
};

export interface Obstacle {
  id: 'darkness' | 'vampire' | 'clock';
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
    scene: "You can't see a thing. Something breathes in the corner, and metal clinks on the wall.",
    solved: 'Light spills across the room. The breathing was only a black cat, and four keys hang on the wall.',
  },
  {
    id: 'vampire',
    needs: 'mirror',
    icon: '🧛',
    title: 'The vampire',
    scene: 'A vampire guards a cabinet of keys. It hisses and will not move. It has never seen itself.',
    solved: 'The vampire sees no reflection, shrieks, and flees into the rafters. The key cabinet stands open.',
  },
  {
    id: 'clock',
    needs: 'bell',
    icon: '🕰️',
    title: 'The silent clock',
    scene: 'The keys are locked inside a grandfather clock that stopped long ago. A sign reads: "I wake when I hear a chime."',
    solved: 'The bell rings, the clock chimes back, and its little compartment swings open. Four keys inside.',
  },
];

// ---- Stage 2: keys ---------------------------------------------------------

export type KeySymbol = 'star' | 'moon' | 'skull' | 'heart';
export const KEYS: readonly KeySymbol[] = ['star', 'moon', 'skull', 'heart'];
export const KEY_INFO: Record<KeySymbol, { glyph: string; name: string }> = {
  star: { glyph: '★', name: 'Star' },
  moon: { glyph: '☾', name: 'Moon' },
  skull: { glyph: '☠', name: 'Skull' },
  heart: { glyph: '♥', name: 'Heart' },
};
export type Metal = 'silver' | 'gold';

// ---- Stage 3: runes and the lying mirror ------------------------------------

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

/**
 * True runes, as seen standing in front of the exit door (row 1 = top,
 * column 1 = left). Every rune is clearly different from its own mirror image.
 */
export const RUNES: readonly Rune[] = [
  { id: 'stairs', name: 'The Stairs', blocks: runeFromRows(['#...', '##..', '###.', '####']) },
  { id: 'claws', name: 'The Claws', blocks: runeFromRows(['##..', '#...', '...#', '..##']) },
  { id: 'flag', name: 'The Flag', blocks: runeFromRows(['###.', '#.#.', '###.', '#...']) },
  { id: 'hook', name: 'The Hook', blocks: runeFromRows(['..#.', '..#.', '#.#.', '.##.']) },
  { id: 'bolt', name: 'The Bolt', blocks: runeFromRows(['..##', '.##.', '##..', '#...']) },
  { id: 'key', name: 'The Old Key', blocks: runeFromRows(['.#..', '###.', '.#..', '.###']) },
];

/** Blocks allowed to be wrong when matching a painted rune. */
export const RUNE_TOLERANCE = 1;

export function emptyRune(): Rune4 {
  return Array.from({ length: RUNE_SIZE }, () => Array<boolean>(RUNE_SIZE).fill(false));
}

/** The lying mirror: swaps left and right. Applying it twice gives the original. */
export function mirrorRune(rune: Rune4): Rune4 {
  return rune.map((row) => [...row].reverse());
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

/** Text equivalent of a rune, row by row, for screen readers. */
export function describeRune(rune: Rune4): string {
  return rune.map((row, i) => `Row ${i + 1}: ${row.map((b) => (b ? 'filled' : 'empty')).join(', ')}`).join('. ');
}

// ---- Bonus: the hat ---------------------------------------------------------

export type Spot = 'pumpkin' | 'books' | 'chair' | 'coffin';
export const SPOTS: readonly Spot[] = ['pumpkin', 'books', 'chair', 'coffin'];
export const SPOT_INFO: Record<Spot, { icon: string; name: string }> = {
  pumpkin: { icon: '🎃', name: 'Pumpkin' },
  books: { icon: '📚', name: 'Bookshelf' },
  chair: { icon: '🪑', name: 'Rocking chair' },
  coffin: { icon: '⚰️', name: 'Coffin' },
};

// ---- helpers -----------------------------------------------------------------

export function isObject(item: Item): item is GameObject {
  return (OBJECTS as readonly string[]).includes(item);
}
export function isKey(item: Item): item is KeySymbol {
  return (KEYS as readonly string[]).includes(item);
}
export function isSpot(item: Item): item is Spot {
  return (SPOTS as readonly string[]).includes(item);
}

export function pick<T>(list: readonly T[], random: () => number): T {
  return list[Math.min(list.length - 1, Math.floor(random() * list.length))];
}
