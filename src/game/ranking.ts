/**
 * Competition ranking ("1224"): equal points share a rank, and the next rank
 * skips the tied places. Scores 5, 5, 3 rank 1, 1, 3. The order of the input
 * never breaks a tie.
 */
export interface Ranked<T> {
  item: T;
  rank: number;
  /** Another player has the same points. */
  tied: boolean;
  /** Rank 1 (the winners, or the joint winners). */
  top: boolean;
}

export function competitionRanks<T extends { points: number; seat: number }>(list: readonly T[]): Ranked<T>[] {
  // Seat order only makes the display stable; it never changes a rank.
  const sorted = [...list].sort((a, b) => b.points - a.points || a.seat - b.seat);
  const count = new Map<number, number>();
  for (const x of sorted) count.set(x.points, (count.get(x.points) ?? 0) + 1);
  return sorted.map((item) => {
    const rank = 1 + sorted.filter((o) => o.points > item.points).length;
    return { item, rank, tied: (count.get(item.points) ?? 0) > 1, top: rank === 1 };
  });
}

/** Everyone ranked first. More than one means joint winners. */
export function topRanked<T extends { points: number; seat: number }>(list: readonly T[]): T[] {
  return competitionRanks(list)
    .filter((r) => r.top)
    .map((r) => r.item);
}

/**
 * Names for a winners line. Players who share a name get their seat added,
 * so "Bo (seat 2) and Bo (seat 3)" never reads as one person.
 */
export function winnerNames(list: readonly { name: string; seat: number }[], all: readonly { name: string; seat: number }[] = list): string[] {
  const n = (name: string) => all.filter((x) => x.name.toLowerCase() === name.toLowerCase()).length;
  return list.map((x) => (n(x.name) > 1 ? `${x.name} (seat ${x.seat})` : x.name));
}

/** "A", "A and B", "A, B and C". */
export function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}
