# V4 performance and correctness audit

3 November 2026, Asia/Riyadh.

What this repo does: CHESS is a local chess workspace with five native UCI engines, move grading, live analysis, engine comparison, and a Brilliant-move archive. This audit assumes one person using the local server, including more than one browser tab. It does not assume a public multiplayer service.

The updated app runs at http://localhost:4655/. Refresh an existing browser tab to load the updated JavaScript and styles.

## Measured results

Measurements use the installed Windows binaries, Balanced power mode, and two engine threads. These are individual local runs, not universal performance guarantees. Search results vary with position, cached engine tables, CPU load, and startup state.

| Path | Before | After | Interpretation |
| --- | --- | --- | --- |
| Completed search for the current position after two rapid off-book moves | 3,219 ms | 1,610–1,630 ms | Current-position analysis runs before historical grading. The configured 1,600 ms search budget is unchanged. |
| First partial next-move suggestion through the local API | No preview before the completed search | 7–10 ms with a warm engine | This first preview was depth 1. It improves during search and is not a completed analysis or grading result. |
| Cold five-engine sweep | 2,601 ms | 1,593–1,697 ms | Binary initialization overlaps. Actual searches still use one shared slot and 300 ms per engine. |
| Browser polling during work | 700 ms interval | 200 ms interval | Idle polling remains 5 s; hidden tabs retain their slower cadence. Engine/power changes immediately refresh state. |
| Repeated unchanged arrow rendering | Replaced SVG nodes on every render | Reuses the existing nodes | SVG serialization made the old string comparison unequal every time. Node identity and highlight retention were verified in Chromium. |

The engine's early preview is distinct from browser delivery: the browser still needs its next poll and render. No claim of a 10 ms browser response is made.

For the next-position measurement, the initial standard position finished analysis first. The harness then posted `a2a3` and `a7a6` without waiting for analysis between the moves, and polled every 25 ms. Completed-search time ran from the second move request until that position had lines and left the thinking phase. For the comparison measurement, pending grading finished first, then the harness requested five 300 ms searches from a newly started coach pool. Cold means new engine processes, not a cleared operating-system file cache.

### Every engine ran for real

All five engines were selected through the browser's Engine control. Each made a legal opening move at 100% strength. All five also completed real comparison searches. Viridithas correctly uses Stockfish for multi-line coaching, while Viridithas itself still plays and casts its own comparison vote.

The following final native-binary run used a 300 ms single-line search. Free-play measurements used the existing maximum normal search budget of 3,000 ms with a deliberately long timing input to prove the artificial wait was gone.

| Engine | Cold first preview | Warm completed 300 ms search | Cold free-play move, 3 s budget |
| --- | ---: | ---: | ---: |
| Stockfish 19 | 414 ms | 302 ms | 3,466 ms |
| Berserk 14 | 111 ms | 313 ms | 3,208 ms |
| Obsidian 16.0 | 110 ms | 291 ms | 3,166 ms |
| PlentyChess 8.0.0 | 237 ms | 201 ms | 3,156 ms |
| Viridithas 20.0.0 | 121 ms | 302 ms | 3,183 ms |

Some engines return before the requested movetime. The wrapper respects their result. No Elo setting, search thread budget, or search duration was reduced for these improvements. Normal free-play searches retain the previous 0.8–3 s distribution; survival mode retains its longer search budget. Only the extra pause after searching was removed, as requested.

## Findings fixed during the audit

1. **P1: A retired engine could answer the replacement engine's search.** The old process retained its stdout callback after retirement. Late `bestmove` and evaluation output could complete a new process's waiter. Stdout is now accepted only from the current process. A failing-then-passing process fixture proves that an old `a2a3` answer cannot replace the new engine's `e2e4` answer.

2. **P1: Restore could erase a move made while the archive loaded.** Revision validation happened before an asynchronous read. The revision is now checked again before replacing the game. The regression test makes a move during the read and verifies HTTP 409 and an unchanged move history.

3. **P2: Historical grading delayed the requested next move.** Analysis searched pending pre/post positions before the position on screen. It now searches and publishes the displayed position first, then completes grading. Tests verify both ordering and eventual annotation completion.

4. **P2: Useful engine output stayed invisible until the search ended.** The UCI callback only published depth and speed. It now publishes throttled PV snapshots, which are converted to the normal client line format. Partial results never enter the completed-result cache, so hints and retry judging cannot consume an unfinished search.

5. **P2: Switching engines relabelled cached output from the previous engine.** Completed results were keyed only by position and survived a binary switch. Engine changes now clear analysis and evaluation caches before searching again. A regression test requires a new multi-line search from the new engine.

6. **P2: Obsidian could play unsupported Chess960 positions.** Capability fallback covered analysis but not full-strength play. Both now choose Stockfish when the selected engine lacks Chess960, with an explicit notice. The existing engine capability test now checks the playing path too.

7. **P2: Berserk appeared to search to depth 200.** Its `info string ... depth 200 ...` diagnostic was parsed as actual search progress. Diagnostic strings are now ignored by the search parser. Native probing reproduced the false depth; a regression test pins the correct depth.

8. **P2: A hidden tab froze analysis in a visible tab.** The server treated any hidden tab as a global pause. It now records each tab's visibility and last contact, pauses only when every tracked tab is hidden, and renews leases through existing polls. Closing a tab removes only its own lease. Expired leases recover through normal polling. Tests cover visible/hidden combinations, closing, missed visibility messages, stale leases, and uninterrupted playing-engine replies.

9. **P2: Retry judging returned results for an outdated board.** The route checked game identity but not the revision after its search. It now rejects a result if undo or branching changed the board during judging. A regression test reproduces undo during the search and requires HTTP 409.

10. **P2: Arrow geometry obscured pieces and blended agreeing votes.** Best-line shaft width fell from 72 to 24 board units. Agreeing votes use separate narrow lanes with distinct heads, contained within the board. Rank 1 paints above weaker suggestions. Hover/focus isolates a move by opacity instead of glow. Stationary-king Chess960 castling points toward the rook instead of producing zero-length geometry. Bounds, agreement separation, and castling are tested.

11. **P2: Five cold starts unnecessarily serialized engine loading.** Each process loaded its binary and network while holding the only interactive search slot. The coach pool now initializes concurrently before acquiring that slot. Cancellation is checked after initialization. The existing exclusive-search invariant remains intact and has regression coverage.

12. **P2: A visible move badge broke the board's ARIA grid.** The badge was exposed as an image directly under a grid, which requires rows/cells. It is now decorative to assistive technology; the same grade remains available in the move sheet and coach. Axe was rerun with a visible badge and reported zero violations. Engine vote controls also receive 44 px touch targets, and badges remain visible throughout their animation.

13. **P2: Free play added a random wait after computing its move.** That pause was removed after explicit user approval. Search-budget distribution and full-strength settings remain unchanged. Native tests with every engine verify that a finished 3 s search is committed without the old long wait.

14. **P2: Cycling Off/Best/Engines could leave engine votes waiting forever.** The client retained its old ready sweep after stopping the server, then treated that stale result as a reason not to request another sweep. Stopping now invalidates the local result immediately. Polling also recovers stopped/paused sweeps, while hidden tabs and engine turns do not restart background sweeps. The regression failed before the fix; a real browser cycle afterward verified five arrows, a visible legend, and 44 px vote controls.

## Verification

- `node --test test/*.test.js`: **116 passed, 0 failed, 0 skipped** locally.
- Native binary searches: Stockfish, Berserk, Obsidian, PlentyChess, and Viridithas. Real UCI moves were replayed through the rules engine for legality.
- Browser: all five engine selections and 100% replies; engine-vote mode; click moves; rapid moves; flip; undo; first/previous/next/latest navigation; Coach/Analysis/Moves/Review tabs; gallery and setup dialog open/close; search-time and power controls; arrow hover; keyboard tab switching.
- Six themes checked at 1440, 390, and 320 px. No horizontal page overflow or arrow points outside the board in the checked states.
- Arrow node identity and highlight retention checked after a forced render.
- Axe 4.12.1: **zero automated violations** with a visible move badge. Single-character coordinates remain an automated manual-review item; this is not a full accessibility certification.
- Production dependency audit: **zero known vulnerabilities** at audit time. No dependency was added.
- `git diff --check`: clean.

Raw local evidence is in `.zcode/perf-before.json`, `.zcode/perf-verified.json`, `.zcode/tests-final.txt`, and the `audit-*-final.png` screenshots. Those development artifacts are intentionally ignored by Git.

## Design-law recheck

This is an operating chess workspace. The real board is the focal artifact; existing self-hosted Sentient and neutral working text remain. Energy 1, rhythm 1, motion 1: calm, stable information placement, with feedback for real interactions. The scope is the working app, not a new promotional site.

| Design-law point | Recheck |
| --- | --- |
| Lucide defaults; redrawn generic icon sets; icons/logos in boxes; invented logos/customer walls | No icon pack, logo wall, or boxed mark was added. Existing chess pieces and functional bare control glyphs remain. Engine squares are data swatches. |
| Em dashes; canned copy; decorative quotation marks | New UI copy states actual chess behaviour. Missing-value score glyphs remain data notation. No quote cards or promotional copy were added. |
| Eyebrow pills; gradient chips; inner-glow status boxes; active-nav dots; eyebrow ticks | None were added. The engine band now uses a compact text grid instead of pill containers. |
| Recycled Google font pairings; novelty faces; monospace everywhere; repeated tracked labels | No typography swap or extra font was introduced. Existing project typography is retained. Engine data uses tabular numerals. |
| Glowing buttons; background blooms; radial halos; candy auroras; gradient type; saturated CTA accents | No such effect was added. Arrow emphasis now removes the previous glow. Engine hues convey engine identity and have matching text labels. |
| Floating cards; app-window props; fake code windows; crude CSS illustrations | The board is real, populated, and interactive. No decorative product prop or fabricated illustration was introduced. |
| Kitchen-sink cards; accent-bar cards; faint box borders; default shadows; duplicate-box shadows | No new card system or shadow was introduced. The legend became simpler and flatter. |
| Pricing cards; fake testimonials; countdowns; pre-footer CTA slabs | Not applicable to the chess workspace. None were added. |
| Split heroes; default hero stacks; label-over-heading sections; numbered process rails; whole SaaS page skeleton | Not applicable. The existing board-and-tools workspace follows the task's information needs. |
| Three-line headlines; dangling accent words; filled/outlined action pairs | No such composition was introduced. Narrow-screen wrapping was visually checked. |
| Full-page graph paper; decorative fixed backgrounds; cream/gray default page surfaces | No decorative background was added. The chess grid is the actual control. Theme surfaces remain specific to the existing board themes. |
| Botched glass; gradients with hard seams; image seams; banded gradients; grain over content | Not applicable to the changed interface. No glass, background image, gradient field, or grain layer was added. |
| Invisible entrance content; botched fill animations; hover boops; underline-fill animations | New feedback uses opacity only for annotation emphasis. Content remains present. The badge animation no longer begins transparent. No button moves on hover. |
| Clipped edges; overlap clipping; uncentered content; cramped display type; edge gutters | Arrow bounds are tested, including edge files, diagonals, and stationary castling. Desktop/mobile screenshots show intact content and consistent gutters. |
| Ragged comparison columns; scattered footer clusters; oversized footer wordmarks | The five engine rows use a shared layout. No marketing comparison grid or footer composition was added. |
| Unreadable text; missing focus; dead controls | Source contrast tests and Axe run pass. Existing focus outlines remain. Changed controls and main flows were clicked in Chromium. |
| Too little invention; no signature; no atmosphere; no icons | The functioning chessboard and restrained engine comparison are the product signature. Annotation geometry is authored for readable chess information rather than decorative novelty. |
| Cohesion; specificity; real data; restrained motion | Engine names, legal moves, evaluations, and capabilities come from the installed engines and registry. Existing theme/type language is kept consistent. |

The final pass checked the supplied design-law points against the changed UI and the workspace states exercised above. Unrelated marketing examples and prescribed hero/footer techniques are not requirements for this chess application.

## Limits and remaining work

**P2: The live game is still held in server memory.** A server restart clears it; this is existing behaviour, not durable storage. A later persistence task should save game snapshots atomically and verify legal replay on load. No database or new storage layer was introduced during this audit. The final development restart used a saved JSON/PGN snapshot and restored the two-move test position; the initial restart reset the previous one-move session.

Not checked: other browser engines, physical touchscreen hardware, full screen-reader sessions, engine source-code internals, absolute playing-strength/Elo calibration, long thermal-soak benchmarks, or live Lichess services. Online integration remains opt-in and its deterministic tests pass. Existing archive/render/collection tests ran, but a new real Brilliant-move collection was not manufactured in the user's archive.

Verdict: the measured next-move path is substantially faster, all five native engines work, and the identified engine-switch, pause, stale-request, and arrow defects are fixed. Durable game storage remains a separate piece of work.
