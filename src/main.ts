import './style.css';
import './theme.css';
import { Listener, MIC_ERROR_TEXT, micErrorOf } from './audio/listener';
import { Modem } from './audio/modem';
import { play } from './audio/player';
import { playEffects, type Effect } from './audio/sfx';
import { Visualizer } from './audio/visualizer';
import type { GgwaveFactory } from './audio/ggwave-types';
import { concatSamples, handshakeSamples, wantsHandshake } from './audio/handshake';
import { captionFor, fairNote, STATIC_DRAWING_NOTE, STATIC_TEXT_NOTE } from './game/captions';
import { check as checkDelivery, manualRetry, newDelivery, played, playFailed, postpone, type Delivery, type DeliveryKind } from './game/delivery';
import { MATCH_ROUNDS } from './game/match';
import { NOISE_INFO } from './game/noise';
import { competitionRanks, joinNames, topRanked, winnerNames } from './game/ranking';
import { CATEGORIES, categoryOf } from './game/words';
import { ANSWER_DELAY_MS, callWindowMs, RECEIPT_DELAY_MS, replyWindowMs } from './game/schedule';
import {
  ackPacket,
  addAirtime,
  askFor,
  askToJoin,
  autoAnswer,
  awaitingAcks,
  awaitingJoin,
  awardOptions,
  callPacket,
  canRelay,
  helloPacket,
  hopDelivered,
  joinedSeats,
  openLobby,
  receiptPacket,
  receiverSeat,
  startAckPacket,
  withPlayerId,
  readyStatus,
  resendResults,
  roster,
  chain,
  chosenWord,
  clueFor,
  currentStep,
  entryAt,
  initialState,
  knownMissed,
  knownNames,
  leaveGame,
  loadState,
  matchOver,
  matchStandings,
  missingSteps,
  myStep,
  nameOfSeat,
  nextRound,
  outgoingFor,
  phaseOf,
  PLAYERS_MAX,
  PLAYERS_MIN,
  promptFor,
  receive,
  resendBytes,
  resendEntry,
  resendStart,
  revealGame,
  saveState,
  scores,
  seatOfStep,
  sendEntry,
  sendResults,
  setProfile,
  setWordDraft,
  startGame,
  STORAGE_KEY,
  type ChainCard,
  type Game,
  type Outgoing,
  type Phase,
  type ReceiveEvent,
  type State,
} from './game/telephone';
import { isOfflineReady, prepareOffline, registerServiceWorker } from './offline/offline';
import { updateAdvice, versionMismatchText } from './offline/update';
import { type Grid } from './protocol/drawing';
import {
  ACK_RESULTS,
  cleanName,
  cleanText,
  decodePacket,
  describePacket,
  DRAW_SIZE,
  isDrawingStep,
  NEED_START,
  PROTOCOL_VERSION,
  type FinalGuess,
  type GameMode,
  type NoiseLevel,
  type Packet,
} from './protocol/packet';
import { SendGate } from './state/sender';
import { DrawingEditor } from './ui/editor';
import { renderGrid } from './ui/grid';

declare global {
  interface Window {
    ggwave_factory?: GgwaveFactory;
  }
}

type Tone = 'info' | 'ok' | 'error';
type AudioState = 'off' | 'starting' | 'mic' | 'listening' | 'playing' | 'error';
interface Action {
  label: string;
  disabled?: boolean;
  run: () => Promise<void> | void;
}

const FX_KEY = 'dialup:effects';
const NO_SIGNAL_HINT_MS = 30_000;
const AUDIO_TIMEOUT_MS = 10_000;
const SHOW_STEP_MS = 2600;
/** Never wait longer than this for the line to clear before playing anyway. */
const LINE_WAIT_MAX_MS = 20_000;
/** A confirmed delivery stays on screen this long. */
const CONFIRMED_SHOWN_MS = 12_000;
const APP_VERSION = `v${__APP_VERSION__}${__APP_BUILD__ ? ` · ${__APP_BUILD__}` : ''}`;
const IN_GAME: Phase[] = ['ready', 'my-turn', 'waiting', 'sent', 'missing', 'ready-to-reveal'];
const LISTEN_PHASES: Phase[] = ['ready', 'waiting', 'sent', 'missing', 'host-setup'];

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const show = (id: string, visible: boolean) => ($(id).hidden = !visible);
const randomU16 = () => crypto.getRandomValues(new Uint16Array(1))[0];
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// One browser tab = one player (sessionStorage), so several windows on one laptop can play.
// The player ID identifies this tab in the ready check, independently of the name.
let state: State = withPlayerId(loadState(sessionStorage), randomU16);
// A host screen restored without its ready check (e.g. from the previous version): reopen it.
if (state.profile.mode === 'host' && !state.game && state.lobby?.owner !== 'host') state = openLobby(state, randomU16());

// UI-only state
let joinScreen = false;
let chosenSeat = state.profile.seat && state.profile.seat >= 2 ? state.profile.seat : 2;
let hostPlayers = 4;
let hostNoise: NoiseLevel = 1;
let hostMode: GameMode = 'quick';
let hostCategory = 0;
let editor: DrawingEditor | null = null;
let draftFor = '';
let bigCanvas = false;
let revealShown = 1;
let showTimer: number | undefined;
let roomFor = -1;
let roomGuess: FinalGuess = 0;
let roomAnswerShown = false;
let formFor = -1;
let relayOffer: { gameId: number; step: number } | null = null;
/** A round this ready player heard but isn't in (it missed the start signal). */
let missedStart: number | null = null;
/** Host: listening for answers to a ready check until this time. */
let checkUntil = 0;
let checkTimer: number | undefined;
const answeredAt = new Map<string, number>();
let currentPrimary: (() => Promise<void> | void) | null = null;
let currentSecondary: (() => Promise<void> | void) | null = null;
let currentTertiary: (() => Promise<void> | void) | null = null;
let againRun: (() => Promise<void> | void) | null = null;
let fxOn = localStorage.getItem(FX_KEY) !== 'off';
let fxUntil = 0;
/** Other phones are expected to answer automatically until this time: don't start a new chirp. */
let quietUntil = 0;
/** A send is waiting for the line to clear. */
let lineWait = false;
/** What happened to the chirps this phone sent, at most one per kind. */
const deliveries = new Map<DeliveryKind, Delivery>();
const confirmedAt = new Map<DeliveryKind, number>();
let deliveryTimer: number | undefined;
/** A new app version is downloaded and waiting; calling this activates it and reloads. */
let applyUpdate: (() => void) | null = null;
/** Set when a chirp from another version of the game was heard. */
let versionWarning: string | null = null;

// Audio
let ctx: AudioContext | null = null;
let modem: Modem | null = null;
let listener: Listener | null = null;
let viz: Visualizer | null = null;
let audioState: AudioState = 'off';
let audioError = '';
let playingMs = 0;
let resumeNeeded = false;
let hintTimer: number | undefined;
const gate = new SendGate();
const metrics: Record<string, string> = {};

// ---------------------------------------------------------------- helpers

function setStatus(text: string, tone: Tone = 'info') {
  $('status').textContent = text;
  $('status').className = `status ${tone === 'info' ? '' : tone}`;
}

function commit(next: State) {
  state = next;
  saveState(sessionStorage, state);
  render();
}

const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(' ');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const clock = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  return Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error(message)), ms))]);
}
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}) => Object.assign(document.createElement(tag), props);

const myName = () => cleanName(state.profile.name) ?? '';
/** A seat's name from this round, or from earlier rounds and the ready check; null if unknown. */
const nameFor = (g: Game, seat: number) => nameOfSeat(g, seat, myName()) ?? knownNames(state)[String(seat)] ?? null;
/** Name of the author of a step (or "Seat n" if this device doesn't know it yet). */
function who(g: Game, step: number): string {
  const seat = seatOfStep(g, step);
  return nameFor(g, seat) ?? `Seat ${seat}`;
}
/** "Bo (seat 2)" when the name is known, just "Seat 2" when it isn't. */
function whoWithSeat(g: Game, step: number): string {
  const seat = seatOfStep(g, step);
  const name = nameFor(g, seat);
  return name ? `${name} (seat ${seat})` : `Seat ${seat}`;
}
const verb = (step: number, done: boolean) => (isDrawingStep(step) ? (done ? 'drew' : 'drawing') : done ? 'guessed' : 'guessing');
const hopName = (k: number) => (isDrawingStep(k) ? 'drawing' : 'guess');
const roundLabel = (g: Game) => (g.mode === 'match' ? `Party Match · round ${g.round} of ${MATCH_ROUNDS}` : 'Quick Round');
/** A chirp is playing, or waiting for the line to clear before it plays. */
const sending = () => gate.busy || lineWait;
/** Name of a seat for messages: "Bo", or "seat 3" when unknown. */
const seatName = (g: Game, seat: number) => nameFor(g, seat) ?? `seat ${seat}`;
/** "Bo's phone", or "the phone at seat 3" when the name is unknown. */
const phoneOf = (g: Game, seat: number) => {
  const name = nameFor(g, seat);
  return name ? `${name}'s phone` : `the phone at seat ${seat}`;
};

function setAction(id: string, a: Action | null): (() => Promise<void> | void) | null {
  const b = $<HTMLButtonElement>(id);
  b.hidden = !a;
  b.textContent = a?.label ?? '';
  b.disabled = !a || !!a.disabled || sending();
  return a?.run ?? null;
}

function pressed(id: string, on: boolean) {
  $(id).setAttribute('aria-pressed', String(on));
}

interface RadioItem<T> {
  value: T;
  name: string;
  icon?: string;
  blurb?: string;
}
function radios<T>(box: HTMLElement, items: RadioItem<T>[], current: T, pick: (v: T) => void) {
  const hadFocus = box.contains(document.activeElement);
  box.replaceChildren(
    ...items.map((it) => {
      const b = el('button', { type: 'button' });
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(it.value === current));
      b.setAttribute('aria-label', it.blurb ? `${it.name}: ${it.blurb}` : it.name);
      if (it.icon) {
        const icon = el('span', { className: 'big', textContent: it.icon });
        icon.setAttribute('aria-hidden', 'true');
        b.append(icon);
      }
      b.append(el('b', { textContent: it.name }));
      if (it.blurb) b.append(el('small', { textContent: it.blurb }));
      b.addEventListener('click', () => {
        pick(it.value);
        render();
      });
      return b;
    }),
  );
  if (hadFocus) box.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
}

// ---------------------------------------------------------------- render

function render() {
  const phase = phaseOf(state);
  const inGame = IN_GAME.includes(phase);
  show('lobby', phase === 'lobby' && !joinScreen);
  show('join', phase === 'lobby' && joinScreen);
  show('host', phase === 'host-setup');
  show('game', inGame);
  show('reveal', phase === 'reveal');
  show('statusbar', phase !== 'lobby' || joinScreen);

  const name = cleanName(state.profile.name);
  show('me-badge', !!name && phase !== 'lobby');
  $('me-badge').textContent = state.profile.seat === 1 ? `☎️ ${name} · host · seat 1` : `📻 ${name} · seat ${state.profile.seat ?? '?'}`;

  renderAudio(phase);
  if (phase === 'lobby') renderLobby();
  if (phase === 'host-setup') renderHost();
  if (inGame) renderGame(phase);
  if (phase === 'reveal') renderReveal();
  renderRecovery(phase);
  ($('resend') as HTMLButtonElement).disabled = !state.lastSent || sending();
  renderDeliveries();
  renderUpdate(phase);
  renderDiagnostics(phase);
}

/** "Update available" with an explicit reload, never an automatic one. */
function renderUpdate(phase: Phase) {
  $('app-version').textContent = `Dial-Up Telephone ${APP_VERSION} · sound protocol v${PROTOCOL_VERSION}`;
  show('version-warn', !!versionWarning);
  $('version-warn').textContent = versionWarning ? `⚠ ${versionWarning}` : '';
  show('update', !!applyUpdate);
  if (!applyUpdate) return;
  const a = updateAdvice({ inRound: IN_GAME.includes(phase) && phase !== 'ready', busyTurn: phase === 'my-turn', sending: sending() });
  $('update-note').textContent = a.note;
  ($('update-btn') as HTMLButtonElement).disabled = !a.enabled;
}

// ---------------------------------------------------------------- delivery of my chirps

const STATE_LABEL: Record<Delivery['status'], string> = {
  playing: '🔊 Playing',
  waiting: '⏳ Waiting for confirmation',
  confirmed: '✓ Confirmed',
  unconfirmed: '⚠ No confirmation yet',
};

/** What to say about one delivery, and the retry it offers when it is not confirmed. */
function deliveryView(d: Delivery): { text: string; retry: Action | null } {
  const g = state.game;
  const tryNote = d.status === 'playing' && d.attempts > 0 ? ` (automatic retry ${d.attempts} of ${d.maxAttempts - 1})` : '';
  const failed = "It couldn't play: a sound problem on this phone, not static.";
  if (d.kind === 'entry' && g) {
    const hop = hopName(d.step);
    const to = receiverSeat(g, d.step);
    const target = to ? phoneOf(g, to) : 'the next phone';
    const retry: Action = { label: '↻ Play my turn again', run: () => onResendEntry(d.step) };
    if (d.status === 'playing') return { text: `Your ${hop}${tryNote}…`, retry: null };
    if (d.status === 'waiting') return { text: `Your ${hop} played. Waiting for ${target} to confirm it arrived…`, retry: null };
    if (d.status === 'confirmed') return { text: `${target} confirmed your ${hop} arrived.`, retry: null };
    return { text: d.failed ? failed : `${target} hasn't confirmed your ${hop}. It may have missed the chirp.`, retry };
  }
  if (d.kind === 'start' && g) {
    const pending = awaitingJoin(g).map((k) => seatName(g, k));
    const joined = joinedSeats(g).map((k) => seatName(g, k));
    const retry: Action = { label: '↻ Resend the start signal', run: onResendStart };
    const got = joined.length ? ` Confirmed: ${joined.join(', ')}.` : '';
    if (d.status === 'playing') return { text: `The start signal${tryNote}…`, retry: null };
    if (d.status === 'waiting') return { text: `Start signal played. Waiting for ${pending.join(', ')} to confirm.${got}`, retry: null };
    if (d.status === 'confirmed') return { text: 'Every phone confirmed the start signal.', retry: null };
    return { text: d.failed ? failed : `No confirmation from ${pending.join(', ')}. They may have missed the start.${got}`, retry };
  }
  if (d.kind === 'results' && g) {
    const pending = awaitingAcks(g).map((k) => seatName(g, k));
    const retry: Action = { label: '↻ Send results again', run: onResendResults };
    if (d.status === 'playing') return { text: `The results${tryNote}…`, retry: null };
    if (d.status === 'waiting') return { text: `Results played. Waiting for ${pending.join(', ')} to confirm.`, retry: null };
    if (d.status === 'confirmed') return { text: 'Every phone confirmed the results.', retry: null };
    return { text: d.failed ? failed : `No confirmation from ${pending.join(', ')} yet.`, retry };
  }
  // A request for a missed hop, the reveal/results, or the start
  const what = d.step === NEED_START ? 'the start signal' : d.step === 0 ? (d.wantsResults ? 'the results' : 'the reveal') : `hop ${d.step}`;
  const from = d.step === NEED_START || d.step === 0 || !g ? "the host's phone" : `${who(g, d.step)}'s phone`;
  const retry: Action =
    d.step === NEED_START ? { label: '📣 Ask to join again', run: () => onAskToJoin(d.gameId) } : { label: '📣 Ask again', run: () => onAsk(d.step) };
  if (d.status === 'playing') return { text: `Asking for ${what}…`, retry: null };
  if (d.status === 'waiting') return { text: `Request played. Waiting for ${from} to answer with ${what}…`, retry: null };
  if (d.status === 'confirmed') return { text: `${what[0].toUpperCase()}${what.slice(1)} arrived.`, retry: null };
  return { text: d.failed ? failed : `No answer from ${from} yet. It may be too far away, or its microphone is off.`, retry };
}

function renderDeliveries() {
  const list = $('delivery');
  const now = performance.now();
  const items = [...deliveries.values()].filter((d) => d.status !== 'confirmed' || now - (confirmedAt.get(d.kind) ?? now) < CONFIRMED_SHOWN_MS);
  list.replaceChildren(
    ...items.map((d) => {
      const v = deliveryView(d);
      const li = el('li', { className: d.status });
      const p = el('span');
      // Not playing yet while it waits for other phones' replies to finish.
      const label = d.status === 'playing' && lineWait && !gate.busy ? '⏳ Waiting for the line to clear' : STATE_LABEL[d.status];
      p.append(el('b', { className: 'state', textContent: label }), v.text);
      li.append(p);
      if (v.retry) {
        const b = el('button', { type: 'button', className: 'small', textContent: v.retry.label, disabled: sending() });
        b.addEventListener('click', guard(v.retry.run));
        li.append(b);
      }
      return li;
    }),
  );
  list.hidden = items.length === 0;
}

/** Re-check every delivery against what this phone has heard; start automatic retries that are due. */
function refreshDeliveries() {
  const now = performance.now();
  for (const [kind, d] of deliveries) {
    if (d.status === 'playing') continue; // in flight
    const r = checkDelivery(d, state, now);
    if (!r) {
      deliveries.delete(kind);
      confirmedAt.delete(kind);
      continue;
    }
    if (r.delivery.status === 'confirmed' && d.status !== 'confirmed') confirmedAt.set(kind, now);
    deliveries.set(kind, r.delivery);
    if (r.retry) void autoRetry(kind);
  }
  window.clearTimeout(deliveryTimer);
  const next = Math.min(
    ...[...deliveries.values()].map((d) => (d.status === 'waiting' && d.deadline !== null ? d.deadline : Infinity)),
    // re-render once when a confirmed line should disappear (only future times, or this would loop)
    ...[...confirmedAt.values()].map((t) => t + CONFIRMED_SHOWN_MS).filter((t) => t > now),
  );
  if (Number.isFinite(next)) deliveryTimer = window.setTimeout(refreshDeliveries, Math.max(50, next - now + 50));
  render();
}

type Build = () => { state: State; bytes: Uint8Array } | null;

function retryBuild(d: Delivery): Build | null {
  if (d.kind === 'entry') return () => resendEntry(state, d.step);
  if (d.kind === 'start') return () => resendStart(state);
  if (d.kind === 'results') return () => resendResults(state);
  return null; // requests are repeated by a person, never automatically
}

const retryLabel: Record<DeliveryKind, string> = { entry: 'your turn', start: 'the start signal', results: 'the results', need: 'your request' };

/** Play a chirp again because no confirmation came. Bounded by the delivery's attempts. */
async function autoRetry(kind: DeliveryKind) {
  const d = deliveries.get(kind);
  const build = d && retryBuild(d);
  if (!d || !build) return;
  const r = await playOut(build, `${retryLabel[kind]} again: no confirmation yet (retry ${d.attempts} of ${d.maxAttempts - 1})`, 'Listening for the confirmation…', {
    resend: true,
  });
  const cur = deliveries.get(kind) ?? d;
  const now = performance.now();
  if (r === 'ok') deliveries.set(kind, played(cur, now, state.game?.players ?? 2));
  else if (r === 'failed') deliveries.set(kind, playFailed(cur));
  else if (r === 'busy') deliveries.set(kind, postpone(cur, now, 1500));
  else deliveries.delete(kind);
  refreshDeliveries();
}

/**
 * Play a chirp and track whether it arrives. `manual` = a retry button: one
 * more play, no further automatic ones.
 */
async function trackSend(
  kind: DeliveryKind,
  step: number,
  build: Build,
  label: string,
  after: string,
  opts: { resend?: boolean; manual?: boolean; gameId?: number; wantsResults?: boolean } = {},
): Promise<boolean> {
  if (sending()) return false;
  const prev = deliveries.get(kind);
  const fresh = newDelivery(kind, opts.gameId ?? state.game?.gameId ?? 0, step, { wantsResults: opts.wantsResults });
  const base = !opts.manual ? fresh : prev && prev.step === step && prev.gameId === fresh.gameId ? manualRetry(prev) : { ...fresh, maxAttempts: 1 };
  deliveries.set(kind, base);
  confirmedAt.delete(kind);
  render();
  const r = await playOut(build, label, after, { resend: opts.resend });
  if (r === 'ok') {
    // A start signal creates the round, so take the game ID after it played.
    const gameId = opts.gameId ?? state.game?.gameId ?? base.gameId;
    deliveries.set(kind, played({ ...base, gameId }, performance.now(), state.game?.players ?? 2));
  } else if (r === 'failed') deliveries.set(kind, playFailed(base));
  else if (prev) deliveries.set(kind, prev);
  else deliveries.delete(kind);
  refreshDeliveries();
  return r === 'ok';
}

function renderAudio(phase: Phase) {
  const waiting = LISTEN_PHASES.includes(phase);
  const text: Record<AudioState, string> = {
    off: resumeNeeded ? 'Microphone off. Tap Resume listening so you can hear the others.' : 'Microphone off',
    starting: 'Starting audio…',
    mic: 'Asking for the microphone… allow it in the browser prompt.',
    listening: waiting ? '● Listening for the next chirp' : '● Listening',
    playing: `🔊 Playing chirp… ${(playingMs / 1000).toFixed(1)} s`,
    error: `⚠ ${audioError}`,
  };
  const pill = $('audio-pill');
  pill.textContent = text[audioState];
  pill.className = `pill ${{ listening: 'listening', playing: 'playing', error: 'error', off: '', starting: 'busy', mic: 'busy' }[audioState]}`;
  const listen = $<HTMLButtonElement>('listen');
  listen.disabled = audioState === 'starting' || audioState === 'mic' || audioState === 'playing';
  listen.textContent = audioState === 'listening' ? 'Stop listening' : resumeNeeded ? '🎙 Resume listening' : '🎙 Start listening';
  listen.classList.toggle('attention', audioState !== 'listening' && (resumeNeeded || waiting));
  show('audio-retry', audioState === 'error');
}

function renderLobby() {
  const nameEl = $<HTMLInputElement>('name');
  if (document.activeElement !== nameEl && nameEl.value !== state.profile.name) nameEl.value = state.profile.name;
  const ok = !!cleanName(nameEl.value);
  ($('choose-host') as HTMLButtonElement).disabled = !ok;
  ($('choose-join') as HTMLButtonElement).disabled = !ok;
  radios(
    $('seats'),
    // Styled like a phone keypad (2 ABC, 3 DEF, …); the accessible name stays "Seat N".
    Array.from({ length: PLAYERS_MAX - 1 }, (_, i) => ({ value: i + 2, name: String(i + 2), blurb: ['ABC', 'DEF', 'GHI', 'JKL', 'MNO', 'PQRS', 'TUV'][i] })),
    chosenSeat,
    (n) => (chosenSeat = n),
  );
  $('seats').querySelectorAll('button').forEach((b, i) => b.setAttribute('aria-label', `Seat ${i + 2}`));
  $('ready').textContent = `I'm ready as seat ${chosenSeat}: listen for the host`;
}

function renderHost() {
  radios<GameMode>(
    $('modes'),
    [
      { value: 'quick', name: 'Quick Round', icon: '⚡', blurb: 'one chain, about 5 minutes' },
      { value: 'match', name: 'Party Match', icon: '🏆', blurb: '3 rounds, a new first drawer each round, running totals' },
    ],
    hostMode,
    (m) => (hostMode = m),
  );
  radios<NoiseLevel>(
    $('noise'),
    ([0, 1, 2] as NoiseLevel[]).map((n) => ({ value: n, name: NOISE_INFO[n].name, icon: NOISE_INFO[n].icon, blurb: NOISE_INFO[n].blurb })),
    hostNoise,
    (n) => (hostNoise = n),
  );
  radios(
    $('categories'),
    CATEGORIES.map((c) => ({ value: c.id, name: c.name, icon: c.icon })),
    hostCategory,
    (c) => (hostCategory = c),
  );
  $('players').textContent = String(hostPlayers);
  $('fair-note').textContent = fairNote(hostPlayers, hostMode);
  ($('players-minus') as HTMLButtonElement).disabled = hostPlayers <= PLAYERS_MIN;
  ($('players-plus') as HTMLButtonElement).disabled = hostPlayers >= PLAYERS_MAX;
  const cat = categoryOf(hostCategory);
  $('customize-summary').textContent = `Customize · ${NOISE_INFO[hostNoise].icon} ${NOISE_INFO[hostNoise].name} · ${cat.icon} ${cat.name}`;

  // Who's ready (R9): only phones whose ready message arrived count.
  const r = roster(state, hostPlayers);
  $('roster').replaceChildren(
    ...r.seats.map((x) => {
      const li = el('li', { className: x.status });
      let text = '';
      if (x.status === 'host') text = `${x.names[0]} (you, host)`;
      else if (x.status === 'ready') text = x.names[0];
      else if (x.status === 'missing') text = 'not ready yet';
      else if (x.status === 'duplicate')
        text = new Set(x.names.map((n) => n.toLowerCase())).size === x.names.length ? `${joinNames(x.names)} ${x.names.length === 2 ? 'both' : 'all'} picked it` : `${x.names.length} phones (${joinNames(x.names)}) picked it`;
      else text = `${x.names[0]} (outside a ${hostPlayers}-player game)`;
      const mark = { host: '☎️', ready: '✓', missing: '…', duplicate: '⚠', extra: '⚠' }[x.status];
      li.append(el('span', { className: 'seat', textContent: `Seat ${x.seat}` }), el('span', { textContent: text }), el('span', { className: 'mark', textContent: mark }));
      return li;
    }),
  );
  const listeningForAnswers = performance.now() < checkUntil;
  let note: string;
  if (listeningForAnswers) note = 'Listening for answers. Players answer one at a time.';
  else if (r.duplicate.length) note = `Two phones picked seat ${r.duplicate[0]}: one of them taps Change my seat. Then tap Check who's ready again.`;
  else if (r.missing.length) note = `Waiting for seat ${r.missing.join(', ')}. They tap I'm ready and allow the microphone. Then tap Check who's ready.`;
  else if (r.extra.length) note = `Seat ${r.extra.join(', ')} is outside this game. Raise the player count, or ask them to pick a lower seat.`;
  else note = 'Everyone is ready.';
  // Same names on different seats are fine: every phone is tracked by its own ID and seat.
  if (r.sameName.length) note += ` ${r.sameName.map((n) => `More than one player is called ${n}.`).join(' ')} Seat numbers tell them apart.`;
  $('roster-note').textContent = note;
  ($('check') as HTMLButtonElement).disabled = sending() || listeningForAnswers;

  const start = $<HTMLButtonElement>('start');
  const modeName = hostMode === 'match' ? 'Party Match' : 'Quick Round';
  start.disabled = sending() || !r.canStart;
  start.textContent = r.canStart
    ? `Start ${modeName} · ${hostPlayers} players`
    : r.duplicate.some((k) => k <= hostPlayers)
      ? `Fix seat ${r.duplicate[0]} first`
      : `Waiting for seat ${r.missing[0]}`;
}

function renderLine(g: Game | null) {
  if (!g) {
    $('line-meta').textContent = `You are seat ${state.profile.seat ?? '?'}. The line appears when the host starts.`;
    $('line').replaceChildren();
    show('conflict', false);
    show('resend-start', false);
    return;
  }
  $('line-meta').textContent = `${roundLabel(g)} · ${g.host}'s game · ${g.players} players · ${NOISE_INFO[g.noise].icon} ${NOISE_INFO[g.noise].name}`;
  const now = currentStep(g);
  const me = myStep(g);
  const missed = knownMissed(g);
  $('line').replaceChildren(
    ...Array.from({ length: g.players }, (_, i) => i + 1).map((k) => {
      const seat = seatOfStep(g, k);
      const done = !!entryAt(g, k);
      const li = el('li');
      li.className = [done ? 'done' : '', k === now ? 'now' : '', k === me ? 'me' : '', missed.includes(k) ? 'missed' : ''].join(' ').trim();
      const left = el('span');
      // The wire shows the order; each row reads "name, then seat · hop · role" without repeating the seat.
      const known = nameFor(g, seat) !== null;
      const role = isDrawingStep(k) ? 'draws' : 'guesses';
      left.append(
        `${who(g, k)}${k === me ? ' (you)' : ''}`,
        el('small', { className: 'sub', textContent: known ? `seat ${seat} · hop ${k} · ${role}` : `hop ${k} · ${role}` }),
      );
      let st = '';
      // "Received" needs evidence from the next phone; playback alone only means "played".
      if (done && k === me) st = hopDelivered(g, k) ? '✓ received' : '♪ played, not confirmed yet';
      else if (done) st = `✓ ${verb(k, true)}`;
      else if (missed.includes(k)) st = '⚠ missed here';
      else if (k === now) st = `${isDrawingStep(k) ? '✏️' : '💬'} ${verb(k, false)}…`;
      li.append(left, el('span', { className: 'st', textContent: st }));
      return li;
    }),
  );
  show('conflict', !!g.conflict);
  if (g.conflict) $('conflict').textContent = `⚠ ${g.conflict} also sent the turn for your seat. Two phones may have picked seat ${g.seat}: check seat numbers out loud.`;
  show('resend-start', g.seat === 1 && !g.revealed);
  ($('resend-start') as HTMLButtonElement).disabled = sending();
}

function renderGame(phase: Phase) {
  const g = state.game;
  renderLine(g);

  let step = '';
  let title = '';
  let text = '';
  let wait = '';
  let primary: Action | null = null;
  let secondary: Action | null = null;
  let tertiary: Action | null = null;
  let promptText: string | null = null;
  let promptDrawing: Grid | null = null;
  let staticNote: string | null = null;
  let drawing = false;
  let guessing = false;
  let wordBox = false;
  let roomBox = false;
  let bigClue = '';

  const checks: [boolean | null, string][] = [];
  if (phase === 'ready' || !g) {
    const seat = state.profile.seat ?? 0;
    const rs = readyStatus(state);
    const micOk = audioState === 'listening' || audioState === 'playing';
    step = `Seat ${seat}`;
    title = rs.confirmed ? `You're in, seat ${seat}!` : 'Getting ready';
    text = rs.confirmed
      ? `${rs.host}'s phone confirmed you. Keep listening: you join when the host starts.`
      : 'Your phone counts as ready once the host’s phone hears your ready message.';
    const micStarting = audioState === 'starting' || audioState === 'mic';
    checks.push(
      micOk ? [true, 'Microphone works'] : micStarting ? [null, 'Starting the microphone…'] : [false, audioState === 'error' ? `Microphone problem: ${audioError}` : 'Microphone is off: tap Start listening'],
    );
    checks.push([rs.helloSent || null, rs.helloSent ? 'Ready message played' : 'Ready message not sent yet']);
    checks.push([rs.confirmed || null, rs.confirmed ? `Confirmed by ${rs.host} as seat ${seat}` : "Not confirmed yet: the host taps Check who's ready"]);
    if (rs.duplicate || rs.clash.length) checks.push([false, `${rs.clash.length ? rs.clash.join(' and ') : 'Another phone'} also picked seat ${seat}. One of you: tap Change my seat.`]);
    if (rs.seatTooHigh) checks.push([false, `${rs.host}'s game has ${rs.seatTooHigh} seats. Tap Change my seat and pick 2 to ${rs.seatTooHigh}.`]);
    if (missedStart !== null) {
      title = 'A round started without you';
      text = 'Your phone heard a turn from a round it isn’t in. Ask the host’s phone for the start signal.';
      primary = { label: '📣 Ask to join this round', run: onAskToJoin };
    } else if (micOk) {
      secondary = { label: rs.helloSent ? '↻ Send my ready message again' : '📣 Send my ready message', run: onHello };
    }
    tertiary = {
      label: 'Change my seat',
      run: () => {
        joinScreen = true;
        commit(setProfile(state, { mode: null }));
      },
    };
  } else {
    const me = myStep(g);
    const N = g.players;
    const role = isDrawingStep(me) ? 'you draw' : 'you guess';
    step = `${roundLabel(g)} · hop ${me} of ${N} · ${role}`;
    if (phase === 'my-turn') {
      const p = promptFor(g)!;
      step = `${roundLabel(g)} · your turn · hop ${me} of ${N}`;
      if (p.kind === 'word') {
        title = 'You draw first: pick a secret word';
        text = 'Only you see it. Draw it so the next player can guess it. No letters or numbers!';
        wordBox = true;
        drawing = true;
        const word = chosenWord(g);
        const empty = editor?.empty ?? true;
        bigClue = `Your word: ${(word ?? '—').toUpperCase()}`;
        primary = { label: !word ? 'Word must be 1–12 letters' : empty ? 'Draw something first' : 'Send my drawing', disabled: !word || empty, run: onSendDrawing };
      } else if (p.kind === 'text') {
        title = `Draw what ${p.from} guessed`;
        text = 'No letters or numbers, just a drawing!';
        promptText = p.text;
        if (p.altered) staticNote = STATIC_TEXT_NOTE;
        bigClue = `Draw: “${p.text.toUpperCase()}”`;
        drawing = true;
        const empty = editor?.empty ?? true;
        primary = { label: empty ? 'Draw something first' : 'Send my drawing', disabled: empty, run: onSendDrawing };
      } else {
        title = `What did ${p.from} draw?`;
        text = 'Type your best guess. The next player will draw it.';
        promptDrawing = p.drawing;
        if (p.altered) staticNote = STATIC_DRAWING_NOTE;
        guessing = true;
        const guess = cleanText(($('guess') as HTMLInputElement).value);
        primary = { label: guess ? `Send my guess: "${guess}"` : 'Type a guess first', disabled: !guess, run: onSendGuess };
      }
    } else if (phase === 'waiting') {
      const prev = me - 1;
      const now = currentStep(g) ?? prev;
      title = `Waiting for ${whoWithSeat(g, prev)}`;
      text = now < prev ? `Right now, ${who(g, now)} is ${verb(now, false)}. Your turn is hop ${me}.` : `${who(g, prev)} is ${verb(prev, false)}. You're next.`;
      wait = `If ${who(g, prev)} already sent, tap Ask for it by sound.`;
      secondary = { label: '📣 Ask for it by sound', run: () => onAsk(prev) };
    } else if (phase === 'sent') {
      const confirmed = hopDelivered(g, me);
      const to = receiverSeat(g, me);
      const target = to ? phoneOf(g, to) : 'the next phone';
      if (me === N) {
        title = 'You played the last hop!';
        text = confirmed
          ? `${to ? `✓ ${target} confirmed it arrived. ` : ''}The host (${g.host}) reveals the chain next. Keep listening.`
          : `Your chirp played. Waiting for ${target} to confirm it arrived…`;
        wait = confirmed ? 'Listening for the reveal…' : 'This phone plays it again by itself if no confirmation comes. You can also tap Play my turn again.';
      } else {
        const now = currentStep(g);
        title = confirmed ? 'Received! Keep it secret' : 'Played! Keep it secret';
        text = confirmed
          ? `✓ ${target} confirmed your ${hopName(me)} arrived.${now && now > me ? ` Now ${who(g, now)} is ${verb(now, false)}.` : ''}`
          : `Your chirp played. Waiting for ${target} to confirm it arrived…`;
        wait = confirmed ? 'Listening…' : 'This phone plays it again by itself if no confirmation comes. You can also tap Play my turn again.';
      }
      secondary = { label: '↻ Play my turn again', run: () => onResendEntry(me) };
    } else if (phase === 'missing') {
      const missing = missingSteps(g);
      step = `${roundLabel(g)} · the chain is almost complete`;
      title = "Some hops didn't reach this phone";
      text = `Missing here: ${missing.map((k) => `hop ${k} (${who(g, k)})`).join(', ')}. Ask for each one by sound below. The reveal unlocks when the chain is complete.`;
      tertiary = {
        label: 'Reveal with missing hops',
        run: () => {
          if (confirm('Reveal now? Missing hops show as "not heard" on every phone. Use this only if a player has left.')) return onReveal(true);
        },
      };
      roomBox = N % 2 === 1;
    } else if (phase === 'ready-to-reveal') {
      step = `${roundLabel(g)} · everyone has played`;
      title = 'Gather around for the reveal!';
      text =
        N % 2 === 1
          ? 'First the room guess: show everyone the last drawing below and let everyone guess out loud. Then press Reveal.'
          : 'Press Reveal: one chirp lets every phone in the room show the whole chain.';
      primary = { label: 'Reveal the chain', run: () => onReveal(false) };
      roomBox = N % 2 === 1;
    }
  }

  $('t-step').textContent = step;
  $('t-title').textContent = title;
  $('t-text').textContent = text;
  show('t-wait', !!wait);
  $('t-wait').textContent = wait;

  show('word-box', wordBox);
  if (wordBox && g) {
    const word = chosenWord(g);
    const cat = categoryOf(g.category);
    $('word').textContent = word ?? '—';
    $('word-cat').textContent = `${cat.icon} ${cat.name}`;
    const input = $<HTMLInputElement>('custom-word');
    if (document.activeElement !== input && input.value !== g.wordDraft.custom) input.value = g.wordDraft.custom;
  }

  show('prompt-text', !!promptText);
  $('prompt-text').textContent = promptText ? `“${promptText}”` : '';
  show('static-note', !!staticNote);
  $('static-note').textContent = staticNote ?? '';
  show('prompt-drawing', !!promptDrawing);
  if (promptDrawing) renderGrid($('prompt-drawing'), promptDrawing, { label: 'The drawing you must guess' });

  renderRoomBox(roomBox ? g : null);

  show('checks', checks.length > 0);
  $('checks').replaceChildren(
    ...checks.map(([ok, label]) => el('li', { className: ok === true ? 'ok' : ok === false ? 'bad' : 'wait', textContent: `${ok === true ? '✓' : ok === false ? '⚠' : '…'} ${label}` })),
  );

  show('draw-box', drawing);
  if (!drawing) bigCanvas = false;
  document.body.classList.toggle('is-drawing', drawing);
  document.body.classList.toggle('canvas-open', drawing && bigCanvas);
  $('draw-box').classList.toggle('big', drawing && bigCanvas);
  if (drawing && g && editor) {
    const key = `${g.gameId}:${myStep(g)}`;
    if (draftFor !== key) {
      draftFor = key;
      editor.reset();
    }
    pressed('brush-small', editor.brush === 'small');
    pressed('brush-large', editor.brush === 'large');
    const bigger = $('bigger');
    bigger.textContent = bigCanvas ? '✓ Done' : '⤢ Bigger canvas';
    bigger.setAttribute('aria-label', bigCanvas ? 'Done: back to the normal view' : 'Bigger canvas');
    bigger.setAttribute('aria-expanded', String(bigCanvas));
    ($('undo') as HTMLButtonElement).disabled = !editor.canUndo;
    ($('redo') as HTMLButtonElement).disabled = !editor.canRedo;
    ($('clear') as HTMLButtonElement).disabled = editor.empty;
    $('big-clue').textContent = bigClue;
    $('big-audio').textContent = audioState === 'listening' ? '● Listening' : audioState === 'playing' ? '🔊 Playing' : audioState === 'error' ? '⚠ Sound problem' : '○ Mic off';
  }
  show('guess-box', guessing);

  currentPrimary = setAction('primary', primary);
  currentSecondary = setAction('secondary', secondary);
  currentTertiary = setAction('tertiary', tertiary);
  // The full-screen canvas has its own send button, so the action is always in reach.
  setAction('big-send', drawing && primary ? primary : null);
  if (!(drawing && bigCanvas)) $('big-send').hidden = true;
}

/** Odd player counts: the host shows the last drawing and the room guesses it out loud. */
function renderRoomBox(g: Game | null) {
  const last = g && g.seat === 1 ? entryAt(g, g.players) : undefined;
  show('room-box', !!last?.drawing);
  if (!g || !last?.drawing) return;
  if (roomFor !== g.gameId) {
    roomFor = g.gameId;
    roomGuess = 0;
    roomAnswerShown = false;
  }
  renderGrid($('room-drawing'), last.drawing, { label: `The last drawing, by ${last.name}` });
  show('room-answer', roomAnswerShown);
  $('room-answer').textContent = `${last.name} was drawing “${(clueFor(g, g.players) ?? '?').toUpperCase()}”.`;
  ($('room-show') as HTMLButtonElement).disabled = roomAnswerShown;
  pressed('room-yes', roomGuess === 1);
  pressed('room-no', roomGuess === 2);
}

function renderRecovery(phase: Phase) {
  const g = state.game;
  const rec = $('recovery');
  const list = $('rec-list');
  const items: HTMLLIElement[] = [];
  const add = (text: string, label: string, run: () => Promise<void> | void) => {
    const li = el('li');
    const b = el('button', { type: 'button', className: 'small', textContent: label, disabled: sending() });
    b.addEventListener('click', guard(run));
    li.append(el('span', { textContent: text }), b);
    items.push(li);
  };
  let relay = false;
  const active = !!g && (IN_GAME.includes(phase) || phase === 'reveal');
  if (g && active) {
    const missed = phase === 'missing' || g.revealed ? missingSteps(g) : knownMissed(g);
    for (const k of missed) add(`Hop ${k}: ${who(g, k)}'s ${hopName(k)} didn't reach this phone.`, '📣 Ask for it by sound', () => onAsk(k));
    if (g.seat !== 1 && !g.revealed && entryAt(g, g.players)) {
      add('The host pressed Reveal but nothing happened here?', 'Ask for the reveal', () => onAsk(0));
    }
    if (g.seat !== 1 && g.revealed && !g.results && revealShown >= chain(g).cards.length) {
      add('The host sent the results but they are not showing?', 'Ask for the results', () => onAsk(0));
    }
    if (g.revealed && missedStart !== null && missedStart !== g.gameId) {
      const id = missedStart;
      add('A new round started without you.', '📣 Ask to join', () => onAskToJoin(id));
    }
    if (relayOffer && relayOffer.gameId === g.gameId && canRelay(state, relayOffer.step)) {
      relay = true;
      const author = who(g, relayOffer.step);
      $('relay-text').textContent = `Someone asked for hop ${relayOffer.step}. ${author}'s phone should answer by itself in a moment.`;
      $('relay').textContent = `Send it for them (only if ${author} doesn't answer)`;
      ($('relay') as HTMLButtonElement).disabled = sending();
    }
  }
  list.replaceChildren(...items);
  show('relay-text', relay);
  show('relay', relay);
  rec.hidden = !(active && (items.length > 0 || relay));
  // Place the panel where the player is looking.
  if (phase === 'reveal') {
    if (rec.nextElementSibling !== $('results-box')) $('reveal').insertBefore(rec, $('results-box'));
  } else if (rec.parentElement !== $('task')) {
    $('task').append(rec);
  }
}

function markText(text: string, changed: number[], whole: boolean): HTMLElement {
  const b = el('b');
  if (whole) {
    b.append(el('mark', { className: 'zap', textContent: text.toUpperCase() }));
    return b;
  }
  [...text].forEach((ch, i) => {
    if (changed.includes(i)) b.append(el('mark', { className: 'zap', textContent: ch.toUpperCase() }));
    else b.append(ch.toUpperCase());
  });
  return b;
}

function cardEl(g: Game, card: ChainCard, current: boolean): HTMLLIElement {
  const li = el('li');
  const r = g.results;
  const badges: string[] = [];
  if (r && card.step > 0) {
    if (r.funniest === card.step) badges.push('🤣 Funniest');
    if (r.recognizable === card.step) badges.push('🎯 Most Recognizable');
    if (r.recovery === card.step) badges.push('💪 Best Recovery');
  }
  li.className = [`k-${card.kind}`, current ? 'current' : '', badges.length ? 'awarded' : ''].join(' ').trim();
  const head = el('div', { className: 'who' });
  if (card.kind === 'word') head.textContent = `🔒 The secret word · ${card.name}`;
  else if (card.kind === 'drawing') head.textContent = `Hop ${card.step} · ${card.name} drew`;
  else if (card.kind === 'text') head.textContent = `Hop ${card.step} · ${card.name} guessed`;
  else head.textContent = `Hop ${card.step} · ${card.name}`;
  li.append(head);
  if (badges.length) li.append(el('p', { className: 'badges', textContent: badges.join(' · ') }));

  if (card.kind === 'drawing') {
    if (card.arrived?.drawing) {
      const pair = el('div', { className: 'pair' });
      const sent = el('figure');
      const sentGrid = el('div');
      renderGrid(sentGrid, card.drawing!, { label: `Drawing by ${card.name}, as sent` });
      sent.append(sentGrid, el('figcaption', { textContent: 'Sent' }));
      const arr = el('figure');
      const arrGrid = el('div', { className: 'arrived' });
      renderGrid(arrGrid, card.arrived.drawing, { label: `The same drawing as the next player saw it, with ${card.arrived.flipped.length} squares changed by static` });
      for (const i of card.arrived.flipped) arrGrid.children[i]?.classList.add('hit');
      arr.append(arrGrid, el('figcaption', { textContent: 'Arrived' }));
      pair.append(sent, arr);
      li.append(pair, el('p', { className: 'static-cap', textContent: `📡 ${card.arrived.flipped.length} squares changed on the line (outlined)` }));
    } else {
      const grid = el('div');
      renderGrid(grid, card.drawing!, { label: `Drawing by ${card.name}` });
      li.append(grid);
    }
  } else if (card.kind === 'missing') {
    li.append(el('p', { className: 'missing', textContent: 'Not heard on this phone.' }));
  } else {
    li.append(el('p', { className: 'said', textContent: card.text ?? '' }));
    const a = card.arrived;
    if (a?.text) {
      const p = el('p', { className: 'static-cap' });
      p.append('📡 Arrived as ', markText(a.text, a.changed, a.changed.length === 0));
      li.append(p);
    }
  }
  li.append(el('p', { className: 'caption', textContent: captionFor(g, card) }));
  return li;
}

function stopShow() {
  if (showTimer !== undefined) {
    window.clearInterval(showTimer);
    showTimer = undefined;
  }
}

function scrollToCurrent() {
  document.querySelector('#chain li:last-child')?.scrollIntoView({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' });
}

function step(delta: number) {
  const g = state.game;
  if (!g) return;
  const total = chain(g).cards.length;
  // "Show all" sets a large count; clamp first so Previous works right away.
  revealShown = Math.max(1, Math.min(total, Math.min(revealShown, total) + delta));
  if (delta > 0) {
    const card = chain(g).cards[revealShown - 1];
    playFx(revealShown >= total ? ['success'] : card.arrived ? ['static'] : ['arrive']);
  }
  render();
  scrollToCurrent();
}

function toggleShow() {
  const g = state.game;
  if (!g) return;
  if (showTimer !== undefined) {
    stopShow();
    render();
    return;
  }
  const total = chain(g).cards.length;
  if (revealShown >= total) revealShown = 1;
  showTimer = window.setInterval(() => {
    const gg = state.game;
    if (!gg || phaseOf(state) !== 'reveal') return stopShow();
    if (revealShown >= chain(gg).cards.length) {
      stopShow();
      render();
      return;
    }
    step(1);
    if (revealShown >= chain(gg).cards.length) {
      stopShow();
      render();
    }
  }, SHOW_STEP_MS);
  render();
}

function awardsSummary(g: Game): string {
  const r = g.results;
  if (!r) return '';
  const name = (k: number) => `${entryAt(g, k)?.name ?? `seat ${seatOfStep(g, k)}`} (hop ${k})`;
  const parts: string[] = [];
  if (r.funniest) parts.push(`🤣 Funniest Transformation: ${name(r.funniest)}`);
  if (r.recognizable) parts.push(`🎯 Most Recognizable Drawing: ${name(r.recognizable)}`);
  if (r.recovery) parts.push(`💪 Best Recovery: ${name(r.recovery)}`);
  if (r.final === 1) parts.push(`🗣 The room guessed ${who(g, g.players)}'s last drawing`);
  if (r.final === 2) parts.push(`🗣 The room didn't guess the last drawing`);
  return parts.length ? `Awards are in! ${parts.join(' · ')}` : 'No awards this round. Scores are final.';
}

function fillSelect(sel: HTMLSelectElement, steps: number[], g: Game) {
  sel.replaceChildren(
    el('option', { value: '0', textContent: 'No award' }),
    ...steps.map((k) => el('option', { value: String(k), textContent: `Hop ${k} · ${entryAt(g, k)?.name ?? '?'} (${hopName(k)})` })),
  );
}

/**
 * A scoreboard with competition ranks (5, 5, 3 → 1, 1, 3). Everyone ranked
 * first looks the same, and a tie for first says so: list order never breaks a tie.
 */
function renderBoard(list: HTMLElement, topLine: HTMLElement, rows: { seat: number; name: string; points: number; notes?: string[] }[], final: boolean) {
  const ranked = competitionRanks(rows);
  const top = ranked.filter((r) => r.top).map((r) => r.item);
  const joint = top.length > 1;
  const names = winnerNames(top, rows);
  topLine.hidden = top.length === 0;
  topLine.textContent = joint ? `🏆 ${final ? 'Joint winners' : 'Tied for first'}: ${joinNames(names)}` : top.length ? `🏆 ${final ? 'Winner' : 'In the lead'}: ${names[0]}` : '';
  list.replaceChildren(
    ...ranked.map((r) => {
      const s = r.item;
      const li = el('li', { className: r.top ? 'top' : '' });
      const rank = el('span', { className: 'rank', textContent: String(r.rank) });
      rank.setAttribute('aria-label', `Rank ${r.rank}${r.tied ? ', tied' : ''}`);
      const whoEl = el('span', { className: 'who' });
      whoEl.append(`${s.name} · seat ${s.seat}`);
      if (r.top && joint) whoEl.append(el('span', { className: 'tag', textContent: final ? 'Joint winner' : 'Tied for first' }));
      if (s.notes?.length) whoEl.append(el('span', { className: 'notes', textContent: s.notes.join(' · ') }));
      li.append(rank, whoEl, el('span', { className: 'pts', textContent: `${s.points} pt${s.points === 1 ? '' : 's'}` }));
      return li;
    }),
  );
}

function renderReveal() {
  const g = state.game!;
  const c = chain(g);
  const total = c.cards.length;
  const shown = Math.min(revealShown, total);
  const all = shown >= total;
  const host = g.seat === 1;
  $('round-tag').textContent = roundLabel(g);
  $('chain').replaceChildren(...c.cards.slice(0, shown).map((card, i) => cardEl(g, card, i === shown - 1 && !all)));
  ($('reveal-prev') as HTMLButtonElement).disabled = shown <= 1 || showTimer !== undefined;
  ($('reveal-next') as HTMLButtonElement).disabled = all;
  ($('reveal-all') as HTMLButtonElement).disabled = all;
  const play = $<HTMLButtonElement>('reveal-play');
  play.textContent = showTimer !== undefined ? '⏸ Pause' : all ? '↺ Replay the show' : shown > 1 ? '▶ Resume the show' : '▶ Play the show';
  play.className = all && showTimer === undefined ? '' : 'primary';

  let result = '';
  if (all) {
    if (c.perfect) result = `🎉 Perfect transmission! "${g.word}" survived all ${g.players} hops.`;
    else if (c.survivedHops >= g.players) result = `📼 "${g.word}" made it all the way. Judge the last drawing yourselves!`;
    else result = `📡 "${g.word}" survived ${c.survivedHops} ${c.survivedHops === 1 ? 'hop' : 'hops'}, then took an unexpected turn!`;
  }
  $('reveal-result').textContent = result;

  // One flow on every device (R11): Reveal → Awards (optional) → Results → Next round
  const waiting = host && g.results ? awaitingAcks(g) : [];
  const confirmedHere = !host && (g.acks ?? []).includes(g.seat);
  const stage = !all ? 1 : !g.results ? 2 : host ? (waiting.length ? 3 : 4) : confirmedHere ? 4 : 3;
  $('flow')
    .querySelectorAll('li')
    .forEach((li, i) => {
      li.className = i + 1 < stage ? 'done' : i + 1 === stage ? 'now' : '';
      if (i + 1 === stage) li.setAttribute('aria-current', 'step');
      else li.removeAttribute('aria-current');
    });

  show('results-box', all);
  show('acks', all && !!g.results);
  show('resend-results', all && host && !!g.results);
  if (all) {
    if (g.results) {
      $('awards-text').textContent = awardsSummary(g);
      show('results-form', false);
      if (host) {
        const confirmed = (g.acks ?? []).map((k) => `${seatName(g, k)} ✓`);
        const pending = waiting.map((k) => seatName(g, k));
        $('acks').textContent = pending.length
          ? `Results played. ${confirmed.length ? `Confirmed: ${confirmed.join(' · ')}. ` : ''}Waiting for confirmation from ${pending.join(', ')}.`
          : '✓ Results played and confirmed by every phone.';
        ($('resend-results') as HTMLButtonElement).disabled = sending();
      } else {
        $('acks').textContent = confirmedHere
          ? '✓ Results received. Your phone played its confirmation to the host.'
          : '✓ Results received. Your phone confirms them to the host in a moment…';
      }
    } else if (host) {
      $('awards-text').textContent = 'Awards are optional. Each one is worth 1 point.';
      show('results-form', true);
      const o = awardOptions(g);
      if (formFor !== g.gameId) {
        formFor = g.gameId;
        fillSelect($('aw-funniest') as HTMLSelectElement, o.funniest, g);
        fillSelect($('aw-recognizable') as HTMLSelectElement, o.recognizable, g);
        fillSelect($('aw-recovery') as HTMLSelectElement, o.recovery, g);
        ($('aw-final') as HTMLSelectElement).value = roomFor === g.gameId && roomGuess ? String(roomGuess) : '';
      }
      show('aw-recovery-box', o.recovery.length > 0);
      show('aw-final-box', o.finalGuess);
      const v = (id: string) => Number(($(id) as HTMLSelectElement).value) || 0;
      const picked = v('aw-funniest') + v('aw-recognizable') + (o.recovery.length ? v('aw-recovery') : 0) > 0;
      const needGuess = o.finalGuess && ($('aw-final') as HTMLSelectElement).value === '';
      const send = $<HTMLButtonElement>('send-results');
      send.disabled = sending() || needGuess;
      send.textContent = needGuess ? 'Answer the room guess first' : picked ? 'Send results' : 'Send results (no awards)';
    } else {
      $('awards-text').textContent = 'Vote out loud for the awards! The host sends the results to every phone. Keep listening.';
      show('results-form', false);
    }
  }

  // Scores
  show('scores-box', all);
  if (all) {
    $('scores-title').textContent = g.results ? 'Scores this round' : 'Scores so far (awards still to come)';
    renderBoard($('scores'), $('scores-top'), scores(g), !!g.results);
    $('scores-note').textContent =
      'A guess that matches what the drawer was given scores 1 point for both. ' +
      (g.players % 2 === 1 ? 'The room guessing the last drawing scores 1 for its drawer. ' : '') +
      'Each award is +1. Resending a chirp never changes scores.';
  }

  // Party Match
  const over = matchOver(state);
  show('match-box', all && g.mode === 'match');
  if (all && g.mode === 'match') {
    const m = matchStandings(state);
    $('match-title').textContent = over ? 'Final Party Match totals' : `Party Match totals after round ${g.round} of ${MATCH_ROUNDS}`;
    renderBoard($('standings'), $('standings-top'), m.standings, over);
  }
  show('final-box', all && over);
  if (all && over) {
    const m = matchStandings(state).standings;
    const winners = topRanked(m);
    const top = winners[0]?.points ?? 0;
    const pts = `${top} point${top === 1 ? '' : 's'}`;
    const names = winnerNames(winners, m);
    $('final-text').textContent =
      winners.length === 1
        ? `🏆 ${names[0]} wins the Party Match with ${pts}!`
        : `🏆 Joint winners! ${joinNames(names)} share the Party Match with ${pts} each.`;
  }

  const s = state.stats;
  const time = g.revealedAt !== null ? ` Round time: ${clock(g.revealedAt - g.startedAt)}.` : '';
  $('reveal-stats').textContent = `This device played ${s.chirpsSent} chirps (${s.bytesSent} bytes, ${(s.airtimeMs / 1000).toFixed(1)} s of sound) and heard ${s.chirpsHeard}.${time} No Wi-Fi, no Bluetooth, no internet.`;

  // What next
  const again = $<HTMLButtonElement>('again');
  let label = '';
  let note = '';
  let disabled = false;
  againRun = null;
  const pendingNames = waiting.map((k) => nameOfSeat(g, k, myName()) ?? `seat ${k}`);
  /** The next round retires this one, so continuing without every confirmation is a deliberate choice. */
  const guarded = (run: () => Promise<void> | void) => () => {
    if (pendingNames.length && !confirm(`${pendingNames.join(', ')} hasn't confirmed the results yet. Continue anyway? Their phone may show different scores.`)) return;
    return run();
  };
  if (g.mode === 'match' && !over) {
    if (host) {
      label = `▶ Start round ${g.round + 1} of ${MATCH_ROUNDS}`;
      disabled = !g.results;
      note = !g.results ? 'Send the results first, so every phone has the same scores.' : pendingNames.length ? 'Waiting for confirmations. Send results again, or continue anyway.' : 'Players join automatically. The first drawer moves one seat.';
      againRun = guarded(onNextRound);
    } else {
      note = g.results ? `Waiting for the host to start round ${g.round + 1}. You join automatically.` : 'Waiting for the host to send the results.';
    }
  } else if (over) {
    label = host ? '☎️ Start a new game' : '📻 Ready for a new game';
    disabled = host && !g.results;
    note = host ? (g.results ? 'Ask everyone to press "Ready for a new game" first.' : 'Send the results first.') : 'The host starts the next game. Your device joins automatically.';
    againRun = host ? guarded(() => onAgain(true)) : () => onAgain(true);
  } else {
    label = host ? '☎️ Host another round' : '📻 Ready for the next round';
    disabled = host && !g.results;
    note = host
      ? !g.results
        ? 'Send the results first, so every phone has the same scores.'
        : pendingNames.length
          ? 'Waiting for confirmations. Send results again, or continue anyway.'
          : 'Players on this screen join your next round automatically.'
      : g.results
        ? 'Waiting for the host. You also join automatically if the host starts while you are on this screen.'
        : 'Waiting for the host to send the results.';
    againRun = host ? guarded(() => onAgain(false)) : () => onAgain(false);
  }
  again.hidden = !againRun;
  again.textContent = label;
  again.disabled = disabled || sending();
  again.className = all ? 'primary' : '';
  $('again-note').textContent = note;
}

function renderDiagnostics(phase: Phase) {
  const g = state.game;
  const rows: Record<string, string> = {
    phase,
    audio: audioState,
    'sample rate': ctx ? `${ctx.sampleRate} Hz` : 'audio not started',
    'secure context': String(window.isSecureContext),
    'audio engine': window.ggwave_factory ? 'ggwave loaded' : 'MISSING vendor/ggwave.js',
    game: g ? `${g.gameId} (${g.players} players, ${g.mode} round ${g.round}, my hop ${myStep(g)})` : '-',
    'seen / retired': `${state.seen.length} / ${state.retired.length}`,
    'app version': `${APP_VERSION} · protocol v${PROTOCOL_VERSION}`,
    'player ID': String(state.profile.pid),
    deliveries: [...deliveries.values()].map((d) => `${d.kind} ${d.step}: ${d.status} (${d.attempts}/${d.maxAttempts})`).join(', ') || '-',
    ...metrics,
  };
  $('diag').replaceChildren(...Object.entries(rows).flatMap(([k, v]) => [el('dt', { textContent: k }), el('dd', { textContent: v })]));
}

// ---------------------------------------------------------------- audio

function setAudio(s: AudioState, error = '') {
  audioState = s;
  audioError = error;
  render();
}

/** Must be called from a user gesture (iOS). Times out instead of hanging. */
async function ensureAudio(): Promise<{ ctx: AudioContext; modem: Modem; viz: Visualizer }> {
  if (!window.ggwave_factory) throw new Error("The sound engine didn't load. Reload the page. If you're offline, prepare for offline play first while online.");
  if (!ctx || !modem || !viz) setAudio('starting');
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    try {
      ctx = new AC({ sampleRate: 48000 });
    } catch {
      ctx = new AC();
    }
  }
  await withTimeout(ctx.resume(), AUDIO_TIMEOUT_MS, "Audio didn't start. Tap Try again. If it keeps failing, reload the page.");
  modem ??= await withTimeout(Modem.create(window.ggwave_factory, ctx.sampleRate), AUDIO_TIMEOUT_MS, "The sound engine didn't start. Tap Try again or reload.");
  viz ??= new Visualizer(ctx, $<HTMLCanvasElement>('scope'));
  return { ctx, modem, viz };
}

function audioFailed(err: unknown) {
  const hasCode = typeof err === 'object' && err !== null && 'micError' in err;
  const msg = hasCode ? MIC_ERROR_TEXT[micErrorOf(err)] : err instanceof Error ? err.message : String(err);
  setAudio('error', msg);
  setStatus(msg, 'error');
}

async function startListening(announce = true) {
  let audio;
  try {
    audio = await ensureAudio();
  } catch (err) {
    audioFailed(err);
    return;
  }
  listener ??= new Listener(
    audio.ctx,
    (samples) => {
      const bytes = modem?.decode(samples);
      if (bytes) onDecoded(bytes);
    },
    audio.viz.input,
  );
  if (!listener.active) {
    setAudio('mic');
    try {
      await listener.start();
    } catch (err) {
      audioFailed(err);
      return;
    }
  }
  resumeNeeded = false;
  audio.viz.setMode('listen');
  window.clearTimeout(hintTimer);
  hintTimer = window.setTimeout(() => {
    if (audioState === 'listening' && LISTEN_PHASES.includes(phaseOf(state))) {
      setStatus('Nothing heard for a while. If someone already sent, move the phones closer, turn the volume up, and tap Ask for it by sound.');
    }
  }, NO_SIGNAL_HINT_MS);
  setAudio('listening');
  if (announce) setStatus('Listening.', 'ok');
}

function stopListening(announce = true) {
  window.clearTimeout(hintTimer);
  if (listener?.active) {
    listener.stop();
    viz?.setMode('idle');
    if (announce) setStatus('Stopped listening. The microphone is off.');
  }
  if (audioState === 'listening') setAudio('off');
}

async function effectsDone() {
  const left = fxUntil - performance.now();
  if (left > 0) await sleep(left + 150);
}

function playFx(list: Effect[]) {
  if (!fxOn || !ctx || gate.busy || list.length === 0) return;
  fxUntil = performance.now() + playEffects(ctx, list) * 1000;
}

/**
 * Wait while other phones are expected to answer automatically (reply slots
 * after a start, results, ready check, hop, or request), so a new chirp
 * never talks over them. Bounded, so a busy room can't block a send forever.
 */
async function lineClear() {
  const until = performance.now() + LINE_WAIT_MAX_MS;
  let told = false;
  while ((performance.now() < quietUntil || gate.busy) && performance.now() < until) {
    if (!told && performance.now() < quietUntil) {
      setStatus('Waiting a moment: other phones are answering. Your chirp plays when the line is clear.');
      told = true;
    }
    await sleep(Math.min(500, Math.max(50, quietUntil - performance.now() + 100)));
  }
}

/** 'ok' played · 'busy' another chirp was playing · 'failed' a sound problem · 'nothing' there was nothing to send. */
type PlayResult = 'ok' | 'busy' | 'failed' | 'nothing';

/**
 * Play a chirp, then commit. Nothing is committed if playback fails. The
 * chirp is built only once the line is clear, from the state at that moment,
 * so chirps heard while waiting are never lost. The dial-up handshake only
 * plays before a fresh start signal (R4.1).
 *
 * `scheduled` = an automatic reply in its own slot: it plays at once, and
 * `quiet` keeps the status line for the message the player is reading.
 */
async function playOut(build: Build, label: string, after: string, opts: { resend?: boolean; scheduled?: boolean; quiet?: boolean } = {}): Promise<PlayResult> {
  if (gate.busy || (lineWait && !opts.scheduled)) return 'busy';
  let audio;
  try {
    audio = await ensureAudio();
  } catch (err) {
    audioFailed(err);
    return 'failed';
  }
  if (!opts.scheduled) {
    lineWait = true;
    render();
    try {
      await effectsDone();
      await lineClear();
    } finally {
      lineWait = false;
    }
  }
  if (gate.busy) return 'busy';
  const out = build();
  if (!out) {
    render();
    return 'nothing';
  }
  stopListening(false);
  const decoded = decodePacket(out.bytes);
  const type = decoded.ok ? decoded.packet.type : 'unknown';
  const chirp = audio.modem.encode(out.bytes);
  const lead = wantsHandshake(type, { effects: fxOn, resend: !!opts.resend }) ? handshakeSamples(audio.ctx.sampleRate, out.bytes[out.bytes.length - 1]) : new Float32Array(0);
  const samples = concatSamples(lead, chirp);
  const ms = audio.modem.durationMs(samples);
  playingMs = ms;
  metrics['last chirp'] = `${audio.modem.durationMs(chirp)} ms chirp + ${audio.modem.durationMs(lead)} ms handshake, ${out.bytes.length} bytes`;
  metrics['last tx hex'] = hex(out.bytes);
  if (decoded.ok) $('chirp-info').textContent = `Inside the last chirp: ${describePacket(decoded.packet, out.bytes.length)} → ${(ms / 1000).toFixed(1)} s of sound`;
  audio.viz.setMode('send');
  setAudio('playing');
  if (!opts.quiet) setStatus(`🔊 Playing ${label}… keep the room quiet.`);
  const res = await gate.run(
    out,
    async () => {
      await withTimeout(play(audio.ctx, samples, audio.viz.input), ms + 5000, 'the speaker stopped responding');
      return ms;
    },
    (s, m) => commit(addAirtime(s, m, out.bytes.length)),
  );
  audio.viz.setMode('idle');
  if (!res.ok) {
    if (res.reason === 'busy') return 'busy';
    const why = res.error instanceof Error ? res.error.message : 'unknown error';
    setAudio('off');
    setStatus(`The chirp couldn't play (${why}). This is a sound problem, not static. Nothing changed: press the button again to retry.`, 'error');
    return 'failed';
  }
  // Everyone else answers this chirp automatically now: keep the line free for them.
  if (decoded.ok) quietUntil = Math.max(quietUntil, performance.now() + replyWindowMs(decoded.packet, state.game?.players ?? null));
  if (!opts.quiet) setStatus(`Played ${label}. ${after}`);
  await startListening(false);
  return 'ok';
}

/** Play a chirp that needs no delivery tracking (it is confirmed some other way, or not at all). */
async function send(build: Build, label: string, after: string, opts: { resend?: boolean } = {}): Promise<boolean> {
  return (await playOut(build, label, after, opts)) === 'ok';
}

/**
 * Play an automatic reply in this phone's time slot (see src/game/schedule.ts).
 * If the phone is busy when its slot comes, the reply is skipped rather than
 * delayed into someone else's slot; the sender's own retry repairs it.
 */
function replyInSlot(delayMs: number, build: () => Outgoing | null, label: string, after: string, opts: { quiet?: boolean } = {}) {
  window.setTimeout(() => {
    if (gate.busy || audioState === 'playing') {
      if (!opts.quiet) setStatus('This phone was busy when its turn to answer came. The other phone will ask again.');
      return;
    }
    void playOut(build, label, after, { resend: true, scheduled: true, quiet: opts.quiet });
  }, delayMs);
}

// ---------------------------------------------------------------- receiving

function eventMessage(e: ReceiveEvent): [string, Tone, Effect[]] | null {
  const g = state.game;
  switch (e.type) {
    case 'joined': {
      const what = e.mode === 'match' ? `round ${e.round} of ${MATCH_ROUNDS} of a Party Match` : 'a Quick Round';
      // The jingle (0.65 s) ends before the first confirmation slot (0.9 s).
      return [`Connected! ${e.host} started ${what} for ${e.players} players on a ${NOISE_INFO[e.noise].name.toLowerCase()} line. You are seat ${e.seat}.`, 'ok', ['arrive']];
    }
    case 'start-again':
      return [`Heard the start signal again. Nothing changed.${e.ackIn !== null ? ' This phone confirms again in its turn.' : ''}`, 'info', []];
    case 'not-ready':
      return [`${e.host} started a game, but you're not ready yet. Pick your seat, press I'm ready, then ask ${e.host} to resend the start signal.`, 'error', []];
    case 'seat-too-high':
      return [`${e.host}'s game has only ${e.players} seats. Pick a seat from 2 to ${e.players}, press I'm ready, and ask ${e.host} to resend the start signal.`, 'error', []];
    case 'conflict':
      return [`⚠ ${e.name} also sent the turn for your seat. Two phones may have picked the same seat: check seat numbers out loud.`, 'error', []];
    case 'entry': {
      if (!g) return null;
      if (e.recovered) return [`Recovered hop ${e.step} from ${e.name}. The reveal now shows it.`, 'ok', ['arrive']];
      const me = myStep(g);
      // The jingle (≤ 0.75 s) ends before this phone's "got it" (0.9 s after the chirp).
      if (e.forMe) return [`${e.name}'s ${hopName(e.step)} arrived. Your turn!`, 'ok', ['arrive']];
      if (e.step === me + 1) return [`✓ Confirmed: ${e.name} received your ${hopName(me)} and played their turn.`, 'ok', []];
      if (e.last && g.seat === 1) {
        const missing = missingSteps(g);
        if (missing.length) return [`${e.name} played the last hop, but this phone missed ${missing.map((k) => `hop ${k}`).join(', ')}. Ask for ${missing.length === 1 ? 'it' : 'them'} below.`, 'error', []];
        return [g.players % 2 === 1 ? `${e.name} played the last hop! Show it to the room for the group guess, then reveal.` : `${e.name} played the last hop. Time for the reveal!`, 'ok', ['success']];
      }
      return [`Heard ${e.name} (hop ${e.step}).`, 'info', []];
    }
    case 'revealed':
      return ['The reveal is here! Show the chain one hop at a time.', 'ok', ['success']];
    // No effects on events that schedule replies: a jingle could cover someone's reply chirp.
    case 'results':
      if (e.again) return ['Heard the results again. Nothing changed. This phone confirms again in its turn.', 'info', []];
      return [`Results are in! Scores updated.${e.ackIn !== null ? ' Your phone confirms them to the host in its turn.' : ''}`, 'ok', []];
    case 'call':
      if (e.duplicate) return [`⚠ Two phones picked seat ${state.profile.seat}. One of you: tap Change my seat.`, 'error', []];
      if (e.confirmed) return [`✓ ${e.host}'s phone confirmed you as seat ${state.profile.seat}. Wait for the start.`, 'ok', []];
      if (e.seatTooHigh) return [`${e.host}'s game has ${e.players} seats. Tap Change my seat and pick 2 to ${e.players}.`, 'error', []];
      return [`${e.host} is checking who's ready. Your phone answers in about ${Math.round((e.replyIn ?? 0) / 1000)} s.`, 'info', []];
    case 'hello':
      if (state.profile.mode === 'host') {
        return e.clash ? [`⚠ Two phones say they are seat ${e.seat}. One of them should change seat.`, 'error', []] : [`✓ ${e.name} is ready (seat ${e.seat}).`, 'ok', []];
      }
      return e.clash ? [`⚠ ${e.name} also picked seat ${e.seat}. One of you: tap Change my seat.`, 'error', []] : null;
    case 'ack': {
      if (!g) return null;
      const name = seatName(g, e.seat);
      if (e.step === ACK_RESULTS) return [`✓ ${name} (seat ${e.seat}) confirmed the results.`, 'ok', []];
      if (e.step === NEED_START) return [`✓ ${name} (seat ${e.seat}) confirmed the start signal.`, 'ok', []];
      // A "got it" for my own hop; others' receipts need no message.
      if (e.step === myStep(g)) return [`✓ ${phoneOf(g, e.seat)} confirmed your ${hopName(e.step)} arrived.`, 'ok', []];
      return null;
    }
    case 'missed-start':
      return ['A round started without you. Tap Ask to join.', 'error', []];
    case 'need':
      return null; // handled in onDecoded
    case 'other-game':
      return ['Heard a chirp from another game nearby. Ignored.', 'info', []];
    case 'stale':
      return ['Heard a chirp from an earlier round. Ignored.', 'info', []];
    case 'duplicate':
    case 'ignored':
      return ['Heard the same chirp again. Nothing changed.', 'info', []];
    case 'own-echo':
      return null;
  }
}

/**
 * Answer a request automatically, but only when this device is the one that
 * should (the author, or the host for the reveal). So one request never makes
 * several phones transmit at once (R1.3).
 */
function scheduleAnswer(step: number): boolean {
  const g = state.game;
  const packets = autoAnswer(state, step);
  if (!g || packets.length === 0) return false;
  const key = `${g.gameId}:${step}`;
  const now = performance.now();
  if (now - (answeredAt.get(key) ?? -Infinity) < 4000) return true;
  answeredAt.set(key, now);
  setStatus(
    step === NEED_START
      ? 'A late player asked to join. This phone sends the start signal in a moment…'
      : step === 0
        ? 'Someone missed the reveal or the results. This phone sends them again in a moment…'
        : 'Someone missed your turn. This phone plays it again in a moment…',
  );
  window.setTimeout(() => void answerNow(packets, 0), ANSWER_DELAY_MS);
  return true;
}

async function answerNow(packets: Packet[], tries: number) {
  if (gate.busy || audioState === 'playing') {
    if (tries < 5) window.setTimeout(() => void answerNow(packets, tries + 1), 1500);
    return;
  }
  for (const p of packets) {
    if (state.game?.gameId !== p.gameId) return;
    const label = p.type === 'entry' ? 'your turn again' : p.type === 'reveal' ? 'the reveal again' : p.type === 'start' ? 'the start signal again' : 'the results again';
    // The asker and the room are waiting for exactly this answer, so it doesn't wait for a quiet line.
    if ((await playOut(() => outgoingFor(state, p), label, 'Listening…', { resend: true, scheduled: true })) !== 'ok') return;
  }
}

function onDecoded(bytes: Uint8Array) {
  window.clearTimeout(hintTimer);
  metrics['last rx hex'] = hex(bytes);
  const result = decodePacket(bytes);
  if (!result.ok) {
    metrics['last rx error'] = result.error;
    if (result.error === 'old-version' || result.error === 'new-version') {
      // Never misread: tell the room to update instead.
      versionWarning = versionMismatchText(result.error);
      setStatus(versionWarning, 'error');
      render();
      return;
    }
    setStatus("Heard a chirp but couldn't read it (a sound problem, not static). Nothing changed. Tap Ask for it by sound if you're waiting.", 'error');
    return;
  }
  const p = result.packet;
  // Other phones may answer this chirp automatically: keep the line free for them.
  quietUntil = Math.max(quietUntil, performance.now() + replyWindowMs(p, state.game?.players ?? null));
  const { state: next, event } = receive(state, p, Date.now());
  metrics['last rx event'] = event.type;
  $('chirp-info').textContent = `Inside the last chirp heard: ${describePacket(p, bytes.length)}`;
  if (p.type === 'entry' && relayOffer && relayOffer.gameId === p.gameId && relayOffer.step === p.step) relayOffer = null;
  if (event.type === 'revealed') {
    stopShow();
    revealShown = 1;
  }
  if (event.type === 'joined') {
    stopShow();
    revealShown = 1;
    relayOffer = null;
    missedStart = null;
    ($('guess') as HTMLInputElement).value = '';
  }
  if (event.type === 'missed-start') missedStart = event.gameId;
  if (next !== state) commit(next);
  // Automatic replies, each in this seat's own time slot.
  if (event.type === 'call' && event.replyIn !== null) {
    replyInSlot(event.replyIn, () => helloPacket(state), 'your ready message', "The host's screen shows it when it arrives.");
  }
  if (event.type === 'results' && event.ackIn !== null) {
    replyInSlot(event.ackIn, () => ackPacket(state), 'your results confirmation', 'Listening…');
  }
  // Confirm the start to the host, in this seat's slot (again for a repeated start, until my hop is played).
  if ((event.type === 'joined' || event.type === 'start-again') && event.ackIn !== null) {
    replyInSlot(event.ackIn, () => startAckPacket(state), 'your “I’m in” confirmation', '', { quiet: true });
  }
  // The next player says "got it" for every copy of a hop it holds, so a lost "got it" is repaired by the author's retry.
  if (p.type === 'entry' && (event.type === 'entry' || event.type === 'duplicate' || event.type === 'ignored') && receiptPacket(state, p.step)) {
    const step = p.step;
    replyInSlot(RECEIPT_DELAY_MS, () => receiptPacket(state, step), `“got it” for hop ${step}`, '', { quiet: true });
  }
  if (event.type === 'need') {
    if (!scheduleAnswer(event.step)) {
      if (canRelay(state, event.step)) {
        relayOffer = { gameId: p.gameId, step: event.step };
        setStatus(`Someone asked for hop ${event.step}. ${who(state.game!, event.step)}'s phone should answer by itself.`);
      } else {
        setStatus('Someone asked for a missed hop. Their phone is waiting for the answer.');
      }
    }
    refreshDeliveries();
    return;
  }
  const m = eventMessage(event);
  if (m) {
    setStatus(m[0], m[1]);
    playFx(m[2]);
  }
  refreshDeliveries();
}

// ---------------------------------------------------------------- actions

function resetRoundUi() {
  stopShow();
  revealShown = 1;
  relayOffer = null;
  draftFor = '';
  ($('guess') as HTMLInputElement).value = '';
  clearDeliveries();
}

function clearDeliveries() {
  deliveries.clear();
  confirmedAt.clear();
  window.clearTimeout(deliveryTimer);
}

async function onStart() {
  const opts = { players: hostPlayers, gameId: randomU16(), noise: hostNoise, mode: hostMode, category: hostCategory };
  const build = () => startGame(state, { ...opts, now: Date.now() });
  resetRoundUi();
  // "Played" is all the host knows: each phone confirms the start in its own slot.
  await trackSend('start', 0, build, 'the start signal', 'Each phone confirms when it hears it. Now pick your word and draw it!');
}

async function onResendStart() {
  await trackSend('start', 0, () => resendStart(state), 'the start signal again', 'Late players who are ready can join now.', { resend: true, manual: true });
}

async function onHello() {
  await send(() => helloPacket(state), 'your ready message', "The host's screen shows it when it arrives.", { resend: true });
}

async function onCheck() {
  let masks: { confirmed: number; duplicate: number } | null = null;
  const build = () => {
    const out = callPacket(state, hostPlayers);
    if (out?.packet.type === 'call') masks = { confirmed: out.packet.confirmed, duplicate: out.packet.duplicate };
    return out;
  };
  if ((await send(build, 'the ready check', 'Players who are not confirmed answer one at a time.', { resend: true })) && masks) {
    const { confirmed, duplicate } = masks;
    checkUntil = performance.now() + callWindowMs(confirmed, duplicate);
    window.clearTimeout(checkTimer);
    checkTimer = window.setTimeout(() => render(), checkUntil - performance.now() + 50);
    render();
  }
}

async function onAskToJoin(id: number | null = missedStart) {
  if (id === null) return;
  const ok = await trackSend('need', NEED_START, () => askToJoin(state, id), 'a request to join', "The host's phone sends the start signal in a moment.", {
    resend: true,
    gameId: id,
    manual: deliveries.get('need')?.step === NEED_START,
  });
  if (ok) missedStart = null;
  render();
}

async function onNextRound() {
  const id = randomU16();
  const preview = nextRound(state, id, Date.now());
  if (!preview) return;
  resetRoundUi();
  const g = preview.state.game!;
  const first = seatOfStep(g, 1);
  await trackSend('start', 0, () => nextRound(state, id, Date.now()), `the start of round ${g.round}`, first === 1 ? 'You draw first this round.' : `Seat ${first} draws first this round.`);
}

/** "Played" is not "received": the next player's "got it" confirms it (R4.4). */
function afterEntryText(g: Game): string {
  const to = receiverSeat(g, myStep(g));
  return to ? `Waiting for ${phoneOf(g, to)} to confirm it arrived. Keep it secret!` : 'That was the last hop. Keep it secret until the reveal!';
}

async function onSendDrawing() {
  const g = state.game;
  if (!editor || !g) return;
  const drawing = editor.grid.map((r) => [...r]);
  await trackSend('entry', myStep(g), () => sendEntry(state, { drawing }), 'your drawing', afterEntryText(g));
}

async function onSendGuess() {
  const g = state.game;
  if (!g) return;
  const text = ($('guess') as HTMLInputElement).value;
  if (!sendEntry(state, { text })) return;
  if (await trackSend('entry', myStep(g), () => sendEntry(state, { text }), 'your guess', afterEntryText(g))) ($('guess') as HTMLInputElement).value = '';
}

async function onReveal(force: boolean) {
  stopShow();
  revealShown = 1;
  await send(() => revealGame(state, Date.now(), force), 'the reveal', 'Every phone that heard it now shows the chain.');
}

async function onAsk(step: number) {
  const g = state.game;
  if (!g) return;
  const after = step === 0 ? "The host's phone answers in a moment." : `${who(g, step)}'s phone answers in a moment, if it already played that hop.`;
  const prev = deliveries.get('need');
  await trackSend('need', step, () => askFor(state, step), step === 0 ? 'a request for the reveal' : `a request for hop ${step}`, after, {
    resend: true,
    wantsResults: step === 0 && g.revealed,
    manual: prev?.step === step && prev.gameId === g.gameId,
  });
}

async function onRelay() {
  const offer = relayOffer;
  if (!offer) return;
  relayOffer = null;
  await send(() => resendEntry(state, offer.step), `hop ${offer.step} for the room`, 'Listening…', { resend: true });
}

async function onResendEntry(step: number) {
  await trackSend('entry', step, () => resendEntry(state, step), 'your turn again', 'Listening for the confirmation…', { resend: true, manual: true });
}

async function onResendResults() {
  await trackSend('results', 0, () => resendResults(state), 'the results again', 'Phones confirm in turn.', { resend: true, manual: true });
}

async function onResend() {
  await send(
    () => {
      const bytes = resendBytes(state);
      return bytes ? { state, bytes } : null;
    },
    'the same chirp again',
    'Listening…',
    { resend: true },
  );
}

function onAgain(endMatch: boolean) {
  const host = state.game?.seat === 1;
  resetRoundUi();
  commit(leaveGame(state, endMatch));
  if (host) {
    setStatus('New game. Ask everyone to get ready, then start.');
  } else {
    setStatus('Ready for the next round. Keep listening: you will join when the host starts.', 'ok');
    void startListening(false);
  }
  render();
}

function guard(fn: () => unknown) {
  return () => {
    Promise.resolve()
      .then(fn)
      .catch((err: unknown) => {
        setStatus(err instanceof Error ? err.message : String(err), 'error');
        render();
      });
  };
}

// ---------------------------------------------------------------- wiring

editor = new DrawingEditor(
  $('editor'),
  () => {
    if (editor) render();
  },
  DRAW_SIZE,
);

$<HTMLInputElement>('name').addEventListener('input', (e) => {
  commit(setProfile(state, { name: (e.target as HTMLInputElement).value }));
});
$('choose-host').addEventListener(
  'click',
  guard(async () => {
    commit(openLobby(setProfile(state, { mode: 'host', seat: 1 }), randomU16()));
    setStatus("Players tap Join and I'm ready. Their names appear here when their phone's ready message arrives.");
    // This click is the user gesture that lets the microphone start (needed on iPhone).
    await startListening(false);
  }),
);
$('choose-join').addEventListener('click', () => {
  joinScreen = true;
  render();
});
$('back-from-join').addEventListener('click', () => {
  joinScreen = false;
  render();
});
$('back-from-host').addEventListener('click', () => commit(setProfile(state, { mode: null, seat: null })));
$('ready').addEventListener(
  'click',
  guard(async () => {
    joinScreen = false;
    commit(setProfile(state, { mode: 'player', seat: chosenSeat }));
    setStatus(`You are seat ${chosenSeat}. Starting the microphone…`);
    await startListening(false);
    // Ready means the microphone works AND the host hears us (R9.1): only now say hello.
    if (audioState !== 'listening') return;
    await onHello();
  }),
);
$('check').addEventListener('click', guard(onCheck));
$('players-minus').addEventListener('click', () => {
  hostPlayers = Math.max(PLAYERS_MIN, hostPlayers - 1);
  render();
});
$('players-plus').addEventListener('click', () => {
  hostPlayers = Math.min(PLAYERS_MAX, hostPlayers + 1);
  render();
});
$('start').addEventListener('click', guard(onStart));

// First drawer's secret word
$('reroll').addEventListener('click', () => {
  const g = state.game;
  if (!g) return;
  ($('custom-word') as HTMLInputElement).value = '';
  commit(setWordDraft(state, { variant: g.wordDraft.variant + 1, custom: '' }));
});
$('custom-word').addEventListener('input', (e) => commit(setWordDraft(state, { custom: (e.target as HTMLInputElement).value })));

// Drawing tools (no pen/eraser: the square where a stroke starts decides)
$('brush-small').addEventListener('click', () => editor?.setBrush('small'));
$('brush-large').addEventListener('click', () => editor?.setBrush('large'));
$('undo').addEventListener('click', () => editor?.undo());
$('redo').addEventListener('click', () => editor?.redo());
$('clear').addEventListener('click', () => editor?.clear());
function setBigCanvas(open: boolean) {
  bigCanvas = open;
  render();
  if (!open) $('draw-box').scrollIntoView({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' });
  $('bigger').focus();
}
$('bigger').addEventListener('click', () => setBigCanvas(!bigCanvas));
$('big-send').addEventListener('click', guard(() => currentPrimary?.()));
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && bigCanvas) setBigCanvas(false);
});

$('guess').addEventListener('input', () => render());
$('guess').addEventListener('keydown', (e) => {
  if ((e as KeyboardEvent).key === 'Enter') guard(() => currentPrimary?.())();
});
$('primary').addEventListener('click', guard(() => currentPrimary?.()));
$('secondary').addEventListener('click', guard(() => currentSecondary?.()));
$('tertiary').addEventListener('click', guard(() => currentTertiary?.()));
$('resend-start').addEventListener('click', guard(onResendStart));
$('relay').addEventListener('click', guard(onRelay));

// Odd player counts: the room's out-loud guess
$('room-show').addEventListener('click', () => {
  roomAnswerShown = true;
  render();
});
$('room-yes').addEventListener('click', () => {
  roomGuess = 1;
  setStatus('Noted: the room got it. It counts when you send the awards.', 'ok');
  render();
});
$('room-no').addEventListener('click', () => {
  roomGuess = 2;
  setStatus('Noted: nobody got it.');
  render();
});

// Reveal show
$('reveal-play').addEventListener('click', toggleShow);
$('reveal-next').addEventListener('click', () => {
  stopShow();
  step(1);
});
$('reveal-prev').addEventListener('click', () => {
  stopShow();
  step(-1);
});
$('reveal-all').addEventListener('click', () => {
  stopShow();
  revealShown = 99;
  render();
});
$('results-form').addEventListener(
  'submit',
  (e) => {
    e.preventDefault();
    const v = (id: string) => Number(($(id) as HTMLSelectElement).value) || 0;
    const final = (awardOptions(state.game!).finalGuess ? v('aw-final') : 0) as FinalGuess;
    const r = { funniest: v('aw-funniest'), recognizable: v('aw-recognizable'), recovery: v('aw-recovery'), final };
    guard(() => trackSend('results', 0, () => sendResults(state, r), 'the awards', 'Every phone that hears it shows the same scores and confirms in turn.'))();
  },
);
$('results-form').addEventListener('change', () => render());
$('resend-results').addEventListener('click', guard(onResendResults));
$('again').addEventListener('click', guard(() => againRun?.()));

// Sound and settings
$('resend').addEventListener('click', guard(onResend));
$('listen').addEventListener('click', guard(() => (audioState === 'listening' ? stopListening() : startListening())));
$('audio-retry').addEventListener('click', guard(() => startListening()));
$('settings-btn').addEventListener('click', () => {
  const open = $('settings').hidden;
  $('settings').hidden = !open;
  $('settings-btn').setAttribute('aria-expanded', String(open));
});
const fxToggle = $<HTMLInputElement>('fx-toggle');
fxToggle.checked = fxOn;
fxToggle.addEventListener('change', () => {
  fxOn = fxToggle.checked;
  localStorage.setItem(FX_KEY, fxOn ? 'on' : 'off');
});
$('leave').addEventListener('click', () => {
  if (!state.game) return;
  const msg = state.game.mode === 'match' ? 'Leave this round? Your Party Match points are kept, and you can join the next round.' : 'Leave this round? You can join the next one.';
  if (!confirm(msg)) return;
  resetRoundUi();
  commit(leaveGame(state));
  setStatus('You left the round.');
});
$('reset').addEventListener('click', () => {
  if (!confirm('Forget your name, seat, and game in this window?')) return;
  stopListening(false);
  sessionStorage.removeItem(STORAGE_KEY);
  state = withPlayerId(initialState(), randomU16);
  joinScreen = false;
  resetRoundUi();
  setStatus('Reset. Enter your name to play.');
  render();
});
// Release the microphone when hidden; offer Resume listening when back.
document.addEventListener('visibilitychange', () => {
  if (document.hidden && listener?.active) {
    stopListening(false);
    resumeNeeded = true;
    render();
  } else if (!document.hidden && resumeNeeded) {
    setStatus('Welcome back. Tap Resume listening so you can hear the others.');
  }
});

// ---------------------------------------------------------------- offline

const READY_TEXT = '✓ Ready for offline play. You can turn off Wi-Fi and Bluetooth.';
function setOffline(kind: 'ready' | 'failed' | 'idle', text: string) {
  document.querySelectorAll<HTMLElement>('.offline').forEach((x) => (x.className = `offline ${kind === 'idle' ? '' : kind}`));
  document.querySelectorAll<HTMLElement>('.offline-state').forEach((x) => (x.textContent = text));
}
document.querySelectorAll<HTMLButtonElement>('.prepare').forEach((btn) =>
  btn.addEventListener('click', async () => {
    document.querySelectorAll<HTMLButtonElement>('.prepare').forEach((b) => (b.disabled = true));
    try {
      const r = await prepareOffline((t) => setOffline('idle', t));
      if (r.ok) setOffline('ready', `${READY_TEXT} (${r.result.checked} files, ${Math.round(r.result.bytes / 1024)} KB checked)`);
      else setOffline('failed', r.reason);
    } catch (err) {
      setOffline('failed', `Offline setup failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      document.querySelectorAll<HTMLButtonElement>('.prepare').forEach((b) => (b.disabled = false));
    }
  }),
);
// A new version is downloaded: offer it, never apply it by itself (R: update between games).
registerServiceWorker((apply) => {
  applyUpdate = apply;
  render();
});
$('update-btn').addEventListener('click', () => {
  if (!applyUpdate) return;
  const phase = phaseOf(state);
  const a = updateAdvice({ inRound: IN_GAME.includes(phase) && phase !== 'ready', busyTurn: phase === 'my-turn', sending: sending() });
  if (!a.enabled || (a.confirm && !confirm(a.confirm))) return;
  stopListening(false);
  applyUpdate();
});
void isOfflineReady().then((ready) => {
  if (ready) setOffline('ready', READY_TEXT);
  else if (!navigator.onLine) setOffline('failed', 'You are offline and this device was not prepared. Connect once and tap Prepare.');
});

// ---------------------------------------------------------------- boot

const bootPhase = phaseOf(state);
if (IN_GAME.includes(bootPhase)) {
  resumeNeeded = true;
  setStatus('Welcome back. Your game was saved. Tap Resume listening so you can hear the others.');
} else if (bootPhase === 'reveal') {
  revealShown = 99;
  setStatus('Here is the last reveal.');
} else if (bootPhase === 'host-setup') {
  resumeNeeded = true;
  setStatus("Tap Resume listening so this phone can hear players' ready messages.");
} else {
  setStatus('Enter your name, then host or join a game.');
}
if (!window.isSecureContext) setStatus(MIC_ERROR_TEXT.insecure, 'error');
render();
