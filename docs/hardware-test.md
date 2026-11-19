# Real-device test (task 0)

Goal: laptop → phone → laptop by sound only, with Wi-Fi and Bluetooth off after the page loads.

> The prototype does not cache itself for offline use yet (that's task 4). For this test, load the page on both devices while they're on Wi-Fi, then turn radios off **without reloading**.

## A. Start the HTTPS dev server on the laptop

1. Put the laptop and the phone on the same Wi-Fi network.
2. In the project folder, run:
   ```powershell
   npm.cmd install
   npm.cmd run dev:https
   ```
   (`npm.cmd` avoids the PowerShell "running scripts is disabled" error.)
3. Vite prints a `Network:` URL such as `https://192.168.1.23:5173/`. If Windows Firewall asks, allow Node.js on **private** networks.

## B. Open the page on both devices

- **Laptop**: open `https://localhost:5173/`, choose Advanced → Proceed (self-signed certificate).
- **Phone**: type the `Network:` URL.
  - Android Chrome: "Your connection is not private" → Advanced → Proceed.
  - iPhone Safari: "This connection is not private" → Show Details → visit this website → Visit Website.
- Open **Diagnostics** on both devices. Check `secure context: true` and `audio engine: ggwave loaded`.

## C. Prepare the devices

- Phone: ringer/silent switch **off** (iOS mutes Web Audio in silent mode). Media volume high. Close other apps that use the mic.
- Laptop: volume 70–100 %. Turn off any "audio enhancements" or noise cancellation.
- Distance: 30–50 cm, phone mic pointed at the laptop speaker.
- Now turn **Wi-Fi and Bluetooth off on both devices**. Don't reload.

## D. Play one full game

Laptop → **The House**. Phone → **The Other Side**. On both, press **🎙 Listen** once and allow the microphone. After that, each device listens again automatically after it sends.

**Step 1: the obstacle (the laptop decides)**
1. Phone: read your haunted room out loud (darkness, a vampire, or a silent clock).
2. Laptop: draw a ghost, type a name, and pick an object. To test a mistake, pick a **wrong** one first. Press **Release**.
3. Phone: the ghost appears pixel by pixel, with the identical drawing and name. The wrong object costs a candle (2 left). Press **Send … home for something else**.
4. Laptop: "came home weaker". Pick the right object and release again. Phone: "it worked!" and four keys appear.
5. Laptop: press **Resend last chirp**. Phone: "Heard the same chirp again. Nothing changed," and no candle is lost.

**Step 2: the keyhole (the phone decides)**

6. Laptop: describe the keyhole out loud without showing the screen.
7. Phone: pick a key and send it home. Laptop: "The key fits! The door creaks open…"

**Step 3: the rune (the laptop paints)**

8. Phone: describe the rune on your exit door, block by block (4 × 4).
9. Laptop: paint it and press **Send … wearing the rune**.
10. Phone: "it matches!" → press **Send … home, free!**
11. Both: the win screen. The laptop shows the time, candles left, chirps, bytes, and seconds of sound.

**Extra checks**

12. Refresh the laptop mid-game. It should continue where it was.
13. Block the mic in site settings and press Listen. The blocked-mic instructions should appear.
14. One device only: open two browser windows side by side on the laptop, one House and one Other Side, and play.

Then repeat step 1 five times in a quiet room and five times with people talking. Log every attempt in `docs/hardware-log.md`.

## If it fails

| Symptom | Try |
|---|---|
| Phone shows nothing | Volume up, move closer, press Resend. Check the phone's ringer switch |
| "wasn't a ghost" | Partial decode. Resend. Note it in the log |
| Laptop doesn't hear the phone | Phone speakers are weak: point the phone's bottom speaker at the laptop mic, 20 cm |
| Mic never asks for permission | The page isn't secure. Use the `https://` URL |
| Works on Wi-Fi, not offline | Shouldn't happen (no network is used). Log it |
