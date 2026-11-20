/**
 * Visual and DOM checks in a real browser (Microsoft Edge via playwright-core).
 * Not part of `npm test`: run with `npm.cmd run screens` after `npm.cmd run build`.
 *
 * Game states come from the real pure game code and are injected into
 * sessionStorage before the page loads. No sound travels here; this checks
 * layout, visibility, secrecy of hidden entries, and keyboard behavior.
 */
import { mkdirSync } from 'node:fs';
import { chromium, type Browser, type Page } from 'playwright-core';
import { preview, type PreviewServer } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { STATIC_DRAWING_NOTE, STATIC_TEXT_NOTE } from '../src/game/captions';
import {
  initialState,
  nextRound,
  promptFor,
  receive,
  revealGame,
  seatOfStep,
  sendEntry,
  sendResults,
  setProfile,
  setWordDraft,
  startGame,
  STORAGE_KEY,
  type Outgoing,
  type Results,
  type State,
} from '../src/game/telephone';
import { emptyGrid } from '../src/protocol/drawing';
import { decodePacket, type NoiseLevel } from '../src/protocol/packet';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const OUT = 'docs/screenshots';
const PHONE = { width: 390, height: 844 };
const LAPTOP = { width: 1366, height: 820 };

/** 8-character rows scaled up to a 16×16 drawing. */
const art = (rows: string[]) => {
  const g = emptyGrid(16);
  rows.forEach((r, i) =>
    [...r].forEach((c, j) => {
      if (c === '#') g[2 * i][2 * j] = g[2 * i + 1][2 * j] = g[2 * i][2 * j + 1] = g[2 * i + 1][2 * j + 1] = true;
    }),
  );
  return g;
};
const PUMPKIN = art(['...##...', '..####..', '.######.', '##.##.##', '########', '#.#..#.#', '.######.', '..####..']);
const SUN = art(['#..#..#.', '.#.#.#..', '..###...', '#######.', '..###...', '.#.#.#..', '#..#..#.', '........']);
const NAMES = ['Asha', 'Bo', 'Cy', 'Dee'];

function makeRoom(n: number) {
  const d: State[] = NAMES.slice(0, n).map((name, i) => (i === 0 ? setProfile(initialState(), { name }) : setProfile(initialState(), { name, mode: 'player', seat: i + 1 })));
  const play = (from: number, out: Outgoing | null, deaf: number[] = []) => {
    if (!out) throw new Error(`device ${from + 1} could not send`);
    d[from] = out.state;
    const r = decodePacket(out.bytes);
    if (!r.ok) throw new Error(r.error);
    d.forEach((s, i) => i !== from && !deaf.includes(i) && (d[i] = receive(s, r.packet, 1000).state));
  };
  const turn = (k: number, content: { drawing?: boolean[][]; text?: string }, deaf: number[] = [], word = 'pumpkin') => {
    const i = seatOfStep(d[0].game!, k) - 1;
    play(i, sendEntry(k === 1 ? setWordDraft(d[i], { custom: word }) : d[i], content), deaf);
  };
  const start = (opts: { gameId: number; noise: NoiseLevel; mode?: 'quick' | 'match' }) => play(0, startGame(d[0], { players: n, now: 0, ...opts }));
  const results = (r: Partial<Results>) => play(0, sendResults(d[0], { funniest: 0, recognizable: 0, recovery: 0, final: 0, ...r }));
  return { d, play, turn, start, results };
}

function scenario() {
  const snaps: Record<string, State> = {};
  // A: a 4-player Quick Round on a Haunted line
  const a = makeRoom(4);
  a.start({ gameId: 77, noise: 2 });
  snaps.hostDraw = a.d[0];
  snaps.seat3Waiting = a.d[2];
  a.turn(1, { drawing: PUMPKIN });
  snaps.seat2Guess = a.d[1];
  a.turn(2, { text: 'orange' });
  snaps.seat2Sent = a.d[1];
  snaps.seat3Draw = a.d[2];
  a.turn(3, { drawing: SUN });
  a.turn(4, { text: 'sun' });
  a.play(0, revealGame(a.d[0], 95_000));
  snaps.revealHost = a.d[0];
  snaps.revealSeat4 = a.d[3];
  a.results({ funniest: 4, recognizable: 3, recovery: 2 });
  snaps.resultsSeat2 = a.d[1];

  // B: missed hops. Seat 3 misses hop 1, the host misses hop 2.
  const b = makeRoom(4);
  b.start({ gameId: 88, noise: 1 });
  b.turn(1, { drawing: PUMPKIN }, [2]);
  b.turn(2, { text: 'pumpkin' }, [0]);
  b.turn(3, { drawing: SUN });
  b.turn(4, { text: 'sun' });
  snaps.hostMissing = b.d[0];
  b.play(0, revealGame(b.d[0], 60_000, true));
  snaps.revealMissingSeat3 = b.d[2];

  // C: a 3-player Party Match (odd count: the room guesses the last drawing)
  const c = makeRoom(3);
  c.start({ gameId: 99, noise: 1, mode: 'match' });
  for (let round = 1; round <= 3; round++) {
    c.turn(1, { drawing: PUMPKIN }, [], round === 2 ? 'ghost taxi' : 'pumpkin');
    c.turn(2, { text: round === 2 ? 'goat taxi' : 'pumpkin' });
    c.turn(3, { drawing: SUN });
    if (round === 1) snaps.hostRoomGuess = c.d[0];
    c.play(0, revealGame(c.d[0], round * 100_000));
    c.results({ funniest: 2, final: round === 3 ? 2 : 1 });
    if (round < 3) c.play(0, nextRound(c.d[0], 99 + round, round * 100_000));
  }
  snaps.matchFinalSeat2 = c.d[1];
  return snaps;
}

let server: PreviewServer;
let browser: Browser;
const base = 'http://localhost:4179/';
const consoleErrors: string[] = [];

async function open(size: { width: number; height: number }, state?: State): Promise<Page> {
  const page = await browser.newPage({ viewport: size, deviceScaleFactor: 1 });
  page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
  page.on('pageerror', (e) => consoleErrors.push(String(e)));
  page.on('dialog', (d) => void d.accept());
  await page.emulateMedia({ reducedMotion: 'reduce' });
  if (state) await page.addInitScript(([key, json]) => sessionStorage.setItem(key, json), [STORAGE_KEY, JSON.stringify(state)] as const);
  await page.goto(base);
  await page.waitForSelector('#status');
  return page;
}
const shot = (page: Page, name: string) => page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
const pressedCells = (page: Page) => page.$$eval('#editor button[aria-pressed="true"]', (b) => b.length);

beforeAll(async () => {
  mkdirSync(OUT, { recursive: true });
  server = await preview({ preview: { port: 4179, strictPort: true }, logLevel: 'silent' });
  browser = await chromium.launch({ executablePath: EDGE, headless: true });
}, 60_000);

afterAll(async () => {
  await browser?.close();
  await new Promise<void>((r) => server?.httpServer.close(() => r()));
});

describe('Dial-Up Telephone v3 in a real browser', () => {
  const s = scenario();

  it('lobby: host/join need a name; game controls stay hidden', async () => {
    for (const [size, tag] of [
      [PHONE, 'phone'],
      [LAPTOP, 'laptop'],
    ] as const) {
      const page = await open(size);
      expect(await page.isVisible('#lobby')).toBe(true);
      expect(await page.isVisible('#statusbar')).toBe(false);
      expect(await page.isDisabled('#choose-host')).toBe(true);
      await page.fill('#name', 'Asha');
      expect(await page.isDisabled('#choose-host')).toBe(false);
      await shot(page, `01-lobby-${tag}`);
      await page.close();
    }
  });

  it('join: seat picker and ready', async () => {
    const page = await open(PHONE);
    await page.fill('#name', 'Bo');
    await page.click('#choose-join');
    await page.click('#seats button:has-text("3")');
    expect(await page.textContent('#ready')).toContain('seat 3');
    await shot(page, '02-join-phone');
    await page.close();
  });

  it('host setup: mode, players, fairness note, line quality, and category (no secret word)', async () => {
    const page = await open(LAPTOP);
    await page.fill('#name', 'Asha');
    await page.click('#choose-host');
    expect(await page.$('#host #word')).toBeNull(); // the host no longer picks the word
    await page.click('#modes button:nth-child(2)');
    expect(await page.getAttribute('#modes button:nth-child(2)', 'aria-checked')).toBe('true');
    await page.click('#players-plus');
    expect(await page.textContent('#players')).toBe('5');
    expect(await page.textContent('#fair-note')).toContain('whole room guesses it out loud');
    expect(await page.getAttribute('#noise button:nth-child(2)', 'aria-checked')).toBe('true'); // Crackly by default
    await page.click('#categories button:nth-child(5)');
    expect(await page.getAttribute('#categories button:nth-child(5)', 'aria-checked')).toBe('true');
    expect(await page.textContent('#start')).toBe('Start a 5-player Party Match');
    await shot(page, '03-host-setup-laptop');
    await page.close();
  });

  it('first drawer: private word with reroll and custom word; drawing tools with undo/redo', async () => {
    const page = await open(LAPTOP, s.hostDraw);
    expect(await page.isVisible('#word-box')).toBe(true);
    const first = await page.textContent('#word');
    await page.click('#reroll');
    expect(await page.textContent('#word')).not.toBe(first);
    await page.fill('#custom-word', 'haunted cat');
    expect(await page.textContent('#word')).toBe('haunted cat');
    expect(await page.isDisabled('#primary')).toBe(true); // nothing drawn yet

    // keyboard: one tab stop, arrows, Space; undo/redo as single actions
    expect(await page.$$eval('#editor button', (b) => b.filter((x) => x.tabIndex === 0).length)).toBe(1);
    await page.focus('#editor button');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Space');
    expect(await page.getAttribute('#editor button:nth-child(2)', 'aria-pressed')).toBe('true');
    expect(await page.isDisabled('#primary')).toBe(false);
    await page.click('#undo');
    expect(await pressedCells(page)).toBe(0);
    await page.click('#redo');
    expect(await pressedCells(page)).toBe(1);

    // large brush and eraser
    await page.click('#brush-large');
    expect(await page.getAttribute('#brush-large', 'aria-pressed')).toBe('true');
    await page.focus('#editor button:nth-child(2)');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Space');
    expect(await pressedCells(page)).toBe(10);
    await page.click('#tool-eraser');
    await page.click('#brush-small');
    expect(await page.getAttribute('#tool-eraser', 'aria-pressed')).toBe('true');
    await page.focus('#editor button:nth-child(2)');
    await page.keyboard.press('Space');
    expect(await pressedCells(page)).toBe(9);
    await page.keyboard.press('Control+z');
    expect(await pressedCells(page)).toBe(10);

    // mouse stroke = one undo step
    await page.click('#tool-pen');
    const box = (await page.$('#editor button:nth-child(200)'))!;
    await box.scrollIntoViewIfNeeded();
    const bb = (await box.boundingBox())!;
    await page.mouse.move(bb.x + 3, bb.y + 3);
    await page.mouse.down();
    await page.mouse.move(bb.x + 3 + bb.width * 4, bb.y + 3, { steps: 8 });
    await page.mouse.up();
    const afterStroke = await pressedCells(page);
    expect(afterStroke).toBeGreaterThan(12);
    await page.click('#undo');
    expect(await pressedCells(page)).toBe(10);
    await page.click('#redo');
    await page.evaluate(() => window.scrollTo(0, 0));
    await shot(page, '04-first-drawer-laptop');

    // clear asks first (accepted here), and can be undone
    await page.click('#clear');
    expect(await pressedCells(page)).toBe(0);
    await page.click('#undo');
    expect(await pressedCells(page)).toBe(afterStroke);
    await page.close();
  });

  it('bigger canvas on a phone', async () => {
    const page = await open(PHONE, s.hostDraw);
    const before = (await (await page.$('#editor'))!.boundingBox())!.width;
    await page.click('#bigger');
    expect(await page.getAttribute('#bigger', 'aria-pressed')).toBe('true');
    const after = (await (await page.$('#editor'))!.boundingBox())!.width;
    expect(after).toBeGreaterThan(before);
    expect(after).toBeLessThanOrEqual(PHONE.width);
    await shot(page, '05-bigger-canvas-phone');
    await page.close();
  });

  it('a guesser sees the static drawing note; a drawer sees the exact static clue note', async () => {
    const guess = await open(PHONE, s.seat2Guess);
    expect(await guess.isVisible('#prompt-drawing')).toBe(true);
    expect(await guess.textContent('#static-note')).toBe(STATIC_DRAWING_NOTE);
    expect(await guess.isVisible('#word-box')).toBe(false);
    await shot(guess, '06-seat2-guess-phone');
    await guess.close();

    const draw = await open(PHONE, s.seat3Draw);
    const seen = promptFor(s.seat3Draw.game!);
    expect(seen?.kind === 'text' && seen.altered).toBe(true);
    expect(await draw.textContent('#static-note')).toBe(STATIC_TEXT_NOTE);
    expect(await draw.textContent('#prompt-text')).toContain(seen!.kind === 'text' ? seen!.text : '?');
    expect(await draw.isVisible('#prompt-drawing')).toBe(false);
    await shot(draw, '07-seat3-draw-static-phone');
    await draw.close();
  });

  it('secrecy: before the reveal, no screen contains entries it should not', async () => {
    for (const key of ['seat3Waiting', 'seat2Guess', 'seat3Draw', 'seat2Sent'] as const) {
      const page = await open(PHONE, s[key]);
      const body = (await page.textContent('body')) ?? '';
      expect(body).not.toContain('pumpkin'); // the secret word
      if (key === 'seat3Draw') expect(body).not.toContain('orange'); // the original guess, before static
      await page.close();
    }
  });

  it('waiting and sent: ask by sound, play my turn again, and "played" vs "received"', async () => {
    const wait = await open(PHONE, s.seat3Waiting);
    expect(await wait.textContent('#listen')).toMatch(/Resume listening/);
    expect(await wait.textContent('#secondary')).toContain('Ask for it by sound');
    await shot(wait, '08-seat3-waiting-phone');
    await wait.close();
    const sent = await open(PHONE, s.seat2Sent);
    expect(await sent.textContent('#secondary')).toContain('Play my turn again');
    expect(await sent.textContent('#line')).toContain('♪ played');
    expect(await sent.textContent('#t-text')).toContain("It's confirmed when");
    await shot(sent, '09-seat2-sent-phone');
    await sent.close();
  });

  it('host with missing hops: no normal reveal, a targeted request, and a labelled fallback', async () => {
    const page = await open(LAPTOP, s.hostMissing);
    expect(await page.isVisible('#primary')).toBe(false);
    expect(await page.textContent('#tertiary')).toBe('Reveal with missing hops');
    expect(await page.isVisible('#task #recovery')).toBe(true);
    expect(await page.textContent('#rec-list')).toContain('Hop 2');
    expect(await page.$$eval('#rec-list button', (b) => b.length)).toBe(1);
    expect(await page.textContent('#line li:first-child')).toContain('✓ received'); // later hops prove hop 1 arrived
    await shot(page, '10-host-missing-laptop');
    await page.close();
  });

  it('odd player count: the host runs the room guess before the reveal', async () => {
    const page = await open(LAPTOP, s.hostRoomGuess);
    expect(await page.isVisible('#room-box')).toBe(true);
    expect(await page.isVisible('#room-answer')).toBe(false);
    await page.click('#room-show');
    expect(await page.isVisible('#room-answer')).toBe(true);
    await page.click('#room-yes');
    expect(await page.getAttribute('#room-yes', 'aria-pressed')).toBe('true');
    expect(await page.textContent('#primary')).toBe('Reveal the chain');
    await shot(page, '11-host-room-guess-laptop');
    await page.close();
  });

  it('reveal: sent vs arrived, captions, previous/next, and the awards form on the host only', async () => {
    for (const [key, size, tag] of [
      ['revealSeat4', PHONE, 'phone'],
      ['revealHost', LAPTOP, 'laptop'],
    ] as const) {
      const page = await open(size, s[key]);
      expect(await page.$$eval('#chain li', (l) => l.length)).toBe(5);
      expect(await page.$$eval('#chain .caption', (l) => l.length)).toBe(5);
      // hops 1 and 3 are drawings that pass on to someone: each shows Sent and Arrived
      expect(await page.$$eval('#chain .pair figcaption', (f) => f.map((x) => x.textContent))).toEqual(['Sent', 'Arrived', 'Sent', 'Arrived']);
      expect(await page.$$eval('.arrived .cell.hit', (c) => c.length)).toBe(48);
      expect(await page.isVisible('#scores-box')).toBe(true);
      expect(await page.isVisible('#results-form')).toBe(key === 'revealHost');
      await page.click('#reveal-prev');
      expect(await page.$$eval('#chain li', (l) => l.length)).toBe(4);
      await page.click('#reveal-next');
      expect(await page.$$eval('#chain li', (l) => l.length)).toBe(5);
      await shot(page, `12-reveal-${tag}`);
      await page.close();
    }
  });

  it('after the results chirp, every device shows the awards and the points', async () => {
    const page = await open(PHONE, s.resultsSeat2);
    expect(await page.textContent('#awards-text')).toContain('Funniest Transformation: Dee (hop 4)');
    expect(await page.$$eval('#chain li.awarded', (l) => l.length)).toBe(3);
    expect(await page.textContent('#scores')).toContain('Most Recognizable Drawing');
    await shot(page, '13-results-phone');
    await page.close();
  });

  it('a hop missed before the reveal can be asked for from the reveal', async () => {
    const page = await open(PHONE, s.revealMissingSeat3);
    expect(await page.isVisible('#reveal #recovery')).toBe(true);
    expect(await page.textContent('#rec-list')).toContain('Hop 1');
    expect(await page.$$eval('#chain .missing', (l) => l.length)).toBe(1);
    await shot(page, '14-reveal-missing-phone');
    await page.close();
  });

  it('Party Match: totals and the final celebration after round 3', async () => {
    const page = await open(PHONE, s.matchFinalSeat2);
    expect(await page.textContent('#round-tag')).toContain('round 3 of 3');
    expect(await page.isVisible('#final-box')).toBe(true);
    expect(await page.textContent('#final-text')).toMatch(/wins the Party Match|tie/);
    expect(await page.textContent('#match-title')).toBe('Final Party Match totals');
    expect(await page.$$eval('#standings li', (l) => l.length)).toBe(3);
    await shot(page, '15-match-final-phone');
    await page.close();
  });

  it('no console errors on any screen', () => {
    expect(consoleErrors).toEqual([]);
  });
});
