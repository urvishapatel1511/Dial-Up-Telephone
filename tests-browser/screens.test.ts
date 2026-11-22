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
  ackPacket,
  helloPacket,
  initialState,
  nextRound,
  openLobby,
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
  snaps.hostResultsPending = a.d[0];
  a.play(1, ackPacket(a.d[1]));
  snaps.seat2Acked = a.d[1];
  a.play(2, ackPacket(a.d[2]));
  a.play(3, ackPacket(a.d[3]));
  snaps.hostResultsDone = a.d[0];

  // Ready check (host setup and a player's ready screen)
  const host = openLobby(setProfile(initialState(), { name: 'Asha', mode: 'host', seat: 1 }), 0x0ab0);
  const heard = (s: State, hellos: [number, string][]) =>
    hellos.reduce((acc, [seat, name], i) => receive(acc, { type: 'hello', gameId: 0, seat, name, pid: 0x300 + i }, 0).state, s);
  snaps.hostWaiting = heard(host, [[2, 'Bo'], [4, 'Dee']]);
  snaps.hostDuplicate = heard(host, [[2, 'Bo'], [3, 'Cy'], [3, 'Zed'], [4, 'Dee']]);
  snaps.hostAllReady = heard(host, [[2, 'Bo'], [3, 'Cy'], [4, 'Dee']]);
  const bo = helloPacket(setProfile(initialState(0x402), { name: 'Bo', mode: 'player', seat: 2 }))!.state;
  snaps.playerSent = bo;
  snaps.playerConfirmed = receive(bo, { type: 'call', gameId: 0x0ab0, players: 4, name: 'Asha', confirmed: 0b11, duplicate: 0 }, 0).state;

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
    if (round === 1) snaps.hostRevealOdd = c.d[0];
    c.results({ funniest: 2, final: round === 3 ? 2 : 1 });
    if (round < 3) c.play(0, nextRound(c.d[0], 99 + round, round * 100_000));
  }
  snaps.matchFinalSeat2 = c.d[1];

  // E: a 4-player Quick Round on a clear line where every guess matched: a four-way tie
  const t = makeRoom(4);
  t.start({ gameId: 0x7e, noise: 0 });
  t.turn(1, { drawing: PUMPKIN });
  t.turn(2, { text: 'pumpkin' });
  t.turn(3, { drawing: PUMPKIN });
  t.turn(4, { text: 'pumpkin' });
  t.play(0, revealGame(t.d[0], 50_000));
  t.results({});
  snaps.tiedResults = t.d[1];

  // D: the developer's screen: a 2-player Party Match, round 2, the host waiting for seat 2
  const m = makeRoom(2);
  m.start({ gameId: 0x2000, noise: 0, mode: 'match' });
  m.turn(1, { drawing: PUMPKIN });
  m.turn(2, { text: 'pumpkin' });
  m.play(0, revealGame(m.d[0], 10_000));
  m.results({});
  m.play(0, nextRound(m.d[0], 0x2001, 20_000));
  snaps.hostRound2Waiting = m.d[0];
  return snaps;
}

let server: PreviewServer;
let browser: Browser;
const base = 'http://localhost:4179/';
const consoleErrors: string[] = [];

async function open(size: { width: number; height: number }, state?: State, opts: { touch?: boolean } = {}): Promise<Page> {
  const page = await browser.newPage({ viewport: size, deviceScaleFactor: 1, hasTouch: !!opts.touch });
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
const cellSel = (r: number, c: number) => `#editor button:nth-child(${r * 16 + c + 1})`;
const isOn = async (page: Page, r: number, c: number) => (await page.getAttribute(cellSel(r, c), 'aria-pressed')) === 'true';
async function center(page: Page, r: number, c: number) {
  const b = (await (await page.$(cellSel(r, c)))!.boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}
/** A mouse stroke through the given squares (pointer events, like a real user). */
async function mouseStroke(page: Page, cells: [number, number][], opts: { endAt?: { x: number; y: number } } = {}) {
  const first = await center(page, ...cells[0]);
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  for (const cell of cells.slice(1)) {
    const p = await center(page, ...cell);
    await page.mouse.move(p.x, p.y, { steps: 3 });
  }
  if (opts.endAt) await page.mouse.move(opts.endAt.x, opts.endAt.y, { steps: 3 });
  await page.mouse.up();
}
/** Touch or pen strokes through Chrome DevTools input events (real pointer events of that type). */
async function deviceStroke(page: Page, kind: 'touch' | 'pen', cells: [number, number][]) {
  const cdp = await page.context().newCDPSession(page);
  const pts = await Promise.all(cells.map((c) => center(page, ...c)));
  if (kind === 'touch') {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: pts[0].x, y: pts[0].y }] });
    for (const p of pts.slice(1)) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: p.x, y: p.y }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } else {
    const ev = (type: string, p: { x: number; y: number }, buttons: number) =>
      cdp.send('Input.dispatchMouseEvent', { type, x: p.x, y: p.y, button: 'left', buttons, clickCount: 1, pointerType: 'pen' } as never);
    await ev('mousePressed', pts[0], 1);
    for (const p of pts.slice(1)) await ev('mouseMoved', p, 1);
    await ev('mouseReleased', pts[pts.length - 1], 0);
  }
  await cdp.detach();
}

beforeAll(async () => {
  mkdirSync(OUT, { recursive: true });
  server = await preview({ preview: { port: 4179, strictPort: true }, logLevel: 'silent' });
  // A fake microphone, so "I'm ready" and host listening work headless. No sound reaches another device here.
  browser = await chromium.launch({ executablePath: EDGE, headless: true, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
}, 60_000);

afterAll(async () => {
  await browser?.close();
  await new Promise<void>((r) => server?.httpServer.close(() => r()));
});

describe('Dial-Up Telephone in a real browser (no sound between devices)', () => {
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

  it('join: seat picker, then ready starts the microphone and plays the ready message', async () => {
    const page = await open(PHONE);
    await page.fill('#name', 'Bo');
    await page.click('#choose-join');
    await page.click('#seats button:has-text("3")');
    expect(await page.textContent('#ready')).toContain('seat 3');
    await shot(page, '02-join-phone');
    await page.click('#ready');
    // The microphone restarts after the chirp plays; wait until it is listening again.
    await page.waitForFunction(
      () => {
        const t = document.querySelector('#checks')?.textContent ?? '';
        return t.includes('Ready message played') && t.includes('Microphone works');
      },
      null,
      { timeout: 15_000 },
    );
    const checks = (await page.textContent('#checks')) ?? '';
    expect(checks).toContain('Microphone works');
    expect(checks).toContain('Not confirmed yet'); // played is not the same as confirmed
    await page.close();
  });

  it('host setup: defaults, one Start, Customize closed, and Start waits for every seat', async () => {
    const page = await open(LAPTOP);
    await page.fill('#name', 'Asha');
    await page.click('#choose-host');
    expect(await page.$('#host #word')).toBeNull();
    expect(await page.getAttribute('#modes button:nth-child(1)', 'aria-checked')).toBe('true'); // Quick Round
    expect(await page.textContent('#players')).toBe('4');
    expect(await page.isVisible('#noise')).toBe(false); // under Customize
    expect(await page.textContent('#customize-summary')).toContain('Crackly');
    expect(await page.isDisabled('#start')).toBe(true);
    expect(await page.textContent('#start')).toBe('Waiting for seat 2');
    expect(await page.$$eval('#roster li', (l) => l.length)).toBe(4);
    await page.click('#customize-summary');
    await page.click('#categories button:nth-child(5)');
    expect(await page.textContent('#customize-summary')).toContain('Silly combos');
    await page.click('#modes button:nth-child(2)');
    await page.click('#players-plus');
    expect(await page.textContent('#fair-note')).toContain('whole room guesses it out loud');
    await shot(page, '03-host-setup-laptop');
    await page.close();
  });

  it('ready check: missing and duplicate seats block the start; a full roster enables it', async () => {
    const waiting = await open(LAPTOP, s.hostWaiting);
    expect(await waiting.textContent('#roster')).toContain('not ready yet');
    expect(await waiting.textContent('#start')).toBe('Waiting for seat 3');
    expect(await waiting.textContent('#roster-note')).toContain('Waiting for seat 3');
    await waiting.close();
    const dup = await open(PHONE, s.hostDuplicate);
    expect(await dup.textContent('#roster')).toContain('Cy and Zed both picked it');
    expect(await dup.textContent('#start')).toBe('Fix seat 3 first');
    expect(await dup.textContent('#roster-note')).toContain('one of them taps Change my seat');
    await shot(dup, '03b-host-duplicate-phone');
    await dup.close();
    const ok = await open(LAPTOP, s.hostAllReady);
    expect(await ok.isDisabled('#start')).toBe(false);
    expect(await ok.textContent('#start')).toBe('Start Quick Round · 4 players');
    await ok.close();
  });

  it('player ready screen: message played vs confirmed by the host', async () => {
    const sent = await open(PHONE, s.playerSent);
    expect(await sent.textContent('#checks')).toContain('Not confirmed yet');
    await sent.close();
    const conf = await open(PHONE, s.playerConfirmed);
    expect(await conf.textContent('#t-title')).toBe("You're in, seat 2!");
    expect(await conf.textContent('#checks')).toContain('Confirmed by Asha as seat 2');
    await shot(conf, '03c-player-confirmed-phone');
    await conf.close();
  });

  it('first drawer: private word with reroll and custom word; no Pen/Eraser buttons', async () => {
    const page = await open(LAPTOP, s.hostDraw);
    expect(await page.isVisible('#word-box')).toBe(true);
    const first = await page.textContent('#word');
    await page.click('#reroll');
    expect(await page.textContent('#word')).not.toBe(first);
    await page.fill('#custom-word', 'haunted cat');
    expect(await page.textContent('#word')).toBe('haunted cat');
    expect(await page.$('#tool-pen')).toBeNull();
    expect(await page.$('#tool-eraser')).toBeNull();
    expect(await page.textContent('.draw-hint')).toBe('Touch empty squares to draw. Start on a filled square to erase. Drag to continue.');
    expect(await page.getAttribute('#brush-small', 'aria-pressed')).toBe('true');
    expect(await page.isDisabled('#primary')).toBe(true);
    await page.close();
  });

  it('mouse: a tap changes one square once; the start square decides paint or erase for the whole stroke', async () => {
    const page = await open(LAPTOP, s.hostDraw);
    await page.locator('#editor').scrollIntoViewIfNeeded();
    // single taps (pointer + the browser's click must not double-toggle)
    await mouseStroke(page, [[0, 0]]);
    expect(await pressedCells(page)).toBe(1);
    await mouseStroke(page, [[0, 0]]);
    expect(await pressedCells(page)).toBe(0);
    // paint across filled squares: they stay filled
    await mouseStroke(page, [[2, 3]]);
    await mouseStroke(page, [[2, 1], [2, 6]]);
    expect(await Promise.all([1, 2, 3, 4, 5, 6].map((c) => isOn(page, 2, c)))).toEqual([true, true, true, true, true, true]);
    // erase across empty squares: they stay empty
    await mouseStroke(page, [[2, 4], [2, 9]]);
    expect(await Promise.all([4, 5, 6, 7, 8, 9].map((c) => isOn(page, 2, c)))).toEqual([false, false, false, false, false, false]);
    expect(await isOn(page, 2, 3)).toBe(true);
    // revisiting squares in one stroke does not toggle them back
    await mouseStroke(page, [[5, 1], [5, 4], [5, 1], [5, 4], [5, 2]]);
    expect(await Promise.all([1, 2, 3, 4].map((c) => isOn(page, 5, c)))).toEqual([true, true, true, true]);
    // whole-stroke undo and redo
    const before = await pressedCells(page);
    await page.click('#undo');
    expect(await pressedCells(page)).toBe(before - 4);
    await page.click('#redo');
    expect(await pressedCells(page)).toBe(before);
    await shot(page, '04-direct-drawing-laptop');
    await page.close();
  });

  it('mouse: release outside the grid and pointer cancellation end the stroke safely', async () => {
    const page = await open(LAPTOP, s.hostDraw);
    await page.locator('#editor').scrollIntoViewIfNeeded();
    const grid = (await (await page.$('#editor'))!.boundingBox())!;
    await mouseStroke(page, [[8, 12], [8, 15]], { endAt: { x: grid.x + grid.width + 80, y: grid.y + grid.height / 2 } });
    expect(await pressedCells(page)).toBe(4);
    // moving back over the grid with the button up paints nothing
    const p = await center(page, 10, 10);
    await page.mouse.move(p.x, p.y, { steps: 4 });
    expect(await pressedCells(page)).toBe(4);
    // cancel in the middle of a stroke: the part drawn so far is kept as one undo step
    const a = await center(page, 12, 0);
    const b = await center(page, 12, 3);
    const c = await center(page, 12, 8);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 3 });
    await page.$eval('#editor', (el) => el.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1, bubbles: true })));
    await page.mouse.move(c.x, c.y, { steps: 4 }); // after cancel: no more painting
    await page.mouse.up();
    expect(await isOn(page, 12, 3)).toBe(true);
    expect(await isOn(page, 12, 8)).toBe(false);
    await page.click('#undo');
    expect(await pressedCells(page)).toBe(4);
    await page.close();
  });

  it('touch and pen strokes behave like the mouse (phone)', async () => {
    const page = await open(PHONE, s.hostDraw, { touch: true });
    await page.locator('#editor').scrollIntoViewIfNeeded();
    await deviceStroke(page, 'touch', [[3, 2], [3, 5], [3, 2], [3, 7]]);
    expect(await Promise.all([2, 3, 4, 5, 6, 7].map((c) => isOn(page, 3, c)))).toEqual([true, true, true, true, true, true]);
    await deviceStroke(page, 'touch', [[3, 4]]); // tap on a filled square: erase once
    expect(await isOn(page, 3, 4)).toBe(false);
    await deviceStroke(page, 'pen', [[3, 5], [3, 9]]); // start on filled: erase, never paint
    expect(await Promise.all([5, 6, 7, 8, 9].map((c) => isOn(page, 3, c)))).toEqual([false, false, false, false, false]);
    expect(await pressedCells(page)).toBe(2); // (3,2) and (3,3)
    await page.click('#undo');
    expect(await pressedCells(page)).toBe(5);
    await page.close();
  });

  it('keyboard: arrows move, Space/Enter toggle, Ctrl+Z undoes, Ctrl+Shift+Z redoes', async () => {
    const page = await open(LAPTOP, s.hostDraw);
    expect(await page.$$eval('#editor button', (b) => b.filter((x) => x.tabIndex === 0).length)).toBe(1);
    await page.focus('#editor button');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Space');
    expect(await isOn(page, 0, 1)).toBe(true);
    await page.keyboard.press('Enter');
    expect(await isOn(page, 0, 1)).toBe(false);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Space');
    expect(await isOn(page, 1, 1)).toBe(true);
    await page.keyboard.press('Control+z');
    expect(await isOn(page, 1, 1)).toBe(false);
    await page.keyboard.press('Control+Shift+z');
    expect(await isOn(page, 1, 1)).toBe(true);
    expect(await page.getAttribute(cellSel(1, 1), 'aria-label')).toBe('Row 2, column 2');
    expect(await page.evaluate(() => document.activeElement?.getAttribute('aria-label'))).toBe('Row 2, column 2');
    await page.close();
  });

  it('bigger canvas: full screen, nothing covers the squares, Done keeps the drawing and its history', async () => {
    for (const [size, tag] of [
      [PHONE, 'phone'],
      [LAPTOP, 'laptop'],
    ] as const) {
      const page = await open(size, s.seat3Draw);
      // while drawing, the sound bar is compact and not sticky
      expect(await page.$eval('#statusbar', (e) => getComputedStyle(e).position)).toBe('static');
      expect((await (await page.$('#statusbar'))!.boundingBox())!.height).toBeLessThan(140); // compact
      if (tag === 'phone') await shot(page, '05a-drawing-compact-status-phone');
      await page.locator('#editor').scrollIntoViewIfNeeded();
      await mouseStroke(page, [[4, 4], [4, 8]]);
      await mouseStroke(page, [[6, 4]]);
      await page.click('#bigger');
      expect(await page.textContent('#bigger')).toBe('✓ Done');
      expect(await page.getAttribute('#bigger', 'aria-expanded')).toBe('true');
      expect(await page.$eval('#draw-box', (e) => getComputedStyle(e).position)).toBe('fixed');
      expect(await page.textContent('#big-clue')).toContain('Draw:');
      // the whole grid, Undo/Redo/Done, and the send button are on screen without scrolling
      const vh = size.height;
      for (const sel of ['#editor', '#undo', '#redo', '#bigger', '#big-send']) {
        const b = (await (await page.$(sel))!.boundingBox())!;
        expect(b.y, sel).toBeGreaterThanOrEqual(0);
        expect(b.y + b.height, sel).toBeLessThanOrEqual(vh);
      }
      // no other element sits on top of the corner squares
      for (const [r, c] of [[0, 0], [0, 15], [15, 0], [15, 15]] as const) {
        const p = await center(page, r, c);
        expect(await page.evaluate(({ x, y }) => (document.elementFromPoint(x, y) as HTMLElement | null)?.closest('#editor') !== null, p)).toBe(true);
      }
      expect(await page.textContent('#big-send')).toBe('Send my drawing');
      expect(await pressedCells(page)).toBe(6);
      await mouseStroke(page, [[10, 10]]); // draw in the big view
      await page.click('#undo'); // history carried over
      await page.click('#undo');
      expect(await pressedCells(page)).toBe(5);
      // Viewport capture: a full-page capture misplaces the fixed full-screen view.
      await page.screenshot({ path: `${OUT}/05-bigger-canvas-${tag}.png` });
      await page.keyboard.press('Escape');
      expect(await page.textContent('#bigger')).toBe('⤢ Bigger canvas');
      expect(await pressedCells(page)).toBe(5);
      await page.click('#redo');
      expect(await pressedCells(page)).toBe(6);
      await page.close();
    }
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
      expect(body).not.toContain('pumpkin');
      if (key === 'seat3Draw') expect(body).not.toContain('orange');
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
    expect(await sent.textContent('#line')).toContain('♪ played, not confirmed yet');
    expect(await sent.textContent('#t-title')).toBe('Played! Keep it secret');
    // Bo's phone doesn't know seat 3's name yet, and never claims it arrived just because it played.
    expect(await sent.textContent('#t-text')).toContain('Waiting for the phone at seat 3 to confirm it arrived');
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
    expect(await page.textContent('#line li:first-child')).toContain('✓ received');
    await shot(page, '10-host-missing-laptop');
    await page.close();
  });

  it('odd player count: the room guess before the reveal, and an explicit answer before results', async () => {
    const page = await open(LAPTOP, s.hostRoomGuess);
    expect(await page.isVisible('#room-box')).toBe(true);
    await page.click('#room-show');
    expect(await page.isVisible('#room-answer')).toBe(true);
    await page.click('#room-yes');
    expect(await page.getAttribute('#room-yes', 'aria-pressed')).toBe('true');
    await shot(page, '11-host-room-guess-laptop');
    await page.close();
    const rev = await open(LAPTOP, s.hostRevealOdd);
    expect(await rev.isDisabled('#send-results')).toBe(true);
    expect(await rev.textContent('#send-results')).toBe('Answer the room guess first');
    await rev.selectOption('#aw-final', '1');
    expect(await rev.isDisabled('#send-results')).toBe(false);
    expect(await rev.textContent('#send-results')).toBe('Send results (no awards)');
    await rev.selectOption('#aw-funniest', '2');
    expect(await rev.textContent('#send-results')).toBe('Send results');
    expect(await rev.isDisabled('#again')).toBe(true); // can't skip the results
    await rev.close();
  });

  it('reveal: the step indicator, sent vs arrived, captions, previous/next, and the results form on the host only', async () => {
    for (const [key, size, tag] of [
      ['revealSeat4', PHONE, 'phone'],
      ['revealHost', LAPTOP, 'laptop'],
    ] as const) {
      const page = await open(size, s[key]);
      expect(await page.textContent('#flow li.now')).toBe('Awards (optional)');
      expect(await page.$$eval('#chain li', (l) => l.length)).toBe(5);
      expect(await page.$$eval('#chain .caption', (l) => l.length)).toBe(5);
      expect(await page.$$eval('#chain .pair figcaption', (f) => f.map((x) => x.textContent))).toEqual(['Sent', 'Arrived', 'Sent', 'Arrived']);
      expect(await page.isVisible('#results-form')).toBe(key === 'revealHost');
      if (key === 'revealHost') expect(await page.textContent('#send-results')).toBe('Send results (no awards)');
      else expect(await page.textContent('#again-note')).toContain('Waiting for the host to send the results');
      await page.click('#reveal-prev');
      expect(await page.$$eval('#chain li', (l) => l.length)).toBe(4);
      expect(await page.textContent('#flow li.now')).toBe('Reveal');
      await page.click('#reveal-next');
      await shot(page, `12-reveal-${tag}`);
      await page.close();
    }
  });

  it('results: "sent" vs confirmed on the host; received and confirmed on players', async () => {
    const pending = await open(LAPTOP, s.hostResultsPending);
    expect(await pending.textContent('#acks')).toContain('Results played. Waiting for confirmation from Bo, Cy, Dee');
    expect(await pending.isVisible('#resend-results')).toBe(true);
    expect(await pending.textContent('#flow li.now')).toBe('Results');
    expect(await pending.textContent('#again-note')).toContain('Waiting for confirmations');
    await shot(pending, '13-host-results-pending-laptop');
    await pending.close();
    const done = await open(LAPTOP, s.hostResultsDone);
    expect(await done.textContent('#acks')).toBe('✓ Results played and confirmed by every phone.');
    expect(await done.textContent('#flow li.now')).toBe('Next round');
    expect(await done.isDisabled('#again')).toBe(false);
    await done.close();
    const player = await open(PHONE, s.resultsSeat2);
    expect(await player.textContent('#awards-text')).toContain('Funniest Transformation: Dee (hop 4)');
    expect(await player.textContent('#acks')).toContain('confirms them to the host in a moment');
    expect(await player.$$eval('#chain li.awarded', (l) => l.length)).toBe(3);
    await player.close();
    const acked = await open(PHONE, s.seat2Acked);
    expect(await acked.textContent('#acks')).toBe('✓ Results received. Your phone played its confirmation to the host.');
    expect(await acked.textContent('#flow li.now')).toBe('Next round');
    await shot(acked, '13b-results-confirmed-phone');
    await acked.close();
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
    expect(await page.textContent('#final-text')).toMatch(/wins the Party Match|Joint winners/);
    expect(await page.$$eval('#standings li', (l) => l.length)).toBe(3);
    await shot(page, '15-match-final-phone');
    await page.close();
  });

  it('tied scores: equal ranks, equal highlight, and "Joint winners"', async () => {
    const page = await open(PHONE, s.tiedResults);
    const rows = await page.$$eval('#scores li', (l) => l.map((li) => [li.querySelector('.rank')?.textContent, li.classList.contains('top'), li.querySelector('.pts')?.textContent]));
    // 4 players, every guess matched, no awards: everyone has 1 point
    expect(rows).toEqual([
      ['1', true, '1 pt'],
      ['1', true, '1 pt'],
      ['1', true, '1 pt'],
      ['1', true, '1 pt'],
    ]);
    expect(await page.textContent('#scores-top')).toBe('🏆 Joint winners: Asha, Bo, Cy and Dee');
    expect(await page.$$eval('#scores li .tag', (t) => t.map((x) => x.textContent))).toEqual(['Joint winner', 'Joint winner', 'Joint winner', 'Joint winner']);
    // every rank-1 badge looks the same: list order doesn't break the tie
    const looks = await page.$$eval('#scores li .rank', (b) => b.map((x) => getComputedStyle(x).backgroundImage));
    expect(new Set(looks).size).toBe(1);
    await shot(page, '17-tied-scores-phone');
    await page.close();
  });

  it('the app version is shown; there is no update prompt without a waiting update', async () => {
    const page = await open(PHONE);
    expect(await page.textContent('#app-version')).toMatch(/^Dial-Up Telephone v\d+\.\d+\.\d+.* · sound protocol v4$/);
    expect(await page.isVisible('#update')).toBe(false);
    await page.close();
  });

  it('laptop layout: the line stays level with the task when scrolled, overlaps nothing, and names seats it learned', async () => {
    const page = await open({ width: 1024, height: 574 }, s.hostRound2Waiting);
    expect(await page.textContent('#t-title')).toBe('Waiting for Bo (seat 2)');
    expect(await page.textContent('#line li:first-child')).toContain('Bo');
    expect(await page.textContent('#line li:first-child')).toContain('seat 2 · hop 1 · draws');
    expect(await page.textContent('#line')).not.toMatch(/Seat 2.*seat 2/);
    await page.evaluate(() => window.scrollTo(0, 160));
    const line = (await (await page.$('.line-panel'))!.boundingBox())!;
    const task = (await (await page.$('#task'))!.boundingBox())!;
    expect(Math.abs(line.y - task.y)).toBeLessThan(2);
    const info = (await (await page.$('#chirp-info'))!.boundingBox())!;
    expect(info.y).toBeGreaterThanOrEqual(line.y + line.height);
    await page.evaluate(() => window.scrollTo(0, 0));
    await shot(page, '16-round2-waiting-laptop');
    await page.close();
  });

  it('theme: decoration is hidden from screen readers, still under reduced motion, and nothing overflows a phone', async () => {
    const lobby = await open(PHONE);
    expect(await lobby.getAttribute('.logo', 'aria-hidden')).toBe('true');
    expect(await lobby.getAttribute('.hero', 'aria-hidden')).toBe('true');
    expect(await lobby.$eval('.hero-wave i', (e) => getComputedStyle(e).animationName)).toBe('none');
    expect(await lobby.$eval('h1', (e) => getComputedStyle(e, '::after').animationName)).toBe('none');
    // the CRT overlay never catches taps
    expect(await lobby.evaluate(() => getComputedStyle(document.body, '::before').pointerEvents)).toBe('none');
    await lobby.close();
    for (const st of [undefined, s.hostAllReady, s.seat3Draw, s.seat2Sent, s.revealSeat4, s.matchFinalSeat2]) {
      const page = await open(PHONE, st);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(PHONE.width);
      await page.close();
    }
  });

  it('no console errors on any screen', () => {
    expect(consoleErrors).toEqual([]);
  });
});
