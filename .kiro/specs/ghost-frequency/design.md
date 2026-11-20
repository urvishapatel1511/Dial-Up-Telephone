# Dial-Up Telephone: Design

## Flow (N players, N + 2 chirps)

| # | Who | Chirp | Everyone else |
|---|---|---|---|
| 1 | Host (seat 1) | `start` (game ID, N, host name) | Ready players join with their seat |
| 2 | Seat 1 | `entry` step 1: drawing of the secret word | Stored. Seat 2 sees it |
| 3 | Seat 2 | `entry` step 2: guess | Stored. Seat 3 sees it |
| … | Seat k | `entry` step k (odd = drawing, even = guess) | Stored. Seat k+1 sees it |
| N+2 | Host | `reveal` (word) | Everyone shows the chain |

Because sound is a broadcast, every device in the room hears every entry, so every device can show the reveal without any network. Secrecy is enforced in the UI: a device displays only the entry its own seat needs.

A 5-player round is 7 chirps (≈ 2 s each) plus drawing and guessing time.

## Packet format (magic `0xD1`, ≤ 26 bytes)

| Offset | Size | Field |
|---|---|---|
| 0 | 1 | `0xD1` |
| 1 | 1 | type: 1 start, 2 entry, 3 reveal |
| 2 | 2 | game ID (uint16 BE) |
| 4 | 1 | start/reveal: N players (2–8) · entry: step (1–8) |
| 5 | 1 | bits0–3 text length (0–12) · bits4–7 name length (0–7) |
| 6 | 8 | drawing (entry, odd step only) |
| … | T | text: guess (even entry) or secret word (reveal) |
| … | M | name: author (entry) or host (start) |
| last | 1 | CRC-8 (poly 0x07) |

Sizes: start ≤ 14 bytes, drawing entry ≤ 22, guess entry ≤ 26, reveal ≤ 19. The dedupe key is `gameId:type:step`. Each step is written once, so no transfer ID is needed.

## Modules

```
src/protocol/drawing.ts, crc8.ts   (kept)
src/protocol/packet.ts             packet encode/decode
src/game/telephone.ts              pure state: profile, game, receive, sendEntry, reveal, phase, chain
src/game/words.ts                  built-in word list
src/state/sender.ts                (kept) commit after playback
src/audio/*, src/offline/*         (kept)
src/ui/grid.ts                     (kept) roving-tabindex grid
src/main.ts                        UI
```

`receive(state, packet, now)` order: own echo → duplicate → retired → by type. Rejections that may become valid later (not ready, seat too high, other game) are not added to the dedupe memory, so a Resend can still succeed once the player fixes their seat.

Phase (derived): `lobby` → `host-setup` | `ready` → in game: `my-turn` | `waiting` | `sent` | `ready-to-reveal` (host) → `reveal`.

## Storage

`sessionStorage["dialup:v1"]`: one tab is one player, so several windows on one laptop can play without sharing data. Refresh-safe.

## Removed

The ghost game: the House/Other Side roles, pairing, candles, the lock, mirror, and hat puzzles, personalities, and protocol v4. It's still in git history (commit `62f79bf`).

## Risks

| Risk | Mitigation |
|---|---|
| A player misses a chirp | The waiting text names whose chirp is expected. The author presses Resend (identical bytes) |
| Two players pick the same seat | The lobby tells players to sit in seat order and say their numbers out loud. Seats are shown in the line |
| A late joiner | They're told to get ready and ask the host to press Resend while the host's last chirp is still `start` |
| 8×8 drawings are hard | That's part of the fun. The word list is chosen to be drawable |
