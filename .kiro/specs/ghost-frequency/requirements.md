# Ghost Frequency: Requirements

A browser-based, two-player cooperative escape game for Kiroween 2026 (Resurrection). It brings the acoustic modem back: a hand-drawn 8×8 ghost travels between two devices **only as audible sound**. Each player owns things the other can't see, so they must talk, and only the ghost can carry things across.

Deadline: **Dec 4, 2026, 2:00 PM PT**.

## Pitch (why it matters)

- **Resurrection:** the 1960s–90s acoustic modem returns as the core mechanic, not a decoration.
- **Real teamwork:** asymmetric information (as in "Keep Talking and Nobody Explodes"). Both players make decisions, and neither can win alone.
- **Stakes:** three candles of spirit energy. Every mistake puts one out, and at zero the ghost fades.
- **Learn by playing:** players watch the sound on a live spectrum, and every chirp shows what its bytes carried.
- **Private and offline:** no accounts, no server, no network.

## Glossary

- **House**: creates the ghost, owns the objects and the keyhole (usually the laptop).
- **Other Side**: the haunted room, owns the obstacle, the keys, and the exit rune (usually the phone).
- **Release**: House → Other Side. **Return**: Other Side → House.
- **Stage**: 1 obstacle/keys, 2 key retry, 3 rune.
- **Transfer**: one logical message, identified by (ghost ID, transfer ID, direction). Resend replays identical bytes.
- **[HW]**: can only be verified on physical devices. Everything else needs an automated test.

## R1. Acoustic transfer

1.1 WHEN a player presses a send button, THE app SHALL encode the message with ggwave (audible protocol) and play it through the speaker.
1.2 WHEN a device is listening and a valid chirp arrives, THE app SHALL render the exact 8×8 drawing and name that were sent. [HW air path; automated encode→waveform→decode]
1.3 Ghost data SHALL move only speaker → microphone.
1.4 A message SHALL be at most 26 bytes before ggwave error correction.
1.5 THE app SHALL show what each chirp carried (bytes per field) and how long it lasted.
1.6 [HW] Each direction SHALL decode within 2 chirps in a quiet room at 0.3–1 m with Wi-Fi and Bluetooth off.
1.7 [HW] Record the success rate with people talking nearby (target ≥ 4 of 5 within 2 chirps).
1.8 THE app SHALL show a live frequency spectrum while sending or listening.

## R2. Message format and validation

2.1 The drawing SHALL pack into exactly 8 bytes and unpack to the identical grid.
2.2 The name SHALL be 1–10 printable ASCII characters, trimmed, and SHALL round-trip exactly.
2.3 The message SHALL carry version, direction, stage (1–3), item (none, 3 objects, 4 keys), energy (0–3), an ok flag, ghost ID, transfer ID, drawing, and name.
2.4 WHEN decoded bytes have the wrong magic/version, wrong length, a bad checksum, stage 0, reserved status bits, or an invalid name, THE receiver SHALL reject them without changing state and SHALL ask for a resend.

## R3. Listening, permissions, half-duplex

3.1 The microphone SHALL be active only while the app shows a listening state. Stopping or hiding the page SHALL stop all media tracks.
3.2 WHILE sending, a device SHALL NOT listen. After sending, it SHALL resume listening automatically.
3.3 A device SHALL ignore messages matching a transfer it sent itself.
3.4 WHEN microphone permission is denied or unavailable, THE app SHALL explain how to re-enable it.
3.5 WHEN the page is not a secure context, THE app SHALL explain that HTTPS is required.
3.6 WHEN 25 s pass while listening with nothing decoded, THE app SHALL show a hint without hiding the current instruction.
3.7 All audio processing SHALL happen on the device.

## R4. Safe retries and idempotency

4.1 Every device SHALL offer Resend (byte-identical).
4.2 WHEN an accepted transfer is decoded again, THE receiver SHALL NOT produce a second event or lose a second candle.
4.3 "Received" SHALL appear only on a device that decoded the message itself.
4.4 State SHALL persist per role in localStorage and survive a refresh. Role SHALL be per tab first, so two windows on one laptop can play (R7.6).
4.5 Each device SHALL send once per arrival (repeats use Resend) and SHALL NOT send while its ghost is away.

## R5. The haunting

5.1 Each device SHALL choose a role. The Other Side SHALL roll its obstacle (1 of 3) and exit rune (1 of 6) before any ghost arrives. The House SHALL roll its keyhole (1 of 4) per new ghost.
5.2 **Step 1, obstacle:** the House SHALL choose one object (lantern, bell, mirror) to release with the ghost. WHEN it matches the obstacle (darkness → lantern, vampire → mirror, silent clock → bell), the Other Side's room SHALL clear and show four keys. Otherwise the ghost SHALL lose a candle and go home empty-handed.
5.3 **Step 2, keyhole:** the Other Side SHALL choose one key to send home. WHEN it matches the House's keyhole, the door SHALL open. Otherwise the ghost SHALL lose a candle and the House SHALL send it back for another key.
5.4 **Step 3, rune:** the House SHALL paint the rune on a 4×4 block grid. The ghost SHALL carry it to the Other Side in the drawing slot. WHEN at most 1 block differs, the exit SHALL open and the ghost SHALL go home free. Otherwise the ghost SHALL lose a candle, the Other Side SHALL see how many blocks were wrong, and the House SHALL repaint.
5.5 WHEN energy reaches 0, the ghost SHALL fade, and both devices SHALL be able to learn it by sound.
5.6 The House SHALL keep the original drawing and show it in the win screen with time, candles left, chirps, bytes, and seconds of sound.
5.7 Returns from a ghost this House didn't release, or for another stage, SHALL change nothing.
5.8 Every rune SHALL differ from every other by more than twice the tolerance. Every obstacle SHALL need a different object.

## R6. Offline play

6.1 "Prepare for offline play" SHALL cache every asset and confirm only after verifying each entry.
6.2 Offline after preparation, reloading SHALL load the full game.
6.3 THE app SHALL load nothing from third-party origins.
6.4 [HW] Both devices reload and finish with Wi-Fi and Bluetooth off.

## R7. Presentation and accessibility

7.1 The judge's drawing SHALL be recognizable on both screens.
7.2 WHEN `prefers-reduced-motion` is set, animations SHALL be turned off.
7.3 Animation timing SHALL use measured chirp durations.
7.4 Every state SHALL tell the player what to do next in plain language.
7.5 Controls SHALL work with keyboard and touch. Clues and ghosts SHALL have text labels for screen readers.
7.6 Two browser windows on one laptop SHALL be able to play both roles.
7.7 Sound effects SHALL be synthesized (no copyrighted audio), short, and quiet.

## Milestone acceptance

A fresh drawing and name → the identical ghost appears on the Other Side by sound → all three steps solved by talking and sound trips (including one mistake) → both devices show the ghost free → replaying any chirp changes nothing.
