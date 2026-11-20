import type { Grid } from '../protocol/drawing';
import {
  cleanName,
  cleanText,
  DRAW_SIZE,
  encodePacket,
  isDrawingStep,
  packetKey,
  PLAYERS_MAX,
  PLAYERS_MIN,
  type NoiseLevel,
  type Packet,
} from '../protocol/packet';
import { noisyDrawing, noisyText } from './noise';

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
  noise: NoiseLevel;
  /** Known to the host from the start, to everyone else at the reveal. */
  word: string | null;
  /** By step ("1".."8"). Entries heard or sent by this device. */
  entries: Record<string, Entry>;
  revealed: boolean;
  /** Step of the Worst Connection winner. */
  award: number | null;
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
  v: 2;
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
  | { type: 'joined'; host: string; players: number; seat: number; noise: NoiseLevel }
  | { type: 'not-ready'; host: string }
  | { type: 'seat-too-high'; host: string; players: number }
  | { type: 'entry'; step: number; name: string; forMe: boolean; last: boolean }
  | { type: 'revealed' }
  | { type: 'awarded'; step: number; name: string }
  | { type: 'other-game' }
  | { type: 'stale' }
  | { type: 'duplicate' }
  | { type: 'own-echo' }
  | { type: 'ignored' };

const emptyStats = (): Stats => ({ chirpsSent: 0, chirpsHeard: 0, bytesSent: 0, airtimeMs: 0 });

export function initialState(): State {
  return { v: 2, profile: { name: '', mode: null, seat: null }, game: null, seen: [], sent: [], retired: [], lastSent: null, stats: emptyStats() };
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

export interface Arrived {
  drawing?: Grid;
  text?: string;
  /** Flipped cell indices (drawings). */
  flipped: number[];
  /** Changed character indices (guesses). */
  changed: number[];
}

/** An entry as it arrived at the next seat, after line static. Deterministic. */
export function arrivedEntry(g: Game, e: Entry): Arrived {
  if (e.drawing) {
    const r = noisyDrawing(e.drawing, g.gameId, e.step, g.noise);
    return { drawing: r.grid, flipped: r.flipped, changed: [] };
  }
  const r = noisyText(e.text ?? '', g.gameId, e.step, g.noise);
  return { text: r.text, flipped: [], changed: r.changed };
}

/** What this player must respond to on their turn: the word (seat 1) or the previous entry, with static. */
export function promptFor(
  g: Game,
): { kind: 'word'; text: string } | { kind: 'drawing'; drawing: Grid; from: string } | { kind: 'text'; text: string; from: string } | null {
  if (g.seat === 1) return g.word ? { kind: 'word', text: g.word } : null;
  const prev = entryAt(g, g.seat - 1);
  if (!prev) return null;
  const a = arrivedEntry(g, prev);
  if (a.drawing) return { kind: 'drawing', drawing: a.drawing, from: prev.name };
  return { kind: 'text', text: a.text ?? '', from: prev.name };
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
    const game: Game = {
      gameId: p.gameId,
      players: p.players,
      host: p.name,
      seat,
      noise: p.noise,
      word: null,
      entries: {},
      revealed: false,
      award: null,
      startedAt: now,
      revealedAt: null,
    };
    return accept({ ...s, retired, game, lastSent: null }, { type: 'joined', host: p.name, players: p.players, seat, noise: p.noise });
  }

  if (!g || g.gameId !== p.gameId) return { state: s, event: { type: 'other-game' } };

  if (p.type === 'award') {
    const e = entryAt(g, p.step);
    if (!g.revealed || g.award !== null || p.step > g.players) return { state: s, event: { type: 'ignored' } };
    return accept({ ...s, game: { ...g, award: p.step } }, { type: 'awarded', step: p.step, name: e?.name ?? `Seat ${p.step}` });
  }

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
export function startGame(s: State, opts: { players: number; word: string; gameId: number; now: number; noise?: NoiseLevel }): Outgoing | null {
  const name = cleanName(s.profile.name);
  const word = cleanText(opts.word);
  const noise = opts.noise ?? 0;
  if (!name || !word || opts.players < PLAYERS_MIN || opts.players > PLAYERS_MAX) return null;
  if (s.game && !s.game.revealed) return null;
  let gameId = opts.gameId & 0xffff;
  while (s.retired.includes(gameId) || s.game?.gameId === gameId) gameId = (gameId + 1) & 0xffff;
  const retired = s.game ? pushLimited(s.retired, s.game.gameId, RETIRED_LIMIT) : s.retired;
  const game: Game = {
    gameId,
    players: opts.players,
    host: name,
    seat: 1,
    noise,
    word,
    entries: {},
    revealed: false,
    award: null,
    startedAt: opts.now,
    revealedAt: null,
  };
  return recordSend(
    { ...s, retired, profile: { ...s.profile, name, mode: 'host', seat: 1 }, game, stats: emptyStats() },
    { type: 'start', gameId, players: opts.players, name, noise },
  );
}

/** Send this player's entry: a 16×16 drawing on odd seats, a guess on even seats. */
export function sendEntry(s: State, content: { drawing?: Grid; text?: string }): Outgoing | null {
  const g = s.game;
  if (!g || phaseOf(s) !== 'my-turn') return null;
  const step = g.seat;
  const name = cleanName(s.profile.name);
  if (!name) return null;
  let packet: Packet;
  let entry: Entry;
  if (isDrawingStep(step)) {
    const d = content.drawing;
    if (!d || d.length !== DRAW_SIZE || !d.some((r) => r.some(Boolean))) return null;
    const drawing = d.map((r) => [...r]);
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

/** Host: give the Worst Connection award to one hop, once per round. */
export function awardGame(s: State, step: number): Outgoing | null {
  const g = s.game;
  if (!g || g.seat !== 1 || !g.revealed || g.award !== null || !entryAt(g, step)) return null;
  return recordSend({ ...s, game: { ...g, award: step } }, { type: 'award', gameId: g.gameId, step });
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
  kind: 'word' | 'drawing' | 'text' | 'missing';
  name: string;
  text?: string;
  drawing?: Grid;
  /** How static changed this entry on its way to the next seat (null if unchanged or the last hop). */
  arrived: Arrived | null;
}

export function chain(g: Game): { cards: ChainCard[]; perfect: boolean | null; survivedHops: number } {
  const cards: ChainCard[] = [{ step: 0, kind: 'word', name: g.host, text: g.word ?? '?', arrived: null }];
  for (let k = 1; k <= g.players; k++) {
    const e = entryAt(g, k);
    if (!e) {
      cards.push({ step: k, kind: 'missing', name: `Seat ${k}`, arrived: null });
      continue;
    }
    const a = k < g.players ? arrivedEntry(g, e) : null;
    const arrived = a && (a.flipped.length || a.changed.length) ? a : null;
    if (e.drawing) cards.push({ step: k, kind: 'drawing', name: e.name, drawing: e.drawing, arrived });
    else cards.push({ step: k, kind: 'text', name: e.name, text: e.text, arrived });
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

/** Drawer and guesser each score 1 when the guess matches what the drawer saw; +1 for the award. */
export function scores(g: Game): Score[] {
  const table = new Map<number, Score>();
  for (let k = 1; k <= g.players; k++) {
    const name = entryAt(g, k)?.name ?? (k === 1 ? g.host : null);
    if (name) table.set(k, { seat: k, name, points: 0, notes: [] });
  }
  const add = (seat: number, note: string) => {
    const s = table.get(seat);
    if (s) {
      s.points++;
      s.notes.push(note);
    }
  };
  for (let k = 1; k + 1 <= g.players; k += 2) {
    const drawing = entryAt(g, k);
    const guess = entryAt(g, k + 1);
    if (!drawing || !guess?.text) continue;
    const prev = k === 1 ? null : entryAt(g, k - 1);
    const seen = k === 1 ? g.word : prev ? arrivedEntry(g, prev).text : undefined;
    if (seen && close(guess.text, seen)) {
      add(k, `${guess.name} guessed your drawing`);
      add(k + 1, `guessed ${drawing.name}'s drawing`);
    }
  }
  if (g.award !== null) add(g.award, 'Worst Connection award');
  return [...table.values()].sort((a, b) => b.points - a.points || a.seat - b.seat);
}

// ---- persistence (per tab) -------------------------------------------------

export const STORAGE_KEY = 'dialup:v2';

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function loadState(store: KeyValueStore): State {
  try {
    const raw = store.getItem(STORAGE_KEY);
    if (!raw) return initialState();
    const p = JSON.parse(raw) as Partial<State>;
    if (p.v !== 2 || !p.profile || !Array.isArray(p.seen) || !Array.isArray(p.sent)) return initialState();
    return { ...initialState(), ...p } as State;
  } catch {
    return initialState();
  }
}

export function saveState(store: KeyValueStore, s: State): void {
  store.setItem(STORAGE_KEY, JSON.stringify(s));
}

export { PLAYERS_MAX, PLAYERS_MIN };
