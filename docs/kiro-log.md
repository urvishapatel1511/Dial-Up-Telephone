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
  - a packet size limit (26 bytes in v1, 46 in v2, 58 in v3);
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

## v2 "Bad Connection" upgrades

The developer still found v1 boring. The agent proposed four upgrades, and the developer approved all four:
- line static;
- 16×16 drawings;
- a dial-up handshake sound;
- a reveal show with points and a voted award.

The spec and steering were updated first. That included raising the packet limit from 26 to 46 bytes, a tradeoff documented in `design.md`: drawing chirps measured 3.6 s synthetic vs 2.3 s.

Design decision: static is applied on screen with a seeded PRNG, never to the transmitted bytes. That keeps the real link all-or-nothing (reliable) while every device sees identical garbling.

Bug found by `tsc`: a duplicated `const host` in the reveal renderer after the edit.

New tests:
- static properties;
- that a chirp still decodes byte for byte after the synthesized handshake (synthetic);
- scoring and the award.

## v3 "Party Line" upgrades

The developer asked for a faster, funnier, more replayable game, with a priority list: recovery, drawing tools, static, less waiting, prompts, reveal, Party Match. The spec (`requirements.md`, `design.md`, `tasks.md`) and steering (packet limit now 58 bytes) were rewritten before code.

Two bugs the developer reported were confirmed by reading the v2 code before changing it:
- the host could reach "ready to reveal" while an earlier entry was missing on its device (v2 only checked the last step);
- entries resent after the reveal were ignored (v2 rejected every entry once revealed).

Design decisions recorded in `design.md`:
- **One answerer per request:** only the author of a hop answers a `need` chirp automatically (the host answers for the reveal). Others get a manual "Send it for them" button. A random back-off for every holder was rejected, because two phones could still chirp at once.
- **The first drawer picks the word**, carried in the step-1 packet (58 bytes). The host no longer has an advantage in a match.
- **Odd player counts:** the room guesses the last drawing out loud, so every seat has exactly one scoring chance per round (tested for 2–8 players and every rotation).
- **Handshake only on start**, never on turns, requests, or resends.

Bugs found during v3 work:
- `tsc`: two button handlers returned `Promise<boolean>` where `void` was expected.
- Browser check: **Previous** did nothing right after **Show all** (the card count was not clamped). Fixed in `src/main.ts`.
- Screenshot review: the 🛟 emoji has no glyph on Windows (rendered as a box). Replaced with 💪. The host's own hop showed "♪ played" even after later hops proved it arrived; any later hop now counts as confirmation.

## Verification (latest)

- `npm.cmd run check`: typecheck, production build, and 107 automated tests in 10 files (`tests/`): packets v3, game rules with a simulated room of 2–8 devices (missing hops, targeted recovery, recovery after the reveal, duplicates, stale rounds, seat clashes, scoring, awards, Party Match totals, refresh), rotation and fairness, prompts, static twists, the drawing model, captions, offline build, and synthetic ggwave (58-byte packet and handshake schedule).
- `npm.cmd run screens`: 15 checks in headless Edge at 390×844 and 1366×820: lobby, join, host setup, first drawer with word reroll and drawing tools (keyboard, mouse stroke, undo/redo, eraser, large brush, clear), bigger canvas, static notes, secrecy, waiting/sent, host missing hops, odd-count room guess, reveal, results, recovery from the reveal, Party Match final, no console errors. Screenshots are in `docs/screenshots/`. No sound travels in this check.
- **Not done:** any real speaker-to-microphone run, phone browsers, offline reload on devices, or playtests.
