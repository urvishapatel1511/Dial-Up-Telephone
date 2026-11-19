/** Minimal typings for the ggwave 0.4.0 embind module (bindings/javascript/emscripten.cpp). */
export interface GgwaveParameters {
  payloadLength: number;
  sampleRateInp: number;
  sampleRateOut: number;
  sampleRate: number;
  samplesPerFrame: number;
  soundMarkerThreshold: number;
  sampleFormatInp: unknown;
  sampleFormatOut: unknown;
  operatingMode: number;
}

export interface GgwaveModule {
  getDefaultParameters(): GgwaveParameters;
  init(params: GgwaveParameters): number;
  free(instance: number): void;
  /** Returns a view of float32 sample bytes over a static buffer. Copy before the next call. */
  encode(instance: number, data: string | Uint8Array, protocolId: unknown, volume: number): Int8Array;
  /** Input: raw bytes of float32 samples. Returns a view over a static buffer. Copy immediately. */
  decode(instance: number, data: Int8Array | Uint8Array): Int8Array;
  disableLog(): void;
  ProtocolId: Record<string, unknown>;
}

export type GgwaveFactory = () => Promise<GgwaveModule>;
