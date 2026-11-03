# Changelog

Published versions and source archives are available on [GitHub Releases](https://github.com/Ekka-Barber/Chess-Play-Fun/releases).

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
