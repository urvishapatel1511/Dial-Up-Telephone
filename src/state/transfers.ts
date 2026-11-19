import { houseReceive, houseRelease, newHouse, type House, type HouseOutcome, type ReleaseChoice } from '../game/house';
import { newOther, newRoom, otherReceive, otherReturn, type Other, type OtherOutcome } from '../game/other';
import type { KeySymbol } from '../game/rules';
import type { Grid } from '../protocol/drawing';
import { encodeMessage, transferKey, type GhostMessage } from '../protocol/message';

const SEEN_LIMIT = 64;

export type Role = 'house' | 'other';

export interface Stats {
  chirpsSent: number;
  chirpsHeard: number;
  bytesSent: number;
  airtimeMs: number;
}

/** Everything one device (one role) remembers. Persisted per role, so two tabs can play on one laptop. */
export interface GameState {
  v: 3;
  role: Role;
  seen: string[];
  sent: string[];
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
  | { type: 'duplicate'; message: GhostMessage }
  | { type: 'own-echo'; message: GhostMessage };

const emptyStats = (): Stats => ({ chirpsSent: 0, chirpsHeard: 0, bytesSent: 0, airtimeMs: 0 });

export function initialState(role: Role, randomByte: number, random: () => number): GameState {
  return {
    v: 3,
    role,
    seen: [],
    sent: [],
    lastSent: null,
    nextTransferId: randomByte & 0xff,
    house: null,
    other: role === 'other' ? newOther(newRoom(random)) : null,
    stats: emptyStats(),
  };
}

function pushLimited(list: string[], key: string): string[] {
  const next = list.filter((k) => k !== key);
  next.push(key);
  return next.slice(-SEEN_LIMIT);
}

/** Pure: apply a decoded message. Duplicates and own echoes return the same state object. */
export function receive(state: GameState, message: GhostMessage, now: number): { state: GameState; event: ReceiveEvent } {
  const key = transferKey(message);
  if (state.sent.includes(key)) return { state, event: { type: 'own-echo', message } };
  if (state.seen.includes(key)) return { state, event: { type: 'duplicate', message } };

  const base: GameState = {
    ...state,
    seen: pushLimited(state.seen, key),
    stats: { ...state.stats, chirpsHeard: state.stats.chirpsHeard + 1 },
  };

  if (message.direction === 'release') {
    if (!state.other) return { state: base, event: { type: 'not-ours', message } };
    const r = otherReceive(state.other, message);
    return { state: { ...base, other: r.other }, event: { type: 'other', outcome: r.outcome, message } };
  }
  if (!state.house || state.house.ghostId !== message.ghostId) {
    return { state: base, event: { type: 'not-ours', message } };
  }
  const r = houseReceive(state.house, message, now);
  return { state: { ...base, house: r.house }, event: { type: 'house', outcome: r.outcome, message } };
}

export interface Outgoing {
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
      sent: pushLimited(state.sent, key),
      lastSent: { key, bytes: Array.from(bytes) },
      nextTransferId: (message.transferId + 1) & 0xff,
    },
  };
}

/** House: create a ghost and send it with the chosen object. */
export function houseStart(
  state: GameState,
  grid: Grid,
  name: string,
  ghostId: number,
  choice: ReleaseChoice,
  random: () => number,
  now: number,
): Outgoing | null {
  const house = newHouse(ghostId & 0xffff, name.trim(), grid, random, now);
  return houseSend({ ...state, house }, choice);
}

/** House: send the ghost for the current phase. */
export function houseSend(state: GameState, choice: ReleaseChoice): Outgoing | null {
  if (!state.house) return null;
  const r = houseRelease(state.house, choice);
  if (!r) return null;
  const out = recordSend(state, {
    direction: 'release',
    ghostId: state.house.ghostId,
    name: state.house.name,
    transferId: state.nextTransferId,
    ...r.draft,
  });
  out.state = { ...out.state, house: r.house };
  return out;
}

/** Other Side: send the ghost home with the answer for its current phase. */
export function otherSend(state: GameState, choice: { key?: KeySymbol } = {}): Outgoing | null {
  if (!state.other) return null;
  const r = otherReturn(state.other, choice);
  if (!r) return null;
  const out = recordSend(state, { direction: 'return', transferId: state.nextTransferId, ...r.draft });
  out.state = { ...out.state, other: r.other };
  return out;
}

/** Start over on this device, keeping the dedupe memory. */
export function newGame(state: GameState, random: () => number): GameState {
  return {
    ...state,
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
  return {
    ...state,
    stats: { ...s, chirpsSent: s.chirpsSent + 1, bytesSent: s.bytesSent + bytes, airtimeMs: s.airtimeMs + ms },
  };
}

// ---- persistence -------------------------------------------------------

export const storageKey = (role: Role) => `ghostfreq:v3:${role}`;

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
    if (parsed.v !== 3 || parsed.role !== role || !Array.isArray(parsed.seen) || !Array.isArray(parsed.sent)) {
      return fresh();
    }
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
