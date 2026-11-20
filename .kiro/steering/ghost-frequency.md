# Dial-Up Telephone: project rules

(The file keeps its original name. The project was the "Ghost Frequency" ghost game until it was replaced by Dial-Up Telephone.)

- Spec: #[[file:.kiro/specs/ghost-frequency/requirements.md]] and #[[file:.kiro/specs/ghost-frequency/design.md]].
- Game data moves **only** speaker → microphone. Never add network, WebRTC, Bluetooth, QR, or shared-storage transfer paths.
- Keep protocol, game state, and audio generation separate. `src/protocol`, `src/game`, `src/state`, and `src/audio/handshake.ts` stay pure (no DOM, no audio APIs) so they can be tested in Node.
- Every behavior change gets a vitest test. Use fast-check properties for encode/decode, static, and dedupe rules.
- Packets stay ≤ 46 bytes (drawings). Guesses and control packets stay ≤ 26 bytes.
- Line static is a game effect applied on screen, never to transmitted bytes, and it must be deterministic on every device.
- When reporting progress, separate **automated results** (`npm.cmd run check`), **browser checks** (`npm.cmd run screens`, no sound), and **hardware checks** the developer still has to run. Never claim a hardware criterion passed.
- No runtime requests to third-party origins. Vendor every asset. Synthesize sounds in code.
- On Windows PowerShell, use `npm.cmd`, not `npm`.
- Plain, short UI text that tells the player what to do next.
- Don't push or deploy unless the developer asks.
