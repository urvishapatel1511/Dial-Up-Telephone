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

## R2. Drawing (16×16, direct touch)

2.1 There is no Pen/Eraser choice. **The square where a stroke starts decides the stroke:** pointer down on an empty square paints, on a filled square erases. The operation stays fixed until pointerup, pointercancel, or lost pointer capture. Revisiting a square in the same stroke never toggles it again. A tap changes one square (or one brush footprint) once. Mouse, touch, and stylus behave the same.
2.2 Undo reverses one complete stroke or one keyboard action. Redo restores it. A new action after Undo clears Redo. History is capped at 50 steps.
2.3 Release outside the grid and pointer cancellation end the stroke safely (the stroke so far is kept as one undo step). A pointer interaction never also counts as a click. Page scrolling is blocked only on the grid (`touch-action: none`). A second finger is ignored during a stroke.
2.4 Keyboard: one tab stop, arrow keys and Home/End move, Space/Enter toggles the focused square, Ctrl/Cmd+Z undoes, Ctrl/Cmd+Shift+Z (and Ctrl+Y) redoes. Squares keep their row/column labels, `aria-pressed` filled state, and visible focus.
2.5 The small brush is the default. Brush size (Small 1 square / Large 3×3, clipped at the edges) and Clear (confirmation when not empty) sit in a compact secondary row. The instruction reads: "Touch empty squares to draw. Start on a filled square to erase. Drag to continue."
2.6 **Bigger canvas** opens a full-screen drawing view that nothing covers: Undo, Redo, and **Done** at the top, the clue in one line, a small audio indicator instead of the status bar, the grid sized to fit the screen, and the send button at the bottom. Entering or leaving keeps the drawing and its undo history. Escape also closes it.
2.7 While a player draws, the sound status bar is compact and not sticky, so it never covers squares.
2.8 The drawing sent is exactly the canvas. The packet format and the reveal's original drawing are unchanged.

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

## R9. Ready check before the first round

9.1 A player is **ready** only when their microphone started successfully *and* the host's phone received their `hello` chirp. Tapping "I'm ready" starts the microphone, then plays `hello` (seat and name) once it works.
9.2 The host's setup screen starts listening (opening it is a user gesture) and shows the roster: seat 1 (you), every seat up to N with its confirmed name, "not ready yet" for missing seats, duplicates, and seats above N.
9.3 **Check who's ready** plays a `call` chirp listing the confirmed and duplicated seats. Every listening player whose seat is not confirmed answers with `hello` in its own time slot (ordered by seat), so replies never overlap. Confirmed and duplicated seats stay quiet.
9.4 Duplicate seats (two names for one seat) are shown on the host with "Two phones picked seat 3: one of them taps Change my seat." Players on a duplicated seat see the same advice. A player who changes seat moves to the new seat in the host's roster.
9.5 Start is enabled only when every seat 2..N has exactly one confirmed name. Seats above N get a warning but don't block.
9.6 After Start, the host's text says the start signal **played**. Nobody is shown as joined until evidence arrives (their turn is heard).
9.7 Targeted start recovery: a ready player who hears a turn from a round they're not in sees "A round started without you" and can tap **Ask to join**. That plays `need` for the start (step 9). Only the host answers, with the start signal. The host's Resend the start signal stays.
9.8 Players see "ready message sent" separately from "✓ confirmed by the host" (their seat is in the host's call).

## R10. Simple host setup

10.1 One prominent Start button. Defaults: Quick Round, 4 players, Crackly, Mix of everything.
10.2 Mode (Quick Round / Party Match, one line each) and the player count stay on the main screen. Line quality and prompt category are under **Customize**, whose summary shows the current choices.

## R11. Round transitions

11.1 One flow on every device: **Reveal → Awards (optional) → Send results → Next round**, shown as a step indicator.
11.2 The host can send results with no awards. With an odd player count the room guess must be answered explicitly (got it / nobody got it / we skipped it) before results can be sent.
11.3 Each player's phone confirms results with an `ack` chirp in its own seat slot. Duplicate results chirps are re-acknowledged and never re-scored.
11.4 The host sees "Results sent" and, per seat, "✓ confirmed" or "waiting". Send results again replays identical bytes.
11.5 The next round (or another Quick Round) requires sent results. If some seats haven't confirmed, the host must confirm "Continue without …" first. `nextRound` refuses a round without results.
11.6 Players always see the next action: "Vote out loud", "✓ Results received", "Waiting for the host to start round 2", or "Ask for the results".

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
