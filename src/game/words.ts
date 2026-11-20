/** Secret words chosen to be drawable on an 8×8 grid. All are 1-12 characters. */
export const WORDS: readonly string[] = [
  'ghost', 'pumpkin', 'bat', 'spider', 'skull', 'witch hat', 'candle', 'moon', 'cat', 'bone',
  'house', 'tree', 'sun', 'star', 'heart', 'fish', 'boat', 'car', 'rocket', 'umbrella',
  'apple', 'pizza', 'cup', 'crown', 'robot', 'snake', 'flower', 'cloud', 'snowman', 'smile',
  'eye', 'key', 'bell', 'clock', 'phone', 'sword', 'castle', 'door', 'ladder', 'mushroom',
  'cactus', 'bird', 'duck', 'frog', 'tv', 'arrow', 'lightning', 'diamond', 'anchor', 'balloon',
];

export function randomWord(random: () => number, not?: string): string {
  for (let i = 0; i < 10; i++) {
    const w = WORDS[Math.min(WORDS.length - 1, Math.floor(random() * WORDS.length))];
    if (w !== not) return w;
  }
  return WORDS[0];
}
