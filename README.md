# Ghost Frequency

A cooperative escape game for two devices, made for Kiroween 2026 (Resurrection category). It brings the **acoustic modem** back from the dead: a ghost you draw travels between a laptop and a phone **only as sound**. No Wi-Fi, Bluetooth, server, or account is needed.

**Play:** https://urvishapatel1511.github.io/Ghost_frequency/

## How to play

One player is **the House** (laptop), and the other is **the Other Side** (phone). Each sees things the other can't, so you must talk. Only the ghost can carry things across, by sound.

1. **Summon:** the House draws a ghost on an 8×8 grid and names it.
2. **The obstacle (the House decides):** the Other Side's room is blocked by darkness, a vampire, or a silent clock. They describe it, and the House sends the ghost carrying the right object (lantern, mirror, or bell). The room clears and four keys appear.
3. **The keyhole (the Other Side decides):** the House describes its secret keyhole (★ ☾ ☠ ♥), and the Other Side sends the ghost home with one key.
4. **The rune (the House paints, the Other Side checks):** a rune is carved on the Other Side's exit door. They describe it on a 4×4 block grid, the House paints it, and the ghost wears it across. One wrong block is allowed.

The ghost has **3 candles** of spirit energy. Every wrong object, key, or rune puts one out. Lose all three and the ghost fades. Win, and both screens show the ghost free, with the time, candles left, and how many bytes and seconds of sound it took.

The obstacle, keyhole, and rune are random in every game. With only one device, open the page in two browser windows, one for each role.

**Offline:** while online, tap **📦 Prepare for offline play** on both devices. Then turn off Wi-Fi and Bluetooth. The game still loads and plays.

## Run locally

```powershell
npm.cmd install
npm.cmd test          # automated tests (Node, real ggwave WASM, no air path)
npm.cmd run dev:https # HTTPS on the LAN for phone microphone access
```

Real-device steps: [docs/hardware-test.md](docs/hardware-test.md). Results go in [docs/hardware-log.md](docs/hardware-log.md).
Publishing: [docs/publish.md](docs/publish.md). Every push to `main` builds, tests, and deploys to GitHub Pages.

## How it works

- `src/protocol`: the 8×8 drawing packs into 8 bytes. A message is at most 26 bytes: version, direction, step, item, energy, ghost ID, transfer ID, drawing, name, and a CRC-8 checksum.
- `src/game`: the House and Other Side rules as pure state machines.
- `src/state`: duplicate and own-echo filtering, sending rules, stats, and saving progress per role.
- `src/audio`: ggwave (vendored, MIT) turns bytes into sound and back. Also a live spectrum and synthesized sound effects. The microphone is on only while listening.
- `src/offline`: the service worker cache and the "Prepare for offline play" check.

Spec, design, and tasks: `.kiro/specs/ghost-frequency/`. Third-party licenses: `THIRD_PARTY_NOTICES.md`.
