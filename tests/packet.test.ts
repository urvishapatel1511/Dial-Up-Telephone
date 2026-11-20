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
const grid16 = () => emptyGrid(16);

describe('packets round-trip (R1)', () => {
  it('decodes exactly what was encoded, and never exceeds 46 bytes', () => {
    fc.assert(
      fc.property(packetArb, (p) => {
        const b = encodePacket(p);
        expect(b.length).toBeLessThanOrEqual(MAX_PACKET);
        expect(decodePacket(b)).toEqual({ ok: true, packet: p });
      }),
    );
  });

  it('sizes: drawing entry 46 max, guess entry 26 max, award 7', () => {
    expect(MAX_PACKET).toBe(46);
    expect(encodePacket({ type: 'entry', gameId: 1, step: 7, name: 'ABCDEFG', drawing: grid16() }).length).toBe(46);
    expect(encodePacket({ type: 'entry', gameId: 0xffff, step: 8, name: 'ABCDEFG', text: 'ABCDEFGHIJKL' }).length).toBe(26);
    expect(encodePacket({ type: 'award', gameId: 1, step: 3 }).length).toBe(7);
  });

  it('start carries the static level', () => {
    for (const noise of [0, 1, 2] as const) {
      const r = decodePacket(encodePacket({ type: 'start', gameId: 9, players: 4, name: 'Asha', noise }));
      expect(r.ok && r.packet.type === 'start' && r.packet.noise).toBe(noise);
    }
  });

  it('odd steps must carry a 16×16 drawing, even steps a guess', () => {
    expect(() => encodePacket({ type: 'entry', gameId: 1, step: 2, name: 'A', drawing: grid16() })).toThrow();
    expect(() => encodePacket({ type: 'entry', gameId: 1, step: 1, name: 'A', text: 'cat' })).toThrow();
    expect(() => encodePacket({ type: 'entry', gameId: 1, step: 1, name: 'A', drawing: emptyGrid(8) })).toThrow();
  });

  it('cleans text and names, and rejects invalid ones', () => {
    expect(cleanText('  witch   hat ')).toBe('witch hat');
    expect(cleanText('')).toBeNull();
    expect(cleanText('ABCDEFGHIJKLM')).toBeNull();
    expect(cleanText('café')).toBeNull();
    expect(cleanName('Urvisha')).toBe('Urvisha');
    expect(cleanName('Urvisha P')).toBeNull();
    expect(() => encodePacket({ type: 'start', gameId: 1, players: 9, name: 'A', noise: 0 })).toThrow();
    expect(() => encodePacket({ type: 'start', gameId: 1, players: 4, name: 'A', noise: 3 as never })).toThrow();
  });

  it('dedupe key depends on game, type, and step only; the award is once per game', () => {
    expect(packetKey({ type: 'entry', gameId: 5, step: 3, name: 'A', drawing: grid16() })).toBe('5:entry:3');
    expect(packetKey({ type: 'award', gameId: 5, step: 3 })).toBe(packetKey({ type: 'award', gameId: 5, step: 6 }));
  });
});

describe('invalid packets are rejected (R1.5)', () => {
  const good = encodePacket({ type: 'entry', gameId: 300, step: 2, name: 'Bo', text: 'fish' });

  it('length, magic (including the old v1 format), checksum, type', () => {
    expect(decodePacket(good.subarray(0, 5))).toEqual({ ok: false, error: 'too-short' });
    expect(decodePacket(new Uint8Array(47))).toEqual({ ok: false, error: 'too-long' });
    for (const magic of [0xd1, 0xa4]) {
      const m = good.slice();
      m[0] = magic;
      expect(decodePacket(reseal(m))).toEqual({ ok: false, error: 'bad-magic' });
    }
    const c = good.slice();
    c[c.length - 1] ^= 1;
    expect(decodePacket(c)).toEqual({ ok: false, error: 'bad-checksum' });
    const t = good.slice();
    t[1] = 9;
    expect(decodePacket(reseal(t))).toEqual({ ok: false, error: 'bad-type' });
  });

  it('a static level is only allowed on start, and only 0-2', () => {
    const e = good.slice();
    e[1] |= 1 << 4;
    expect(decodePacket(reseal(e))).toEqual({ ok: false, error: 'bad-type' });
    const s = encodePacket({ type: 'start', gameId: 1, players: 4, name: 'A', noise: 2 });
    s[1] = (s[1] & 0x0f) | (3 << 4);
    expect(decodePacket(reseal(s))).toEqual({ ok: false, error: 'bad-type' });
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
    const s = encodePacket({ type: 'start', gameId: 1, players: 4, name: 'A', noise: 1 });
    s[4] = 9;
    expect(decodePacket(reseal(s))).toEqual({ ok: false, error: 'bad-count' });
    const a = encodePacket({ type: 'award', gameId: 1, step: 2 });
    a[4] = 0;
    expect(decodePacket(reseal(a))).toEqual({ ok: false, error: 'bad-count' });
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
      fc.property(fc.uint8Array({ maxLength: 50 }), (bytes) => {
        const r = decodePacket(bytes);
        if (r.ok) expect(encodePacket(r.packet)).toEqual(bytes);
      }),
    );
  });
});
