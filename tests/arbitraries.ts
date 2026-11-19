import fc from 'fast-check';
import { ITEMS, type GhostMessage } from '../src/protocol/message';

export const gridArb = fc.array(fc.array(fc.boolean(), { minLength: 8, maxLength: 8 }), {
  minLength: 8,
  maxLength: 8,
});

export const runeArb = fc.array(fc.array(fc.boolean(), { minLength: 4, maxLength: 4 }), {
  minLength: 4,
  maxLength: 4,
});

/** Printable ASCII, 1-10 chars, no leading/trailing space (names are trimmed). */
export const nameArb = fc
  .array(fc.integer({ min: 0x20, max: 0x7e }), { minLength: 1, maxLength: 10 })
  .map((codes) => String.fromCharCode(...codes))
  .filter((s) => s.trim() === s && s.length > 0);

export const messageArb: fc.Arbitrary<GhostMessage> = fc.record({
  direction: fc.constantFrom('release' as const, 'return' as const),
  stage: fc.constantFrom(1 as const, 2 as const, 3 as const),
  item: fc.constantFrom(...ITEMS),
  energy: fc.integer({ min: 0, max: 3 }),
  ok: fc.boolean(),
  ghostId: fc.integer({ min: 0, max: 0xffff }),
  transferId: fc.integer({ min: 0, max: 0xff }),
  grid: gridArb,
  name: nameArb,
});
