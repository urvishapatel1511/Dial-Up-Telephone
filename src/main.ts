import './style.css';
import { Listener, MIC_ERROR_TEXT, micErrorOf } from './audio/listener';
import { Modem } from './audio/modem';
import { play } from './audio/player';
import { playEffects, type Effect } from './audio/sfx';
import { Visualizer } from './audio/visualizer';
import type { GgwaveFactory } from './audio/ggwave-types';
import { concatSamples, handshakeSamples, wantsHandshake } from './audio/handshake';
import { captionFor, fairNote, STATIC_DRAWING_NOTE, STATIC_TEXT_NOTE } from './game/captions';
import { MATCH_ROUNDS } from './game/match';
import { NOISE_INFO } from './game/noise';
import { CATEGORIES, categoryOf } from './game/words';
import {
  addAirtime,
  askFor,
  autoAnswer,
  awardOptions,
  canRelay,
  chain,
  chosenWord,
  clueFor,
  currentStep,
  entryAt,
  initialState,
  knownMissed,
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
import { type Grid } from './protocol/drawing';
import { cleanName, cleanText, decodePacket, describePacket, DRAW_SIZE, isDrawingStep, type FinalGuess, type GameMode, type NoiseLevel, type Packet } from './protocol/packet';
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
/** Pause before the author answers a request, so the asker's speaker is quiet. */
const ANSWER_DELAY_MS = 900;
const SHOW_STEP_MS = 2600;
const IN_GAME: Phase[] = ['ready', 'my-turn', 'waiting', 'sent', 'missing', 'ready-to-reveal'];
const LISTEN_PHASES: Phase[] = ['ready', 'waiting', 'sent', 'missing'];

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const show = (id: string, visible: boolean) => ($(id).hidden = !visible);
const randomU16 = () => crypto.getRandomValues(new Uint16Array(1))[0];
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// One browser tab = one player (sessionStorage), so several windows on one laptop can play.
let state: State = loadState(sessionStorage);

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
const answeredAt = new Map<string, number>();
let currentPrimary: (() => Promise<void> | void) | null = null;
let currentSecondary: (() => Promise<void> | void) | null = null;
let currentTertiary: (() => Promise<void> | void) | null = null;
let againRun: (() => Promise<void> | void) | null = null;
let fxOn = localStorage.getItem(FX_KEY) !== 'off';
let fxUntil = 0;

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
/** Name of the author of a step (or "Seat n" if this device doesn't know it yet). */
function who(g: Game, step: number): string {
  const seat = seatOfStep(g, step);
  return nameOfSeat(g, seat, myName()) ?? `Seat ${seat}`;
}
const verb = (step: number, done: boolean) => (isDrawingStep(step) ? (done ? 'drew' : 'drawing') : done ? 'guessed' : 'guessing');
const hopName = (k: number) => (isDrawingStep(k) ? 'drawing' : 'guess');
/** A hop is confirmed once any later hop is heard: someone after it must have received it. */
const confirmedHop = (g: Game, k: number) => Array.from({ length: g.players - k }, (_, i) => k + 1 + i).some((j) => !!entryAt(g, j));
const roundLabel = (g: Game) => (g.mode === 'match' ? `Party Match · round ${g.round} of ${MATCH_ROUNDS}` : 'Quick Round');

function setAction(id: string, a: Action | null): (() => Promise<void> | void) | null {
  const b = $<HTMLButtonElement>(id);
  b.hidden = !a;
  b.textContent = a?.label ?? '';
  b.disabled = !a || !!a.disabled || gate.busy;
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
  ($('resend') as HTMLButtonElement).disabled = !state.lastSent || gate.busy;
  renderDiagnostics(phase);
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
    Array.from({ length: PLAYERS_MAX - 1 }, (_, i) => ({ value: i + 2, name: String(i + 2) })),
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
      { value: 'match', name: 'Party Match', icon: '🏆', blurb: '3 rounds with running totals' },
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
  const start = $<HTMLButtonElement>('start');
  start.disabled = gate.busy;
  start.textContent = `Start a ${hostPlayers}-player ${hostMode === 'match' ? 'Party Match' : 'Quick Round'}`;
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
      left.append(`${k}. ${who(g, k)}${k === me ? ' (you)' : ''}`, el('small', { className: 'sub', textContent: `seat ${seat} · ${isDrawingStep(k) ? 'draws' : 'guesses'}` }));
      let st = '';
      if (done && k === me) st = confirmedHop(g, k) ? '✓ received' : '♪ played';
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
  ($('resend-start') as HTMLButtonElement).disabled = gate.busy;
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

  if (phase === 'ready' || !g) {
    const seat = state.profile.seat ?? 0;
    step = `Seat ${seat}`;
    title = 'Waiting for the host to start';
    text = `Keep listening. When the host presses Start, this device joins automatically as seat ${seat}.`;
    wait = 'Listening for the start signal…';
    secondary = {
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
        primary = { label: !word ? 'Word must be 1–12 letters' : empty ? 'Draw something first' : 'Send my drawing', disabled: !word || empty, run: onSendDrawing };
      } else if (p.kind === 'text') {
        title = `Draw what ${p.from} guessed`;
        text = 'No letters or numbers, just a drawing!';
        promptText = p.text;
        if (p.altered) staticNote = STATIC_TEXT_NOTE;
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
      title = `Waiting for ${who(g, prev)} (seat ${seatOfStep(g, prev)})`;
      text = now < prev ? `Right now, ${who(g, now)} is ${verb(now, false)}. Your turn is hop ${me}.` : `${who(g, prev)} is ${verb(prev, false)}. You're next.`;
      wait = `If ${who(g, prev)} already sent, tap Ask for it by sound.`;
      secondary = { label: '📣 Ask for it by sound', run: () => onAsk(prev) };
    } else if (phase === 'sent') {
      if (me === N) {
        title = 'You played the last hop!';
        text = `The host (${g.host}) reveals the chain next. Keep listening.`;
        wait = 'Listening for the reveal…';
      } else {
        const next = who(g, me + 1);
        const confirmed = confirmedHop(g, me);
        const now = currentStep(g);
        title = confirmed ? 'Received! Keep it secret' : 'Played! Keep it secret';
        text = confirmed
          ? `✓ ${next} received your ${hopName(me)} and played their turn.`
          : `Your chirp played. It's confirmed when ${next}'s turn is heard.${now && now > me ? ` Now ${who(g, now)} is ${verb(now, false)}.` : ''}`;
        wait = confirmed ? 'Listening…' : `If ${next} didn't get it, tap Play my turn again.`;
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

  show('draw-box', drawing);
  if (drawing && g && editor) {
    const key = `${g.gameId}:${myStep(g)}`;
    if (draftFor !== key) {
      draftFor = key;
      editor.reset();
    }
    pressed('tool-pen', editor.tool === 'pen');
    pressed('tool-eraser', editor.tool === 'eraser');
    pressed('brush-small', editor.brush === 'small');
    pressed('brush-large', editor.brush === 'large');
    pressed('bigger', bigCanvas);
    ($('undo') as HTMLButtonElement).disabled = !editor.canUndo;
    ($('redo') as HTMLButtonElement).disabled = !editor.canRedo;
    ($('clear') as HTMLButtonElement).disabled = editor.empty;
    $('draw-box').classList.toggle('big', bigCanvas);
  }
  show('guess-box', guessing);

  currentPrimary = setAction('primary', primary);
  currentSecondary = setAction('secondary', secondary);
  currentTertiary = setAction('tertiary', tertiary);
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
    const b = el('button', { type: 'button', className: 'small', textContent: label, disabled: gate.busy });
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
      add('The host sent the awards but they are not showing?', 'Ask for the awards', () => onAsk(0));
    }
    if (relayOffer && relayOffer.gameId === g.gameId && canRelay(state, relayOffer.step)) {
      relay = true;
      const author = who(g, relayOffer.step);
      $('relay-text').textContent = `Someone asked for hop ${relayOffer.step}. ${author}'s phone should answer by itself in a moment.`;
      $('relay').textContent = `Send it for them (only if ${author} doesn't answer)`;
      ($('relay') as HTMLButtonElement).disabled = gate.busy;
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

  // Awards
  show('results-box', all);
  if (all) {
    if (g.results) {
      $('awards-text').textContent = awardsSummary(g);
      show('results-form', false);
    } else if (host) {
      $('awards-text').textContent = 'Time for the awards! Each one is worth 1 point.';
      show('results-form', true);
      const o = awardOptions(g);
      if (formFor !== g.gameId) {
        formFor = g.gameId;
        fillSelect($('aw-funniest') as HTMLSelectElement, o.funniest, g);
        fillSelect($('aw-recognizable') as HTMLSelectElement, o.recognizable, g);
        fillSelect($('aw-recovery') as HTMLSelectElement, o.recovery, g);
        ($('aw-final') as HTMLSelectElement).value = String(roomFor === g.gameId ? roomGuess : 0);
      }
      show('aw-recovery-box', o.recovery.length > 0);
      show('aw-final-box', o.finalGuess);
      ($('send-results') as HTMLButtonElement).disabled = gate.busy;
    } else {
      $('awards-text').textContent = 'Vote out loud for the awards! The host records the winners and chirps them to every phone. Keep listening.';
      show('results-form', false);
    }
  }

  // Scores
  show('scores-box', all);
  if (all) {
    $('scores-title').textContent = g.results ? 'Scores this round' : 'Scores so far (awards still to come)';
    $('scores').replaceChildren(
      ...scores(g).map((s) => {
        const li = el('li');
        const left = el('span');
        left.append(`${s.name} · seat ${s.seat}`);
        if (s.notes.length) left.append(el('span', { className: 'notes', textContent: s.notes.join(' · ') }));
        li.append(left, el('span', { className: 'pts', textContent: `${s.points} pt${s.points === 1 ? '' : 's'}` }));
        return li;
      }),
    );
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
    $('standings').replaceChildren(
      ...m.standings.map((s) => {
        const li = el('li');
        li.append(el('span', { textContent: `${s.name} · seat ${s.seat}` }), el('span', { className: 'pts', textContent: `${s.points} pt${s.points === 1 ? '' : 's'}` }));
        return li;
      }),
    );
  }
  show('final-box', all && over);
  if (all && over) {
    const m = matchStandings(state).standings;
    const top = m.length ? m[0].points : 0;
    const winners = m.filter((s) => s.points === top).map((s) => s.name);
    $('final-text').textContent =
      winners.length === 1
        ? `🏆 ${winners[0]} wins the Party Match with ${top} point${top === 1 ? '' : 's'}!`
        : `🏆 It's a tie! ${winners.join(' and ')} share the win with ${top} point${top === 1 ? '' : 's'} each.`;
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
  if (g.mode === 'match' && !over) {
    if (host) {
      label = `▶ Start round ${g.round + 1} of ${MATCH_ROUNDS}`;
      disabled = !g.results;
      note = g.results ? 'Players join automatically. The first drawer moves one seat.' : 'Send the awards first, so every phone has the same scores.';
      againRun = onNextRound;
    } else {
      note = `Stay on this screen and keep listening. You join round ${g.round + 1} automatically when the host starts it.`;
    }
  } else if (over) {
    label = host ? '☎️ Start a new game' : '📻 Ready for a new game';
    note = host ? 'Ask everyone to press "Ready for a new game" first.' : 'The host starts the next game. Your device joins automatically.';
    againRun = () => onAgain(true);
  } else {
    label = host ? '☎️ Host another round' : '📻 Ready for the next round';
    note = host ? 'Players on this screen join your next round automatically.' : 'You also join automatically if the host starts while you are on this screen.';
    againRun = () => onAgain(false);
  }
  again.hidden = !againRun;
  again.textContent = label;
  again.disabled = disabled || gate.busy;
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
 * Play the chirp, then commit. Nothing is committed if playback fails. The
 * dial-up handshake only plays before a fresh start signal (R4.1).
 */
async function playOut(out: { state: State; bytes: Uint8Array }, label: string, after: string, opts: { resend?: boolean } = {}): Promise<boolean> {
  if (gate.busy) return false;
  let audio;
  try {
    audio = await ensureAudio();
  } catch (err) {
    audioFailed(err);
    return false;
  }
  await effectsDone();
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
  setStatus(`🔊 Playing ${label}… keep the room quiet.`);
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
    const why = res.reason === 'failed' && res.error instanceof Error ? res.error.message : 'unknown error';
    setAudio('off');
    setStatus(`The chirp couldn't play (${why}). This is a sound problem, not static. Nothing changed: press the button again to retry.`, 'error');
    return false;
  }
  setStatus(`Played ${label}. ${after}`);
  await startListening(false);
  return true;
}

async function send(out: Outgoing | null, label: string, after: string, opts: { resend?: boolean } = {}): Promise<boolean> {
  return out ? playOut(out, label, after, opts) : false;
}

// ---------------------------------------------------------------- receiving

function eventMessage(e: ReceiveEvent): [string, Tone, Effect[]] | null {
  const g = state.game;
  switch (e.type) {
    case 'joined': {
      const what = e.mode === 'match' ? `round ${e.round} of ${MATCH_ROUNDS} of a Party Match` : 'a Quick Round';
      return [`Connected! ${e.host} started ${what} for ${e.players} players on a ${NOISE_INFO[e.noise].name.toLowerCase()} line. You are seat ${e.seat}.`, 'ok', ['arrive']];
    }
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
    case 'results':
      return ['Awards are in! Scores updated on this phone.', 'ok', ['success']];
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
  setStatus(step === 0 ? 'Someone missed the reveal. This phone sends it again in a moment…' : 'Someone missed your turn. This phone plays it again in a moment…');
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
    const label = p.type === 'entry' ? 'your turn again' : p.type === 'reveal' ? 'the reveal again' : 'the awards again';
    if (!(await playOut(outgoingFor(state, p), label, 'Listening…', { resend: true }))) return;
  }
}

function onDecoded(bytes: Uint8Array) {
  window.clearTimeout(hintTimer);
  metrics['last rx hex'] = hex(bytes);
  const result = decodePacket(bytes);
  if (!result.ok) {
    metrics['last rx error'] = result.error;
    setStatus("Heard a chirp but couldn't read it (a sound problem, not static). Nothing changed. Tap Ask for it by sound if you're waiting.", 'error');
    return;
  }
  const p = result.packet;
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
    ($('guess') as HTMLInputElement).value = '';
  }
  if (next !== state) commit(next);
  if (event.type === 'need') {
    if (!scheduleAnswer(event.step)) {
      if (canRelay(state, event.step)) {
        relayOffer = { gameId: p.gameId, step: event.step };
        setStatus(`Someone asked for hop ${event.step}. ${who(state.game!, event.step)}'s phone should answer by itself.`);
      } else {
        setStatus('Someone asked for a missed hop. Their phone is waiting for the answer.');
      }
    }
    render();
    return;
  }
  const m = eventMessage(event);
  if (m) {
    setStatus(m[0], m[1]);
    playFx(m[2]);
  }
  render();
}

// ---------------------------------------------------------------- actions

function resetRoundUi() {
  stopShow();
  revealShown = 1;
  relayOffer = null;
  draftFor = '';
  ($('guess') as HTMLInputElement).value = '';
}

async function onStart() {
  const out = startGame(state, { players: hostPlayers, gameId: randomU16(), now: Date.now(), noise: hostNoise, mode: hostMode, category: hostCategory });
  resetRoundUi();
  await send(out, 'the start signal', 'Players who were ready have joined. Now pick your word and draw it!');
}

async function onNextRound() {
  const out = nextRound(state, randomU16(), Date.now());
  if (!out) return;
  resetRoundUi();
  const g = out.state.game!;
  const first = seatOfStep(g, 1);
  await send(out, `the start of round ${g.round}`, first === 1 ? 'You draw first this round.' : `Seat ${first} draws first this round.`);
}

/** "Played" is not "received": the next player's turn confirms it (R4.4). */
function afterEntryText(g: Game): string {
  const me = myStep(g);
  return me >= g.players ? 'That was the last hop. Keep it secret until the reveal!' : `It's confirmed when ${who(g, me + 1)}'s turn is heard. Keep it secret!`;
}

async function onSendDrawing() {
  if (!editor || !state.game) return;
  const out = sendEntry(state, { drawing: editor.grid.map((r) => [...r]) });
  if (out) await playOut(out, 'your drawing', afterEntryText(state.game));
}

async function onSendGuess() {
  if (!state.game) return;
  const out = sendEntry(state, { text: ($('guess') as HTMLInputElement).value });
  if (!out) return;
  if (await playOut(out, 'your guess', afterEntryText(state.game))) ($('guess') as HTMLInputElement).value = '';
}

async function onReveal(force: boolean) {
  stopShow();
  revealShown = 1;
  await send(revealGame(state, Date.now(), force), 'the reveal', 'Every phone that heard it now shows the chain.');
}

async function onAsk(step: number) {
  const g = state.game;
  if (!g) return;
  const after = step === 0 ? "The host's phone answers in a moment." : `${who(g, step)}'s phone answers in a moment, if it already played that hop.`;
  await send(askFor(state, step), step === 0 ? 'a request for the reveal' : `a request for hop ${step}`, after, { resend: true });
}

async function onRelay() {
  const offer = relayOffer;
  if (!offer) return;
  relayOffer = null;
  await send(resendEntry(state, offer.step), `hop ${offer.step} for the room`, 'Listening…', { resend: true });
}

async function onResendEntry(step: number) {
  await send(resendEntry(state, step), 'your turn again', 'Listening…', { resend: true });
}

async function onResend() {
  const bytes = resendBytes(state);
  if (bytes) await playOut({ state, bytes }, 'the same chirp again', 'Listening…', { resend: true });
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
$('choose-host').addEventListener('click', () => {
  commit(setProfile(state, { mode: 'host', seat: 1 }));
  setStatus('Choose the game, the players, the line, and a prompt category. Then start.');
});
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
    setStatus(`You are seat ${chosenSeat}. Waiting for the host to start.`);
    await startListening(false);
  }),
);
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

// Drawing tools
$('tool-pen').addEventListener('click', () => editor?.setTool('pen'));
$('tool-eraser').addEventListener('click', () => editor?.setTool('eraser'));
$('brush-small').addEventListener('click', () => editor?.setBrush('small'));
$('brush-large').addEventListener('click', () => editor?.setBrush('large'));
$('undo').addEventListener('click', () => editor?.undo());
$('redo').addEventListener('click', () => editor?.redo());
$('clear').addEventListener('click', () => editor?.clear());
$('bigger').addEventListener('click', () => {
  bigCanvas = !bigCanvas;
  render();
  $('editor').scrollIntoView({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' });
});

$('guess').addEventListener('input', () => render());
$('guess').addEventListener('keydown', (e) => {
  if ((e as KeyboardEvent).key === 'Enter') guard(() => currentPrimary?.())();
});
$('primary').addEventListener('click', guard(() => currentPrimary?.()));
$('secondary').addEventListener('click', guard(() => currentSecondary?.()));
$('tertiary').addEventListener('click', guard(() => currentTertiary?.()));
$('resend-start').addEventListener('click', guard(() => send(resendStart(state), 'the start signal again', 'Late players who are ready can join now.', { resend: true })));
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
    guard(() =>
      send(sendResults(state, { funniest: v('aw-funniest'), recognizable: v('aw-recognizable'), recovery: v('aw-recovery'), final }), 'the awards', 'Every phone that hears it shows the same scores.'),
    )();
  },
);
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
  state = initialState();
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
registerServiceWorker();
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
} else {
  setStatus('Enter your name, then host or join a game.');
}
if (!window.isSecureContext) setStatus(MIC_ERROR_TEXT.insecure, 'error');
render();
