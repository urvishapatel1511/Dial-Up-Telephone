/**
 * Rotation for Party Match (and Quick Round = round 1). The chain starts one
 * seat later each round and goes round the table.
 */
export const MATCH_ROUNDS = 3;

export const offsetFor = (round: number, players: number) => (round - 1) % players;

/** Seat that makes step k. */
export const seatAt = (step: number, players: number, offset: number) => ((step - 1 + offset) % players) + 1;

/** Step made by a seat. */
export const stepOf = (seat: number, players: number, offset: number) => ((((seat - 1 - offset) % players) + players) % players) + 1;

/**
 * Scoring chances per seat (index seat - 1) in one round: drawer and guesser
 * of each pair (k, k+1), plus the room's final guess on the last drawing when
 * N is odd. Every seat gets exactly one.
 */
export function scoringChances(players: number, offset: number): number[] {
  const chances = Array<number>(players).fill(0);
  for (let k = 1; k + 1 <= players; k += 2) {
    chances[seatAt(k, players, offset) - 1]++;
    chances[seatAt(k + 1, players, offset) - 1]++;
  }
  if (players % 2 === 1) chances[seatAt(players, players, offset) - 1]++;
  return chances;
}
