import { houseReceive, houseRelease, newHouse, type House, type HouseOutcome, type ReleaseChoice } from '../game/house';
import { newOther, newRoom, otherReceive, otherReturn, type Other, type OtherOutcome, type ReturnChoice } from '../game/other';
import type { Grid } from '../protocol/drawing';
import { encodeMessage, transferKey, type GhostMessage } from '../protocol/message';

const SEEN_LIMIT = 64;
const RETIRED_LIMIT = 32;

export type Role = 'house' | 'other';

export interface Stats {
  chirpsSent: number;
  chirpsHeard: number;
  bytesSent: number;
  airtimeMs: number;
}

/** Everything one role remembers on this device. Stored per role (two windows can play on one laptop). */
export interface GameState {
  v: 4;
  role: Role;
  /** Transfer keys accepted (dedupe). Survives Play again. */
  seen: string[];
  /** Transfer keys this device sent (own-echo filter). Survives Play again. */
  sent: string[];
  /** Ghost IDs of finished or abandoned games. Their chirps are ignored. */
  retired: number[];
  /** Last played chirp, kept byte-identical for Resend. Cleared by Play again. */
  lastSent: { key: string; bytes: number[] } | null;
  nextTransferId: number;
  house: House | null;
  other: Other | null;
  stats: Stats;
}

export type ReceiveEvent =
  | { type: 'house'; outcome: HouseOutcome; message: GhostMessage }
  | { type: 'other'; outcome: OtherOutcome; message: GhostMessage }
  | { type: 'not-ours'; message: GhostMessage }
  | { type: 'stale'; message: GhostMessage }
  | { type: 'duplicate'; message: GhostMessage }
  | { type: 'own-echo'; message: GhostMessage };

const emptyStats = (): Stats => ({ chirpsSent: 0, chirpsHeard: 0, bytesSent: 0, airtimeMs: 0 });

export function initialState(role: Role, randomByte: number, random: () => number): GameState {
  return {
    v: 4,
    role,
    seen: [],
    sent: [],
    retired: [],
    lastSent: null,
    nextTransferId: randomByte & 0xff,
    house: null,
    other: role === 'other' ? newOther(newRoom(random)) : null,
    stats: emptyStats(),
  };
}

function pushLimited<T>(list: T[], item: T, limit: number): T[] {
  const next = list.filter((k) => k !== item);
  next.push(item);
  return next.slice(-limit);
}

/** Pure: apply a decoded message. Duplicates, own echoes and stale chirps return the same state object. */
export function receive(state: GameState, message: GhostMessage, now: number): { state: GameState; event: ReceiveEvent } {
  const key = transferKey(message);
  if (state.sent.includes(key)) return { state, event: { type: 'own-echo', message } };
  if (state.seen.includes(key)) return { state, event: { type: 'duplicate', message } };
  if (state.retired.includes(message.ghostId)) return { state, event: { type: 'stale', message } };

  const base: GameState = {
    ...state,
    seen: pushLimited(state.seen, key, SEEN_LIMIT),
    stats: { ...state.stats, chirpsHeard: state.stats.chirpsHeard + 1 },
  };

  if (message.direction === 'release') {
    if (!state.other) return { state, event: { type: 'not-ours', message } };
    const r = otherReceive(state.other, message, now);
    if (r.outcome.kind === 'not-ours') return { state, event: { type: 'not-ours', message } };
    if (r.outcome.kind === 'ignored') return { state, event: { type: 'other', outcome: r.outcome, message } };
    return { state: { ...base, other: r.other }, event: { type: 'other', outcome: r.outcome, message } };
  }
  if (!state.house || state.house.ghostId !== message.ghostId) return { state, event: { type: 'not-ours', message } };
  const r = houseReceive(state.house, message, now);
  if (r.outcome.kind === 'ignored') return { state, event: { type: 'house', outcome: r.outcome, message } };
  return { state: { ...base, house: r.house }, event: { type: 'house', outcome: r.outcome, message } };
}

export interface Outgoing {
  /** The state to commit once the chirp has actually played. */
  state: GameState;
  message: GhostMessage;
  bytes: Uint8Array;
}

function recordSend(state: GameState, message: GhostMessage): Outgoing {
  const bytes = encodeMessage(message);
  const key = transferKey(message);
  return {
    message,
    bytes,
    state: {
      ...state,
      sent: pushLimited(state.sent, key, SEEN_LIMIT),
      lastSent: { key, bytes: Array.from(bytes) },
      nextTransferId: (message.transferId + 1) & 0xff,
    },
  };
}

/** House: create a ghost and prepare the summon chirp. Nothing is stored until it is committed. */
export function houseStart(state: GameState, grid: Grid, name: string, ghostId: number, now: number): Outgoing | null {
  if (state.role !== 'house') return null;
  let id = ghostId & 0xffff;
  while (state.retired.includes(id)) id = (id + 1) & 0xffff;
  return houseSend({ ...state, house: newHouse(id, name.trim(), grid, now) }, {}, now);
}

/** House: prepare the chirp for the current phase. */
export function houseSend(state: GameState, choice: ReleaseChoice, now: number): Outgoing | null {
  const h = state.house;
  if (!h) return null;
  const r = houseRelease(h, choice, now);
  if (!r) return null;
  const out = recordSend(state, { direction: 'release', ghostId: h.ghostId, name: h.name, transferId: state.nextTransferId, ...r.draft });
  out.state = { ...out.state, house: r.house };
  return out;
}

/** Other Side: prepare the chirp for the current phase (accept, answer, verdict). */
export function otherSend(state: GameState, choice: ReturnChoice, now: number): Outgoing | null {
  if (!state.other) return null;
  const r = otherReturn(state.other, choice, now);
  if (!r) return null;
  const out = recordSend(state, { direction: 'return', transferId: state.nextTransferId, ...r.draft });
  out.state = { ...out.state, other: r.other };
  return out;
}

/**
 * Deliberate restart: retire this game's ghost, forget the last chirp,
 * clear the puzzle and rewards. De-duplication memory is kept so stale
 * chirps from the old game are still rejected.
 */
export function newGame(state: GameState, random: () => number): GameState {
  const ids = [state.house?.ghostId, state.other?.ghost?.ghostId, state.other?.candidate?.ghostId].filter(
    (x): x is number => typeof x === 'number',
  );
  let retired = state.retired;
  for (const id of ids) retired = pushLimited(retired, id, RETIRED_LIMIT);
  return {
    ...state,
    retired,
    lastSent: null,
    house: null,
    other: state.role === 'other' ? newOther(newRoom(random)) : null,
    stats: emptyStats(),
  };
}

export function resendBytes(state: GameState): Uint8Array | null {
  return state.lastSent ? Uint8Array.from(state.lastSent.bytes) : null;
}

/** Record one chirp actually played through the speaker. */
export function addAirtime(state: GameState, ms: number, bytes: number): GameState {
  const s = state.stats;
  return { ...state, stats: { ...s, chirpsSent: s.chirpsSent + 1, bytesSent: s.bytesSent + bytes, airtimeMs: s.airtimeMs + ms } };
}

/** True while a game is in progress on this device (used to offer Resume listening). */
export function inProgress(state: GameState): boolean {
  if (state.house) return state.house.phase !== 'free' && state.house.phase !== 'faded';
  if (state.other) return state.other.phase !== 'waiting' && state.other.phase !== 'over';
  return false;
}

// ---- persistence -------------------------------------------------------

export const storageKey = (role: Role) => `ghostfreq:v4:${role}`;

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function loadState(store: KeyValueStore, role: Role, randomByte: number, random: () => number): GameState {
  const fresh = () => initialState(role, randomByte, random);
  try {
    const raw = store.getItem(storageKey(role));
    if (!raw) return fresh();
    const parsed = JSON.parse(raw) as Partial<GameState>;
    if (parsed.v !== 4 || parsed.role !== role || !Array.isArray(parsed.seen) || !Array.isArray(parsed.sent)) return fresh();
    const s = { ...fresh(), ...parsed } as GameState;
    if (role === 'other' && !s.other) s.other = newOther(newRoom(random));
    return s;
  } catch {
    return fresh();
  }
}

export function saveState(store: KeyValueStore, state: GameState): void {
  store.setItem(storageKey(state.role), JSON.stringify(state));
}
