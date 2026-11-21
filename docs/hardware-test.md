# Real-device test: Quick Round and Party Match (v3)

Nobody has run this test yet. Record what you see in `docs/hardware-log.md`. The automated ggwave test is *synthetic* (no speaker, no microphone), so only this checklist tests the real air path.

You need **3 or more devices** (laptop + 2 phones is fine). With 3 devices you also test the odd-player room guess. With 4 you test the even case.

## A. Open the game

**Published site (recommended, also tests offline):**
1. Open `https://urvishapatel1511.github.io/Dial-Up-Telephone/` on every device while online. v3 must be pushed first; see `docs/publish.md`.
2. On every device, tap **📦 Prepare for offline play** and wait for "✓ Ready". If it asks you to reload once, do that and tap Prepare again.
3. Turn off Wi-Fi and Bluetooth everywhere, then reload. The game must still load.

**Laptop test server (no offline mode):** run `npm.cmd run dev:https`. On the laptop open `https://localhost:5173/`; on the phones open the `Network:` address and accept the certificate warning.

Volume high everywhere. iPhone: silent mode off. Devices within about 1 m, in a circle, in seat order.

## B. Quick Round (Crackly line)

| # | Who | Do | Expect |
|---|---|---|---|
| 1 | Host | Name → **Host a game**. Allow the mic | Roster: seat 1 (you), seats 2..4 "not ready yet". Start says "Waiting for seat 2" |
| 2 | Players, one at a time | Name → **Join a game** → seats 2, 3, … → **I'm ready**. Allow the mic | Player: "✓ Microphone works", "✓ Ready message played", "… Not confirmed yet". Host: the name appears on that seat |
| 2b | Host | Set the player count. Tap **📣 Check who's ready** | Unconfirmed players answer one at a time (about 2.4 s apart). Every player shows "✓ Confirmed by Asha" |
| 2c | Host | **Start Quick Round** (Crackly is the default; check Customize) | The dial-up handshake, then the start chirp. Host: "Played the start signal. Each phone joins when it hears it." Every player: "Connected! … You are seat N." |
| 3 | Host (first drawer) | See the suggested word. Try 🎲 Another word, or type one. Draw (see section G), Undo/Redo. **Send my drawing** | No handshake this time, only the data chirp. Host: "Played your drawing. It's confirmed when Bo's turn is heard." Seat 2: "Your turn!" |
| 4 | Seat 2 | Guess, send | Host's line shows "✓ received" for hop 1. Seat 3 sees only the guess. If static changed it: "Draw whatever this makes you imagine—even if it's nonsense." |
| 5 | Everyone | Continue to the last seat | Host: "Gather around for the reveal!" (odd count: the room guess box first) |
| 6 | Host (odd count) | Show the last drawing to the room. Everyone guesses out loud. **Show me the answer** → ✓ or ✗ | The choice is pre-filled in the awards form |
| 7 | Host | **Reveal the chain** → ▶ Play the show, then ⏸, ◀ Previous, Next ▶, Show all | Every phone shows the same chain, the same Sent/Arrived pairs, and the same captions |
| 8 | Host | Vote out loud, pick awards or none, **Send results** | Host: "Results sent. Waiting for …", then each seat turns "✓" as its phone confirms (one at a time). Every phone shows the same scores |
| 8b | Host | **Send results again** | Nothing changes on any phone; phones confirm again; scores stay the same |
| 9 | Players, then host | **Ready for the next round**, then **Host another round** | A new round, no new ready check needed. An old chirp replayed is ignored |

## C. Party Match (Haunted line)

| # | Who | Do | Expect |
|---|---|---|---|
| 1 | Host | 🏆 Party Match → Start | Players see "round 1 of 3 of a Party Match" |
| 2 | Everyone | Play round 1, reveal, send the awards | "Party Match totals after round 1 of 3" on every phone |
| 3 | Host | **Start round 2 of 3** | Players join automatically (no button). **Seat 2 now draws first** and picks the word |
| 4 | One player | Refresh the page in the middle of round 2, then Resume listening | The round and the match totals are still there |
| 5 | Everyone | Finish rounds 2 and 3 | After round 3's awards: "🏆 NAME wins the Party Match" and the same final totals on every phone |

## D. Recovery checks (do these during any round)

- **Missed hop, before the reveal:** cover seat 3's mic while seat 1 sends. After seat 2 plays, seat 3's line shows "⚠ missed here" for hop 1. Seat 3 taps **📣 Ask for it by sound**. Only seat 1's phone answers, about 1 s later. Other phones that hold the hop show "Send it for them (only if Asha doesn't answer)" and stay quiet.
- **Host missing a hop:** cover the host's mic for one turn. At the end, the host sees "Some hops didn't reach this phone" with no Reveal button. Asking by sound fills it in, and Reveal appears.
- **Missed hop, after the reveal:** cover a player's mic for one turn, finish, reveal. That player's chain shows "Not heard on this phone". Ask for it by sound: the hop appears, and nothing else changes.
- **Missed reveal or awards:** cover a player's mic during Reveal. Tap **Ask for the reveal**. The host's phone answers.
- **Same seat twice (before the start):** two players pick seat 3 and press I'm ready a few seconds apart. The host's roster says "Bo and Zed both picked it" and Start says "Fix seat 3 first". Zed changes to seat 4 and presses I'm ready: the roster updates.
- **Missed start:** cover a ready player's mic while the host starts. When the first drawing plays, that phone says "A round started without you". Tap **Ask to join**: only the host's phone answers, and the player joins.
- **Missed results:** cover a player's mic during Send results. The host shows "Waiting for NAME". Send results again: that seat turns ✓. Try "Start round 2" before that: the host is asked to confirm first.
- **Mic denied:** a player denies the microphone. They never appear as ready, and the host can't start.
- **Seat too high:** a player picks seat 6 in a 4-player game. They're told to pick a lower seat. After fixing it, the host's **↻ Resend the start signal** lets them join.
- **Effects off** (⚙ Settings): no handshake at all, and chirps still play.
- **Secrecy:** while waiting, no phone shows the secret word or anyone else's entry.

## E. Measure

- Chirp seconds (shown after each send, also in Settings → Diagnostics). Synthetic values for reference: first drawing 4.3 s, other drawings 3.6 s, guesses ≤ 2.3 s, requests 1.3 s, handshake about 1.5 s (start only).
- Chirps needed per turn, in a quiet room and with people talking.
- Round length and match length with first-time players.

## G. Touch drawing (each phone, and one laptop with a mouse)

| Do | Expect |
|---|---|
| Tap an empty square, then tap it again | It fills, then empties. Exactly one change per tap |
| Drag from an empty square across filled ones | Every touched square is filled; none are erased |
| Drag from a filled square across empty ones | Every touched square is empty; none are painted |
| Drag back and forth over the same squares | Nothing flickers or toggles back |
| Drag off the grid and lift the finger outside | The stroke ends; touching the page elsewhere draws nothing |
| Drag quickly in a diagonal line | No gaps between squares |
| Undo, then Redo | Undo removes one whole stroke, Redo brings it back |
| Draw, Undo, then draw something new | Redo is no longer available |
| **Bigger canvas** → draw → **✓ Done** | The grid fills the screen, nothing covers it, Undo/Redo/Done and Send are visible without scrolling. Done keeps the drawing, and Undo still works |
| Scroll the page by dragging outside the grid | The page scrolls; dragging on the grid never scrolls |
| Stylus (if you have one) | Same as a finger |

## F. Group playtest checklist

Fill one row per session in `docs/hardware-log.md`.

| Question | How to measure |
|---|---|
| **Setup time** | Minutes from "everyone opens the page" to the first start chirp heard by all |
| **Waiting** | Did anyone ask "is it my turn?" or look bored? Note the longest wait between turns |
| **Drawing usability** | Did people use Undo, Eraser, Large brush, Bigger canvas? Any accidental clears or mis-taps? |
| **Funny moments** | Write down the best mutation (e.g. "CAT → BAT → bat with a cape") and when people laughed: during play, at the reveal, at the awards |
| **Recovery** | How many times was Ask for it by sound used? Did it work first time? |
| **Willingness to replay** | After the round or match, ask "another one?" Count yes / no |

## If it fails

| Symptom | Try |
|---|---|
| Nothing heard | Volume up, move closer, tap Ask for it by sound. iPhone silent switch |
| "couldn't read it" | A sound problem, not static: ask for it by sound |
| "Audio didn't start" | Try again, or reload |
| Mic never asks | The page must be https:// |
