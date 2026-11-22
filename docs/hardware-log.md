# Hardware log

No physical-device results have been recorded yet (v1, v2, v3, or v0.2.0 / sound protocol v4). Fill this in from `docs/hardware-test.md`. Only real speaker-to-microphone runs belong here.

Devices (model / browser): 1 ____________ 2 ____________ 3 ____________ 4 ____________

App version on every device (page footer): ____________

## Chirps

| Date | Packet (bytes) | From → to | Room | Distance | Chirp s | Chirps until heard | Correct on screen? | Notes |
|---|---|---|---|---|---|---|---|---|
| | first drawing (58) | | quiet | | | | | |
| | drawing (46) | | quiet | | | | | |
| | guess (≤ 26) | | talking | | | | | |
| | request (7) | | | | | | | |

## Rounds and matches

| Date | Mode | Players | Line | First time? | Length (min) | Same chain, scores, totals on all devices? | Problems |
|---|---|---|---|---|---|---|---|
| | Quick Round | | | | | | |
| | Party Match | | | | | | |

## Recovery checks (section D)

| Check | Result | Date |
|---|---|---|
| Missed hop before the reveal → Ask → only the author answered | | |
| Host missing a hop → no Reveal → Ask → Reveal appeared | | |
| Missed hop after the reveal → Ask → filled in | | |
| Missed reveal → Ask for the reveal | | |
| Ready check: every player confirmed, replies one at a time | | |
| Duplicate seat shown before the start | | |
| Missed start → Ask to join | | |
| Missed results → Send results again → ✓ | | |
| Touch drawing checklist (section G), per phone | | |
| Same seat twice → warning | | |
| Seat too high → fix → Resend the start signal | | |
| Refresh mid-match → totals kept | | |
| Offline reload on every device | | |

## Delivery, names, ties, and updates (section H, v0.2.0)

| Check | Plays until "✓ Confirmed" / result | Date |
|---|---|---|
| H1 First-attempt delivery, quiet room (per hop) | | |
| H2 Automatic retry after a covered mic | | |
| H3 Retries stop after 3 plays; one tap = one play | | |
| H4 Lost "got it": no repeated turn, same scores | | |
| H5 Lost start confirmation: one resend, no restart | | |
| H6 Lost results confirmation: one resend, scores unchanged | | |
| H7 Background noise (music / talking) | | |
| H8 No two phones chirping at once | | |
| H9 Same name on different seats | | |
| H10 Same name on the same seat → blocked | | |
| H11 Tied scores → same rank, "Joint winners" | | |
| H12 Repeated rounds without reloading | | |
| H13 Update prompt after a new deploy | | |

## Group playtests (section F)

| Date | Players | Setup (min) | Longest wait | Drawing tools used / problems | Funniest moment | Recovery used / worked | Another one? (yes/no) |
|---|---|---|---|---|---|---|---|
| | | | | | | | |
