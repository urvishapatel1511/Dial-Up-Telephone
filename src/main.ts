import './style.css';
import { Listener, MIC_ERROR_TEXT, micErrorOf } from './audio/listener';
import { Modem } from './audio/modem';
import { play } from './audio/player';
import { playEffects, type Effect } from './audio/sfx';
import { Visualizer } from './audio/visualizer';
import type { GgwaveFactory } from './audio/ggwave-types';
import type { HouseOutcome } from './game/house';
import type { OtherOutcome } from './game/other';
import { hatPuzzle, lockPuzzle, LOCK_HINTS, personalityOf, ruleText, type Personality } from './game/puzzles';
import { PERSONALITY_INFO, reaction, type Moment } from './game/reactions';
import {
  describeRune,
  emptyRune,
  KEY_INFO,
  KEYS,
  mirrorRune,
  OBJECT_INFO,
  OBJECTS,
  OBSTACLES,
  RUNES,
  SPOT_INFO,
  SPOTS,
  type GameObject,
  type KeySymbol,
  type Rune4,
  type Spot,
} from './game/rules';
import { isOfflineReady, prepareOffline, registerServiceWorker } from './offline/offline';
import { emptyGrid, type Grid } from './protocol/drawing';
import { decodeMessage, describeBytes, HEADER_LEN, normalizeName } from './protocol/message';
import { SendGate } from './state/sender';
import {
  addAirtime,
  houseSend,
  houseStart,
  inProgress,
  loadState,
  newGame,
  otherSend,
  receive,
  resendBytes,
  saveState,
  storageKey,
  type GameState,
  type Outgoing,
  type ReceiveEvent,
  type Role,
} from './state/transfers';
import { renderCandles, renderGhost } from './ui/ghost';
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
interface Task {
  step: string;
  title: string;
  text: string;
  wait?: string;
  show: string[];
  primary?: Action;
  secondary?: Action;
  hints?: string[];
  hintKey?: string;
}

const ROLE_KEY = 'ghostfreq:role'; // sessionStorage only: a new window never inherits a role (R3.1)
const FX_KEY = 'ghostfreq:effects';
const NO_SIGNAL_HINT_MS = 25_000;
const AUDIO_TIMEOUT_MS = 10_000;

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const show = (id: string, visible: boolean) => ($(id).hidden = !visible);

const randomU16 = () => crypto.getRandomValues(new Uint16Array(1))[0];
const randomU8 = () => crypto.getRandomValues(new Uint8Array(1))[0];
const random01 = () => crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32;
const nameInput = $<HTMLInputElement>('name');

// ---------------------------------------------------------------- state
localStorage.removeItem(ROLE_KEY); // older versions stored the role per device
let role: Role | null = (() => {
  const r = sessionStorage.getItem(ROLE_KEY);
  return r === 'house' || r === 'other' ? r : null;
})();
let state: GameState | null = null;

// UI-only state (never needed by the other device)
let draft: Grid = emptyGrid();
let runeDraft: Rune4 = emptyRune();
let chosenObject: GameObject | null = null;
let chosenKey: KeySymbol | null = null;
let chosenSpot: Spot | null = null;
let pendingPartner: number | null = null;
let materializeNext = false;
let reactionText: string | null = null;
let hintKey = '';
let hintLevel = 0;
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

function commit(next: GameState) {
  state = next;
  saveState(localStorage, state);
  render();
}

const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(' ');
const clock = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const hasInk = (g: boolean[][]) => g.some((r) => r.some(Boolean));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  return Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error(message)), ms))]);
}

interface GhostView {
  ghostId: number;
  name: string;
  grid: Grid;
  energy: number;
  hat: boolean;
  personality: Personality;
}

/** The ghost this device is showing, if any. */
function currentGhost(): GhostView | null {
  if (!state) return null;
  if (state.house && state.house.phase !== 'summon') {
    const h = state.house;
    return { ghostId: h.ghostId, name: h.name, grid: h.grid, energy: h.energy, hat: h.bonus === 'won', personality: personalityOf(h.ghostId) };
  }
  const o = state.other;
  const g = o?.ghost ?? o?.candidate;
  if (o && g) {
    return { ...g, energy: o.ghost ? o.energy : 3, hat: o.bonus === 'won' && o.phase === 'over', personality: personalityOf(g.ghostId) };
  }
  return null;
}

function waitingForReply(): boolean {
  if (!state) return false;
  if (state.house) return state.house.phase === 'away';
  const o = state.other;
  return !!o && (o.phase === 'waiting' || o.phase === 'sent' || (o.phase === 'over' && o.ended === 'free' && o.bonus === null));
}

function choiceButtons<T extends string>(
  host: HTMLElement,
  options: readonly T[],
  selected: T | null,
  view: (o: T) => { icon: string | Node; name: string; meta?: HTMLElement[]; label: string },
  onPick: (o: T) => void,
  disabled: boolean,
) {
  const hadFocus = host.contains(document.activeElement);
  host.replaceChildren(
    ...options.map((o) => {
      const v = view(o);
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(selected === o));
      b.setAttribute('aria-label', v.label);
      b.disabled = disabled;
      const big = document.createElement('span');
      big.className = 'big';
      if (typeof v.icon === 'string') big.textContent = v.icon;
      else big.append(v.icon);
      big.setAttribute('aria-hidden', 'true');
      const txt = document.createElement('span');
      txt.textContent = v.name;
      txt.setAttribute('aria-hidden', 'true');
      b.append(big, txt, ...(v.meta ?? []));
      b.addEventListener('click', () => {
        onPick(o);
        render();
      });
      return b;
    }),
  );
  if (hadFocus) host.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
}

/** Code-drawn hand mirror: the 🪞 emoji is missing from older Windows emoji fonts. */
function mirrorIcon(): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 32 40');
  svg.setAttribute('width', '32');
  svg.setAttribute('height', '40');
  svg.setAttribute('aria-hidden', 'true');
  const parts: [string, Record<string, string>][] = [
    ['rect', { x: '14', y: '26', width: '4', height: '12', rx: '2', fill: '#c9a24a' }],
    ['ellipse', { cx: '16', cy: '15', rx: '12', ry: '14', fill: '#c9a24a' }],
    ['ellipse', { cx: '16', cy: '15', rx: '9', ry: '11', fill: '#bfe8ff' }],
    ['path', { d: 'M10 10 Q13 6 17 7', stroke: '#fff', 'stroke-width': '2', fill: 'none', 'stroke-linecap': 'round' }],
  ];
  for (const [tag, attrs] of parts) {
    const el = document.createElementNS(ns, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    svg.appendChild(el);
  }
  return svg;
}

function span(text: string, className: string): HTMLElement {
  const s = document.createElement('span');
  s.className = className;
  s.textContent = text;
  s.setAttribute('aria-hidden', 'true');
  return s;
}

// ---------------------------------------------------------------- tasks (what to do now)

const OBSTACLE_HINTS_HOUSE = [
  'Each object does one thing: the lantern makes light, the bell makes a sound, the mirror shows a reflection.',
  'Ask what is stopping them: is it dark? Is something guarding the keys? Is something asleep?',
];
const OBSTACLE_HINTS_OTHER = ['Tell the House everything you see and hear. The creature or the sign is the clue.'];
const MIRROR_HINTS_HOUSE = [
  'Rows stay the same. Column 1 in the mirror is column 4 on the door, column 2 is column 3.',
  'Example: if they see a filled block at the top-left, paint the top-right.',
];
const MIRROR_HINTS_OTHER = [
  'Describe exactly what you see, row by row: "Row 1: filled, empty, empty, empty".',
  "Don't flip it yourself. The House flips left and right for you.",
];
const HAT_HINTS = ['Each of you has two spots. Only one spot is on both lists.'];

function houseTask(s: GameState): Task {
  const h = s.house;
  const typed = normalizeName(nameInput.value);
  const name = h?.name ?? typed ?? 'your ghost';
  if (!h || h.phase === 'summon') {
    const ready = !!typed && hasInk(draft);
    return {
      step: 'Prologue · Summon',
      title: 'Draw your ghost and give it a name',
      text: 'This ghost stays yours for the whole adventure. Check that the Other Side has chosen their role and pressed Listen, then summon it. Your drawing travels as a chirp.',
      show: [],
      primary: { label: ready ? `Summon ${name}` : 'Draw a ghost and name it first', disabled: !ready, run: onSummon },
    };
  }
  switch (h.phase) {
    case 'away': {
      const stage = h.inFlight;
      if (stage === 1) {
        return {
          step: 'Prologue · Summon',
          title: `${name} is calling the Other Side…`,
          text: 'The summon chirp has played. Waiting for the Other Side to press Accept.',
          wait: "If their screen didn't change, press Resend.",
          show: [],
        };
      }
      if (stage === 2 || stage === 3) {
        return {
          step: 'Step 2 of 3 · The lock',
          title: stage === 2 ? `${name} is carrying your object across` : `${name} went back for another key`,
          text:
            stage === 2
              ? 'If the object helps, the Other Side will find four keys. Meanwhile, look at your lock below and get ready to describe it.'
              : 'Describe your lock again: how many notches, and what the engraving says.',
          wait: 'Listening for the ghost to come home with a key.',
          show: ['h-lock', 'hint-box'],
          hints: LOCK_HINTS,
          hintKey: 'lock',
        };
      }
      if (stage === 4) {
        return {
          step: 'Step 3 of 3 · The lying mirror',
          title: `${name} is wearing your rune`,
          text: 'The Other Side is checking it against the true carving on their exit door.',
          wait: 'Listening for the verdict.',
          show: ['h-mirror'],
        };
      }
      return {
        step: 'Bonus · Rescue the hat',
        title: `${name} is searching…`,
        text: 'The Other Side will tell you what was there. No candles are at stake.',
        wait: 'Listening for the answer.',
        show: [],
      };
    }
    case 'object':
      return {
        step: 'Step 1 of 3 · The obstacle',
        title: h.tries.object ? "That didn't help. Try another object" : 'Something blocks the Other Side',
        text: 'Ask the Other Side what they see in their haunted room. Then choose ONE object for your ghost to carry across.',
        show: ['h-objects', 'hint-box'],
        hints: OBSTACLE_HINTS_HOUSE,
        hintKey: 'obstacle',
        primary: {
          label: chosenObject ? `Send ${name} with the ${OBJECT_INFO[chosenObject].name}` : 'Choose an object first',
          disabled: !chosenObject,
          run: () => send(houseSend(state!, { object: chosenObject! }, Date.now()), `${name} with the ${OBJECT_INFO[chosenObject!].name}`),
        },
      };
    case 'key-retry':
      return {
        step: 'Step 2 of 3 · The lock',
        title: "The key didn't fit",
        text: `Describe your lock again without showing your screen. Then send ${name} back for another key.`,
        show: ['h-lock', 'hint-box'],
        hints: LOCK_HINTS,
        hintKey: 'lock',
        primary: { label: `Send ${name} back for another key`, run: () => send(houseSend(state!, {}, Date.now()), `${name} back for another key`) },
      };
    case 'rune':
      return {
        step: 'Step 3 of 3 · The lying mirror',
        title: h.tries.rune ? "The rune didn't match. Repaint it" : 'The lock opens! One seal left',
        text: 'Ask the Other Side to describe, row by row, the rune they see in their mirror. Paint the true rune here.',
        show: ['h-mirror', 'hint-box'],
        hints: MIRROR_HINTS_HOUSE,
        hintKey: 'mirror',
        primary: {
          label: hasInk(runeDraft) ? `Send ${name} wearing the rune` : 'Paint the rune first',
          disabled: !hasInk(runeDraft),
          run: () => send(houseSend(state!, { rune: runeDraft.map((r) => [...r]) }, Date.now()), `${name} wearing the rune`),
        },
      };
    case 'bonus':
      return {
        step: 'Bonus · Rescue the hat',
        title: `The exit is open… but ${name}'s tiny hat is still inside. Rescue it?`,
        text: `You get one try, and no candles are at stake. ${name} is already free either way. Or skip and leave together right now.`,
        show: ['bonus', 'h-spots', 'hint-box'],
        hints: HAT_HINTS,
        hintKey: 'hat',
        primary: {
          label: chosenSpot ? `Look in the ${SPOT_INFO[chosenSpot].name}` : 'Choose where to look',
          disabled: !chosenSpot,
          run: () => send(houseSend(state!, { spot: chosenSpot! }, Date.now()), `${name} to the ${SPOT_INFO[chosenSpot!].name}`),
        },
        secondary: { label: 'Skip: leave without the hat', run: () => send(houseSend(state!, { skip: true }, Date.now()), 'goodbye') },
      };
    default:
      return { step: '', title: '', text: '', show: [] };
  }
}

function otherTask(s: GameState): Task {
  const o = s.other!;
  const name = o.ghost?.name ?? o.candidate?.name ?? 'The ghost';
  const room = ['o-room'];
  switch (o.phase) {
    case 'waiting':
      return {
        step: 'Prologue · Your haunted room',
        title: 'Something is blocking your room',
        text: 'Describe your room to the House player out loud. Keep listening: their ghost will call you soon.',
        wait: 'Listening for a summon from the House.',
        show: [...room, 'hint-box'],
        hints: OBSTACLE_HINTS_OTHER,
        hintKey: 'obstacle-o',
      };
    case 'calling':
      return {
        step: 'Prologue · Summon',
        title: `${name} is calling from the House!`,
        text: 'Accept to welcome this ghost into your room. Your device stays paired with it until you choose Play again.',
        show: room,
        primary: {
          label: `Accept ${name}`,
          run: () => {
            pendingPartner ??= 1 + Math.floor(random01() * 15);
            return send(otherSend(state!, { partner: pendingPartner }, Date.now()), `a welcome to ${name}`);
          },
        },
      };
    case 'sent': {
      const st = o.stage;
      if (st === 1) {
        return {
          step: 'Step 1 of 3 · The obstacle',
          title: 'Welcome chirp played',
          text: `Now tell the House what blocks your room. They will send ${name} carrying something that might help.`,
          wait: 'Listening for the House.',
          show: [...room, 'hint-box'],
          hints: OBSTACLE_HINTS_OTHER,
          hintKey: 'obstacle-o',
        };
      }
      if (st === 4) {
        return {
          step: 'Step 3 of 3 · The lying mirror',
          title: `${name} flew home to repaint the rune`,
          text: 'Describe the mirror image again, row by row.',
          wait: 'Listening for the House.',
          show: [...room, 'hint-box'],
          hints: MIRROR_HINTS_OTHER,
          hintKey: 'mirror-o',
        };
      }
      return {
        step: 'Step 2 of 3 · The lock',
        title: o.cleared ? `${name} is flying home with a key` : `${name} is flying home empty-handed`,
        text: o.cleared
          ? 'If the key fits, the House will paint the rune from your mirror. Get ready to describe the mirror image, row by row.'
          : 'Tell the House what blocks your room so they can choose something else.',
        wait: 'Listening for the House.',
        show: [...room, 'hint-box'],
        hints: o.cleared ? MIRROR_HINTS_OTHER : OBSTACLE_HINTS_OTHER,
        hintKey: o.cleared ? 'mirror-o' : 'obstacle-o',
      };
    }
    case 'blocked':
      return {
        step: 'Step 1 of 3 · The obstacle',
        title: "That doesn't help here…",
        text:
          o.energy > 0
            ? `${name} loses a candle. Tell the House what you need, then send ${name} home to fetch something else.`
            : `${name} is fading… Send it home one last time.`,
        show: [...room, 'hint-box'],
        hints: OBSTACLE_HINTS_OTHER,
        hintKey: 'obstacle-o',
        primary: { label: o.energy > 0 ? `Send ${name} home for something else` : 'Send the fading ghost home', run: () => send(otherSend(state!, {}, Date.now()), `${name} home`) },
      };
    case 'keys':
      return {
        step: 'Step 2 of 3 · The lock',
        title: o.stage === 3 ? "The key didn't fit. Choose another" : 'The way is clear! Four keys',
        text: 'Ask the House about their lock: how many notches, and what the engraving says. Then choose ONE key.',
        show: ['o-keys', 'hint-box', ...room],
        hints: LOCK_HINTS,
        hintKey: 'lock',
        primary: {
          label: chosenKey ? `Send ${name} home with the ${KEY_INFO[chosenKey].name} key` : 'Choose a key first',
          disabled: !chosenKey,
          run: () => send(otherSend(state!, { key: chosenKey! }, Date.now()), `${name} with the ${KEY_INFO[chosenKey!].name} key`),
        },
      };
    case 'rune-bad':
      return {
        step: 'Step 3 of 3 · The lying mirror',
        title: "The rune doesn't match",
        text: `${o.runeOff} blocks were wrong (1 is allowed). Describe the mirror again, row by row. The House must flip left and right.`,
        show: [...room, 'hint-box'],
        hints: MIRROR_HINTS_OTHER,
        hintKey: 'mirror-o',
        primary: { label: o.energy > 0 ? `Send ${name} home to repaint` : 'Send the fading ghost home', run: () => send(otherSend(state!, {}, Date.now()), `${name} home`) },
      };
    case 'freed':
      return {
        step: 'Step 3 of 3 · The lying mirror',
        title: 'The seal breaks!',
        text: `The painted rune matches the true carving. Send ${name} home, free!`,
        show: room,
        primary: { label: `Send ${name} home, free!`, run: () => send(otherSend(state!, {}, Date.now()), `the good news`) },
      };
    case 'hat-reply': {
      const won = o.bonus === 'won';
      const spot = o.hatGuess ? SPOT_INFO[o.hatGuess].name : 'that spot';
      return {
        step: 'Bonus · Rescue the hat',
        title: won ? 'The hat is found!' : 'No hat there…',
        text: won ? `The House looked in the ${spot}, and there it is!` : `The House looked in the ${spot}, but the hat isn't there. ${name} escapes without it.`,
        show: [],
        primary: { label: 'Send the news to the House', run: () => send(otherSend(state!, {}, Date.now()), 'the news') },
      };
    }
    default:
      return { step: '', title: '', text: '', show: [] };
  }
}

// ---------------------------------------------------------------- render

const TASK_WIDGETS = ['o-room', 'h-objects', 'h-lock', 'h-mirror', 'o-keys', 'bonus', 'h-spots', 'hint-box'];
let currentPrimary: Action | undefined;
let currentSecondary: Action | undefined;

function isEnded(): boolean {
  if (!state) return false;
  if (state.house) return state.house.phase === 'free' || state.house.phase === 'faded';
  return state.other?.phase === 'over';
}

function render() {
  const playing = role !== null && !!state;
  show('intro', !playing);
  show('statusbar', playing);
  show('game', playing && !isEnded());
  show('end', playing && isEnded());
  show('role-badge', playing);
  show('change-role', playing);
  $('role-badge').textContent = role === 'house' ? '🏚️ The House' : '🌫️ The Other Side';

  renderAudio();
  if (!state) return;
  const g = currentGhost();
  renderCandles($('candles'), g ? g.energy : null);
  ($('resend') as HTMLButtonElement).disabled = !state.lastSent || gate.busy;

  if (!isEnded()) {
    renderGhostPanel(g);
    renderTask(role === 'house' ? houseTask(state) : otherTask(state));
  } else {
    renderEnd(g);
  }
  renderDiagnostics();
}

function renderAudio() {
  const pill = $('audio-pill');
  const waiting = waitingForReply();
  const text: Record<AudioState, string> = {
    off: resumeNeeded ? 'Microphone off. Tap Resume listening to hear the other device.' : 'Microphone off',
    starting: 'Starting audio…',
    mic: 'Asking for the microphone… allow it in the browser prompt.',
    listening: waiting ? "● Listening, waiting for the other device's chirp" : '● Listening',
    playing: `🔊 Playing chirp… ${(playingMs / 1000).toFixed(1)} s`,
    error: `⚠ ${audioError}`,
  };
  pill.textContent = text[audioState];
  pill.className = `pill ${audioState === 'listening' ? 'listening' : audioState === 'playing' ? 'playing' : audioState === 'error' ? 'error' : audioState === 'off' ? '' : 'busy'}`;

  const listen = $<HTMLButtonElement>('listen');
  listen.disabled = audioState === 'starting' || audioState === 'mic' || audioState === 'playing';
  listen.textContent = audioState === 'listening' ? 'Stop listening' : resumeNeeded ? '🎙 Resume listening' : '🎙 Start listening';
  listen.classList.toggle('attention', audioState !== 'listening' && (resumeNeeded || (!!state && waiting)));
  show('audio-retry', audioState === 'error');
}

function renderGhostPanel(g: GhostView | null) {
  const houseDrawing = role === 'house' && (!state!.house || state!.house.phase === 'summon');
  show('h-create', houseDrawing);
  show('portrait', !houseDrawing && !!g);
  show('no-ghost', !houseDrawing && !g);
  if (g && !houseDrawing) {
    renderGhost($('ghost'), g.grid, {
      energy: g.energy,
      label: `${g.name}, the ghost drawn by the House player`,
      personality: g.personality,
      hat: g.hat,
      materialize: materializeNext,
      sending: audioState === 'playing',
    });
    materializeNext = false;
    $('ghost-name').textContent = g.name;
    const p = PERSONALITY_INFO[g.personality];
    $('ghost-tag').textContent = `${p.icon} ${p.label}`;
  }
  show('reaction', !!reactionText && !houseDrawing);
  $('reaction').textContent = reactionText ?? '';
  renderProgress();
}

function renderProgress() {
  const s = state!;
  const solved = s.house?.solved ?? s.other?.solved;
  const started = s.house ? s.house.phase !== 'summon' && s.house.partner > 0 : !!s.other?.ghost;
  const steps: [string, boolean][] = [
    ['👻 Summon', started],
    ['🕯️ Obstacle', !!solved?.obstacle],
    ['🗝️ Lock', !!solved?.lock],
    ['🔁 Mirror', !!solved?.rune],
  ];
  const firstOpen = steps.findIndex(([, done]) => !done);
  $('progress').replaceChildren(
    ...steps.map(([label, done], i) => {
      const li = document.createElement('li');
      li.textContent = label;
      li.className = done ? 'done' : i === firstOpen ? 'now' : '';
      li.setAttribute('aria-label', `${label.slice(3)}: ${done ? 'done' : i === firstOpen ? 'current' : 'not yet'}`);
      return li;
    }),
  );
}

function renderTask(t: Task) {
  $('t-step').textContent = t.step;
  $('t-title').textContent = t.title;
  $('t-text').textContent = t.text;
  show('t-wait', !!t.wait);
  $('t-wait').textContent = t.wait ?? '';
  for (const id of TASK_WIDGETS) show(id, t.show.includes(id));

  const busy = gate.busy;
  if (t.show.includes('o-room')) renderRoom();
  if (t.show.includes('h-objects')) {
    choiceButtons(
      $('h-objects'),
      OBJECTS,
      chosenObject,
      (o) => ({ icon: o === 'mirror' ? mirrorIcon() : OBJECT_INFO[o].icon, name: OBJECT_INFO[o].name, label: OBJECT_INFO[o].name }),
      (o) => (chosenObject = o),
      busy,
    );
  }
  if (t.show.includes('h-lock')) renderLock();
  if (t.show.includes('o-keys')) renderKeys(busy);
  if (t.show.includes('bonus')) renderBonusClue();
  if (t.show.includes('h-spots')) {
    choiceButtons($('h-spots'), SPOTS, chosenSpot, (s) => ({ icon: SPOT_INFO[s].icon, name: SPOT_INFO[s].name, label: SPOT_INFO[s].name }), (s) => (chosenSpot = s), busy);
  }

  // progressive hints: reset when the puzzle changes
  if (t.hintKey !== hintKey) {
    hintKey = t.hintKey ?? '';
    hintLevel = 0;
  }
  const hints = t.hints ?? [];
  $('hint-text').textContent = hints.slice(0, hintLevel).join(' ');
  const hintBtn = $<HTMLButtonElement>('hint-btn');
  hintBtn.hidden = hintLevel >= hints.length;
  hintBtn.textContent = hintLevel === 0 ? '💡 Need a hint?' : '💡 Another hint';

  currentPrimary = t.primary;
  currentSecondary = t.secondary;
  const p = $<HTMLButtonElement>('primary');
  p.hidden = !t.primary;
  p.textContent = t.primary?.label ?? '';
  p.disabled = !!t.primary?.disabled || busy;
  const sec = $<HTMLButtonElement>('secondary');
  sec.hidden = !t.secondary;
  sec.textContent = t.secondary?.label ?? '';
  sec.disabled = busy;
}

function renderRoom() {
  const o = state!.other!;
  const obstacle = OBSTACLES[o.room.obstacle];
  const art = $('o-art');
  art.className = `art o-${obstacle.id}${o.cleared ? ' cleared' : ''}`;
  art.querySelector('.obstacle-icon')!.textContent = obstacle.icon;
  $('o-scene').textContent = o.cleared ? obstacle.solved : `${obstacle.title}: ${obstacle.scene}`;
  const mirrored = mirrorRune(RUNES[o.room.rune].blocks);
  renderGrid($('o-mirror'), mirrored, { label: 'The exit rune as the lying mirror shows it, left and right swapped' });
  $('o-mirror-text').textContent = `Mirror image of the exit rune. ${describeRune(mirrored)}.`;
  $('o-seal').classList.toggle('broken', o.phase === 'freed' || o.ended === 'free');
}

function renderLock() {
  const p = lockPuzzle(state!.house!.ghostId);
  $('h-notches').textContent = '▼'.repeat(p.notches);
  const text = `${p.notches} ${p.notches === 1 ? 'notch' : 'notches'}. Engraving: ${ruleText(p)}`;
  $('h-lock-text').textContent = text;
  $('h-lock').setAttribute('aria-label', `Your lock: ${text}`);
}

function renderKeys(disabled: boolean) {
  const p = lockPuzzle(state!.other!.ghost!.ghostId);
  choiceButtons(
    $('o-keys'),
    KEYS,
    chosenKey,
    (k) => {
      const f = p.keys[k];
      return {
        icon: KEY_INFO[k].glyph,
        name: `${KEY_INFO[k].name} key`,
        meta: [span('▮'.repeat(f.teeth), 'teeth'), span(`${f.teeth} ${f.teeth === 1 ? 'tooth' : 'teeth'} · ${f.metal}`, `meta metal-${f.metal}`)],
        label: `${KEY_INFO[k].name} key, ${f.teeth} ${f.teeth === 1 ? 'tooth' : 'teeth'}, ${f.metal}`,
      };
    },
    (k) => (chosenKey = k),
    disabled,
  );
}

function renderBonusClue() {
  const h = state!.house!;
  const [a, b] = hatPuzzle(h.ghostId).houseClue;
  $('bonus-clue').textContent = `🎩 ${h.name} remembers dropping it near the ${SPOT_INFO[a].icon} ${SPOT_INFO[a].name} or the ${SPOT_INFO[b].icon} ${SPOT_INFO[b].name}. Ask the Other Side what they heard.`;
}

function renderEnd(g: GhostView | null) {
  const s = state!;
  const box = $('end');
  const facts: string[] = [];
  let title = '';
  let farewell = '';
  let note = 'To play again, the other player must also press Play again on their device. To swap, they must press Swap roles too. This device never changes the other device’s role.';
  let win = false;
  const endPrimary = $<HTMLButtonElement>('end-primary');
  endPrimary.hidden = true;
  const p = g?.personality ?? 'shy';
  const name = g?.name ?? 'The ghost';
  const solvedCount = (x: { obstacle: boolean; lock: boolean; rune: boolean }) => +x.obstacle + +x.lock + +x.rune;

  if (s.house) {
    const h = s.house;
    win = h.phase === 'free';
    title = win ? `${name} is free!` : `${name} faded away…`;
    farewell = reaction(p, win ? (h.bonus === 'won' ? 'hat' : 'farewell') : 'faded', name, h.ghostId);
    facts.push(`🕯️ ${h.energy} of 3 candles`, `🧩 ${solvedCount(h.solved)} of 3 puzzles`);
    if (win) facts.push(h.bonus === 'won' ? '🎩 Hat rescued' : h.bonus === 'lost' ? '🎩 Hat left behind' : '🎩 Bonus skipped');
    facts.push(`⏱️ ${clock((h.endedAt ?? Date.now()) - h.startedAt)}`);
    if (h.phase === 'faded' && !h.farewellSent) {
      endPrimary.hidden = false;
      endPrimary.textContent = 'Tell the Other Side';
      endPrimary.onclick = guard(() => send(houseSend(state!, {}, Date.now()), 'the sad news'));
      note = 'Only you know the key was wrong. Play one last chirp so the Other Side sees the ghost fade too.';
    }
  } else if (s.other) {
    const o = s.other;
    win = o.ended === 'free';
    if (win && o.bonus === null) {
      title = `${name} is free!`;
      farewell = reaction(p, 'rescued', name, o.ghost?.ghostId ?? 0);
      const [a, b] = hatPuzzle(o.ghost!.ghostId).otherClue;
      note = `The House may try to rescue ${name}'s tiny hat. Your clue: something small rustles near the ${SPOT_INFO[a].icon} ${SPOT_INFO[a].name} or the ${SPOT_INFO[b].icon} ${SPOT_INFO[b].name}. Tell the House, and keep listening.`;
    } else {
      title = win ? `${name} escaped!` : `${name} faded away…`;
      farewell = reaction(p, win ? (o.bonus === 'won' ? 'hat' : 'farewell') : 'faded', name, o.ghost?.ghostId ?? 0);
    }
    facts.push(`🕯️ ${Math.max(0, o.energy)} of 3 candles`, `🧩 ${solvedCount(o.solved)} of 3 puzzles`);
    if (win && o.bonus) facts.push(o.bonus === 'won' ? '🎩 Hat rescued' : o.bonus === 'lost' ? '🎩 Hat left behind' : '🎩 Bonus skipped');
    if (o.startedAt !== null && o.endedAt !== null) facts.push(`⏱️ ${clock(o.endedAt - o.startedAt)}`);
  }
  box.classList.toggle('win', win);
  box.classList.toggle('lose', !win);
  if (g) {
    renderGhost($('end-ghost'), g.grid, { energy: win ? 3 : 0, label: `${name}'s portrait`, personality: g.personality, hat: g.hat });
  }
  $('end-title').textContent = title;
  $('end-farewell').textContent = farewell;
  $('end-facts').replaceChildren(...facts.map((f) => Object.assign(document.createElement('li'), { textContent: f })));
  $('end-note').textContent = note;
  const st = s.stats;
  $('end-stats').textContent =
    `This device played ${st.chirpsSent} chirps (${st.bytesSent} bytes as ${(st.airtimeMs / 1000).toFixed(1)} s of sound) and heard ${st.chirpsHeard}. ` +
    'No Wi-Fi, no Bluetooth, no internet. Only sound.';
  $('swap').textContent = role === 'house' ? 'Swap roles (become the Other Side)' : 'Swap roles (become the House)';
}

function renderDiagnostics() {
  const rows: Record<string, string> = {
    role: role ?? '-',
    audio: audioState,
    'sample rate': ctx ? `${ctx.sampleRate} Hz` : 'audio not started',
    'secure context': String(window.isSecureContext),
    'audio engine': window.ggwave_factory ? 'ggwave loaded' : 'MISSING vendor/ggwave.js',
    'ghost id': String(currentGhost()?.ghostId ?? '-'),
    partner: String(state?.house?.partner ?? state?.other?.partner ?? '-'),
    'last sent': state?.lastSent?.key ?? '-',
    'seen / retired': `${state?.seen.length ?? 0} / ${state?.retired.length ?? 0}`,
    ...metrics,
  };
  $('diag').replaceChildren(
    ...Object.entries(rows).flatMap(([k, v]) => [
      Object.assign(document.createElement('dt'), { textContent: k }),
      Object.assign(document.createElement('dd'), { textContent: v }),
    ]),
  );
}

// ---------------------------------------------------------------- audio

function setAudio(s: AudioState, error = '') {
  audioState = s;
  audioError = error;
  render();
}

/** Must be called from a user gesture (iOS requires it to unlock audio). Times out instead of hanging (R4.2). */
async function ensureAudio(): Promise<{ ctx: AudioContext; modem: Modem; viz: Visualizer }> {
  if (!window.ggwave_factory) {
    throw new Error("The sound engine didn't load. Reload the page. If you're offline, prepare for offline play first while online.");
  }
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
  if (!listener) {
    listener = new Listener(audio.ctx, (samples) => {
      const bytes = modem?.decode(samples);
      if (bytes) onDecoded(bytes);
    }, audio.viz.input);
  }
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
    if (audioState === 'listening' && waitingForReply()) {
      setStatus("Nothing heard for a while. If the other device already played its chirp, move closer, turn its volume up, and press Resend there.");
    }
  }, NO_SIGNAL_HINT_MS);
  setAudio('listening');
  if (announce) setStatus('Listening. The other player can send now.', 'ok');
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

/** Wait until decorative effects have finished, so they never mix into a chirp (R4.9). */
async function effectsDone() {
  const left = fxUntil - performance.now();
  if (left > 0) await sleep(left + 150);
}

function playFx(list: Effect[]) {
  if (!fxOn || !ctx || gate.busy || list.length === 0) return;
  fxUntil = performance.now() + playEffects(ctx, list) * 1000;
}

/** Play bytes, then commit the new state. Nothing is committed if playback fails (R4.3). */
async function playOut(out: { state: GameState; bytes: Uint8Array }, label: string): Promise<boolean> {
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
  const samples = audio.modem.encode(out.bytes);
  const ms = audio.modem.durationMs(samples);
  playingMs = ms;
  metrics['last chirp'] = `${ms} ms, ${out.bytes.length} bytes`;
  metrics['last tx hex'] = hex(out.bytes);
  $('chirp-info').textContent = `Inside the last chirp: ${describeBytes(out.bytes.length - HEADER_LEN - 1)} → ${(ms / 1000).toFixed(1)} s of sound`;
  audio.viz.setMode('send');
  setAudio('playing');
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
    setStatus(`The chirp couldn't play (${why}). Nothing changed and no candle was lost. Press the button again to retry.`, 'error');
    return false;
  }
  setStatus(`Chirp played: ${label} (${(ms / 1000).toFixed(1)} s). Waiting for the other device to hear it. If its screen doesn't change, press Resend.`);
  await startListening(false);
  return true;
}

async function send(out: Outgoing | null, label: string) {
  if (!out) return;
  if (await playOut(out, label)) {
    pendingPartner = null;
  }
}

async function onResend() {
  const bytes = state && resendBytes(state);
  if (bytes) await playOut({ state: state!, bytes }, 'the same chirp again');
}

// ---------------------------------------------------------------- receiving

interface Reaction {
  text: string;
  tone: Tone;
  moment?: Moment;
  fx: Effect[];
}

function wrongMoment(energyAfter: number): Moment {
  return energyAfter === 1 ? 'lastCandle' : 'wrong';
}

function houseReaction(o: HouseOutcome, n: string, energy: number): Reaction | null {
  switch (o.kind) {
    case 'paired':
      return { text: `${n} reached the Other Side and was welcomed in! Now ask what blocks their room.`, tone: 'ok', moment: 'arrive', fx: ['arrive'] };
    case 'object-failed':
      return o.faded
        ? { text: `${n} came home and faded away… The spirit energy is gone.`, tone: 'error', moment: 'faded', fx: ['fade'] }
        : { text: `${n} came home empty-handed: the object didn't help, and a candle went out.`, tone: 'error', moment: wrongMoment(energy), fx: ['fail'] };
    case 'key-right':
      return { text: `${o.cleared ? 'Your object worked, and the' : 'The'} ${KEY_INFO[o.key].name} key fits! The lock clicks open.`, tone: 'ok', moment: 'solved', fx: ['creak', 'success'] };
    case 'key-wrong':
      return o.faded
        ? { text: `The ${KEY_INFO[o.key].name} key doesn't fit… and ${n} fades away. Tell the Other Side.`, tone: 'error', moment: 'faded', fx: ['fade'] }
        : { text: `${o.cleared ? 'Your object worked, but the' : 'The'} ${KEY_INFO[o.key].name} key doesn't fit. A candle goes out.`, tone: 'error', moment: wrongMoment(energy), fx: ['fail'] };
    case 'rune-failed':
      return o.faded
        ? { text: `The rune was wrong, and ${n} fades away…`, tone: 'error', moment: 'faded', fx: ['fade'] }
        : { text: "The rune didn't match the true carving. A candle goes out. Ask the Other Side to describe the mirror again.", tone: 'error', moment: wrongMoment(energy), fx: ['fail'] };
    case 'rescued':
      return { text: `The seal breaks! ${n} is free… but its tiny hat is still inside.`, tone: 'ok', moment: 'rescued', fx: ['creak', 'success'] };
    case 'hat':
      return o.won
        ? { text: `Found it! ${n}'s tiny hat is back where it belongs.`, tone: 'ok', moment: 'hat', fx: ['success'] }
        : { text: `No hat there. ${n} escapes without it, and that's okay.`, tone: 'info', moment: 'farewell', fx: [] };
    case 'ignored':
      return { text: "Heard a chirp that doesn't fit this moment. Nothing changed.", tone: 'info', fx: [] };
  }
}

function otherReaction(o: OtherOutcome, n: string, energy: number): Reaction | null {
  switch (o.kind) {
    case 'calling':
      return { text: `${n} is calling from the House! Press Accept to welcome it.`, tone: 'ok', moment: 'arrive', fx: ['arrive'] };
    case 'object-worked':
      return { text: `${n} crossed over with the ${OBJECT_INFO[o.object].name}… and it worked!`, tone: 'ok', moment: 'solved', fx: ['arrive', 'success'] };
    case 'object-failed':
      return {
        text: `${n} brought ${o.object ? `the ${OBJECT_INFO[o.object].name}` : 'nothing'}, but it doesn't help here. A candle goes out.`,
        tone: 'error',
        moment: o.faded ? 'faded' : wrongMoment(energy),
        fx: ['arrive', o.faded ? 'fade' : 'fail'],
      };
    case 'key-retry':
      return { text: `${n} is back: that key didn't fit, and a candle went out. Choose another.`, tone: 'error', moment: wrongMoment(energy), fx: ['arrive'] };
    case 'rune-worked':
      return { text: `${n} arrived wearing the true rune. The seal breaks!`, tone: 'ok', moment: 'rescued', fx: ['arrive', 'creak', 'success'] };
    case 'rune-failed':
      return { text: `${n}'s rune doesn't match: ${o.off} blocks are wrong. A candle goes out.`, tone: 'error', moment: o.faded ? 'faded' : wrongMoment(energy), fx: ['arrive', o.faded ? 'fade' : 'fail'] };
    case 'hat':
      return o.won
        ? { text: 'The House searched the right spot… the hat is found! Send the news.', tone: 'ok', moment: 'hat', fx: ['success'] }
        : { text: "The House searched, but the hat isn't there. Send the news.", tone: 'info', fx: [] };
    case 'farewell':
      return o.faded
        ? { text: `${n} faded away…`, tone: 'error', moment: 'faded', fx: ['fade'] }
        : { text: `The House chose to leave the hat behind. ${n} is free!`, tone: 'ok', moment: 'farewell', fx: ['success'] };
    case 'not-ours':
      return { text: 'Heard a ghost from another game nearby. Ignored.', tone: 'info', fx: [] };
    case 'ignored':
      return { text: "Heard a chirp that doesn't fit this moment. Nothing changed.", tone: 'info', fx: [] };
  }
}

function eventReaction(e: ReceiveEvent, energy: number): Reaction | null {
  const n = e.message.name;
  switch (e.type) {
    case 'house':
      return houseReaction(e.outcome, n, energy);
    case 'other':
      return otherReaction(e.outcome, n, energy);
    case 'not-ours':
      return { text: 'Heard a ghost from another game nearby. Ignored.', tone: 'info', fx: [] };
    case 'stale':
      return { text: 'Heard a chirp from a previous game. Ignored.', tone: 'info', fx: [] };
    case 'duplicate':
      return { text: 'Heard the same chirp again. Nothing changed.', tone: 'info', fx: [] };
    case 'own-echo':
      return null;
  }
}

function onDecoded(bytes: Uint8Array) {
  if (!state) return;
  window.clearTimeout(hintTimer);
  metrics['last rx hex'] = hex(bytes);
  const result = decodeMessage(bytes);
  if (!result.ok) {
    metrics['last rx error'] = result.error;
    setStatus('Heard a garbled chirp. Nothing changed and no candle was lost. Ask the other player to press Resend.', 'error');
    return;
  }
  const { state: next, event } = receive(state, result.message, Date.now());
  metrics['last rx event'] = event.type + ('outcome' in event ? `:${event.outcome.kind}` : '');
  $('chirp-info').textContent = `Inside the last chirp heard: ${describeBytes(result.message.name.length)}`;

  if (event.type === 'other') {
    const k = event.outcome.kind;
    if (k === 'calling' || k === 'object-worked' || k === 'object-failed') materializeNext = true;
    if (k === 'key-retry' || k === 'object-worked') chosenKey = null;
  }
  if (event.type === 'house') {
    const k = event.outcome.kind;
    if (k === 'object-failed') chosenObject = null;
    if (k === 'key-right') resetRuneEditor();
  }

  const energy = next.house?.energy ?? next.other?.energy ?? 3;
  const r = eventReaction(event, energy);
  if (next !== state) commit(next);
  if (r) {
    setStatus(r.text, r.tone);
    const g = currentGhost();
    if (r.moment && g) {
      const s = next.house?.tries ?? { object: 0, key: 0, rune: 0 };
      reactionText = reaction(g.personality, r.moment, g.name, g.ghostId + s.object + s.key + s.rune + energy);
    }
    playFx(r.fx);
  }
  render();
}

// ---------------------------------------------------------------- actions

async function onSummon() {
  const name = normalizeName(nameInput.value);
  if (!name || !hasInk(draft)) return;
  await send(houseStart(state!, draft.map((r) => [...r]), name, randomU16(), Date.now()), `${name}'s summon`);
}

function guard(fn: () => Promise<void> | void) {
  return () => {
    Promise.resolve()
      .then(fn)
      .catch((err: unknown) => {
        setStatus(err instanceof Error ? err.message : String(err), 'error');
        render();
      });
  };
}

function resetEditor() {
  draft = emptyGrid();
  renderGrid($('editor'), draft, {
    label: 'Ghost drawing, 8 by 8 squares',
    onChange: (g) => {
      draft = g;
      render();
    },
  });
}

function resetRuneEditor() {
  runeDraft = emptyRune();
  renderGrid($('rune-editor'), runeDraft, {
    label: 'True rune, 4 by 4 blocks',
    onChange: (g) => {
      runeDraft = g;
      render();
    },
  });
}

function resetChoices() {
  chosenObject = null;
  chosenKey = null;
  chosenSpot = null;
  pendingPartner = null;
  reactionText = null;
  hintKey = '';
  hintLevel = 0;
  materializeNext = false;
  resetEditor();
  resetRuneEditor();
}

function setRole(r: Role | null) {
  stopListening(false);
  role = r;
  resetChoices();
  if (r) {
    sessionStorage.setItem(ROLE_KEY, r);
    state = loadState(localStorage, r, randomU8(), random01);
    saveState(localStorage, state);
    const o = state.other;
    const hatPending = !!o && o.phase === 'over' && o.ended === 'free' && o.bonus === null;
    resumeNeeded = inProgress(state) || hatPending;
    if (resumeNeeded) setStatus('Welcome back. Your game was saved. Tap Resume listening so you can hear the other device.');
    else if (isEnded()) setStatus('This adventure is over. Press Play again for a new one, or Swap roles.');
    else if (r === 'house') setStatus('Draw your ghost. Ask the other player to choose The Other Side on their device.');
    else setStatus('Tap Start listening, then describe your room to the House player.');
  } else {
    sessionStorage.removeItem(ROLE_KEY);
    state = null;
    resumeNeeded = false;
    setStatus('Choose your role on this device.');
  }
  render();
}

function playAgain(): void {
  if (!state) return;
  commit(newGame(state, random01));
  resetChoices();
  resumeNeeded = false;
  setStatus(
    role === 'house'
      ? 'New game. Draw a new ghost. Ask the other player to press Play again on their device too.'
      : 'New haunted room. Ask the House to press Play again, and tap Start listening.',
  );
  render();
}

function swapRoles(): void {
  if (!state || !role) return;
  commit(newGame(state, random01));
  const next: Role = role === 'house' ? 'other' : 'house';
  setRole(next);
  commit(newGame(state!, random01));
  resumeNeeded = false;
  setStatus(`You are now ${next === 'house' ? 'the House' : 'the Other Side'}. Ask the other player to press Swap roles on their device too.`);
  render();
}

// ---------------------------------------------------------------- wiring

$('role-house').addEventListener('click', () => setRole('house'));
$('role-other').addEventListener('click', () => setRole('other'));
$('change-role').addEventListener('click', () => {
  if (state && inProgress(state) && !confirm('Your game in this role stays saved on this device. Change role?')) return;
  setRole(null);
});
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
$('clear').addEventListener('click', () => {
  resetEditor();
  render();
});
$('rune-clear').addEventListener('click', () => {
  resetRuneEditor();
  render();
});
nameInput.addEventListener('input', () => render());
$('primary').addEventListener('click', guard(() => currentPrimary?.run()));
$('secondary').addEventListener('click', guard(() => currentSecondary?.run()));
$('hint-btn').addEventListener('click', () => {
  hintLevel++;
  render();
});
$('resend').addEventListener('click', guard(onResend));
$('listen').addEventListener('click', guard(() => (audioState === 'listening' ? stopListening() : startListening())));
$('audio-retry').addEventListener('click', guard(() => startListening()));
$('play-again').addEventListener('click', playAgain);
$('swap').addEventListener('click', swapRoles);
$('reset').addEventListener('click', () => {
  if (!role || !confirm('Forget the game in this role on this device?')) return;
  stopListening(false);
  localStorage.removeItem(storageKey(role));
  setRole(role);
  setStatus('This role was reset on this device.');
});
// Release the microphone when the page is hidden; offer Resume listening when it comes back (R4.6).
document.addEventListener('visibilitychange', () => {
  if (document.hidden && listener?.active) {
    stopListening(false);
    resumeNeeded = true;
    render();
  } else if (!document.hidden && resumeNeeded) {
    setStatus('Welcome back. Tap Resume listening so you can hear the other device.');
  }
});

// ---------------------------------------------------------------- offline

const READY_TEXT = '✓ Ready for offline play. You can turn off Wi-Fi and Bluetooth.';
function setOffline(kind: 'ready' | 'failed' | 'idle', text: string) {
  document.querySelectorAll<HTMLElement>('.offline').forEach((el) => (el.className = `offline ${kind === 'idle' ? '' : kind}`));
  document.querySelectorAll<HTMLElement>('.offline-state').forEach((el) => (el.textContent = text));
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

resetEditor();
resetRuneEditor();
setRole(role);
if (!window.isSecureContext) setStatus(MIC_ERROR_TEXT.insecure, 'error');
