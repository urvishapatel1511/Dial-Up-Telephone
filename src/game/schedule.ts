import { maskToSeats, PLAYERS_MAX } from '../protocol/packet';

/**
 * Reply slots. Every phone hears a `call` or `results` chirp end at the same
 * moment, so automatic replies are timed from that moment, one seat per slot,
 * and never overlap. Slots are longer than the longest reply chirp (checked
 * against the real encoder in tests/ggwave.test.ts).
 */
export const REPLY_GAP_MS = 900;
/** `hello` is at most 14 bytes. */
export const HELLO_SLOT_MS = 2400;
/** `ack` is 7 bytes. */
export const ACK_SLOT_MS = 1900;

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

/** Delay before this seat confirms the results (seat 1, the host, never acks). */
export function ackDelay(seat: number): number | null {
  return seat >= 2 && seat <= PLAYERS_MAX ? REPLY_GAP_MS + (seat - 2) * ACK_SLOT_MS : null;
}

/** How long the host should listen for all replies to a call. */
export function callWindowMs(confirmedMask: number, duplicateMask: number): number {
  const delays = Array.from({ length: PLAYERS_MAX - 1 }, (_, i) => helloDelay(i + 2, confirmedMask, duplicateMask)).filter((d): d is number => d !== null);
  return delays.length ? Math.max(...delays) + HELLO_SLOT_MS : 0;
}
