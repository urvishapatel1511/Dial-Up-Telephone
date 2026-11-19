# Ghost Frequency: project rules

- Spec: #[[file:.kiro/specs/ghost-frequency/requirements.md]] and #[[file:.kiro/specs/ghost-frequency/design.md]].
- Ghost data moves **only** speaker → microphone. Never add network, WebRTC, Bluetooth, or QR transfer paths.
- Keep protocol, state, and audio separate. `src/protocol` and `src/state` stay pure (no DOM, no audio) so they can be tested in Node.
- Every behavior change gets a vitest test. Use fast-check properties for encode/decode and dedupe rules.
- When reporting progress, separate **automated results** (`npm.cmd test`) from **hardware checks** the developer still has to run. Never claim a hardware criterion passed.
- No runtime requests to third-party origins. Vendor every asset.
- On Windows PowerShell, use `npm.cmd`, not `npm`.
- Plain, short UI text that tells the player what to do next.
