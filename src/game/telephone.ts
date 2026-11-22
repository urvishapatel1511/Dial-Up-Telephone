import type { Grid } from '../protocol/drawing';
import {
  ACK_RESULTS,
  cleanName,
  cleanText,
  DRAW_SIZE,
  encodePacket,
  isDrawingStep,
  maskToSeats,
  NEED_START,
  packetKey,
  PLAYERS_MAX,
  seatsToMask,
  PLAYERS_MIN,
  ROUNDS_MAX,
  type FinalGuess,
  type GameMode,
  type NoiseLevel,
  type Packet,
} from '../protocol/packet';
import { offsetFor, seatAt, stepOf } from './match';
import { noisyDrawing, noisyText } from './noise';
import { ackDelay, helloDelay } from './schedule';
import { suggestWord } from './words';

/**
 * Dial-Up Telephone game state for ONE player (one browser tab). Pure: no DOM,
 * no audio. Every device hears every chirp and stores the round; this module
 * decides what each device is allowed to show, and what it can resend.
 */

const SEEN_LIMIT = 96;
const RETIRED_LIMIT = 32;

export type Mode = 'host' | 'player';

export interface Profile {
  name: string;
  mode: Mode | null;
  /** Fixed seat at the table: 1 for the host, 2..8 for players. */
  seat: number | null;
  /**
   * Random ID of this browser tab (1..65535, 0 = not set yet). It identifies
   * the player in the ready check, so two players with the same name stay two players.
   */
  pid: number;
}

export interface Entry {
  step: number;
  name: string;
  drawing?: Grid;
  text?: string;
}

export interface Results {
  funniest: number;
  recognizable: number;
  recovery: number;
  final: FinalGuess;
}

export interface Game {
  gameId: number;
  players: number;
  host: string;
  seat: number;
  noise: NoiseLevel;
  mode: GameMode;
  matchId: number;
  round: number;
  category: number;
  offset: number;
  /** The secret word: chosen by the first drawer, carried by step 1, shown to others only at the reveal. */
  word: string | null;
  /** The first drawer's word choice before sending (local only). */
  wordDraft: { variant: number; custom: string };
  entries: Record<string, Entry>;
  revealed: boolean;
  results: Results | null;
  /** Name of another device that sent an entry for this device's step. */
  conflict: string | null;
  /** Host: seats that confirmed the results. Player: [own seat] once its confirmation played. */
  acks?: number[];
  /** Host: seats that confirmed the start signal. */
  joined?: number[];
  /** Hops whose next player said "got it" (heard by this device). */
  receipts?: number[];
  startedAt: number;
  revealedAt: number | null;
}

export interface RoundSummary {
  round: number;
  gameId: number;
  names: Record<string, string>;
  points: Record<string, number>;
}

export interface Match {
  matchId: number;
  players: number;
  rounds: RoundSummary[];
}

export interface Stats {
  chirpsSent: number;
  chirpsHeard: number;
  bytesSent: number;
  airtimeMs: number;
}

/** A phone heard in the ready check: its player ID and the name it showed. */
export interface LobbyPlayer {
  pid: number;
  name: string;
}

/** The ready check before a round (R9). */
export interface Lobby {
  owner: Mode;
  lobbyId: number;
  /**
   * Ready messages heard, seat → phones (by player ID, never by name).
   * Host: the roster. Player: other phones (for seat clashes).
   */
  seats: Record<string, LobbyPlayer[]>;
  /** Player: the host's latest ready check. */
  call: { host: string; players: number; confirmed: number[]; duplicate: number[] } | null;
  /** Player: a ready message has played (that is not the same as confirmed). */
  helloSent: boolean;
}

export interface State {
  v: 4;
  profile: Profile;
  game: Game | null;
  match: Match | null;
  lobby: Lobby | null;
  seen: string[];
  sent: string[];
  retired: number[];
  /** Last chirp played, kept byte-identical for Resend. */
  lastSent: number[] | null;
  stats: Stats;
}

export type Phase = 'lobby' | 'host-setup' | 'ready' | 'my-turn' | 'waiting' | 'sent' | 'missing' | 'ready-to-reveal' | 'reveal';

export type ReceiveEvent =
  /** `ackIn` = when this phone confirms the start to the host. */
  | { type: 'joined'; host: string; players: number; seat: number; noise: NoiseLevel; mode: GameMode; round: number; ackIn: number | null }
  /** The start of my current round again. `ackIn` is set while the host may not know I joined. */
  | { type: 'start-again'; ackIn: number | null }
  | { type: 'not-ready'; host: string }
  | { type: 'seat-too-high'; host: string; players: number }
  | { type: 'entry'; step: number; name: string; forMe: boolean; last: boolean; recovered: boolean }
  | { type: 'conflict'; name: string }
  | { type: 'revealed' }
  /** `again` = a repeat of results already applied (never re-scored). `ackIn` = when this phone confirms. */
  | { type: 'results'; again: boolean; ackIn: number | null }
  | { type: 'need'; step: number }
  | { type: 'call'; host: string; players: number; confirmed: boolean; duplicate: boolean; seatTooHigh: boolean; replyIn: number | null }
  | { type: 'hello'; seat: number; name: string; clash: boolean }
  /** `step` as in the ack packet: 0 results, 1..8 a hop arrived, 9 the start. */
  | { type: 'ack'; seat: number; step: number }
  /** A ready player heard a turn from a round it isn't in. */
  | { type: 'missed-start'; gameId: number }
  | { type: 'other-game' }
  | { type: 'stale' }
  | { type: 'duplicate' }
  | { type: 'own-echo' }
  | { type: 'ignored' };

const emptyStats = (): Stats => ({ chirpsSent: 0, chirpsHeard: 0, bytesSent: 0, airtimeMs: 0 });

export function initialState(pid = 0): State {
  return { v: 4, profile: { name: '', mode: null, seat: null, pid }, game: null, match: null, lobby: null, seen: [], sent: [], retired: [], lastSent: null, stats: emptyStats() };
}

/** Give this tab a player ID if it has none. `random16` returns any uint16; 0 is never used. */
export function withPlayerId(s: State, random16: () => number): State {
  if (s.profile.pid >= 1 && s.profile.pid <= 0xffff) return s;
  let pid = random16() & 0xffff;
  while (pid === 0) pid = random16() & 0xffff;
  return { ...s, profile: { ...s.profile, pid } };
}

function pushLimited<T>(list: T[], item: T, limit: number): T[] {
  return [...list.filter((x) => x !== item), item].slice(-limit);
}

export const entryAt = (g: Game, step: number): Entry | undefined => g.entries[String(step)];
/** This device's step in the current round. */
export const myStep = (g: Game) => stepOf(g.seat, g.players, g.offset);
export const seatOfStep = (g: Game, step: number) => seatAt(step, g.players, g.offset);

/** Steps this device has not heard. */
export function missingSteps(g: Game): number[] {
  return Array.from({ length: g.players }, (_, i) => i + 1).filter((k) => !entryAt(g, k));
}

/** Steps this device knows it missed: a later step was heard, or the round was revealed. */
export function knownMissed(g: Game): number[] {
  if (g.revealed) return missingSteps(g);
  let last = 0;
  for (let k = 1; k <= g.players; k++) if (entryAt(g, k)) last = k;
  return missingSteps(g).filter((k) => k < last);
}

/**
 * Names this device already learned for seats, from earlier rounds of the
 * match and from ready messages. Names only: never any entry content.
 */
export function knownNames(s: State): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [seat, players] of Object.entries(s.lobby?.seats ?? {})) if (players.length === 1) out[seat] = players[0].name;
  for (const r of s.match?.rounds ?? []) Object.assign(out, r.names);
  return out;
}

/** Name for a seat, if this device knows it. */
export function nameOfSeat(g: Game, seat: number, myName: string): string | null {
  if (seat === g.seat) return myName;
  const e = entryAt(g, stepOf(seat, g.players, g.offset));
  if (e) return e.name;
  return seat === 1 ? g.host : null;
}

export function phaseOf(s: State): Phase {
  const g = s.game;
  if (!g) {
    if (s.profile.mode === 'host') return 'host-setup';
    if (s.profile.mode === 'player' && s.profile.seat && cleanName(s.profile.name)) return 'ready';
    return 'lobby';
  }
  if (g.revealed) return 'reveal';
  const me = myStep(g);
  if (!entryAt(g, me)) return me === 1 || entryAt(g, me - 1) ? 'my-turn' : 'waiting';
  if (g.seat === 1 && entryAt(g, g.players)) return missingSteps(g).length ? 'missing' : 'ready-to-reveal';
  return 'sent';
}

/** The first step this device hasn't heard yet (who is up now, as far as it knows). */
export function currentStep(g: Game): number | null {
  for (let k = 1; k <= g.players; k++) if (!entryAt(g, k)) return k;
  return null;
}

// ---- the secret word (first drawer) -------------------------------------------

export function chosenWord(g: Game): string | null {
  const custom = g.wordDraft.custom;
  return custom.trim() ? cleanText(custom) : suggestWord(g.category, g.gameId, g.wordDraft.variant);
}

export function setWordDraft(s: State, draft: Partial<Game['wordDraft']>): State {
  if (!s.game) return s;
  return { ...s, game: { ...s.game, wordDraft: { ...s.game.wordDraft, ...draft } } };
}

// ---- static -------------------------------------------------------------------

export interface Arrived {
  drawing?: Grid;
  text?: string;
  /** Flipped cell indices (drawings). */
  flipped: number[];
  /** Changed character indices (guesses of unchanged length). */
  changed: number[];
  /** True if static changed anything. */
  altered: boolean;
}

/** An entry as it arrived at the next seat, after line static. Deterministic. */
export function arrivedEntry(g: Game, e: Entry): Arrived {
  if (e.drawing) {
    const r = noisyDrawing(e.drawing, g.gameId, e.step, g.noise);
    return { drawing: r.grid, flipped: r.flipped, changed: [], altered: r.flipped.length > 0 };
  }
  const r = noisyText(e.text ?? '', g.gameId, e.step, g.noise);
  return { text: r.text, flipped: [], changed: r.changed, altered: r.text !== e.text };
}

export type Prompt =
  | { kind: 'word'; text: string }
  | { kind: 'drawing'; drawing: Grid; from: string; altered: boolean }
  | { kind: 'text'; text: string; from: string; altered: boolean };

/** What this player responds to on their turn: their own word (step 1) or the previous entry as it arrived. */
export function promptFor(g: Game): Prompt | null {
  const me = myStep(g);
  if (me === 1) return { kind: 'word', text: g.word ?? chosenWord(g) ?? '' };
  const prev = entryAt(g, me - 1);
  if (!prev) return null;
  const a = arrivedEntry(g, prev);
  if (a.drawing) return { kind: 'drawing', drawing: a.drawing, from: prev.name, altered: a.altered };
  return { kind: 'text', text: a.text ?? '', from: prev.name, altered: a.altered };
}

/** The text clue the author of `step` was given (the word for step 1, else the previous guess after static). */
export function clueFor(g: Game, step: number): string | null {
  if (step === 1) return g.word;
  const prev = entryAt(g, step - 1);
  if (!prev?.text) return null;
  return arrivedEntry(g, prev).text ?? null;
}

// ---- receiving ----------------------------------------------------------------

function newGameFrom(p: Extract<Packet, { type: 'start' }>, seat: number, now: number): Game {
  return {
    gameId: p.gameId,
    players: p.players,
    host: p.name,
    seat,
    noise: p.noise,
    mode: p.mode,
    matchId: p.matchId,
    round: p.round,
    category: p.category,
    offset: offsetFor(p.round, p.players),
    word: null,
    wordDraft: { variant: 0, custom: '' },
    entries: {},
    revealed: false,
    results: null,
    conflict: null,
    acks: [],
    joined: [],
    receipts: [],
    startedAt: now,
    revealedAt: null,
  };
}

/** Add a finished (or abandoned) round of a match to the match record, once. */
function archive(match: Match | null, g: Game | null): Match | null {
  if (!g || g.mode !== 'match') return match;
  const m = match && match.matchId === g.matchId ? match : { matchId: g.matchId, players: g.players, rounds: [] };
  if (m.rounds.some((r) => r.gameId === g.gameId)) return m;
  return { ...m, rounds: [...m.rounds, summarize(g)] };
}

// ---- ready check (lobby) -------------------------------------------------------

const newLobby = (owner: Mode, lobbyId: number): Lobby => ({ owner, lobbyId, seats: {}, call: null, helloSent: false });

/** Host: open the ready check (keeps an existing host roster, e.g. between Quick Rounds). */
export function openLobby(s: State, lobbyId: number): State {
  return s.lobby?.owner === 'host' ? s : { ...s, lobby: newLobby('host', lobbyId & 0xffff) };
}

/**
 * Record that phone `pid` is at `seat` as `name`, moving it off any other seat
 * (a player who changed seat). Phones are matched by player ID only: another
 * phone with the same name is a different player and is never replaced.
 */
function placePlayer(lobby: Lobby, seat: number, pid: number, name: string): Lobby {
  const seats: Record<string, LobbyPlayer[]> = {};
  for (const [k, list] of Object.entries(lobby.seats)) {
    const rest = list.filter((x) => x.pid !== pid);
    if (rest.length) seats[k] = rest;
  }
  seats[String(seat)] = [...(seats[String(seat)] ?? []), { pid, name }];
  return { ...lobby, seats };
}

export interface RosterSeat {
  seat: number;
  names: string[];
  status: 'host' | 'ready' | 'missing' | 'duplicate' | 'extra';
}

/** Host: who is confirmed for an N-player game. Start needs every seat 2..N confirmed exactly once. */
export function roster(
  s: State,
  players: number,
): { seats: RosterSeat[]; canStart: boolean; missing: number[]; duplicate: number[]; extra: number[]; sameName: string[] } {
  const heard = s.lobby?.owner === 'host' ? s.lobby.seats : {};
  const top = Math.max(players, ...Object.keys(heard).map(Number).filter((k) => heard[String(k)]?.length));
  const seats: RosterSeat[] = [];
  for (let k = 1; k <= top; k++) {
    if (k === 1) {
      seats.push({ seat: 1, names: [cleanName(s.profile.name) ?? 'You'], status: 'host' });
      continue;
    }
    const names = (heard[String(k)] ?? []).map((x) => x.name);
    const status: RosterSeat['status'] = names.length > 1 ? 'duplicate' : k > players ? 'extra' : names.length === 1 ? 'ready' : 'missing';
    if (k <= players || names.length) seats.push({ seat: k, names, status });
  }
  const pick = (st: RosterSeat['status']) => seats.filter((x) => x.status === st).map((x) => x.seat);
  const duplicate = pick('duplicate');
  const missing = pick('missing');
  // Names shared by players on different seats: allowed (seats tell them apart), but worth a note.
  const count = new Map<string, number>();
  for (const x of seats) if (x.status === 'host' || x.status === 'ready') count.set(x.names[0].toLowerCase(), (count.get(x.names[0].toLowerCase()) ?? 0) + 1);
  const sameName = seats
    .filter((x) => (x.status === 'host' || x.status === 'ready') && (count.get(x.names[0].toLowerCase()) ?? 0) > 1)
    .map((x) => x.names[0])
    .filter((n, i, all) => all.findIndex((m) => m.toLowerCase() === n.toLowerCase()) === i);
  return { seats, missing, duplicate, extra: pick('extra'), sameName, canStart: missing.length === 0 && !duplicate.some((k) => k <= players) };
}

/** Host: the ready-check chirp. Confirmed and duplicated seats stay quiet; everyone else answers in turn. */
export function callPacket(s: State, players: number): Outgoing | null {
  const name = cleanName(s.profile.name);
  const lobby = s.lobby;
  if (!name || lobby?.owner !== 'host' || players < PLAYERS_MIN || players > PLAYERS_MAX) return null;
  const r = roster(s, players);
  const confirmed = [1, ...r.seats.filter((x) => x.status === 'ready' || (x.status === 'extra' && x.names.length === 1)).map((x) => x.seat)];
  const p: Packet = { type: 'call', gameId: lobby.lobbyId, players, name, confirmed: seatsToMask(confirmed), duplicate: seatsToMask(r.duplicate) };
  return outgoingFor(s, p, { keepLast: true });
}

/** Player: "I'm ready" (only played after the microphone started). */
export function helloPacket(s: State): Outgoing | null {
  const name = cleanName(s.profile.name);
  const { seat, pid } = s.profile;
  if (s.profile.mode !== 'player' || !name || !seat || !(pid >= 1 && pid <= 0xffff)) return null;
  const lobby = s.lobby?.owner === 'player' ? s.lobby : newLobby('player', 0);
  const out = outgoingFor(s, { type: 'hello', gameId: lobby.lobbyId, seat, name, pid }, { keepLast: true });
  return { ...out, state: { ...out.state, lobby: { ...lobby, helloSent: true } } };
}

/** Player: what the host's last ready check said about this seat. */
export function readyStatus(s: State): { helloSent: boolean; confirmed: boolean; duplicate: boolean; clash: string[]; seatTooHigh: number | null; host: string | null } {
  const lobby = s.lobby?.owner === 'player' ? s.lobby : null;
  const seat = s.profile.seat ?? 0;
  const call = lobby?.call ?? null;
  return {
    helloSent: !!lobby?.helloSent,
    confirmed: !!call?.confirmed.includes(seat),
    duplicate: !!call?.duplicate.includes(seat),
    // Other phones on my seat, even if they use my name.
    clash: (lobby?.seats[String(seat)] ?? []).filter((x) => x.pid !== s.profile.pid).map((x) => x.name),
    seatTooHigh: call && seat > call.players ? call.players : null,
    host: call?.host ?? null,
  };
}

function receiveLobby(s: State, p: Extract<Packet, { type: 'call' } | { type: 'hello' }>): { state: State; event: ReceiveEvent } {
  const same = { state: s, event: { type: 'ignored' } as ReceiveEvent };
  const { mode, seat } = s.profile;
  const me = cleanName(s.profile.name);
  if (p.type === 'hello') {
    if (p.seat === 1) return same;
    if (p.pid === s.profile.pid) return { state: s, event: { type: 'own-echo' } };
    if (mode !== 'host' && mode !== 'player') return same;
    const base = s.lobby ?? newLobby(mode, p.gameId);
    const here = base.seats[String(p.seat)]?.find((x) => x.pid === p.pid);
    const elsewhere = Object.entries(base.seats).some(([k, list]) => k !== String(p.seat) && list.some((x) => x.pid === p.pid));
    const already = here?.name === p.name && !elsewhere;
    const lobby = already && s.lobby ? s.lobby : placePlayer(base, p.seat, p.pid, p.name);
    const others = lobby.seats[String(p.seat)] ?? [];
    const clash = mode === 'host' ? others.length > 1 : p.seat === seat;
    const event: ReceiveEvent = { type: 'hello', seat: p.seat, name: p.name, clash };
    return { state: lobby === s.lobby ? s : { ...s, lobby }, event };
  }
  // call: only a ready player outside an active round takes part
  if (mode !== 'player' || !seat || !me || (s.game && !s.game.revealed)) return same;
  const prev = s.lobby?.owner === 'player' ? s.lobby : null;
  const lobby: Lobby = {
    ...(prev && prev.lobbyId === p.gameId ? prev : newLobby('player', p.gameId)),
    helloSent: prev?.helloSent ?? false,
    call: { host: p.name, players: p.players, confirmed: maskToSeats(p.confirmed), duplicate: maskToSeats(p.duplicate) },
  };
  const confirmed = lobby.call!.confirmed.includes(seat);
  const duplicate = lobby.call!.duplicate.includes(seat);
  return {
    state: { ...s, lobby },
    event: { type: 'call', host: p.name, players: p.players, confirmed, duplicate, seatTooHigh: seat > p.players, replyIn: helloDelay(seat, p.confirmed, p.duplicate) },
  };
}

// ---- confirmations ------------------------------------------------------------

/**
 * The seat that confirms hop `step` arrived: the next player, or the host for
 * the last hop (it needs it for the reveal). Null when the author is that seat.
 */
export function receiverSeat(g: Game, step: number): number | null {
  const seat = step < g.players ? seatOfStep(g, step + 1) : 1;
  return seat === seatOfStep(g, step) ? null : seat;
}

/**
 * True once this device has evidence that hop `step` reached the next player:
 * their "got it", any later hop, or the reveal. Playback alone is never evidence.
 */
export function hopDelivered(g: Game, step: number): boolean {
  if (!entryAt(g, step)) return false;
  if (receiverSeat(g, step) === null || g.revealed || (g.receipts ?? []).includes(step)) return true;
  for (let k = step + 1; k <= g.players; k++) if (entryAt(g, k)) return true;
  return false;
}

/** Host: seats 2..N with evidence that they are in this round (start confirmed, a hop, or a "got it"). */
export function joinedSeats(g: Game): number[] {
  const seats = new Set(g.joined ?? []);
  for (let k = 1; k <= g.players; k++) if (entryAt(g, k)) seats.add(seatOfStep(g, k));
  for (const k of g.receipts ?? []) {
    const r = receiverSeat(g, k);
    if (r) seats.add(r);
  }
  seats.delete(1);
  return [...seats].filter((x) => x >= 2 && x <= g.players).sort((a, b) => a - b);
}

/** Host: seats that haven't confirmed the start yet. */
export function awaitingJoin(g: Game): number[] {
  const joined = joinedSeats(g);
  return Array.from({ length: g.players - 1 }, (_, i) => i + 2).filter((k) => !joined.includes(k));
}

const addTo = (list: number[] | undefined, v: number) => ((list ?? []).includes(v) ? null : [...(list ?? []), v].sort((a, b) => a - b));

function receiveAck(s: State, p: Extract<Packet, { type: 'ack' }>): { state: State; event: ReceiveEvent } {
  const g = s.game;
  const ignored = { state: s, event: { type: 'ignored' } as ReceiveEvent };
  if (!g || g.gameId !== p.gameId || p.seat < 1 || p.seat > g.players) return ignored;
  const event: ReceiveEvent = { type: 'ack', seat: p.seat, step: p.step };
  let game: Game | null = null;
  if (p.step === ACK_RESULTS) {
    // Players confirm results and the start to the host; the host never confirms its own.
    if (g.seat !== 1 || !g.results || p.seat === 1) return ignored;
    const acks = addTo(g.acks, p.seat);
    if (acks) game = { ...g, acks };
  } else if (p.step === NEED_START) {
    if (g.seat !== 1 || p.seat === 1) return ignored;
    const joined = addTo(g.joined, p.seat);
    if (joined) game = { ...g, joined };
  } else {
    // "Got hop k": only from the seat that receives hop k.
    if (p.step > g.players || receiverSeat(g, p.step) !== p.seat) return ignored;
    const receipts = addTo(g.receipts, p.step);
    if (receipts) game = { ...g, receipts };
  }
  return { state: game ? { ...s, game } : s, event };
}

/**
 * The next player's "got it" for hop `step`, or null if this device is not
 * that player or doesn't hold the hop. Sent again for every copy heard, so a
 * lost "got it" is repaired by the author's retry.
 */
export function receiptPacket(s: State, step: number): Outgoing | null {
  const g = s.game;
  if (!g || g.revealed || step < 1 || step > g.players || !entryAt(g, step) || receiverSeat(g, step) !== g.seat) return null;
  return outgoingFor(s, { type: 'ack', gameId: g.gameId, seat: g.seat, step }, { keepLast: true });
}

/** Player: confirm the start signal to the host. */
export function startAckPacket(s: State): Outgoing | null {
  const g = s.game;
  if (!g || g.seat === 1 || g.revealed) return null;
  return outgoingFor(s, { type: 'ack', gameId: g.gameId, seat: g.seat, step: NEED_START }, { keepLast: true });
}

/** Pure: apply a decoded packet. Anything not accepted returns the same state object. */
export function receive(s: State, p: Packet, now: number): { state: State; event: ReceiveEvent } {
  // Ready-check chirps are idempotent and are never remembered as seen.
  if (p.type === 'call' || p.type === 'hello') return receiveLobby(s, p);
  const g = s.game;
  // Confirmations are idempotent sets of seats or hops, so they are never remembered as seen.
  if (p.type === 'ack') return receiveAck(s, p);

  const key = packetKey(p);
  if (s.sent.includes(key)) return { state: s, event: { type: 'own-echo' } };
  if (s.retired.includes(p.gameId)) return { state: s, event: { type: 'stale' } };

  // The start of my current round again (a retry, or an answer to a late player).
  // Confirm again only while I haven't played my hop: after that, my hop itself tells the host I'm in.
  if (p.type === 'start' && g && g.gameId === p.gameId && !g.revealed) {
    const again = g.seat !== 1 && !entryAt(g, myStep(g));
    return { state: s, event: { type: 'start-again', ackIn: again ? ackDelay(g.seat) : null } };
  }

  // Requests are never remembered as "seen": the same hop can be asked for again.
  if (p.type === 'need') {
    if (!g || g.gameId !== p.gameId) return { state: s, event: { type: 'other-game' } };
    return { state: s, event: { type: 'need', step: p.step } };
  }

  // Repeated results: confirm again (the host may have missed it), never re-score.
  if (p.type === 'results' && g && g.gameId === p.gameId && (g.results || s.seen.includes(key))) {
    return { state: s, event: { type: 'results', again: true, ackIn: g.seat === 1 ? null : ackDelay(g.seat) } };
  }

  // A ready player hearing a turn of a round it isn't in missed the start signal.
  const ready = s.profile.mode === 'player' && !!s.profile.seat && !!cleanName(s.profile.name);
  if (p.type === 'entry' && ready && (!g || (g.revealed && g.gameId !== p.gameId))) {
    return { state: s, event: { type: 'missed-start', gameId: p.gameId } };
  }

  if (s.seen.includes(key)) return { state: s, event: { type: 'duplicate' } };
  const accept = (next: State, event: ReceiveEvent) => ({
    state: { ...next, seen: pushLimited(next.seen, key, SEEN_LIMIT), stats: { ...next.stats, chirpsHeard: next.stats.chirpsHeard + 1 } },
    event,
  });

  if (p.type === 'start') {
    const nextOfMatch = !!g && p.mode === 'match' && g.mode === 'match' && g.matchId === p.matchId && p.round > g.round;
    if (g && !g.revealed && !nextOfMatch) return { state: s, event: { type: g.gameId === p.gameId ? 'ignored' : 'other-game' } };
    const { mode, seat, name } = s.profile;
    // Not remembered as seen: after fixing their seat, a resend can still let them join.
    if (mode !== 'player' || !seat || !cleanName(name)) return { state: s, event: { type: 'not-ready', host: p.name } };
    if (seat > p.players) return { state: s, event: { type: 'seat-too-high', host: p.name, players: p.players } };
    let match = p.mode === 'match' ? archive(s.match, g) : null;
    if (p.mode === 'match' && (!match || match.matchId !== p.matchId)) match = { matchId: p.matchId, players: p.players, rounds: [] };
    const retired = g ? pushLimited(s.retired, g.gameId, RETIRED_LIMIT) : s.retired;
    return accept(
      { ...s, retired, match, game: newGameFrom(p, seat, now), lastSent: null },
      { type: 'joined', host: p.name, players: p.players, seat, noise: p.noise, mode: p.mode, round: p.round, ackIn: ackDelay(seat) },
    );
  }

  if (!g || g.gameId !== p.gameId) return { state: s, event: { type: 'other-game' } };

  if (p.type === 'entry') {
    // Fill gaps, before or after the reveal; never overwrite an accepted entry.
    if (p.step > g.players || entryAt(g, p.step)) return { state: s, event: { type: 'ignored' } };
    const entry: Entry = 'drawing' in p ? { step: p.step, name: p.name, drawing: p.drawing } : { step: p.step, name: p.name, text: p.text };
    // My own chirps were filtered above (s.sent), so an entry for my step came from another
    // phone on my seat, whatever name it uses.
    const mine = p.step === myStep(g);
    const conflict = mine ? p.name : g.conflict;
    const word = p.step === 1 && 'drawing' in p && p.word ? p.word : g.word;
    const game: Game = { ...g, word, conflict, entries: { ...g.entries, [String(p.step)]: entry } };
    if (mine) return accept({ ...s, game }, { type: 'conflict', name: p.name });
    return accept(
      { ...s, game },
      { type: 'entry', step: p.step, name: p.name, forMe: p.step === myStep(g) - 1, last: p.step === g.players, recovered: g.revealed },
    );
  }

  if (p.type === 'reveal') {
    if (g.revealed) return { state: s, event: { type: 'ignored' } };
    return accept({ ...s, game: { ...g, revealed: true, revealedAt: now } }, { type: 'revealed' });
  }

  // results (also implies the reveal, for devices that missed it)
  const results: Results = { funniest: p.funniest, recognizable: p.recognizable, recovery: p.recovery, final: p.final };
  return accept(
    { ...s, game: { ...g, results, revealed: true, revealedAt: g.revealedAt ?? now } },
    { type: 'results', again: false, ackIn: g.seat === 1 ? null : ackDelay(g.seat) },
  );
}

// ---- sending --------------------------------------------------------------------

export interface Outgoing {
  /** Commit only after the chirp has played. */
  state: State;
  packet: Packet;
  bytes: Uint8Array;
}

/**
 * Record a chirp to play. Exported so recovery replies can be played one by
 * one. Automatic replies (`keepLast`) don't replace what "Resend my last
 * chirp" plays.
 */
export function outgoingFor(s: State, packet: Packet, opts: { keepLast?: boolean } = {}): Outgoing {
  const bytes = encodePacket(packet);
  return {
    packet,
    bytes,
    state: { ...s, sent: pushLimited(s.sent, packetKey(packet), SEEN_LIMIT), lastSent: opts.keepLast ? s.lastSent : Array.from(bytes) },
  };
}

export function setProfile(s: State, profile: Partial<Profile>): State {
  return { ...s, profile: { ...s.profile, ...profile } };
}

/** The packet for a stored entry: byte-identical to the one first sent. */
export function entryPacket(g: Game, e: Entry): Packet {
  if (e.drawing) {
    return e.step === 1
      ? { type: 'entry', gameId: g.gameId, step: 1, name: e.name, drawing: e.drawing, word: g.word ?? '' }
      : { type: 'entry', gameId: g.gameId, step: e.step, name: e.name, drawing: e.drawing };
  }
  return { type: 'entry', gameId: g.gameId, step: e.step, name: e.name, text: e.text ?? '' };
}

export const startPacketOf = (g: Game): Packet => ({
  type: 'start',
  gameId: g.gameId,
  players: g.players,
  name: g.host,
  noise: g.noise,
  mode: g.mode,
  matchId: g.matchId,
  round: g.round,
  category: g.category,
});

function freshId(s: State, id: number): number {
  let gameId = id & 0xffff;
  while (s.retired.includes(gameId) || s.game?.gameId === gameId) gameId = (gameId + 1) & 0xffff;
  return gameId;
}

export interface StartOptions {
  players: number;
  gameId: number;
  now: number;
  noise?: NoiseLevel;
  mode?: GameMode;
  category?: number;
}

/** Host: start a Quick Round or round 1 of a Party Match. The host is always seat 1. */
export function startGame(s: State, opts: StartOptions): Outgoing | null {
  const name = cleanName(s.profile.name);
  if (!name || opts.players < PLAYERS_MIN || opts.players > PLAYERS_MAX) return null;
  if (s.game && !s.game.revealed) return null;
  const gameId = freshId(s, opts.gameId);
  const mode = opts.mode ?? 'quick';
  const p = { type: 'start' as const, gameId, players: opts.players, name, noise: opts.noise ?? 0, mode, matchId: gameId, round: 1, category: opts.category ?? 0 };
  const retired = s.game ? pushLimited(s.retired, s.game.gameId, RETIRED_LIMIT) : s.retired;
  const game = { ...newGameFrom(p, 1, opts.now) };
  const match = mode === 'match' ? { matchId: gameId, players: opts.players, rounds: [] } : null;
  return outgoingFor({ ...s, retired, match, profile: { ...s.profile, name, mode: 'host', seat: 1 }, game, stats: emptyStats() }, p);
}

/** Host: start the next round of the current Party Match (same players, line, and category). */
export function nextRound(s: State, gameId: number, now: number): Outgoing | null {
  const g = s.game;
  // Results are required: the next start retires this round, and with it any recovery.
  if (!g || g.seat !== 1 || g.mode !== 'match' || !g.revealed || !g.results || g.round >= ROUNDS_MAX) return null;
  const id = freshId(s, gameId);
  const p = { ...(startPacketOf(g) as Extract<Packet, { type: 'start' }>), gameId: id, round: g.round + 1 };
  return outgoingFor(
    { ...s, match: archive(s.match, g), retired: pushLimited(s.retired, g.gameId, RETIRED_LIMIT), game: newGameFrom(p, 1, now), stats: emptyStats() },
    p,
  );
}

/** Send this player's entry: a drawing on odd steps (step 1 also carries the chosen word), a guess on even steps. */
export function sendEntry(s: State, content: { drawing?: Grid; text?: string }): Outgoing | null {
  const g = s.game;
  if (!g || phaseOf(s) !== 'my-turn') return null;
  const step = myStep(g);
  const name = cleanName(s.profile.name);
  if (!name) return null;
  let entry: Entry;
  let word = g.word;
  if (isDrawingStep(step)) {
    const d = content.drawing;
    if (!d || d.length !== DRAW_SIZE || !d.some((r) => r.some(Boolean))) return null;
    if (step === 1) {
      word = chosenWord(g);
      if (!word) return null;
    }
    entry = { step, name, drawing: d.map((r) => [...r]) };
  } else {
    const text = cleanText(content.text ?? '');
    if (!text) return null;
    entry = { step, name, text };
  }
  const game: Game = { ...g, word, entries: { ...g.entries, [String(step)]: entry } };
  return outgoingFor({ ...s, game }, entryPacket(game, entry));
}

/** Host: reveal. A normal reveal needs every step; `force` is the labelled fallback with missing hops. */
export function revealGame(s: State, now: number, force = false): Outgoing | null {
  const g = s.game;
  const phase = phaseOf(s);
  if (!g || g.seat !== 1 || !(phase === 'ready-to-reveal' || (force && phase === 'missing'))) return null;
  return outgoingFor({ ...s, game: { ...g, revealed: true, revealedAt: now } }, { type: 'reveal', gameId: g.gameId, players: g.players });
}

/** Which hops may receive each award. */
export function awardOptions(g: Game): { funniest: number[]; recognizable: number[]; recovery: number[]; finalGuess: boolean } {
  const present = Array.from({ length: g.players }, (_, i) => i + 1).filter((k) => entryAt(g, k));
  return {
    funniest: present.filter((k) => k >= 2),
    recognizable: present.filter((k) => isDrawingStep(k)),
    recovery: present.filter((k) => {
      const prev = k >= 2 ? entryAt(g, k - 1) : undefined;
      return !!prev && arrivedEntry(g, prev).altered;
    }),
    finalGuess: g.players % 2 === 1 && !!entryAt(g, g.players),
  };
}

/** Host: record the out-loud votes (and the room's final guess) in one chirp. Once per round. */
export function sendResults(s: State, r: Results): Outgoing | null {
  const g = s.game;
  if (!g || g.seat !== 1 || !g.revealed || g.results) return null;
  const o = awardOptions(g);
  const ok = (v: number, list: number[]) => v === 0 || list.includes(v);
  if (!ok(r.funniest, o.funniest) || !ok(r.recognizable, o.recognizable) || !ok(r.recovery, o.recovery)) return null;
  if (r.final !== 0 && !o.finalGuess) return null;
  return outgoingFor({ ...s, game: { ...g, results: { ...r } } }, { type: 'results', gameId: g.gameId, ...r });
}

/** Ask the room for a missed hop (0 = the reveal and results). */
export function askFor(s: State, step: number): Outgoing | null {
  const g = s.game;
  if (!g || step < 0 || step > g.players || (step > 0 && entryAt(g, step))) return null;
  return outgoingFor(s, { type: 'need', gameId: g.gameId, step });
}

/**
 * Automatic answer to a request. Only ONE device answers each request: the
 * author of the step, or the host for step 0. Others may relay by hand.
 */
export function autoAnswer(s: State, step: number): Packet[] {
  const g = s.game;
  if (!g) return [];
  if (step === NEED_START) return g.seat === 1 ? [startPacketOf(g)] : [];
  if (step === 0) {
    if (g.seat !== 1 || !g.revealed) return [];
    const out: Packet[] = [{ type: 'reveal', gameId: g.gameId, players: g.players }];
    if (g.results) out.push({ type: 'results', gameId: g.gameId, ...g.results });
    return out;
  }
  const e = entryAt(g, step);
  return myStep(g) === step && e ? [entryPacket(g, e)] : [];
}

/** A ready player who missed a round's start asks the host for it (only the host answers). */
export function askToJoin(s: State, gameId: number): Outgoing | null {
  if (s.profile.mode !== 'player' || !s.profile.seat || (s.game && !s.game.revealed)) return null;
  return outgoingFor(s, { type: 'need', gameId: gameId & 0xffff, step: NEED_START }, { keepLast: true });
}

/** Player: confirm the results to the host. Recorded locally as acks = [own seat]. */
export function ackPacket(s: State): Outgoing | null {
  const g = s.game;
  if (!g || g.seat === 1 || !g.results) return null;
  const out = outgoingFor(s, { type: 'ack', gameId: g.gameId, seat: g.seat, step: ACK_RESULTS }, { keepLast: true });
  return { ...out, state: { ...out.state, game: { ...g, acks: [g.seat] } } };
}

/** Host: replay the results byte-identically (players re-confirm; nothing is re-scored). */
export function resendResults(s: State): Outgoing | null {
  const g = s.game;
  return g && g.seat === 1 && g.results ? outgoingFor(s, { type: 'results', gameId: g.gameId, ...g.results }) : null;
}

/** Host: seats (2..N) that haven't confirmed the results yet. */
export function awaitingAcks(g: Game): number[] {
  const acks = g.acks ?? [];
  return Array.from({ length: g.players - 1 }, (_, i) => i + 2).filter((k) => !acks.includes(k));
}

/** True if this device holds a hop that someone asked for, but is not its author (manual relay). */
export function canRelay(s: State, step: number): boolean {
  const g = s.game;
  return !!g && step >= 1 && myStep(g) !== step && !!entryAt(g, step);
}

/** Resend any held entry, byte-identical. */
export function resendEntry(s: State, step: number): Outgoing | null {
  const g = s.game;
  const e = g && entryAt(g, step);
  return g && e ? outgoingFor(s, entryPacket(g, e)) : null;
}

/** Host: resend the start signal for late joiners. */
export function resendStart(s: State): Outgoing | null {
  const g = s.game;
  return g && g.seat === 1 ? outgoingFor(s, startPacketOf(g)) : null;
}

/** Leave the round. In a match, the round is kept in the totals unless the match ends. */
export function leaveGame(s: State, endMatch = false): State {
  const g = s.game;
  const retired = g ? pushLimited(s.retired, g.gameId, RETIRED_LIMIT) : s.retired;
  const match = endMatch || g?.mode !== 'match' ? null : archive(s.match, g);
  return { ...s, game: null, match, retired, lastSent: null, stats: emptyStats() };
}

export function resendBytes(s: State): Uint8Array | null {
  return s.lastSent ? Uint8Array.from(s.lastSent) : null;
}

export function addAirtime(s: State, ms: number, bytes: number): State {
  const t = s.stats;
  return { ...s, stats: { ...t, chirpsSent: t.chirpsSent + 1, bytesSent: t.bytesSent + bytes, airtimeMs: t.airtimeMs + ms } };
}

// ---- matching ----------------------------------------------------------------

export const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9]/g, '');

function editDistance(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

/** Same word, ignoring case, spaces and punctuation; one wrong letter allowed for words of 5+ letters. */
export function close(a: string, b: string): boolean {
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return false;
  if (x === y) return true;
  return Math.min(x.length, y.length) >= 5 && editDistance(x, y) <= 1;
}

// ---- the reveal ------------------------------------------------------------

export interface ChainCard {
  step: number;
  seat: number;
  kind: 'word' | 'drawing' | 'text' | 'missing';
  name: string;
  text?: string;
  drawing?: Grid;
  /** The text clue this author was given (for drawings), after static. */
  clue: string | null;
  /** How static changed this entry on its way to the next seat (null if unchanged or the last hop). */
  arrived: Arrived | null;
}

export function chain(g: Game): { cards: ChainCard[]; perfect: boolean | null; survivedHops: number } {
  const cards: ChainCard[] = [{ step: 0, seat: seatOfStep(g, 1), kind: 'word', name: entryAt(g, 1)?.name ?? `Seat ${seatOfStep(g, 1)}`, text: g.word ?? '?', clue: null, arrived: null }];
  for (let k = 1; k <= g.players; k++) {
    const e = entryAt(g, k);
    const seat = seatOfStep(g, k);
    if (!e) {
      cards.push({ step: k, seat, kind: 'missing', name: `Seat ${seat}`, clue: null, arrived: null });
      continue;
    }
    const a = k < g.players ? arrivedEntry(g, e) : null;
    const arrived = a && a.altered ? a : null;
    if (e.drawing) cards.push({ step: k, seat, kind: 'drawing', name: e.name, drawing: e.drawing, clue: clueFor(g, k), arrived });
    else cards.push({ step: k, seat, kind: 'text', name: e.name, text: e.text, clue: null, arrived });
  }
  const word = g.word ?? '';
  const guesses = cards.filter((c) => c.kind === 'text');
  const last = cards[cards.length - 1];
  const perfect = last.kind === 'text' ? close(last.text ?? '', word) : null;
  const firstWrong = guesses.find((c) => !close(c.text ?? '', word));
  const survivedHops = firstWrong ? firstWrong.step - 1 : g.players;
  return { cards, perfect, survivedHops };
}

export interface Score {
  seat: number;
  name: string;
  points: number;
  notes: string[];
}

/**
 * Every seat has exactly one scoring chance per round: as drawer or guesser of
 * a pair, or (odd player counts) as the last drawer judged by the room's
 * out-loud guess. Awards are +1 each.
 */
export function scores(g: Game): Score[] {
  const table = new Map<number, Score>();
  for (let k = 1; k <= g.players; k++) {
    const seat = seatOfStep(g, k);
    const name = entryAt(g, k)?.name ?? (seat === 1 ? g.host : null);
    if (name) table.set(seat, { seat, name, points: 0, notes: [] });
  }
  const add = (step: number, note: string) => {
    const s = table.get(seatOfStep(g, step));
    if (s) {
      s.points++;
      s.notes.push(note);
    }
  };
  for (let k = 1; k + 1 <= g.players; k += 2) {
    const drawing = entryAt(g, k);
    const guess = entryAt(g, k + 1);
    const seen = clueFor(g, k);
    if (!drawing || !guess?.text || !seen) continue;
    if (close(guess.text, seen)) {
      add(k, `${guess.name} guessed your drawing`);
      add(k + 1, `guessed ${drawing.name}'s drawing`);
    }
  }
  const r = g.results;
  if (r) {
    if (r.final === 1) add(g.players, 'the room guessed your final drawing');
    if (r.funniest) add(r.funniest, 'Funniest Transformation');
    if (r.recognizable) add(r.recognizable, 'Most Recognizable Drawing');
    if (r.recovery) add(r.recovery, 'Best Recovery');
  }
  return [...table.values()].sort((a, b) => b.points - a.points || a.seat - b.seat);
}

export function summarize(g: Game): RoundSummary {
  const names: Record<string, string> = {};
  const points: Record<string, number> = {};
  for (const s of scores(g)) {
    names[String(s.seat)] = s.name;
    points[String(s.seat)] = s.points;
  }
  return { round: g.round, gameId: g.gameId, names, points };
}

export interface Standing {
  seat: number;
  name: string;
  points: number;
}

/** Party Match totals: archived rounds plus the current round. */
export function matchStandings(s: State): { standings: Standing[]; rounds: number } {
  const g = s.game;
  const rounds = [...(s.match?.rounds ?? [])];
  if (g && g.mode === 'match' && g.revealed && !rounds.some((r) => r.gameId === g.gameId)) rounds.push(summarize(g));
  const table = new Map<number, Standing>();
  for (const r of rounds) {
    for (const [seat, pts] of Object.entries(r.points)) {
      const n = Number(seat);
      const cur = table.get(n) ?? { seat: n, name: r.names[seat], points: 0 };
      table.set(n, { ...cur, name: r.names[seat] ?? cur.name, points: cur.points + pts });
    }
  }
  return { standings: [...table.values()].sort((a, b) => b.points - a.points || a.seat - b.seat), rounds: rounds.length };
}

export function matchOver(s: State): boolean {
  const g = s.game;
  return !!g && g.mode === 'match' && g.round >= ROUNDS_MAX && g.revealed && !!g.results;
}

// ---- persistence (per tab) -------------------------------------------------

export const STORAGE_KEY = 'dialup:v4';
/** The previous version's key. Only the name, role, and seat carry over: its rounds used v3 chirps. */
export const OLD_STORAGE_KEY = 'dialup:v3';

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function parse(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as unknown;
    return p && typeof p === 'object' ? (p as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function loadState(store: KeyValueStore): State {
  const p = parse(store.getItem(STORAGE_KEY)) as Partial<State> | null;
  if (p) {
    if (p.v !== 4 || !p.profile || !Array.isArray(p.seen) || !Array.isArray(p.sent)) return initialState();
    return { ...initialState(), ...p, profile: { ...initialState().profile, ...p.profile } } as State;
  }
  const old = parse(store.getItem(OLD_STORAGE_KEY));
  const prof = old?.v === 3 && old.profile && typeof old.profile === 'object' ? (old.profile as Partial<Profile>) : null;
  if (!prof) return initialState();
  const mode = prof.mode === 'host' || prof.mode === 'player' ? prof.mode : null;
  const seat = typeof prof.seat === 'number' && prof.seat >= 1 && prof.seat <= PLAYERS_MAX ? prof.seat : null;
  return setProfile(initialState(), { name: typeof prof.name === 'string' ? prof.name : '', mode, seat });
}

export function saveState(store: KeyValueStore, s: State): void {
  store.setItem(STORAGE_KEY, JSON.stringify(s));
}

export { PLAYERS_MAX, PLAYERS_MIN };
