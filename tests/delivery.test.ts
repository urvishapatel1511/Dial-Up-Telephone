import { describe, expect, it } from 'vitest';
import { AUTO_RETRIES, check, delivered, manualRetry, newDelivery, played, playFailed, postpone, waitMs, type Delivery } from '../src/game/delivery';
import { ACK_SLOT_MS, ackDelay, ackWindowMs, NEED_WINDOW_MS, RECEIPT_DELAY_MS, RECEIPT_WINDOW_MS, replyWindowMs } from '../src/game/schedule';
import {
  ackPacket,
  askFor,
  autoAnswer,
  awaitingAcks,
  awaitingJoin,
  hopDelivered,
  initialState,
  joinedSeats,
  myStep,
  outgoingFor,
  phaseOf,
  receiptPacket,
  receiverSeat,
  receive,
  resendEntry,
  resendResults,
  resendStart,
  revealGame,
  scores,
  seatOfStep,
  sendEntry,
  sendResults,
  setProfile,
  setWordDraft,
  startAckPacket,
  startGame,
  type Outgoing,
  type State,
} from '../src/game/telephone';
import { emptyGrid } from '../src/protocol/drawing';
import { decodePacket, NEED_START, type Packet } from '../src/protocol/packet';

const hear = (b: Uint8Array): Packet => {
  const r = decodePacket(b);
  if (!r.ok) throw new Error(r.error);
  return r.packet;
};
const dot = () => {
  const g = emptyGrid(16);
  g[3][3] = true;
  return g;
};
const NAMES = ['Asha', 'Bo', 'Cy', 'Dee', 'Eli'];

/** N devices in a room. Every chirp reaches everyone except the sender and the deaf. */
function room(n: number) {
  const d: State[] = NAMES.slice(0, n).map((name, i) =>
    i === 0 ? setProfile(initialState(0x200), { name }) : setProfile(initialState(0x200 + i), { name, mode: 'player', seat: i + 1 }),
  );
  const events: string[][] = d.map(() => []);
  const play = (from: number, out: Outgoing | null, deaf: number[] = []) => {
    if (!out) throw new Error(`device ${from + 1} could not send`);
    d[from] = out.state;
    d.forEach((s, i) => {
      if (i === from || deaf.includes(i)) return;
      const res = receive(s, hear(out.bytes), 1);
      d[i] = res.state;
      events[i].push(res.event.type);
    });
    return out;
  };
  const start = (deaf: number[] = []) => play(0, startGame(d[0], { players: n, gameId: 0x5150, now: 0 }), deaf);
  const author = (k: number) => seatOfStep(d[0].game!, k) - 1;
  const turn = (k: number, deaf: number[] = []) => {
    const i = author(k);
    const base = k === 1 ? setWordDraft(d[i], { custom: 'cat' }) : d[i];
    return play(i, sendEntry(base, k % 2 ? { drawing: dot() } : { text: 'cat' }), deaf);
  };
  /** The next player's "got it" for hop k, if it holds it. */
  const receipt = (k: number, deaf: number[] = []) => {
    const i = seatOfStep(d[0].game!, k + 1 <= n ? k + 1 : 1) - 1;
    const r = k < n ? i : 0;
    return play(r, receiptPacket(d[r], k), deaf);
  };
  return { d, play, start, turn, receipt, author, events };
}

describe('playing is not the same as arriving (R4.4)', () => {
  it('after playback a hop is only "waiting"; it is "confirmed" only by the next player’s "got it"', () => {
    const r = room(3);
    r.start();
    r.turn(1);
    let d = played(newDelivery('entry', 0x5150, 1), 0, 3);
    expect(d.status).toBe('waiting');
    expect(hopDelivered(r.d[0].game!, 1)).toBe(false);
    expect(check(d, r.d[0], 1000)!.delivery.status).toBe('waiting');
    r.receipt(1); // Bo says "got it"
    expect(hopDelivered(r.d[0].game!, 1)).toBe(true);
    d = check(d, r.d[0], 1000)!.delivery;
    expect(d.status).toBe('confirmed');
  });

  it('a later hop also confirms (when the "got it" itself was lost)', () => {
    const r = room(3);
    r.start();
    r.turn(1);
    r.receipt(1, [0]); // the host missed Bo's "got it"
    expect(hopDelivered(r.d[0].game!, 1)).toBe(false);
    r.turn(2);
    expect(hopDelivered(r.d[0].game!, 1)).toBe(true);
  });

  it('the last hop is confirmed by the host; a host-authored last hop needs no confirmation', () => {
    const r = room(2);
    r.start();
    r.turn(1);
    r.turn(2); // Bo plays the last hop; the host receives it
    expect(hopDelivered(r.d[1].game!, 2)).toBe(false);
    r.receipt(2);
    expect(hopDelivered(r.d[1].game!, 2)).toBe(true);
    // In round 2 of a 3-player match (offset 1) the host plays hop 3: nobody needs to confirm it.
    const m = room(3);
    m.start();
    const g = { ...m.d[0].game!, offset: 1 };
    expect(seatOfStep(g, 3)).toBe(1);
    expect(receiverSeat(g, 3)).toBeNull();
    expect(receiverSeat(g, 2)).toBe(1);
  });
});

describe('lost messages: bounded automatic retries, then a manual one', () => {
  it('a hop nobody confirms is played again automatically at most twice, then waits for a tap', () => {
    const r = room(3);
    r.start();
    const first = r.turn(1, [1]); // Bo's phone missed it
    let d = played(newDelivery('entry', 0x5150, 1), 0, 3);
    let now = 0;
    const plays: number[][] = [Array.from(first.bytes)];
    for (;;) {
      now = d.deadline!;
      const c = check(d, r.d[0], now)!;
      d = c.delivery;
      if (!c.retry) break;
      // the retry is the same chirp, byte for byte; Bo still misses it
      const again = r.play(0, resendEntry(r.d[0], 1), [1]);
      plays.push(Array.from(again.bytes));
      d = played(d, now, 3);
    }
    expect(plays.length).toBe(1 + AUTO_RETRIES.entry);
    expect(new Set(plays.map((p) => p.join())).size).toBe(1);
    expect(d.status).toBe('unconfirmed');
    // no endless loop: checking again later never retries by itself
    expect(check(d, r.d[0], now + 60_000)).toEqual({ delivery: d, retry: false });
    // a tap plays exactly once more; this time Bo hears it and says "got it"
    d = manualRetry(d);
    r.play(0, resendEntry(r.d[0], 1));
    d = played(d, now, 3);
    expect(phaseOf(r.d[1])).toBe('my-turn');
    r.receipt(1);
    expect(check(d, r.d[0], now + 1)!.delivery.status).toBe('confirmed');
  });

  it('a manual retry that is still not confirmed never turns into automatic ones', () => {
    const r = room(3);
    r.start();
    r.turn(1, [1]);
    const d = played(manualRetry(played(newDelivery('entry', 0x5150, 1), 0, 3)), 0, 3);
    expect(d.attempts).toBe(d.maxAttempts);
    expect(check(d, r.d[0], d.deadline!)).toEqual({ delivery: { ...d, status: 'unconfirmed', deadline: null }, retry: false });
  });

  it('a playback failure is reported as not sent (never as waiting or confirmed)', () => {
    const d = playFailed(newDelivery('entry', 1, 1));
    expect(d).toMatchObject({ status: 'unconfirmed', failed: true, attempts: 0 });
  });

  it('a busy phone postpones a retry without using up an attempt', () => {
    const d = played(newDelivery('entry', 1, 1), 0, 3);
    const p = postpone({ ...d, status: 'playing' }, 5000, 1500);
    expect(p).toMatchObject({ status: 'waiting', deadline: 6500, attempts: 1 });
  });

  it('requests are never repeated automatically, and are confirmed when the answer arrives', () => {
    expect(AUTO_RETRIES.need).toBe(0);
    const r = room(4);
    r.start();
    r.turn(1);
    r.turn(2, [2]); // Cy missed Bo's guess
    expect(receiptPacket(r.d[2], 2)).toBeNull(); // Cy can't say "got it" for a hop it doesn't hold
    r.play(2, askFor(r.d[2], 2));
    let d = played(newDelivery('need', 0x5150, 2), 0, 4);
    expect(check(d, r.d[2], d.deadline! + 1)!).toEqual({ delivery: { ...d, status: 'unconfirmed', deadline: null }, retry: false });
    // only Bo (the author) answers automatically
    expect(r.d.map((s) => autoAnswer(s, 2).length)).toEqual([0, 1, 0, 0]);
    r.play(1, outgoingFor(r.d[1], autoAnswer(r.d[1], 2)[0]));
    d = check(d, r.d[2], 0)!.delivery;
    expect(d.status).toBe('confirmed');
  });

  it('retries wait until every expected reply had time to arrive, so they never overlap one', () => {
    expect(waitMs('entry', 3)).toBeGreaterThan(RECEIPT_WINDOW_MS);
    for (let n = 2; n <= 8; n++) {
      expect(waitMs('start', n)).toBeGreaterThan(ackWindowMs(n));
      expect(waitMs('results', n)).toBeGreaterThan(ackWindowMs(n));
      // the last seat's confirmation slot ends inside the window
      expect(ackDelay(n)! + ACK_SLOT_MS).toBeLessThanOrEqual(ackWindowMs(n));
    }
    expect(waitMs('need', 3)).toBeGreaterThan(NEED_WINDOW_MS);
    // a "got it" goes out after the gap and ends inside its window
    expect(RECEIPT_DELAY_MS + ACK_SLOT_MS).toBeLessThanOrEqual(RECEIPT_WINDOW_MS);
  });

  it('after any chirp, other phones keep the line free for exactly the replies it triggers', () => {
    expect(replyWindowMs({ type: 'entry', gameId: 1, step: 2, name: 'Bo', text: 'cat' }, 4)).toBe(RECEIPT_WINDOW_MS);
    expect(replyWindowMs({ type: 'start', gameId: 1, players: 5, name: 'A', noise: 0, mode: 'quick', matchId: 1, round: 1, category: 0 }, null)).toBe(ackWindowMs(5));
    expect(replyWindowMs({ type: 'results', gameId: 1, funniest: 0, recognizable: 0, recovery: 0, final: 0 }, 3)).toBe(ackWindowMs(3));
    expect(replyWindowMs({ type: 'need', gameId: 1, step: 2 }, 3)).toBe(NEED_WINDOW_MS);
    expect(replyWindowMs({ type: 'ack', gameId: 1, seat: 2, step: 1 }, 3)).toBe(0);
    expect(replyWindowMs({ type: 'reveal', gameId: 1, players: 3 }, 3)).toBe(0);
  });
});

describe('duplicate delivery never repeats a turn', () => {
  it('a retried hop is a duplicate for everyone who has it: no state change, no second turn, and the next player says "got it" again', () => {
    const r = room(4);
    r.start();
    const e1 = r.turn(1);
    r.receipt(1, [0]); // the host missed Bo's "got it", so it retries
    const before = r.d.map((s) => s);
    const again = r.play(0, resendEntry(r.d[0], 1));
    expect(Array.from(again.bytes)).toEqual(Array.from(e1.bytes));
    expect(r.events.slice(1).map((e) => e[e.length - 1])).toEqual(['duplicate', 'duplicate', 'duplicate']);
    expect(r.d.slice(1)).toEqual(before.slice(1)); // nothing changed on any other phone
    expect(phaseOf(r.d[1])).toBe('my-turn'); // Bo's turn didn't advance or restart
    expect(receiptPacket(r.d[1], 1)).not.toBeNull(); // Bo answers the copy with "got it"
    expect(receiptPacket(r.d[2], 1)).toBeNull(); // only the next player does
    r.receipt(1);
    expect(hopDelivered(r.d[0].game!, 1)).toBe(true);
  });

  it('a hop retried after the next player already played changes nothing anywhere', () => {
    const r = room(3);
    r.start();
    r.turn(1);
    r.turn(2);
    const snapshot = JSON.stringify(r.d.slice(1));
    r.play(0, resendEntry(r.d[0], 1));
    expect(JSON.stringify(r.d.slice(1))).toBe(snapshot);
    expect(myStep(r.d[1].game!)).toBe(2);
    expect(phaseOf(r.d[1])).toBe('sent');
  });

  it('"got it" is accepted only from the next player, and hearing it twice changes nothing', () => {
    const r = room(4);
    r.start();
    r.turn(1);
    const fake = receive(r.d[0], { type: 'ack', gameId: 0x5150, seat: 3, step: 1 }, 1); // Cy is not hop 1's receiver
    expect(fake.state).toBe(r.d[0]);
    const got = r.receipt(1);
    const twice = receive(r.d[0], hear(got.bytes), 2);
    expect(twice.state).toBe(r.d[0]);
    expect(r.d[0].game!.receipts).toEqual([1]);
    const otherRound = receive(r.d[0], { type: 'ack', gameId: 0x9999, seat: 2, step: 1 }, 1);
    expect(otherRound.state).toBe(r.d[0]);
  });

  it('a repeated start never resets the round; players who already played don’t confirm again', () => {
    const r = room(3);
    const start = r.start();
    r.turn(1);
    r.turn(2);
    const bo = receive(r.d[1], hear(start.bytes), 5);
    expect(bo.state).toBe(r.d[1]);
    expect(bo.event).toEqual({ type: 'start-again', ackIn: null }); // Bo already played hop 2
    const cy = receive(r.d[2], hear(resendStart(r.d[0])!.bytes), 5);
    expect(cy.state).toBe(r.d[2]);
    expect(cy.event).toEqual({ type: 'start-again', ackIn: ackDelay(3) }); // Cy hasn't played yet
    expect(r.d[2].game!.entries['1']).toBeDefined();
  });
});

describe('start confirmations', () => {
  it('each player confirms in its slot; the host knows who joined, and retries once for a missed start', () => {
    const r = room(4);
    r.start([2]); // Cy missed the start
    expect(r.events[1]).toEqual(['joined']);
    expect(awaitingJoin(r.d[0].game!)).toEqual([2, 3, 4]);
    r.play(1, startAckPacket(r.d[1]));
    r.play(3, startAckPacket(r.d[3]));
    expect(startAckPacket(r.d[2])).toBeNull(); // Cy isn't in the round
    expect(joinedSeats(r.d[0].game!)).toEqual([2, 4]);
    let d = played(newDelivery('start', 0x5150, 0), 0, 4);
    const c = check(d, r.d[0], d.deadline!)!;
    expect(c.retry).toBe(true);
    r.play(0, resendStart(r.d[0]));
    expect(r.d[2].game?.gameId).toBe(0x5150); // Cy joins from the retry
    r.play(2, startAckPacket(r.d[2]));
    d = played(c.delivery, d.deadline!, 4);
    expect(check(d, r.d[0], d.deadline! - 1)!.delivery.status).toBe('confirmed');
  });

  it('a played hop or a "got it" also counts as having joined', () => {
    const r = room(3);
    r.start();
    r.turn(1);
    r.receipt(1); // Bo's "got it": Bo is in
    expect(joinedSeats(r.d[0].game!)).toEqual([2]);
    r.turn(2);
    r.turn(3);
    expect(joinedSeats(r.d[0].game!)).toEqual([2, 3]);
  });
});

describe('repeated results', () => {
  function revealed(n: number) {
    const r = room(n);
    r.start();
    for (let k = 1; k <= n; k++) r.turn(k);
    r.play(0, revealGame(r.d[0], 5));
    return r;
  }

  it('repeated results never re-score; confirmations are idempotent; a lost confirmation triggers one automatic resend', () => {
    const r = revealed(3);
    const res = r.play(0, sendResults(r.d[0], { funniest: 2, recognizable: 3, recovery: 0, final: 1 }));
    const pts = r.d.map((s) => JSON.stringify(scores(s.game!)));
    expect(new Set(pts).size).toBe(1);
    r.play(1, ackPacket(r.d[1]));
    r.play(2, ackPacket(r.d[2]), [0]); // the host missed Cy's confirmation
    let d = played(newDelivery('results', 0x5150, 0), 0, 3);
    expect(delivered(r.d[0], d)).toBe(false);
    const c = check(d, r.d[0], d.deadline!)!;
    expect(c.retry).toBe(true);
    const again = r.play(0, resendResults(r.d[0]));
    expect(Array.from(again.bytes)).toEqual(Array.from(res.bytes));
    expect(r.d.map((s) => JSON.stringify(scores(s.game!)))).toEqual(pts); // nothing scored twice
    // both players confirm again (the host can't know which confirmation was lost)
    r.play(1, ackPacket(r.d[1]));
    r.play(2, ackPacket(r.d[2]));
    expect(r.d[0].game!.acks).toEqual([2, 3]);
    expect(awaitingAcks(r.d[0].game!)).toEqual([]);
    d = played(c.delivery, d.deadline!, 3);
    expect(check(d, r.d[0], 0)!.delivery.status).toBe('confirmed');
    // results can't be sent a second time with different awards
    expect(sendResults(r.d[0], { funniest: 2, recognizable: 0, recovery: 0, final: 2 })).toBeNull();
  });

  it('results heard many times score exactly once, on every phone', () => {
    const r = revealed(4);
    const res = r.play(0, sendResults(r.d[0], { funniest: 4, recognizable: 3, recovery: 0, final: 0 }));
    const once = r.d.map((s) => JSON.stringify(scores(s.game!)));
    for (let i = 0; i < 3; i++) r.play(0, { ...res, state: r.d[0] });
    expect(r.d.map((s) => JSON.stringify(scores(s.game!)))).toEqual(once);
    expect(r.events[1].filter((e) => e === 'results')).toHaveLength(4);
  });
});

describe('delivery bookkeeping', () => {
  it('a delivery for an old round is dropped; a request to join is kept until the round is joined', () => {
    const r = room(3);
    r.start();
    const old: Delivery = played(newDelivery('entry', 0x1111, 1), 0, 3);
    expect(check(old, r.d[0], 0)).toBeNull();
    const join = played(newDelivery('need', 0x5150, NEED_START), 0, 3);
    const outside = setProfile(initialState(9), { name: 'Late', mode: 'player', seat: 3 });
    expect(check(join, outside, 0)!.delivery.status).toBe('waiting');
    expect(check(join, r.d[2], 0)!.delivery.status).toBe('confirmed');
  });
});
