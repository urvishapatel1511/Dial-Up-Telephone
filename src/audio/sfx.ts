/**
 * Small synthesized sound effects (no audio files, no licensing questions).
 * They're short and quiet, and they play only right after an event, never
 * while this device is sending.
 */
const VOLUME = 0.12;

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

export function arrive(ctx: AudioContext) {
  const t = ctx.currentTime;
  [523, 659, 784, 1047].forEach((f, i) => tone(ctx, f, t + i * 0.07, 0.5, 'sine', VOLUME * 0.7));
}

export function success(ctx: AudioContext) {
  const t = ctx.currentTime;
  tone(ctx, 392, t, 0.25, 'triangle');
  tone(ctx, 523, t + 0.15, 0.25, 'triangle');
  tone(ctx, 784, t + 0.3, 0.6, 'triangle');
}

export function fail(ctx: AudioContext) {
  const t = ctx.currentTime;
  tone(ctx, 220, t, 0.6, 'sawtooth', VOLUME * 0.6, 110);
}

export function creak(ctx: AudioContext) {
  const t = ctx.currentTime;
  const len = Math.floor(ctx.sampleRate * 0.9);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = 18;
  bp.frequency.setValueAtTime(300, t);
  bp.frequency.exponentialRampToValueAtTime(900, t + 0.8);
  const g = ctx.createGain();
  g.gain.value = VOLUME * 2.5;
  src.connect(bp).connect(g).connect(ctx.destination);
  src.start(t);
}

export function fade(ctx: AudioContext) {
  const t = ctx.currentTime;
  tone(ctx, 440, t, 1.6, 'sine', VOLUME, 110);
  tone(ctx, 466, t, 1.6, 'sine', VOLUME * 0.6, 116);
}
