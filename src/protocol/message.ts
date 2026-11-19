import { crc8 } from './crc8';
import { packGrid, unpackGrid, type Grid } from './drawing';

/**
 * Wire format v3 (see .kiro/specs/ghost-frequency/design.md):
 *  0     magic/version 0xA3
 *  1     flags: bit0 direction, bits1-2 stage (1..3), bits3-5 item (0..7), bits6-7 energy (0..3)
 *  2     status: bit0 ok, bits1-7 zero
 *  3-4   ghost ID (uint16 BE)
 *  5     transfer ID (uint8)
 *  6-13  drawing (8 bytes)
 *  14    name length N (1..10)
 *  15..  name (printable ASCII)
 *  last  CRC-8 over all previous bytes
 */
export const MAGIC = 0xa3;
export const NAME_MAX = 10;
export const HEADER_LEN = 15;
export const MAX_MESSAGE_LEN = HEADER_LEN + NAME_MAX + 1; // 26

export const ITEMS = ['none', 'lantern', 'bell', 'mirror', 'star', 'moon', 'skull', 'heart'] as const;
export type Item = (typeof ITEMS)[number];

export type Direction = 'release' | 'return';
export type Stage = 1 | 2 | 3;

export interface GhostMessage {
  direction: Direction;
  stage: Stage;
  item: Item;
  /** Spirit energy, 0..3. 0 means the ghost has faded. */
  energy: number;
  /** Verdict of the check the sender just made (used on stage 3 returns). */
  ok: boolean;
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

export function encodeMessage(msg: GhostMessage): Uint8Array {
  const name = normalizeName(msg.name);
  if (name === null) throw new Error('name must be 1-10 printable ASCII characters');
  if (!Number.isInteger(msg.ghostId) || msg.ghostId < 0 || msg.ghostId > 0xffff) throw new Error('ghostId must be uint16');
  if (!Number.isInteger(msg.transferId) || msg.transferId < 0 || msg.transferId > 0xff) {
    throw new Error('transferId must be uint8');
  }
  if (msg.stage !== 1 && msg.stage !== 2 && msg.stage !== 3) throw new Error('stage must be 1..3');
  if (!Number.isInteger(msg.energy) || msg.energy < 0 || msg.energy > 3) throw new Error('energy must be 0..3');
  const itemIndex = ITEMS.indexOf(msg.item);
  if (itemIndex < 0) throw new Error('unknown item');

  const out = new Uint8Array(HEADER_LEN + name.length + 1);
  out[0] = MAGIC;
  out[1] = (msg.direction === 'return' ? 1 : 0) | (msg.stage << 1) | (itemIndex << 3) | (msg.energy << 6);
  out[2] = msg.ok ? 1 : 0;
  out[3] = msg.ghostId >> 8;
  out[4] = msg.ghostId & 0xff;
  out[5] = msg.transferId;
  out.set(packGrid(msg.grid), 6);
  out[14] = name.length;
  for (let i = 0; i < name.length; i++) out[HEADER_LEN + i] = name.charCodeAt(i);
  out[out.length - 1] = crc8(out.subarray(0, out.length - 1));
  return out;
}

export function decodeMessage(bytes: Uint8Array): DecodeResult {
  const fail = (error: DecodeError): DecodeResult => ({ ok: false, error });

  if (bytes.length < HEADER_LEN + 2) return fail('too-short');
  if (bytes.length > MAX_MESSAGE_LEN) return fail('too-long');
  if (bytes[0] !== MAGIC) return fail('bad-magic');

  const n = bytes[14];
  if (n < 1 || n > NAME_MAX || bytes.length !== HEADER_LEN + n + 1) return fail('bad-length');
  if (crc8(bytes.subarray(0, bytes.length - 1)) !== bytes[bytes.length - 1]) return fail('bad-checksum');

  const flags = bytes[1];
  const stage = (flags >> 1) & 0x03;
  if (stage === 0) return fail('bad-stage');
  if (bytes[2] & 0xfe) return fail('bad-flags');

  let name = '';
  for (let i = 0; i < n; i++) name += String.fromCharCode(bytes[HEADER_LEN + i]);
  if (normalizeName(name) !== name) return fail('bad-name');

  return {
    ok: true,
    message: {
      direction: flags & 1 ? 'return' : 'release',
      stage: stage as Stage,
      item: ITEMS[(flags >> 3) & 0x07],
      energy: (flags >> 6) & 0x03,
      ok: (bytes[2] & 1) === 1,
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

/** Plain-language breakdown of a message, for the "inside the chirp" card. */
export function describeBytes(nameLength: number): string {
  return `drawing 8 · name ${nameLength + 1} · ghost ID 2 · game state 3 · check 1 · total ${HEADER_LEN + nameLength + 1} bytes`;
}
