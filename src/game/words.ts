/**
 * Built-in prompts, chosen to be drawable on a 16×16 grid without special
 * knowledge, and with no copyrighted characters. Every prompt is valid
 * protocol text (≤ 12 characters, single spaces). Checked by tests.
 */

export interface Category {
  id: number;
  name: string;
  icon: string;
}

export const CATEGORIES: readonly Category[] = [
  { id: 0, name: 'Mix of everything', icon: '🎲' },
  { id: 1, name: 'Spooky', icon: '🎃' },
  { id: 2, name: 'Everyday things', icon: '🏠' },
  { id: 3, name: 'Animals & food', icon: '🐸' },
  { id: 4, name: 'Silly combos', icon: '🤪' },
];

const SPOOKY = [
  'ghost', 'pumpkin', 'bat', 'spider', 'skull', 'witch hat', 'candle', 'moon', 'black cat', 'bone',
  'coffin', 'cauldron', 'broom', 'zombie', 'mummy', 'vampire', 'tombstone', 'owl', 'cobweb', 'skeleton',
  'eyeball', 'crystal ball', 'werewolf', 'haunted tree', 'potion',
];

const EVERYDAY = [
  'house', 'tree', 'sun', 'star', 'heart', 'boat', 'car', 'rocket', 'umbrella', 'cup',
  'crown', 'phone', 'clock', 'key', 'bell', 'castle', 'door', 'ladder', 'tv', 'lightning',
  'diamond', 'anchor', 'balloon', 'cloud', 'snowman', 'glasses', 'guitar', 'bicycle', 'lamp', 'chair',
  'kite', 'book', 'toothbrush', 'sock', 'hat', 'shoe', 'rainbow', 'tent', 'train', 'cactus',
];

const ANIMALS_FOOD = [
  'cat', 'fish', 'bird', 'duck', 'frog', 'snake', 'dog', 'cow', 'pig', 'mouse',
  'octopus', 'crab', 'snail', 'turtle', 'bee', 'apple', 'pizza', 'banana', 'ice cream', 'burger',
  'donut', 'cake', 'carrot', 'mushroom', 'egg', 'cheese', 'cookie', 'taco', 'pear', 'watermelon',
];

const COMBOS = [
  'ghost taxi', 'vampire DJ', 'zombie chef', 'sad robot', 'sleepy witch', 'haunted TV', 'disco skull', 'angry cloud',
  'pizza ghost', 'space cat', 'robot dog', 'shy monster', 'flying fish', 'crying onion', 'happy toast', 'sneaky snail',
  'giant spider', 'tiny dragon', 'cool pumpkin', 'pirate frog', 'mummy disco', 'lazy dragon', 'rocket cow', 'spooky sushi',
  'evil donut', 'punk pumpkin', 'bat on bike', 'surfer ghost', 'king of bats', 'scary carrot',
];

const unique = (list: string[]) => [...new Set(list)];

export const PROMPTS: Readonly<Record<number, readonly string[]>> = {
  0: unique([...SPOOKY, ...EVERYDAY, ...ANIMALS_FOOD, ...COMBOS]),
  1: SPOOKY,
  2: EVERYDAY,
  3: ANIMALS_FOOD,
  4: COMBOS,
};

export const categoryOf = (id: number): Category => CATEGORIES.find((c) => c.id === id) ?? CATEGORIES[0];

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/**
 * Deterministic suggestion: the same round and reroll count always give the
 * same word, and the first `list.length` rerolls never repeat a word.
 */
export function suggestWord(category: number, gameId: number, variant: number): string {
  const list = PROMPTS[category] ?? PROMPTS[0];
  const n = list.length;
  const start = Math.imul(gameId + 1, 2654435761) >>> 0;
  const stride = [7, 11, 13, 17, 19, 23, 29].find((s) => gcd(s, n) === 1) ?? 1;
  return list[(start % n + variant * stride) % n];
}
