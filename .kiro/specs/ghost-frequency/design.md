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

Every device hears every chirp and stores the round silently. Each screen shows only what its seat may see.

## Rotation and fairness (`src/game/match.ts`)

`offset = (round − 1) mod N`, `seatAt(k) = ((k − 1 + offset) mod N) + 1`, `stepOf(seat) = ((seat − 1 − offset) mod N) + 1`. Quick Round is round 1 (offset 0, host first).

Scoring chances per round: pairs (k, k+1) for odd k < N give the drawer and the guesser one chance each. For odd N, the unpaired last drawing gets the room's final guess. **Each seat has exactly one chance per round** for every N in 2..8 (tested), and over 3 rounds every seat draws at least once and guesses at least once.

## Packet format v3 (magic `0xD3`, ≤ 58 bytes)

| Offset | Field |
|---|---|
| 0 | `0xD3` |
| 1 | bits0–3 type (1 start, 2 entry, 3 reveal, 4 results, 5 need) · bits4–5 static level (start only) |
| 2–3 | game ID |
| 4 | start/reveal: N · entry/need: step (need 0 = reveal + results) · results: funniest step (0 = none) |
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
| reveal / need | 7 |
| results | 9 |

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

## Line static (`src/game/noise.ts`)

- Drawings: as v2.
- Text, on a changed hop (Crackly 50%, Haunted always), in this order:
  1. a curated twist table (cat → bat/hat/car/cap, ghost → goat/host/toast, …);
  2. otherwise a one-letter change into a word from the prompt vocabulary;
  3. otherwise a nonsense letter.

  Haunted adds an extra nonsense letter half of the time.
- Results keep the case style and the ≤ 12 limit. `kind` is `twist`, `letters`, or `none`.

## Drawing editor

`src/game/canvas.ts` (pure) holds the grid, undo/redo stacks, `beginStroke` / `paint(tool, brush)` / `endStroke`, `clearCanvas`, and a large-brush 3×3 clipped footprint. `src/ui/editor.ts` wires pointer and keyboard events to it and renders a roving-tabindex grid plus a toolbar.

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
src/game/canvas.ts       drawing model with undo/redo
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
| Seat clash | Detected and shown. Players fix seats and the host restarts |
