/**
 * Small synthesized sound effects (no audio files, no licensing questions).
 * Each returns its length in seconds, so the caller can make sure a chirp
 * never starts while an effect is still playing (R4.9). They're short and
 * quiet, and they're never ggwave-shaped, so they can't decode as a message.
 */
const VOLUME = 0.1;

function tone(ctx: AudioContext, freq: number, start: number, dur: number, type: OscillatorType, gain = VOLUME, slideTo?: number) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, start);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, start + dur);
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(gain, start + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  o.connect(g).connect(ctx.destination);
  o.start(start);
  o.stop(start + dur + 0.05);
}

export type Effect = 'arrive' | 'success' | 'fail' | 'creak' | 'fade' | 'static';

const EFFECTS: Record<Effect, (ctx: AudioContext) => number> = {
  arrive(ctx) {
    const t = ctx.currentTime;
    [523, 659, 784, 1047].forEach((f, i) => tone(ctx, f, t + i * 0.07, 0.4, 'sine', VOLUME * 0.7));
    return 0.65;
  },
  success(ctx) {
    const t = ctx.currentTime;
    tone(ctx, 392, t, 0.2, 'triangle');
    tone(ctx, 523, t + 0.12, 0.2, 'triangle');
    tone(ctx, 784, t + 0.24, 0.45, 'triangle');
    return 0.75;
  },
  fail(ctx) {
    tone(ctx, 220, ctx.currentTime, 0.5, 'sawtooth', VOLUME * 0.5, 110);
    return 0.55;
  },
  creak(ctx) {
    const t = ctx.currentTime;
    const len = Math.floor(ctx.sampleRate * 0.7);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 18;
    bp.frequency.setValueAtTime(300, t);
    bp.frequency.exponentialRampToValueAtTime(900, t + 0.6);
    const g = ctx.createGain();
    g.gain.value = VOLUME * 2.5;
    src.connect(bp).connect(g).connect(ctx.destination);
    src.start(t);
    return 0.75;
  },
  fade(ctx) {
    const t = ctx.currentTime;
    tone(ctx, 440, t, 1.0, 'sine', VOLUME, 110);
    tone(ctx, 466, t, 1.0, 'sine', VOLUME * 0.6, 116);
    return 1.05;
  },
  /** A short burst of crackly line static. */
  static(ctx) {
    const t = ctx.currentTime;
    const len = Math.floor(ctx.sampleRate * 0.4);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() < 0.12 ? (Math.random() * 2 - 1) * (1 - i / len) : 0;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    g.gain.value = VOLUME * 2;
    src.connect(g).connect(ctx.destination);
    src.start(t);
    return 0.45;
  },
};

export const EFFECT_SECONDS: Record<Effect, number> = { arrive: 0.65, success: 0.75, fail: 0.55, creak: 0.75, fade: 1.05, static: 0.45 };

/** Plays effects one after another. Returns the total length in seconds. */
export function playEffects(ctx: AudioContext, list: Effect[]): number {
  let at = 0;
  for (const e of list) {
    if (at === 0) EFFECTS[e](ctx);
    else setTimeout(() => EFFECTS[e](ctx), at * 1000);
    at += EFFECT_SECONDS[e];
  }
  return at;
}
