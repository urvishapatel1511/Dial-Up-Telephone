# How Kiro was used (development log)

A factual record for the hackathon write-up. It lists only what happened in this repository. Physical-device results are not included, because none have been recorded yet (see `docs/hardware-log.md`).

## Tools and features used

- **Kiro IDE** agent, in one long session.
- **Spec-driven development:** `.kiro/specs/ghost-frequency/` (requirements, design, tasks). The spec was rewritten before code at every redesign.
- **Steering:** `.kiro/steering/ghost-frequency.md`, loaded into every request:
  - sound-only transfer;
  - pure, Node-testable logic;
  - a test for every change;
  - fast-check for codecs and dedupe;
  - packets ≤ 26 bytes;
  - automated, browser, and hardware results reported separately;
  - `npm.cmd`;
  - no push without being asked.
- **Property-based testing** with fast-check, plus the real ggwave WASM in Node.
- **Browser checks:** a headless Microsoft Edge run (`npm.cmd run screens`, playwright-core) renders real game states and checks the layout. The agent inspected the screenshots itself.
- **Not used so far:** agent hooks, MCP servers, custom agents, Kiro powers.

## Timeline

1. **Research:** read the Kiroween 2026 rules page and the 2025 winners. Read ggwave's browser example, its bindings, and its MIT license before integrating it.
2. **Ghost Frequency v1–v4:** a two-player ghost puzzle that grew through the developer's feedback ("is the key always right?", "who wins?", "too boring"). v4 added pairing, a commit-after-playback send gate, personalities, a deduction lock, a mirrored-rune puzzle, and a hat bonus. It was pushed and deployed (commit `62f79bf`).
3. **Pivot to Dial-Up Telephone:** the developer still found the puzzle boring. The agent proposed three alternatives, and the developer chose the telephone party game. The spec was rewritten first. The sound link, safe sending, audio states, offline mode, roving-tabindex grid, and Pages workflow were reused. The ghost game code and its tests were removed.

## Problems hit, and how they were found

| Problem | Found by | Fix |
|---|---|---|
| PowerShell blocked `npm` | running it | `npm.cmd` (in steering) |
| `npm install` ENOTEMPTY | install log | clean reinstall |
| Kiro's PowerShell terminal crashed while rendering long commands (PSReadLine) | tool output | script files and background processes that write logs |
| fast-check properties written as `(x) => expect(...)` | property tests failing (several times) | block bodies |
| vite/vitest type mismatch; `Uint8Array<ArrayBuffer>` typing | `tsc` | separate vitest config; explicit type |
| The URL-scan test flagged the SVG namespace (ghost version) | `tests/offline.test.ts` | allowlist that exact identifier |
| Missing emoji glyphs on Windows (🪞, 🐈‍⬛), wrapped candles, a wrong status after reload (ghost version) | Edge screenshots | SVG icon, CSS, status logic |
| A test expected "stale" for a replay the device had already heard (it is a "duplicate") | `tests/telephone.test.ts` | the test now checks both cases |

## Verification (latest)

- `npm.cmd run check`: typecheck, production build, and all automated tests in `tests/` (packets, game rules with a simulated room of 2–8 devices, offline build, synthetic ggwave).
- `npm.cmd run screens`: lobby, join, host setup, every turn type, waiting, sent, ready-to-reveal, reveal, secrecy, keyboard drawing, and no console errors, at 390×844 and 1366×820. Screenshots are in `docs/screenshots/`. No sound travels in this check.
- **Not done:** any real speaker-to-microphone run, phone browsers, offline reload on devices, or playtests.
