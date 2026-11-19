/**
 * Visual and DOM checks in a real browser (Microsoft Edge via playwright-core).
 * Not part of `npm test`: run with `npm.cmd run screens` after `npm.cmd run build`.
 *
 * Game states are produced with the real pure game code and injected into
 * storage before the page loads. No sound travels here; this checks layout,
 * visibility, and keyboard behavior only.
 */
import { mkdirSync } from 'node:fs';
import { chromium, type Browser, type Page } from 'playwright-core';
import { preview, type PreviewServer } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hatPuzzle, lockPuzzle } from '../src/game/puzzles';
import { RUNES } from '../src/game/rules';
import { emptyGrid } from '../src/protocol/drawing';
import { decodeMessage } from '../src/protocol/message';
import { houseSend, houseStart, initialState, otherSend, receive, storageKey, type GameState, type Outgoing } from '../src/state/transfers';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const OUT = 'docs/screenshots';
const PHONE = { width: 390, height: 844 };
const LAPTOP = { width: 1366, height: 820 };
const GHOST = 0x2b1d;

const drawing = () => {
  const g = emptyGrid();
  const rows = ['..####..', '.######.', '##.##.##', '########', '########', '##.##.##', '#.#..#.#', '........'];
  rows.forEach((r, i) => [...r].forEach((c, j) => (g[i][j] = c === '#')));
  return g;
};

/** Plays a scripted game with the real state machines and records snapshots. */
function scenario() {
  let house = initialState('house', 10, () => 0);
  let other = initialState('other', 20, () => 0); // darkness + RUNES[0]
  const hear = (b: Uint8Array) => {
    const r = decodeMessage(b);
    if (!r.ok) throw new Error(r.error);
    return r.message;
  };
  const h = (out: Outgoing | null) => {
    house = out!.state;
    other = receive(other, hear(out!.bytes), 1000).state;
  };
  const o = (out: Outgoing | null) => {
    other = out!.state;
    house = receive(house, hear(out!.bytes), 61_000).state;
  };
  const snaps: Record<string, GameState> = {};
  const lock = lockPuzzle(GHOST);
  const now = 0;
  h(houseStart(house, drawing(), 'BOO', GHOST, now));
  snaps.otherCalling = other;
  o(otherSend(other, { partner: 5 }, now));
  snaps.houseObject = house;
  snaps.otherWaitObject = other;
  h(houseSend(house, { object: 'lantern' }, now));
  snaps.houseAwayLock = house;
  snaps.otherKeys = other;
  o(otherSend(other, { key: lock.answer }, now));
  snaps.houseRune = house;
  h(houseSend(house, { rune: RUNES[0].blocks }, now));
  snaps.otherFreed = other;
  o(otherSend(other, {}, now));
  snaps.houseBonus = house;
  snaps.otherEndWaiting = other;
  h(houseSend(house, { spot: hatPuzzle(GHOST).answer }, now));
  o(otherSend(other, {}, 240_000));
  snaps.houseEnd = house;
  snaps.otherEnd = other;
  return snaps;
}

let server: PreviewServer;
let browser: Browser;
let base = '';
const consoleErrors: string[] = [];

async function open(size: { width: number; height: number }, state?: GameState): Promise<Page> {
  const page = await browser.newPage({ viewport: size, deviceScaleFactor: 1 });
  page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
  page.on('pageerror', (e) => consoleErrors.push(String(e)));
  if (state) {
    await page.addInitScript(
      ([role, key, json]) => {
        sessionStorage.setItem('ghostfreq:role', role);
        localStorage.setItem(key, json);
      },
      [state.role, storageKey(state.role), JSON.stringify(state)] as const,
    );
  }
  await page.goto(base);
  await page.waitForSelector('#status');
  await page.emulateMedia({ reducedMotion: 'reduce' }); // stable screenshots
  return page;
}

async function shot(page: Page, name: string) {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
}

beforeAll(async () => {
  mkdirSync(OUT, { recursive: true });
  server = await preview({ preview: { port: 4179, strictPort: true }, logLevel: 'silent' });
  base = 'http://localhost:4179/';
  browser = await chromium.launch({ executablePath: EDGE, headless: true });
}, 60_000);

afterAll(async () => {
  await browser?.close();
  await new Promise<void>((r) => server?.httpServer.close(() => r()));
});

describe('screens in a real browser', () => {
  const snaps = scenario();

  it('a fresh window asks for a role; game-only controls stay hidden', async () => {
    for (const [size, tag] of [[PHONE, 'phone'], [LAPTOP, 'laptop']] as const) {
      const page = await open(size);
      expect(await page.isVisible('#intro')).toBe(true);
      expect(await page.isVisible('#statusbar')).toBe(false);
      expect(await page.isVisible('#game')).toBe(false);
      expect(await page.isVisible('#change-role')).toBe(false);
      await shot(page, `01-intro-${tag}`);
      await page.close();
    }
  });

  it('House drawing: the grid is one tab stop with arrow keys and Space', async () => {
    const page = await open(LAPTOP);
    await page.click('#role-house');
    expect(await page.isVisible('#change-role')).toBe(true);
    await page.focus('#editor button');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Space');
    const pressed = await page.getAttribute('#editor button:nth-child(10)', 'aria-pressed');
    expect(pressed).toBe('true');
    const tabStops = await page.$$eval('#editor button', (b) => b.filter((x) => x.tabIndex === 0).length);
    expect(tabStops).toBe(1);
    await page.fill('#name', 'BOO');
    expect(await page.textContent('#primary')).toContain('Summon BOO');
    await shot(page, '02-house-draw-laptop');
    await page.close();
  });

  const cases: [string, keyof ReturnType<typeof scenario>, 'phone' | 'laptop'][] = [
    ['03-other-calling', 'otherCalling', 'phone'],
    ['04-house-object', 'houseObject', 'laptop'],
    ['05-other-waiting-object', 'otherWaitObject', 'phone'],
    ['06-house-lock', 'houseAwayLock', 'laptop'],
    ['07-other-keys', 'otherKeys', 'phone'],
    ['08-house-mirror', 'houseRune', 'laptop'],
    ['09-other-seal-broken', 'otherFreed', 'phone'],
    ['10-house-bonus', 'houseBonus', 'laptop'],
    ['11-other-free-hat-clue', 'otherEndWaiting', 'phone'],
    ['12-house-ending', 'houseEnd', 'laptop'],
    ['13-other-ending', 'otherEnd', 'phone'],
    ['14-house-object-phone', 'houseObject', 'phone'],
    ['15-other-keys-laptop', 'otherKeys', 'laptop'],
  ];
  for (const [name, key, size] of cases) {
    it(`renders ${name}`, async () => {
      const page = await open(size === 'phone' ? PHONE : LAPTOP, snaps[key]);
      // A saved game offers Resume listening instead of silently staying deaf.
      if (!['houseEnd', 'otherEnd'].includes(key)) {
        expect(await page.textContent('#listen')).toMatch(/Resume listening|Start listening/);
      }
      await shot(page, `${name}-${size}`);
      await page.close();
    });
  }

  it('the House never sees key symbols in its lock clue, and the Other Side sees teeth and metal', async () => {
    const house = await open(LAPTOP, snaps.houseAwayLock);
    const lockText = await house.textContent('#h-lock');
    for (const k of ['Star', 'Moon', 'Skull', 'Heart']) expect(lockText).not.toContain(k);
    await house.close();
    const other = await open(PHONE, snaps.otherKeys);
    const labels = await other.$$eval('#o-keys button', (b) => b.map((x) => x.getAttribute('aria-label')));
    expect(labels).toHaveLength(4);
    for (const l of labels) expect(l).toMatch(/key, \d (tooth|teeth), (silver|gold)/);
    await other.close();
  });

  it('no console errors on any screen', () => {
    expect(consoleErrors).toEqual([]);
  });
});
