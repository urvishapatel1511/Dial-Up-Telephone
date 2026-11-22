import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cacheName } from '../src/offline/precache';
import { UPDATE_NOTE, updateAdvice, versionMismatchText } from '../src/offline/update';

const sw = readFileSync('scripts/sw-template.js', 'utf8');
/** The install handler's source, up to the activate handler. */
const install = sw.slice(sw.indexOf("addEventListener('install'"), sw.indexOf("addEventListener('activate'"));

describe('app updates are offered, never forced', () => {
  it('between games: the reload button works straight away and says to update between games', () => {
    expect(updateAdvice({ inRound: false, busyTurn: false, sending: false })).toEqual({ enabled: true, confirm: null, note: UPDATE_NOTE });
  });

  it('during a round or a turn: the player is asked first, and told to update after the game', () => {
    const round = updateAdvice({ inRound: true, busyTurn: false, sending: false });
    expect(round.enabled).toBe(true);
    expect(round.confirm).toMatch(/round is in progress/);
    const turn = updateAdvice({ inRound: true, busyTurn: true, sending: false });
    expect(turn.confirm).toMatch(/unsent turn/);
    expect(turn.note).toContain(UPDATE_NOTE);
  });

  it('while a chirp plays the button waits', () => {
    expect(updateAdvice({ inRound: true, busyTurn: false, sending: true })).toMatchObject({ enabled: false });
  });

  it('the service worker waits for the player instead of taking over on install', () => {
    // skipWaiting on install only for the one-time move from builds that had no update prompt
    expect(install).toMatch(/LEGACY_PREFIX/);
    expect(install.match(/skipWaiting/g)).toHaveLength(1);
    expect(install).toMatch(/if \(keys\.some\(\(k\) => k\.startsWith\(LEGACY_PREFIX\)\)\) await self\.skipWaiting\(\)/);
    // the page's "Reload to update" message activates it
    expect(sw).toMatch(/event\.data\.type === 'skip-waiting'\) self\.skipWaiting\(\)/);
  });

  it('the page and the service worker use the same cache name, so "Prepare for offline play" fills the right cache', () => {
    const prefix = /const PREFIX = '([^']+)'/.exec(sw)?.[1];
    expect(prefix).toBe('dialup-');
    expect(cacheName('abc')).toBe(`${prefix}abc`);
    // activation removes old builds' caches, including the legacy prefix
    expect(sw).toMatch(/k\.startsWith\(PREFIX\) \|\| k\.startsWith\(LEGACY_PREFIX\)\) && k !== CACHE/);
  });

  it('chirps from another version get a plain explanation', () => {
    expect(versionMismatchText('old-version')).toMatch(/older version/);
    expect(versionMismatchText('new-version')).toMatch(/newer version/);
  });
});
