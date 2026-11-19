import './style.css';
import { Listener, MIC_ERROR_TEXT, micErrorOf } from './audio/listener';
import { Modem } from './audio/modem';
import { play } from './audio/player';
import * as sfx from './audio/sfx';
import { Visualizer } from './audio/visualizer';
import type { GgwaveFactory } from './audio/ggwave-types';
import type { HouseOutcome } from './game/house';
import type { OtherOutcome } from './game/other';
import {
  emptyRune,
  KEY_INFO,
  KEYS,
  OBJECT_INFO,
  OBJECTS,
  OBSTACLES,
  RUNES,
  type GameObject,
  type KeySymbol,
  type Rune4,
} from './game/rules';
import { emptyGrid, type Grid } from './protocol/drawing';
import { decodeMessage, describeBytes, HEADER_LEN, normalizeName } from './protocol/message';
import {
  addAirtime,
  houseSend,
  houseStart,
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
import { isOfflineReady, prepareOffline, registerServiceWorker } from './offline/offline';
import { renderCandles, renderGhost } from './ui/ghost';
import { renderGrid } from './ui/grid';

declare global {
  interface Window {
    ggwave_factory?: GgwaveFactory;
  }
}

type Tone = 'info' | 'ok' | 'error';
const ROLE_KEY = 'ghostfreq:role';
const NO_SIGNAL_HINT_MS = 25_000;

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const show = (id: string, visible: boolean) => ($(id).hidden = !visible);

const randomU8 = () => crypto.getRandomValues(new Uint8Array(1))[0];
const randomU16 = () => crypto.getRandomValues(new Uint16Array(1))[0];
const random01 = () => crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32;

// Role is per tab first (so two windows on one laptop can play), then per device.
let role: Role | null = (() => {
  const r = sessionStorage.getItem(ROLE_KEY) ?? localStorage.getItem(ROLE_KEY);
  return r === 'house' || r === 'other' ? r : null;
})();
let state: GameState | null = role ? loadState(localStorage, role, randomU8(), random01) : null;

// UI-only state
let draft: Grid = emptyGrid();
let runeDraft: Rune4 = emptyRune();
let chosenObject: GameObject | null = null;
let chosenKey: KeySymbol | null = null;
let materializeNext = false;

// Audio
let ctx: AudioContext | null = null;
let modem: Modem | null = null;
let listener: Listener | null = null;
let viz: Visualizer | null = null;
let sending = false;
let hintTimer: number | undefined;
const metrics: Record<string, string> = {};

// ================================================================ helpers

function setStatus(text: string, tone: Tone = 'info') {
  $('status').textContent = text;
  $('status').className = `status ${tone === 'info' ? '' : tone}`;
}

function setHint(text: string | null) {
  show('hint', !!text);
  $('hint').textContent = text ?? '';
}

function commit(next: GameState) {
  state = next;
  saveState(localStorage, state);
  render();
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(' ');
}

function clock(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function choiceButtons<T extends string>(
  host: HTMLElement,
  options: readonly T[],
  selected: T | null,
  label: (o: T) => [string, string],
  onPick: (o: T) => void,
  disabled = false,
) {
  const hadFocus = host.contains(document.activeElement);
  host.replaceChildren(
    ...options.map((o) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(selected === o));
      b.disabled = disabled;
      const [icon, name] = label(o);
      const big = document.createElement('span');
      big.className = 'big';
      big.textContent = icon;
      big.setAttribute('aria-hidden', 'true');
      const txt = document.createElement('span');
      txt.textContent = name;
      b.append(big, txt);
      b.addEventListener('click', () => {
        onPick(o);
        render();
      });
      return b;
    }),
  );
  // Rebuilding the buttons drops focus; give it back for keyboard users.
  if (hadFocus) host.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
}

// ================================================================ render

function render() {
  show('intro', role === null);
  show('house', role === 'house' && !houseEnded());
  show('other', role === 'other' && state?.other?.phase !== 'over');
  show('end', isEnded());
  show('sound', role !== null);
  if (!state) {
    renderCandles($('candles'), null);
    setMic();
    return;
  }
  if (role === 'house') renderHouse();
  if (role === 'other') renderOther();
  if (isEnded()) renderEnd();

  const energy = state.house ? state.house.energy : state.other?.ghost ? state.other.energy : null;
  renderCandles($('candles'), energy);
  ($('resend') as HTMLButtonElement).disabled = !state.lastSent || sending;
  ($('listen') as HTMLButtonElement).disabled = sending;
  setMic();
  renderDiagnostics();
}

function houseEnded() {
  const p = state?.house?.phase;
  return p === 'free' || p === 'faded';
}

function isEnded() {
  return (role === 'house' && houseEnded()) || (role === 'other' && state?.other?.phase === 'over');
}

function setMic() {
  const on = !!listener?.active;
  $('mic-state').textContent = on ? '● Listening' : 'Microphone off';
  $('mic-state').classList.toggle('on', on);
  $('listen').textContent = on ? 'Stop listening' : '🎙 Listen';
}

function renderHouse() {
  const h = state!.house;
  const phase = h?.phase ?? 'object';
  const name = h?.name ?? (normalizeName(($('name') as HTMLInputElement).value) || 'your ghost');
  show('h-create', !h);

  let step = '';
  let title = '';
  let text = '';
  let send = '';
  let canSend = !sending;

  if (phase === 'object') {
    step = 'Step 1 of 3 · The obstacle';
    title = h ? 'That object didn’t help' : 'Something blocks the Other Side';
    text = h
      ? 'Your ghost came home weaker. Ask the Other Side again what blocks their room, and choose a different object.'
      : 'Ask the Other Side player what they see in their haunted room. Then choose ONE object for your ghost to carry across.';
    send = chosenObject ? `Release ${name} with the ${OBJECT_INFO[chosenObject].name}` : 'Choose an object first';
    canSend &&= !!chosenObject;
  } else if (phase === 'key-retry') {
    step = 'Step 2 of 3 · The keyhole';
    title = 'The key didn’t fit';
    text = `Describe your keyhole again, without showing your screen. Then send ${name} back for another key.`;
    send = `Send ${name} back for another key`;
  } else if (phase === 'rune') {
    step = 'Step 3 of 3 · The rune';
    title = h!.tries.rune === 0 ? 'The door creaks open!' : 'The rune was wrong';
    text =
      'One last seal: a rune is carved on the Other Side’s exit door. Ask them to describe it, and paint it here, block by block. Your ghost will wear it across.';
    send = `Send ${name} wearing the rune`;
  } else if (phase === 'away') {
    const s = h!.inFlight;
    step = s === 3 ? 'Step 3 of 3 · The rune' : 'Step 2 of 3 · The keyhole';
    title = `${name} is on the Other Side`;
    text =
      s === 3
        ? 'The Other Side is checking the rune against their exit door…'
        : 'If your object worked, the Other Side has found four keys. Describe your keyhole to them. Don’t show your screen!';
  }

  $('h-step').textContent = step;
  $('h-title').textContent = title;
  $('h-text').textContent = text;

  show('h-ghost', !!h);
  if (h) {
    renderGhost($('h-ghost'), h.grid, {
      energy: h.energy,
      label: `${h.name}, your ghost`,
      sending,
    });
  }

  show('h-objects', phase === 'object');
  if (phase === 'object') {
    choiceButtons($('h-objects'), OBJECTS, chosenObject, (o) => [OBJECT_INFO[o].icon, OBJECT_INFO[o].name], (o) => {
      chosenObject = o;
    }, sending);
  }

  const keyholeVisible = !!h && (phase === 'key-retry' || (phase === 'away' && h.inFlight <= 2));
  show('h-keyhole', keyholeVisible);
  if (keyholeVisible) {
    $('h-keyhole-glyph').textContent = KEY_INFO[h!.keyhole].glyph;
    $('h-keyhole-glyph').setAttribute('aria-label', `Keyhole shaped like a ${KEY_INFO[h!.keyhole].name}`);
  }

  show('h-rune', phase === 'rune');
  show('h-away', phase === 'away');
  $('h-away').textContent = 'Listening for the ghost to come home. If nothing happens, ask the Other Side to press Resend.';

  const btn = $<HTMLButtonElement>('h-send');
  btn.hidden = phase === 'away';
  btn.textContent = send;
  btn.disabled = !canSend;
}

function renderOther() {
  const o = state!.other!;
  const obstacle = OBSTACLES[o.room.obstacle];
  const name = o.ghost?.name ?? 'The ghost';

  $('o-icon').textContent = o.cleared ? '✨' : obstacle.icon;
  $('o-title').textContent = o.cleared ? 'The way is clear' : obstacle.title;
  $('o-scene').textContent = o.cleared ? obstacle.solved : obstacle.scene;
  $('o-room').classList.toggle('cleared', o.cleared);
  renderGrid($('o-rune'), RUNES[o.room.rune].blocks.map((r) => [...r]));
  $('o-rune').setAttribute('aria-label', `Exit rune: ${RUNES[o.room.rune].name}`);

  let step = '';
  let text = '';
  let send = '';
  let canSend = !sending;
  switch (o.phase) {
    case 'waiting':
      step = 'Step 1 of 3 · The obstacle';
      text =
        'Describe your room to the House player out loud. They will send their ghost carrying something that might help. Keep Listen on.';
      break;
    case 'blocked':
      step = 'Step 1 of 3 · The obstacle';
      text =
        o.energy > 0
          ? `That doesn’t help here… ${name} grows weaker. Tell the House, then send ${name} home to fetch something else.`
          : `That doesn’t help, and ${name} is fading… Send it home one last time.`;
      send = o.energy > 0 ? `Send ${name} home for something else` : 'Send the fading ghost home';
      break;
    case 'keys':
      step = 'Step 2 of 3 · The keys';
      text =
        o.stage === 2
          ? 'The House says that key didn’t fit. Ask again what their keyhole looks like, and choose another.'
          : `Ask the House what their keyhole looks like. Choose ONE key for ${name} to carry home.`;
      send = chosenKey ? `Send ${name} home with the ${KEY_INFO[chosenKey].name} key` : 'Choose a key first';
      canSend &&= !!chosenKey;
      break;
    case 'rune-bad':
      step = 'Step 3 of 3 · The rune';
      text = `The rune doesn’t match: ${o.runeOff} blocks are wrong (1 is allowed). ${name} grows weaker. Describe your exit rune again, then send ${name} home to repaint.`;
      send = `Send ${name} home to repaint`;
      break;
    case 'freed':
      step = 'Step 3 of 3 · The rune';
      text = `The rune glows and your exit door swings open! Send ${name} home, free!`;
      send = `Send ${name} home, free!`;
      break;
    case 'sent':
      step = o.stage === 3 ? 'Step 3 of 3 · The rune' : 'Waiting for the House';
      text =
        o.stage === 3
          ? `${name} flew home to repaint the rune. Get ready to describe it again.`
          : `${name} is flying home. While you wait, look at the rune on your exit door. You’ll need to describe it soon.`;
      break;
  }
  $('o-step').textContent = step;
  $('o-text').textContent = text;

  show('o-ghost-row', !!o.ghost);
  if (o.ghost) {
    renderGhost($('o-ghost'), o.ghost.grid, {
      energy: o.energy,
      label: `${o.ghost.name}, the House’s ghost`,
      materialize: materializeNext,
      sending,
    });
    materializeNext = false;
    $('o-name').textContent = o.ghost.name;
    $('o-brought').textContent = o.brought
      ? `Brought: ${OBJECT_INFO[o.brought].icon} ${OBJECT_INFO[o.brought].name}`
      : '';
  }

  show('o-keys', o.phase === 'keys');
  if (o.phase === 'keys') {
    choiceButtons($('o-keys'), KEYS, chosenKey, (k) => [KEY_INFO[k].glyph, KEY_INFO[k].name], (k) => {
      chosenKey = k;
    }, sending);
  }

  show('o-away', o.phase === 'sent');
  $('o-away').textContent = 'Listening for the House…';
  const btn = $<HTMLButtonElement>('o-send');
  btn.hidden = !send;
  btn.textContent = send;
  btn.disabled = !canSend;
}

function renderEnd() {
  const s = state!;
  const box = $('end');
  let win = false;
  let grid: Grid = emptyGrid();
  let title = '';
  let text = '';

  if (role === 'house' && s.house) {
    const h = s.house;
    win = h.phase === 'free';
    grid = h.grid;
    const t = clock((h.endedAt ?? Date.now()) - h.startedAt);
    const st = s.stats;
    title = win ? `${h.name} is free! 🎉` : `${h.name} faded away…`;
    text = win
      ? `You escaped together in ${t} with ${h.energy} of 3 candles left. ` +
        `Your House sent ${st.chirpsSent} chirps: ${st.bytesSent} bytes as ${(st.airtimeMs / 1000).toFixed(1)} s of sound. ` +
        'No Wi-Fi, no Bluetooth, no internet. Only sound.'
      : 'The spirit energy ran out. Let the Other Side know, then summon a new ghost and try again.';
    show('end-tell', !win);
  } else if (role === 'other' && s.other?.ghost) {
    const o = s.other;
    win = o.ended === 'free';
    grid = o.ghost!.grid;
    title = win ? `${o.ghost!.name} escaped! 🎉` : `${o.ghost!.name} faded away…`;
    text = win
      ? `You set ${o.ghost!.name} free with ${o.energy} of 3 candles left. This device heard ${s.stats.chirpsHeard} chirps and sent ${s.stats.chirpsSent}.`
      : 'The spirit energy ran out. Press Play again for a new haunted room.';
    show('end-tell', false);
  }
  box.classList.toggle('win', win);
  box.classList.toggle('lose', !win);
  renderGhost($('end-ghost'), grid, { energy: win ? 3 : 0, label: title });
  $('end-title').textContent = title;
  $('end-text').textContent = text;
}

function renderDiagnostics() {
  const rows: Record<string, string> = {
    role: role ?? '-',
    'sample rate': ctx ? `${ctx.sampleRate} Hz` : 'audio not started',
    'secure context': String(window.isSecureContext),
    'audio engine': window.ggwave_factory ? 'ggwave loaded' : 'MISSING vendor/ggwave.js',
    'last sent': state?.lastSent?.key ?? '-',
    'seen transfers': String(state?.seen.length ?? 0),
    ...metrics,
  };
  $('diag').replaceChildren(
    ...Object.entries(rows).flatMap(([k, v]) => {
      const dt = document.createElement('dt');
      dt.textContent = k;
      const dd = document.createElement('dd');
      dd.textContent = v;
      return [dt, dd];
    }),
  );
}

// ================================================================ audio

/** Must be called from a user gesture (iOS requires it to unlock audio). */
async function ensureAudio(): Promise<{ ctx: AudioContext; modem: Modem; viz: Visualizer }> {
  if (!window.ggwave_factory) throw new Error('The audio engine (vendor/ggwave.js) did not load. Reload the page.');
  if (!ctx) {
    const AC =
      window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    try {
      ctx = new AC({ sampleRate: 48000 });
    } catch {
      ctx = new AC();
    }
  }
  await ctx.resume();
  if (!modem) modem = await Modem.create(window.ggwave_factory, ctx.sampleRate);
  if (!viz) viz = new Visualizer(ctx, $<HTMLCanvasElement>('scope'));
  return { ctx, modem, viz };
}

async function transmit(bytes: Uint8Array, label: string, after: string) {
  const audio = await ensureAudio();
  stopListening(false); // half-duplex: never hear ourselves
  setHint(null);
  const samples = audio.modem.encode(bytes);
  const ms = audio.modem.durationMs(samples);
  $('chirp-info').textContent = `Inside the last chirp: ${describeBytes(bytes.length - HEADER_LEN - 1)} → ${(ms / 1000).toFixed(1)} s of sound`;
  metrics['last chirp'] = `${ms} ms, ${bytes.length} bytes`;
  metrics['last tx hex'] = hex(bytes);
  sending = true;
  setStatus(`🔊 Sending ${label}… Hold the devices close and stay quiet.`);
  render();
  audio.viz.setMode('send');
  const t0 = performance.now();
  try {
    await play(audio.ctx, samples, audio.viz.input);
  } finally {
    sending = false;
    audio.viz.setMode('idle');
  }
  metrics['last playback'] = `${Math.round(performance.now() - t0)} ms wall clock`;
  commit(addAirtime(state!, ms, bytes.length));
  setStatus(`Sent ${label}. ${after}`, 'ok');
  await startListening(false); // listen for the answer automatically
}

async function send(out: Outgoing | null, label: string, after: string) {
  if (!out) return;
  commit(out.state);
  await transmit(out.bytes, label, after);
}

async function startListening(announce = true) {
  try {
    const audio = await ensureAudio();
    if (!listener) {
      listener = new Listener(
        audio.ctx,
        (samples) => {
          const bytes = modem?.decode(samples);
          if (bytes) onDecoded(bytes);
        },
        audio.viz.input,
      );
    }
    await listener.start();
    audio.viz.setMode('listen');
    window.clearTimeout(hintTimer);
    hintTimer = window.setTimeout(
      () =>
        setHint(
          'Nothing heard yet. If the other device already sent, move closer (about 30 cm), turn its volume up, and press Resend there.',
        ),
      NO_SIGNAL_HINT_MS,
    );
    if (announce) setStatus('Listening. Tell the other player to send.', 'ok');
  } catch (err) {
    const hasCode = typeof err === 'object' && err !== null && 'micError' in err;
    setStatus(hasCode ? MIC_ERROR_TEXT[micErrorOf(err)] : err instanceof Error ? err.message : String(err), 'error');
  }
  render();
}

function stopListening(announce = true) {
  window.clearTimeout(hintTimer);
  setHint(null);
  if (listener?.active) {
    listener.stop();
    viz?.setMode('idle');
    if (announce) setStatus('Stopped listening. Microphone is off.');
  }
  render();
}

// ================================================================ receive

type Fx = keyof typeof sfx;

function houseText(o: HouseOutcome, name: string): [string, Tone, Fx[]] | null {
  switch (o.kind) {
    case 'object-failed':
      return o.faded
        ? [`${name} came home and faded away… The spirit energy is gone.`, 'error', ['fade']]
        : [`${name} came home weaker. The object didn’t help. Ask again and choose another.`, 'error', ['fail']];
    case 'key-wrong':
      return o.faded
        ? [`The ${KEY_INFO[o.key].name} key doesn’t fit… and ${name} fades away.`, 'error', ['fade']]
        : [`The ${KEY_INFO[o.key].name} key doesn’t fit! ${name} loses a candle.`, 'error', ['fail']];
    case 'door-opened':
      return [`The ${KEY_INFO[o.key].name} key fits! The door creaks open…`, 'ok', ['creak', 'success']];
    case 'rune-failed':
      return o.faded
        ? [`The rune was wrong, and ${name} fades away…`, 'error', ['fade']]
        : [`The rune didn’t match their exit. ${name} loses a candle. Ask them to describe it again.`, 'error', ['fail']];
    case 'freed':
      return [`The rune matched! ${name} is FREE!`, 'ok', ['creak', 'success']];
    case 'ignored':
      return null;
  }
}

function otherText(o: OtherOutcome, name: string): [string, Tone, Fx[]] | null {
  switch (o.kind) {
    case 'arrived-object-worked':
      return [`${name} crossed over with the ${OBJECT_INFO[o.object].name}… and it worked!`, 'ok', ['arrive', 'success']];
    case 'arrived-object-failed':
      return [
        `${name} crossed over${o.object ? ` with the ${OBJECT_INFO[o.object].name}` : ''}… but it doesn’t help.`,
        'error',
        ['arrive', o.faded ? 'fade' : 'fail'],
      ];
    case 'arrived-key-retry':
      return [`${name} is back. The key didn’t fit. Choose another.`, 'info', ['arrive']];
    case 'arrived-rune-worked':
      return [`${name} arrived wearing the rune… it matches! The exit opens!`, 'ok', ['arrive', 'creak', 'success']];
    case 'arrived-rune-failed':
      return [`${name} arrived wearing a rune, but ${o.off} blocks are wrong.`, 'error', ['arrive', o.faded ? 'fade' : 'fail']];
    case 'arrived-faded':
      return [`${name} faded away…`, 'error', ['fade']];
    case 'ignored':
      return null;
  }
}

function eventText(e: ReceiveEvent): [string, Tone, Fx[]] | null {
  const n = e.message.name;
  switch (e.type) {
    case 'house':
      return houseText(e.outcome, n);
    case 'other':
      return otherText(e.outcome, n);
    case 'not-ours':
      return [`Heard a ghost named "${n}" that isn’t part of this game. Ignored.`, 'info', []];
    case 'duplicate':
      return [`Heard the same chirp again. Nothing changed.`, 'info', []];
    case 'own-echo':
      return null;
  }
}

function onDecoded(bytes: Uint8Array) {
  if (!state) return;
  window.clearTimeout(hintTimer);
  setHint(null);
  metrics['last rx hex'] = hex(bytes);
  const result = decodeMessage(bytes);
  if (!result.ok) {
    metrics['last rx error'] = result.error;
    setStatus("Heard a signal, but it wasn't a ghost. Ask the sender to press Resend.", 'error');
    render();
    return;
  }
  const { state: next, event } = receive(state, result.message, Date.now());
  metrics['last rx event'] = event.type + ('outcome' in event ? `:${event.outcome.kind}` : '');
  $('chirp-info').textContent = `Inside the last chirp: ${describeBytes(result.message.name.length)}`;

  if (event.type === 'other' && event.outcome.kind !== 'ignored') {
    materializeNext = true;
    chosenKey = null;
  }
  if (event.type === 'house' && event.outcome.kind === 'object-failed') chosenObject = null;
  if (event.type === 'house' && event.outcome.kind === 'door-opened') runeDraft = emptyRune();

  const text = eventText(event);
  if (text) {
    setStatus(text[0], text[1]);
    if (ctx) for (const fx of text[2]) sfx[fx](ctx);
  }
  if (next !== state) commit(next);
  else render();
  if (event.type === 'house' && event.outcome.kind === 'door-opened') resetRuneEditor();
}

// ================================================================ actions

async function onHouseSend() {
  const s = state!;
  if (!s.house) {
    const name = normalizeName(($('name') as HTMLInputElement).value);
    if (!name) {
      setStatus('Give your ghost a name: 1 to 10 letters or numbers (no emoji).', 'error');
      $('name').focus();
      return;
    }
    if (!draft.some((row) => row.some(Boolean))) {
      setStatus('Draw your ghost first. Tap or drag on the squares.', 'error');
      return;
    }
    if (!chosenObject) return;
    const obj = OBJECT_INFO[chosenObject].name;
    const out = houseStart(s, draft.map((r) => [...r]), name, randomU16(), { object: chosenObject }, random01, Date.now());
    await send(out, `${name} with the ${obj}`, 'Listening for it to come home…');
    return;
  }
  const h = s.house;
  if (h.phase === 'object' && chosenObject) {
    await send(houseSend(s, { object: chosenObject }), `${h.name} with the ${OBJECT_INFO[chosenObject].name}`, 'Listening…');
  } else if (h.phase === 'key-retry') {
    await send(houseSend(s, {}), `${h.name} back for another key`, 'Listening…');
  } else if (h.phase === 'rune') {
    if (!runeDraft.some((r) => r.some(Boolean))) {
      setStatus('Paint the rune first.', 'error');
      return;
    }
    await send(houseSend(s, { rune: runeDraft }), `${h.name} wearing the rune`, 'Listening…');
  }
}

async function onOtherSend() {
  const s = state!;
  const name = s.other?.ghost?.name ?? 'the ghost';
  const out = otherSend(s, { key: chosenKey ?? undefined });
  if (!out) return;
  await send(out, `${name} home`, 'Listening for the House…');
}

async function onTell() {
  await send(houseSend(state!, {}), 'the sad news', 'The Other Side will see the ghost fade.');
}

async function onResend() {
  const bytes = state && resendBytes(state);
  if (bytes) await transmit(bytes, 'the same chirp again', 'Listening…');
}

function guard(fn: () => Promise<void> | void) {
  return () => {
    Promise.resolve()
      .then(fn)
      .catch((err: unknown) => {
        sending = false;
        setStatus(err instanceof Error ? err.message : String(err), 'error');
        render();
      });
  };
}

function resetEditor() {
  draft = emptyGrid();
  renderGrid($('editor'), draft, (g) => (draft = g));
}

function resetRuneEditor() {
  runeDraft = emptyRune();
  renderGrid($('rune-editor'), runeDraft, (g) => (runeDraft = g));
}

function setRole(r: Role | null) {
  stopListening(false);
  role = r;
  chosenKey = null;
  chosenObject = null;
  if (r) {
    sessionStorage.setItem(ROLE_KEY, r);
    localStorage.setItem(ROLE_KEY, r);
    state = loadState(localStorage, r, randomU8(), random01);
    saveState(localStorage, state);
  } else {
    sessionStorage.removeItem(ROLE_KEY);
    localStorage.removeItem(ROLE_KEY);
    state = null;
  }
  if (r === 'house') setStatus(state?.house ? 'Welcome back. Your ghost is waiting.' : 'Draw your ghost and give it a name.');
  if (r === 'other') setStatus('Press Listen. Then describe your haunted room to the House.');
  if (!r) setStatus('Who are you in this séance?');
  render();
}

// ================================================================ wiring

resetEditor();
resetRuneEditor();
$('role-house').addEventListener('click', () => setRole('house'));
$('role-other').addEventListener('click', () => setRole('other'));
$('change-role').addEventListener('click', () => setRole(null));
$('clear').addEventListener('click', resetEditor);
$('rune-clear').addEventListener('click', resetRuneEditor);
$('name').addEventListener('input', () => render());
$('h-send').addEventListener('click', guard(onHouseSend));
$('o-send').addEventListener('click', guard(onOtherSend));
$('end-tell').addEventListener('click', guard(onTell));
$('resend').addEventListener('click', guard(onResend));
$('listen').addEventListener('click', guard(() => (listener?.active ? stopListening() : startListening())));
$('play-again').addEventListener('click', () => {
  if (!state) return;
  commit(newGame(state, random01));
  chosenKey = null;
  chosenObject = null;
  resetEditor();
  resetRuneEditor();
  setStatus(role === 'house' ? 'Summon a new ghost.' : 'A new haunted room. Press Listen and describe it to the House.');
});
$('reset').addEventListener('click', () => {
  if (!role || !confirm('Forget every ghost on this device?')) return;
  stopListening(false);
  localStorage.removeItem(storageKey(role));
  setRole(role);
  setStatus('This device was reset.');
});
// Release the mic if the page is hidden (tab switch, screen lock).
document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopListening(false);
});

// ---------------------------------------------------------------- offline

function setOffline(kind: 'ready' | 'failed' | 'idle', text: string) {
  $('offline').className = `offline ${kind === 'idle' ? '' : kind}`;
  $('offline-state').textContent = text;
}

const READY_TEXT = '✓ Ready for offline play. You can turn off Wi-Fi and Bluetooth.';

$('prepare').addEventListener('click', async () => {
  const btn = $<HTMLButtonElement>('prepare');
  btn.disabled = true;
  try {
    const r = await prepareOffline((t) => setOffline('idle', t));
    if (r.ok) setOffline('ready', `${READY_TEXT} (${r.result.checked} files, ${Math.round(r.result.bytes / 1024)} KB checked)`);
    else setOffline('failed', r.reason);
  } catch (err) {
    setOffline('failed', `Offline setup failed: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    btn.disabled = false;
  }
});

registerServiceWorker();
void isOfflineReady().then((ready) => {
  if (ready) setOffline('ready', READY_TEXT);
  else if (!navigator.onLine) setOffline('failed', 'You are offline and this device was not prepared. Connect once and tap Prepare.');
});

setRole(role);
if (!window.isSecureContext) setStatus(MIC_ERROR_TEXT.insecure, 'error');
