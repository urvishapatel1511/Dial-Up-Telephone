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

## Phase E: simpler drawing, setup, and transitions (v3.1)
- [x] E1 Direct touch drawing: the start square decides paint or erase for the whole stroke; line fill on fast drags; pointer capture, cancel, and outside release; no click double-toggle; Pen/Eraser removed; brush size and Clear in a compact row (R2)
- [x] E2 Full-screen canvas: Undo/Redo/Done on top, clue line, mini sound indicator, send button at the bottom, Escape; compact non-sticky status bar while drawing (R2.6, R2.7)
- [x] E3 Ready check: `hello` after the mic starts, host roster, `call` with confirmed/duplicate masks, seat-slot replies, duplicate and above-N seats, Start gated, "Ask to join" (`need` 9) (R9)
- [x] E4 Host setup: defaults, one Start, Customize for line and category (R10)
- [x] E5 Round flow: step indicator, optional awards, explicit odd-count room guess, `ack` per seat, results sent vs confirmed, Send results again, guarded next round, `nextRound` requires results (R11)

- [x] E6 Visual theme (`src/theme.css`): CRT/modem look, keypad seats, wire line, printer-slip reveal, LED status; reduced motion and no-overflow checks

## Phase F: reliability fixes (v4, app 0.2.0)
- [x] F1 Player ID per tab in `hello`; ready roster keyed by ID, so same-name players on different seats are never merged; same name on the same seat is a duplicate; name-independent in-game seat conflicts
- [x] F2 Delivery tracking (playing / waiting for confirmation / confirmed / no confirmation yet): "got it" from the next player, start confirmations in seat slots, bounded automatic retries by the sender only, quiet line while replies are due, chirps built after the wait
- [x] F3 Packet v4 (`0xD4`): hello + player ID, ack + what it confirms; older/newer versions reported, never misread; storage `dialup:v4` (profile carried over from v3)
- [x] F4 App version in the footer; service worker waits; "Update available · Reload to update", asks first during a round; one-time move from the old cache prefix
- [x] F5 Competition ranking (5, 5, 3 → 1, 1, 3), equal highlight, "Joint winners"

## Validation
- [x] AUTO tests for every item above, including fairness for 2–8 players, reply-slot spacing, and slot lengths against the real encoder (11 files)
- [x] BROWSER checks and screenshots at phone and laptop sizes, including mouse, touch, and pen strokes (21 checks)
- [x] Docs: README, hardware test with playtest checklist, hardware log template, Kiro log

## Developer (HW)
- [ ] Quick Round and Party Match on 3+ devices. Playtest checklist in `docs/hardware-test.md`

## Known limitations
- If the host continues past an unconfirmed seat (after the warning), that phone may keep a lower total for the round. The old round is retired, so it can't be asked for any more.
- Two phones on one seat that only ever answer a ready check (never a spontaneous hello) reply in the same slot and collide; the host then sees that seat as missing, not duplicated.
- Player IDs are random 16-bit numbers: two tabs get the same ID with probability about 1 in 2,300 for 8 players. They would then look like one player changing seat.
- v4 phones can't talk to v3 phones. Everyone updates between games.
- Reply slots assume every phone hears the call/results end at about the same moment (true for one room).
