import fc from 'fast-check';
import type { NoiseLevel, Packet } from '../src/protocol/packet';

const square = (n: number) => fc.array(fc.array(fc.boolean(), { minLength: n, maxLength: n }), { minLength: n, maxLength: n });
export const gridArb = square(8);
export const gridArb16 = square(16);

/** Printable ASCII, already in canonical form (trimmed, single spaces). */
const canonical = (max: number) =>
  fc
    .array(fc.integer({ min: 0x20, max: 0x7e }), { minLength: 1, maxLength: max })
    .map((c) => String.fromCharCode(...c))
    .filter((s) => s.trim() === s && s.length > 0 && !/\s\s/.test(s));

export const nameArb = canonical(7);
export const textArb = canonical(12);
export const noiseArb = fc.constantFrom<NoiseLevel>(0, 1, 2);
const gameId = fc.integer({ min: 0, max: 0xffff });
const players = fc.integer({ min: 2, max: 8 });

export const packetArb: fc.Arbitrary<Packet> = fc.oneof(
  fc.record({ type: fc.constant('start' as const), gameId, players, name: nameArb, noise: noiseArb }),
  fc.record({ type: fc.constant('reveal' as const), gameId, players, word: textArb }),
  fc.record({ type: fc.constant('award' as const), gameId, step: fc.integer({ min: 1, max: 8 }) }),
  fc.record({ type: fc.constant('entry' as const), gameId, step: fc.constantFrom(1, 3, 5, 7), name: nameArb, drawing: gridArb16 }),
  fc.record({ type: fc.constant('entry' as const), gameId, step: fc.constantFrom(2, 4, 6, 8), name: nameArb, text: textArb }),
);
