# Dial-Up Telephone: Requirements (v2: "Bad Connection")

A browser party game for Kiroween 2026 (Resurrection category). It revives the **acoustic modem**: the classic "telephone" game, where every message hops between phones **only as audible chirps**. One player draws a secret word on a 16×16 grid. The next player sees only that drawing and guesses. The next draws the guess, and so on. Like a real old phone line, the connection adds **static** that garbles messages on the way. At the end, everyone watches how the message mutated, scores points, and votes for the funniest hop.

The repository was renamed from `Ghost_frequency` to `Dial-Up-Telephone` by the developer. The spec folder keeps its original name. The ghost game (v1–v4) was replaced by this design on the developer's request.

Deadline: **Dec 4, 2026, 2:00 PM PT**.

## Why

- **Resurrection:** a modem is the only way messages move, and its sound (the dial-up handshake) and its flaws (line static) are part of the game. One chirp reaches every phone in the room at once, which makes the shared reveal possible with no network.
- **Fun without puzzles:** 2–8 players. The humor comes from the mutations, amplified by static, and the reveal show is the payoff.
- **Real use:** an offline party, classroom, or travel game. No accounts, no server, no internet.

## Constraints

- C1. Game data travels only speaker → microphone. No network, WebRTC, Bluetooth, QR, clipboard, or shared storage between devices. State is stored per browser tab.
- C2. Offline play after "Prepare for offline play". No third-party runtime assets. All sounds are synthesized in code.
- C3. Each message is at most **46 bytes** (raised from 26 for the 16×16 drawing, at the developer's request; a drawing chirp lasts about 4 s instead of 2 s). Guesses and control messages stay ≤ 26 bytes.
- C4. Missed or garbled chirps never break the game: Resend replays identical bytes, and duplicates change nothing. Line static is a game effect applied on screen, never to the transmitted bytes.
- C5. Only recorded hardware results are claimed. Kiro usage is never invented.
- C6. The assistant does not push or deploy unless the developer asks.

## Glossary

- **Host**: the player who starts a game. Always seat 1, draws the secret word.
- **Seat**: a player's position in the line, 1..N.
- **Step k**: the entry made by seat k. Odd steps are drawings, even steps are guesses.
- **Line static**: a deterministic, game-level garbling of an entry as it "arrives" at the next seat. Levels: Clear line (none), Crackly, Haunted.
- **Packet**: one chirp. Types: `start`, `entry`, `reveal`, `award`.

## R1. Messages

1.1 `start` carries the game ID, the number of players N (2–8), the host's name, and the static level (0–2).
1.2 `entry` carries the game ID, the step, the author's name (1–7 characters), and either a 16×16 drawing (odd step, 32 bytes) or a guess of 1–12 characters (even step).
1.3 `reveal` carries the game ID, N, and the secret word (1–12 characters).
1.4 `award` carries the game ID and the step of the hop that won the vote.
1.5 Every packet is ≤ 46 bytes and has a CRC-8. A wrong magic (including the v1 `0xD1` format), type, static level, length, CRC, step, kind, or text SHALL be rejected without changing state.

## R2. Lobby and seats

2.1 Each player enters a name (1–7 printable characters).
2.2 **Host a game:** choose N (2–8) and the line: **Clear line**, **Crackly** (default), or **Haunted**. The game suggests a secret word (re-roll or type your own, 1–12 characters). Start plays the `start` chirp.
2.3 **Join a game:** pick a seat 2–8, then "I'm ready" turns the microphone on and waits for a `start`.
2.4 A ready player who hears a `start` SHALL join with their seat. If their seat is greater than N, they SHALL NOT join and are told to pick a lower seat.
2.5 A player in an unfinished game SHALL ignore `start` packets for other games.
2.6 A player who isn't ready when a game starts is told how to catch up.

## R3. Turns and line static

3.1 Seat 1 draws the secret word. Seat k > 1 gets a turn once it has heard step k−1.
3.2 On their turn, a player sees **only** the previous entry **as it arrived**, after line static. Other entries are stored silently and never shown before the reveal.
3.3 **Static:** Crackly flips 8 of the 256 squares of a drawing, and changes one letter of a guess about half the time. Haunted flips 24 squares and always changes one letter (two for guesses of 6+ letters). Clear line changes nothing. The secret word itself is never garbled.
3.4 Static SHALL be deterministic (seeded by game ID, step, and level), so every device computes the same garbling, before and after a refresh.
3.5 The player is told when the line is crackly or haunted, but not which parts were changed.
3.6 Game state changes only after playback succeeds (safe send gate). A failed playback can be retried with identical bytes.
3.7 Every device shows the line (seats, names once known, done, up now, "you") and never entry content.

## R4. The reveal show

4.1 When the host has heard step N, **Reveal** plays the `reveal` chirp.
4.2 Every device that hears it shows the chain: the secret word, then each hop with the author's name, and "missed" for any step that device didn't hear.
4.3 Each hop that static changed SHALL show exactly what changed: red squares on drawings, highlighted letters on guesses ("PIZZA → arrived as PIZZO").
4.4 Cards appear one at a time: **Next**, **Show all**, or **▶ Play the show** (auto-advances every 2.4 s, with a crackle on hops that had static).
4.5 The result says "Perfect transmission!" when the last guess matches the word, or how many hops it survived. Matching ignores case, spaces, and punctuation, and allows one wrong letter for words of 5+ letters.
4.6 **Points:** when a guess matches what the drawer was asked to draw (the text as it arrived at the drawer), the drawer and the guesser each get 1 point. The scoreboard appears after the last card.
4.7 **Worst Connection award:** players vote out loud for the funniest hop. The host taps 🏆 on that card, which plays the `award` chirp. Every device that hears it highlights the card and gives its author +1 point. The award can be given once per round.
4.8 Play again: the host starts a new game. Players stay ready and join automatically. Old game IDs are retired.

## R5. Audio and reliability

5.1 The audio state machine stays: starting, requesting the microphone, listening, playing, waiting, and error with Try again (10 s timeouts). Resume listening after a reload or a hidden tab.
5.2 **Dial-up handshake:** when effects are on, every chirp is preceded by a synthesized ~1.5 s dial-up sound (dial tones, answer tone, modem warble), then 0.3 s of silence. The handshake SHALL NOT prevent the chirp from decoding (verified in the synthetic waveform test). It is turned off with the effects switch.
5.3 Decorative effects never overlap a chirp.
5.4 Own echoes, duplicates, other games, and retired games SHALL be ignored.
5.5 Progress survives a refresh (per tab).

## R6. Presentation and accessibility

6.1 Retro modem look, live spectrum, plain instructions.
6.2 Two columns on laptops, one column on phones.
6.3 Keyboard-drawable grid (single tab stop, arrows, Space). Visible focus, live announcements, reduced-motion support. Drawing cells on the 16×16 grid are smaller than 40 px; painting by drag and the keyboard mode make up for it.
6.4 Text equivalents never reveal hidden entries before the reveal.

## Acceptance

With 3+ devices on a Crackly line: the host starts, players join by sound, each player sees only the previous entry with static, the chain completes, the reveal show plays the same chain (with the same static) on every device, points and the award match on every device that heard the chirps, a replayed chirp changes nothing, and Play again starts a fresh round.
