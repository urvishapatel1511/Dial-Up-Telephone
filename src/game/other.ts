import type { Grid } from '../protocol/drawing';
import { STAGE, type GhostMessage, type Stage } from '../protocol/message';
import { noSolved, type Solved } from './house';
import { hatPuzzle } from './puzzles';
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
  type Spot,
} from './rules';

/**
 * The Other Side (phone): the haunted room. It owns the obstacle, the keys,
 * and the lying mirror. The room is rolled locally before any ghost arrives,
 * so the player can describe it while waiting.
 *
 *  waiting   no ghost yet
 *  calling   a ghost was summoned: press Accept to pair with it
 *  sent      the ghost is on its way to the House
 *  blocked   the object didn't help: send the ghost home empty-handed
 *  keys      choose a key
 *  rune-bad  the painted rune didn't match: send the ghost home to repaint
 *  freed     the rune matched: send the ghost home, free
 *  hat-reply a hat guess arrived: send the verdict
 *  over      the adventure ended (see `ended` and `bonus`)
 */
export type OtherPhase = 'waiting' | 'calling' | 'sent' | 'blocked' | 'keys' | 'rune-bad' | 'freed' | 'hat-reply' | 'over';

export interface OtherRoom {
  obstacle: number;
  rune: number;
}

export interface GhostInfo {
  ghostId: number;
  name: string;
  grid: Grid;
}

export interface Other {
  room: OtherRoom;
  /** A ghost that called but hasn't been accepted. */
  candidate: GhostInfo | null;
  /** The paired ghost. */
  ghost: GhostInfo | null;
  partner: number;
  energy: number;
  phase: OtherPhase;
  /** Stage of the last arrival (what a return must answer). */
  stage: Stage;
  cleared: boolean;
  brought: GameObject | null;
  runeOff: number | null;
  solved: Solved;
  ended: 'free' | 'faded' | null;
  bonus: 'won' | 'lost' | 'skipped' | null;
  hatGuess: Spot | null;
  startedAt: number | null;
  endedAt: number | null;
}

export type OtherOutcome =
  | { kind: 'calling' }
  | { kind: 'object-worked'; object: GameObject }
  | { kind: 'object-failed'; object: GameObject | null; faded: boolean }
  | { kind: 'key-retry' }
  | { kind: 'rune-worked' }
  | { kind: 'rune-failed'; off: number; faded: boolean }
  | { kind: 'hat'; won: boolean }
  | { kind: 'farewell'; faded: boolean }
  | { kind: 'not-ours' }
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
    candidate: null,
    ghost: null,
    partner: 0,
    energy: START_ENERGY,
    phase: 'waiting',
    stage: STAGE.summon,
    cleared: false,
    brought: null,
    runeOff: null,
    solved: noSolved(),
    ended: null,
    bonus: null,
    hatGuess: null,
    startedAt: null,
    endedAt: null,
  };
}

const info = (m: GhostMessage): GhostInfo => ({ ghostId: m.ghostId, name: m.name, grid: m.grid.map((r) => [...r]) });

export function otherReceive(o: Other, msg: GhostMessage, now: number): { other: Other; outcome: OtherOutcome } {
  const result = (other: Other, outcome: OtherOutcome) => ({ other, outcome });
  const ignored = result(o, { kind: 'ignored' });

  if (msg.stage === STAGE.summon) {
    // Only an unpaired room listens for summons. A paired room keeps its ghost until a deliberate restart.
    if (o.ghost) return result(o, { kind: 'not-ours' });
    if (o.phase !== 'waiting' && o.phase !== 'calling') return ignored;
    return result({ ...o, candidate: info(msg), phase: 'calling' }, { kind: 'calling' });
  }

  if (!o.ghost || msg.ghostId !== o.ghost.ghostId || msg.partner !== o.partner) return result(o, { kind: 'not-ours' });

  if (msg.stage === STAGE.farewell) {
    if (msg.energy === 0 && o.ended !== 'faded') {
      return result({ ...o, energy: 0, phase: 'over', ended: 'faded', endedAt: now }, { kind: 'farewell', faded: true });
    }
    if (msg.ok && o.ended === 'free' && o.bonus === null) {
      return result({ ...o, bonus: 'skipped', endedAt: now }, { kind: 'farewell', faded: false });
    }
    return ignored;
  }

  if (msg.stage === STAGE.hat) {
    if (o.ended !== 'free' || o.bonus !== null || o.phase !== 'over') return ignored;
    const won = msg.item === hatPuzzle(o.ghost.ghostId).answer;
    return result(
      { ...o, bonus: won ? 'won' : 'lost', hatGuess: msg.item as Spot, phase: 'hat-reply' },
      { kind: 'hat', won },
    );
  }

  if (o.ended) return ignored;
  const x: Other = { ...o, stage: msg.stage, energy: Math.min(o.energy, msg.energy), runeOff: null };

  switch (msg.stage) {
    case STAGE.obstacle: {
      if (x.cleared) return result({ ...x, phase: 'keys' }, { kind: 'key-retry' });
      const object = isObject(msg.item) ? msg.item : null;
      if (object && object === OBSTACLES[x.room.obstacle].needs) {
        return result(
          { ...x, brought: object, cleared: true, phase: 'keys', solved: { ...x.solved, obstacle: true } },
          { kind: 'object-worked', object },
        );
      }
      const energy = x.energy - 1;
      return result({ ...x, brought: object, energy, phase: 'blocked' }, { kind: 'object-failed', object, faded: energy <= 0 });
    }
    case STAGE.keyRetry:
      return result({ ...x, phase: 'keys' }, { kind: 'key-retry' });
    case STAGE.rune: {
      // A rune only arrives after the House's lock opened.
      const y: Other = { ...x, solved: { ...x.solved, obstacle: true, lock: true } };
      const off = blockDistance(gridToRune(msg.grid), RUNES[y.room.rune].blocks);
      if (off <= RUNE_TOLERANCE) {
        return result({ ...y, phase: 'freed', solved: { ...y.solved, rune: true } }, { kind: 'rune-worked' });
      }
      const energy = y.energy - 1;
      return result({ ...y, energy, phase: 'rune-bad', runeOff: off }, { kind: 'rune-failed', off, faded: energy <= 0 });
    }
    default:
      return ignored;
  }
}

export type ReturnDraft = Pick<GhostMessage, 'stage' | 'item' | 'energy' | 'ok' | 'hat' | 'partner' | 'grid' | 'ghostId' | 'name'>;

export interface ReturnChoice {
  key?: KeySymbol;
  /** Fresh partner tag (1..15), needed to accept. */
  partner?: number;
}

/** What the Other Side sends now, and the state it moves to once the chirp has played. */
export function otherReturn(o: Other, choice: ReturnChoice, now: number): { other: Other; draft: ReturnDraft } | null {
  if (o.phase === 'calling') {
    const g = o.candidate;
    const p = choice.partner;
    if (!g || !p || p < 1 || p > 15) return null;
    return {
      other: { ...o, ghost: g, candidate: null, partner: p, energy: START_ENERGY, phase: 'sent', stage: STAGE.summon, startedAt: now },
      draft: { stage: STAGE.summon, item: 'none', energy: START_ENERGY, ok: false, hat: false, partner: p, ...g },
    };
  }
  const g = o.ghost;
  if (!g) return null;
  const base: ReturnDraft = {
    stage: o.stage,
    item: 'none',
    energy: Math.max(0, o.energy),
    ok: false,
    hat: false,
    partner: o.partner,
    ...g,
  };
  const faded = (): Other => ({ ...o, energy: 0, phase: 'over', ended: 'faded', endedAt: now });
  switch (o.phase) {
    case 'blocked':
      return { other: o.energy <= 0 ? faded() : { ...o, phase: 'sent' }, draft: base };
    case 'keys':
      if (!choice.key) return null;
      return { other: { ...o, phase: 'sent' }, draft: { ...base, item: choice.key } };
    case 'rune-bad':
      return { other: o.energy <= 0 ? faded() : { ...o, phase: 'sent' }, draft: base };
    case 'freed':
      return { other: { ...o, phase: 'over', ended: 'free' }, draft: { ...base, ok: true } };
    case 'hat-reply':
      return {
        other: { ...o, phase: 'over', endedAt: now },
        draft: { ...base, stage: STAGE.hat, item: o.hatGuess ?? 'none', ok: true, hat: o.bonus === 'won' },
      };
    default:
      return null;
  }
}
