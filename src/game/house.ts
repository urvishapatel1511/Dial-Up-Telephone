import type { Grid } from '../protocol/drawing';
import { STAGE, type GhostMessage, type Stage } from '../protocol/message';
import { lockPuzzle } from './puzzles';
import { isKey, runeToGrid, START_ENERGY, type GameObject, type KeySymbol, type Rune4, type Spot } from './rules';

/**
 * The House (laptop): draws the ghost, owns the objects and the lock, paints
 * the rune, and chooses where to look for the hat.
 *
 *  summon    ghost drawn, summon chirp not played yet
 *  away      a chirp was played; waiting for the ghost to come home (inFlight = its stage)
 *  object    paired: choose an object for the Other Side's obstacle (again after a miss)
 *  key-retry the key didn't fit: send the ghost back for another
 *  rune      the lock is open: paint the true rune
 *  bonus     the main rescue is done: try for the hat, or skip
 *  free      the adventure is over (with or without the hat)
 *  faded     spirit energy ran out
 */
export type HousePhase = 'summon' | 'away' | 'object' | 'key-retry' | 'rune' | 'bonus' | 'free' | 'faded';
export type BonusResult = 'skipped' | 'won' | 'lost' | null;

export interface Solved {
  obstacle: boolean;
  lock: boolean;
  rune: boolean;
}

export interface House {
  ghostId: number;
  name: string;
  /** The player's original drawing. Never overwritten. */
  grid: Grid;
  energy: number;
  phase: HousePhase;
  inFlight: Stage;
  /** Partner tag of the Other Side that accepted the ghost (0 = not paired yet). */
  partner: number;
  tries: { object: number; key: number; rune: number };
  solved: Solved;
  bonus: BonusResult;
  /** The Other Side already knows the game ended (or was told). */
  farewellSent: boolean;
  startedAt: number;
  endedAt: number | null;
}

export type HouseOutcome =
  | { kind: 'paired' }
  | { kind: 'object-failed'; faded: boolean }
  | { kind: 'key-right'; key: KeySymbol; cleared: boolean }
  | { kind: 'key-wrong'; key: KeySymbol; cleared: boolean; faded: boolean }
  | { kind: 'rune-failed'; faded: boolean }
  | { kind: 'rescued' }
  | { kind: 'hat'; won: boolean }
  | { kind: 'ignored' };

export const noSolved = (): Solved => ({ obstacle: false, lock: false, rune: false });

export function newHouse(ghostId: number, name: string, grid: Grid, now: number): House {
  return {
    ghostId,
    name,
    grid: grid.map((r) => [...r]),
    energy: START_ENERGY,
    phase: 'summon',
    inFlight: STAGE.summon,
    partner: 0,
    tries: { object: 0, key: 0, rune: 0 },
    solved: noSolved(),
    bonus: null,
    farewellSent: false,
    startedAt: now,
    endedAt: null,
  };
}

export interface ReleaseChoice {
  object?: GameObject;
  rune?: Rune4;
  spot?: Spot;
  skip?: boolean;
}

export type ReleaseDraft = Pick<GhostMessage, 'stage' | 'item' | 'energy' | 'ok' | 'hat' | 'partner' | 'grid'>;

/**
 * What the House sends now and the state it moves to once the chirp has
 * actually played. Returns null if nothing can be sent in this phase.
 */
export function houseRelease(h: House, choice: ReleaseChoice, now: number): { house: House; draft: ReleaseDraft } | null {
  const base: ReleaseDraft = { stage: 1, item: 'none', energy: h.energy, ok: false, hat: false, partner: h.partner, grid: h.grid };
  const away = (stage: Stage, extra: Partial<House> = {}): House => ({ ...h, ...extra, phase: 'away', inFlight: stage });
  switch (h.phase) {
    case 'summon':
      return { house: away(STAGE.summon), draft: { ...base, stage: STAGE.summon, partner: 0 } };
    case 'object':
      if (!choice.object) return null;
      return {
        house: away(STAGE.obstacle, { tries: { ...h.tries, object: h.tries.object + 1 } }),
        draft: { ...base, stage: STAGE.obstacle, item: choice.object },
      };
    case 'key-retry':
      return { house: away(STAGE.keyRetry), draft: { ...base, stage: STAGE.keyRetry } };
    case 'rune':
      if (!choice.rune) return null;
      return {
        house: away(STAGE.rune, { tries: { ...h.tries, rune: h.tries.rune + 1 } }),
        draft: { ...base, stage: STAGE.rune, grid: runeToGrid(choice.rune) },
      };
    case 'bonus':
      if (choice.skip) {
        return {
          house: { ...h, phase: 'free', bonus: 'skipped', farewellSent: true, endedAt: now },
          draft: { ...base, stage: STAGE.farewell, ok: true },
        };
      }
      if (!choice.spot) return null;
      return { house: away(STAGE.hat), draft: { ...base, stage: STAGE.hat, item: choice.spot } };
    case 'faded':
      if (h.farewellSent) return null;
      return { house: { ...h, farewellSent: true }, draft: { ...base, stage: STAGE.farewell, energy: 0 } };
    default:
      return null;
  }
}

const IGNORED = { kind: 'ignored' } as const;

/** Apply a ghost coming home. Anything not answering the chirp in flight is ignored. */
export function houseReceive(h: House, msg: GhostMessage, now: number): { house: House; outcome: HouseOutcome } {
  const ignored = { house: h, outcome: IGNORED as HouseOutcome };
  if (h.phase !== 'away' || msg.stage !== h.inFlight) return ignored;

  if (h.inFlight === STAGE.summon) {
    if (msg.partner < 1) return ignored;
    return { house: { ...h, partner: msg.partner, phase: 'object' }, outcome: { kind: 'paired' } };
  }
  if (msg.partner !== h.partner) return ignored;

  const energy = Math.min(h.energy, msg.energy);
  const home: House = { ...h, energy };
  const fade = (x: House, toldAlready: boolean): House => ({ ...x, energy: 0, phase: 'faded', endedAt: now, farewellSent: toldAlready });

  const checkKey = (key: KeySymbol, cleared: boolean): { house: House; outcome: HouseOutcome } => {
    const tried: House = {
      ...home,
      tries: { ...home.tries, key: home.tries.key + 1 },
      solved: { ...home.solved, obstacle: true },
    };
    if (key === lockPuzzle(h.ghostId).answer) {
      return { house: { ...tried, phase: 'rune', solved: { ...tried.solved, lock: true } }, outcome: { kind: 'key-right', key, cleared } };
    }
    const left = energy - 1;
    // The House is the only one who knows the key was wrong, so it must tell the Other Side if the ghost fades.
    if (left <= 0) return { house: fade(tried, false), outcome: { kind: 'key-wrong', key, cleared, faded: true } };
    return { house: { ...tried, energy: left, phase: 'key-retry' }, outcome: { kind: 'key-wrong', key, cleared, faded: false } };
  };

  switch (msg.stage) {
    case STAGE.obstacle:
      if (msg.item === 'none') {
        if (energy <= 0) return { house: fade(home, true), outcome: { kind: 'object-failed', faded: true } };
        return { house: { ...home, phase: 'object' }, outcome: { kind: 'object-failed', faded: false } };
      }
      return isKey(msg.item) ? checkKey(msg.item, true) : ignored;
    case STAGE.keyRetry:
      return isKey(msg.item) ? checkKey(msg.item, false) : ignored;
    case STAGE.rune:
      if (msg.ok) {
        return { house: { ...home, phase: 'bonus', solved: { ...home.solved, rune: true } }, outcome: { kind: 'rescued' } };
      }
      if (energy <= 0) return { house: fade(home, true), outcome: { kind: 'rune-failed', faded: true } };
      return { house: { ...home, phase: 'rune' }, outcome: { kind: 'rune-failed', faded: false } };
    case STAGE.hat:
      return {
        house: { ...home, phase: 'free', bonus: msg.hat ? 'won' : 'lost', farewellSent: true, endedAt: now },
        outcome: { kind: 'hat', won: msg.hat },
      };
    default:
      return ignored;
  }
}

/** Main rescue complete (the bonus never undoes this). */
export function houseRescued(h: House): boolean {
  return h.solved.rune;
}
