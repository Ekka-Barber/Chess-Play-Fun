# Configure CHESS without dropdown menus

Written against: `12bfe1710ac7e1e27d29c4105fc17cb9f50813e1`.

Status: implemented in the subsequent November 3 product pass. All ten selects were replaced with native radio groups or the Online checkbox. Appearance includes six board previews and five piece sets. The original audit below records the design evidence and intended scope.

## Design language

- Audited surface: the v4 application's game-and-analysis configuration flow at `/`: header controls, the analysis panel, and New game.
- Design sources: the user's current instruction, "I DO NOT LIKE DROPDOWN MENUS"; the current `DESIGN.md`; the shipped `public/index.html`, `public/style.css`, `public/app.js`, and `public/themes.js`.
- Documented decisions: a board-dominant tournament workspace; six theme token sets; self-hosted Sentient for display type; Segoe UI/system text for working controls; tonal surfaces; small control radii; restrained interaction feedback.
- Governing owners and consumers: `public/index.html` loads `style.css`, `themes.js`, `clock.js`, and `app.js`. The ten select elements are read, populated, and synchronized by `app.js`; theme values come from `themes.js`; backend settings and analysis remain owned by `server.js`.
- Explicit exceptions: the current user instruction supersedes the documented native-select presentation for this flow. The user excludes a separate accessibility audit. Existing basic keyboard operation and focus behaviour remain part of the product.

## Findings

| # | Problem | Evidence | Proposed change | Scope | Confidence |
| --- | --- | --- | --- | --- | --- |
| 1 | Configuration still requires dropdown menus despite the user's explicit rejection of that interaction. | Contract: the current user request. Runtime: `public/index.html` declares ten selects: `theme`, `engine`, `power`, `speed`, `online`, `gameMode`, `gameBot`, `gameVariant`, `gameSide`, and `gameClock`. `app.js` populates the theme and engine selects and reads the remaining values through the same rendered entry point. Correction: expose their existing choices through direct selection controls. | Replace dropdown-based configuration with visible choices, retaining every existing value and action. | Header, analysis controls, and New game in v4 only. | High |

### Counterevidence checked

`DESIGN.md` explicitly describes header selects and a native analysis-time select. The selects are therefore part of the existing system. The new user direction changes that presentation contract. This finding makes no claim that the controls are broken, that the current palette is wrong, or that an unrendered replacement has already improved usability.

## Improve first

Replace the dropdown-based configuration flow. Start with engine selection, because it contains the five engine choices and the comparison entry point central to this application's primary task. Treat the replacements as one coordinated change so dropdowns do not remain in setup or secondary settings.

## Evidence chain

- Surface: `/`, `.header-actions`, `.panel-summary`, `#analysisPanel`, and `#newDialog`.
- Problem: a source-verified total of ten dropdowns conflicts with the user's stated interaction preference.
- Design evidence: `DESIGN.md` sections Overview, Typography, Layout, Components/Header controls, Buttons, Analysis tab, and Dialogs and notices. The relevant style values are present in `public/style.css`; this establishes that those portions of the document govern the shipped UI.
- Owner: markup in `public/index.html`; event handlers and state synchronization in `public/app.js`; presentation in `public/style.css`; theme data in `public/themes.js`.
- Scope and affected surfaces: the same application's main workspace and game-configuration dialog. Include the script and test consumers listed below. Exclude the older application under the parent CHESS directory.
- Uncertainty: no replacement has been rendered in this pass. Fit, density, and selected-state legibility require actual browser verification during implementation. Source inspection and user feedback establish the need to remove dropdowns, not a completed visual result.

## Design decision

Make frequent chess decisions direct and visible. Place engine choices and compute controls with the analysis panel they affect. Keep occasional appearance selection in a native dialog with visible theme previews. Show game options as finite choice groups inside the existing New game dialog.

The board remains the focal object. Retain the current themes and typefaces. Do not introduce a new dashboard shell, ornamental cards, gradients, glow, icon tiles, or decorative statistics.

Planning dials: energy 1, rhythm 2, motion 1. The workspace remains calm; control group shapes reflect their different jobs; feedback uses existing short colour/surface transitions. Content must remain visible without waiting for an animation.

### Control map

| Current dropdown | Replacement and location | Existing values/meaning to preserve |
| --- | --- | --- |
| `engine` | A visible two-column engine bank below the existing panel summary. Separate **Compare all five** action directly below it. | Build the engine bank from `/api/engines`. Preserve the selected `engineId`. Comparison changes arrow mode, not the selected backend engine. |
| `power` | A labelled three-choice row beside the engine configuration, visible regardless of the active tool tab. | `full`, `balanced`, `laptop`. This changes resource budgets, not Elo strength. |
| `theme` | An **Appearance** header button opens a native dialog containing all six named board previews. | Generate from `THEMES`; previews use each entry's actual `light` and `dark` colours. Keep browser persistence and the existing settings POST. |
| `speed` | Three visible choices at the top of Analysis: **Fast 0.9 s**, **Balanced 1.6 s**, **Deep 3 s**. | Numeric budgets `900`, `1600`, `3000`. Preserve the existing settings update and immediate poll. |
| `online` | A labelled native checkbox: **Lichess lookups**, with the existing off-by-default explanation. | Boolean `onlineFeatures`. Use the existing `setOnline()` path; it owns cache clearing and fetching. |
| `gameMode` | Two direct choices in New game: **Free play** and **Vs engine**. | `free`, `engine`; retain the selected engine's name in supporting copy. |
| `gameBot` | Three direct choices: **Both sides mine**, **Engine White**, **Engine Black**. | Empty string means no engine side; `w` and `b` retain their current meanings. |
| `gameVariant` | Two direct choices: **Standard** and **Chess960**. | `standard`, `chess960`; retain conditional seed input. |
| `gameSide` | Two direct choices: **White** and **Black**. | `w`, `b`; retain automatic orientation and engine-opening behaviour. |
| `gameClock` | Full-width preset row in New game: **No clock**, **3+2**, **5+0**, **10+0**, **Custom**. | `off`, `3+2`, `5+0`, `10+0`, `custom`; retain the existing custom inputs, validation, and tab-local clock lifecycle. |

The Appearance dialog is a visual choice surface, not a custom dropdown or a popover list. Its six options are visible together. All primary engine and analysis choices remain directly available in the workspace.

## Reuse

- Palette: `--bg`, `--surface`, `--raised`, `--text`, `--muted`, `--accent`, `--ink`, plus each theme's existing board colours. Add no independent accent palette.
- Typography: existing Sentient display styles and system body/control styles.
- Control shape and feedback: existing button radius of 5 px, 44 px base control height, and background/colour transitions. Use `.board-actions button[aria-pressed='true']` as the selected-state appearance exemplar: raised surface and accent text, with weight used to reinforce selection.
- Layout: the existing panel summary, `.engine-settings`, `.setup-grid`, and the current responsive breakpoints. Use existing 4/8 px control gaps and the 14 px setup-field gap rather than creating a second spacing scale.
- Dialog structure: the existing `.dialog-heading`, `.dialog-actions`, native `showModal()`/`close()` pattern, and its 24 px padding and 10 px radius. Use the promotion dialog's direct visible choices as the existing interaction exemplar for Appearance.
- State owners: `applyTheme()`, `syncEngineName()`, `setOnline()`, `openNewDialog()`, `syncSetup()`, the current settings handlers, `setArrowMode()`, `scheduleSweep()`, and `stopSweepRemote()`.

Use native radio groups for mutually exclusive choices and a native checkbox for Online. The project has no reusable visible-choice form primitive: existing value handling assumes a select's `.value` and `.options`. Small DOM get/set helpers are justified only where shared by these groups. Do not introduce a custom component framework, dependency, hidden select fallback, or generic settings schema.

## Changes

1. `public/index.html`
   - Change: replace all ten select controls according to the control map. Keep useful group IDs, and give each group a stable name for reading and syncing its checked value.
   - Change: simplify the header to its existing brand/mode area, Appearance, Brilliants, and New game. Place the engine bank and Power row under `.panel-summary`, above the existing four tool tabs.
   - Change: add the Appearance dialog using the existing native-dialog structure. Render six named previews, three columns at desktop widths and two columns at the existing 520 px breakpoint.
   - Change: keep the five New game groups in the current setup structure; let Clock span the full grid width so the presets can wrap as a group. Keep the existing strength slider, random top-5 checkbox, seed field, custom clock inputs, error region, and Start game action.
   - Preserve: board layers, history controls, real engine results, the four tools, gallery, promotion, restore, and destructive-branch confirmation.
   - Verify: `document.querySelectorAll('select').length === 0`; no replacement uses a custom dropdown, concealed option menu, or redundant settings screen.

2. `public/app.js`
   - Change: replace `fillEngineSelect()` with a registry-driven engine-choice renderer and update its startup caller. Preserve truthful availability when only a subset of engines is installed.
   - Change: adapt `syncEngineName()`, `applyTheme()`, `renderPanels()`, `openNewDialog()`, `syncSetup()`, `setOnline()` rollback, settings handlers, and `#newForm` submission from select properties to checked group values.
   - Change: remove the `gameMode.options[1]` dependency. The engine's name belongs in its existing supporting copy rather than a nonexistent option node.
   - Change: wire Compare all five through the current sweep/arrow lifecycle. Toggling it off returns to Best; selecting a single engine leaves comparison mode through the existing stop path. Do not submit `__votes__` as an engine ID.
   - Preserve: existing API payloads, numeric conversion for analysis time and strength, empty engine-side value, session settings synchronization, failure toasts, and user-action requirements for playing a suggested move.
   - Preserve: no engine search on theme preview hover, no extra polling loop, and no reduction in search strength or resource protections.
   - Verify: after reload, server updates, failed settings writes, undo, or a new game, selected controls agree with the actual game/settings state.

3. `public/style.css`
   - Change: style the native choice labels using the existing button and active-state appearance. The engine bank is two columns; Power and search-time choices are compact wrapping rows. These are controls, not decorated feature cards.
   - Change: use the real light/dark square colours for each Appearance preview, with the full theme name visible and a clear selected state. No uniform icon-pack marks or coloured icon boxes are needed.
   - Change: remove select-only styling made unused by this replacement, including `#theme`'s narrow-screen width assumption. Keep number-input and unrelated form styling intact.
   - Preserve: 360/320 px analysis-column behaviour, board-first mobile ordering, existing theme tokens, visible content, and the existing reduced-motion rules.
   - Verify: the primary header remains compact; the engine bank fits the actual panel width; long engine names and theme names remain intact; all choices fit at 1440, 1050, 760, 390, and 320 px. The setup dialog remains scrollable when Custom clock adds fields.

4. Existing test and capture consumers
   - `test/browser.cjs`: replace `#speed.value` assertions/assignments at the analysis-time checks with actual choice selection and a server-state assertion. Do not keep a hidden select just to satisfy this fixture.
   - `test/clock.test.js`: retain the `gameClock` owner and verify that preset/custom branches still feed the existing clock code. Adapt markup expectations only when the presentation changes them.
   - `test/ui-contrast.test.js`: retain arrow/sweep lifecycle regression coverage. Replace the assertion that comparison is exposed through a picker sentinel with a meaningful assertion for the direct Compare action if the sentinel becomes unused.
   - `scripts/capture-screens.mjs`: keep the existing tab and arrow workflow, then refresh its captures after the new controls have been tested. It currently relies on the real UI, not on the select markup.
   - Add one focused browser check covering all ten replacement controls, confirmed state after reload, and zero select elements. Preserve the existing 116-test baseline; do not delete behavioural regressions to get a green run.

## Scope

- Inherit: v4's single workspace, all six themes, installed-engine variants, analysis controls, and New game configuration.
- Verify: only-Stockfish installs; all five installed engines; Obsidian/Chess960 fallback notice; Viridithas coaching fallback; comparison on/off; online opt-in and rollback; Standard/Chess960; both player colours; free-play engine sides; every clock preset and custom input branch.
- Exclude: parent-directory/older applications, server APIs, engine scheduling and budgets, chess rules, grading algorithms, clocks' mathematical model, persistence, new fonts or branding, and a separate accessibility audit.
- Do not commit or push as part of this plan's execution unless separately instructed. This planning pass creates only this file.

## Validation

- Product: change the engine, power, analysis time, theme, and Online setting without opening a dropdown. Start each supported game configuration through direct choices.
- Interface: inspect desktop and narrow layouts in every existing theme. Check long labels, one-engine installs, pending/failed settings updates, conditional form fields, and the scroll position of Start game.
- Basic operation: retain normal native-control keyboard selection and the current focus treatment. No separate accessibility certification or audit is in scope.
- System: exactly one state owner per setting; existing theme and active-state tokens; no new dependency; no parallel custom-select component; no fabricated engine availability.
- Repository: `npm test` must preserve the current 116-test baseline and pass any added regression checks. `git diff --check` must pass.
- Browser: every replacement must be clicked. Confirm the actual setting or game result after each change, rather than accepting a visual pressed state alone. Verify a complete Off/Best/Engines cycle after a poll has refreshed state.
- Performance: changing presentation must not create additional background searches, extra polling timers, or repeated control rebuilding on unchanged polls. Preserve the current next-move response path.

## Antislop UI review of the proposal

- Identity: existing board themes and typefaces remain the governing system.
- Accent: selected controls use existing tonal state treatment; engine colours continue to identify real engine votes.
- Composition: the chessboard stays primary; controls are grouped by the decision they affect. No dashboard shell, stat cards, marketing hero, or decorative section is introduced.
- Shape: existing control/dialog radii are reused. Choice groups do not become pill chips, glowing tiles, or feature cards.
- Icons and previews: existing bare functional icons remain. Theme previews show actual board colours and have a concrete predictive purpose.
- Motion: retain short surface/colour feedback. No hover lift, looping decoration, invisible entrance content, or animated underline is introduced.
- Content: labels represent existing options, real engine availability, and actual settings. There are no invented numbers, endorsements, or activity entries.
- Resilience: responsive fit and real control behaviour remain implementation gates. This plan does not claim that an unbuilt layout has passed those gates.

## Stop conditions

- Stop and reconcile this plan if ownership or the setting values differ from the recorded commit.
- Stop if an implementation needs a backend/API change, changes a clock's lifecycle, or alters engine capability fallback. Those changes are outside the presentation task.
- Stop if a proposed replacement is a custom dropdown under a different name, depends on a new library, or removes a valid existing configuration.
- Stop if satisfying desktop layout clips names or controls at narrow widths. Fix the wrapping within the existing responsive system before calling the presentation complete.

## Design documentation

After implementation acceptance and browser validation, update `DESIGN.md` sections Layout/Header, Header controls, Analysis tab, and Dialogs and notices to describe direct engine/power controls, the Appearance dialog, and finite choice groups. Update the README control instructions and real screenshots at the same time. Do not update those documents during this read-only planning pass.
