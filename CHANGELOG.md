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
