import { crc8 } from './crc8';
import { packGrid, unpackGrid, type Grid } from './drawing';

/**
 * Wire format v4 (see .kiro/specs/ghost-frequency/design.md), at most 26 bytes:
 *  0     magic/version 0xA4
 *  1     bit0 direction · bits1-3 stage (1..6) · bits4-7 item (0..11)
 *  2     bits0-1 energy · bit2 ok · bit3 hat · bits4-7 zero
 *  3-4   ghost ID (uint16 BE)
 *  5     transfer ID
 *  6-13  drawing (8 bytes)
 *  14    bits0-3 name length (1..10) · bits4-7 partner tag (0..15)
 *  15..  name (printable ASCII)
 *  last  CRC-8 over all previous bytes
 */
export const MAGIC = 0xa4;
export const NAME_MAX = 10;
export const HEADER_LEN = 15;
export const MAX_MESSAGE_LEN = HEADER_LEN + NAME_MAX + 1; // 26

export const ITEMS = [
  'none',
  'lantern',
  'bell',
  'mirror',
  'star',
  'moon',
  'skull',
  'heart',
  'pumpkin',
  'books',
  'chair',
  'coffin',
] as const;
export type Item = (typeof ITEMS)[number];

/** 1 summon/accept · 2 obstacle · 3 key retry · 4 mirror rune · 5 hat · 6 farewell */
export const STAGE = { summon: 1, obstacle: 2, keyRetry: 3, rune: 4, hat: 5, farewell: 6 } as const;
export type Stage = 1 | 2 | 3 | 4 | 5 | 6;

export type Direction = 'release' | 'return';

export interface GhostMessage {
  direction: Direction;
  stage: Stage;
  item: Item;
  /** Spirit energy 0..3. */
  energy: number;
  /** Verdict of the check the sender made (rune match, rescue). */
  ok: boolean;
  /** Bonus: the hat was rescued. */
  hat: boolean;
  /** 0 = not paired yet, 1..15 = pairing chosen by the Other Side on accept. */
  partner: number;
  ghostId: number;
  transferId: number;
  grid: Grid;
  name: string;
}

export type DecodeError =
  | 'too-short'
  | 'too-long'
  | 'bad-magic'
  | 'bad-flags'
  | 'bad-stage'
  | 'bad-item'
  | 'bad-length'
  | 'bad-name'
  | 'bad-checksum';

export type DecodeResult = { ok: true; message: GhostMessage } | { ok: false; error: DecodeError };

const PRINTABLE = /^[\x20-\x7e]+$/;

/** Returns the normalized name, or null if it cannot be sent. */
export function normalizeName(raw: string): string | null {
  const name = raw.trim();
  if (name.length < 1 || name.length > NAME_MAX || !PRINTABLE.test(name)) return null;
  return name;
}

const inRange = (v: number, lo: number, hi: number) => Number.isInteger(v) && v >= lo && v <= hi;

export function encodeMessage(msg: GhostMessage): Uint8Array {
  const name = normalizeName(msg.name);
  if (name === null) throw new Error('name must be 1-10 printable ASCII characters');
  if (!inRange(msg.ghostId, 0, 0xffff)) throw new Error('ghostId must be uint16');
  if (!inRange(msg.transferId, 0, 0xff)) throw new Error('transferId must be uint8');
  if (!inRange(msg.stage, 1, 6)) throw new Error('stage must be 1..6');
  if (!inRange(msg.energy, 0, 3)) throw new Error('energy must be 0..3');
  if (!inRange(msg.partner, 0, 15)) throw new Error('partner must be 0..15');
  const itemIndex = ITEMS.indexOf(msg.item);
  if (itemIndex < 0) throw new Error('unknown item');

  const out = new Uint8Array(HEADER_LEN + name.length + 1);
  out[0] = MAGIC;
  out[1] = (msg.direction === 'return' ? 1 : 0) | (msg.stage << 1) | (itemIndex << 4);
  out[2] = msg.energy | (msg.ok ? 4 : 0) | (msg.hat ? 8 : 0);
  out[3] = msg.ghostId >> 8;
  out[4] = msg.ghostId & 0xff;
  out[5] = msg.transferId;
  out.set(packGrid(msg.grid), 6);
  out[14] = name.length | (msg.partner << 4);
  for (let i = 0; i < name.length; i++) out[HEADER_LEN + i] = name.charCodeAt(i);
  out[out.length - 1] = crc8(out.subarray(0, out.length - 1));
  return out;
}

export function decodeMessage(bytes: Uint8Array): DecodeResult {
  const fail = (error: DecodeError): DecodeResult => ({ ok: false, error });

  if (bytes.length < HEADER_LEN + 2) return fail('too-short');
  if (bytes.length > MAX_MESSAGE_LEN) return fail('too-long');
  if (bytes[0] !== MAGIC) return fail('bad-magic');

  const n = bytes[14] & 0x0f;
  if (n < 1 || n > NAME_MAX || bytes.length !== HEADER_LEN + n + 1) return fail('bad-length');
  if (crc8(bytes.subarray(0, bytes.length - 1)) !== bytes[bytes.length - 1]) return fail('bad-checksum');

  const stage = (bytes[1] >> 1) & 0x07;
  if (stage < 1 || stage > 6) return fail('bad-stage');
  const itemIndex = bytes[1] >> 4;
  if (itemIndex >= ITEMS.length) return fail('bad-item');
  if (bytes[2] & 0xf0) return fail('bad-flags');

  let name = '';
  for (let i = 0; i < n; i++) name += String.fromCharCode(bytes[HEADER_LEN + i]);
  if (normalizeName(name) !== name) return fail('bad-name');

  return {
    ok: true,
    message: {
      direction: bytes[1] & 1 ? 'return' : 'release',
      stage: stage as Stage,
      item: ITEMS[itemIndex],
      energy: bytes[2] & 0x03,
      ok: (bytes[2] & 4) !== 0,
      hat: (bytes[2] & 8) !== 0,
      partner: bytes[14] >> 4,
      ghostId: (bytes[3] << 8) | bytes[4],
      transferId: bytes[5],
      grid: unpackGrid(bytes.slice(6, 14)),
      name,
    },
  };
}

export function transferKey(m: Pick<GhostMessage, 'ghostId' | 'transferId' | 'direction'>): string {
  return `${m.ghostId}:${m.transferId}:${m.direction === 'return' ? 1 : 0}`;
}

/** Plain-language breakdown of a message, for the "inside the chirp" details. */
export function describeBytes(nameLength: number): string {
  return `drawing 8 · name ${nameLength + 1} (incl. pairing tag) · ghost ID 2 · game state 3 · check 1 · total ${HEADER_LEN + nameLength + 1} bytes`;
}
