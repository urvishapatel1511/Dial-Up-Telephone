# Dial-Up Telephone: Requirements

A browser party game for Kiroween 2026 (Resurrection category). It revives the **acoustic modem**: the classic "telephone" game, where every message hops between phones **only as audible chirps**. One player draws a secret word on an 8×8 grid. The next player sees only that drawing and guesses. The next draws the guess, and so on. At the end, everyone sees how the message mutated.

The repository keeps its original name (`Ghost_frequency`). The ghost game (v1–v4) was replaced by this design on the developer's request.

Deadline: **Dec 4, 2026, 2:00 PM PT**.

## Why

- **Resurrection:** a modem is the only way messages move. One chirp reaches every phone in the room at once (broadcast). That property of sound makes the shared reveal possible with no network.
- **Fun without puzzles:** 2–8 players, the humor comes from the mutations, and the reveal is the payoff.
- **Real use:** an offline party, classroom, or travel game. No accounts, no server, no internet.

## Constraints (carried over)

- C1. Game data travels only speaker → microphone. No network, WebRTC, Bluetooth, QR, clipboard, or shared storage between devices. State is stored per browser tab.
- C2. Offline play after "Prepare for offline play". No third-party runtime assets.
- C3. Each message is at most **26 bytes**.
- C4. Missed or garbled chirps never break the game: Resend replays identical bytes, and duplicates change nothing.
- C5. Only recorded hardware results are claimed. Kiro usage is never invented.
- C6. The assistant does not push or deploy unless the developer asks.

## Glossary

- **Host**: the player who starts a game. Always seat 1, draws the secret word.
- **Seat**: a player's position in the line, 1..N. Players sit in that order around the table.
- **Step k**: the entry made by seat k. Odd steps are drawings, even steps are guesses (text).
- **Packet**: one chirp. Types: `start`, `entry`, `reveal`.

## R1. Messages

1.1 `start` carries the game ID, the number of players N (2–8), and the host's name.
1.2 `entry` carries the game ID, the step, the author's name (1–7 characters), and either an 8×8 drawing (odd step) or a guess of 1–12 characters (even step).
1.3 `reveal` carries the game ID, N, and the secret word (1–12 characters).
1.4 Every packet is ≤ 26 bytes and has a CRC-8. A wrong magic, type, length, CRC, step, kind, or text SHALL be rejected without changing state.

## R2. Lobby and seats

2.1 Each player enters a name (1–7 printable characters).
2.2 **Host a game:** choose N (2–8). The game suggests a secret word from a built-in list (re-roll or type your own, 1–12 characters). Start plays the `start` chirp.
2.3 **Join a game:** pick a seat 2–8, then "I'm ready" turns the microphone on and waits for a `start`.
2.4 A ready player who hears a `start` SHALL join with their seat. If their seat is greater than N, they SHALL NOT join and are told to pick a lower seat.
2.5 A player in an unfinished game SHALL ignore `start` packets for other games. **Leave game** returns to the lobby.
2.6 A player who isn't ready when a game starts is told how to catch up (get ready, then ask the host to resend).

## R3. Turns

3.1 Seat 1 draws the secret word. Seat k > 1 gets a turn once it has heard step k−1.
3.2 On their turn, a player sees **only** the previous entry: a drawing to guess, or a guess to draw. Other entries are stored silently and never shown before the reveal.
3.3 After a player's entry has played, the device waits for the next seat. The game state changes only after playback succeeds (safe send gate), and a failed playback can be retried with identical bytes.
3.4 Every device shows the line: each seat, its name once known, whether it is done, who is up now, and which seat is "you". It never shows entry content.
3.5 Waiting text SHALL say whose chirp is expected and suggest asking that player to press Resend.

## R4. Reveal

4.1 When the host has heard step N, the host can press **Reveal**, which plays the `reveal` chirp with the secret word.
4.2 Every device that hears `reveal` SHALL show the chain: the secret word, then each step with the author's name, with "not heard" for any step that device missed.
4.3 The chain is revealed one card at a time (Next / Show all). The result says "Perfect transmission!" when the last guess matches the word (case and spaces ignored). Otherwise it says how many hops the message survived before mutating.
4.4 Play again: the host starts a new game. Players stay ready and join the next `start` automatically. Old game IDs are retired, so stale chirps are ignored.

## R5. Audio and reliability

5.1 Reuse the audio state machine: starting, requesting the microphone, listening, playing, waiting, and error with Try again (10 s timeouts). Resume listening after a reload or a hidden tab.
5.2 Microphone on only while listening. Decorative effects never overlap a chirp, and they can be switched off.
5.3 Own echoes, duplicates, other games, and retired games SHALL be ignored.
5.4 Progress survives a refresh (per tab).

## R6. Presentation and accessibility

6.1 Retro modem look (dark, phosphor green, violet), a live spectrum, and readable plain instructions.
6.2 Two columns on laptops (line + task), one column on phones.
6.3 Keyboard-drawable grid (single tab stop, arrows, Space). Visible focus, live status announcements, touch targets ≥ 40 px, reduced-motion support.
6.4 Text equivalents never reveal hidden entries before the reveal.

## Acceptance

With 3+ devices: the host starts, players at seats 2..N join by sound, each player sees only the previous entry, the chain completes, Reveal shows the same chain on every device that heard it, a replayed chirp changes nothing, and Play again starts a fresh round.
