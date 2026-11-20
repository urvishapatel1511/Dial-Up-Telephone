# Dial-Up Telephone: Tasks

`[x]` done · `[ ]` open · **AUTO** = `npm.cmd run check` · **BROWSER** = `npm.cmd run screens` (Edge, no sound) · **HW** = real devices.

## v1 (pushed, live)
- [x] Packets, game state, lobby, turns, reveal, play again, offline, 48 tests, browser checks

## v2 "Bad Connection" (local, not pushed yet)
- [x] 1. Spec and steering updated (packet limit 46 bytes for 16×16 drawings, line static, handshake, points, award)
- [x] 2. 16×16 drawings: `packGrid`/`unpackGrid` for n×n, packet v2 (`0xD2`). AUTO: 16×16 round trip, 46-byte max, v1 magic rejected
- [x] 3. Line static (`src/game/noise.ts`): Clear / Crackly / Haunted chosen by the host, carried in `start`. AUTO: deterministic, exact flip counts, clear = identity, garbled text stays valid, bytes on air are exact, every device and refresh agree
- [x] 4. Dial-up handshake (`src/audio/handshake.ts`). AUTO (synthetic): a chirp after the handshake still decodes byte for byte; the handshake alone never decodes; ~1.5 s, peak < 0.4. Behind the effects switch
- [x] 5. Reveal show: ▶ Play the show (auto-advance + crackle), static shown on each hop (red squares, highlighted letters)
- [x] 6. Points (drawer + guesser when the guess matches what the drawer saw, one typo allowed for 5+ letters) and the Worst Connection award chirp. AUTO: scoring on clear and haunted lines, award once, host only, other games ignored
- [x] 7. BROWSER: 13 checks + screenshots (line picker, static note, static in the reveal, award on another device)
- [x] 8. Docs: README, hardware test, Kiro log

## Next (developer)
- [ ] Test on the local server with 2+ devices (`docs/hardware-test.md`)
- [ ] HW: drawing chirps (~3.6 s synthetic) decode within 2 tries at 1 m; compare with effects on and off (handshake)
- [ ] Playtest: is Crackly or Haunted funnier? Is 16×16 better? How long is a round?
- [ ] Push v2 when happy (assistant pushes only when asked)
- [ ] Demo video < 3 min, Kiro write-up, blog/social posts, submission checklist
