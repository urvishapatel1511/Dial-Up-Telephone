# Ghost Frequency: Tasks

Deadline **Dec 4, 2026, 2:00 PM PT**. `[x]` done · `[ ]` open · **AUTO** = `npm.cmd test` · **HW** = you check on real devices.

## Phase 1: prove it on real devices (now)

- [ ] **0. FIRST REAL-DEVICE TEST (HW, do this first)**. See `docs/hardware-test.md`, log in `docs/hardware-log.md`
  - [ ] HW: laptop → phone: the ghost appears with the identical drawing and name
  - [ ] HW: phone → laptop: the key comes home
  - [ ] HW: a full game with one mistake, then a win on both screens
  - [ ] HW: Resend causes no duplicate event and no extra lost candle
  - [ ] HW: spectrum moves while sending and listening. Effects play
  - [ ] HW: chirp seconds and attempts logged, quiet and with talking
  - [ ] HW: mic-denied message appears
  - [ ] HW: two windows on one laptop can play together

- [x] 1. Prototype and sound link (ggwave vendored, HTTPS dev server, Listen/Resend, status messages)
- [x] 2. Message format v3: stage, item, energy, ok, CRC
- [x] 3. Game: obstacle/object, keyhole/key, 4×4 rune, 3 candles, fade, win, stats
- [x] 4. Haunted theme, glowing ghost sprite, materialize and fade, live spectrum, synthesized effects, reduced motion
- [x] 5. Per-tab role and per-role storage for same-device play
- [x] 6. AUTO: 50 tests pass, including a perfect run, a run where three mistakes fade the ghost, duplicates, own echo, refresh, every invalid-message case, rune transport, and ggwave encode→decode. Not yet run in a real browser

## Phase 2: offline and deploy

- [x] 7. Offline: the build writes `precache.json` + `sw.js` from the real `dist/` contents (and fails if the page, the JS/CSS, or ggwave.js is missing). Cache-first service worker with offline fallback for page loads. "📦 Prepare for offline play" saves every file, then verifies each one's presence and size before saying ready (R6.1)
  - AUTO: 62 tests pass, including manifest, verification, no third-party URLs, and a check that the real `dist/` matches `precache.json` and `sw.js`
  - Not yet run in a browser. The service worker only runs on the published site
- [x] 8a. GitHub Actions workflow: on push, build, test, and publish to Pages (`.github/workflows/pages.yml`)
- [ ] 8b. **YOU**: create the GitHub repo and push (`docs/publish.md`, steps 1–7)
- [ ] 8c. HW: on the published URL, both devices Prepare → radios off → reload → finish a game

## Phase 3: polish

- [ ] 9. Tune timings from the hardware log (R7.3)
- [ ] 10. More rooms or variety if testing shows players want it (more obstacles, more runes)
- [ ] 11. Accessibility pass with keyboard and a screen reader

## Phase 4: submit

- [ ] 12. HW: full run on the demo devices, quiet and noisy
- [ ] 13. Demo video < 3 min: a fresh drawing, one mistake, the win on both screens
- [ ] 14. Kiro write-up (`docs/kiro-log.md`): specs, steering, hooks, and property-based tests that caught bugs
- [ ] 15. Blog post + social post #KiroweenHackathon26
- [ ] 16. Checklist: public repo, MIT license, `.kiro/` committed, app URL, video, Resurrection category
