# Changelog

Published versions and source archives are available on [GitHub Releases](https://github.com/Ekka-Barber/Chess-Play-Fun/releases).

## Unreleased

- Replaced all configuration dropdowns with visible choices, including engine selection, compute budgets, game setup, and appearance previews.
- Added four licensed piece sets alongside Cburnett: Merida, Chessnut, Fantasy, and RhosGFX.
- Moved the desktop evaluation chart above the board at its full width while preserving the original board size. Added the current score, a ±5-pawn scale, subtle White/Black shading, and a current-position marker. Unknown positions remain gaps, retry answers stay hidden, and narrow or short screens keep the chart in Analysis. Resizing redraws locally without extra engine searches.
- Added an isolated puzzle workspace with four local starters, an opt-in Lichess daily puzzle, legal input, opponent replies, hints, solution reveal, retry, and next-puzzle controls.
- Fixed unequal puzzle rows that stretched occupied squares and pieces. Busy, revealed, and completed boards retain their colours.
- Preserve the open puzzle, accepted moves, hints, revealed solution, and completion state across refreshes in the same tab. Support browser Back between the puzzle and game views.
- Label hinted completions as assisted; retry resets that assistance state.
- Show a visible message when the browser cannot save puzzle progress.
- Add a short, one-shot Brilliant impact and ray burst for confirmed player moves, with an Appearance preview and reduced-motion fallback. Engine moves, history browsing, retries, and repeated polls do not trigger it.
- Keep main-game shortcuts inactive in puzzle mode. Starting a new game or restoring a saved game returns to its board.
- Make the comparison button stop an active five-engine comparison as well as start one.
- Validate daily puzzle identities and honour both seconds and HTTP-date forms of `Retry-After`.
- Replace a timing-dependent engine-preview test with explicit synchronization and expand real-browser puzzle, navigation, and evaluation-chart regression checks. All 128 automated tests pass.
- Performance and Brilliant accuracy pass (2026-11-18):
  - Faster long games. The threefold-repetition check no longer re-parses the whole game on every poll. On a 119-ply game this cut the profiled time in that check from 19.2 s to 0.2 s for the same replay-and-review workload.
  - New game and restore keep an unchanged engine running (`ucinewgame`) instead of restarting it; only a changed engine binary is respawned.
  - A stalled engine start no longer leaves analysis dead. If the 20 s handshake limit is hit, the process is dropped and the next search starts a fresh one without Retry. Confirmed against a real process whose first start was delayed 30 s.
  - The analysis poll sends the game only when it changed. The browser names the copy it holds and the server leaves the game out while it is the same. Reviewing a 119-ply game sent 21 MB instead of 140 MB; an unchanged poll is 1.5 KB instead of 323 KB.
  - Stepping through a fully graded game no longer rebuilds the Review panel on every step (11.8 ms to 6.7 ms per step on a 119-ply game, script plus layout).
  - The engines a visible board needs stay ready: the analysis engine (and the playing engine when a computer side is set) no longer quit after five idle minutes while a board tab is on screen, so the next move does not wait for a cold start (0.4 s measured on a quiet machine, 1.4 to 3.6 s on a busy one). They still quit five minutes after the tab is hidden or closed, and the review and comparison engines quit as before. Cost: one idle Stockfish process stays in memory (about 280 MB working set fresh, up to about 390 MB after searching, at the Balanced 128 MB hash).
  - Stricter Brilliant (rule tag `local-v3`). The material must stay given up for five plies on the line where the offer is taken, or the line must end in mate. Not Brilliant: a move that answers a check unless the moved piece is the one offered, a level position where another searched move does as well, a position already won by another searched move, and a desperado (a piece that was lost anyway because saving it drops as much elsewhere). A forced mate no longer waits for depth 14.
  - Frozen fixtures in `test/fixtures/brilliant-cases.json` cover 17 saved moves and three Chess.com-labelled games: 16 must not be Brilliant, 4 must be. Two of the three Chess.com-labelled games are no longer Brilliant here, by design.
  - 161 automated tests pass.

## [4.0.2](https://github.com/Ekka-Barber/Chess-Play-Fun/releases/tag/v4.0.2) - 2026-11-03

### Improved

- Replaced large filled legal-move dots with small hollow rings and lighter capture outlines.
- Refined the evaluation rail with softer tones, an equality midpoint, and a 200 ms transition. Moved the score above the board and labelled its White perspective.
- Show a neutral rail and a descriptive label when evaluation is unknown or deliberately hidden during a retry.
- Reduced suggestion, threat, five-engine, and hover arrow opacity to keep pieces readable.
- Stream next-move suggestions before historical grading completes, poll active searches more promptly, and overlap comparison-engine startup handshakes.
- Removed the artificial free-play reply pause while retaining the configured search budgets and strength.
- Rewrote the README with setup instructions, measured performance, engine capabilities, screenshots, controls, and known limits.

### Fixed

- Corrected Lichess cloud-evaluation requests to use the documented `multiPv` query parameter.
- Prevented retired engine-process output from completing a replacement search.
- Kept engine-comparison resumption and hidden-tab visibility handling consistent.

### Verification

- 116 automated tests passed.
- Browser checks covered desktop and narrow phone layouts, hollow destinations and captures, flipped evaluation orientation, and equal, negative, mate, unknown, and retry score states.
- Online integration tests use mocked upstream responses. The cloud parameter correction takes effect when the server is restarted; restarting still clears the in-memory game.

## Earlier releases

- [v4.0.1: Arrows like the big boards](https://github.com/Ekka-Barber/Chess-Play-Fun/releases/tag/v4.0.1)
- [v4.0.0: Five engines on the board](https://github.com/Ekka-Barber/Chess-Play-Fun/releases/tag/v4.0.0)
