export type MicError = 'insecure' | 'unsupported' | 'denied' | 'no-mic' | 'busy' | 'unknown';

export const MIC_ERROR_TEXT: Record<MicError, string> = {
  insecure:
    'The microphone needs a secure page. Open this site with https:// (see docs/hardware-test.md).',
  unsupported: 'This browser cannot use the microphone. Try Chrome on Android or Safari on iPhone.',
  denied:
    'Microphone access was blocked. Tap the lock or "aA" icon next to the address, allow Microphone for this site, then reload and press Listen again.',
  'no-mic': 'No microphone was found on this device.',
  busy: 'The microphone is in use by another app or tab. Close it and press Listen again.',
  unknown: 'The microphone could not start. Reload the page and press Listen again.',
};

export function classifyMicError(err: unknown): MicError {
  const name = (err as { name?: string } | null)?.name ?? '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'denied';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'no-mic';
  if (name === 'NotReadableError' || name === 'AbortError') return 'busy';
  return 'unknown';
}

/**
 * Microphone capture that exists only while listening. stop() releases every
 * track so the browser's mic indicator turns off.
 */
export class Listener {
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private processor: ScriptProcessorNode | null = null;
  private sink: GainNode | null = null;

  constructor(
    private readonly ctx: AudioContext,
    private readonly onBlock: (samples: Float32Array) => void,
    /** Optional extra destination for the mic signal (visualizer). */
    private readonly tap?: AudioNode,
  ) {}

  get active(): boolean {
    return this.stream !== null;
  }

  async start(): Promise<void> {
    if (this.active) return;
    if (!window.isSecureContext) throw Object.assign(new Error('insecure'), { micError: 'insecure' as MicError });
    if (!navigator.mediaDevices?.getUserMedia) {
      throw Object.assign(new Error('unsupported'), { micError: 'unsupported' as MicError });
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, autoGainControl: false, noiseSuppression: false },
      });
    } catch (err) {
      throw Object.assign(new Error('mic'), { micError: classifyMicError(err) });
    }
    await this.ctx.resume();
    this.stream = stream;
    this.source = this.ctx.createMediaStreamSource(stream);
    // Same approach as the upstream ggwave-js example: 1024-frame ScriptProcessor.
    this.processor = this.ctx.createScriptProcessor(1024, 1, 1);
    this.processor.onaudioprocess = (e) => this.onBlock(new Float32Array(e.inputBuffer.getChannelData(0)));
    // Route through a muted gain so the processor runs without echoing the mic to the speaker.
    this.sink = this.ctx.createGain();
    this.sink.gain.value = 0;
    this.source.connect(this.processor);
    if (this.tap) this.source.connect(this.tap);
    this.processor.connect(this.sink);
    this.sink.connect(this.ctx.destination);
  }

  stop(): void {
    this.processor?.disconnect();
    this.source?.disconnect();
    this.sink?.disconnect();
    if (this.processor) this.processor.onaudioprocess = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = this.source = this.processor = this.sink = null;
  }
}

export function micErrorOf(err: unknown): MicError {
  return (err as { micError?: MicError } | null)?.micError ?? 'unknown';
}
