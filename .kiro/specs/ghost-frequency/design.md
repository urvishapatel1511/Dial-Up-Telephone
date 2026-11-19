# Ghost Frequency: Design (v4)

## Flow

| # | Chirp | Stage | Carries | Who checks |
|---|---|---|---|---|
| 1 | House → summon | 1 | drawing, name, ghost ID | – |
| 2 | Other → **accept** | 1 | partner tag (1–15) | House pairs |
| 3 | House → object | 2 | lantern / bell / mirror | Other (owns the obstacle) |
| 4 | Other → key (or empty-handed) | 2 | key symbol, or none + energy | House (key) |
| 4b | House → back for another key | 3 | – | – |
| 4c | Other → key | 3 | key symbol | House |
| 5 | House → painted rune | 4 | 4×4 rune as 2×2 blocks in the drawing slot | Other (owns the mirror) |
| 6 | Other → verdict | 4 | ok, energy | House |
| 7 | House → hat spot **or** farewell | 5 / 6 | spot, or ok=true | Other (hat) |
| 8 | Other → hat verdict | 5 | hat flag | House |

A perfect run with the bonus is 8 chirps (≈ 2.3 s each, ≈ 19 s of sound). Each mistake adds 2 chirps. Most of the 5–8 minute target is spent talking (to be confirmed by playtesting; see `docs/hardware-log.md`).

**Authority:** whoever owns a secret checks it. The obstacle and rune are rolled locally on the Other Side and never transmitted. The lock and hat puzzles are generated deterministically from the ghost ID (mulberry32 seed), so both devices build the same puzzle and each shows only its half. Personality also comes from the ghost ID.

## Message format v4 (magic `0xA4`, ≤ 26 bytes)

| Offset | Size | Field |
|---|---|---|
| 0 | 1 | `0xA4` |
| 1 | 1 | bit0 direction · bits1–3 stage (1–6) · bits4–7 item (0–11) |
| 2 | 1 | bits0–1 energy · bit2 ok · bit3 hat · bits4–7 = 0 |
| 3 | 2 | ghost ID (uint16 BE) |
| 5 | 1 | transfer ID |
| 6 | 8 | drawing (or painted rune on stage 4 releases) |
| 14 | 1 | bits0–3 name length (1–10) · bits4–7 partner tag (0 = unpaired) |
| 15 | N | name |
| 15+N | 1 | CRC-8 (poly 0x07) |

Items: 0 none, 1 lantern, 2 bell, 3 mirror, 4 star, 5 moon, 6 skull, 7 heart, 8 pumpkin, 9 books, 10 chair, 11 coffin.

**Tradeoff:** v4 needed more stages, more items, a hat flag, and a partner tag. It stays at 26 bytes by packing the partner tag into the unused high nibble of the length byte, and by widening stage/item into byte 1 while moving energy to byte 2. A 4-bit tag means two phones accepting the same summon at the same moment have a 1-in-15 chance of picking the same tag. That's acceptable for a party game, and it's documented. v1–v3 chirps fail the magic check.

## Modules

```
src/protocol/message.ts   v4 encode/decode
src/game/rules.ts         objects, obstacles, runes + mirror, spots, data tables
src/game/puzzles.ts       seeded RNG; lock puzzle + hat puzzle generators and solvers; personality
src/game/reactions.ts     personality reaction lines
src/game/house.ts         House state machine
src/game/other.ts         Other Side state machine
src/state/transfers.ts    dedupe, own-echo, retired ghosts, routing, persistence (key ghostfreq:v4:<role>)
src/state/sender.ts       send gate: play first, commit only on success; one send at a time
src/audio/*               modem, listener, player, visualizer, sfx (returns duration, switchable)
src/ui/grid.ts            roving-tabindex grid editor
src/ui/ghost.ts           sprite with personality class, hat overlay, candles
src/main.ts               rendering, audio state machine, wiring
```

### House phases
`summon → away(1) → object → away(2) → [object | key-retry → away(3) | rune] → away(4) → [rune | bonus] → away(5) → free`. Also: `bonus → (skip: farewell played) → free`, and `faded` (with `farewellSent`).

### Other Side phases
`waiting → calling → (accept) sent → blocked | keys → sent → … → rune-bad | freed → over(ended=free, bonus=null)`. A hat release moves it to `hat-reply → over(bonus=won|lost)`. A farewell sets `bonus=skipped`. Energy 0 moves it to `over(ended=faded)`.

## Audio state machine (UI)

`off → starting (factory + resume, 10 s timeout) → mic (getUserMedia prompt) → listening`. During a send: `playing`, then back to `listening`. The listening label reads "waiting for the reply" when the game waits on the other device. Any failure → `error` with **Try again**. Hidden page → `off` + `resumeNeeded`.

## Sender (`src/state/sender.ts`)

`SendGate.run(out, play, commit)`: rejects a second call while one is busy, plays the bytes, then commits `out.state` only after playback resolves. A failure leaves the state untouched, so the retry rebuilds identical bytes: the transfer ID was not advanced.

## Visuals

The haunted purple and green theme stays. A sticky status bar holds the audio state, candles, and Listen/Resume/Resend. The intro has a setup guide and role cards. On wide screens, two columns: the ghost panel (sprite, name, personality, reaction bubble, progress track) and the task panel. The Other Side's room is drawn with code-native layers (emoji plus CSS veils, a clock door, a vampire, a seal) that animate on success. `[hidden] { display: none !important }`.

## Risks

| Risk | Mitigation |
|---|---|
| Effects corrupt an outgoing chirp | Sends wait for effects to finish. Effects never start during a send. Switch to turn them off |
| Playback fails after the receiver heard part of it | A partial chirp can't decode (CRC + RS). The rare case of a full chirp with a reported failure is documented |
| Two phones pair at once | 4-bit partner tag. The House binds to the first accept |
| iOS silent mode | Setup guide |
| One device only | Two windows. The role is per tab |
