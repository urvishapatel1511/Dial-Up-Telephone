import { describe, expect, it } from 'vitest';
import { MATCH_ROUNDS, offsetFor, scoringChances, seatAt, stepOf } from '../src/game/match';
import { isDrawingStep } from '../src/protocol/packet';

const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

describe('Party Match rotation and fairness (R7.2, R7.3)', () => {
  it('seatAt and stepOf are inverse for every size and offset', () => {
    for (const n of range(2, 8)) {
      for (const off of range(0, n - 1)) {
        expect(range(1, n).map((k) => seatAt(k, n, off)).sort((a, b) => a - b)).toEqual(range(1, n));
        for (const k of range(1, n)) expect(stepOf(seatAt(k, n, off), n, off)).toBe(k);
      }
    }
  });

  it('round 1 is the classic order; the first drawer moves one seat each round', () => {
    for (const n of range(2, 8)) {
      expect(range(1, n).map((k) => seatAt(k, n, offsetFor(1, n)))).toEqual(range(1, n));
      const firsts = range(1, MATCH_ROUNDS).map((r) => seatAt(1, n, offsetFor(r, n)));
      expect(firsts).toEqual(range(1, MATCH_ROUNDS).map((r) => ((r - 1) % n) + 1));
    }
  });

  it('every seat gets exactly one scoring chance per round, for 2–8 players and every offset', () => {
    for (const n of range(2, 8)) {
      for (const off of range(0, n - 1)) expect(scoringChances(n, off)).toEqual(Array(n).fill(1));
    }
  });

  it('BUG FIX: with an odd count, the last drawer is no longer left without a chance', () => {
    for (const n of [3, 5, 7]) {
      const lastSeat = seatAt(n, n, 0);
      expect(isDrawingStep(n)).toBe(true);
      expect(scoringChances(n, 0)[lastSeat - 1]).toBe(1);
    }
  });

  it('over a 3-round match, every player both draws and guesses (N ≥ 3)', () => {
    for (const n of range(3, 8)) {
      for (const seat of range(1, n)) {
        const roles = range(1, MATCH_ROUNDS).map((r) => isDrawingStep(stepOf(seat, n, offsetFor(r, n))));
        expect(roles).toContain(true);
        expect(roles).toContain(false);
      }
    }
  });

  it('with 2 players the roles alternate, and seat 1 draws first twice (3 rounds, 2 seats)', () => {
    const roles = (seat: number) => range(1, 3).map((r) => (isDrawingStep(stepOf(seat, 2, offsetFor(r, 2))) ? 'draw' : 'guess'));
    expect(roles(1)).toEqual(['draw', 'guess', 'draw']);
    expect(roles(2)).toEqual(['guess', 'draw', 'guess']);
  });
});
