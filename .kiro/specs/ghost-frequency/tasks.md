# Dial-Up Telephone: Tasks (v3 "Party Line")

`[x]` done · `[ ]` open · **AUTO** = `npm.cmd run check` · **BROWSER** = `npm.cmd run screens` (Edge, no sound) · **HW** = real devices.

## Done before
- [x] v1 telephone game, v2 "Bad Connection" (static, 16×16, handshake, reveal show, points, award). Pushed and live

## Phase A: recovery and drawing tools
- [x] A1 Missing-step tracking, host blocked from a normal reveal, `need` packet, author-only auto-reply (0.9 s delay, no handshake), relay button, resend any held entry, resend start, recovery after the reveal, seat-clash detection
- [x] A2 Canvas model (pen/eraser, small/large brush, stroke undo/redo, clear) and editor UI (toolbar, Bigger canvas, keyboard, Ctrl+Z/Y)

## Phase B: static, prompts, audio
- [x] B1 Curated text twists, clue-changed instructions, sound-problem vs static wording
- [x] B2 Prompt categories, first drawer picks/rerolls/customizes the word, prompt validation
- [x] B3 Handshake only on start, never on a resend; "played" vs "received" wording

## Phase C: reveal
- [x] C1 Sent/Arrived side by side, factual celebratory captions (`src/game/captions.ts`), Play/Pause/Previous/Next/Show all

## Phase D: Party Match
- [x] D1 Packet v3 (start carries mode, match, round, category; step 1 carries the word; results; need)
- [x] D2 Rotation, odd-N room final guess, awards (Funniest / Recognizable / Recovery) in one results chirp
- [x] D3 Match archive and totals across refreshes, auto-join of the next round, final celebration

## Validation
- [x] AUTO tests for every item above, including fairness for 2–8 players (10 files)
- [x] BROWSER checks and screenshots at phone and laptop sizes (15 checks)
- [x] Docs: README, hardware test with playtest checklist, hardware log template, Kiro log

## Developer (HW)
- [ ] Quick Round and Party Match on 3+ devices. Playtest checklist in `docs/hardware-test.md`

## Known limitations (v3)
- A device that misses a round's results and then hears the next round's start keeps its own (lower) total for that round. The old round is retired, so it can't be asked for any more.
- Seat clashes are detected only when the second phone hears an entry for its own step.
