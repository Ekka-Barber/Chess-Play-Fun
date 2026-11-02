# CHESS audit and repair

Audited 27 October 2026. Scope: the local Express server, Stockfish integration, board interaction, analysis/history, responsive UI, accessibility and launcher.

The original four application files are preserved in `.impeccable/original/`. This directory was not a Git checkout.

## Product behavior

The user controls both sides manually. Standard chess rules and alternating turns are enforced. Stockfish analyses and suggests moves without playing automatically. The original free-edit behavior was removed after the user explicitly rejected consecutive moves by one color.

## Findings and changes

| Priority | Verified problem | Repair |
|---|---|---|
| P0 | The delegated piece handler read `event.currentTarget`, which was the document, so it never found a source square. | Board-level pointer handling with coordinate lookup, pointer capture, a held-piece preview and cancellation recovery. |
| P1 | Illegal moves became raw FEN edits, allowing consecutive moves by one color and invalid chess positions. | Server-side chess.js validation, turn enforcement, and no raw-edit fallback. Client selection follows the same turn. |
| P1 | Every move awaited engine startup through its analysis queue. | Board mutations complete independently; stale engine searches are stopped and queued stale jobs are skipped. |
| P1 | A rejected move could truncate the future game before validation. | Validate against the requested historical position first; truncate only when accepting a legal replacement. |
| P1 | Failed requests could leave optimistic pieces on the wrong squares. | Always restore the authoritative position; display a recoverable error and refresh state. Offline rollback is tested. |
| P1 | Click promotion relied on mutable selection that was cleared before a piece was chosen. | Capture the source before awaiting a native promotion dialog; support keyboard cancellation and all four pieces. |
| P1 | Overlapping responses could apply stale state or analysis. | Revision checks, source-FEN checks, serialized polling and explicit historical-position analysis. |
| P1 | The engine accepted loosely checked arbitrary FEN input. | Only validated positions in the current game's history may be analysed. |
| P1 | Hypothetical pass analysis could submit a position with the wrong king in check. | Do not run null-move threat searches while in check or after the game ends. |
| P1 | Keyboard users could not operate the chessboard or move list. | Labelled grid with arrow/Enter/Space navigation, real move buttons, visible focus and native dialogs. |
| P1 | The launcher force-killed previous matching servers, losing their in-memory games. | The launcher starts normally without killing existing games; duplicate-port errors explain how to open the running app. |
| P2 | Promotion suffixes were omitted from UCI history. | Retain the promotion in both move records and UCI strings. |
| P2 | Threefold repetition was checked from a FEN that had lost move history. | Reconstruct the legal game history for terminal-state detection. |
| P2 | A large centipawn advantage was displayed as mate. | Format numeric evaluations separately from explicit mate scores and retain mate distance. |
| P2 | Black-first variation numbering repeated the wrong move number. | Advance the number after the initial Black move. |
| P2 | Pending classifications used the wrong ply; moves played before analysis could remain unclassified. | Correct indexing and backfill missing pre-move evaluations for nonterminal analysis. |
| P2 | Returning to the latest position could retain analysis from history. | Request analysis for every newly viewed position, including the current tail. |
| P2 | Historical evaluations were not retained and the graph could imply missing data was evaluated. | Store each analysed position and show an explicit count; leave genuinely unsearched positions as gaps. |
| P2 | The search-time selector reset visually after reload. | Return the active analysis time with state and restore the control from it. |
| P2 | Platform chess glyphs varied in shape and rendering. | Self-host the complete Cburnett SVG piece set with attribution and license. |
| P2 | Small labels and crowded controls weakened readability. | Increase functional text, use a coherent forest palette, simplify analysis rows, and keep the board dominant. |
| P2 | The narrow toolbar overflowed at 320px. | Use two labelled rows with 44px navigation targets on small screens. |
| P2 | Reduced motion and interrupted gestures were incompletely handled. | Remove piece gliding under reduced motion; clean up capture on cancel, lost capture, blur, resize and backgrounding. |

## Verification

- Nine Node regression tests pass. They cover legal turn order and check, castling, en passant, legal underpromotion, atomic branches, stale requests, repetition/checkmate, input validation and score formatting. The UCI boundary is deterministic in these tests.
- Thirteen browser check groups pass against real Stockfish. Evidence: `.impeccable/review/browser-results.json`.
- Real Chromium mouse and keyboard input exercised dragging, outside-board drops, flipped dragging, click moves, every history button, move-sheet selection, branching, undo, new-position confirmation, promotion cancellation/underpromotion, arrow visibility, engine-line playback and search-time changes.
- Chromium CDP touch input exercised a drag and an interrupted touch. Physical touchscreen hardware was not available.
- Offline simulation verified rollback, error feedback and automatic reconnection.
- Captures cover 1440×900, 1254×900, 390×844 and 320×740. No horizontal overflow or missing assets at those sizes.
- axe-core 4.12.1 reports 48 passes and no automated violations. Single-character coordinate/key labels were manually measured at a minimum 4.71:1, including selection and last-move states. Evidence: `.impeccable/review/contrast.json`. This is not a complete accessibility certification.
- The Impeccable detector ran once. Its undersized-type findings were addressed; final functional text is at least 12px, with 11px board coordinates.
- Production dependency audit reports zero known vulnerabilities. No runtime dependency or framework was added.

## Visual direction

A user-approved forest tournament workspace. The real board is the focal artifact, with self-hosted Sentient headings, neutral working text, quiet analysis rows, contextual turn state, and restrained piece movement. The interface remains an operating surface rather than a promotional page. Design tokens and final review are recorded with the project.

Independent finish review returned `ship`. Its subsequent verdict also marked the selected-coordinate contrast correction resolved. Evidence: `.impeccable/review/finish-review.md`. The point-by-point design-law recheck is `.impeccable/review/design-law-check.md`.

## Limits

The game remains in server memory and is shared between tabs. Restarting the server clears it. The bundled engine is Windows-only. Other browser engines, physical touch devices and full screen-reader sessions were not tested. Move-quality labels are short-search heuristics. Positions not searched by the engine remain gaps in evaluation history. No accounts, persistence, online opponent or automatic engine opponent were added.

## Version 2 (27 October 2026)

Requested by the user after v1: no error message on illegal moves, legal-move dots, visible move badges, engine and free-play modes, Chess960, themes, ten engine strength steps, a teaching coach, and saved images of brilliant moves.

- **Illegal moves:** the client checks the server's legal-move list. A rejected drop slides back to its square without a message. If the server rejects a move with `ILLEGAL_MOVE`, the board re-syncs silently.
- **Legal destinations:** selecting or picking up a piece shows dots on empty squares and rings on captures. In Chess960 the king's own rook gets a ring, because castling is king-onto-rook.
- **Badges:** chess.com-style circles on the destination square and in the move sheet, colour-coded per grade. They come from `lib/tutor.js`, a local expected-points model, and are not claimed to match chess.com.
- **Modes:** free play and play-against-Stockfish (10–100% in steps of 10, mapped to Skill Level 0–20 with longer think time at higher levels). Standard or Chess960 with a chosen or random position. Analysis uses a separate full-strength engine process.
- **Coach:** grades the move leading to the viewed position. In engine mode it grades your last move, not the engine's reply. Shows the explanation, expected continuation, depth, evaluation and loss, plus a next-move hint. In engine mode the hint is hidden until you ask.
- **Brilliant archive:** saved automatically to `Brilliant Moves/` as PNG + PGN + metadata (`lib/archive.js`), with a gallery and a "study from this move" restore. Engine moves are not archived.
- **Themes:** six palettes from `public/themes.js`, applied as CSS variables. Coordinate ink is computed per square colour. The theme is remembered in localStorage and sent to the server so archive images match.

Verification:

- 47 Node tests pass, including a new engine-mode turn test.
- Real pointer input in the in-app browser: illegal drop snap-back (no toast), dots and rings, drag and click moves, standard and Chess960 castling, the engine game as Black (auto-flip, engine opens), hint reveal, the Brilliant flow end to end (Légal-trap Nxe5!! classified, PNG saved, gallery and restore), all six themes, and 375px with no horizontal overflow.

Fixed during verification: restored games lost the `!!` symbol, because archived annotations do not store it.

Not re-run for v2: axe, the contrast measurements and `test/browser.cjs`, which still targets the v1 interface. Physical touch devices are untested.

## Version 3 (27–28 October 2026)

- **Free play "Stockfish plays":** the chosen side is played at full strength with a random 1–10 s pause before each move. The pause runs outside the engine queue, so undo never waits behind it.
- **Elo levels:** engine-mode strength 10%–90% now sets `UCI_LimitStrength` + `UCI_Elo` (1320–2800, which Stockfish 19 allows). 100% is unlimited. This replaces the Skill Level mapping. Stockfish's Elo mode is calibrated but still a weakened engine, not a human-like model (that would need Maia/lc0).
- **Sounds:** added, then removed at the user's request. No audio code remains.
- **Desktop board:** sized from the viewport height (`100svh − 225px`, capped at 1040px). The page heading is visually hidden on desktop and kept for screen readers.
- **Game review:** built from `.impeccable/research/game-review.md`. That brief was researched with REA (lichess served headless Chrome a bot page and chess.com needs a login, so the evidence was partial), lila source, chess.com help pages and a numeric check (88/88 side accuracies matched lichess). The server backfills an eval for every position (`reviewAll`), starts the review at game end and judges retry moves on a scratch position (`POST /api/try`, run on the playing engine). The client adds the Review tab: accuracy, graph, grade table, key moments, walkthrough and retry.

Verification: 50 Node tests (including the review backfill, auto-start at mate, and retry judging that leaves the game untouched). Real Stockfish in the in-app browser: Scholar's mate reviewed in about 12 s, accuracy 90/22, 3… Nf6 found as the key blunder. A wrong retry (d6, −52%) was rejected, replaying Nf6 was refused, g6 was accepted as best, and Show best displayed the line. The 375px layout does not overflow. Not done: per-phase accuracy, a "Miss" grade, re-searching shallow positions to a common depth, and an accuracy/contrast re-audit.

## Fixes (28 October 2026)

- **Takeback with "Stockfish plays" in free play:**
  - **Problem:** Undo used the vs-Stockfish rule (rewind to your turn), and Stockfish replayed instantly. Its move could never really be taken back. With Stockfish as White, its first move could not be undone at all.
  - **Fix:** in free play, Undo now removes exactly one move and pauses Stockfish (`enginePaused`). While it waits you may move its side, or press "Let Stockfish play" (`POST /api/engine-move`). Your next move resumes it. Moving from a history position works for either side. Engine mode keeps the two-move takeback.
- **Brilliant moves stopped appearing:**
  - **Cause:** move grading used fixed 1.2–1.6 s searches. On this i7-1255U laptop, with the playing engine searching at the same time, these reached only depth 12–13 for about a third of moves, below the depth-14 floor `lib/tutor.js` requires for Brilliant and Great. Saving itself was fine.
  - **First fix (reverted):** depth 16 for every graded move. It made easy moves take up to minutes on this laptop.
  - **Final fix:** grading keeps the quick time-limited search, about 3 s per move. When the quick search finds a sound sacrifice it is too shallow to confirm, `assessMove` returns `needsDepth`, and the server re-searches just those two positions to depth 16 (8 s cap) before grading. Measured with the real engine: easy moves graded in 3.2–3.3 s.
- **Deep whole-game review:**
  - A toolbar "Review" button (and the Review tab) re-checks every position at depth 22 (20 s cap) on a third Stockfish process (`reviewEngine`), so navigation never interrupts it. Each move is re-graded as soon as both positions around it are deep, so results improve live.
  - Depth 22 was chosen after benchmarking this machine: depth 20 took 3–16 s, depth 22 took 6–51 s and depth 24 took 7–46 s per position, all with 3 candidate lines. 10 threads were slower than 4 under load.
  - Measured: 5 positions in 64 s.
- **Deep review depth set to 20** (user choice, 28 October 2026): `DEEP.depth` 22 → 20. Measured 3–16 s per position here, versus 6–51 s at depth 22. The 20 s per-position cap is unchanged.
- **Free-play Stockfish plays a random top move** (user request): it searches 5 candidate moves and plays one picked at random from the top 4 or top 5 (`timing.pick`), instead of always the best. Engine mode keeps its Elo levels.
- **Forced-mate guard** (user request): when its best line is a forced mate for Stockfish, the free-play side plays it instead of a random pick. Real-engine check: 4.Qxf7# found 5/5 times in the Scholar's-mate position.
- **Random top-5 is now opt-in** (user request): the `variety` setting, off by default, is a checkbox in the setup dialog when Stockfish plays a side in free play. Off: best move from a single search. On: random top-4/5 pick with the forced-mate guard.
- **Survival mode for Random top-5** (user request): `varietyPick` plays the best line on any forced mate (for or against Stockfish) or when Stockfish is losing (best line under 0.35 expected points). Otherwise it picks at random only among top moves within 0.10 expected points of the best, so it never plays worse than an inaccuracy and plays the best move when only it holds.
- **Survival mode reworked** (user clarification): it is triggered by Stockfish's own eval at −3 pawns or a mate against it, not the earlier −1.7 / mistake-filter rules, which were removed. While active, the free-play side searches one line for max(2 s, pause) at full strength. It exits above −1.5 (hysteresis). `survival` is exposed in game state and shown on the name tag.
