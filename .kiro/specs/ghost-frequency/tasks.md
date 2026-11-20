# Dial-Up Telephone: Tasks

`[x]` done · `[ ]` open · **AUTO** = `npm.cmd run check` · **BROWSER** = `npm.cmd run screens` (Edge, no sound) · **HW** = real devices.

## Kept from the ghost version
- [x] ggwave sound link, safe send gate, audio states, offline mode, Pages workflow, roving-tabindex grid

## Build
- [x] 1. Spec rewrite (requirements, design, tasks, steering)
- [x] 2. Packet format (`0xD1`), ≤ 26 bytes. AUTO: round-trip property, max size, every rejection, single-byte corruption
- [x] 3. Game state. AUTO, in a simulated room of devices:
  - a full 5-player round; secrecy (prompt = previous entry only);
  - seat too high / not ready → Resend; other games ignored;
  - missed chirp → Resend; duplicates; failed playback;
  - reveal with missing entries; perfect transmission; play again; stale chirps; refresh at every step
- [x] 4. Word list (50 drawable words ≤ 12 characters)
- [x] 5. UI: lobby, seat picker, host setup, the line, drawing and guessing turns, waiting/sent, reveal one card at a time, play again
- [x] 6. Ghost game code and tests removed (kept in git history at `62f79bf`)
- [x] 7. Docs: README, hardware test, hardware log, Kiro log
- [x] 8. BROWSER: 12 checks and screenshots at phone and laptop sizes

## Next
- [ ] Push to GitHub (developer's go-ahead) and confirm the Pages deploy
- [ ] HW: a 3+ device round in a quiet room, then with talking
- [ ] HW: missed chirp → Resend; seat too high → Resend
- [ ] HW: offline reload on all devices
- [ ] Playtest: is it fun? How long is a round?
- [ ] Demo video < 3 min, Kiro write-up, blog/social posts, submission checklist
