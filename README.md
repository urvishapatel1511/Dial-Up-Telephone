# Dial-Up Telephone

The classic **telephone** drawing game, played over a resurrected **1980s acoustic modem**. Made for Kiroween 2026 (Resurrection category). Every drawing and guess hops between phones **only as audible chirps**. No Wi-Fi, no Bluetooth, no server, no accounts.

**Play:** https://urvishapatel1511.github.io/Dial-Up-Telephone/ (the live site updates when changes are pushed to `main`)

> This repository started as "Ghost Frequency" (renamed from `Ghost_frequency`), a two-player ghost puzzle. It was replaced by this party game. The ghost version is still in git history (commit `62f79bf`).

## What's new in 0.2.0 (sound protocol v4)

- **Confirmed delivery:** a chirp that finished playing shows "Waiting for confirmation", never "received". The next player's phone answers each turn with a short "got it" chirp, and each phone confirms the start and the results in its own time slot. If no confirmation comes, the sender plays the same chirp again by itself (at most twice for a turn, once for a start or results), then offers a retry button. Copies never repeat a turn or score twice.
- **Same names are fine:** each browser tab has its own player ID, so two players called "Bo" on different seats both stay in the roster and keep separate scores. Two phones on the same seat are always flagged, even with the same name.
- **Ties:** equal points share a rank (5, 5, 3 → 1, 1, 3) and the same highlight, with "Joint winners".
- **Updates:** the footer shows the app version. A new version shows "Update available · Reload to update" and never reloads by itself. Update between games: phones on different sound protocol versions can't talk, and say so.

## v3 "Party Line"

- **Two ways to play:** ⚡ *Quick Round* (one chain) or 🏆 *Party Match* (three rounds with running totals and a final celebration). The first drawer moves one seat each round, so everyone gets to draw and to guess.
- **Prompt categories:** Mix of everything, Spooky, Everyday things, Animals & food, and Silly combos ("ghost taxi", "vampire DJ", "zombie chef"…). The first drawer picks the word privately, rerolls it, or types their own.
- **Direct touch drawing:** touch an empty square to draw, start on a filled square to erase, and drag to continue. Undo/Redo (one step per stroke), an optional large brush, Clear with confirmation, and a full-screen Bigger canvas with Done.
- **Ready check:** the host sees who is really ready (their microphone works and their ready message arrived), duplicate seats, and missing seats. Start unlocks only when every seat is confirmed.
- **Clear round flow:** Reveal → Awards (optional) → Results → Next round. Each phone confirms the results by sound, so the host sees who got them.
- **Static you can laugh at:** on Crackly and Haunted lines, guesses twist into recognizable words (CAT → BAT, GHOST → GOAT) before falling back to nonsense letters. When static changed a clue, the next player is told: *"Draw whatever this makes you imagine—even if it's nonsense."*
- **Recovery that works:** every phone knows which hops it missed. Tap **Ask for it by sound** and only the author's phone answers, so two phones never chirp at once. The host can't reveal while a hop is missing (unless they choose "Reveal with missing hops"), and hops recovered after the reveal fill the gap.
- **Less waiting:** the dial-up handshake plays only when a round starts. Turns, requests, and resends are just the data chirp.
- **A better reveal:** each drawing shows *Sent* and *Arrived* side by side, with the static squares outlined, plus a caption like "“CAT” became “CITY”!". Play/Pause, Previous, Next, and Show all.
- **Fair scoring for any size:** a matching guess scores the drawer and the guesser. With an odd number of players, the room guesses the last drawing out loud, so every player has exactly one chance to score per round. Then three awards, voted out loud and chirped by the host: 🤣 Funniest Transformation, 🎯 Most Recognizable Drawing, and 💪 Best Recovery.

## How to play (2–8 players, best with 3+)

1. Everyone opens the page, types a name, and allows the microphone. Sit in a circle in seat order.
2. **The host** (seat 1) presses *Host a game*. **Players** press *Join a game*, pick their seat (2–8), and press *I'm ready*. Their names appear on the host's screen.
3. The host picks Quick Round or Party Match and the number of players (line quality and prompt category are under *Customize*), taps *Check who's ready* if anyone is missing, and presses *Start*.
4. The first drawer picks a secret word and draws it on a 16×16 grid. The next player sees **only** that drawing (with static) and guesses. The next sees only the guess and draws it. And so on.
5. When the last player is done, the host presses **Reveal**. One chirp, and every phone shows the whole chain. Vote for the awards out loud, and the host chirps the results. In a Party Match, the host then starts the next round and everyone joins automatically.

Missed a chirp? Tap **Ask for it by sound**. Duplicates change nothing, and resending never changes scores. The line on every screen shows each player's turn, who is up now, and whether your turn was *played* or *received*, without showing anyone's entry.

**Offline:** tap *📦 Prepare for offline play* while online, then turn off Wi-Fi and Bluetooth. **One device:** open several browser windows, one player per window.

## Why sound?

One chirp reaches every phone in the room at once. That broadcast is what lets every device build the same reveal with no network at all. Each chirp shows how many bytes it carried (at most 58 for the first drawing, which also carries the secret word; 46 for other drawings; 26 for a guess; 7–17 for control signals) and how long it lasted. Confirmations ("got it", start, results) are 8 bytes.

## Develop

```powershell
npm.cmd install
npm.cmd run check     # typecheck + production build + automated tests (synthetic waveform, no air path)
npm.cmd run screens   # optional: renders game screens in Microsoft Edge, saves docs/screenshots/
npm.cmd run dev:https # HTTPS on the LAN for phone microphone access
```

- Real-device test and group playtest checklist: [docs/hardware-test.md](docs/hardware-test.md). Results: [docs/hardware-log.md](docs/hardware-log.md).
- Publishing: [docs/publish.md](docs/publish.md). How Kiro was used: [docs/kiro-log.md](docs/kiro-log.md).

## How it works

- `src/protocol/packet.ts`: v4 packets `start` / `entry` / `reveal` / `results` / `need` / `call` / `hello` (with a player ID) / `ack` (results, start, or "got hop k"), at most 58 bytes, with a CRC-8. Chirps from older or newer versions are reported, never misread.
- `src/game/schedule.ts`: time slots for automatic replies, so phones answering a ready check or confirming never chirp at once, and how long each chirp keeps the line busy.
- `src/game/delivery.ts`: playing → waiting → confirmed / no confirmation yet, with bounded retries by the sender only. `src/game/ranking.ts`: competition ranks for tied scores.
- `src/game/telephone.ts`: pure game state for one player: joining, turns, secrecy, static, missing-hop tracking and recovery, reveal, scores, awards, Party Match totals, duplicate/stale handling.
- `src/game/match.ts`: the rotation and the one-chance-per-player rule. `src/game/words.ts`: prompt categories. `src/game/noise.ts`: deterministic line static with curated twists. `src/game/captions.ts`: factual reveal captions.
- `src/game/canvas.ts` + `src/ui/editor.ts`: the drawing model (the start square decides paint or erase, stroke-level undo/redo, brushes) and its accessible editor (pointer capture for mouse, touch, and pen).
- `src/audio/handshake.ts`: the synthesized dial-up handshake (start of a round only), tested to never block decoding.
- `src/state/sender.ts`: commits a move only after its chirp has actually played. A failed playback can be retried with identical bytes.
- `src/audio`: ggwave (vendored, MIT) turns bytes into sound and back. Also a live spectrum and switchable effects that never overlap a chirp.
- `src/offline`: the service worker, the "Prepare for offline play" check, and the update prompt (a new version waits until the player taps Reload to update).

Spec, design, and tasks: `.kiro/specs/ghost-frequency/`. Third-party licenses: `THIRD_PARTY_NOTICES.md`.
