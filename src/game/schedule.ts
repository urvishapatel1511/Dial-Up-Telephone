import { maskToSeats, PLAYERS_MAX, type Packet } from '../protocol/packet';

/**
 * Reply slots. Every phone hears a `call`, `start`, `results`, or `entry`
 * chirp end at the same moment, so automatic replies are timed from that
 * moment, one seat per slot, and never overlap. Slots are longer than the
 * longest reply chirp (checked against the real encoder in tests/ggwave.test.ts).
 */
export const REPLY_GAP_MS = 900;
/** `hello` is at most 16 bytes. */
export const HELLO_SLOT_MS = 2400;
/** `ack` is 8 bytes. */
export const ACK_SLOT_MS = 1900;
/** The author of a hop answers a request after this pause (the asker's speaker is quiet by then). */
export const ANSWER_DELAY_MS = 900;
/** The longest answer to a request: a 58-byte first drawing, or reveal + results (synthetic ≈ 4.5 s). */
export const LONGEST_ANSWER_MS = 5500;

/**
 * Delay before this seat answers a ready check, or null if it should stay
 * quiet (already confirmed, or on a duplicated seat).
 */
export function helloDelay(seat: number, confirmedMask: number, duplicateMask: number): number | null {
  const quiet = new Set([1, ...maskToSeats(confirmedMask), ...maskToSeats(duplicateMask)]);
  if (quiet.has(seat)) return null;
  const order = Array.from({ length: PLAYERS_MAX - 1 }, (_, i) => i + 2).filter((s) => !quiet.has(s));
  return REPLY_GAP_MS + order.indexOf(seat) * HELLO_SLOT_MS;
}

/** Delay before this seat confirms the start signal or the results (seat 1, the host, never confirms). */
export function ackDelay(seat: number): number | null {
  return seat >= 2 && seat <= PLAYERS_MAX ? REPLY_GAP_MS + (seat - 2) * ACK_SLOT_MS : null;
}

/** Delay before the next player says "got it" for a hop. Only one phone sends it, so it needs no slot. */
export const RECEIPT_DELAY_MS = REPLY_GAP_MS;

/** How long the host should listen for all replies to a call. */
export function callWindowMs(confirmedMask: number, duplicateMask: number): number {
  const delays = Array.from({ length: PLAYERS_MAX - 1 }, (_, i) => helloDelay(i + 2, confirmedMask, duplicateMask)).filter((d): d is number => d !== null);
  return delays.length ? Math.max(...delays) + HELLO_SLOT_MS : 0;
}

/** How long every seat 2..N takes to confirm a start or results chirp. */
export function ackWindowMs(players: number): number {
  return players >= 2 ? (ackDelay(players) ?? 0) + ACK_SLOT_MS : 0;
}

/** How long the next player takes to say "got it" for a hop. */
export const RECEIPT_WINDOW_MS = RECEIPT_DELAY_MS + ACK_SLOT_MS;

/** How long the author takes to answer a request. */
export const NEED_WINDOW_MS = ANSWER_DELAY_MS + LONGEST_ANSWER_MS;

/**
 * After hearing `p`, how long other phones are expected to be answering
 * automatically. Nobody should start a new chirp in that time, or it would
 * collide with a reply. `players` is the round's player count when known.
 */
export function replyWindowMs(p: Packet, players: number | null): number {
  switch (p.type) {
    case 'call':
      return callWindowMs(p.confirmed, p.duplicate);
    case 'start':
      return ackWindowMs(p.players);
    case 'results':
      return ackWindowMs(players ?? PLAYERS_MAX);
    case 'entry':
      return RECEIPT_WINDOW_MS;
    case 'need':
      return NEED_WINDOW_MS;
    default:
      return 0;
  }
}
