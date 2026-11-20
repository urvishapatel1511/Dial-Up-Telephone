import { crc8 } from './crc8';
import { packGrid, unpackGrid, type Grid } from './drawing';

/**
 * Dial-Up Telephone packet v2 (see .kiro/specs/ghost-frequency/design.md), ≤ 46 bytes:
 *  0     magic 0xD2
 *  1     bits0-3 type: 1 start · 2 entry · 3 reveal · 4 award · bits4-5 static level (start only)
 *  2-3   game ID (uint16 BE)
 *  4     start/reveal: players (2..8) · entry/award: step (1..8)
 *  5     bits0-3 text length (0..12) · bits4-7 name length (0..7)
 *  6..   [drawing 32 bytes, odd entries only] [text] [name]
 *  last  CRC-8 over all previous bytes
 */
export const MAGIC = 0xd2;
export const DRAW_SIZE = 16;
export const DRAW_BYTES = (DRAW_SIZE * DRAW_SIZE) / 8; // 32
export const TEXT_MAX = 12;
export const NAME_MAX = 7;
export const MAX_PACKET = 6 + DRAW_BYTES + NAME_MAX + 1; // 46
export const PLAYERS_MIN = 2;
export const PLAYERS_MAX = 8;

export type NoiseLevel = 0 | 1 | 2;

const TYPE = { start: 1, entry: 2, reveal: 3, award: 4 } as const;
const TYPE_BY_NUM = ['', 'start', 'entry', 'reveal', 'award'] as const;

export type Packet =
  | { type: 'start'; gameId: number; players: number; name: string; noise: NoiseLevel }
  | { type: 'entry'; gameId: number; step: number; name: string; drawing: Grid }
  | { type: 'entry'; gameId: number; step: number; name: string; text: string }
  | { type: 'reveal'; gameId: number; players: number; word: string }
  | { type: 'award'; gameId: number; step: number };

export type PacketError =
  | 'too-short'
  | 'too-long'
  | 'bad-magic'
  | 'bad-type'
  | 'bad-count'
  | 'bad-length'
  | 'bad-text'
  | 'bad-checksum';

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
  let count: number;
  let flags = 0;
  let drawing: number[] = [];
  let text = '';
  let name = '';
  if (p.type === 'entry') {
    if (!inRange(p.step, 1, PLAYERS_MAX)) throw new Error('step must be 1..8');
    count = p.step;
    name = req(cleanName(p.name), 'name');
    if (isDrawingStep(p.step)) {
      if (!('drawing' in p)) throw new Error('odd steps carry a drawing');
      if (p.drawing.length !== DRAW_SIZE) throw new Error('drawings are 16×16');
      drawing = Array.from(packGrid(p.drawing));
    } else {
      if (!('text' in p)) throw new Error('even steps carry a guess');
      text = req(cleanText(p.text), 'guess');
    }
  } else if (p.type === 'award') {
    if (!inRange(p.step, 1, PLAYERS_MAX)) throw new Error('step must be 1..8');
    count = p.step;
  } else {
    if (!inRange(p.players, PLAYERS_MIN, PLAYERS_MAX)) throw new Error('players must be 2..8');
    count = p.players;
    if (p.type === 'start') {
      if (!inRange(p.noise, 0, 2)) throw new Error('noise must be 0..2');
      name = req(cleanName(p.name), 'name');
      flags = p.noise << 4;
    } else {
      text = req(cleanText(p.word), 'word');
    }
  }
  const body = [MAGIC, TYPE[p.type] | flags, p.gameId >> 8, p.gameId & 0xff, count, text.length | (name.length << 4), ...drawing, ...ascii(text), ...ascii(name)];
  const out = new Uint8Array(body.length + 1);
  out.set(body);
  out[body.length] = crc8(out.subarray(0, body.length));
  return out;
}

export function decodePacket(b: Uint8Array): DecodeResult {
  const fail = (error: PacketError): DecodeResult => ({ ok: false, error });
  if (b.length < 7) return fail('too-short');
  if (b.length > MAX_PACKET) return fail('too-long');
  if (b[0] !== MAGIC) return fail('bad-magic');
  if (crc8(b.subarray(0, b.length - 1)) !== b[b.length - 1]) return fail('bad-checksum');

  const type = TYPE_BY_NUM[b[1] & 0x0f];
  const noise = b[1] >> 4;
  if (!type) return fail('bad-type');
  if (noise > 2 || (type !== 'start' && noise !== 0)) return fail('bad-type');
  const gameId = (b[2] << 8) | b[3];
  const count = b[4];
  const textLen = b[5] & 0x0f;
  const nameLen = b[5] >> 4;
  if (textLen > TEXT_MAX || nameLen > NAME_MAX) return fail('bad-length');

  const drawingLen = type === 'entry' && isDrawingStep(count) ? DRAW_BYTES : 0;
  if (b.length !== 6 + drawingLen + textLen + nameLen + 1) return fail('bad-length');
  const str = (from: number, n: number) => String.fromCharCode(...b.subarray(from, from + n));
  const text = str(6 + drawingLen, textLen);
  const name = str(6 + drawingLen + textLen, nameLen);
  if ((textLen && cleanText(text) !== text) || (nameLen && cleanName(name) !== name)) return fail('bad-text');

  if (type === 'entry') {
    if (count < 1 || count > PLAYERS_MAX) return fail('bad-count');
    if (nameLen === 0) return fail('bad-length');
    if (drawingLen) {
      if (textLen !== 0) return fail('bad-length');
      return { ok: true, packet: { type, gameId, step: count, name, drawing: unpackGrid(b.slice(6, 6 + DRAW_BYTES), DRAW_SIZE) } };
    }
    if (textLen === 0) return fail('bad-length');
    return { ok: true, packet: { type, gameId, step: count, name, text } };
  }
  if (type === 'award') {
    if (textLen || nameLen) return fail('bad-length');
    if (count < 1 || count > PLAYERS_MAX) return fail('bad-count');
    return { ok: true, packet: { type, gameId, step: count } };
  }
  if (count < PLAYERS_MIN || count > PLAYERS_MAX) return fail('bad-count');
  if (type === 'start') {
    if (nameLen === 0 || textLen !== 0) return fail('bad-length');
    return { ok: true, packet: { type, gameId, players: count, name, noise: noise as NoiseLevel } };
  }
  if (textLen === 0 || nameLen !== 0) return fail('bad-length');
  return { ok: true, packet: { type, gameId, players: count, word: text } };
}

export function packetKey(p: Packet): string {
  return `${p.gameId}:${p.type}:${p.type === 'entry' ? p.step : 0}`;
}

/** Plain-language breakdown for the "inside the chirp" line. */
export function describePacket(p: Packet, bytes: number): string {
  if (p.type === 'start') return `start signal · ${p.players} players · ${bytes} bytes`;
  if (p.type === 'reveal') return `reveal signal · the secret word · ${bytes} bytes`;
  if (p.type === 'award') return `award signal · ${bytes} bytes`;
  return 'drawing' in p ? `16×16 drawing (32 bytes) + name · ${bytes} bytes` : `guess (${p.text.length} letters) + name · ${bytes} bytes`;
}
