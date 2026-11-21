# Dial-Up Telephone: Design (v3: "Party Line")

## Round flow (N players)

| # | Who | Chirp | Notes |
|---|---|---|---|
| 1 | Host | `start` (game, N, mode, match ID, round, category, static level, host name) | Handshake sound plays first (effects on) |
| 2 | seat at step 1 | `entry` 1: drawing **+ secret word** | The first drawer picks or rerolls the word |
| … | seat at step k | `entry` k | Odd = drawing, even = guess |
| | anyone | `need` k | Only the author of step k auto-replies |
| N+2 | Host | `reveal` | Normal reveal only when the host's chain is complete |
| N+3 | Host | `results` (3 awards + final room guess) | One chirp, so identical scores everywhere |
| | each player | `ack` (seat) | In seat slots, so the host sees who received the results |

Before the first round (ready check):

| Who | Chirp | Notes |
|---|---|---|
| Player | `hello` (seat, name) | Played right after "I'm ready" succeeds in starting the mic |
| Host | `call` (lobby ID, N, confirmed seats, duplicated seats, host name) | "Check who's ready" |
| Unconfirmed players | `hello` | In seat slots after the call |
| Late player | `need` step 9 | "Ask to join": only the host answers, with `start` |

Every device hears every chirp and stores the round silently. Each screen shows only what its seat may see.

## Rotation and fairness (`src/game/match.ts`)

`offset = (round − 1) mod N`, `seatAt(k) = ((k − 1 + offset) mod N) + 1`, `stepOf(seat) = ((seat − 1 − offset) mod N) + 1`. Quick Round is round 1 (offset 0, host first).

Scoring chances per round: pairs (k, k+1) for odd k < N give the drawer and the guesser one chance each. For odd N, the unpaired last drawing gets the room's final guess. **Each seat has exactly one chance per round** for every N in 2..8 (tested), and over 3 rounds every seat draws at least once and guesses at least once.

## Packet format v3 (magic `0xD3`, ≤ 58 bytes)

| Offset | Field |
|---|---|
| 0 | `0xD3` |
| 1 | bits0–3 type (1 start, 2 entry, 3 reveal, 4 results, 5 need, 6 call, 7 hello, 8 ack) · bits4–5 static level (start only) |
| 2–3 | game ID (call/hello: lobby ID) |
| 4 | start/reveal/call: N · entry/need: step (need 0 = reveal + results, 9 = start) · results: funniest step (0 = none) · hello/ack: seat |
| 6–7 | **call only:** confirmed-seat mask, duplicated-seat mask (bit k−1 = seat k) |
| 5 | bits0–3 text length · bits4–7 name length |
| 6–8 | **start only:** match ID (2 bytes), then bits0–1 round (1–3), bit2 mode (1 = match), bits3–5 category, bits6–7 = 0 |
| 6–7 | **results only:** recognizable (low nibble) · recovery (high nibble), final room guess (0 n/a, 1 yes, 2 no) |
| … | drawing (32 bytes, odd entries) · text (guess; secret word on step 1) · name |
| last | CRC-8 |

Sizes:

| Packet | Bytes |
|---|---|
| start | ≤ 17 |
| step-1 drawing (with word) | ≤ 58 |
| other drawings | ≤ 46 |
| guess | ≤ 26 |
| reveal / need / ack | 7 |
| results | 9 |
| hello | ≤ 14 |
| call | ≤ 16 |

`call`, `hello`, and `ack` are not stored in the duplicate memory: they are idempotent (a roster or a set of seats), and they must be heard again when re-sent. A `hello` with my seat but another name is a seat clash, never an own echo.

v2 (`0xD2`) and older are rejected.

**Tradeoffs:**
- Carrying the word in step 1 lets *the first drawer* choose it privately, so the host gets no advantage in a Party Match. It adds up to 12 bytes to one chirp per round.
- `reveal` no longer carries the word.
- Dedupe keys are `game:type:step`. `need` is never stored as seen, so it can be asked again. It is still own-echo filtered.

## Recovery scheduling

- Auto-reply: a device answers a `need k` only if it is the **author** of step k (or the host, for k = 0). It waits 0.9 s, then plays without the handshake. Exactly one auto-responder per request, so there are no collisions from automatic replies.
- Relay: a non-author device that holds step k shows "Send it for them (only if NAME doesn't answer)".
- Entries are rebuilt from the stored round with `entryPacket()`, which is byte-identical to the original, so receivers dedupe them.
- After the reveal, a missing step is accepted as `recovered`. Present steps are never overwritten.

## Reply slots (`src/game/schedule.ts`)

Everyone hears a `call` or `results` chirp end at the same moment, so replies are scheduled from that moment:

- `hello` after a call: `900 ms + rank × 2400 ms`, where rank is my seat's position among seats 2..8 that the call did not mark confirmed or duplicated.
- `ack` after results: `900 ms + (seat − 2) × 1900 ms`.

Slots are longer than the longest reply chirp (hello ≤ 14 bytes, ack 7 bytes; durations checked against the real encoder in `tests/ggwave.test.ts`). Effects are not played on these events, and a reply is skipped (not delayed) if the phone is busy, so it can't drift into the next slot. Two phones on one seat would share a slot; the call's duplicate mask silences them, and spontaneous hellos (on "I'm ready", at human-random times) are how the host detects the clash.

## Round results

`sendResults` is once per round. Players ack every `results` chirp they hear (first or repeated); the repeat changes no state. The host records `acks` (seats) on the game. `nextRound` requires results. The UI asks for confirmation before continuing with unconfirmed seats, because the next start retires the round and its recovery.

## Line static (`src/game/noise.ts`)

- Drawings: as v2.
- Text, on a changed hop (Crackly 50%, Haunted always), in this order:
  1. a curated twist table (cat → bat/hat/car/cap, ghost → goat/host/toast, …);
  2. otherwise a one-letter change into a word from the prompt vocabulary;
  3. otherwise a nonsense letter.

  Haunted adds an extra nonsense letter half of the time.
- Results keep the case style and the ≤ 12 limit. `kind` is `twist`, `letters`, or `none`.

## Drawing editor

`src/game/canvas.ts` (pure) holds the grid, undo/redo stacks, and the stroke in progress:

- `beginStroke(cv, r, c, brush)` reads the start square and fixes `mode` (true = paint, false = erase) for the whole stroke, then applies it there.
- `strokeTo(cv, r, c, brush)` applies the same mode to every square on the straight line from the last square (so fast drags leave no gaps). Setting a fixed value is idempotent, so revisits never toggle.
- `endStroke` turns the stroke into one undo step (none if nothing changed). `toggle` is a whole keyboard action.

`src/ui/editor.ts` handles `pointerdown/move/up/cancel` on the grid element with pointer capture, maps coordinates to squares itself (the same code for mouse, touch, and pen), ignores other pointers during a stroke, and accepts `click` only from the keyboard (`detail === 0`, and not within 400 ms of a pointer stroke). The editor keeps one canvas; the bigger view only restyles its container, so history survives.

## Visual theme (`src/theme.css`)

A 1980s modem on a CRT terminal, layered on `style.css` so it can be reviewed or removed on its own:

- Phosphor-green grid background, faint scanlines and a vignette (fixed overlays with `pointer-events: none`).
- Logo with signal waves, a blinking cursor on the title, an `ATDT ▸` dial prompt, and a lobby "CONNECT 2400" screen with an equalizer.
- Keypad-style buttons (raised, press down), a phone-keypad seat picker (2 ABC … 8 TUV; the accessible name stays "Seat N"), LCD-style counters, LED status lights.
- The line drawn as a telephone wire with a node per seat (amber ring = up now). Reveal cards as perforated printer slips. Ranked scores with a gold first place.
- Grids look like a phosphor screen. Their frame is drawn with box-shadows, so the editor's box (used to map pointers to squares) doesn't change.
- System fonts only (offline). Every animation stops under `prefers-reduced-motion`; decorative elements are `aria-hidden`. No game text changes.

## Audio scheduling

`wantsHandshake(type, {effects, resend})` is true only for `start` with effects on and not a resend. The send gate is unchanged: commit after playback.

## State (`sessionStorage["dialup:v3"]`)

`profile`, `game` (round, mode, offset, entries, word, results, conflict, wordDraft), `match` (`matchId`, `rounds: RoundSummary[]`), `seen`, `sent`, `retired`, `lastSent`, `stats`. A round is archived into `match` when the next round's start arrives or the player leaves. Totals = archived rounds + the current round.

## Modules

```
src/protocol/packet.ts   v3
src/game/match.ts        rotation, scoring chances
src/game/words.ts        categories, suggestWord (deterministic, rerollable)
src/game/noise.ts        static with curated twists
src/game/telephone.ts    rules, recovery, reveal chain, scores, awards, match
src/game/canvas.ts       drawing model: start square decides paint/erase, undo/redo
src/game/schedule.ts     reply slots for hello and ack
src/ui/editor.ts         drawing editor UI
src/audio/handshake.ts   + wantsHandshake
src/main.ts              screens
```

## Risks

| Risk | Mitigation |
|---|---|
| Two people press "Ask" at once | Instructions: one asker at a time. A collision is just a missed chirp, so ask again |
| The author left the room | Relay button on devices that hold the hop. "Reveal with missing hops" fallback |
| 58-byte chirp is longer | Only one per round. Measured synthetic duration printed by tests. HW check |
| Seat clash | Ready check shows duplicates before the start; in-game clashes are still detected |
| A player with a broken mic | They never become ready, so the host can't start by mistake |
| Two players tap I'm ready at the same moment | Their hellos collide; Check who's ready asks again in slots |
