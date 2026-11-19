# Ghost Frequency

A cooperative two-device puzzle for Kiroween 2026 (Resurrection). The acoustic modem comes back as a game mechanic: you draw an 8×8 ghost on one device, and it travels to the other device as audible sound. No network is involved.

Current state: playable 3-step game with spirit energy, haunted visuals, a live sound spectrum, and offline mode. Progress is tracked in `.kiro/specs/ghost-frequency/tasks.md`.

## Run

```powershell
npm.cmd install
npm.cmd test          # automated tests (Node, real ggwave WASM, no air path)
npm.cmd run dev:https # HTTPS on the LAN for phone microphone access
```

Real-device steps: [docs/hardware-test.md](docs/hardware-test.md). Results go in [docs/hardware-log.md](docs/hardware-log.md).

Publishing and offline testing: [docs/publish.md](docs/publish.md). Every push to `main` builds, tests, and deploys to GitHub Pages.

## How it works

- `src/protocol`: 8×8 drawing → 8 bytes. Message up to 25 bytes: magic, direction, key, ghost ID, transfer ID, drawing, name, CRC-8.
- `src/state`: pure reducer for dedupe, own-echo filtering, key/door logic, and localStorage persistence.
- `src/audio`: ggwave (vendored, MIT) for modulation and decoding. Microphone on only while listening.

Spec, design, and tasks: `.kiro/specs/ghost-frequency/`. Third-party licenses: `THIRD_PARTY_NOTICES.md`.
