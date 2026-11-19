# How Kiro was used (development log)

A factual record for the hackathon write-up. It lists only what happened in this repository. Physical-device results are not included, because none have been recorded yet (see `docs/hardware-log.md`).

## Tools and features actually used

- **Kiro IDE** with the agent, in one long session.
- **Spec-driven development:** `.kiro/specs/ghost-frequency/` holds `requirements.md` (EARS-style "WHEN … THE app SHALL …" criteria with [HW] tags for hardware-only checks), `design.md`, and `tasks.md`. The spec was rewritten at each major redesign (v1 prototype → v2 three rooms → v3 candles and theme → v4 "The Rescue") before the code changed.
- **Steering:** `.kiro/steering/ghost-frequency.md` pins the non-negotiables: sound-only transfer, pure protocol/state modules testable in Node, a test for every behavior change, fast-check for encode/decode and dedupe, separate automated and hardware results, no third-party runtime requests, and `npm.cmd` on Windows. Kiro loads it into every request.
- **Property-based testing** with fast-check, against the real ggwave WASM in Node.
- **Not used so far:** agent hooks, MCP servers, custom agents, Kiro powers. None are configured in `.kiro/`.

## Timeline of decisions

1. **Library choice.** We read ggwave's actual browser example (`examples/ggwave-js/index-tmpl.html`), its embind bindings, and its MIT license before integrating it. Findings recorded in the design:
   - `encode`/`decode` return views over static buffers, so they must be copied.
   - `Uint8Array` payloads work, so binary messages are possible.
   - The upstream example never stops mic tracks, so we stop them ourselves.
2. **Prototype first.** The first task was a plain two-device prototype (grid, name, Send, Listen, preview). The first physical test was put at the top of the task list.
3. **Redesigns driven by the developer's questions.** "Is the key always right?" and "who wins?" exposed that the v1 puzzle had no decisions. Each redesign updated requirements → design → tasks, then code and tests.
4. **v4 "The Rescue"** (this phase): pairing, the send gate, personality, lock deduction, the lying mirror, room reactions, the hat bonus, ending and replay, two-column layout, and keyboard grids.

## Problems hit, and how they were found

| Problem | Found by | Fix |
|---|---|---|
| PowerShell blocked `npm` (execution policy) | running it | Use `npm.cmd` (added to steering) |
| `npm install` failed with ENOTEMPTY | install log | Clean `node_modules`, reinstall |
| Kiro's PowerShell terminal crashed while rendering long commands (PSReadLine `SetCursorPosition`) | tool output | Moved commands into script files and background processes that write logs |
| fast-check properties written as `(x) => expect(...)` returned a value, so fast-check treated them as failures | the property tests themselves (twice) | Use block bodies |
| `vite` vs `vitest`'s bundled `vite` type mismatch | `tsc` | Separate `vitest.config.ts` |
| `Uint8Array<ArrayBufferLike>` vs `AnalyserNode` typing | `tsc` | Explicit `Uint8Array<ArrayBuffer>` |
| A test scanning for remote URLs flagged the SVG XML namespace | `tests/offline.test.ts` | Allowlist that exact identifier |
| The 🪞 mirror emoji renders as a missing-glyph box in Edge on this Windows machine. 🐈‍⬛ renders as a cat plus a square | Edge screenshots (`npm.cmd run screens`) | Code-drawn SVG mirror; plain 🐈 |
| Candles wrapped onto two lines and the page bottom lost its background in tall layouts | Edge screenshots | `nowrap`, solid background color |
| An ended game showed "Draw your ghost…" after a reload | Edge screenshots | Status depends on the ended state |

## Reliability bugs fixed in v4 (each verified in the code first)

- A fresh window inherited the House role (`localStorage` fallback). The role is now per tab (`sessionStorage`).
- Change role was hidden in Diagnostics. It's now in the top bar.
- Play again kept the previous `lastSent`. `newGame` now clears it and retires the ghost ID.
- A stage-1 ghost from another game replaced the active ghost. Now there's an explicit Accept, a partner tag, and retired IDs.
- Game state was committed before playback. Now `SendGate` commits only after the chirp has played.
- Audio start-up could hang. It now has 10 s timeouts, a visible audio state, and Try again.
- `.sound { display: grid }` overrode `[hidden]`. Now `[hidden] { display: none !important }`.

## Verification actually run (latest)

- `npm.cmd run check`: typecheck, production build, and every automated test in `tests/`. The ggwave test is **synthetic**: encoder samples go straight to the decoder, with no speaker or microphone.
- `npm.cmd run screens`: 17 checks in headless Microsoft Edge 1366×820 and 390×844: role picker, keyboard drawing, every stage on both roles, ending screens, no clue leaks, no console errors. Screenshots are in `docs/screenshots/`. This checks rendering only. No sound travels.
- **Not done:** any real speaker-to-microphone run, phone browsers, offline reload on devices, playtest timing.
