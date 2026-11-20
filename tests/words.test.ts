import { describe, expect, it } from 'vitest';
import { CATEGORIES, categoryOf, PROMPTS, suggestWord } from '../src/game/words';
import { CATEGORY_MAX, cleanText } from '../src/protocol/packet';

describe('prompt categories (R5)', () => {
  it('has the five categories, and every ID fits in the start packet', () => {
    expect(CATEGORIES.map((c) => c.name)).toEqual(['Mix of everything', 'Spooky', 'Everyday things', 'Animals & food', 'Silly combos']);
    for (const c of CATEGORIES) {
      expect(c.id).toBeLessThanOrEqual(CATEGORY_MAX);
      expect(PROMPTS[c.id].length).toBeGreaterThanOrEqual(20);
    }
    expect(categoryOf(99)).toBe(CATEGORIES[0]);
  });

  it('every prompt is valid protocol text in canonical form', () => {
    for (const list of Object.values(PROMPTS)) for (const w of list) expect(cleanText(w)).toBe(w);
  });

  it('prompts are unique within each category (ignoring case)', () => {
    for (const list of Object.values(PROMPTS)) expect(new Set(list.map((w) => w.toLowerCase())).size).toBe(list.length);
  });

  it('includes the requested silly combos', () => {
    for (const w of ['ghost taxi', 'vampire DJ', 'zombie chef', 'sad robot', 'sleepy witch', 'haunted TV']) expect(PROMPTS[4]).toContain(w);
  });

  it('uses plain words only: letters and single spaces, no digits or punctuation', () => {
    for (const list of Object.values(PROMPTS)) for (const w of list) expect(w).toMatch(/^[A-Za-z]+( [A-Za-z]+)*$/);
  });

  it('suggestions are deterministic, and rerolls do not repeat until the list is exhausted', () => {
    for (const c of CATEGORIES) {
      const list = PROMPTS[c.id];
      expect(suggestWord(c.id, 1234, 0)).toBe(suggestWord(c.id, 1234, 0));
      const seen = new Set(Array.from({ length: list.length }, (_, v) => suggestWord(c.id, 1234, v)));
      expect(seen.size).toBe(list.length);
      for (const w of seen) expect(list).toContain(w);
    }
  });

  it('different rounds usually start with different suggestions', () => {
    const firsts = new Set(Array.from({ length: 50 }, (_, id) => suggestWord(0, id, 0)));
    expect(firsts.size).toBeGreaterThan(20);
  });
});
