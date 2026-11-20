import type { Grid } from '../protocol/drawing';
import { cleanName, cleanText, encodePacket, isDrawingStep, packetKey, PLAYERS_MAX, PLAYERS_MIN, type Packet } from '../protocol/packet';

/**
 * Dial-Up Telephone game state for ONE player (one browser tab). Pure: no DOM,
 * no audio. Every device hears every chirp; this module decides what each
 * device is allowed to show.
 */

const SEEN_LIMIT = 64;
const RETIRED_LIMIT = 32;

export type Mode = 'host' | 'player';

export interface Profile {
  name: string;
  mode: Mode | null;
  /** 1 for the host, 2..8 for players. */
  seat: number | null;
}

export interface Entry {
  step: number;
  name: string;
  drawing?: Grid;
  text?: string;
}

export interface Game {
  gameId: number;
  players: number;
  host: string;
  seat: number;
  /** Known to the host from the start, to everyone else at the reveal. */
  word: string | null;
  /** By step ("1".."8"). Entries heard or sent by this device. */
  entries: Record<string, Entry>;
  revealed: boolean;
  startedAt: number;
  revealedAt: number | null;
}

export interface Stats {
  chirpsSent: number;
  chirpsHeard: number;
  bytesSent: number;
  airtimeMs: number;
}

export interface State {
  v: 1;
  profile: Profile;
  game: Game | null;
  seen: string[];
  sent: string[];
  retired: number[];
  /** Last chirp played, kept byte-identical for Resend. */
  lastSent: number[] | null;
  stats: Stats;
}

export type Phase = 'lobby' | 'host-setup' | 'ready' | 'my-turn' | 'waiting' | 'sent' | 'ready-to-reveal' | 'reveal';

export type ReceiveEvent =
  | { type: 'joined'; host: string; players: number; seat: number }
  | { type: 'not-ready'; host: string }
  | { type: 'seat-too-high'; host: string; players: number }
  | { type: 'entry'; step: number; name: string; forMe: boolean; last: boolean }
  | { type: 'revealed' }
  | { type: 'other-game' }
  | { type: 'stale' }
  | { type: 'duplicate' }
  | { type: 'own-echo' }
  | { type: 'ignored' };

const emptyStats = (): Stats => ({ chirpsSent: 0, chirpsHeard: 0, bytesSent: 0, airtimeMs: 0 });

export function initialState(): State {
  return { v: 1, profile: { name: '', mode: null, seat: null }, game: null, seen: [], sent: [], retired: [], lastSent: null, stats: emptyStats() };
}

function pushLimited<T>(list: T[], item: T, limit: number): T[] {
  return [...list.filter((x) => x !== item), item].slice(-limit);
}

const entryAt = (g: Game, step: number): Entry | undefined => g.entries[String(step)];

export function phaseOf(s: State): Phase {
  const g = s.game;
  if (!g) {
    if (s.profile.mode === 'host') return 'host-setup';
    if (s.profile.mode === 'player' && s.profile.seat && cleanName(s.profile.name)) return 'ready';
    return 'lobby';
  }
  if (g.revealed) return 'reveal';
  if (!entryAt(g, g.seat)) return g.seat === 1 || entryAt(g, g.seat - 1) ? 'my-turn' : 'waiting';
  if (g.seat === 1 && entryAt(g, g.players)) return 'ready-to-reveal';
  return 'sent';
}

/** The first step this device hasn't heard yet (who is up now, as far as it knows). */
export function currentStep(g: Game): number | null {
  for (let k = 1; k <= g.players; k++) if (!entryAt(g, k)) return k;
  return null;
}

/** What this player must respond to on their turn: the word (seat 1) or the previous entry. */
export function promptFor(g: Game): { kind: 'word'; text: string } | { kind: 'drawing'; drawing: Grid; from: string } | { kind: 'text'; text: string; from: string } | null {
  if (g.seat === 1) return g.word ? { kind: 'word', text: g.word } : null;
  const prev = entryAt(g, g.seat - 1);
  if (!prev) return null;
  if (prev.drawing) return { kind: 'drawing', drawing: prev.drawing, from: prev.name };
  return { kind: 'text', text: prev.text ?? '', from: prev.name };
}

/** Pure: apply a decoded packet. Anything not accepted returns the same state object. */
export function receive(s: State, p: Packet, now: number): { state: State; event: ReceiveEvent } {
  const key = packetKey(p);
  if (s.sent.includes(key)) return { state: s, event: { type: 'own-echo' } };
  if (s.seen.includes(key)) return { state: s, event: { type: 'duplicate' } };
  if (s.retired.includes(p.gameId)) return { state: s, event: { type: 'stale' } };
  const accept = (next: State, event: ReceiveEvent) => ({
    state: { ...next, seen: pushLimited(next.seen, key, SEEN_LIMIT), stats: { ...next.stats, chirpsHeard: next.stats.chirpsHeard + 1 } },
    event,
  });
  const g = s.game;

  if (p.type === 'start') {
    if (g && !g.revealed) return { state: s, event: { type: g.gameId === p.gameId ? 'ignored' : 'other-game' } };
    const { mode, seat, name } = s.profile;
    // Not added to the dedupe memory: after fixing their seat, a Resend can still let them join.
    if (mode !== 'player' || !seat || !cleanName(name)) return { state: s, event: { type: 'not-ready', host: p.name } };
    if (seat > p.players) return { state: s, event: { type: 'seat-too-high', host: p.name, players: p.players } };
    const retired = g ? pushLimited(s.retired, g.gameId, RETIRED_LIMIT) : s.retired;
    const game: Game = { gameId: p.gameId, players: p.players, host: p.name, seat, word: null, entries: {}, revealed: false, startedAt: now, revealedAt: null };
    return accept({ ...s, retired, game, lastSent: null }, { type: 'joined', host: p.name, players: p.players, seat });
  }

  if (!g || g.gameId !== p.gameId) return { state: s, event: { type: 'other-game' } };
  if (g.revealed) return { state: s, event: { type: 'ignored' } };

  if (p.type === 'entry') {
    if (p.step > g.players || entryAt(g, p.step)) return { state: s, event: { type: 'ignored' } };
    const entry: Entry = 'drawing' in p ? { step: p.step, name: p.name, drawing: p.drawing } : { step: p.step, name: p.name, text: p.text };
    const game = { ...g, entries: { ...g.entries, [String(p.step)]: entry } };
    return accept({ ...s, game }, { type: 'entry', step: p.step, name: p.name, forMe: p.step === g.seat - 1, last: p.step === g.players });
  }

  // reveal
  return accept({ ...s, game: { ...g, word: p.word, revealed: true, revealedAt: now } }, { type: 'revealed' });
}

export interface Outgoing {
  /** Commit only after the chirp has played. */
  state: State;
  packet: Packet;
  bytes: Uint8Array;
}

function recordSend(s: State, packet: Packet): Outgoing {
  const bytes = encodePacket(packet);
  return { packet, bytes, state: { ...s, sent: pushLimited(s.sent, packetKey(packet), SEEN_LIMIT), lastSent: Array.from(bytes) } };
}

export function setProfile(s: State, profile: Partial<Profile>): State {
  return { ...s, profile: { ...s.profile, ...profile } };
}

/** Host: start a new game. The host is always seat 1. */
export function startGame(s: State, opts: { players: number; word: string; gameId: number; now: number }): Outgoing | null {
  const name = cleanName(s.profile.name);
  const word = cleanText(opts.word);
  if (!name || !word || opts.players < PLAYERS_MIN || opts.players > PLAYERS_MAX) return null;
  if (s.game && !s.game.revealed) return null;
  let gameId = opts.gameId & 0xffff;
  while (s.retired.includes(gameId) || s.game?.gameId === gameId) gameId = (gameId + 1) & 0xffff;
  const retired = s.game ? pushLimited(s.retired, s.game.gameId, RETIRED_LIMIT) : s.retired;
  const game: Game = { gameId, players: opts.players, host: name, seat: 1, word, entries: {}, revealed: false, startedAt: opts.now, revealedAt: null };
  return recordSend(
    { ...s, retired, profile: { ...s.profile, name, mode: 'host', seat: 1 }, game, stats: emptyStats() },
    { type: 'start', gameId, players: opts.players, name },
  );
}

/** Send this player's entry: a drawing on odd seats, a guess on even seats. */
export function sendEntry(s: State, content: { drawing?: Grid; text?: string }): Outgoing | null {
  const g = s.game;
  if (!g || phaseOf(s) !== 'my-turn') return null;
  const step = g.seat;
  const name = cleanName(s.profile.name);
  if (!name) return null;
  let packet: Packet;
  let entry: Entry;
  if (isDrawingStep(step)) {
    if (!content.drawing || !content.drawing.some((r) => r.some(Boolean))) return null;
    const drawing = content.drawing.map((r) => [...r]);
    packet = { type: 'entry', gameId: g.gameId, step, name, drawing };
    entry = { step, name, drawing };
  } else {
    const text = cleanText(content.text ?? '');
    if (!text) return null;
    packet = { type: 'entry', gameId: g.gameId, step, name, text };
    entry = { step, name, text };
  }
  return recordSend({ ...s, game: { ...g, entries: { ...g.entries, [String(step)]: entry } } }, packet);
}

/** Host: reveal the chain once the last step has been heard. */
export function revealGame(s: State, now: number): Outgoing | null {
  const g = s.game;
  if (!g || g.seat !== 1 || !g.word || phaseOf(s) !== 'ready-to-reveal') return null;
  return recordSend({ ...s, game: { ...g, revealed: true, revealedAt: now } }, { type: 'reveal', gameId: g.gameId, players: g.players, word: g.word });
}

/** Leave the current game (or finish after a reveal). Players stay ready for the next start. */
export function leaveGame(s: State): State {
  const retired = s.game ? pushLimited(s.retired, s.game.gameId, RETIRED_LIMIT) : s.retired;
  return { ...s, game: null, retired, lastSent: null, stats: emptyStats() };
}

export function resendBytes(s: State): Uint8Array | null {
  return s.lastSent ? Uint8Array.from(s.lastSent) : null;
}

export function addAirtime(s: State, ms: number, bytes: number): State {
  const t = s.stats;
  return { ...s, stats: { ...t, chirpsSent: t.chirpsSent + 1, bytesSent: t.bytesSent + bytes, airtimeMs: t.airtimeMs + ms } };
}

// ---- the reveal ------------------------------------------------------------

export interface ChainCard {
  step: number;
  kind: 'word' | 'drawing' | 'text' | 'missing';
  name: string;
  text?: string;
  drawing?: Grid;
}

const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9]/g, '');

export function chain(g: Game): { cards: ChainCard[]; perfect: boolean | null; survivedHops: number } {
  const cards: ChainCard[] = [{ step: 0, kind: 'word', name: g.host, text: g.word ?? '?' }];
  for (let k = 1; k <= g.players; k++) {
    const e = entryAt(g, k);
    if (!e) cards.push({ step: k, kind: 'missing', name: `Seat ${k}` });
    else if (e.drawing) cards.push({ step: k, kind: 'drawing', name: e.name, drawing: e.drawing });
    else cards.push({ step: k, kind: 'text', name: e.name, text: e.text });
  }
  const word = norm(g.word ?? '');
  const guesses = cards.filter((c) => c.kind === 'text');
  const last = cards[cards.length - 1];
  const perfect = last.kind === 'text' ? norm(last.text ?? '') === word : null;
  // Hops survived: steps passed before the first guess that no longer matches the word.
  const firstWrong = guesses.find((c) => norm(c.text ?? '') !== word);
  const survivedHops = firstWrong ? firstWrong.step - 1 : g.players;
  return { cards, perfect, survivedHops };
}

// ---- persistence (per tab) -------------------------------------------------

export const STORAGE_KEY = 'dialup:v1';

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function loadState(store: KeyValueStore): State {
  try {
    const raw = store.getItem(STORAGE_KEY);
    if (!raw) return initialState();
    const p = JSON.parse(raw) as Partial<State>;
    if (p.v !== 1 || !p.profile || !Array.isArray(p.seen) || !Array.isArray(p.sent)) return initialState();
    return { ...initialState(), ...p } as State;
  } catch {
    return initialState();
  }
}

export function saveState(store: KeyValueStore, s: State): void {
  store.setItem(STORAGE_KEY, JSON.stringify(s));
}

export { PLAYERS_MAX, PLAYERS_MIN };
