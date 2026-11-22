import { NEED_START } from '../protocol/packet';
import { ackWindowMs, NEED_WINDOW_MS, RECEIPT_WINDOW_MS } from './schedule';
import { awaitingAcks, awaitingJoin, entryAt, hopDelivered, myStep, type State } from './telephone';

/**
 * Delivery of one chirp this phone sent (pure: the caller passes the clock).
 *
 *   playing → waiting → confirmed
 *                     → (no confirmation in time) playing again, up to maxAttempts
 *                     → unconfirmed: a retry button, no more automatic plays
 *
 * Playback finishing only moves a chirp to "waiting". It is "confirmed" only
 * when this phone hears evidence that it arrived (see `delivered`).
 *
 * Only the phone that sent a chirp retries it, a bounded number of times, and
 * only after every expected reply had time to arrive. So a retry never
 * overlaps a reply, other phones never repeat it, and it can't loop forever.
 */
export type DeliveryKind = 'entry' | 'start' | 'results' | 'need';
export type DeliveryStatus = 'playing' | 'waiting' | 'confirmed' | 'unconfirmed';

export interface Delivery {
  kind: DeliveryKind;
  gameId: number;
  /** entry: the hop · need: the hop asked for (0 reveal/results, 9 start) · start/results: 0. */
  step: number;
  /** Times played successfully. */
  attempts: number;
  /** Plays allowed without a tap: 1 + automatic retries. */
  maxAttempts: number;
  status: DeliveryStatus;
  /** End of the current wait (caller's clock), while waiting. */
  deadline: number | null;
  /** The last playback failed (a sound problem on this phone). */
  failed: boolean;
  /** need 0 asked after the reveal: the answer is the results. */
  wantsResults: boolean;
}

/** Automatic retries per kind. Requests are never repeated automatically: a person decides to ask again. */
export const AUTO_RETRIES: Record<DeliveryKind, number> = { entry: 2, start: 1, results: 1, need: 0 };

/** Extra time after the last expected reply, for decoding and timers. */
export const CONFIRM_MARGIN_MS = 1600;

/** How long to wait for confirmation after a chirp of this kind finished playing. */
export function waitMs(kind: DeliveryKind, players: number): number {
  switch (kind) {
    case 'entry':
      return RECEIPT_WINDOW_MS + CONFIRM_MARGIN_MS;
    case 'start':
    case 'results':
      return ackWindowMs(players) + CONFIRM_MARGIN_MS;
    case 'need':
      return NEED_WINDOW_MS + CONFIRM_MARGIN_MS;
  }
}

export function newDelivery(kind: DeliveryKind, gameId: number, step: number, opts: { wantsResults?: boolean } = {}): Delivery {
  return { kind, gameId, step, attempts: 0, maxAttempts: 1 + AUTO_RETRIES[kind], status: 'playing', deadline: null, failed: false, wantsResults: !!opts.wantsResults };
}

/** A tap on a retry button: one more play, and no further automatic ones. */
export function manualRetry(d: Delivery): Delivery {
  return { ...d, status: 'playing', deadline: null, failed: false, maxAttempts: d.attempts + 1 };
}

/** The chirp finished playing: now wait for confirmation. */
export function played(d: Delivery, now: number, players: number): Delivery {
  return { ...d, attempts: d.attempts + 1, status: 'waiting', deadline: now + waitMs(d.kind, players), failed: false };
}

/** The chirp couldn't play. Nothing was sent, so it is not waiting for anything. */
export function playFailed(d: Delivery): Delivery {
  return { ...d, status: 'unconfirmed', deadline: null, failed: true };
}

/** A retry couldn't start (this phone was busy): try again a little later, without using an attempt. */
export function postpone(d: Delivery, now: number, ms: number): Delivery {
  return { ...d, status: 'waiting', deadline: now + ms };
}

/** Is this delivery about the round this device is in? (A request to join is about a round it isn't in yet.) */
export function relevant(s: State, d: Delivery): boolean {
  if (d.kind === 'need' && d.step === NEED_START) return true;
  return s.game?.gameId === d.gameId;
}

/** Evidence, from what this device heard, that the chirp arrived. */
export function delivered(s: State, d: Delivery): boolean {
  const g = s.game;
  if (!g || g.gameId !== d.gameId) return false;
  switch (d.kind) {
    case 'entry':
      return hopDelivered(g, d.step);
    case 'start':
      return g.seat === 1 && awaitingJoin(g).length === 0;
    case 'results':
      return g.seat === 1 && !!g.results && awaitingAcks(g).length === 0;
    case 'need':
      if (d.step === NEED_START) return !g.revealed;
      if (d.step === 0) return d.wantsResults ? !!g.results : g.revealed;
      return !!entryAt(g, d.step) && myStep(g) !== d.step;
  }
}

export type CheckResult = { delivery: Delivery; retry: boolean } | null;

/**
 * Re-evaluate a delivery. Null = no longer relevant (a new round). `retry` =
 * play it again now (status is then "playing"; call `played` or `playFailed` after).
 */
export function check(d: Delivery, s: State, now: number): CheckResult {
  if (!relevant(s, d)) return null;
  if (d.status === 'confirmed') return { delivery: d, retry: false };
  if (d.attempts > 0 && delivered(s, d)) return { delivery: { ...d, status: 'confirmed', deadline: null, failed: false }, retry: false };
  if (d.status !== 'waiting' || d.deadline === null || now < d.deadline) return { delivery: d, retry: false };
  if (d.attempts < d.maxAttempts) return { delivery: { ...d, status: 'playing', deadline: null }, retry: true };
  return { delivery: { ...d, status: 'unconfirmed', deadline: null }, retry: false };
}
