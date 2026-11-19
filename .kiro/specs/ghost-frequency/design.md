# Ghost Frequency: Design

## Game design

Each device owns things the other can't see. Talking tells you *what* is needed, but only the ghost can *carry* it across, and only by sound. Turns alternate, so both players decide.

| Step | House (laptop) | Other Side (phone) | Who decides | The ghost carries |
|---|---|---|---|---|
| 1 Obstacle | 3 objects: 🏮 lantern, 🔔 bell, 🪞 mirror | 🌑 darkness / 🧛 vampire / 🕰️ silent clock (random) | House | object → |
| 2 Keyhole | keyhole ★ ☾ ☠ ♥ (random) | 4 keys (after the room clears) | Other Side | ← key |
| 3 Rune | 4×4 paint grid | rune carved on the exit (1 of 6, random) | House paints, Other Side checks | rune → |
| Free | win screen and stats | win screen | | ← "free" |

**Spirit energy:** 3 candles. A wrong object, key, or rune puts one out, and the ghost fades on screen. At 0 it disappears. Energy travels in every message, so both screens agree.

A perfect run takes 4 chirps (about 2.4 s each). Each mistake adds 2. That fits a 3-minute video, including one mistake.

**Authority:** whoever owns the secret checks it. The Other Side checks the object and the rune. The House checks the key. No secret is ever transmitted.

## Stack

- TypeScript + Vite, vanilla DOM. ggwave 0.4.0 (MIT) vendored to `public/vendor/ggwave.js`.
- Vitest + fast-check, with real ggwave WASM in Node.
- @vitejs/plugin-basic-ssl for LAN HTTPS. GitHub Pages for the deployed app.

## ggwave integration (from the upstream browser example)

Classic script with global `ggwave_factory()`. The AudioContext rate is passed to ggwave. AUDIBLE_FAST protocol. Mic constraints off (echoCancellation, AGC, noiseSuppression). A 1024-frame ScriptProcessor feeds `decode`. Returned views are copied immediately. `Uint8Array` payloads work. Unlike upstream, we stop the mic tracks.

## Message format v3, max 26 bytes

| Offset | Size | Field |
|---|---|---|
| 0 | 1 | Magic/version `0xA3` |
| 1 | 1 | bit0 direction · bits1–2 stage (1–3) · bits3–5 item · bits6–7 energy |
| 2 | 1 | bit0 ok (rune verdict) · bits1–7 = 0 |
| 3 | 2 | Ghost ID, uint16 BE |
| 5 | 1 | Transfer ID |
| 6 | 8 | Drawing (the rune as 2×2 blocks on a stage 3 release) |
| 14 | 1 | Name length N (1–10) |
| 15 | N | Name, printable ASCII |
| 15+N | 1 | CRC-8 (poly 0x07) |

Items: 0 none, 1 lantern, 2 bell, 3 mirror, 4 star, 5 moon, 6 skull, 7 heart. Synthetic duration for 26 bytes: **2347 ms**.

## Modules

```
src/protocol/  drawing, crc8, message         pure
src/game/      rules (data), house, other     pure state machines
src/state/     transfers: dedupe, own-echo, dispatch to role, stats, persistence per role
src/audio/     modem, listener, player, visualizer (AnalyserNode spectrum), sfx (synthesized)
src/ui/        grid (N×N editor), ghost (glowing sprite, materialize, candles)
src/main.ts    rendering and wiring
```

House phases: `object → away → (object | key-retry | rune) → … → free | faded`.
Other phases: `waiting → (blocked | keys) → sent → … → freed → over`.

## Presentation

- Dark "séance" theme. The ghost is drawn from the player's own 8×8 pixels, glows, and floats.
- On arrival the ghost materializes pixel by pixel. While sending it drifts. It fades with lost energy.
- A live spectrum shows the tones (green when sending, violet when listening).
- Synthesized effects for arrive, success, fail, creak, and fade. They play only after an event.
- `prefers-reduced-motion` disables all animation.

## Risks

| Risk | Mitigation |
|---|---|
| Sound fails on the user's hardware | Real-device test first |
| iOS silent mode mutes Web Audio | On-screen instruction |
| Effects heard by the other mic | Not ggwave-shaped, so they never decode. Only played after events |
| Judges have one device | Two windows, per-tab role, per-role storage |
| Rune described badly | 4×4 blocks, 1 block tolerance, "N blocks wrong" feedback |
