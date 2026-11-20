# Real-device test: one round of Dial-Up Telephone

Nobody has run this test yet. Record what you see in `docs/hardware-log.md`. The automated ggwave test is *synthetic* (no speaker, no microphone), so only this checklist tests the real air path.

You need **3 or more devices** (laptop + 2 phones is fine). With only two devices, play a 2-player round.

## A. Open the game

**Published site (recommended, also tests offline):**
1. Open `https://urvishapatel1511.github.io/Ghost_frequency/` on every device while online. The new version must be pushed first; see `docs/publish.md`.
2. On every device, tap **📦 Prepare for offline play** and wait for "✓ Ready". If it asks you to reload once, do that and tap Prepare again.
3. Turn off Wi-Fi and Bluetooth everywhere, then reload. The game must still load.

**Laptop test server (no offline mode):** run `npm.cmd run dev:https`. On the laptop open `https://localhost:5173/`; on the phones open the `Network:` address and accept the certificate warning.

## B. Prepare

- Volume high everywhere. iPhone: silent mode off. Devices within about 1 m, in a circle.

## C. Play

| # | Who | Do | Expect |
|---|---|---|---|
| 1 | Players | Type a name → **Join a game** → seat 2, 3, … → **I'm ready**. Allow the mic | "● Listening for the next chirp" |
| 2 | Host | Type a name → **Host a game** → set the player count → **Start** | Every player: "Connected! … You are seat N." The line appears |
| 3 | Host | Draw the word, **Send my drawing** | Seat 2: "Your turn!", with the drawing. Others: "Heard Asha (seat 1). Now seat 2 is up." |
| 4 | Seat 2 | Type a guess, send | Seat 3 sees only the guess. The line updates on every screen |
| 5 | Everyone | Continue to the last seat | Host: "Gather around for the reveal!" |
| 6 | Host | **Reveal the chain** | Every phone shows the chain card by card, and they all match |
| 7 | Everyone | Players press **Ready for the next round**, then the host presses **Host the next round** → Start | A new round starts. An old chirp replayed is ignored |

## D. Extra checks

- **Missed chirp:** cover one phone's mic while the previous player sends. Its screen says who to ask. That player presses **Resend**, and the turn arrives once.
- **Seat too high:** a player picks seat 6 in a 4-player game. They're told to pick a lower seat. After fixing it, the host's **Resend** lets them join.
- **Refresh** a phone mid-round. It resumes and offers **Resume listening**.
- **Secrecy:** while waiting, no phone shows the secret word or anyone else's entry.
- **Effects off** (⚙ Settings): chirps still play.

## E. Measure

- Chirp seconds (shown after each send, also in Settings → Diagnostics).
- Chirps needed per turn, in a quiet room and with people talking.
- Round length with first-time players, and whether people laughed at the reveal.

## If it fails

| Symptom | Try |
|---|---|
| Nothing heard | Volume up, move closer, ask the sender to Resend. iPhone silent switch |
| "garbled chirp" | Resend |
| "Audio didn't start" | Try again, or reload |
| Mic never asks | The page must be https:// |
