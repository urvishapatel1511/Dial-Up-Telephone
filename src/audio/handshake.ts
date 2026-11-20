/**
 * A synthesized dial-up "handshake" played before each chirp (decorative,
 * behind the effects switch). Pure: returns samples, so it can be tested in
 * Node against the real ggwave decoder.
 *
 * Dial tones (DTMF) → 2100 Hz answer tone → V.21-style 980/1180 Hz warble
 * with low-passed hiss → silence. Apart from the short answer tone, its
 * energy stays below ggwave's audible band (about 1.9-6.4 kHz).
 */
export const HANDSHAKE_GAP_S = 0.3;

/**
 * The full handshake only "dials" a connection: the start of a round. Entries,
 * reveal, results, requests, and every resend play the data chirp alone.
 */
export function wantsHandshake(type: string, opts: { effects: boolean; resend: boolean }): boolean {
  return opts.effects && !opts.resend && type === 'start';
}

const ROW = [697, 770, 852, 941];
const COL = [1209, 1336, 1477];

export function handshakeSamples(rate: number, seed = 1): Float32Array {
  const parts: Float32Array[] = [];
  let s = seed >>> 0 || 1;
  const rnd = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;

  const seg = (sec: number, f: (t: number) => number, amp = 0.22) => {
    const n = Math.round(sec * rate);
    const fade = Math.max(1, Math.min(Math.floor(n / 2), Math.round(0.006 * rate)));
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) out[i] = amp * Math.min(1, i / fade, (n - 1 - i) / fade) * f(i / rate);
    parts.push(out);
  };
  const silence = (sec: number) => parts.push(new Float32Array(Math.round(sec * rate)));

  for (let d = 0; d < 3; d++) {
    const fr = ROW[Math.floor(rnd() * ROW.length)];
    const fc = COL[Math.floor(rnd() * COL.length)];
    seg(0.07, (t) => (Math.sin(2 * Math.PI * fr * t) + Math.sin(2 * Math.PI * fc * t)) / 2);
    silence(0.04);
  }
  silence(0.08);
  seg(0.3, (t) => Math.sin(2 * Math.PI * 2100 * t), 0.18);
  let phase = 0;
  let lp = 0;
  seg(0.45, (t) => {
    const f = Math.floor(t * 90) % 2 ? 980 : 1180;
    phase += (2 * Math.PI * f) / rate;
    lp += 0.08 * (rnd() * 2 - 1 - lp);
    return 0.7 * Math.sin(phase) + 0.9 * lp;
  });
  silence(HANDSHAKE_GAP_S);

  const total = parts.reduce((a, p) => a + p.length, 0);
  const out = new Float32Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

export function concatSamples(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}
