# Dial-Up Telephone

The classic **telephone** drawing game, played over a resurrected **1980s acoustic modem**. Made for Kiroween 2026 (Resurrection category). Every drawing and guess hops between phones **only as audible chirps**. No Wi-Fi, no Bluetooth, no server, no accounts.

**Play:** https://urvishapatel1511.github.io/Dial-Up-Telephone/ (the live site updates when changes are pushed to `main`)

> This repository started as "Ghost Frequency" (renamed from `Ghost_frequency`), a two-player ghost puzzle. It was replaced by this party game. The ghost version is still in git history (commit `62f79bf`).

## What makes it a *bad connection*

- **Line static:** the host picks the phone line: 📞 Clear, 📡 Crackly, or 👻 Haunted. On noisy lines, every hop flips some squares of the drawing and swaps letters in the guess ("PIZZA" arrives as "PIZZO"). The static is the same on every phone, and the reveal shows exactly what it changed.
- **16×16 drawings**, so doodles can actually be funny.
- **The dial-up screech:** with sound effects on, each chirp starts with a synthesized dial-up handshake.
- **The reveal show:** ▶ Play the show steps through the chain with crackles. Then come scores (drawer and guesser each get a point when a guess matches what the drawer was given) and the **🏆 Worst Connection award**, voted out loud and chirped by the host to every phone.

## How to play (2–8 players, best with 3+)

1. Everyone opens the page, types a name, and allows the microphone. Sit in a circle in seat order.
2. **Players** press *Join a game*, pick their seat (2–8), and press *I'm ready*.
3. **The host** (seat 1) presses *Host a game*, chooses the number of players and the phone line, checks the secret word (re-roll or type your own), and presses *Start*. The start signal chirps out, and every ready phone joins.
4. The host draws the secret word on a 16×16 grid and sends it. Seat 2 sees **only** that drawing, with static, and guesses. Seat 3 sees only the guess and draws it. And so on.
5. When the last seat has played, the host presses **Reveal**. One chirp, and every phone shows the whole chain: "pumpkin" → 🎃 → "orange" (arrived as "orangk") → ☀️ → "sun". Then scores and the Worst Connection vote.

Missed a chirp? The sender presses **Resend**. Duplicates change nothing. The line on every screen shows who is up next, without showing anyone's entry.

**Offline:** tap *📦 Prepare for offline play* while online, then turn off Wi-Fi and Bluetooth. **One device:** open several browser windows, one player per window.

## Why sound?

One chirp reaches every phone in the room at once. That broadcast is what lets every device build the same reveal with no network at all. Each chirp shows how many bytes it carried (at most 46 for a drawing, 26 for a guess) and how long it lasted.

## Develop

```powershell
npm.cmd install
npm.cmd run check     # typecheck + production build + automated tests (synthetic waveform, no air path)
npm.cmd run screens   # optional: renders game screens in Microsoft Edge, saves docs/screenshots/
npm.cmd run dev:https # HTTPS on the LAN for phone microphone access
```

- Real-device test: [docs/hardware-test.md](docs/hardware-test.md). Results: [docs/hardware-log.md](docs/hardware-log.md).
- Publishing: [docs/publish.md](docs/publish.md). How Kiro was used: [docs/kiro-log.md](docs/kiro-log.md).

## How it works

- `src/protocol/packet.ts`: `start` / `entry` / `reveal` / `award` packets, at most 46 bytes, with a CRC-8.
- `src/game/noise.ts`: deterministic line static, applied on screen (the chirp itself carries the exact entry).
- `src/game/telephone.ts`: pure game state for one player: joining, turns, secrecy, static, reveal, points, award, replay, duplicate/stale handling.
- `src/audio/handshake.ts`: the synthesized dial-up handshake, tested to never block decoding.
- `src/state/sender.ts`: commits a move only after its chirp has actually played. A failed playback can be retried with identical bytes.
- `src/audio`: ggwave (vendored, MIT) turns bytes into sound and back. Also a live spectrum and switchable effects that never overlap a chirp.
- `src/offline`: the service worker and the "Prepare for offline play" check.

Spec, design, and tasks: `.kiro/specs/ghost-frequency/`. Third-party licenses: `THIRD_PARTY_NOTICES.md`.
