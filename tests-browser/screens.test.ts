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
import { awardGame, initialState, promptFor, receive, revealGame, sendEntry, setProfile, startGame, STORAGE_KEY, type Outgoing, type State } from '../src/game/telephone';
import { emptyGrid } from '../src/protocol/drawing';
import { decodePacket } from '../src/protocol/packet';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const OUT = 'docs/screenshots';
const PHONE = { width: 390, height: 844 };
const LAPTOP = { width: 1366, height: 820 };

/** 8-character rows scaled up to a 16×16 drawing. */
const art = (rows: string[]) => {
  const g = emptyGrid(16);
  rows.forEach((r, i) => [...r].forEach((c, j) => {
    if (c === '#') g[2 * i][2 * j] = g[2 * i + 1][2 * j] = g[2 * i][2 * j + 1] = g[2 * i + 1][2 * j + 1] = true;
  }));
  return g;
};
const PUMPKIN = art(['...##...', '..####..', '.######.', '##.##.##', '########', '#.#..#.#', '.######.', '..####..']);
const SUN = art(['#..#..#.', '.#.#.#..', '..###...', '#######.', '..###...', '.#.#.#..', '#..#..#.', '........']);

function scenario() {
  const names = ['Asha', 'Bo', 'Cy', 'Dee'];
  const d: State[] = names.map((name, i) => (i === 0 ? setProfile(initialState(), { name }) : setProfile(initialState(), { name, mode: 'player', seat: i + 1 })));
  const play = (from: number, out: Outgoing | null) => {
    d[from] = out!.state;
    const r = decodePacket(out!.bytes);
    if (!r.ok) throw new Error(r.error);
    d.forEach((s, i) => i !== from && (d[i] = receive(s, r.packet, 1000).state));
  };
  const snaps: Record<string, State> = {};
  play(0, startGame(d[0], { players: 4, word: 'pumpkin', gameId: 77, now: 0, noise: 2 }));
  snaps.hostDraw = d[0];
  snaps.seat3Waiting = d[2];
  play(0, sendEntry(d[0], { drawing: PUMPKIN }));
  snaps.seat2Guess = d[1];
  play(1, sendEntry(d[1], { text: 'orange' }));
  snaps.seat2Sent = d[1];
  snaps.seat3Draw = d[2];
  play(2, sendEntry(d[2], { drawing: SUN }));
  play(3, sendEntry(d[3], { text: 'sun' }));
  snaps.hostReveal = d[0];
  play(0, revealGame(d[0], 95_000));
  snaps.revealHost = d[0];
  snaps.revealSeat4 = d[3];
  play(0, awardGame(d[0], 3));
  snaps.awardedSeat2 = d[1];
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
  await page.emulateMedia({ reducedMotion: 'reduce' });
  if (state) await page.addInitScript(([key, json]) => sessionStorage.setItem(key, json), [STORAGE_KEY, JSON.stringify(state)] as const);
  await page.goto(base);
  await page.waitForSelector('#status');
  return page;
}
const shot = (page: Page, name: string) => page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });

beforeAll(async () => {
  mkdirSync(OUT, { recursive: true });
  server = await preview({ preview: { port: 4179, strictPort: true }, logLevel: 'silent' });
  browser = await chromium.launch({ executablePath: EDGE, headless: true });
}, 60_000);

afterAll(async () => {
  await browser?.close();
  await new Promise<void>((r) => server?.httpServer.close(() => r()));
});

describe('Dial-Up Telephone in a real browser', () => {
  const s = scenario();

  it('lobby: host/join need a name; game controls stay hidden', async () => {
    for (const [size, tag] of [[PHONE, 'phone'], [LAPTOP, 'laptop']] as const) {
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

  it('host setup: player count, line quality, and secret word', async () => {
    const page = await open(LAPTOP);
    await page.fill('#name', 'Asha');
    await page.click('#choose-host');
    await page.click('#players-plus');
    expect(await page.textContent('#players')).toBe('5');
    expect(await page.getAttribute('#noise button:nth-child(2)', 'aria-checked')).toBe('true'); // Crackly by default
    await page.click('#noise button:nth-child(3)');
    expect(await page.getAttribute('#noise button:nth-child(3)', 'aria-checked')).toBe('true');
    await page.fill('#custom-word', 'haunted cat');
    expect(await page.textContent('#word')).toBe('haunted cat');
    await shot(page, '03-host-setup-laptop');
    await page.close();
  });

  it('host draws: the grid is one tab stop with arrows and Space', async () => {
    const page = await open(LAPTOP, s.hostDraw);
    expect(await page.textContent('#prompt-text')).toContain('pumpkin');
    await page.focus('#editor button');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Space');
    expect(await page.getAttribute('#editor button:nth-child(2)', 'aria-pressed')).toBe('true');
    expect(await page.$$eval('#editor button', (b) => b.filter((x) => x.tabIndex === 0).length)).toBe(1);
    await shot(page, '04-host-draw-laptop');
    await page.close();
  });

  for (const [name, key, size] of [
    ['05-seat2-guess-phone', 'seat2Guess', PHONE],
    ['06-seat3-waiting-phone', 'seat3Waiting', PHONE],
    ['07-seat2-sent-phone', 'seat2Sent', PHONE],
    ['08-seat3-draw-phone', 'seat3Draw', PHONE],
    ['09-host-ready-to-reveal-laptop', 'hostReveal', LAPTOP],
  ] as const) {
    it(`renders ${name}`, async () => {
      const page = await open(size, s[key]);
      expect(await page.textContent('#listen')).toMatch(/Resume listening/);
      await shot(page, name);
      await page.close();
    });
  }

  it('secrecy: before the reveal, no screen shows entries it should not', async () => {
    const waiting = await open(PHONE, s.seat3Waiting);
    const body = (await waiting.textContent('body')) ?? '';
    expect(body).not.toContain('pumpkin');
    await waiting.close();
    const drawer = await open(PHONE, s.seat3Draw);
    const text = (await drawer.textContent('body')) ?? '';
    const seen = promptFor(s.seat3Draw.game!);
    expect(seen?.kind).toBe('text');
    expect(text).toContain(seen!.kind === 'text' ? seen!.text : '?'); // the previous guess, with static: allowed
    expect(await drawer.isVisible('#static-note')).toBe(true);
    expect(text).not.toContain('pumpkin'); // the secret word: hidden
    expect(await drawer.isVisible('#prompt-drawing')).toBe(false); // no earlier drawing
    await drawer.close();
  });

  it('reveal: one hop at a time, then the whole chain on every device', async () => {
    for (const [key, size, tag] of [['revealSeat4', PHONE, 'phone'], ['revealHost', LAPTOP, 'laptop']] as const) {
      const page = await open(size, s[key]);
      // a reload shows the whole chain
      expect(await page.$$eval('#chain li', (l) => l.length)).toBe(5);
      expect(await page.textContent('#reveal-result')).toContain('survived 1 hop');
      // haunted line: static is shown on the hops it changed
      expect(await page.$$eval('.cell.hit', (c) => c.length)).toBeGreaterThan(0);
      expect(await page.isVisible('#scores-box')).toBe(true);
      const awardButtons = await page.$$eval('.award-btn', (b) => b.length);
      expect(awardButtons).toBe(key === 'revealHost' ? 4 : 0); // only the host can award
      await shot(page, `10-reveal-${tag}`);
      await page.close();
    }
  });

  it('after the award chirp, every device highlights the winner and its point', async () => {
    const page = await open(PHONE, s.awardedSeat2);
    expect(await page.textContent('#award-text')).toContain('Worst Connection award: Cy');
    expect(await page.$$eval('.chain li.awarded', (l) => l.length)).toBe(1);
    expect(await page.textContent('#scores')).toContain('Worst Connection award');
    await shot(page, '11-awarded-phone');
    await page.close();
  });

  it('no console errors on any screen', () => {
    expect(consoleErrors).toEqual([]);
  });
});
