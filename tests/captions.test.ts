import { describe, expect, it } from 'vitest';
import { captionFor, fairNote, STATIC_TEXT_NOTE } from '../src/game/captions';
import { chain, initialState, receive, setProfile, type Entry, type Game } from '../src/game/telephone';
import { emptyGrid } from '../src/protocol/drawing';

/** A revealed round built directly from entries (Clear line unless noise is given). */
function revealed(entries: Omit<Entry, 'step'>[], word: string, noise: 0 | 1 | 2 = 0): Game {
  const p = setProfile(initialState(), { name: 'Bo', mode: 'player', seat: 2 });
  const g = receive(p, { type: 'start', gameId: 77, players: entries.length, name: 'Asha', noise, mode: 'quick', matchId: 77, round: 1, category: 0 }, 0).state.game!;
  return { ...g, word, revealed: true, entries: Object.fromEntries(entries.map((e, i) => [String(i + 1), { ...e, step: i + 1 }])) };
}

const dot = () => {
  const d = emptyGrid(16);
  d[3][3] = true;
  return d;
};

describe('reveal captions (R6.3)', () => {
  it('celebrates a match and a mutation, using only known text', () => {
    const g = revealed(
      [
        { name: 'Asha', drawing: dot() },
        { name: 'Bo', text: 'cat' },
        { name: 'Cy', drawing: dot() },
        { name: 'Dee', text: 'city' },
      ],
      'cat',
    );
    const cards = chain(g).cards;
    expect(captionFor(g, cards[0])).toBe('The secret word, picked by Asha.');
    expect(captionFor(g, cards[1])).toBe('Asha was asked to draw “CAT”.');
    expect(captionFor(g, cards[2])).toBe('✓ Still “CAT”: Bo got it!');
    expect(captionFor(g, cards[4])).toBe('“CAT” became “CITY”! Your message took an unexpected turn.');
  });

  it('never claims what a drawing shows', () => {
    const g = revealed(
      [
        { name: 'Asha', drawing: dot() },
        { name: 'Bo', text: 'moon' },
        { name: 'Cy', drawing: dot() },
      ],
      'sun',
      2,
    );
    for (const card of chain(g).cards.filter((c) => c.kind === 'drawing')) {
      const text = captionFor(g, card);
      expect(text).toMatch(/was asked to draw|drew this/);
      expect(text).not.toMatch(/looks like|shows|is a /i);
    }
    expect(captionFor(g, chain(g).cards[1])).toMatch(/Static changed 24 squares/);
  });

  it('describes missing hops plainly', () => {
    const g = revealed([{ name: 'Asha', drawing: dot() }, { name: 'Bo', text: 'cat' }], 'cat');
    delete g.entries['2'];
    expect(captionFor(g, chain(g).cards[2])).toBe('This phone missed hop 2. Ask for it by sound below.');
  });
});

describe('player text', () => {
  it('uses the exact static message requested for corrupted text clues', () => {
    expect(STATIC_TEXT_NOTE).toBe('Draw whatever this makes you imagine—even if it’s nonsense.');
  });

  it('explains the one scoring chance for even and odd counts', () => {
    expect(fairNote(4, 'quick')).toMatch(/each player gets one chance/);
    expect(fairNote(5, 'quick')).toMatch(/whole room guesses it out loud/);
    expect(fairNote(5, 'match')).toMatch(/first drawer moves one seat/);
  });
});
