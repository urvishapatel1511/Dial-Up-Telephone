# Dial-Up Telephone: Requirements (v3: "Party Line")

A browser party game for Kiroween 2026 (Resurrection category). It revives the **acoustic modem**: the "telephone" drawing game, where every drawing and guess hops between phones **only as audible chirps**, and a bad old phone line adds **static** on the way. The goal is a group that starts quickly, enjoys drawing and interpreting strange clues, laughs at the reveal, and wants another round.

The repository was renamed from `Ghost_frequency` to `Dial-Up-Telephone` by the developer. The spec folder keeps its original name. Deadline: **Dec 4, 2026, 2:00 PM PT**.

## Constraints

- C1. All cross-device game state travels speaker → microphone. No network, WebRTC, Bluetooth, QR, clipboard, or shared storage. State is stored per browser tab.
- C2. Offline play after "Prepare for offline play". Runtime assets are local. Sounds are synthesized.
- C3. Packets are compact and versioned. v3 packets are at most **58 bytes** (the first drawing also carries the secret word). Guesses stay ≤ 26 bytes. Control packets are 7–17 bytes.
- C4. Static is an intentional, deterministic game effect applied on screen. A failed chirp is a technical problem that is retried. Neither retries nor failures change scores.
- C5. No AI services, accounts, backend, or online leaderboard.
- C6. Only recorded hardware results are claimed. Kiro usage is never invented. The assistant pushes only when asked.
- C7. Player-facing text avoids implementation details.

## Glossary

- **Host**: the device that starts a game (seat 1). It coordinates the start, the reveal, and the results.
- **Seat**: a player's fixed place at the table, 1..N.
- **Step / position k**: the k-th entry in this round's chain. Odd steps are drawings, even steps are guesses. Step k is made by seat `seatAt(k)` (rotation below).
- **Clue**: what a player actually received: the previous entry *after static*.
- **Round**: one chain. **Quick Round** = one round. **Party Match** = three rounds with running totals.

## R1. Missed-message recovery

1.1 Each device SHALL track which steps it is missing. A step is *known missed* when a later step was heard, or after the reveal.
1.2 The host SHALL NOT be offered a normal reveal while any step is missing. It SHALL list the missing steps, with who made each one and a button to ask for it by sound. "Reveal with missing hops" is a clearly labelled fallback (for a device that left), and those hops show as missing.
1.3 Asking: a `need` chirp names one step. **Only the author of that step answers automatically** (the host answers for the reveal and results). Other devices that hold the step show a manual "Send it for them" button with a "only if NAME doesn't answer" note. So at most one device transmits automatically per request.
1.4 Any device can resend *any* entry it holds, rebuilt byte for byte from its stored round, not just its last chirp. The host can resend the start signal at any time during the round.
1.5 Entries that arrive after the reveal SHALL fill missing steps ("recovered") and never overwrite accepted entries.
1.6 Duplicate filtering, own-echo filtering, and stale-round protection stay. A `need` is never added to the duplicate memory, so it can be asked again.
1.7 Waiting text says whose chirp is expected and offers "Ask for it by sound".
1.8 Two devices on the same seat SHALL be detected (an entry for my step from another name) and reported, not silently merged.

## R2. Drawing tools (16×16)

2.1 Pen and Eraser tools, Small (1 square) and Large (3×3) brushes, Undo, Redo, Clear (with confirmation when not empty), and a Bigger canvas view for phones.
2.2 Undo reverses one complete pointer stroke or one keyboard paint action. Redo re-applies it. A new action clears Redo. History is capped at 50 steps.
2.3 Touch dragging, single-tab-stop arrow-key navigation, Space/Enter to paint, Ctrl+Z / Ctrl+Y, visible focus, tool buttons with accessible names and `aria-pressed`.
2.4 The large brush is clipped at the grid edges.
2.5 The drawing sent is exactly the canvas. The reveal shows the original drawing.

## R3. Static that is fun and understandable

3.1 Clear, Crackly, and Haunted stay. Clear changes nothing.
3.2 Text static prefers a curated, recognizable twist (CAT → BAT), then a one-letter change into another known word, and only then nonsense letters. Haunted may add one extra nonsense letter. All of it is deterministic per (round, step, level) and stays within 12 characters.
3.3 Drawing static flips 8 (Crackly) or 24 (Haunted) squares, as before.
3.4 When a text clue was changed by static, the next player sees exactly "Draw whatever this makes you imagine—even if it’s nonsense." (a 📡 icon is added by CSS). For a changed drawing: "Guess whatever this makes you imagine—even if it’s nonsense." The original is never shown to them.
3.5 A failed chirp is described as a sound problem to resend, never as static.
3.6 The reveal keeps "what was sent" and "what the next player saw" distinct.

## R4. Less waiting

4.1 The decorative dial-up handshake plays only before a **start** chirp (connection moment), and never on a resend.
4.2 Entries, reveal, results, need, and recovery chirps play the modem data sound only.
4.3 Effects never overlap a chirp, and the effects switch turns off all decoration. Chirps always play.
4.4 After playing, the text says the chirp was *played*. Arrival is confirmed only when the next player's entry (or the reveal) is heard.
4.5 No mandatory turn timers.

## R5. Prompts

5.1 Built-in categories: Mix of everything, Spooky, Everyday things, Animals & food, Silly combos (such as "ghost taxi", "vampire DJ", "zombie chef", "sad robot", "sleepy witch", "haunted TV").
5.2 The host chooses the category. **The first drawer** sees a suggestion, can reroll, or can type their own (1–12 characters). Nobody else sees it before the reveal.
5.3 Every built-in prompt is valid protocol text (≤ 12 printable characters, canonical spacing), unique within its category, and needs no obscure or copyrighted knowledge (verified by tests where measurable).

## R6. A funnier reveal

6.1 For every hop, the reveal shows what the author made, what the next player received after static (drawings side by side: "Sent" / "Arrived", with changed squares marked by color and outline *and* a text count), and the response (the next card).
6.2 Controls: Play/Pause show, Previous, Next, Show all (full readable chain). Reduced motion: no animation, same controls.
6.3 Captions are factual and celebratory, built only from known text: "“CAT” became “BAT”!", "✓ Still “PUMPKIN”: Bo got it!", "Your message took an unexpected turn". No claims about what a drawing depicts.

## R7. Party Match and fair scoring

7.1 Modes: **Quick Round** (one round) and **Party Match** (three rounds, running totals, final celebration).
7.2 Rotation: in round r the chain starts at seat `((r − 1) mod N) + 1` and goes round the table (`seatAt(k) = ((k − 1 + offset) mod N) + 1`). So the first drawer changes each round, and each player both draws and guesses during a match.
7.3 Scoring opportunity, every round, for every player count 2–8: each guess at step k scores the guesser and the drawer at step k−1 one point each when it matches the clue that drawer was given. With an **odd** number of players the last drawing has nobody after it, so before the reveal the host shows it and **the whole room guesses out loud**. The host records whether they got it, and if so its drawer scores 1. That gives every player exactly one scoring chance per round, explained in plain words at setup.
7.4 Awards, voted out loud and recorded by the host (one each per round, +1 point, optional):
- **Funniest Transformation**: any response (step ≥ 2).
- **Most Recognizable Drawing**: any drawing.
- **Best Recovery**: a response to a clue that static changed (hidden when none exist).

The host is told to vote for honest attempts, not deliberate sabotage. Automatic comparison only checks guesses against text, never drawing quality.
7.5 One `results` chirp carries the awards and the room's final guess, so every device scores identically.
7.6 Match progress (rounds, names, points) persists across refreshes. Players join the next round's start automatically, even if they missed the previous reveal. Round, position, role, and next action are always shown.

## R8. Audio, reliability, and accessibility (kept)

8.1 Audio states: starting, requesting the microphone, listening, playing, error with Try again (10 s timeouts). Resume listening after a reload or hidden tab.
8.2 Two columns on laptops, one on phones. Visible focus, live announcements, reduced-motion support. Text equivalents never reveal hidden entries.

## Acceptance

With 3+ devices on a Crackly line, play a Party Match:
- each round starts with a new first drawer;
- a missed chirp is recovered by asking for it, and a recovery after the reveal fills the gap;
- the host can't reveal normally while a hop is missing;
- every device shows the same chain, static, scores, and awards;
- totals survive a refresh;
- the final celebration appears after round 3.
