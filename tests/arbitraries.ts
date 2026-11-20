import fc from 'fast-check';
import type { Packet } from '../src/protocol/packet';

export const gridArb = fc.array(fc.array(fc.boolean(), { minLength: 8, maxLength: 8 }), { minLength: 8, maxLength: 8 });

/** Printable ASCII, already in canonical form (trimmed, single spaces). */
const canonical = (max: number) =>
  fc
    .array(fc.integer({ min: 0x20, max: 0x7e }), { minLength: 1, maxLength: max })
    .map((c) => String.fromCharCode(...c))
    .filter((s) => s.trim() === s && s.length > 0 && !/\s\s/.test(s));

export const nameArb = canonical(7);
export const textArb = canonical(12);
const gameId = fc.integer({ min: 0, max: 0xffff });
const players = fc.integer({ min: 2, max: 8 });

export const packetArb: fc.Arbitrary<Packet> = fc.oneof(
  fc.record({ type: fc.constant('start' as const), gameId, players, name: nameArb }),
  fc.record({ type: fc.constant('reveal' as const), gameId, players, word: textArb }),
  fc.record({ type: fc.constant('entry' as const), gameId, step: fc.constantFrom(1, 3, 5, 7), name: nameArb, drawing: gridArb }),
  fc.record({ type: fc.constant('entry' as const), gameId, step: fc.constantFrom(2, 4, 6, 8), name: nameArb, text: textArb }),
);
