/**
 * When to apply a downloaded app update (pure, so it can be tested in Node).
 *
 * The page never reloads by itself. The player taps "Reload to update".
 * While a chirp plays the button waits. During a round it asks first,
 * because reloading takes the microphone away and may miss a chirp.
 */
export interface UpdateMoment {
  /** A round is in progress on this phone (not in the lobby, not at the reveal). */
  inRound: boolean;
  /** This player is drawing or typing a turn right now. */
  busyTurn: boolean;
  /** A chirp is playing or about to play. */
  sending: boolean;
}

export interface UpdateAdvice {
  /** The button can be pressed now. */
  enabled: boolean;
  /** Ask before reloading (null = reload straight away). */
  confirm: string | null;
  /** Short line under "Update available". */
  note: string;
}

export const UPDATE_NOTE = 'Update between games, so every phone runs the same version.';

export function updateAdvice(m: UpdateMoment): UpdateAdvice {
  if (m.sending) return { enabled: false, confirm: null, note: 'Wait for the chirp to finish.' };
  if (m.busyTurn) {
    return {
      enabled: true,
      confirm: 'Reload now? Your unsent turn will be lost and this phone may miss chirps. Better: update after this game.',
      note: `Finish your turn first. ${UPDATE_NOTE}`,
    };
  }
  if (m.inRound) {
    return {
      enabled: true,
      confirm: 'A round is in progress. Reload now? This phone may miss chirps while it reloads. Better: update after this game.',
      note: `A round is in progress. ${UPDATE_NOTE}`,
    };
  }
  return { enabled: true, confirm: null, note: UPDATE_NOTE };
}

/** Text for a chirp from another version of the game (it can't be read by this one). */
export function versionMismatchText(kind: 'old-version' | 'new-version'): string {
  return kind === 'old-version'
    ? 'A phone nearby runs an older version of the game, so this phone can’t read its chirps. That phone should reload the game (online) between games.'
    : 'A phone nearby runs a newer version of the game, so this phone can’t read its chirps. Reload this page (online) between games to update.';
}
