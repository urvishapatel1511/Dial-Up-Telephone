# Real-device test: one full rescue

Goal: a complete adventure where **every** message between the laptop and the phone travels as sound. Nobody has run this test yet. Record what you see in `docs/hardware-log.md`.

The automated tests (`npm.cmd run check`) include a *synthetic* ggwave test: samples go straight from the encoder to the decoder, with no speaker and no microphone. Only this checklist tests the real air path.

## A. Open the game on both devices

Use either option.

**Option 1: published site (recommended, also tests offline)**
1. Open `https://urvishapatel1511.github.io/Ghost_frequency/` on the laptop and the phone, both online. GitHub Pages must be enabled; see `docs/publish.md`.
2. On both, tap **📦 Prepare for offline play** and wait for "✓ Ready for offline play". If it says "reload this page once", do that and tap Prepare again.
3. Turn off **Wi-Fi and Bluetooth** on both devices, then **reload** both pages. The game must still load.

**Option 2: test server on the laptop (no offline mode)**
1. Laptop and phone on the same Wi-Fi. In the Kiro terminal, run `npm.cmd run dev:https` and note the `Network:` address.
2. Laptop: `https://localhost:5173/`. Phone: the `Network:` address. Accept the certificate warning (Advanced → Proceed, or Show Details → visit this website).
3. After both pages have loaded, you may turn off Wi-Fi and Bluetooth. Don't reload.

## B. Prepare

- Volume high on both. iPhone: silent mode off. Close other apps that use the microphone.
- Devices 30–50 cm apart, speakers facing each other.
- Laptop: **The House**. Phone: **The Other Side**. Each window asks for its role. A new window never inherits one.
- On both, tap **🎙 Start listening** and allow the microphone. The status bar should say "● Listening".

## C. Play (make at least one mistake on purpose)

| # | Device | Do | Expect |
|---|---|---|---|
| 1 | Phone | Read the room out loud (darkness, vampire, or clock) | – |
| 2 | Laptop | Draw a ghost, type a name, press **Summon** | Status: "Chirp played…". It must **not** say the ghost arrived |
| 3 | Phone | – | "<name> is calling". The ghost appears pixel by pixel, identical to the laptop drawing |
| 4 | Laptop | Press **Resend last chirp** | Phone: "Heard the same chirp again. Nothing changed." |
| 5 | Phone | Press **Accept** | Laptop: "<name> reached the Other Side and was welcomed in!" |
| 6 | Laptop | Pick a **wrong** object, send | Phone: "doesn't help", 2 candles. The phone sends the ghost home. Laptop: "came home empty-handed" |
| 7 | Laptop | Pick the right object, send | Phone: the room reacts (darkness lifts / vampire flees / clock opens), and four keys appear |
| 8 | Both | Laptop describes notches and engraving. Phone compares teeth and metal | Exactly one key fits both clues |
| 9 | Phone | Send the key | Laptop: "The … key fits! The lock clicks open." |
| 10 | Both | Phone describes the mirror image, row by row. Laptop paints the true rune (flip left/right) | – |
| 11 | Laptop | Send the rune | Phone: the seal breaks. The phone sends the ghost home free. Laptop: bonus offer |
| 12 | Both | Compare hat clues. Laptop picks a spot (or Skip) | Phone shows the result and sends it. Both show the ending, with the hat if found |
| 13 | Both | Press **Play again** on both | New room, new drawing screen. An old chirp replayed is ignored |

## D. Extra checks

- **Refresh** the laptop mid-game and the phone mid-game. Each resumes the same stage and shows **Resume listening**.
- **Switch tabs** while listening and come back. The mic indicator turns off, and **Resume listening** is highlighted.
- **Block the microphone** in site settings and press Start listening. The blocked-mic instructions appear, with **Try again**.
- **Sound effects off** (⚙ Settings). Chirps still play.
- **Second nearby game:** if you have a third device, summon another ghost while paired. The paired phone says "another game nearby. Ignored."
- **One device:** two browser windows on the laptop, one per role. Play through.

## E. Measurements to log

- Chirp seconds (shown after each send, also in Settings → Diagnostics).
- Chirps needed per message in a quiet room, and again with people talking (5 tries each).
- **First-time players:** total time from Summon to the ending (target 5–8 minutes), and where they got stuck.

## If it fails

| Symptom | Try |
|---|---|
| Nothing is heard | Volume up, move closer, press Resend. Check the phone's silent switch |
| "garbled chirp" | Resend. Note it in the log |
| Laptop doesn't hear the phone | Point the phone's bottom speaker at the laptop mic, 20 cm |
| "Audio didn't start" | Tap Try again. If it repeats, reload |
| Mic never asks | The page is not https:// |
