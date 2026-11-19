import { createRequire } from 'node:module';
import { beforeAll, describe, expect, it } from 'vitest';
import { Modem } from '../src/audio/modem';
import type { GgwaveFactory } from '../src/audio/ggwave-types';
import { emptyGrid } from '../src/protocol/drawing';
import { decodeMessage, encodeMessage } from '../src/protocol/message';

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

  it('binary ghost message survives encode -> waveform -> decode byte-for-byte', () => {
    const grid = emptyGrid();
    grid[0][0] = grid[3][4] = grid[7][7] = true;
    const bytes = encodeMessage({
      direction: 'release',
      stage: 5,
      item: 'coffin', // flags byte = 0xba: bytes >= 0x80 must not be UTF-8 re-encoded
      energy: 3,
      ok: true,
      hat: true,
      partner: 15,
      ghostId: 0xff80,
      transferId: 0xfe,
      grid,
      name: 'Casper~!',
    });
    const samples = tx.encode(bytes);
    const decoded = receiveOverWire(rx, samples);
    expect(decoded && Array.from(decoded)).toEqual(Array.from(bytes));
    const res = decodeMessage(decoded!);
    expect(res.ok && res.message.grid).toEqual(grid);
  });

  it('reports chirp duration for the largest (26-byte) message', () => {
    const bytes = encodeMessage({
      direction: 'return',
      stage: 2,
      item: 'star',
      energy: 2,
      ok: false,
      hat: false,
      partner: 7,
      ghostId: 1,
      transferId: 2,
      grid: emptyGrid(),
      name: 'ABCDEFGHIJ',
    });
    const samples = tx.encode(bytes);
    const ms = tx.durationMs(samples);
    console.log(`26-byte AUDIBLE_FAST chirp: ${ms} ms (synthetic; measure on hardware too)`);
    expect(ms).toBeGreaterThan(0);
    expect(receiveOverWire(rx, samples)).not.toBeNull();
  });
});
