# Ghost Frequency: Requirements (v4, "The Rescue")

A browser-based, two-player cooperative adventure for Kiroween 2026 (Resurrection). The acoustic modem comes back: a hand-drawn 8×8 ghost travels between two devices **only as audible sound**. Two players draw, name, and rescue the ghost together. Each player sees things the other can't, so they have to talk, and only the ghost can carry answers across.

Deadline: **Dec 4, 2026, 2:00 PM PT**.

## Goals

- Players get attached to *their* ghost: it is their own drawing and name, it has a personality, and it reacts as the story unfolds.
- Every stage ends in a cooperative discovery that neither player could reach alone.
- The ending is memorable: a portrait, a farewell, an optional earned hat.
- The acoustic modem stays central. Every cross-device fact travels as a chirp.

## Non-negotiable constraints

- C1. All cross-device game data travels speaker → microphone. No network, WebRTC, Bluetooth, QR, clipboard, or shared-storage path transfers game data. (Two windows on one laptop share `localStorage`, but each role uses its own key and never reads the other role's key.)
- C2. Offline play after preparation stays intact. No runtime third-party assets. Licenses are respected.
- C3. The player's original drawing is never altered.
- C4. Messages stay at **26 bytes or less**. Any format change gets a new version number, documentation, and tests.
- C5. Transport failures, missed chirps, failed playback, and resends never cost a candle. Only a decoded wrong answer does.
- C6. Hardware results are claimed only when someone has recorded them. Kiro usage and history are never fabricated.
- C7. Nothing is published, deployed, or pushed automatically by the assistant.

## Glossary

- **House**: draws the ghost, owns the objects and the lock, paints the rune, and chooses the hat spot (usually the laptop).
- **Other Side**: the haunted room, owns the obstacle, the keys, and the mirror (usually the phone).
- **Pairing**: an explicit accept chirp that binds one Other Side to one ghost until a deliberate restart.
- **Partner tag**: a 4-bit number (1–15) picked by the Other Side on accept and carried by every later message.
- **Transfer**: one message, identified by (ghost ID, transfer ID, direction). Resend replays identical bytes.
- **[HW]**: verifiable only on physical devices.

## R1. Acoustic transfer

1.1 Sending SHALL encode with ggwave (AUDIBLE_FAST) and play through the speaker.
1.2 A valid chirp SHALL render the exact drawing and name. [HW air path; automated synthetic waveform test]
1.3 THE app SHALL show what each chirp carried and how long it lasted, in a secondary details area.
1.4 THE app SHALL show a live spectrum while sending or listening.
1.5 [HW] Each direction decodes within 2 chirps at 0.3–1 m in a quiet room. Record results with people talking too.

## R2. Message format v4 (≤ 26 bytes)

2.1 The drawing packs into 8 bytes and round-trips exactly. The name is 1–10 printable ASCII characters, trimmed, and round-trips exactly.
2.2 The message carries version, direction, stage (1–6), item (0–11), energy (0–3), ok, hat, partner tag (0–15), ghost ID, transfer ID, drawing, and name.
2.3 Wrong magic (including v1–v3), wrong length, bad CRC, stage 0 or 7, item ≥ 12, reserved bits, or an invalid name SHALL be rejected without changing state, with a request to resend.
2.4 The largest message SHALL be exactly 26 bytes.

## R3. Roles, setup, pairing

3.1 A new browser window SHALL ask for a role. The role is remembered per tab only, so a fresh window never inherits one. Progress is saved per role.
3.2 Role selection and **Change role** SHALL be visible outside Diagnostics.
3.3 A short setup guide SHALL explain both roles, microphone access, speaker volume, and device placement, and that puzzle mistakes cost candles but sound problems never do.
3.4 **Summon and accept:** the House's first chirp summons the ghost. The Other Side SHALL show "<name> is calling" and SHALL pair only after the player presses **Accept**. Accept sends a chirp with a new partner tag.
3.5 While paired, the Other Side SHALL ignore summons and messages from other ghosts or partner tags, and the House SHALL ignore returns with another ghost ID or partner tag. The pairing lasts until Play again, Swap roles, or Reset.
3.6 Ghost IDs from finished games SHALL be retired, and their chirps ignored.

## R4. Audio states and safe sending

4.1 THE app SHALL show one clear audio state: starting audio, requesting microphone, listening, playing a chirp, waiting for a reply, or a recoverable failure with **Try again**.
4.2 Audio start-up SHALL time out (10 s) with a recoverable error instead of hanging.
4.3 Game state SHALL change only after a chirp finished playing. If playback fails, nothing changes, the choice stays selected, and Try again sends byte-identical data.
4.4 Only one send can run at a time. Action buttons are disabled during a send.
4.5 After playback, the wording SHALL say the chirp was played and the app is waiting for the other device. It SHALL NOT say the ghost arrived.
4.6 The microphone is on only while listening. Hiding the page stops it, and returning shows a visible **Resume listening** action. After a reload, the app also offers Resume listening.
4.7 Resend replays the last chirp byte for byte. Duplicates never produce a second event or cost a second candle.
4.8 Play again and Swap roles SHALL clear the last sent chirp, pending choices, puzzle state, and rewards, but keep the de-duplication memory.
4.9 Decorative effects SHALL never play while this device is sending, SHALL finish before a send starts, and SHALL have their own on/off switch. The UI explains that the chirps themselves are required.

## R5. Ghost personality

5.1 Each ghost SHALL have one personality (shy, dramatic, mischievous, sleepy), derived from the ghost ID so both devices agree without extra bytes.
5.2 Short reactions using the ghost's name SHALL appear for: first arrival, a solved puzzle, a wrong answer, one candle remaining, and the final rescue. Reactions are shown apart from the task instruction and never replace it.
5.3 Personality SHALL also show through subtle motion (off under reduced motion) and a text tag, never by changing the drawing.

## R6. The adventure

6.1 **Stage 1, The Obstacle (the House decides):** the Other Side's room is blocked (darkness, vampire, or silent clock, rolled locally). The House sends one object (lantern, mirror, bell). The right object clears the room. A wrong one costs a candle, and the ghost returns empty-handed.
6.2 **Stage 2, The Lock (the Other Side decides):** generated from the ghost ID by a template that is guaranteed solvable.
- The House sees the lock: a number of notches, plus a metal rule ("Only silver…" / "No gold…").
- The Other Side sees four keys (★ ☾ ☠ ♥), each with a number of teeth and a metal.
- Exactly two keys have the right number of teeth. Exactly one of those obeys the metal rule. At least one other key also obeys the metal rule. So neither notches nor metal alone is enough, and neither screen alone shows the answer.
- A progressive hint is available on both screens.
- A wrong key costs a candle, and the House sends the ghost back.
6.3 **Stage 3, The Lying Mirror (the House paints, the Other Side checks):** the Other Side sees the exit rune reflected left-to-right. The House's clue explains that the mirror swaps left and right. Reference orientation: the true rune as seen standing in front of the door, with row 1 at the top and column 1 on the left. The House paints the true rune (4×4). The Other Side checks it with a tolerance of 1 block. A miss costs a candle and reports how many blocks were wrong. Every rune is asymmetric: it differs from its own reflection by at least 4 blocks, and from every other rune by more than 2.
6.4 **Rescue the Hat (optional bonus):** after the rune matches, the House is offered "The exit is open… but <name>'s tiny hat is still inside. Rescue it?"
- Skip sends a farewell chirp and ends in success at once.
- Try: both players see a clue naming two of four spots (pumpkin, books, chair, coffin). Exactly one spot is on both lists. The House picks one spot, and the Other Side checks it and replies.
- One attempt only. Failure means escaping without the hat. It never costs a candle and never revokes the rescue.
6.5 Energy: 3 candles, shown on both screens, and carried in every message. At 0 the ghost fades, and both devices learn it by sound.
6.6 Each stage's information split SHALL be the same after a refresh or a retry.

## R7. Visible room reactions

7.1 Lantern: the darkness lifts and hidden details appear. Bell: the clock wakes and its compartment opens. Mirror: the vampire recoils and retreats. Correct rune: the exit seal breaks.
7.2 Readable text explains each outcome. Animations are CSS-only and off under reduced motion.

## R8. Ending and replay

8.1 The final scene SHALL show the original drawing and name, a farewell that fits the personality, the hat if earned, candles left, puzzles completed, and elapsed time. Sound statistics go in a secondary details area.
8.2 **Play again** and **Swap roles** SHALL be offered. The text SHALL explain that the other player must choose the matching option on their own device. No device ever changes another device's role.

## R9. Layout and accessibility

9.1 Keep the purple and green haunted look. On wide screens, the ghost or drawing sits beside the current task, with a visible primary action and a persistent status bar. On phones, everything stacks in a single readable column.
9.2 The drawing grids SHALL be one tab stop, with arrow-key navigation and Space/Enter to toggle. Cells expose `aria-pressed`.
9.3 Visible focus rings, accessible names, polite live announcements, touch targets of at least 40 px, and adequate contrast.
9.4 Text equivalents of puzzle information SHALL never reveal the answer to the wrong player.
9.5 `prefers-reduced-motion` disables animation.
9.6 `[hidden]` always hides, whatever other CSS rules apply.
9.7 No mandatory countdowns.

## R10. Offline

10.1 "Prepare for offline play" caches every built file and confirms only after verifying each entry.
10.2 After preparation, an offline reload loads the full game. [HW]

## Acceptance

A fresh drawing and name → the Other Side accepts by sound → obstacle, lock, and mirror solved by talking plus chirps, with at least one mistake → hat bonus tried or skipped → both screens show the same outcome → any replayed chirp changes nothing.
