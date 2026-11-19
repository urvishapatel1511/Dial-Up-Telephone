import type { GgwaveFactory, GgwaveModule } from './ggwave-types';

export type ProtocolName = 'AUDIBLE_NORMAL' | 'AUDIBLE_FAST' | 'AUDIBLE_FASTEST';
export const DEFAULT_PROTOCOL: ProtocolName = 'AUDIBLE_FAST';
const VOLUME = 25; // ggwave volume 0..100. Upstream example uses 10. Raise if the receiver misses chirps.

/**
 * Thin wrapper around one ggwave instance. Works in the browser (global
 * ggwave_factory from /vendor/ggwave.js) and in Node tests (require('ggwave')).
 */
export class Modem {
  private constructor(
    private readonly gg: GgwaveModule,
    private readonly instance: number,
    readonly sampleRate: number,
  ) {}

  static async create(factory: GgwaveFactory, sampleRate: number): Promise<Modem> {
    const gg = await factory();
    gg.disableLog();
    const params = gg.getDefaultParameters();
    params.sampleRateInp = sampleRate;
    params.sampleRateOut = sampleRate;
    return new Modem(gg, gg.init(params), sampleRate);
  }

  /** Binary payload -> mono float32 samples at `sampleRate` (copied out of WASM memory). */
  encode(payload: Uint8Array, protocol: ProtocolName = DEFAULT_PROTOCOL): Float32Array {
    const view = this.gg.encode(this.instance, payload, this.gg.ProtocolId[`GGWAVE_PROTOCOL_${protocol}`], VOLUME);
    const copy = new Uint8Array(view.byteLength);
    copy.set(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
    return new Float32Array(copy.buffer);
  }

  /** Feed a block of mic samples. Returns decoded bytes when a full message completes. */
  decode(samples: Float32Array): Uint8Array | null {
    const bytes = new Int8Array(samples.buffer.slice(samples.byteOffset, samples.byteOffset + samples.byteLength));
    const res = this.gg.decode(this.instance, bytes);
    if (!res || res.length === 0) return null;
    return new Uint8Array(res.buffer.slice(res.byteOffset, res.byteOffset + res.byteLength));
  }

  durationMs(samples: Float32Array): number {
    return Math.round((samples.length / this.sampleRate) * 1000);
  }
}
