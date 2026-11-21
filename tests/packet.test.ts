import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { crc8 } from '../src/protocol/crc8';
import { emptyGrid } from '../src/protocol/drawing';
import { cleanName, cleanText, decodePacket, encodePacket, MAGIC, maskToSeats, MAX_PACKET, NEED_START, packetKey, seatsToMask, type Packet } from '../src/protocol/packet';
import { packetArb } from './arbitraries';

const reseal = (b: Uint8Array) => {
  const out = b.slice();
  out[out.length - 1] = crc8(out.subarray(0, out.length - 1));
  return out;
};
const grid16 = () => emptyGrid(16);
const start = (over: Partial<Extract<Packet, { type: 'start' }>> = {}): Packet => ({
  type: 'start',
  gameId: 9,
  players: 4,
  name: 'Asha',
  noise: 1,
  mode: 'quick',
  matchId: 9,
  round: 1,
  category: 0,
  ...over,
});

describe('v3 packets round-trip (C3)', () => {
  it('decodes exactly what was encoded, and never exceeds 58 bytes', () => {
    fc.assert(
      fc.property(packetArb, (p) => {
        const b = encodePacket(p);
        expect(b.length).toBeLessThanOrEqual(MAX_PACKET);
        expect(decodePacket(b)).toEqual({ ok: true, packet: p });
      }),
    );
  });

  it('sizes: first drawing 58, other drawings 46, guesses 26, start ≤ 17, reveal/need 7, results 9', () => {
    expect(MAX_PACKET).toBe(58);
    expect(MAGIC).toBe(0xd3);
    expect(encodePacket({ type: 'entry', gameId: 1, step: 1, name: 'ABCDEFG', drawing: grid16(), word: 'ABCDEFGHIJKL' }).length).toBe(58);
    expect(encodePacket({ type: 'entry', gameId: 1, step: 7, name: 'ABCDEFG', drawing: grid16() }).length).toBe(46);
    expect(encodePacket({ type: 'entry', gameId: 0xffff, step: 8, name: 'ABCDEFG', text: 'ABCDEFGHIJKL' }).length).toBe(26);
    expect(encodePacket(start({ name: 'ABCDEFG' })).length).toBe(17);
    expect(encodePacket({ type: 'reveal', gameId: 1, players: 8 }).length).toBe(7);
    expect(encodePacket({ type: 'need', gameId: 1, step: 0 }).length).toBe(7);
    expect(encodePacket({ type: 'results', gameId: 1, funniest: 8, recognizable: 7, recovery: 6, final: 2 }).length).toBe(9);
  });

  it('ready check and results confirmation packets: call ≤ 16, hello ≤ 14, ack 7, need-start 7', () => {
    expect(encodePacket({ type: 'call', gameId: 5, players: 8, name: 'ABCDEFG', confirmed: 0xff, duplicate: 0x0c }).length).toBe(16);
    expect(encodePacket({ type: 'hello', gameId: 5, seat: 8, name: 'ABCDEFG' }).length).toBe(14);
    expect(encodePacket({ type: 'ack', gameId: 5, seat: 2 }).length).toBe(7);
    expect(encodePacket({ type: 'need', gameId: 5, step: NEED_START }).length).toBe(7);
    expect(() => encodePacket({ type: 'hello', gameId: 5, seat: 9, name: 'A' })).toThrow();
    expect(() => encodePacket({ type: 'call', gameId: 5, players: 4, name: 'A', confirmed: 256, duplicate: 0 })).toThrow();
    expect(() => encodePacket({ type: 'need', gameId: 1, step: 10 })).toThrow();
    expect(seatsToMask([1, 3, 8])).toBe(0b10000101);
    expect(maskToSeats(0b10000101)).toEqual([1, 3, 8]);
  });

  it('call, hello, and ack keys name their seat, so they never look like each other', () => {
    expect(packetKey({ type: 'hello', gameId: 5, seat: 3, name: 'Bo' })).toBe('5:hello:3');
    expect(packetKey({ type: 'ack', gameId: 5, seat: 3 })).toBe('5:ack:3');
  });

  it('start carries static level, mode, match ID, round, and category', () => {
    for (const noise of [0, 1, 2] as const) {
      for (const mode of ['quick', 'match'] as const) {
        for (const round of [1, 2, 3]) {
          const p = start({ noise, mode, round, category: 4, matchId: 0xbeef });
          expect(decodePacket(encodePacket(p))).toEqual({ ok: true, packet: p });
        }
      }
    }
  });

  it('only step 1 carries the secret word; odd steps carry a 16×16 drawing, even steps a guess', () => {
    expect(() => encodePacket({ type: 'entry', gameId: 1, step: 1, name: 'A', drawing: grid16() })).toThrow(/secret word/);
    expect(() => encodePacket({ type: 'entry', gameId: 1, step: 3, name: 'A', drawing: grid16(), word: 'cat' })).toThrow();
    expect(() => encodePacket({ type: 'entry', gameId: 1, step: 2, name: 'A', drawing: grid16() })).toThrow();
    expect(() => encodePacket({ type: 'entry', gameId: 1, step: 1, name: 'A', text: 'cat' })).toThrow();
    expect(() => encodePacket({ type: 'entry', gameId: 1, step: 3, name: 'A', drawing: emptyGrid(8) })).toThrow();
  });

  it('cleans text and names, and rejects invalid ones', () => {
    expect(cleanText('  witch   hat ')).toBe('witch hat');
    expect(cleanText('')).toBeNull();
    expect(cleanText('ABCDEFGHIJKLM')).toBeNull();
    expect(cleanText('café')).toBeNull();
    expect(cleanName('Urvisha')).toBe('Urvisha');
    expect(cleanName('Urvisha P')).toBeNull();
    expect(() => encodePacket(start({ players: 9 }))).toThrow();
    expect(() => encodePacket(start({ noise: 3 as never }))).toThrow();
    expect(() => encodePacket(start({ round: 4 }))).toThrow();
    expect(() => encodePacket(start({ category: 8 }))).toThrow();
    expect(() => encodePacket({ type: 'need', gameId: 1, step: 10 })).toThrow(); // 9 is "ask to join"
    expect(() => encodePacket({ type: 'results', gameId: 1, funniest: 9, recognizable: 0, recovery: 0, final: 0 })).toThrow();
  });

  it('dedupe key is game, type, and step; a request names its step', () => {
    expect(packetKey({ type: 'entry', gameId: 5, step: 3, name: 'A', drawing: grid16() })).toBe('5:entry:3');
    expect(packetKey({ type: 'need', gameId: 5, step: 3 })).toBe('5:need:3');
    expect(packetKey({ type: 'results', gameId: 5, funniest: 2, recognizable: 1, recovery: 0, final: 0 })).toBe('5:results:0');
  });
});

describe('invalid packets are rejected', () => {
  const good = encodePacket({ type: 'entry', gameId: 300, step: 2, name: 'Bo', text: 'fish' });

  it('length, magic (including v1 and v2), checksum, type', () => {
    expect(decodePacket(good.subarray(0, 5))).toEqual({ ok: false, error: 'too-short' });
    expect(decodePacket(new Uint8Array(59))).toEqual({ ok: false, error: 'too-long' });
    for (const magic of [0xd1, 0xd2, 0xa4]) {
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
    const s = encodePacket(start({ noise: 2 }));
    s[1] = (s[1] & 0x0f) | (3 << 4);
    expect(decodePacket(reseal(s))).toEqual({ ok: false, error: 'bad-type' });
  });

  it('start with round 0 or reserved bits set is rejected', () => {
    const s = encodePacket(start());
    const r0 = s.slice();
    r0[8] &= ~3;
    expect(decodePacket(reseal(r0)).ok).toBe(false);
    const hi = s.slice();
    hi[8] |= 0x40;
    expect(decodePacket(reseal(hi)).ok).toBe(false);
  });

  it('a step that disagrees with the payload kind is rejected', () => {
    const b = good.slice();
    b[4] = 3; // odd step, but no drawing bytes
    expect(decodePacket(reseal(b)).ok).toBe(false);
    const first = encodePacket({ type: 'entry', gameId: 1, step: 1, name: 'A', drawing: grid16(), word: 'cat' });
    const noWord = first.slice(0, 6 + 32).slice();
    const rebuilt = new Uint8Array([...noWord, ...first.subarray(6 + 32 + 3, first.length - 1), 0]);
    rebuilt[5] = 1 << 4; // name length 1, text length 0
    expect(decodePacket(reseal(rebuilt)).ok).toBe(false); // step 1 without its word
  });

  it('bad step / player counts / results values', () => {
    const b = good.slice();
    b[4] = 10;
    expect(decodePacket(reseal(b)).ok).toBe(false);
    const s = encodePacket(start());
    s[4] = 9;
    expect(decodePacket(reseal(s))).toEqual({ ok: false, error: 'bad-count' });
    const r = encodePacket({ type: 'results', gameId: 1, funniest: 2, recognizable: 1, recovery: 0, final: 1 });
    const bad = r.slice();
    bad[7] = 3;
    expect(decodePacket(reseal(bad))).toEqual({ ok: false, error: 'bad-count' });
    const n = encodePacket({ type: 'need', gameId: 1, step: 2 });
    n[4] = 10;
    expect(decodePacket(reseal(n))).toEqual({ ok: false, error: 'bad-count' });
    const h = encodePacket({ type: 'hello', gameId: 1, seat: 2, name: 'Bo' });
    h[4] = 0;
    expect(decodePacket(reseal(h))).toEqual({ ok: false, error: 'bad-count' });
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
      fc.property(fc.uint8Array({ maxLength: 60 }), (bytes) => {
        const r = decodePacket(bytes);
        if (r.ok) expect(encodePacket(r.packet)).toEqual(bytes);
      }),
    );
  });
});
