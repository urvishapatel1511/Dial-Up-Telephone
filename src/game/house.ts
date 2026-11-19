import type { Grid } from '../protocol/drawing';
import type { GhostMessage, Item, Stage } from '../protocol/message';
import { isKey, KEYS, pick, runeToGrid, START_ENERGY, type GameObject, type KeySymbol, type Rune4 } from './rules';

/**
 * The House (laptop): owns the ghost, the objects, and the keyhole.
 *
 * phase:
 *  object    choose an object for the Other Side's obstacle (start, or after it failed)
 *  key-retry the key didn't fit: send the ghost back for another key
 *  rune      door open: paint the exit rune onto the ghost (or repaint)
 *  away      the ghost is on the Other Side
 *  free      the ghost escaped (win)
 *  faded     spirit energy ran out (lose)
 */
export type HousePhase = 'object' | 'key-retry' | 'rune' | 'away' | 'free' | 'faded';

export interface House {
  ghostId: number;
  name: string;
  /** The player's original drawing. Never overwritten. */
  grid: Grid;
  keyhole: KeySymbol;
  energy: number;
  phase: HousePhase;
  /** Stage of the release in flight (valid while away). */
  inFlight: Stage;
  tries: { object: number; key: number; rune: number };
  startedAt: number;
  endedAt: number | null;
}

export type HouseOutcome =
  | { kind: 'object-failed'; faded: boolean }
  | { kind: 'key-wrong'; key: KeySymbol; faded: boolean }
  | { kind: 'door-opened'; key: KeySymbol }
  | { kind: 'rune-failed'; faded: boolean }
  | { kind: 'freed' }
  | { kind: 'ignored' };

export function newHouse(ghostId: number, name: string, grid: Grid, random: () => number, now: number): House {
  return {
    ghostId,
    name,
    grid: grid.map((r) => [...r]),
    keyhole: pick(KEYS, random),
    energy: START_ENERGY,
    phase: 'object',
    inFlight: 1,
    tries: { object: 0, key: 0, rune: 0 },
    startedAt: now,
    endedAt: null,
  };
}

export interface ReleaseChoice {
  object?: GameObject;
  rune?: Rune4;
}

export type ReleaseDraft = Pick<GhostMessage, 'stage' | 'item' | 'energy' | 'ok' | 'grid'>;

/** What the House sends in its current phase, or null if it can't send now. */
export function houseRelease(house: House, choice: ReleaseChoice): { house: House; draft: ReleaseDraft } | null {
  const base = { energy: house.energy, ok: false };
  let draft: ReleaseDraft;
  let tries = house.tries;
  switch (house.phase) {
    case 'object':
      if (!choice.object) return null;
      draft = { ...base, stage: 1, item: choice.object, grid: house.grid };
      tries = { ...tries, object: tries.object + 1 };
      break;
    case 'key-retry':
      draft = { ...base, stage: 2, item: 'none', grid: house.grid };
      break;
    case 'rune':
      if (!choice.rune) return null;
      draft = { ...base, stage: 3, item: 'none', grid: runeToGrid(choice.rune) };
      tries = { ...tries, rune: tries.rune + 1 };
      break;
    case 'faded':
      // Farewell: tell the Other Side the ghost has faded.
      draft = { ...base, energy: 0, stage: house.inFlight, item: 'none', grid: house.grid };
      return { house, draft };
    default:
      return null;
  }
  return { house: { ...house, phase: 'away', inFlight: draft.stage, tries }, draft };
}

function lose(house: House, now: number): House {
  return { ...house, energy: 0, phase: 'faded', endedAt: now };
}

/** Apply a ghost coming home. Answers for another stage, or after the game ended, are ignored. */
export function houseReceive(house: House, msg: GhostMessage, now: number): { house: House; outcome: HouseOutcome } {
  const ignored = { house, outcome: { kind: 'ignored' } as HouseOutcome };
  if (house.phase !== 'away' || msg.stage !== house.inFlight) return ignored;
  const energy = Math.min(house.energy, msg.energy);
  const h: House = { ...house, energy };

  if (msg.stage === 3) {
    if (msg.ok) return { house: { ...h, phase: 'free', endedAt: now }, outcome: { kind: 'freed' } };
    return energy === 0
      ? { house: lose(h, now), outcome: { kind: 'rune-failed', faded: true } }
      : { house: { ...h, phase: 'rune' }, outcome: { kind: 'rune-failed', faded: false } };
  }

  const item: Item = msg.item;
  if (item === 'none') {
    if (msg.stage !== 1) return ignored;
    return energy === 0
      ? { house: lose(h, now), outcome: { kind: 'object-failed', faded: true } }
      : { house: { ...h, phase: 'object' }, outcome: { kind: 'object-failed', faded: false } };
  }
  if (!isKey(item)) return ignored;

  const tried = { ...h, tries: { ...h.tries, key: h.tries.key + 1 } };
  if (item === house.keyhole) return { house: { ...tried, phase: 'rune' }, outcome: { kind: 'door-opened', key: item } };
  const left = energy - 1;
  return left <= 0
    ? { house: lose(tried, now), outcome: { kind: 'key-wrong', key: item, faded: true } }
    : { house: { ...tried, energy: left, phase: 'key-retry' }, outcome: { kind: 'key-wrong', key: item, faded: false } };
}
