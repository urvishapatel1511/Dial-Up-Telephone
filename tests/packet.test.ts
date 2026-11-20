import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { crc8 } from '../src/protocol/crc8';
import { emptyGrid } from '../src/protocol/drawing';
import { cleanName, cleanText, decodePacket, encodePacket, MAX_PACKET, packetKey } from '../src/protocol/packet';
import { packetArb } from './arbitraries';

const reseal = (b: Uint8Array) => {
  const out = b.slice();
  out[out.length - 1] = crc8(out.subarray(0, out.length - 1));
  return out;
};

describe('packets round-trip (R1)', () => {
  it('decodes exactly what was encoded, and never exceeds 26 bytes', () => {
    fc.assert(
      fc.property(packetArb, (p) => {
        const b = encodePacket(p);
        expect(b.length).toBeLessThanOrEqual(MAX_PACKET);
        expect(decodePacket(b)).toEqual({ ok: true, packet: p });
      }),
    );
  });

  it('the largest packet (a 12-letter guess by a 7-letter name) is exactly 26 bytes', () => {
    const b = encodePacket({ type: 'entry', gameId: 0xffff, step: 8, name: 'ABCDEFG', text: 'ABCDEFGHIJKL' });
    expect(b.length).toBe(26);
    expect(encodePacket({ type: 'entry', gameId: 1, step: 7, name: 'ABCDEFG', drawing: emptyGrid() }).length).toBe(22);
  });

  it('odd steps must carry a drawing, even steps a guess', () => {
    expect(() => encodePacket({ type: 'entry', gameId: 1, step: 2, name: 'A', drawing: emptyGrid() })).toThrow();
    expect(() => encodePacket({ type: 'entry', gameId: 1, step: 1, name: 'A', text: 'cat' })).toThrow();
  });

  it('cleans text and names, and rejects invalid ones', () => {
    expect(cleanText('  witch   hat ')).toBe('witch hat');
    expect(cleanText('')).toBeNull();
    expect(cleanText('ABCDEFGHIJKLM')).toBeNull();
    expect(cleanText('café')).toBeNull();
    expect(cleanName('Urvisha')).toBe('Urvisha');
    expect(cleanName('Urvisha P')).toBeNull();
    expect(() => encodePacket({ type: 'start', gameId: 1, players: 9, name: 'A' })).toThrow();
    expect(() => encodePacket({ type: 'start', gameId: 1, players: 1, name: 'A' })).toThrow();
  });

  it('dedupe key depends on game, type, and step only', () => {
    expect(packetKey({ type: 'entry', gameId: 5, step: 3, name: 'A', drawing: emptyGrid() })).toBe('5:entry:3');
    expect(packetKey({ type: 'start', gameId: 5, players: 4, name: 'A' })).toBe('5:start:0');
  });
});

describe('invalid packets are rejected (R1.4)', () => {
  const good = encodePacket({ type: 'entry', gameId: 300, step: 2, name: 'Bo', text: 'fish' });

  it('length, magic, checksum, type', () => {
    expect(decodePacket(good.subarray(0, 5))).toEqual({ ok: false, error: 'too-short' });
    expect(decodePacket(new Uint8Array(27))).toEqual({ ok: false, error: 'too-long' });
    const m = good.slice();
    m[0] = 0xa4; // the old ghost protocol
    expect(decodePacket(reseal(m))).toEqual({ ok: false, error: 'bad-magic' });
    const c = good.slice();
    c[c.length - 1] ^= 1;
    expect(decodePacket(c)).toEqual({ ok: false, error: 'bad-checksum' });
    const t = good.slice();
    t[1] = 9;
    expect(decodePacket(reseal(t))).toEqual({ ok: false, error: 'bad-type' });
  });

  it('a step that disagrees with the payload kind is rejected', () => {
    const b = good.slice();
    b[4] = 3; // odd step, but no drawing bytes
    expect(decodePacket(reseal(b)).ok).toBe(false);
  });

  it('bad step / player counts', () => {
    const b = good.slice();
    b[4] = 10;
    expect(decodePacket(reseal(b)).ok).toBe(false);
    const s = encodePacket({ type: 'start', gameId: 1, players: 4, name: 'A' });
    s[4] = 9;
    expect(decodePacket(reseal(s))).toEqual({ ok: false, error: 'bad-count' });
  });

  it('non-printable text', () => {
    const b = good.slice();
    b[6] = 0x07;
    expect(decodePacket(reseal(b))).toEqual({ ok: false, error: 'bad-text' });
  });

  it('any single corrupted byte is rejected', () => {
    fc.assert(
      fc.property(packetArb, fc.nat(), fc.integer({ min: 1, max: 255 }), (p, pos, flip) => {
        const b = encodePacket(p);
        b[pos % b.length] ^= flip;
        expect(decodePacket(b).ok).toBe(false);
      }),
    );
  });

  it('random bytes decode only if they are a canonical encoding', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 30 }), (bytes) => {
        const r = decodePacket(bytes);
        if (r.ok) expect(encodePacket(r.packet)).toEqual(bytes);
      }),
    );
  });
});
