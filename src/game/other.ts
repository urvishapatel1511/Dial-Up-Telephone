import type { Grid } from '../protocol/drawing';
import type { GhostMessage, Stage } from '../protocol/message';
import {
  blockDistance,
  gridToRune,
  isObject,
  OBSTACLES,
  RUNE_TOLERANCE,
  RUNES,
  START_ENERGY,
  type GameObject,
  type KeySymbol,
} from './rules';

/**
 * The Other Side (phone): owns the obstacle, the keys, and the exit rune.
 * The room is rolled locally, before any ghost arrives, so the player can
 * describe it while the House decides.
 *
 * phase:
 *  waiting   no ghost yet
 *  blocked   the object didn't help: send the ghost home for another one
 *  keys      choose a key and send the ghost home
 *  rune-bad  the painted rune was wrong: send the ghost home to repaint
 *  freed     the rune matched: send the ghost home, free
 *  sent      the ghost is on its way to the House
 *  over      the ghost faded
 */
export type OtherPhase = 'waiting' | 'blocked' | 'keys' | 'rune-bad' | 'freed' | 'sent' | 'over';

export interface OtherRoom {
  obstacle: number;
  rune: number;
}

export interface Other {
  room: OtherRoom;
  ghost: { ghostId: number; name: string; grid: Grid } | null;
  energy: number;
  phase: OtherPhase;
  cleared: boolean;
  /** Stage of the last arrival (what a return must answer). */
  stage: Stage;
  /** Last object the ghost brought. */
  brought: GameObject | null;
  /** Blocks wrong in the last painted rune. */
  runeOff: number | null;
  /** Phase after the ghost faded or escaped and the news was sent home. */
  ended: 'free' | 'faded' | null;
}

export type OtherOutcome =
  | { kind: 'arrived-object-worked'; object: GameObject }
  | { kind: 'arrived-object-failed'; object: GameObject | null; faded: boolean }
  | { kind: 'arrived-key-retry' }
  | { kind: 'arrived-rune-worked' }
  | { kind: 'arrived-rune-failed'; off: number; faded: boolean }
  | { kind: 'arrived-faded' }
  | { kind: 'ignored' };

export function newRoom(random: () => number): OtherRoom {
  return {
    obstacle: Math.min(OBSTACLES.length - 1, Math.floor(random() * OBSTACLES.length)),
    rune: Math.min(RUNES.length - 1, Math.floor(random() * RUNES.length)),
  };
}

export function newOther(room: OtherRoom): Other {
  return {
    room,
    ghost: null,
    energy: START_ENERGY,
    phase: 'waiting',
    cleared: false,
    stage: 1,
    brought: null,
    runeOff: null,
    ended: null,
  };
}

export function otherReceive(other: Other, msg: GhostMessage): { other: Other; outcome: OtherOutcome } {
  const ignored = { other, outcome: { kind: 'ignored' } as OtherOutcome };
  const isNew = !other.ghost || other.ghost.ghostId !== msg.ghostId;
  if (isNew && msg.stage !== 1) return ignored;
  if (!isNew && other.ended) return ignored;

  let o: Other = isNew
    ? {
        ...newOther(other.room),
        ghost: { ghostId: msg.ghostId, name: msg.name, grid: msg.grid.map((r) => [...r]) },
      }
    : { ...other };
  o = { ...o, stage: msg.stage, energy: Math.min(isNew ? START_ENERGY : o.energy, msg.energy), runeOff: null };

  if (msg.energy === 0) return { other: { ...o, energy: 0, phase: 'over', ended: 'faded' }, outcome: { kind: 'arrived-faded' } };

  if (msg.stage === 1) {
    if (o.cleared) return { other: { ...o, phase: 'keys' }, outcome: { kind: 'arrived-key-retry' } };
    const object = isObject(msg.item) ? msg.item : null;
    if (object && object === OBSTACLES[o.room.obstacle].needs) {
      return { other: { ...o, brought: object, cleared: true, phase: 'keys' }, outcome: { kind: 'arrived-object-worked', object } };
    }
    const energy = o.energy - 1;
    return {
      other: { ...o, brought: object, energy, phase: 'blocked' },
      outcome: { kind: 'arrived-object-failed', object, faded: energy <= 0 },
    };
  }

  if (msg.stage === 2) return { other: { ...o, phase: 'keys' }, outcome: { kind: 'arrived-key-retry' } };

  const off = blockDistance(gridToRune(msg.grid), RUNES[o.room.rune].blocks);
  if (off <= RUNE_TOLERANCE) return { other: { ...o, phase: 'freed' }, outcome: { kind: 'arrived-rune-worked' } };
  const energy = o.energy - 1;
  return {
    other: { ...o, energy, phase: 'rune-bad', runeOff: off },
    outcome: { kind: 'arrived-rune-failed', off, faded: energy <= 0 },
  };
}

export type ReturnDraft = Pick<GhostMessage, 'stage' | 'item' | 'energy' | 'ok' | 'grid' | 'ghostId' | 'name'>;

/** What the Other Side sends home now, or null if it can't send. */
export function otherReturn(other: Other, choice: { key?: KeySymbol }): { other: Other; draft: ReturnDraft } | null {
  const g = other.ghost;
  if (!g) return null;
  const base = { ghostId: g.ghostId, name: g.name, grid: g.grid, stage: other.stage, energy: Math.max(0, other.energy) };
  let draft: ReturnDraft;
  let next: Other = { ...other, phase: 'sent' };
  switch (other.phase) {
    case 'blocked':
      draft = { ...base, item: 'none', ok: false };
      if (other.energy <= 0) next = { ...next, phase: 'over', ended: 'faded' };
      break;
    case 'keys':
      if (!choice.key) return null;
      draft = { ...base, item: choice.key, ok: false };
      break;
    case 'rune-bad':
      draft = { ...base, item: 'none', ok: false };
      if (other.energy <= 0) next = { ...next, phase: 'over', ended: 'faded' };
      break;
    case 'freed':
      draft = { ...base, item: 'none', ok: true };
      next = { ...next, phase: 'over', ended: 'free' };
      break;
    default:
      return null;
  }
  return { other: next, draft };
}
