import { crc8 } from './crc8';
import { packGrid, unpackGrid, type Grid } from './drawing';

/**
 * Dial-Up Telephone packet v4 (see .kiro/specs/ghost-frequency/design.md), ≤ 58 bytes:
 *  0     magic 0xD4
 *  1     bits0-3 type: 1 start · 2 entry · 3 reveal · 4 results · 5 need · 6 call · 7 hello · 8 ack
 *        bits4-5 static level (start only)
 *  2-3   game ID (uint16 BE)
 *  4     start/reveal/call: players · entry/need: step · results: funniest step · hello/ack: seat
 *  5     bits0-3 text length · bits4-7 name length
 *  6..   start: match ID (2) + round/mode/category (1) · results: recognizable|recovery<<4 (1), final (1)
 *        call: confirmed-seat mask, duplicated-seat mask · hello: player ID (2) · ack: what it confirms (1)
 *        entry: [drawing 32 bytes on odd steps] [text: guess, or the secret word on step 1] [name]
 *  last  CRC-8 over all previous bytes
 *
 * v4 changed hello (adds a player ID, so two players with the same name are
 * never merged) and ack (adds what it confirms: results, the start, or a hop).
 * Packets from other versions are reported as such, never misread.
 */
export const MAGIC = 0xd4;
export const PROTOCOL_VERSION = 4;
/** Every version so far used 0xD1..0xDF as its magic byte (0xD0 + version). */
const MAGIC_FAMILY = 0xd0;
export const DRAW_SIZE = 16;
export const DRAW_BYTES = (DRAW_SIZE * DRAW_SIZE) / 8; // 32
export const TEXT_MAX = 12;
export const NAME_MAX = 7;
export const MAX_PACKET = 6 + DRAW_BYTES + TEXT_MAX + NAME_MAX + 1; // 58
export const PLAYERS_MIN = 2;
export const PLAYERS_MAX = 8;
export const ROUNDS_MAX = 3;
export const CATEGORY_MAX = 7;

export type NoiseLevel = 0 | 1 | 2;
export type GameMode = 'quick' | 'match';
/** The room's out-loud guess of the last drawing (odd player counts): 0 not recorded, 1 got it, 2 missed. */
export type FinalGuess = 0 | 1 | 2;

/** `need` step that asks the host for the round's start signal ("Ask to join"). */
export const NEED_START = 9;

const TYPE = { start: 1, entry: 2, reveal: 3, results: 4, need: 5, call: 6, hello: 7, ack: 8 } as const;
const TYPE_BY_NUM = ['', 'start', 'entry', 'reveal', 'results', 'need', 'call', 'hello', 'ack'] as const;

/** Seat bit masks for `call`: bit (seat − 1). */
export const seatsToMask = (seats: number[]) => seats.reduce((m, s) => m | (1 << (s - 1)), 0) & 0xff;
export const maskToSeats = (mask: number) => Array.from({ length: 8 }, (_, i) => i + 1).filter((s) => mask & (1 << (s - 1)));

export type Packet =
  | { type: 'start'; gameId: number; players: number; name: string; noise: NoiseLevel; mode: GameMode; matchId: number; round: number; category: number }
  | { type: 'entry'; gameId: number; step: number; name: string; drawing: Grid; word?: string }
  | { type: 'entry'; gameId: number; step: number; name: string; text: string }
  | { type: 'reveal'; gameId: number; players: number }
  | { type: 'results'; gameId: number; funniest: number; recognizable: number; recovery: number; final: FinalGuess }
  | { type: 'need'; gameId: number; step: number }
  /** Host's ready check. `confirmed` / `duplicate` are seat masks. */
  | { type: 'call'; gameId: number; players: number; name: string; confirmed: number; duplicate: number }
  /**
   * A player's "I'm ready" (mic works). gameId is the lobby ID heard in a call, or 0.
   * `pid` is a random ID for this browser tab (1..65535): the player's identity, independent of the name.
   */
  | { type: 'hello'; gameId: number; seat: number; name: string; pid: number }
  /**
   * A confirmation from `seat`. `step` says what it confirms, numbered like `need`:
   * 0 = the results, 1..8 = that hop arrived (sent by the next player), 9 = the start signal.
   */
  | { type: 'ack'; gameId: number; seat: number; step: number };

/** `ack` step that confirms the results. */
export const ACK_RESULTS = 0;

export type PacketError =
  | 'too-short'
  | 'too-long'
  | 'bad-magic'
  | 'bad-type'
  | 'bad-count'
  | 'bad-length'
  | 'bad-text'
  | 'bad-checksum'
  /** A valid chirp from an older or newer version of the game. */
  | 'old-version'
  | 'new-version';

export type DecodeResult = { ok: true; packet: Packet } | { ok: false; error: PacketError };

const PRINTABLE = /^[\x20-\x7e]+$/;

function clean(raw: string, max: number): string | null {
  const s = raw.trim().replace(/\s+/g, ' ');
  return s.length >= 1 && s.length <= max && PRINTABLE.test(s) ? s : null;
}
/** A guess or secret word: 1-12 printable ASCII characters, trimmed, single spaces. */
export const cleanText = (raw: string) => clean(raw, TEXT_MAX);
/** A player name: 1-7 printable ASCII characters. */
export const cleanName = (raw: string) => clean(raw, NAME_MAX);

export const isDrawingStep = (step: number) => step % 2 === 1;

const ascii = (s: string) => Array.from(s, (c) => c.charCodeAt(0));
const inRange = (v: number, lo: number, hi: number) => Number.isInteger(v) && v >= lo && v <= hi;

function req(v: string | null, what: string): string {
  if (v === null) throw new Error(`invalid ${what}`);
  return v;
}

export function encodePacket(p: Packet): Uint8Array {
  if (!inRange(p.gameId, 0, 0xffff)) throw new Error('gameId must be uint16');
  let count = 0;
  let flags = 0;
  let extra: number[] = [];
  let drawing: number[] = [];
  let text = '';
  let name = '';
  switch (p.type) {
    case 'entry':
      if (!inRange(p.step, 1, PLAYERS_MAX)) throw new Error('step must be 1..8');
      count = p.step;
      name = req(cleanName(p.name), 'name');
      if (isDrawingStep(p.step)) {
        if (!('drawing' in p)) throw new Error('odd steps carry a drawing');
        if (p.drawing.length !== DRAW_SIZE) throw new Error('drawings are 16×16');
        drawing = Array.from(packGrid(p.drawing));
        if (p.step === 1) text = req(cleanText(p.word ?? ''), 'secret word');
        else if (p.word !== undefined) throw new Error('only step 1 carries the word');
      } else {
        if (!('text' in p)) throw new Error('even steps carry a guess');
        text = req(cleanText(p.text), 'guess');
      }
      break;
    case 'start':
      if (!inRange(p.players, PLAYERS_MIN, PLAYERS_MAX)) throw new Error('players must be 2..8');
      if (!inRange(p.noise, 0, 2) || !inRange(p.round, 1, ROUNDS_MAX) || !inRange(p.category, 0, CATEGORY_MAX) || !inRange(p.matchId, 0, 0xffff)) {
        throw new Error('bad start fields');
      }
      count = p.players;
      flags = p.noise << 4;
      name = req(cleanName(p.name), 'name');
      extra = [p.matchId >> 8, p.matchId & 0xff, p.round | (p.mode === 'match' ? 4 : 0) | (p.category << 3)];
      break;
    case 'reveal':
      if (!inRange(p.players, PLAYERS_MIN, PLAYERS_MAX)) throw new Error('players must be 2..8');
      count = p.players;
      break;
    case 'results':
      if (![p.funniest, p.recognizable, p.recovery].every((s) => inRange(s, 0, PLAYERS_MAX)) || !inRange(p.final, 0, 2)) {
        throw new Error('bad results fields');
      }
      count = p.funniest;
      extra = [p.recognizable | (p.recovery << 4), p.final];
      break;
    case 'need':
      if (!inRange(p.step, 0, NEED_START)) throw new Error('step must be 0..9');
      count = p.step;
      break;
    case 'call':
      if (!inRange(p.players, PLAYERS_MIN, PLAYERS_MAX) || !inRange(p.confirmed, 0, 0xff) || !inRange(p.duplicate, 0, 0xff)) throw new Error('bad call fields');
      count = p.players;
      name = req(cleanName(p.name), 'name');
      extra = [p.confirmed, p.duplicate];
      break;
    case 'hello':
      if (!inRange(p.seat, 1, PLAYERS_MAX)) throw new Error('seat must be 1..8');
      if (!inRange(p.pid, 1, 0xffff)) throw new Error('player ID must be 1..65535');
      count = p.seat;
      name = req(cleanName(p.name), 'name');
      extra = [p.pid >> 8, p.pid & 0xff];
      break;
    case 'ack':
      if (!inRange(p.seat, 1, PLAYERS_MAX)) throw new Error('seat must be 1..8');
      if (!inRange(p.step, 0, NEED_START)) throw new Error('ack step must be 0..9');
      count = p.seat;
      extra = [p.step];
      break;
  }
  const body = [MAGIC, TYPE[p.type] | flags, p.gameId >> 8, p.gameId & 0xff, count, text.length | (name.length << 4), ...extra, ...drawing, ...ascii(text), ...ascii(name)];
  const out = new Uint8Array(body.length + 1);
  out.set(body);
  out[body.length] = crc8(out.subarray(0, body.length));
  return out;
}

export function decodePacket(b: Uint8Array): DecodeResult {
  const fail = (error: PacketError): DecodeResult => ({ ok: false, error });
  if (b.length < 7) return fail('too-short');
  if (b.length > MAX_PACKET) return fail('too-long');
  const crcOk = crc8(b.subarray(0, b.length - 1)) === b[b.length - 1];
  if (b[0] !== MAGIC) {
    // Only an intact chirp counts as "another version"; random noise is just unreadable.
    const family = (b[0] & 0xf0) === MAGIC_FAMILY && (b[0] & 0x0f) !== 0;
    if (family && crcOk) return fail(b[0] < MAGIC ? 'old-version' : 'new-version');
    return fail('bad-magic');
  }
  if (!crcOk) return fail('bad-checksum');

  const type = TYPE_BY_NUM[b[1] & 0x0f];
  const noise = b[1] >> 4;
  if (!type || noise > 2 || (type !== 'start' && noise !== 0)) return fail('bad-type');
  const gameId = (b[2] << 8) | b[3];
  const count = b[4];
  const textLen = b[5] & 0x0f;
  const nameLen = b[5] >> 4;
  if (textLen > TEXT_MAX || nameLen > NAME_MAX) return fail('bad-length');

  const extraLen = type === 'start' ? 3 : type === 'results' || type === 'call' || type === 'hello' ? 2 : type === 'ack' ? 1 : 0;
  const drawingLen = type === 'entry' && isDrawingStep(count) ? DRAW_BYTES : 0;
  if (b.length !== 6 + extraLen + drawingLen + textLen + nameLen + 1) return fail('bad-length');
  const at = 6 + extraLen + drawingLen;
  const str = (from: number, n: number) => String.fromCharCode(...b.subarray(from, from + n));
  const text = str(at, textLen);
  const name = str(at + textLen, nameLen);
  if ((textLen && cleanText(text) !== text) || (nameLen && cleanName(name) !== name)) return fail('bad-text');

  switch (type) {
    case 'entry': {
      if (count < 1 || count > PLAYERS_MAX) return fail('bad-count');
      if (nameLen === 0) return fail('bad-length');
      if (drawingLen) {
        const drawing = unpackGrid(b.slice(6, 6 + DRAW_BYTES), DRAW_SIZE);
        if (count === 1) {
          if (textLen === 0) return fail('bad-length');
          return { ok: true, packet: { type, gameId, step: count, name, drawing, word: text } };
        }
        if (textLen !== 0) return fail('bad-length');
        return { ok: true, packet: { type, gameId, step: count, name, drawing } };
      }
      if (textLen === 0) return fail('bad-length');
      return { ok: true, packet: { type, gameId, step: count, name, text } };
    }
    case 'start': {
      if (count < PLAYERS_MIN || count > PLAYERS_MAX) return fail('bad-count');
      if (nameLen === 0 || textLen !== 0) return fail('bad-length');
      const info = b[8];
      const round = info & 3;
      if (round < 1 || info & 0xc0) return fail('bad-count');
      return {
        ok: true,
        packet: { type, gameId, players: count, name, noise: noise as NoiseLevel, mode: info & 4 ? 'match' : 'quick', matchId: (b[6] << 8) | b[7], round, category: (info >> 3) & 7 },
      };
    }
    case 'reveal':
      if (count < PLAYERS_MIN || count > PLAYERS_MAX) return fail('bad-count');
      if (textLen || nameLen) return fail('bad-length');
      return { ok: true, packet: { type, gameId, players: count } };
    case 'results': {
      if (textLen || nameLen) return fail('bad-length');
      const recognizable = b[6] & 0x0f;
      const recovery = b[6] >> 4;
      if (count > PLAYERS_MAX || recognizable > PLAYERS_MAX || recovery > PLAYERS_MAX || b[7] > 2) return fail('bad-count');
      return { ok: true, packet: { type, gameId, funniest: count, recognizable, recovery, final: b[7] as FinalGuess } };
    }
    case 'need':
      if (textLen || nameLen) return fail('bad-length');
      if (count > NEED_START) return fail('bad-count');
      return { ok: true, packet: { type, gameId, step: count } };
    case 'call':
      if (count < PLAYERS_MIN || count > PLAYERS_MAX) return fail('bad-count');
      if (nameLen === 0 || textLen !== 0) return fail('bad-length');
      return { ok: true, packet: { type, gameId, players: count, name, confirmed: b[6], duplicate: b[7] } };
    case 'hello': {
      if (count < 1 || count > PLAYERS_MAX) return fail('bad-count');
      if (nameLen === 0 || textLen !== 0) return fail('bad-length');
      const pid = (b[6] << 8) | b[7];
      if (pid === 0) return fail('bad-count');
      return { ok: true, packet: { type, gameId, seat: count, name, pid } };
    }
    case 'ack':
      if (count < 1 || count > PLAYERS_MAX || b[6] > NEED_START) return fail('bad-count');
      if (textLen || nameLen) return fail('bad-length');
      return { ok: true, packet: { type, gameId, seat: count, step: b[6] } };
  }
}

export function packetKey(p: Packet): string {
  if (p.type === 'ack') return `${p.gameId}:ack:${p.step}:${p.seat}`;
  const step = p.type === 'entry' || p.type === 'need' ? p.step : p.type === 'hello' ? p.seat : 0;
  return `${p.gameId}:${p.type}:${step}`;
}

/** Plain-language breakdown for the "inside the chirp" line. */
export function describePacket(p: Packet, bytes: number): string {
  switch (p.type) {
    case 'start':
      return `start signal · ${p.players} players · ${bytes} bytes`;
    case 'reveal':
      return `reveal signal · ${bytes} bytes`;
    case 'results':
      return `awards and scores · ${bytes} bytes`;
    case 'need':
      return `${p.step === NEED_START ? 'request to join' : 'request for a missed hop'} · ${bytes} bytes`;
    case 'call':
      return `ready check · ${bytes} bytes`;
    case 'hello':
      return `ready message from seat ${p.seat} · ${bytes} bytes`;
    case 'ack':
      if (p.step === ACK_RESULTS) return `results confirmation from seat ${p.seat} · ${bytes} bytes`;
      if (p.step === NEED_START) return `start confirmation from seat ${p.seat} · ${bytes} bytes`;
      return `"got hop ${p.step}" from seat ${p.seat} · ${bytes} bytes`;
    case 'entry':
      if ('drawing' in p) return `16×16 drawing (32 bytes)${p.word ? ' + secret word' : ''} + name · ${bytes} bytes`;
      return `guess (${p.text.length} letters) + name · ${bytes} bytes`;
  }
}
