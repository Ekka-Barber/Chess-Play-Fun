# Brilliant UI design audit

Scope: the supplied pols.dev design law was reread point by point against the changed chess feedback, celebration, and continuation viewer. This is a focused product change, not a new marketing site. Existing unrelated surfaces were not redesigned to satisfy marketing-layout examples.

## Evidence and corrections

- Native Chromium inspection at 1440 × 1000, 390 × 844, and 320 × 740. The 320 px final screenshot includes the complete two-line heading, Close button, board, navigation, timeline, and explanation.
- Actual pointer actions covered acceptance/reply/comparison, all new navigation controls, timeline moves, Close, Replay, Appearance preview, all six themes, flip, history, and tabs. Native key events after a timeline click reached the previous position and End without changing the main game.
- Fixed grade text contrast by mixing each badge color with the active theme's text color. Automated checks cover nine grade colors across six themes on both panel surfaces, at least 4.5:1. Existing board cues retain their independently checked 3:1 minimum.
- Fixed the study board's last-move outline to use the real theme token. Fixed lost timeline focus and global history shortcuts while a dialog is open.
- Bounded the live piece's airborne travel by available board headroom. Its animation never depends on hiding the piece or game text. Decoration is noninteractive and hidden from assistive technology.
- Corrected the dialog width to use the available layout width, preserving 16 px gutters when a desktop scrollbar consumes part of a narrow viewport.
- Prevented hint requests during partial engine analysis. The final reload check exposed 16 premature 409 responses; a regression test now requires a completed report and deduplicates the successful hint request.
- Final fresh reload after that fix made one successful `hint?ply=9` request, with no console warnings/errors. Final dialog measurements preserved 16 px on both sides at 390 px (375 px layout width) and 320 px (305 px layout width), with no clipped heading, button, or paragraph and no horizontal overflow.
- New archive validation preserves the study lines that previously vanished on restore. Legacy entries get a real review action instead of an empty study affordance.
- The reference's saturated teal is reserved for a requested transient success effect. Persistent text and controls use the existing tonal theme. A functional chess grade is the reason for its color.
- No new UI or animation dependency. Reused native buttons, the existing dialog, piece assets, theme tokens, and Web Animations API. No Tailwind/global-style installation or replacement component framework.

REA desktop evidence: `ev_0b656863271eae14760cc72238b452ba853a5b2b6bf8c58d6048c96a35bb59e8` (16 completed steps). 320 px reduced-motion evidence: `ev_a22cd9d5440dcfbbc0ed5cb94091146c834afc449673720b414461e290ee5766` (14 completed steps). Final 390 px comparison/themes/navigation evidence: `ev_10ef88439545e01ca924411a0604f9e79090cb99536b265e504efdd7f12f9a03` (25 completed steps). All three retained no console or page errors. Native browser runtime sampling separately verified the moving wave, since screenshot capture may settle finite animations.

One additional automation scenario targeted clipped native radio inputs and was cancelled. No matching owned headless Playwright browser remained afterward. The completed retry targeted their visible labels with bounded action timeouts. The failed attempt is not counted as passing evidence.

## Individual default-pattern checks

“Absent” below means no instance was introduced in the changed UI. “Reused” identifies an existing functional product element checked in context. It does not claim that every old screen has been redesigned.

| Supplied rule | Review result |
| --- | --- |
| Lucide React package | Absent; no icon package added. |
| Em dashes | New product copy uses sentences and punctuation without decorative em dashes. |
| Pill / eyebrow badge | No decorative eyebrow. Existing Brilliant grade is functional assessment evidence. |
| Fraunces and Work Sans | Absent; existing self-hosted Sentient and Segoe UI retained. |
| Glowy pill buttons | Absent; tonal, stationary native actions. |
| Oversized icon in a colored tile | Absent. |
| Floating cards | Absent; motion belongs to the confirmed chess move. |
| Cut-off glow | No glow added. |
| Kitchen-sink card | Absent. Study board has position, navigation, and factual explanation. |
| Fake macOS / app window mockup | Absent; board is populated by legally replayed moves. |
| Space Grotesk | Absent. |
| Purple and blue-to-purple gradients | Absent. |
| Gradient pill with icon and text | Absent. |
| Default CTA button pair | Absent; same-role study actions use the same tonal treatment. |
| Three-tier pricing block | Inapplicable; no pricing surface. |
| Testimonial / quote card and ornamental quotes | Absent. |
| Gradient-circle initials avatar | Absent. |
| Pre-footer CTA banner | Absent. |
| Gradient icon tile plus wordmark | Absent; existing chess wordmark retained. |
| Cormorant Garamond | Absent. |
| Split hero | No hero introduced; actual game remains the focal artifact. |
| Grid / graph-paper background | Absent; chess squares represent the real board. |
| Crude CSS/SVG illustrations | Absent; reused real chess pieces and populated game positions. |
| Accent-bar card | Absent. |
| Background glow | Absent. |
| Fake code-snippet window | Absent. |
| Sora and JetBrains Mono | Absent. |
| Floating tag pinned to an image | No decorative tag; grade marker identifies the played move. |
| Syne | Absent. |
| Gradient-filled headline text | Absent. |
| Archivo and Inter everywhere | Absent; no font change or new loading request. |
| Hairline light border on boxes | No new card outlines. Board's last-move stroke communicates position. |
| Countdown timer | Absent. |
| Card hover-lift | Absent. |
| Letterspaced serif wordmark | No wordmark change. |
| High-contrast Didone serifs | Absent. |
| Monospace as house voice | Absent; numerical position count uses tabular numerals only. |
| One label treatment everywhere | Title, evidence, move buttons, and explanation have separate roles and sizes. |
| Botched glass | No glass or backdrop filter introduced. |
| Faint grid background, restated | No atmospheric grid; board squares are game data. |
| Botched fill animations | No fill-bar animation; wave fades each square with bounded timing. |
| Invisible-content entrance trap | Live text, buttons, board pieces, and grade are visible without animation. Only disposable decoration starts transparent. |
| Content sliced by an edge / clear the cut | Dialog scrolls within the viewport; top-edge lift is bounded; 320 px visual inspection found no clipped live text/control. |
| Misaligned parallel columns | No comparison card grid. Navigation shares one grid; move timeline wraps deliberately. |
| Text jammed against the edge | Dialog has 22 px padding, screen has a 16 px minimum dialog gutter, controls have internal padding. |
| Default all-around shadow | No new shadow recipe; reused existing directional house dialog elevation. |
| Content flung to far edges | Heading and Close share one row with deliberate spacing; actions wrap together. |
| Missing or faked logos and icons | Existing real chess assets; no customer claims or decorative logo wall. |
| Chronic centering miss | Board cells use grid centering; piece aspect ratios retained; position count centered; native button text centered in actual screenshots. |
| Faking a shadow with a second box | Absent. |
| Icon or logo with a box behind it | No new icon tiles. Existing semantic grade marker is retained as requested chess feedback. |
| Little rule beside an eyebrow | Absent. |
| Oversized footer wordmark as slop | No footer change or new wordmark. |
| Colliding colors / hard color seams | Existing six palettes retained; new persistent surfaces use theme tokens. Teal wave ends by fading on the board. |
| Hard-edged box behind a shadow | No new shadow. |
| Text with no contrast | Grade-color test covers 108 combinations; actual themes were clicked. Muted evidence uses existing tested theme text. |
| Blurred copy of element as bloom | Absent. |
| Dot under active nav | Absent; existing tab indicator and typography retained. |
| Content clipped at overlapping sections | Study board is a real modal layer; no crossing live content at a section seam. |
| Cramped display type | No oversized display statistic; move count and SAN retain spacing. Heading wraps to two readable lines at 320 px. |
| Grain over content | No grain introduced. |
| Cool blue-charcoal default | Existing warm walnut default retained; themes remain user choices. |
| Pastel candy gradient | Absent. |
| Drifting gradient blobs | Absent. |
| Radial halo behind an object | Absent. Wave is a short, move-origin chessboard effect without blur. |
| Hero does not own first screen | No marketing hero; usable game board determines product layout. |
| Cream / beige editorial default | No new background palette; walnut squares are the existing chosen board theme. |
| Slop gray neutral | New controls reuse the active theme's raised surface. |
| Default Google fonts and repeated pairings | No new Google font or reused marketing pairing; existing locally served type retained. |
| Hover boop | Buttons do not translate or scale on hover. Celebration scales the semantic grade after confirmation, not a control on hover. |
| Inner-glow box and pulsing live dot | Absent. |
| Off-center strike-through | No strike-through added. |
| Default hero stack | No hero introduced. |
| Fixed background following scroll | No fixed decorative background. |
| Hard image seams | No photographic section or image/background join. |
| Saturated accent everywhere | Bright teal is confined to requested transient board feedback; action labels remain tonal and readable. |
| Underline-fill hover | No animated underline added. |
| Sun/moon toggle and redrawn generic line icons | No new theme toggle or icon set; existing explicit theme choices reused. |
| Unrounded decorative hairline | No decorative rule added. Board outline has a game-state purpose. |

## Every supplied layout check

| Supplied composition | Review result |
| --- | --- |
| Kicker plus serif H2 | No kicker added; title names the actual study action. |
| Big serif statement block | Absent. |
| Inset enquire island with form | Absent. |
| Email-pill plus button form | Absent. |
| Image card with overlay caption | Absent. |
| Flat fill under everything after hero | No landing-page sections introduced; current chess workspace preserved. |
| Recycling house style | No unrelated marketing sections copied. New board view follows existing game controls. |
| Hero stack with right panel | No hero introduced; existing board/analysis layout is functional workspace. |
| Multi-line headline / dangling accent word | New dialog headings have no accent word and fit in at most two lines at checked widths. |
| Filled plus outlined button pair | Absent in new controls. |
| Small label over big heading | No kicker; evidence follows the descriptive title. |
| Numbered steps on a vertical rail | Absent; actual SAN timeline. |
| Stacking slop layouts | No stack of marketing sections. |
| Whole SaaS page template | No marketing-page skeleton introduced. |
| Metadata as tinted pills everywhere | Engine/depth evidence is plain text; SAN choices are working navigation buttons. |
| Dead controls / fake interactivity | Each new control was clicked. Start/Previous/Next correctly disable at boundaries; timeline, comparison, replay, and Close perform their named action. |

## Deeper checks and premium techniques

The “tasteful font swap,” “same skeleton recolored,” standard footer, zero-icons overcorrection, and checklist-only design traps were checked individually. None drove a change: existing product type, icons, layout, and footer were retained. The specific creative decision is a confirmed-move landing that triggers a board wave, alongside a real, legally populated counterfactual board. It belongs to chess feedback rather than decoration on a generic page.

Real translucency, self-colored borders, bespoke geometry, bare icons, terse copy, custom iconography, authored micro-interactions, considered light, premium noise, and the liquid-glass recipe were each considered. The requested task earns authored motion and concise study controls. It does not earn a new glass material, logo, texture, silhouette, or icon system. Adding those would conflict with the existing workspace and the law's own cohesion requirement.

Licensed/self-hosted type, full-page composition, earned logo walls, blueprint backgrounds, inset islands, crafted SVG objects, glass gloss, professional motion, textured micro-grids, grainy gradients, scroll-authored motion, and a large footer wordmark were also considered separately. Existing local type and real chess SVG pieces are appropriate. The new work requires no logo wall, marketing footer, scroll reveal, atmospheric grid, or visual environment behind a playable chessboard. Content stays visible by default.

The signature formula was checked across all eight parts: the live board is the focal artifact; existing chosen themes supply the environment; real piece/marker layers provide useful depth; both boards contain legal positions; existing display type remains consistent; no gratuitous silhouette is added; native modal navigation is deliberate; actual moves, engine names, and lines supply specificity. This is an enhancement to an existing product, so a new hero/nav/brand system would expand scope.

The kit's serif headline, two-tone accent, atmospheric hero, animated character field, gradient icon fill, bespoke CTA arrow, cohesive visual language, glass CTA, and real-component-library guidance were considered individually. Only cohesive visual language applies here. Existing accessible native controls and dialog are the house primitives; installing React/Tailwind or a new component library for this vanilla app would be an unnecessary global change. The prebuilt-component de-slop checks therefore introduce no extra dependency.

The field notes were checked separately: one palette/type world, authored rather than stock realism, deliberate self-hosted type, real product artifact, reference language without copying content, avoiding a default free-font rotation, and avoiding a dead-looking interface. Existing theme tokens and locally served assets keep cohesion. The authored move effect supplies the requested life. The reference's proprietary code, commentary, branding, and asset files are not in production.

## Limits

No live text or interactive control depends on a reveal animation. Reduced-motion preference suppresses only decoration and can cancel an effect in progress. Main-game state is unchanged by studying a continuation. Browser checks are Chromium emulation; physical touch hardware, other browser engines, and a full screen-reader session were not tested. These limits are not represented as passed checks.
