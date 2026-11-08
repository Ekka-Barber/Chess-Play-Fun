# Brilliant move review

Work is confined to v4 on branch `improve/brilliant-review-dependencies`.

## Acceptance

- Recognize sound exchange sacrifices, newly exposed defended pieces, and voluntary offers of an attacked piece without rewarding ordinary exchanges or unavoidable material loss.
- Evaluate winning alternatives instead of rejecting a sacrifice because its own best continuation wins.
- Keep legal replay, confidence checks, Chess960, and before/after evaluation safeguards.
- Inspect Take Take Take with the reverse-engineer-anything skill. Preserve evidence and distinguish observed behavior from inference.
- Improve move feedback, motion, colors, and useful explanations while preserving the current chess workspace.
- Audit every installed dependency, migrate duplicate functionality, and test any replacement before removal.
- Run tests and the build gate after each change. Measure installation size before and after. Keep the feature branch unmerged.
- Verify browser interactions, keyboard use, reduced motion, themes, small screens, and the full supplied design law before completion.

## Baseline

- 130 tests pass.
- The app serves source directly and had no build command. The new build gate checks every source/test script and local HTML assets.
- Installed dependency files: 8,548,054 bytes in 769 files. The lockfile lists 84 package paths including optional platforms.
- Direct packages: chessops, express, @resvg/resvg-js, and the development-only chess.js.

## Progress

- Completed the classifier, engine confirmation, continuation viewer, native celebration, saved-line validation, and dependency audit on the existing branch. No merge.

## Why apps disagree

The engine supplies evaluations and candidate lines. The application supplies the Brilliant rule. Sharing Stockfish does not imply sharing its labels.

[Chess.com's published classification guide](https://support.chess.com/en/articles/8572705-how-are-moves-classified-what-is-a-blunder-or-brilliant-etc), checked on November 8, 2026, describes a good piece sacrifice near the best move, an acceptable resulting position, and the absence of a simple win without finding the sacrifice. Its generosity also depends on player rating. Its exact formula is not public. Our rule is rating independent.

[Lichess's current server advice implementation](https://github.com/lichess-org/lila/blob/master/modules/tree/src/main/Advice.scala), checked on the same date, generates Inaccuracy, Mistake, and Blunder judgments. It does not generate Brilliant in that classifier. A visible `!!` can be a study/PGN annotation or a third-party feature; the user's unspecified Lichess example cannot establish which.

Take Take Take's observed celebration and commentary are separate from its private classification service. Browser assets expose presentation code, not enough information to claim its exact Brilliant algorithm.

## The user's exact Take Take Take example

Game: [CZ_Eternal34k versus sweaty alien](https://taketaketake.com/games/js706nn0kdyzmg8vv264q097f98hs2ad?perspective=black). The shared position identifies ply 87, **44...Rxc5**. Stepping back and then forward replays the celebration.

Before: `2r3k1/2N4p/1K4p1/2P5/8/2r5/8/8 b - - 0 44`.

After: `2r3k1/2N4p/1K4p1/2r5/8/8/8/8 w - - 0 45`.

The tactical idea is `Kxc5 Rxc7+`: the offered rook draws the king away from the knight. The authenticated reference view calls it Brilliant and explains that idea. Our separate Stockfish 19 check reached depth 18, one thread, 32 MB, with a 2.5-second cap per position. Before the move, `g5`, `Rc1`, and `Rb8` scored White -8.39, -7.87, and -7.85. After Rxc5, the best reply scored White -9.31. Those simple winning alternatives keep this move **Excellent** under our rule, despite zero expected-points loss. A regression fixture preserves this deliberate distinction. The example demonstrates a policy difference, not a failure to see the sacrifice.

## Classifier changes

| Previous restriction | Resulting behavior |
| --- | --- |
| Rejected every non-pawn capture | Sound exchange sacrifices can qualify. |
| Treated every defended piece as recoverable in one capture | Bounded legal same-square exchange search accounts for recapture chains, pins, checks, promotions, and the option to decline. |
| Rejected every previously attacked piece | A searched non-losing alternative must save its material before a continued offer can count as voluntary. |
| Rejected a best evaluation above 80% outright | Checks up to three actual alternatives for a simple non-sacrificing win. A sacrifice that creates the win can qualify. |
| Excluded opening-book moves from review | Reviewed book moves can qualify for Brilliant. |
| Applied quality gates before shallow confirmation | Candidate sacrifices request confirmation before a shallow score dismisses them. |

Retained safeguards: replay must match the resulting FEN; the move must have more than one legal choice; a non-pawn offer must concede at least two material points; achieved before/after depth must reach 14; expected-points loss must not exceed 0.02; the resulting local estimate must be at least 0.45. Equal trades, unsound sacrifices, forced single moves, and unresolved exchange searches do not earn the badge. Exchange search stops after eight captures or 256 nodes. Legal UCI replay handles Chess960, including stationary-king castling.

The local sigmoid is `1 / (1 + exp(-0.00368208 * cpFromMoverPerspective))`. These estimates are heuristic confidence scores, not a promise about human game outcomes or Chess.com's rating-sensitive probabilities.

## Engine confirmation and explanations

- Shallow candidates search deeper with the existing engine processes and bounded search time.
- Leela's MCTS depth cannot satisfy alpha-beta confidence gates, even if it reports 18. A separate Stockfish process confirms its sacrifice candidates. Other alpha-beta engines use the achieved-depth gate. Selected-engine suggestions remain attributed to their own source.
- Before/after verification failures leave a visible unconfirmed candidate. Acceptance-line failures leave the valid grade and a retry action. Stale results cannot write into a new game or changed position.
- The acceptance search is restricted to the legal capturing move. Its line, evaluation, achieved depth, and actual engine are retained.
- Explanations describe legal move effects, the expected reply, an available stronger move, and a forced mate only when the searched score supports it. They are deterministic observations, not generated positional commentary.
- If they take, Explore the reply, and Compare open an independent board. Start, Previous, Next, the timeline, and Left/Right/Home/End navigate it. Focus survives timeline rebuilding; an open dialog prevents main-game keyboard shortcuts.
- New archive entries validate and preserve the legal FEN/SAN/UCI sequence and sacrifice evidence. Old entries remain readable and offer Load study lines. Existing archive evidence is not overwritten.

## Reference evidence and authored motion

The explicitly invoked reverse-engineer-anything skill was used for public script inspection and controlled browser scenarios. No reference source code or assets were added to production.

| Evidence | Scope and result |
| --- | --- |
| `ev_708dceb3217b2b95a3bc548c53bb21f003ab4be9fdf1e5d27539d0557f45ad7d` | Static presentation investigation; six selected script bodies. Semantic coverage was capped at 20,000 items per file, and other scripts were outside that selection. |
| `ev_eb59ceb5659c23558781e450ca002535239372ad4693acaa83b93cfa66ee6767` | Exact shared game's Previous/Next replay, complete, with frame captures; owned browser terminated. |
| `ev_0b656863271eae14760cc72238b452ba853a5b2b6bf8c58d6048c96a35bb59e8` | Final local desktop study/reply/replay scenario, all 16 steps complete; no console/page errors. |
| `ev_a22cd9d5440dcfbbc0ed5cb94091146c834afc449673720b414461e290ee5766` | Final 320 px reduced-motion study scenario, all 14 steps complete; no console/page errors. |
| `ev_10ef88439545e01ca924411a0604f9e79090cb99536b265e504efdd7f12f9a03` | Final 390 px comparison, six themes, preview, flip, history and tabs: all 25 steps complete; no console/page errors. |

The exact reference visibly lifts the moved piece, then spreads a turquoise checker wave from the destination. Static code describes a 75 ms distance delay, 120 ms attack and 400 ms decay, conditional falling `!!` marks, and a separate position-commentary service. Rain was not observed in the exact replay, so the static module is not proof that every Brilliant triggers it. The reference uses TypeGPU/WebGPU; copying that rendering stack would add unnecessary dependencies here.

Our authored implementation uses the native Web Animations API: a bounded piece lift, landing at 320 ms, a 75 ms per-square wave delay, and fourteen bare `!!` decorations beneath the live pieces. All finish and are removed within 2.2 seconds. The badge remains readable deep teal; only the transient wave uses brighter turquoise. No blur, halo, floating card, or third-party animation dependency was added. Top-edge lift is bounded so a flipped board cannot crop a live piece. Reduced motion suppresses decoration while retaining the static grade. Replay replaces the previous run; history, flip, hidden tabs, and changed motion preferences cancel it. Only owned animations are cancelled.

Local evidence is retained in `.impeccable/taketaketake-evidence.json`; exact reference frames are in `.impeccable/t3-exact-celebration/`. Final desktop and 320 px PNGs are `.impeccable/brilliant-desktop.png` and `.impeccable/brilliant-mobile.png`. Browser screenshots can settle finite animation, so an additional native browser inspection paused the running board animations at 650 ms to verify the visible wave. Runtime sampling observed 64 wave cells and 14 glyphs, then cleanup. These ignored artifacts are local audit evidence, not shipped app assets.

## Evaluation and verification

The fixed 100-position corpus comes from [Chessigma's public Brilliant dataset](https://www.chessigma.com/benchmarks/brilliant/data). Its positive labels were not independently verified against live Chess.com accounts. It is a positive-label agreement check, not an accuracy, recall, or precision claim.

Stockfish 19: one thread, 32 MB, pre-MultiPV 3 and post-MultiPV 1, 1.4 seconds per position with depth-18 target. Ten previously measured snapshots used 1.8 seconds and post-MultiPV 3. All 100 legal records completed without engine errors. The final rule was regraded against those same stored analyses, with no new engine searches.

| Measure | Baseline | Final |
| --- | ---: | ---: |
| Brilliant matches among 100 supplied positives | 5 | 35 |
| New matches | | 30 |
| Baseline matches lost | | 0 |
| Local grading time, median / maximum | | 6.09 / 41.14 ms |

Results and source hashes are retained in `.impeccable/classifier-final-summary.json` and `.impeccable/classifier-full-benchmark-results.json`. The earlier 23-match report predates the sound-escape fix and is retained as historical evidence.

The final suite has 158 passing tests and zero skips. `npm run build` checks 36 JavaScript files and local HTML assets. Tests/build passed after each conceptual production change. Meaningful regression tests cover direct/indirect offers, sound escapes versus unavoidable losses, equal/unsound exchanges, winning alternatives, Chess960, verifier failure and stale completion, high Leela depth, archive corruption, animation ownership/cleanup, reduced motion, timing, top-edge bounds, and contrast across all six themes. The final reload check also found premature hint requests during partial analysis; the client now waits for a completed report and a regression test covers request timing and deduplication.

Actual Chromium pointer and keyboard checks exercised the new study controls, expected reply, missed-mate comparison, collection Study/restore, history, flip, tabs, theme choices, and reduced-motion preview at desktop, 390 px, and 320 px. The main game remained unchanged while studying a line. The 320 px screenshot shows the complete title, close button, board, navigation, wrapped timeline, and explanation without clipping. The full design-law review is recorded separately in [the design audit](brilliant-design-audit.md).

The dependency audit removed only chess.js, reducing installed file bytes by 724,161 (8.47%). See [the complete package ledger](dependency-audit.md), including retained dependencies, replacement line counts, clean-install validation, and the ignored scratch-directory cleanup limitation.

Limits: exact proprietary classification parity is unproven; false-positive rate is not measured by the positive-only corpus; targets may hit their search-time caps. Physical touch hardware and a full screen-reader audit were not run. No live game was imported from an external account, and the feature branch is unmerged.
