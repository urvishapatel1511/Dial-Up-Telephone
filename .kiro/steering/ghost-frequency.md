# Dial-Up Telephone: project rules

(The file keeps its original name. The project was the "Ghost Frequency" ghost game until it was replaced by Dial-Up Telephone.)

- Spec: #[[file:.kiro/specs/ghost-frequency/requirements.md]] and #[[file:.kiro/specs/ghost-frequency/design.md]].
- Game data moves **only** speaker → microphone. Never add network, WebRTC, Bluetooth, QR, or shared-storage transfer paths.
- Keep protocol, game state, and audio separate. `src/protocol`, `src/game`, and `src/state` stay pure (no DOM, no audio) so they can be tested in Node.
- Every behavior change gets a vitest test. Use fast-check properties for encode/decode and dedupe rules.
- Packets stay ≤ 26 bytes.
- When reporting progress, separate **automated results** (`npm.cmd run check`), **browser checks** (`npm.cmd run screens`, no sound), and **hardware checks** the developer still has to run. Never claim a hardware criterion passed.
- No runtime requests to third-party origins. Vendor every asset.
- On Windows PowerShell, use `npm.cmd`, not `npm`.
- Plain, short UI text that tells the player what to do next.
- Don't push or deploy unless the developer asks.
