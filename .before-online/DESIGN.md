---
name: CHESS
description: A focused tournament workspace for local chess analysis.
colors:
  bg: "#24231f"
  surface: "#2f2e29"
  raised: "#414039"
  text: "#f1eee5"
  muted: "#c4c0b3"
  light: "#ede2cd"
  dark: "#a78162"
  accent: "#ded5b9"
  ink: "#24251f"
  danger: "#f1b4a1"
  selected: "#d8d899"
  arrow-move: "#163520"
  arrow-threat: "#4d2019"
  target: "#221a12"
typography:
  display:
    fontFamily: "Sentient, Georgia, serif"
    fontSize: "35px"
    fontWeight: 500
    letterSpacing: "-0.03em"
  headline:
    fontFamily: "Sentient, Georgia, serif"
    fontSize: "29px"
    fontWeight: 500
    lineHeight: 1.2
    letterSpacing: "-0.025em"
  title:
    fontFamily: "Sentient, Georgia, serif"
    fontSize: "23px"
    fontWeight: 500
    lineHeight: 1.3
  section:
    fontFamily: "'Segoe UI', system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 600
    lineHeight: 1.5
  engine:
    fontFamily: "'Segoe UI', system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 600
    lineHeight: 1.5
  body:
    fontFamily: "'Segoe UI', system-ui, sans-serif"
  label:
    fontFamily: "'Segoe UI', system-ui, sans-serif"
    fontSize: "12px"
  action:
    fontFamily: "'Segoe UI', system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 700
rounded:
  board: "3px"
  field: "4px"
  control: "5px"
  notice: "6px"
  panel: "8px"
  dialog: "10px"
spacing:
  control-inline: "12px"
  panel-block: "20px"
  panel-inline: "22px"
  dialog: "24px"
  workspace-gap: "36px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.ink}"
    typography: "{typography.action}"
    rounded: "{rounded.control}"
    padding: "0 17px"
  button-primary-hover:
    backgroundColor: "color-mix(in srgb, {colors.accent} 86%, #fff)"
    textColor: "{colors.ink}"
  button-plain:
    backgroundColor: "transparent"
    textColor: "{colors.text}"
    rounded: "{rounded.control}"
    padding: "0 12px"
  button-plain-hover:
    backgroundColor: "{colors.raised}"
  button-toggle-active:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.accent}"
    rounded: "{rounded.control}"
  analysis-time:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.text}"
    typography: "{typography.label}"
    rounded: "{rounded.field}"
    padding: "0 8px"
  analysis-panel:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.panel}"
  board-light:
    backgroundColor: "{colors.light}"
    textColor: "{colors.ink}"
  board-dark:
    backgroundColor: "{colors.dark}"
    textColor: "{colors.ink}"
  board-toolbar:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.control}"
    padding: "3px"
  move-current:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "0 8px"
  dialog:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.dialog}"
    padding: "{spacing.dialog}"
---

# Design System: CHESS

## Overview

**Creative North Star: "Focused tournament workspace"**

A large, crisp chessboard is the visual center of the application. The workspace plays and teaches at once: both sides stay movable, Stockfish can take either seat, and a four-tab panel beside the board coaches, analyses, records and reviews. The identity remains quiet and precise.

The shipped surface is a six-theme token system whose default is **Classic walnut**: warm parchment squares on dark umber surfaces. Five more themes cover the same roles. Sentient Medium gives the brand and a few headings character; compact system text keeps numbers, controls and states practical. Depth stays reserved for native dialogs and transient notices.

**Key Characteristics:**

- A large board with real SVG chess pieces, a badge marking each played move.
- One token system, six themes, default Classic walnut; overlays are contrast-pinned per theme.
- A four-tab analysis workspace: Coach, Analysis, Moves, Review.
- A coach that grades and explains every move, with a deep whole-game review and retries.
- The brilliant gallery, the game-setup dialog and a header power control for the engine budget.
- Pointer, touch and keyboard interaction with visible state.

## Colors

The normative palette above is the default theme, Classic walnut, taken from `public/themes.js`. Theme tokens become stylesheet custom properties (`--bg`, `--surface`, `--raised`, `--text`, `--muted`, `--light`, `--dark`, `--accent`, `--ink`, `--danger`, `--selected`, `--arrow-move`, `--arrow-threat`, `--target`, `--coord-light`, `--coord-dark`); the `:root` defaults equal Classic walnut so the no-JS first paint already matches, and the static `theme-color` meta in `index.html` carries the same Classic background. `applyTheme` rewrites the tokens on the document root, flips `color-scheme`, updates the `theme-color` meta to the theme background, and remembers the choice in `localStorage`.

### The six themes

- **Classic walnut** (default): parchment and walnut squares on dark umber surfaces.
- **Tournament green**: the original forest direction.
- **Ocean blue**: slate-teal squares on deep blue surfaces.
- **Daylight**: the light-mode theme; `color-scheme` switches to light.
- **High contrast**: near-black surfaces, white text, grey squares.
- **Rosewood**: dusty rose squares on wine-dark surfaces.

### Primary

- **Accent** (`accent`): the primary action fill, active tab underline, turn indicator, engine status, focus ring and the evaluation line.
- **Ink** (`ink`): text on accent fills.
- **Neutral set**: `bg` (page), `surface` (panel, toolbar, dialogs), `raised` (hover fills, hint block, accuracy cards), `text`, `muted`, and the board squares `light` / `dark`.
- **Selected** (`selected`): the last-move wash and the selection/drag-over fill over squares.
- **Board overlays**: `arrow-move` and `arrow-threat` (engine suggestion and threat arrows) and `target` (legal-move dot, capture ring) are per-theme near-blacks.

### Status and pinned colors

- **Soft error text** (`danger`): engine and analysis errors, threat evaluations, form errors.
- **Move-quality badges** keep fixed disc colors across every theme: brilliant `#0d7a73`, great `#5c8bb0`, best `#4d7a22`, excellent `#5d8026`, good `#5c7d43`, book `#a88865`, inaccuracy `#f7c631` (dark glyph), mistake `#c26a12`, blunder `#fa412d`.
- **Brilliant teal** `#0d7a73` also fills the Brilliants count chip (white 11px bold text) and the saved-move strip tint.
- The evaluation bar and the review winning-chances graph keep their own black `#101410` / white `#ecece4` pair; check stays a `#be6959` circular mark.

**The Theme-Token Rule.** Every surface derives from the active theme's custom properties. Only the pinned set above — badge discs, the brilliant teal, the eval/graph pair, check, the toast error surface — is theme-independent, and each pinned pair is contrast-verified.

**The Overlay Contrast Rule.** Arrows, the legal-move dot and the capture ring must clear (3:1) against both square colours in every theme; badge glyphs keep (3:1) on their disc and the count chip (4.5:1). `test/ui-contrast.test.js` parses the shipped sources and fails any retuned hex below the floor.

**The Board-State Contrast Rule.** Square coordinates use the per-theme computed `coord-light` / `coord-dark` inks so they remain readable over both square colours under the selection layer.

## Typography

**Display Font:** Sentient Medium, self-hosted from `public/fonts/Sentient-Medium.woff2`, with Georgia and serif fallbacks.

**Body Font:** Segoe UI, system-ui, sans-serif. There is no separate mono family. Evaluation scores, analysis metadata, history position, accuracy and move notation use tabular numerals.

### Hierarchy

- **Display:** the brand wordmark, using `display`. It reduces to (30px) at the mobile breakpoint.
- **Headline:** the workspace heading ("Play & learn."), using `headline`, (25px) on mobile. Above (760px) it is visually hidden and kept for screen readers; its height goes to the board.
- **Title:** the opening name and the coach's move heading, using `title`.
- **Section:** panel and analysis headings use `section`; the engine heading uses `engine`.
- **Dialog and gallery headings:** Sentient Medium — dialogs (25px), gallery cards (19px), the empty move sheet (17px). Review accuracy figures are Sentient (32px) with tabular numerals.
- **Body and labels:** body family with compact working text, principally (12px) and (13px). No global body size is explicitly declared.
- **Board coordinates:** (11px), weight (700), line height (1).

Action weights are a real (700) step: the old (650) value synthesized to plain Bold wherever font synthesis is disabled (Segoe UI ships 400/600/700), so the odd number bought nothing.

**The Two-Voice Rule.** Sentient Medium carries the brand, workspace headline, opening name, coach heading, dialog and gallery headings, and the review accuracy figures; working labels, controls and notation stay in Segoe UI or the system sans-serif.

## Layout

The desktop workspace is a centered two-column grid: the board stage and an analysis panel of `minmax(310px, 360px)` separated by `workspace-gap`. Page and header width track the board: `main` is capped at the board sizing variable plus (464px) with (24px) gutters; the header pads itself to the same measure.

The board sizing variable is `min(58vw, 64vh, 650px)` by default and `min(max(350px, calc(100svh - 225px)), 1040px)` above (760px) — the height left after header, both player rows and the toolbar. The stage is at most the variable plus (20px). In short landscape viewports ((orientation: landscape) up to (500px) height) the stage is instead capped at `calc(100svh - 150px)` so the board fits the viewport height — the 650px mobile size and the 350px desktop floor both assumed a taller window — and the header takes its compact trims with the page heading moved to screen readers only. A (9px) evaluation bar and (11px) gap precede the square board. Player rows, toolbar, caption and help align to the board edge with a (20px) inset. The application header is at least (68px) tall and grows when its rows wrap.

The header carries the brand, the game-mode label, the Theme and Power selects, the Brilliants button with its count chip, and New game. Header and toolbar rows wrap rather than spilling: below roughly (585px) the header action cluster drops to its own right-aligned line, below roughly (505px) the history navigation drops under the board actions, and below roughly (360px) the four labeled board actions flow onto two lines — no fixed cutoff, just wrapping at each cluster's natural minimum. The board toolbar holds Flip, Undo, Arrows and Review on one side and first/previous/position/next/latest navigation on the other; the caption below carries status, the Let Stockfish play action and the numeric evaluation. A footer repeats the mode and keyboard hints.

The analysis panel opens with the engine summary (name, state, retry action) and then a four-tab strip: **Coach**, **Analysis**, **Moves**, **Review**. Tab panels use the recorded panel padding; the move sheet scrolls after (320px).

At widths up to (1050px), the analysis column becomes (320px), the column gap (24px), toolbar action labels hide, the Theme/Power labels hide, and panel horizontal padding becomes (18px).

At widths up to (760px), the board comes first and the analysis panel follows with a (26px) gap. The page is capped at (650px) with (20px) gutters, and the panel aligns to the board with a (20px) left inset. The board sizing variable becomes (650px), constrained by the stage. Selects, play buttons and move rows gain a minimum height of (44px), as do the review and coach controls that stay dense on pointer-precise screens: text actions, moment prev/next, the moment primary actions and the grade-count buttons. Graph markers stay (24px) — they pin to graded positions and the whole graph is the larger scrub target.

At widths up to (520px), the game-setup grid becomes one column and the Brilliants label text hides.

At widths up to (430px), page gutters become (12px), header gutters (16px), and the brand text and player descriptions disappear. The header wraps by itself at this width (wrapping is base behaviour, no longer switched on here); this block only trims labels and gutters. The toolbar becomes two full-width rows: board actions above history navigation, whose buttons are (44px) wide.

Spacing entries describe reused component roles, not a new global scale. The stylesheet remains the source for local spacing.

## Elevation & Depth

The page and analysis panel use tonal layering without box shadows. The board layers squares, piece images, analysis arrows and the move badge; those layers carry real chess state. A held piece follows the pointer above the board. Dialogs and transient notices use the shipped shadows.

### Shadow Vocabulary

- **Dialog:** `0 9px 25px rgb(0 0 0 / .35)`, above a dark native dialog backdrop.
- **Notice:** `0 3px 10px rgb(0 0 0 / .3)`, for the bottom-centered status toast.
- **Glyph and marker shadows:** badge glyphs and review-graph markers carry a (1px) drop shadow so they hold on any square.

**The Quiet Surface Rule.** The workspace and analysis containers use tone rather than shadows. Reserve the shipped low-offset shadows for dialogs, notices, badges and graph markers.

## Shapes

Small corner radii follow the component roles in the frontmatter. The board and evaluation bar have tight corners, controls are gently rounded, the analysis panel is broader, and native dialogs have the softest corners. Ordinary buttons and selects have no border.

The board stays square. Its square layer clips to the board corners while pieces, arrows and the move badge occupy separate layers. Selection and drag targets use an inset dark edge over the selected fill. Check is a circular mark beneath the king. Move-quality marks are disc badges beside or over notation, never contained text chips. The Brilliants count chip is a deliberate pill exception. Tab emphasis is a (2px) accent underline; retry verdicts use tinted status fills; graph markers are circles.

Bare SVG control glyphs use rounded line caps and joins. Chess-piece artwork stays in the supplied SVG assets.

## Components

### Header controls

The mode label opens game setup. Theme switches the six-theme token set live. Power picks the engine budget — Full, Balanced (default) or Laptop — a session setting synced back from the server on every poll; the analysis panel names the active engine and mode. Brilliants opens the gallery; its chip counts saved brilliant moves.

### Buttons

Primary actions (New game, Start game, coach play, retry actions) use accent fill and ink text; hover lightens the accent. Plain controls change surface tone without moving. The active Arrows toggle uses the raised fill and accent text. Text actions are (32px) accent underlines on pointer-precise screens. All controls inherit a minimum height of (44px); the board, move, review-table and moment controls may sit denser where a mouse or trackpad is assumed, and the (760px) block restores the (44px) touch height for all of them.

Ordinary button transitions change background and color over (160ms). Disabled controls have opacity (0.36). Focus uses a (3px) accent outline with a (3px) outward offset. Icon-only controls keep accessible labels and titles.

### Board

Pieces occupy their square and render at (87%) of its width and height. Pointer dragging begins after (5px) of movement; the held image is centered under the pointer, the origin remains selected and the hovered destination is marked. A click selects an eligible piece, then a destination. Only the side to move is selectable; Stockfish's side is locked against it. Legal destinations show the per-theme dot or capture ring; the last move washes its squares; each played move pins its quality badge over the destination square.

Arrow keys move keyboard focus within the board; Enter or Space selects a square, and Escape clears selection. Square focus uses an inset dark (3px) outline with a (-4px) offset. The board is a labeled grid with square descriptions; the skip link focuses it.

Legal piece movement glides over (170ms) using the stylesheet's easing curve. The evaluation fill changes over (500ms); arrow emphasis changes over (150ms); the badge settles over (220ms). Reduced motion removes these transitions and replaces the rotating engine spinner with a static dotted indicator. Text and controls are visible by default.

Flipping keeps pieces, coordinates, player names, arrows and evaluation orientation consistent.

### Tabs

The four tabs use the tablist pattern: one selected panel, roving tabindex, Arrow-key travel, accent underline on the selected tab. Panels swap within the analysis column; nothing else moves.

### Coach tab

The coach names the move under view with its badge, explains it, shows the expected continuation and the evidence line (depth, evaluation, loss). A saved brilliant offers the collection. "Find your next move" is a raised hint block: against Stockfish the hint stays hidden until asked for; a play action commits the engine's idea. "About move ratings" stays folded in a details guide. At the start of a browsed game the coach names what moving from here does: starting a new line discards the moves after the position.

### Analysis tab

The analysis time control is a native select. Meta chips carry the turn, the active engine and power mode, and depth with nodes-per-second. Continuation rows align rank, evaluation, principal variation and an explicit play button; the evaluation column gives its leading glyph (+, -, M) a fixed box about (0.96em) wide so digit places line up across rows, and the threat evaluations share the treatment; long text truncates visually and retains its full title. Threats are explicitly labeled as hypothetical opponent ideas. The evaluation graph uses rounded strokes and a current-position marker, with labels describing White's perspective. Suggestions require a user action to play.

### Moves tab

The move sheet aligns move numbers with parallel White and Black columns; empty half-move cells keep their slot; alternating rows use a tonal fill; the current move has its own filled state; badges stay beside notation. The sheet scrolls after (320px) and keeps the current move in view. An empty sheet states its invitation; a link downloads the game as PGN.

### Review tab

A review re-checks every move (deep review at depth 20) with a progress bar and time-left estimate while the game stays browsable. The finished review shows per-side accuracy cards in Sentient numerals, a clickable winning-chances graph whose markers are the graded moves, a grade table whose counts step through the moves, and key moments with prev/next walking and an own-moves/both-sides scope. Your own errors offer **Retry** — the board returns to the position before the move with every engine answer hidden, an attempt is judged on a scratch position, and the game itself never changes — and **Show best** reveals the engine's line.

### Dialogs and notices

Promotion, game setup, the brilliant gallery, saved-game study and destructive branching use native modal dialogs. Game setup holds play mode, the side handed to Stockfish, the random top-5 option, rules (standard or Chess960 with a position seed), your pieces and a ten-step strength slider. The gallery shows saved brilliant cards with Study, PGN and Image actions plus the archive folder. Branching or taking back while browsing asks first and names the discarded moves; there is no variation tree and no redo. Promotion shows actual piece images and names; keyboard focus starts on the first choice.

The toast is centered (24px) above the viewport bottom, constrained to the viewport width minus (32px), and announces status politely. Error notices use their own pale error surface and linger longer.

## Do's and Don'ts

### Do:

- **Do** keep the crisp board as the focal artifact and the four-tab panel adjacent when width permits.
- **Do** derive every surface from the active theme's tokens, Classic walnut first.
- **Do** pin overlay, badge and chip contrast in every theme before shipping a color change.
- **Do** use the supplied SVG chess-piece assets and keep every orientation cue consistent.
- **Do** preserve visible focus and pointer, touch and keyboard operation.
- **Do** keep text and controls visible without waiting for motion.
- **Do** show loading, empty and recoverable error states within the working context.
- **Do** name the cost of a destructive branch in a dialog before the game changes.

### Don't:

- **Don't** hard-code a theme colour where a token exists.
- **Don't** add a theme without arrow, target and coordinate colors that clear the contrast floors.
- **Don't** substitute a decorative hero or fake product window for the working board.
- **Don't** introduce promotional claims, gradients or floating ornaments into this workspace.
- **Don't** turn every metadata label or classification into a pill.
- **Don't** add shadow or hover movement to ordinary controls.
- **Don't** play an engine suggestion without the user's explicit move action.
- **Don't** change the game from a retry or a review walkthrough; both work on scratch state.
