import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { competitionRanks, joinNames, topRanked, winnerNames } from '../src/game/ranking';

const row = (seat: number, points: number, name = `P${seat}`) => ({ seat, name, points });
const ranks = (list: ReturnType<typeof row>[]) => competitionRanks(list).map((r) => [r.item.seat, r.rank, r.top, r.tied]);

describe('competition ranking (equal points share a rank)', () => {
  it('normal rankings: 5, 3, 1 → 1, 2, 3', () => {
    expect(ranks([row(1, 3), row(2, 5), row(3, 1)])).toEqual([
      [2, 1, true, false],
      [1, 2, false, false],
      [3, 3, false, false],
    ]);
    expect(topRanked([row(1, 3), row(2, 5), row(3, 1)]).map((s) => s.seat)).toEqual([2]);
  });

  it('tied winners: 5, 5, 3 → 1, 1, 3, both highlighted as winners', () => {
    expect(ranks([row(1, 5), row(2, 3), row(3, 5)])).toEqual([
      [1, 1, true, true],
      [3, 1, true, true],
      [2, 3, false, false],
    ]);
    expect(topRanked([row(1, 5), row(2, 3), row(3, 5)]).map((s) => s.seat)).toEqual([1, 3]);
  });

  it('a tie further down skips places too: 5, 3, 3, 1 → 1, 2, 2, 4', () => {
    expect(competitionRanks([row(1, 1), row(2, 3), row(3, 5), row(4, 3)]).map((r) => r.rank)).toEqual([1, 2, 2, 4]);
  });

  it('all players tied: everyone is rank 1 and a joint winner', () => {
    const all = [row(1, 2), row(2, 2), row(3, 2), row(4, 2)];
    expect(competitionRanks(all).every((r) => r.rank === 1 && r.top && r.tied)).toBe(true);
    expect(topRanked(all)).toHaveLength(4);
    expect(competitionRanks([row(1, 0), row(2, 0)]).map((r) => r.rank)).toEqual([1, 1]);
  });

  it('property: input order never changes anyone’s rank, and ranks follow points', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 0, max: 6 }), { minLength: 1, maxLength: 8 }), fc.integer(), (points, seed) => {
        const list = points.map((p, i) => row(i + 1, p));
        const shuffled = [...list].sort((a, b) => ((a.seat * 7919 + seed) % 13) - ((b.seat * 7919 + seed) % 13));
        const bySeat = (rs: ReturnType<typeof competitionRanks>) => Object.fromEntries(rs.map((r) => [r.item.seat, r.rank]));
        expect(bySeat(competitionRanks(shuffled))).toEqual(bySeat(competitionRanks(list)));
        for (const a of list) {
          const rank = bySeat(competitionRanks(list))[a.seat];
          expect(rank).toBe(1 + list.filter((b) => b.points > a.points).length);
        }
      }),
    );
  });
});

describe('winner names', () => {
  it('players who share a name get their seat, so joint winners are never read as one person', () => {
    const all = [row(2, 5, 'Bo'), row(3, 5, 'Bo'), row(1, 1, 'Asha')];
    expect(winnerNames(topRanked(all), all)).toEqual(['Bo (seat 2)', 'Bo (seat 3)']);
    expect(winnerNames([row(1, 5, 'Asha')], all)).toEqual(['Asha']);
  });

  it('joins names in plain English', () => {
    expect(joinNames(['A'])).toBe('A');
    expect(joinNames(['A', 'B'])).toBe('A and B');
    expect(joinNames(['A', 'B', 'C'])).toBe('A, B and C');
  });
});
