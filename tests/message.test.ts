import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { crc8 } from '../src/protocol/crc8';
import { emptyGrid } from '../src/protocol/drawing';
import { decodeMessage, encodeMessage, MAX_MESSAGE_LEN, normalizeName, type GhostMessage } from '../src/protocol/message';
import { messageArb, nameArb } from './arbitraries';

const sample: GhostMessage = {
  direction: 'release',
  stage: 2,
  item: 'lantern',
  energy: 3,
  ok: false,
  hat: false,
  partner: 9,
  ghostId: 0xbeef,
  transferId: 7,
  grid: emptyGrid(),
  name: 'BOO',
};

/** Re-seal a tampered message with a valid CRC so the check under test is the one that fires. */
function reseal(bytes: Uint8Array): Uint8Array {
  const out = bytes.slice();
  out[out.length - 1] = crc8(out.subarray(0, out.length - 1));
  return out;
}

describe('message v4 round-trip (R2.1, R2.2, R2.4)', () => {
  it('decodes exactly what was encoded, for any valid message', () => {
    fc.assert(
      fc.property(messageArb, (msg) => {
        const bytes = encodeMessage(msg);
        expect(bytes.length).toBeLessThanOrEqual(MAX_MESSAGE_LEN);
        expect(decodeMessage(bytes)).toEqual({ ok: true, message: msg });
      }),
    );
  });

  it('the largest message is exactly 26 bytes, with every field at its maximum', () => {
    const big = encodeMessage({ ...sample, name: 'ABCDEFGHIJ', stage: 6, item: 'coffin', energy: 3, ok: true, hat: true, partner: 15, ghostId: 0xffff, transferId: 255 });
    expect(MAX_MESSAGE_LEN).toBe(26);
    expect(big.length).toBe(26);
  });

  it('name round-trips exactly for any printable ASCII name of 1-10 chars', () => {
    fc.assert(
      fc.property(nameArb, (name) => {
        expect(normalizeName(name)).toBe(name);
      }),
    );
  });

  it('trims names and rejects empty, too long, and non-ASCII names', () => {
    expect(normalizeName('  Boo ')).toBe('Boo');
    expect(normalizeName('   ')).toBeNull();
    expect(normalizeName('ABCDEFGHIJK')).toBeNull();
    expect(normalizeName('Bôo')).toBeNull();
    expect(normalizeName('👻')).toBeNull();
    expect(() => encodeMessage({ ...sample, name: '' })).toThrow();
  });

  it('refuses to encode out-of-range fields', () => {
    expect(() => encodeMessage({ ...sample, stage: 0 as never })).toThrow();
    expect(() => encodeMessage({ ...sample, stage: 7 as never })).toThrow();
    expect(() => encodeMessage({ ...sample, energy: 4 })).toThrow();
    expect(() => encodeMessage({ ...sample, partner: 16 })).toThrow();
    expect(() => encodeMessage({ ...sample, ghostId: 70000 })).toThrow();
  });
});

describe('invalid messages are rejected (R2.3)', () => {
  const good = encodeMessage(sample);

  it('too short / too long', () => {
    expect(decodeMessage(good.subarray(0, 10))).toEqual({ ok: false, error: 'too-short' });
    expect(decodeMessage(new Uint8Array(27))).toEqual({ ok: false, error: 'too-long' });
  });

  it('wrong magic, including every older version', () => {
    for (const magic of [0x00, 0xa1, 0xa2, 0xa3]) {
      const b = good.slice();
      b[0] = magic;
      expect(decodeMessage(reseal(b))).toEqual({ ok: false, error: 'bad-magic' });
    }
  });

  it('length nibble disagrees with the actual length', () => {
    const b = good.slice();
    b[14] = (b[14] & 0xf0) | 4;
    expect(decodeMessage(reseal(b))).toEqual({ ok: false, error: 'bad-length' });
  });

  it('bad checksum', () => {
    const b = good.slice();
    b[b.length - 1] ^= 0xff;
    expect(decodeMessage(b)).toEqual({ ok: false, error: 'bad-checksum' });
  });

  it('stage 0 and stage 7', () => {
    for (const s of [0, 7]) {
      const b = good.slice();
      b[1] = (b[1] & 0xf1) | (s << 1);
      expect(decodeMessage(reseal(b))).toEqual({ ok: false, error: 'bad-stage' });
    }
  });

  it('unknown item (12-15)', () => {
    const b = good.slice();
    b[1] = (b[1] & 0x0f) | (12 << 4);
    expect(decodeMessage(reseal(b))).toEqual({ ok: false, error: 'bad-item' });
  });

  it('reserved status bits set', () => {
    const b = good.slice();
    b[2] |= 0x10;
    expect(decodeMessage(reseal(b))).toEqual({ ok: false, error: 'bad-flags' });
  });

  it('non-printable name byte', () => {
    const b = good.slice();
    b[15] = 0x07;
    expect(decodeMessage(reseal(b))).toEqual({ ok: false, error: 'bad-name' });
  });

  it('any single corrupted byte is rejected', () => {
    fc.assert(
      fc.property(messageArb, fc.nat(), fc.integer({ min: 1, max: 255 }), (msg, pos, flip) => {
        const b = encodeMessage(msg);
        b[pos % b.length] ^= flip;
        expect(decodeMessage(b).ok).toBe(false);
      }),
    );
  });

  it('random bytes only decode if they are a canonical encoding', () => {
    fc.assert(
      fc.property(fc.uint8Array({ minLength: 0, maxLength: 40 }), (bytes) => {
        const res = decodeMessage(bytes);
        if (res.ok) expect(encodeMessage(res.message)).toEqual(bytes);
      }),
    );
  });
});
