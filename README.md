# Ghost Frequency

A two-player rescue adventure for Kiroween 2026 (Resurrection category). It brings the **acoustic modem** back from the dead: a ghost you draw travels between a laptop and a phone **only as sound**. No Wi-Fi, Bluetooth, server, or account is involved.

**Play:** https://urvishapatel1511.github.io/Ghost_frequency/ (the published version updates when changes are pushed to `main`)

## The adventure

One player is **the House** (laptop), and the other is **the Other Side** (phone). Each sees clues the other can't, so you have to talk. Only the ghost can carry answers across, as chirps.

0. **Summon:** the House draws a ghost (8×8) and names it. The chirp carries it to the Other Side, which must press **Accept**. That pairs the two devices, and nearby games are ignored.
1. **The obstacle** (the House decides): the Other Side's room is blocked by darkness, a vampire, or a silent clock. The House sends a lantern, mirror, or bell. The right one visibly changes the room and reveals four keys.
2. **The lock** (the Other Side decides): the House sees the notches and an engraved metal rule. The Other Side sees four keys, each with teeth and a metal. Exactly one key fits both clues, and neither screen alone is enough.
3. **The lying mirror** (the House paints, the Other Side checks): the Other Side sees the exit rune reflected left-to-right. The House paints the true 4×4 rune. One wrong block is allowed. The seal breaks when it matches.
4. **Bonus, Rescue the Hat:** the ghost is already free. Want its tiny hat too? Each player knows two possible spots, and only one spot is on both lists. Skip any time.

Every ghost has a personality (shy, dramatic, mischievous, or sleepy), derived from its ID so both devices agree. It reacts to arrivals, successes, mistakes, the last candle, and the rescue. There are **three candles**: wrong answers cost one. Missed or garbled chirps never do; just press Resend.

The ending shows your original drawing (with the hat, if you earned it), a farewell, candles, puzzles, and time. **Play again** and **Swap roles** are explained on both screens; each device chooses for itself.

**Offline:** while online, tap **📦 Prepare for offline play** on both devices. Then Wi-Fi and Bluetooth can be turned off. **One device:** open two browser windows, one role in each.

## Develop

```powershell
npm.cmd install
npm.cmd run check     # typecheck + production build + automated tests (synthetic waveform, no air path)
npm.cmd run screens   # optional: renders game states in Microsoft Edge and saves docs/screenshots/
npm.cmd run dev:https # HTTPS on the LAN for phone microphone access
```

- Real-device test: [docs/hardware-test.md](docs/hardware-test.md). Results: [docs/hardware-log.md](docs/hardware-log.md).
- Publishing: [docs/publish.md](docs/publish.md).
- How Kiro was used: [docs/kiro-log.md](docs/kiro-log.md).

## How it works

- `src/protocol`: message format **v4**, at most 26 bytes: stage, item, energy, ok/hat flags, a 4-bit pairing tag, ghost ID, transfer ID, the 8-byte drawing, the name, and a CRC-8.
- `src/game`: pure state machines for the House and the Other Side. Puzzles are generated from the ghost ID, so no secret ever travels. Also the reaction lines.
- `src/state`: duplicate, own-echo, and stale-chirp filtering, pairing, persistence per role, and a send gate that commits game state only after a chirp has actually played.
- `src/audio`: ggwave (vendored, MIT) turns bytes into sound and back. Also a live spectrum and synthesized, switchable effects that never overlap a chirp.
- `src/offline`: the service worker cache and the "Prepare for offline play" check.

Spec, design, and tasks: `.kiro/specs/ghost-frequency/`. Third-party licenses: `THIRD_PARTY_NOTICES.md`.
