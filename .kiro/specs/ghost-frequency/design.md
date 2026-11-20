# Dial-Up Telephone: Design (v2: "Bad Connection")

## Flow (N players, N + 3 chirps)

| # | Who | Chirp | Everyone else |
|---|---|---|---|
| 1 | Host (seat 1) | `start` (game ID, N, host name, static level) | Ready players join with their seat |
| 2 | Seat 1 | `entry` step 1: 16×16 drawing of the secret word | Stored. Seat 2 sees it with static |
| … | Seat k | `entry` step k (odd = drawing, even = guess) | Stored. Seat k+1 sees it with static |
| N+2 | Host | `reveal` (word) | Everyone shows the chain |
| N+3 | Host | `award` (winning step) | Everyone highlights the card, +1 point |

Sound is a broadcast, so every device hears every entry and can show the reveal without any network. Secrecy is enforced in the UI: a device displays only the entry its own seat needs.

## Line static (`src/game/noise.ts`)

Static is applied **on screen**, never to the bytes: the chirp carries the exact entry. `noisyDrawing(grid, gameId, step, level)` and `noisyText(text, gameId, step, level)` use a mulberry32 PRNG seeded from (game ID, step, level). The next seat's prompt, the reveal, and the points all use the same functions, so every device agrees, and a refresh changes nothing.

| Level | Drawing | Guess |
|---|---|---|
| 0 Clear line | – | – |
| 1 Crackly | flip 8 of 256 squares | 50%: change 1 letter |
| 2 Haunted | flip 24 squares | change 1 letter (2 if ≥ 6 letters) |

Changed letters are replaced by a different letter of the same case, so the result is still valid text. The secret word (the host's prompt) is never garbled.

**Why not real channel errors?** ggwave's Reed–Solomon plus our CRC make the real link all-or-nothing, which is what keeps the game reliable. The static is a designed, fair, repeatable effect.

## Packet format v2 (magic `0xD2`, ≤ 46 bytes)

| Offset | Size | Field |
|---|---|---|
| 0 | 1 | `0xD2` |
| 1 | 1 | bits0–3 type (1 start, 2 entry, 3 reveal, 4 award) · bits4–5 static level (start only, else 0) |
| 2 | 2 | game ID (uint16 BE) |
| 4 | 1 | start/reveal: N players (2–8) · entry/award: step (1–8) |
| 5 | 1 | bits0–3 text length (0–12) · bits4–7 name length (0–7) |
| 6 | 32 | drawing, 16×16, 2 bytes per row (odd entries only) |
| … | T | text: guess (even entry) or secret word (reveal) |
| … | M | name: author (entry) or host (start) |
| last | 1 | CRC-8 (poly 0x07) |

Sizes: start ≤ 14, drawing entry ≤ 46, guess entry ≤ 26, reveal ≤ 19, award 7. Dedupe key: `gameId:type:step` (award: `gameId:award:0`, so it is given once).

**Tradeoff:** 16×16 needs 32 bytes, so a drawing chirp grows from ~2.3 s to the duration printed by `tests/ggwave.test.ts` (synthetic). Guess chirps are unchanged. That is accepted for drawings that can actually be funny.

## Matching and points (`src/game/telephone.ts`)

`close(a, b)`: compare after lowercasing and dropping non-alphanumerics. Equal, or edit distance ≤ 1 when both are ≥ 5 characters.
- Perfect transmission: the last guess is close to the word.
- Hops survived: steps before the first guess that is not close to the word.
- Points: for each drawing step k with a guess at k+1, if the guess is close to what the drawer saw (the word for k = 1, otherwise guess k−1 *after static*), both get +1. Award: +1 to the author.

## Dial-up handshake (`src/audio/handshake.ts`)

Pure sample generator (testable in Node):
- 3 DTMF digits, 70 ms each;
- a 2100 Hz answer tone, 300 ms;
- a 450 ms V.21-style 980/1180 Hz warble with low-passed hiss;
- 300 ms of silence.

It is about 1.5 s, peaking around 0.35. Its energy sits mostly below ggwave's audible band, apart from the short answer tone. It is prepended to the chirp in the same buffer, so timing is exact. The synthetic test checks that a chirp preceded by it still decodes byte for byte. It is only played when effects are on.

## Modules

```
src/protocol/drawing.ts   n×n pack/unpack (n multiple of 8)
src/protocol/packet.ts    v2 packets
src/game/noise.ts         line static
src/game/telephone.ts     state, turns, prompt with static, chain with static diffs, points, award
src/game/words.ts         word list
src/audio/handshake.ts    dial-up handshake samples
src/audio/sfx.ts          + 'static' crackle
src/state/sender.ts, src/audio/*, src/offline/*, src/ui/grid.ts   (kept)
src/main.ts               UI
```

Storage: `sessionStorage["dialup:v2"]`, one tab per player. v1 saves start fresh.

## Risks

| Risk | Mitigation |
|---|---|
| Longer drawing chirps get missed more often | Resend. Measure on hardware. Fall back to fewer bytes if needed |
| The handshake disturbs decoding on real devices | The effects switch turns it off. HW checklist item |
| Static feels unfair | Clear line option. The reveal shows exactly what static changed |
| Small cells on phones | Drag painting, the 21–26 rem editor, keyboard mode |
