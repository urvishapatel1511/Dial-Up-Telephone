import { createRequire } from 'node:module';
import { beforeAll, describe, expect, it } from 'vitest';
import { concatSamples, handshakeSamples, wantsHandshake } from '../src/audio/handshake';
import { ACK_SLOT_MS, HELLO_SLOT_MS } from '../src/game/schedule';
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

  it('the largest packet (58 bytes: first drawing + secret word) survives encode -> waveform -> decode', () => {
    const bytes = encodePacket({ type: 'entry', gameId: 0xff80, step: 1, name: 'ABCDEFG', drawing: drawing(), word: 'ABCDEFGHIJKL' });
    expect(bytes.length).toBe(58);
    const samples = tx.encode(bytes);
    console.log(`58-byte first-drawing chirp: ${tx.durationMs(samples)} ms (synthetic; measure on hardware too)`);
    const decoded = receiveOverWire(rx, samples);
    expect(decoded && Array.from(decoded)).toEqual(Array.from(bytes));
    const res = decodePacket(decoded!);
    expect(res.ok && res.packet.type === 'entry' && 'drawing' in res.packet && res.packet.drawing).toEqual(drawing());
  });

  it('a later 16×16 drawing packet (46 bytes) and the control packets decode', () => {
    for (const p of [
      encodePacket({ type: 'entry', gameId: 0xff80, step: 7, name: 'ABCDEFG', drawing: drawing() }),
      encodePacket({ type: 'need', gameId: 9, step: 3 }),
      encodePacket({ type: 'results', gameId: 9, funniest: 2, recognizable: 3, recovery: 4, final: 1 }),
      encodePacket({ type: 'reveal', gameId: 9, players: 5 }),
    ]) {
      const samples = tx.encode(p);
      console.log(`${p.length}-byte chirp: ${tx.durationMs(samples)} ms (synthetic)`);
      const decoded = receiveOverWire(rx, samples);
      expect(decoded && Array.from(decoded)).toEqual(Array.from(p));
    }
  });

  it('the longest ready message and results confirmation fit inside their reply slots, with margin', () => {
    const hello = encodePacket({ type: 'hello', gameId: 0xffff, seat: 8, name: 'ABCDEFG' });
    const ack = encodePacket({ type: 'ack', gameId: 0xffff, seat: 8 });
    const call = encodePacket({ type: 'call', gameId: 0xffff, players: 8, name: 'ABCDEFG', confirmed: 0xff, duplicate: 0xff });
    const helloMs = tx.durationMs(tx.encode(hello));
    const ackMs = tx.durationMs(tx.encode(ack));
    console.log(`hello ${hello.length} B: ${helloMs} ms · ack ${ack.length} B: ${ackMs} ms · call ${call.length} B (synthetic)`);
    // at least 300 ms of silence between neighbouring replies
    expect(helloMs + 300).toBeLessThanOrEqual(HELLO_SLOT_MS);
    expect(ackMs + 300).toBeLessThanOrEqual(ACK_SLOT_MS);
    for (const p of [hello, ack, call]) expect(Array.from(receiveOverWire(rx, tx.encode(p)) ?? [])).toEqual(Array.from(p));
  });

  it('the handshake plays only before a fresh start signal, never on entries or resends (R4.1)', () => {
    for (const type of ['entry', 'reveal', 'results', 'need']) {
      expect(wantsHandshake(type, { effects: true, resend: false })).toBe(false);
    }
    expect(wantsHandshake('start', { effects: true, resend: false })).toBe(true);
    expect(wantsHandshake('start', { effects: true, resend: true })).toBe(false);
    expect(wantsHandshake('start', { effects: false, resend: false })).toBe(false);
  });

  it('reports chirp duration for the largest guess packet (26 bytes)', () => {
    const bytes = encodePacket({ type: 'entry', gameId: 1, step: 8, name: 'ABCDEFG', text: 'ABCDEFGHIJKL' });
    const samples = tx.encode(bytes);
    console.log(`26-byte guess chirp: ${tx.durationMs(samples)} ms (synthetic)`);
    expect(receiveOverWire(rx, samples)).not.toBeNull();
  });

  it('the dial-up handshake played before a start chirp does not stop it from decoding', () => {
    for (const p of [
      encodePacket({ type: 'start', gameId: 77, players: 5, name: 'Asha', noise: 2, mode: 'match', matchId: 77, round: 2, category: 4 }),
      encodePacket({ type: 'entry', gameId: 77, step: 3, name: 'Cy', drawing: drawing() }),
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
