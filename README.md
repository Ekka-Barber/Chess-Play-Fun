# Chess Play & Fun

**A local chess workspace that respects your laptop.** Play against five world-class engines, have every move graded and explained by a built-in coach, review whole games with a winning-chances graph and retry-your-mistakes drills — while a resource governor guarantees the engines never pin your machine.

![Node](https://img.shields.io/badge/node-%E2%89%A518-339933) ![License](https://img.shields.io/badge/license-MIT-blue) ![Tests](https://img.shields.io/badge/tests-81%20passing-brightgreen) ![Engines](https://img.shields.io/badge/engines-5%20registered-8A2BE2) ![Platform](https://img.shields.io/badge/platform-Windows-lightgrey)

No account. No server but your own. No telemetry. Standard chess and Chess960, entirely in your browser against a local Node process.

---

## Why this exists

Most analysis boards assume a workstation. This one was designed on — and measured against — a thin dual-core-plus-eight-E-core laptop, so it **budgets chess work like a good citizen**:

- **One interactive search at a time.** The analysis engine and your opponent never search simultaneously, and a game reply always jumps the queue.
- **Thread budgets per power mode.** Chess strength on a 2P+8E chip stops scaling past ~3 threads; heat and UI stutter don't.
- **Every engine runs below normal OS priority**, so chess instantly yields to your browser and cursor — even mid-search.
- **Idle engines quit themselves** after five minutes and respawn on demand in ~200 ms.
- **Hide the tab for 30 seconds and live analysis pauses** (a game reply or a running deep review never does).
- **The deep review never blocks gameplay** — it runs outside the interactive slot at a lower priority.

| Power mode | Analysis | Playing | Deep review | Review priority |
|---|---|---|---|---|
| `full` | 3 threads | 2 | 3 | below normal |
| `balanced` *(default)* | 2 | 2 | 2 | idle |
| `laptop` | 1 | 1 | 1 | idle |

Switch modes live from the header; running engines retune without a restart.

## Quick start

```bash
git clone https://github.com/Ekka-Barber/Chess-Play-Fun.git
cd Chess-Play-Fun
npm install
npm run setup:engines   # fetches the engine binaries from their official releases (~240 MB, once)
npm start               # http://localhost:4655
```

The setup script is idempotent — re-run it any time to repair a missing binary. It downloads AVX2+BMI2 builds (any CPU from ~2013); the pinned sources are listed in [Credits](#credits--licenses).

## Five engines, used honestly

The registry (`engines.json`) ships five engines, and each one's **real capabilities were probed from the binary** — not copied from a README. Your selected engine is used wherever it qualifies; Stockfish fills any gap and the UI tells you when it does.

| Engine | Elo limit | Chess960 | MultiPV | Plays | Analyses |
|---|:-:|:-:|:-:|:-:|:-:|
| **Stockfish 19** *(default)* | 1320–2800 | ✅ | ✅ | ✅ | ✅ |
| **Berserk 14** | — | ✅ | ✅ | ✅ | ✅ |
| **Obsidian 16.0** | — | ❌ | ✅ | ✅ | standard only |
| **PlentyChess 8.0.0** | — | ✅ | ✅ | ✅ | ✅ |
| **Viridithas 20.0.0** | — | ✅ | — | ✅ | ❌ |

So: pick **PlentyChess** for a Fischer-Random game — it was trained on 15 billion positions including Chess960. Pick **Obsidian** for a second opinion with a completely different evaluation lineage (trained on Leela data). Play any of them at full strength; at 10–90% strength the Elo-calibrated Stockfish takes the seat, because none of the others ship a rating limiter.

## Play & learn

- **Free play** — move both colours yourself, or hand either side to an engine that answers after a human-like 1–10 s pause. Turn on **Random top-5** for variety, with a survival mode that snaps to full strength when the engine gets into trouble.
- **Play against the engine** — ten strength steps (10–100%), calibrated 1320–2800 Elo, unlimited at 100%.
- **Coach** — every move gets a badge and an explanation: Brilliant `!!`, Great `!`, Best `★`, Excellent/Good `✓`, Book, Inaccuracy `?!`, Mistake `?`, Blunder `??`. Grades come from a local expected-points model over engine evaluations (sources documented in the repo) — not a proprietary black box.
- **Game review** — lichess-formula accuracy per side, a clickable winning-chances graph, key moments, and **Retry**: the board rewinds to your error and you must find the better move, judged to within 5% winning chances. A full-depth review (depth 20) runs in the background without ever blocking the board.
- **Brilliant collection** — every brilliant move you play is saved automatically as a shareable 1024×1240 board image, plus PGN and metadata, in a gallery you can study or restore from.
- **Six board themes**, drag & drop, click-to-move, and full keyboard play (arrow keys, Enter/Space, F to flip). Accessibility was audited: labelled grid, roving tabindex, visible focus, reduced-motion respected, and contrast ratios enforced by a test that parses the source.

## Project layout

```
server.js            Express app: game state, engine scheduling, review pipeline
lib/governor.js      Power modes, thread budgets, the one-search interactive slot
lib/engine.js        UCI wrapper: lazy spawn, OS priority, idle quit, live retune
lib/rules.js         Legal moves, SAN, PGN via chessops (standard + Chess960)
lib/tutor.js         Move grading, explanations, hints, sacrifice detection
lib/archive.js       Brilliant-move collection (PNG via resvg, PGN, metadata)
public/              Vanilla-JS board UI: themes, panels, review, gallery
scripts/setup-engines.js  Fetches every engine binary from official releases
test/                81 deterministic Node tests (engine boundary stubbed)
engines.json         The engine registry and its probed capabilities
```

## Testing

```bash
npm test   # 81 tests: rules, Chess960 castling, grading, governor, engines, contrast
```

The suite covers chess rules (including en passant, underpromotion and Chess960 castling), stale-request safety, engine-mode turn handling, game review and retry judging, Brilliant detection, the governor's slot and idle-quit behaviour, the engine capability fallbacks — and a test that recomputes WCAG contrast ratios from the source files so a theme change can never quietly ship an invisible overlay.

## Roadmap

- [ ] Persistence — games, analyses and annotations to SQLite
- [ ] Lichess integration — import your own games for automatic review
- [ ] Maia opponents — human-like neural nets at 1100–1900 Elo
- [ ] Mistake book — your blunders as spaced-repetition puzzles
- [ ] Sequential multi-engine consensus analysis

## Credits & licenses

This project's code is [MIT](LICENSE). It stands on excellent open-source work:

**Engines** (fetched by the setup script, each under its own license — GPL-3.0 for Obsidian and PlentyChess, see their repos): [Stockfish](https://github.com/official-stockfish/Stockfish) · [Berserk](https://github.com/jhonnold/berserk) by Jamie Whiting · [Obsidian](https://github.com/gab8192/Obsidian) by Gabriel • · [PlentyChess](https://github.com/Yoshie2000/PlentyChess) by Yoshie2000 · [Viridithas](https://github.com/cosmobobak/viridithas) by Cosmo Bobak.

**Libraries & assets:** [chessops](https://github.com/niklasf/chessops) (move generation), [Express](https://expressjs.com/), the Cburnett piece set (see `public/pieces/LICENSE.txt`), the Sentient typeface under the SIL Open Font License, and the accuracy and winning-chances formulas published by [lichess.org](https://lichess.org).
