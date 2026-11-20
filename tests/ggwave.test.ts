import { createRequire } from 'node:module';
import { beforeAll, describe, expect, it } from 'vitest';
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

// SYNTHETIC ONLY: samples go straight from the encoder to the decoder. This is not a
// speaker-to-microphone test. Real air-path results belong in docs/hardware-log.md.
describe('ggwave pipeline in Node (synthetic waveform, no air path)', () => {
  let tx: Modem;
  let rx: Modem;

  beforeAll(async () => {
    tx = await Modem.create(factory, SAMPLE_RATE);
    rx = await Modem.create(factory, SAMPLE_RATE);
  });

  it('a drawing packet survives encode -> waveform -> decode byte-for-byte', () => {
    const drawing = emptyGrid();
    drawing[0][0] = drawing[3][4] = drawing[7][7] = true;
    const bytes = encodePacket({ type: 'entry', gameId: 0xff80, step: 7, name: 'Asha', drawing }); // bytes >= 0x80
    const decoded = receiveOverWire(rx, tx.encode(bytes));
    expect(decoded && Array.from(decoded)).toEqual(Array.from(bytes));
    const res = decodePacket(decoded!);
    expect(res.ok && res.packet.type === 'entry' && 'drawing' in res.packet && res.packet.drawing).toEqual(drawing);
  });

  it('reports chirp duration for the largest (26-byte) packet', () => {
    const bytes = encodePacket({ type: 'entry', gameId: 1, step: 8, name: 'ABCDEFG', text: 'ABCDEFGHIJKL' });
    expect(bytes.length).toBe(26);
    const samples = tx.encode(bytes);
    console.log(`26-byte AUDIBLE_FAST chirp: ${tx.durationMs(samples)} ms (synthetic; measure on hardware too)`);
    expect(receiveOverWire(rx, samples)).not.toBeNull();
  });
});
