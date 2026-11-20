import { createRequire } from 'node:module';
import { beforeAll, describe, expect, it } from 'vitest';
import { concatSamples, handshakeSamples } from '../src/audio/handshake';
import { Modem } from '../src/audio/modem';
import type { GgwaveFactory } from '../src/audio/ggwave-types';
import { emptyGrid } from '../src/protocol/drawing';
import { decodePacket, encodePacket } from '../src/protocol/packet';

const require = createRequire(import.meta.url);
const factory = require('ggwave') as GgwaveFactory;

const SAMPLE_RATE = 48000;
const BLOCK = 1024; // same block size as the browser listener

/** Feed samples to a separate receiver modem in mic-sized blocks, followed by silence. */
function receiveOverWire(rx: Modem, samples: Float32Array): Uint8Array | null {
  const padded = new Float32Array(samples.length + SAMPLE_RATE);
  padded.set(samples);
  for (let i = 0; i + BLOCK <= padded.length; i += BLOCK) {
    const out = rx.decode(padded.subarray(i, i + BLOCK));
    if (out) return out;
  }
  return null;
}

const drawing = () => {
  const d = emptyGrid(16);
  d[0][0] = d[7][9] = d[15][15] = d[3][12] = true;
  return d;
};

// SYNTHETIC ONLY: samples go straight from the encoder to the decoder. This is not a
// speaker-to-microphone test. Real air-path results belong in docs/hardware-log.md.
describe('ggwave pipeline in Node (synthetic waveform, no air path)', () => {
  let tx: Modem;
  let rx: Modem;

  beforeAll(async () => {
    tx = await Modem.create(factory, SAMPLE_RATE);
    rx = await Modem.create(factory, SAMPLE_RATE);
  });

  it('a 16×16 drawing packet (46 bytes) survives encode -> waveform -> decode byte-for-byte', () => {
    const bytes = encodePacket({ type: 'entry', gameId: 0xff80, step: 7, name: 'ABCDEFG', drawing: drawing() });
    expect(bytes.length).toBe(46);
    const samples = tx.encode(bytes);
    console.log(`46-byte drawing chirp: ${tx.durationMs(samples)} ms (synthetic; measure on hardware too)`);
    const decoded = receiveOverWire(rx, samples);
    expect(decoded && Array.from(decoded)).toEqual(Array.from(bytes));
    const res = decodePacket(decoded!);
    expect(res.ok && res.packet.type === 'entry' && 'drawing' in res.packet && res.packet.drawing).toEqual(drawing());
  });

  it('reports chirp duration for the largest guess packet (26 bytes)', () => {
    const bytes = encodePacket({ type: 'entry', gameId: 1, step: 8, name: 'ABCDEFG', text: 'ABCDEFGHIJKL' });
    const samples = tx.encode(bytes);
    console.log(`26-byte guess chirp: ${tx.durationMs(samples)} ms (synthetic)`);
    expect(receiveOverWire(rx, samples)).not.toBeNull();
  });

  it('the dial-up handshake played before a chirp does not stop it from decoding (R5.2)', () => {
    for (const p of [
      encodePacket({ type: 'entry', gameId: 77, step: 3, name: 'Cy', drawing: drawing() }),
      encodePacket({ type: 'start', gameId: 77, players: 5, name: 'Asha', noise: 2 }),
      encodePacket({ type: 'award', gameId: 77, step: 4 }),
    ]) {
      const lead = handshakeSamples(SAMPLE_RATE, p[p.length - 1]);
      const decoded = receiveOverWire(rx, concatSamples(lead, tx.encode(p)));
      expect(decoded && Array.from(decoded)).toEqual(Array.from(p));
    }
  });

  it('the handshake alone never decodes as a message, is about 1.5 s, and is not too loud', () => {
    for (const seed of [1, 7, 200]) {
      const lead = handshakeSamples(SAMPLE_RATE, seed);
      expect(receiveOverWire(rx, lead)).toBeNull();
      expect(lead.length / SAMPLE_RATE).toBeGreaterThan(1.2);
      expect(lead.length / SAMPLE_RATE).toBeLessThan(1.8);
      let peak = 0;
      for (const v of lead) peak = Math.max(peak, Math.abs(v));
      expect(peak).toBeLessThan(0.4);
    }
    expect(Array.from(handshakeSamples(SAMPLE_RATE, 5))).toEqual(Array.from(handshakeSamples(SAMPLE_RATE, 5)));
  });
});
