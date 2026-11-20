import './style.css';
import { Listener, MIC_ERROR_TEXT, micErrorOf } from './audio/listener';
import { Modem } from './audio/modem';
import { play } from './audio/player';
import { playEffects, type Effect } from './audio/sfx';
import { Visualizer } from './audio/visualizer';
import type { GgwaveFactory } from './audio/ggwave-types';
import { concatSamples, handshakeSamples } from './audio/handshake';
import { NOISE_INFO } from './game/noise';
import {
  addAirtime,
  awardGame,
  chain,
  scores,
  type ChainCard,
  currentStep,
  initialState,
  leaveGame,
  loadState,
  phaseOf,
  PLAYERS_MAX,
  PLAYERS_MIN,
  promptFor,
  receive,
  resendBytes,
  revealGame,
  saveState,
  sendEntry,
  setProfile,
  startGame,
  STORAGE_KEY,
  type Game,
  type Outgoing,
  type Phase,
  type ReceiveEvent,
  type State,
} from './game/telephone';
import { randomWord } from './game/words';
import { isOfflineReady, prepareOffline, registerServiceWorker } from './offline/offline';
import { emptyGrid, type Grid } from './protocol/drawing';
import { cleanName, cleanText, decodePacket, describePacket, DRAW_SIZE, isDrawingStep, type NoiseLevel } from './protocol/packet';
import { SendGate } from './state/sender';
import { renderGrid } from './ui/grid';

declare global {
  interface Window {
    ggwave_factory?: GgwaveFactory;
  }
}

type Tone = 'info' | 'ok' | 'error';
type AudioState = 'off' | 'starting' | 'mic' | 'listening' | 'playing' | 'error';

const FX_KEY = 'dialup:effects';
const NO_SIGNAL_HINT_MS = 30_000;
const AUDIO_TIMEOUT_MS = 10_000;

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const show = (id: string, visible: boolean) => ($(id).hidden = !visible);
const randomU16 = () => crypto.getRandomValues(new Uint16Array(1))[0];
const random01 = () => crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32;

// One browser tab = one player (sessionStorage), so several windows on one laptop can play.
let state: State = loadState(sessionStorage);

// UI-only state
let joinScreen = false;
let chosenSeat = state.profile.seat && state.profile.seat >= 2 ? state.profile.seat : 2;
let hostPlayers = 4;
let hostNoise: NoiseLevel = 1;
let suggestedWord = randomWord(random01);
let draft: Grid = emptyGrid(DRAW_SIZE);
let draftFor = '';
let revealShown = 1;
let showTimer: number | undefined;
let currentPrimary: (() => Promise<void> | void) | null = null;
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
const hasInk = (g: boolean[][]) => g.some((r) => r.some(Boolean));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const clock = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  return Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error(message)), ms))]);
}

function seatName(g: Game, seat: number): string | null {
  if (seat === g.seat) return cleanName(state.profile.name);
  if (seat === 1) return g.host;
  return g.entries[String(seat)]?.name ?? null;
}
const who = (g: Game, seat: number) => seatName(g, seat) ?? `Seat ${seat}`;
const verb = (seat: number, done: boolean) => (isDrawingStep(seat) ? (done ? 'drew' : 'drawing') : done ? 'guessed' : 'guessing');

function chosenWord(): string | null {
  const custom = ($('custom-word') as HTMLInputElement).value;
  return custom.trim() ? cleanText(custom) : suggestedWord;
}

function waitingForChirp(p: Phase): boolean {
  return p === 'ready' || p === 'waiting' || p === 'sent';
}

// ---------------------------------------------------------------- render

function render() {
  const phase = phaseOf(state);
  const inGame = ['ready', 'my-turn', 'waiting', 'sent', 'ready-to-reveal'].includes(phase);
  show('lobby', phase === 'lobby' && !joinScreen);
  show('join', phase === 'lobby' && joinScreen);
  show('host', phase === 'host-setup');
  show('game', inGame);
  show('reveal', phase === 'reveal');
  show('statusbar', phase !== 'lobby' || joinScreen);

  const name = cleanName(state.profile.name);
  show('me-badge', !!name && phase !== 'lobby');
  $('me-badge').textContent = state.profile.seat === 1 ? `☎️ ${name} · host` : `📻 ${name} · seat ${state.profile.seat ?? '?'}`;

  renderAudio(phase);
  if (phase === 'lobby') renderLobby();
  if (phase === 'host-setup') renderHost();
  if (inGame) renderGame(phase);
  if (phase === 'reveal') renderReveal();
  ($('resend') as HTMLButtonElement).disabled = !state.lastSent || gate.busy;
  renderDiagnostics(phase);
}

function renderAudio(phase: Phase) {
  const waiting = waitingForChirp(phase);
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

  const seats = $('seats');
  const hadFocus = seats.contains(document.activeElement);
  seats.replaceChildren(
    ...Array.from({ length: PLAYERS_MAX - 1 }, (_, i) => i + 2).map((n) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = String(n);
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(n === chosenSeat));
      b.setAttribute('aria-label', `Seat ${n}`);
      b.addEventListener('click', () => {
        chosenSeat = n;
        render();
      });
      return b;
    }),
  );
  if (hadFocus) seats.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
  $('ready').textContent = `I'm ready as seat ${chosenSeat}: listen for the host`;
}

function renderHost() {
  const noiseBox = $('noise');
  const noiseFocus = noiseBox.contains(document.activeElement);
  noiseBox.replaceChildren(
    ...([0, 1, 2] as NoiseLevel[]).map((n) => {
      const info = NOISE_INFO[n];
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(n === hostNoise));
      b.setAttribute('aria-label', `${info.name}: ${info.blurb}`);
      const icon = Object.assign(document.createElement('span'), { className: 'big', textContent: info.icon });
      icon.setAttribute('aria-hidden', 'true');
      b.append(icon, Object.assign(document.createElement('b'), { textContent: info.name }), Object.assign(document.createElement('small'), { textContent: info.blurb }));
      b.addEventListener('click', () => {
        hostNoise = n;
        render();
      });
      return b;
    }),
  );
  if (noiseFocus) noiseBox.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
  $('players').textContent = String(hostPlayers);
  ($('players-minus') as HTMLButtonElement).disabled = hostPlayers <= PLAYERS_MIN;
  ($('players-plus') as HTMLButtonElement).disabled = hostPlayers >= PLAYERS_MAX;
  const custom = ($('custom-word') as HTMLInputElement).value;
  const word = chosenWord();
  $('word').textContent = word ?? '—';
  const start = $<HTMLButtonElement>('start');
  start.disabled = !word || gate.busy;
  start.textContent = word ? `Start a ${hostPlayers}-player game` : custom.trim() ? 'Word must be 1–12 letters' : 'Start the game';
}

function renderGame(phase: Phase) {
  const g = state.game;
  const seat = state.profile.seat ?? 0;
  // ---- the line
  if (g) {
    $('line-meta').textContent = `${g.host}'s game · ${g.players} players · ${NOISE_INFO[g.noise].icon} ${NOISE_INFO[g.noise].name} line · you are seat ${g.seat}`;
    const now = currentStep(g);
    $('line').replaceChildren(
      ...Array.from({ length: g.players }, (_, i) => i + 1).map((k) => {
        const done = !!g.entries[String(k)];
        const li = document.createElement('li');
        li.className = [done ? 'done' : '', k === now ? 'now' : '', k === g.seat ? 'me' : ''].join(' ').trim();
        const left = document.createElement('span');
        left.textContent = `${k} · ${who(g, k)}${k === g.seat ? ' (you)' : ''}`;
        const st = document.createElement('span');
        st.className = 'st';
        st.textContent = done ? `✓ ${verb(k, true)}` : k === now ? `${isDrawingStep(k) ? '✏️' : '💬'} ${verb(k, false)}…` : '';
        li.append(left, st);
        return li;
      }),
    );
  } else {
    $('line-meta').textContent = `You are seat ${seat}. The line appears when the host starts.`;
    $('line').replaceChildren();
  }

  // ---- the task
  let step = '';
  let title = '';
  let text = '';
  let wait = '';
  let primary: { label: string; disabled: boolean; run: () => Promise<void> | void } | null = null;
  let promptText: string | null = null;
  let promptDrawing: Grid | null = null;
  let drawing = false;
  let guessing = false;

  if (phase === 'ready' || !g) {
    step = `Seat ${seat}`;
    title = 'Waiting for the host to start';
    text = `Keep listening. When the host presses Start, this device joins automatically as seat ${seat}.`;
    wait = 'Listening for the start signal…';
    primary = { label: 'Change my seat', disabled: false, run: () => { joinScreen = true; commit(setProfile(state, { mode: null })); } };
  } else if (phase === 'my-turn') {
    const p = promptFor(g)!;
    step = `Your turn · seat ${g.seat} of ${g.players}`;
    if (p.kind === 'drawing') {
      title = `What did ${p.from} draw?`;
      text = 'Type your best guess. The next player will have to draw it.';
      promptDrawing = p.drawing;
      guessing = true;
      const guess = cleanText(($('guess') as HTMLInputElement).value);
      primary = { label: guess ? `Send my guess: "${guess}"` : 'Type a guess first', disabled: !guess, run: onSendGuess };
    } else {
      title = p.kind === 'word' ? 'Draw the secret word' : `Draw what ${p.from} guessed`;
      text = 'No letters or numbers, just a drawing! Tap or drag to paint the 16 × 16 squares.';
      promptText = p.text;
      drawing = true;
      primary = { label: hasInk(draft) ? 'Send my drawing' : 'Draw something first', disabled: !hasInk(draft), run: onSendDrawing };
    }
  } else if (phase === 'waiting') {
    const prev = g.seat - 1;
    const now = currentStep(g) ?? prev;
    step = `Seat ${g.seat} of ${g.players}`;
    title = `Waiting for ${who(g, prev)} (seat ${prev})`;
    text = now < prev ? `Right now, ${who(g, now)} (seat ${now}) is ${verb(now, false)}.` : `${who(g, prev)} is ${verb(prev, false)}. Your turn comes next.`;
    wait = `If ${who(g, prev)} already sent, ask them to press Resend.`;
  } else if (phase === 'sent') {
    const next = g.seat + 1;
    step = `Seat ${g.seat} of ${g.players}`;
    if (g.seat === g.players) {
      title = 'You were the last player!';
      text = `The host (${g.host}) will reveal the whole chain. Keep listening.`;
    } else {
      const now = currentStep(g) ?? next;
      title = 'Sent! Keep it secret';
      text = `Don't tell anyone what you made. Now ${who(g, now)} (seat ${now}) is ${verb(now, false)}.`;
    }
    wait = next <= g.players && !g.entries[String(next)] ? `If seat ${next} didn't get your chirp, press Resend.` : 'Listening…';
  } else if (phase === 'ready-to-reveal') {
    step = 'Everyone has played';
    title = 'Gather around for the reveal!';
    text = 'Press Reveal: one chirp lets every phone in the room show the whole chain.';
    primary = { label: 'Reveal the chain', disabled: false, run: onReveal };
  }

  $('t-step').textContent = step;
  $('t-title').textContent = title;
  $('t-text').textContent = text;
  show('t-wait', !!wait);
  $('t-wait').textContent = wait;
  show('prompt-text', !!promptText);
  $('prompt-text').textContent = promptText ? `“${promptText}”` : '';
  const staticNote = phase === 'my-turn' && !!g && g.seat > 1 && g.noise > 0;
  show('static-note', staticNote);
  if (staticNote) $('static-note').textContent = `${NOISE_INFO[g!.noise].icon} ${NOISE_INFO[g!.noise].name} line: this may have picked up static on the way. Go with what you see!`;
  show('prompt-drawing', !!promptDrawing);
  if (promptDrawing) renderGrid($('prompt-drawing'), promptDrawing, { label: 'The drawing you must guess' });
  show('draw-box', drawing);
  if (drawing) {
    const key = `${g?.gameId}:${g?.seat}`;
    if (draftFor !== key) {
      draftFor = key;
      resetEditor();
    }
  }
  show('guess-box', guessing);
  const btn = $<HTMLButtonElement>('primary');
  btn.hidden = !primary;
  btn.textContent = primary?.label ?? '';
  btn.disabled = !primary || primary.disabled || gate.busy;
  currentPrimary = primary?.run ?? null;
}

function cardEl(g: Game, card: ChainCard, canAward: boolean): HTMLLIElement {
  const li = document.createElement('li');
  if (card.step > 0 && card.step === g.award) li.className = 'awarded';
  const head = document.createElement('div');
  head.className = 'who';
  if (card.kind === 'word') head.textContent = `🔒 The secret word (${card.name})`;
  else if (card.kind === 'drawing') head.textContent = `${card.step} · ${card.name} drew:`;
  else if (card.kind === 'text') head.textContent = `${card.step} · ${card.name} guessed:`;
  else head.textContent = `${card.step} · ${card.name}`;
  if (card.step > 0 && card.step === g.award) head.textContent = `🏆 ${head.textContent}`;
  li.append(head);
  if (card.kind === 'drawing') {
    // Shown as it arrived at the next player: red squares are the static.
    const grid = document.createElement('div');
    const shown = card.arrived?.drawing ?? card.drawing!;
    renderGrid(grid, shown, { label: card.arrived ? `Drawing by ${card.name}, with ${card.arrived.flipped.length} squares of static` : `Drawing by ${card.name}` });
    for (const i of card.arrived?.flipped ?? []) grid.children[i]?.classList.add('hit');
    li.append(grid);
    if (card.arrived) li.append(Object.assign(document.createElement('p'), { className: 'static-cap', textContent: `📡 ${card.arrived.flipped.length} squares of static (red) hit it on the line` }));
  } else if (card.kind === 'missing') {
    li.append(Object.assign(document.createElement('p'), { className: 'missing', textContent: 'This device missed that chirp.' }));
  } else {
    li.append(Object.assign(document.createElement('p'), { className: 'said', textContent: card.text ?? '' }));
    if (card.arrived?.text) {
      const p = document.createElement('p');
      p.className = 'static-cap';
      p.append('📡 arrived as ');
      const word = document.createElement('b');
      [...card.arrived.text].forEach((ch, i) => {
        if (card.arrived!.changed.includes(i)) word.append(Object.assign(document.createElement('mark'), { className: 'zap', textContent: ch.toUpperCase() }));
        else word.append(ch.toUpperCase());
      });
      p.append(word);
      li.append(p);
    }
  }
  if (canAward && (card.kind === 'drawing' || card.kind === 'text')) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'small award-btn';
    b.textContent = '🏆 Worst connection';
    b.setAttribute('aria-label', `Give the Worst Connection award to ${card.name}, hop ${card.step}`);
    b.addEventListener('click', guard(() => send(awardGame(state, card.step), 'the award', 'Every phone that hears it shows the winner.')));
    li.append(b);
  }
  return li;
}

function stopShow() {
  if (showTimer !== undefined) {
    window.clearInterval(showTimer);
    showTimer = undefined;
  }
}

function playShow() {
  stopShow();
  showTimer = window.setInterval(() => {
    const g = state.game;
    if (!g || phaseOf(state) !== 'reveal') return stopShow();
    const cards = chain(g).cards;
    if (revealShown >= cards.length) {
      stopShow();
      playFx(['success']);
    } else {
      revealShown++;
      playFx(cards[revealShown - 1].arrived ? ['static'] : ['arrive']);
    }
    render();
  }, 2400);
  render();
}

function renderReveal() {
  const g = state.game!;
  const c = chain(g);
  const shown = Math.min(revealShown, c.cards.length);
  const all = shown >= c.cards.length;
  const host = g.seat === 1;
  const canAward = host && all && g.award === null && !gate.busy;
  $('chain').replaceChildren(...c.cards.slice(0, shown).map((card) => cardEl(g, card, canAward)));
  show('reveal-play', !all && showTimer === undefined);
  show('reveal-next', !all);
  show('reveal-all', !all);

  show('award-box', all);
  const winner = g.award !== null ? c.cards.find((x) => x.step === g.award) : null;
  $('award-text').textContent = winner
    ? `🏆 Worst Connection award: ${winner.name} (hop ${winner.step}). +1 point!`
    : host
      ? 'Vote out loud: which hop mutated the funniest? Tap 🏆 on that card. Your phone chirps the winner to everyone.'
      : 'Vote out loud for the funniest mutation! The host taps the winner and chirps it to every phone. Keep listening.';
  show('scores-box', all);
  if (all) {
    $('scores').replaceChildren(
      ...scores(g).map((s) => {
        const li = document.createElement('li');
        const left = document.createElement('span');
        left.append(`${s.seat} · ${s.name}`);
        if (s.notes.length) left.append(Object.assign(document.createElement('span'), { className: 'notes', textContent: s.notes.join(' · ') }));
        li.append(left, Object.assign(document.createElement('span'), { className: 'pts', textContent: `${s.points} pt${s.points === 1 ? '' : 's'}` }));
        return li;
      }),
    );
  }
  let result = '';
  if (all) {
    if (c.perfect) result = `🎉 Perfect transmission! "${g.word}" survived all ${g.players} hops.`;
    else if (c.survivedHops >= g.players) result = `📼 "${g.word}" made it all the way. Judge the last drawing yourselves!`;
    else result = `📡 Signal lost: "${g.word}" survived ${c.survivedHops} ${c.survivedHops === 1 ? 'hop' : 'hops'} before it mutated.`;
  }
  $('reveal-result').textContent = result;
  const s = state.stats;
  const time = g.revealedAt !== null ? ` Round time: ${clock(g.revealedAt - g.startedAt)}.` : '';
  $('reveal-stats').textContent = `This device played ${s.chirpsSent} chirps (${s.bytesSent} bytes, ${(s.airtimeMs / 1000).toFixed(1)} s of sound) and heard ${s.chirpsHeard}.${time} No Wi-Fi, no Bluetooth, no internet.`;
  $('again').textContent = host ? '☎️ Host the next round' : '📻 Ready for the next round';
  $('again').className = all ? 'primary' : '';
  $('again-note').textContent = host
    ? 'Ask everyone to press "Ready for the next round" first, then start.'
    : 'The host starts the next round. Press Ready, and your device joins automatically.';
}

function renderDiagnostics(phase: Phase) {
  const rows: Record<string, string> = {
    phase,
    audio: audioState,
    'sample rate': ctx ? `${ctx.sampleRate} Hz` : 'audio not started',
    'secure context': String(window.isSecureContext),
    'audio engine': window.ggwave_factory ? 'ggwave loaded' : 'MISSING vendor/ggwave.js',
    game: state.game ? `${state.game.gameId} (${state.game.players} players)` : '-',
    'seen / retired': `${state.seen.length} / ${state.retired.length}`,
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
  listener ??= new Listener(audio.ctx, (samples) => {
    const bytes = modem?.decode(samples);
    if (bytes) onDecoded(bytes);
  }, audio.viz.input);
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
    if (audioState === 'listening' && waitingForChirp(phaseOf(state))) {
      setStatus('Nothing heard for a while. If someone already sent, move the phones closer, turn the volume up, and ask them to press Resend.');
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

/** Play the chirp, then commit. Nothing is committed if playback fails. */
async function playOut(out: { state: State; bytes: Uint8Array }, label: string, after: string): Promise<boolean> {
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
  const chirp = audio.modem.encode(out.bytes);
  // Decorative dial-up handshake in front of the chirp (same buffer, so timing is exact).
  const lead = fxOn ? handshakeSamples(audio.ctx.sampleRate, out.bytes[out.bytes.length - 1]) : new Float32Array(0);
  const samples = concatSamples(lead, chirp);
  const ms = audio.modem.durationMs(samples);
  playingMs = ms;
  metrics['last chirp'] = `${audio.modem.durationMs(chirp)} ms chirp + ${audio.modem.durationMs(lead)} ms handshake, ${out.bytes.length} bytes`;
  metrics['last tx hex'] = hex(out.bytes);
  const decoded = decodePacket(out.bytes);
  if (decoded.ok) $('chirp-info').textContent = `Inside the last chirp: ${describePacket(decoded.packet, out.bytes.length)} → ${(ms / 1000).toFixed(1)} s of sound`;
  audio.viz.setMode('send');
  setAudio('playing');
  setStatus(`🔊 Sending ${label}… keep the room quiet.`);
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
    setStatus(`The chirp couldn't play (${why}). Nothing changed. Press the button again to retry.`, 'error');
    return false;
  }
  setStatus(`Chirp played: ${label}. ${after}`);
  await startListening(false);
  return true;
}

async function send(out: Outgoing | null, label: string, after: string) {
  if (out) await playOut(out, label, after);
}

// ---------------------------------------------------------------- receiving

function eventMessage(e: ReceiveEvent): [string, Tone, Effect[]] | null {
  const g = state.game;
  switch (e.type) {
    case 'joined':
      return [`Connected! ${e.host} started a ${e.players}-player game on a ${NOISE_INFO[e.noise].name.toLowerCase()} line. You are seat ${e.seat}.`, 'ok', ['arrive']];
    case 'awarded':
      return [`🏆 The Worst Connection award goes to ${e.name} (hop ${e.step})!`, 'ok', ['success']];
    case 'not-ready':
      return [`${e.host} started a game, but you're not ready yet. Pick your seat, press I'm ready, then ask ${e.host} to press Resend.`, 'error', []];
    case 'seat-too-high':
      return [`${e.host}'s game has only ${e.players} seats. Pick a seat from 2 to ${e.players}, press I'm ready, and ask ${e.host} to press Resend.`, 'error', []];
    case 'entry':
      if (e.forMe) return [`${e.name}'s ${isDrawingStep(e.step) ? 'drawing' : 'guess'} arrived. Your turn!`, 'ok', ['arrive']];
      if (e.last && g?.seat === 1) return [`${e.name} played the last turn. Time for the reveal!`, 'ok', ['success']];
      return [`Heard ${e.name} (seat ${e.step}).${g && e.step < g.players ? ` Now seat ${e.step + 1} is up.` : ''}`, 'info', []];
    case 'revealed':
      return ['The reveal is here! Show the chain one hop at a time.', 'ok', ['success']];
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

function onDecoded(bytes: Uint8Array) {
  window.clearTimeout(hintTimer);
  metrics['last rx hex'] = hex(bytes);
  const result = decodePacket(bytes);
  if (!result.ok) {
    metrics['last rx error'] = result.error;
    setStatus('Heard a garbled chirp. Nothing changed. Ask the sender to press Resend.', 'error');
    return;
  }
  const { state: next, event } = receive(state, result.packet, Date.now());
  metrics['last rx event'] = event.type;
  $('chirp-info').textContent = `Inside the last chirp heard: ${describePacket(result.packet, bytes.length)}`;
  if (event.type === 'revealed') revealShown = 1;
  if (event.type === 'joined') stopShow();
  if (event.type === 'joined') ($('guess') as HTMLInputElement).value = '';
  if (next !== state) commit(next);
  const m = eventMessage(event);
  if (m) {
    setStatus(m[0], m[1]);
    playFx(m[2]);
  }
  render();
}

// ---------------------------------------------------------------- actions

async function onStart() {
  const word = chosenWord();
  if (!word) return;
  const out = startGame(state, { players: hostPlayers, word, gameId: randomU16(), now: Date.now(), noise: hostNoise });
  revealShown = 1;
  await send(out, 'the start signal', 'Players who were ready have joined. Now draw your word!');
}

async function onSendDrawing() {
  await send(sendEntry(state, { drawing: draft.map((r) => [...r]) }), 'your drawing', 'Keep it secret! Waiting for the next player.');
}

async function onSendGuess() {
  const out = sendEntry(state, { text: ($('guess') as HTMLInputElement).value });
  if (!out) return;
  if (await playOut(out, 'your guess', 'Keep it secret! Waiting for the next player.')) {
    ($('guess') as HTMLInputElement).value = '';
  }
}

async function onReveal() {
  revealShown = 1;
  await send(revealGame(state, Date.now()), 'the reveal', 'Every phone that heard it now shows the chain.');
}

async function onResend() {
  const bytes = resendBytes(state);
  if (bytes) await playOut({ state, bytes }, 'the same chirp again', 'Listening…');
}

function onAgain() {
  stopShow();
  const host = state.game?.seat === 1;
  commit(leaveGame(state));
  revealShown = 1;
  ($('custom-word') as HTMLInputElement).value = '';
  suggestedWord = randomWord(random01, suggestedWord);
  if (host) {
    setStatus('New round. Ask everyone to press "Ready for the next round", then start.');
  } else {
    setStatus('Ready for the next round. Keep listening: you will join when the host starts.', 'ok');
    void startListening(false);
  }
  render();
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
  draft = emptyGrid(DRAW_SIZE);
  renderGrid($('editor'), draft, {
    label: 'Your drawing, 16 by 16 squares',
    onChange: (g) => {
      draft = g;
      render();
    },
  });
}

// ---------------------------------------------------------------- wiring

$<HTMLInputElement>('name').addEventListener('input', (e) => {
  commit(setProfile(state, { name: (e.target as HTMLInputElement).value }));
});
$('choose-host').addEventListener('click', () => {
  commit(setProfile(state, { mode: 'host', seat: 1 }));
  setStatus('Choose how many players and how bad the phone line is, check your secret word, then start.');
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
$('reroll').addEventListener('click', () => {
  suggestedWord = randomWord(random01, suggestedWord);
  ($('custom-word') as HTMLInputElement).value = '';
  render();
});
$('custom-word').addEventListener('input', () => render());
$('start').addEventListener('click', guard(onStart));
$('guess').addEventListener('input', () => render());
$('guess').addEventListener('keydown', (e) => {
  if ((e as KeyboardEvent).key === 'Enter') guard(() => currentPrimary?.())();
});
$('clear').addEventListener('click', () => {
  resetEditor();
  render();
});
$('primary').addEventListener('click', guard(() => currentPrimary?.()));
$('reveal-play').addEventListener('click', playShow);
$('reveal-next').addEventListener('click', () => {
  stopShow();
  revealShown++;
  const card = state.game && chain(state.game).cards[revealShown - 1];
  if (card) playFx(card.arrived ? ['static'] : ['arrive']);
  render();
});
$('reveal-all').addEventListener('click', () => {
  stopShow();
  revealShown = 99;
  render();
});
$('again').addEventListener('click', onAgain);
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
  if (!state.game || !confirm('Leave this game? You can join the next round.')) return;
  commit(leaveGame(state));
  setStatus('You left the game.');
});
$('reset').addEventListener('click', () => {
  if (!confirm('Forget your name, seat, and game in this window?')) return;
  stopListening(false);
  sessionStorage.removeItem(STORAGE_KEY);
  state = initialState();
  joinScreen = false;
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

// ---------------------------------------------------------------- boot

resetEditor();
const bootPhase = phaseOf(state);
if (['ready', 'my-turn', 'waiting', 'sent', 'ready-to-reveal'].includes(bootPhase)) {
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
