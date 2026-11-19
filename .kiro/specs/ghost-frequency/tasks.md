# Ghost Frequency: Tasks (v4 "The Rescue")

Deadline **Dec 4, 2026, 2:00 PM PT**. `[x]` done · `[ ]` open · **AUTO** = `npm.cmd run check` · **BROWSER** = `npm.cmd run screens` (headless Edge, no sound) · **HW** = the developer checks on real devices.

## Done earlier (v1–v3)
- [x] Prototype sound link, ggwave vendored, HTTPS dev server
- [x] 3-step game with candles, haunted theme, spectrum, effects
- [x] Offline mode (verified precache) and GitHub Actions Pages workflow
- [x] Repo pushed and Pages enabled by the developer. The live site still serves **v3** until v4 is pushed

## Phase 1: reliability and onboarding
- [x] 1.1 Role per tab (`sessionStorage`). Role picker, role badge, and Change role in the top bar. BROWSER: a fresh window shows the picker
- [x] 1.2 Setup guide on the intro screen
- [x] 1.3 Protocol v4, ≤ 26 bytes. AUTO: round-trip property, max-size test, every rejection case, v1–v3 magic rejected
- [x] 1.4 Summon → Accept pairing, partner tag, retired ghost IDs. AUTO: pairing, unrelated ghost, wrong tag, stale chirps
- [x] 1.5 `SendGate`: commit after playback, identical retry, one send at a time. AUTO: failed playback and busy gate
- [x] 1.6 Audio states with 10 s timeouts, Try again, Resume listening after a hide or reload
- [x] 1.7 "Chirp played… waiting for the other device", never "arrived"
- [x] 1.8 Play again / Swap roles clear lastSent, choices, and rewards; keep dedupe. AUTO
- [x] 1.9 `[hidden] { display: none !important }`. BROWSER: hidden controls are not visible

## Phase 2: personality
- [x] 2.1 `personalityOf(ghostId)`. AUTO: deterministic, all four occur
- [x] 2.2 Reactions for arrive, solved, wrong, last candle, rescued, farewell, faded, hat. AUTO: use the name, ≤ 80 chars
- [x] 2.3 Motion per personality (CSS, off under reduced motion) and a text tag

## Phase 3: puzzles
- [x] 3.1 Obstacle stage kept, with clearer copy and hints
- [x] 3.2 Lock deduction. AUTO: exactly one solution for 2000 random IDs; neither half alone suffices; the House's text never names a key
- [x] 3.3 Lying mirror. AUTO: mirror involution, asymmetry ≥ 4, pairwise distances, tolerance, reflection-painted fails

## Phase 4: room reactions
- [x] 4.1 Darkness veil lifts, vampire retreats, clock compartment opens, seal cracks (CSS transitions). BROWSER screenshots

## Phase 5: Rescue the Hat
- [x] 5.1 Offer, skip farewell, two-spot clues, one attempt, verdict chirp. AUTO: skipped, won, failed; no candle; rescue kept

## Phase 6: ending and replay
- [x] 6.1 Portrait (hat overlay), farewell, candles, puzzles, time, stats in details
- [x] 6.2 Play again / Swap roles, with the "other player must choose too" note

## Phase 7: layout and accessibility
- [x] 7.1 Two-column layout ≥ 900 px, sticky status bar, single column on phones. BROWSER: 1366×820 and 390×844
- [x] 7.2 Roving-tabindex grids, arrows/Home/End, Space/Enter, aria-pressed. BROWSER: keyboard test
- [x] 7.3 Effects toggle in Settings, with an explanation that chirps always play. Sends wait for effects to finish

## Validation
- [x] V1 AUTO: typecheck, build, all tests pass (see `docs/kiro-log.md` for the latest counts)
- [x] V2 BROWSER: 17 checks plus screenshots in `docs/screenshots/`
- [ ] V3 **HW**: full game on laptop + phone (`docs/hardware-test.md`)
- [ ] V4 **HW**: first-time playtest timing (target 5–8 min)
- [ ] V5 **HW**: offline reload on both devices from the published site (after pushing v4)
- [ ] V6 **HW**: iPhone Safari and Android Chrome rendering (emoji fonts, mic prompt)

## Submission (later)
- [ ] Push v4 (developer), confirm the Pages deploy
- [ ] Demo video < 3 min, Kiro write-up from `docs/kiro-log.md`, blog/social posts, submission checklist
