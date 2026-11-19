/**
 * Safe sending (R4.3, R4.4): play first, commit the new game state only after
 * the chirp has played. If playback fails, nothing changes. Because the
 * transfer ID was not advanced, rebuilding the same choice produces
 * byte-identical data, so a retry is safe even if the other device did hear it.
 */
export type SendResult = { ok: true; ms: number } | { ok: false; reason: 'busy' } | { ok: false; reason: 'failed'; error: unknown };

export class SendGate {
  private running = false;

  get busy(): boolean {
    return this.running;
  }

  async run<S>(
    out: { state: S; bytes: Uint8Array },
    play: (bytes: Uint8Array) => Promise<number>,
    commit: (state: S, ms: number) => void,
  ): Promise<SendResult> {
    if (this.running) return { ok: false, reason: 'busy' };
    this.running = true;
    try {
      const ms = await play(out.bytes);
      commit(out.state, ms);
      return { ok: true, ms };
    } catch (error) {
      return { ok: false, reason: 'failed', error };
    } finally {
      this.running = false;
    }
  }
}
