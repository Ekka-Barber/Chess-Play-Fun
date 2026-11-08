# Dependency audit

Branch: `improve/brilliant-review-dependencies`. Scope: v4 only. The feature branch is unmerged.

## Result

- Removed development dependency `chess.js@1.4.0`. Its only consumers were five test files; production already uses chessops.
- Reused the existing rules API for deterministic engine stubs and test setup. No replacement chess engine, SAN parser, compatibility wrapper, or runtime helper was written.
- Preserved the independent rule oracle as ten fixed SAN/FEN/legal-move fixtures captured from chess.js 1.4.0 before removal. Castling, en passant, and underpromotion integration checks now assert complete fixed FENs.
- Added a two-line test-only perft counter. Its fixed depth-2 totals (400 from the start position; 2,039 from Kiwipete) were independently checked with the bundled Stockfish 19 executable. The Kiwipete position is also in the [official Stockfish perft suite](https://github.com/official-stockfish/Stockfish/blob/master/tests/perft.sh).
- No other direct dependency is unused. Every installed transitive package is reachable from a retained direct dependency. No extraneous package was found.

## Measured installation

File-byte totals include node_modules metadata and npm launchers. They are not compressed download sizes or filesystem allocation sizes. Both totals are for this Windows x64 installation.

| Metric | Before | After clean npm ci | Reduction |
| --- | ---: | ---: | ---: |
| Installed file bytes | 8,548,054 | 7,823,893 | 724,161 (8.47%) |
| Files | 769 | 743 | 26 |
| Installed package paths | 73 | 72 | 1 |
| Lockfile package paths | 84 | 83 | 1 |

The chess.js package itself occupied 723,850 bytes in 26 files. The additional 311-byte reduction comes from npm installed-package metadata. No transitive package was removed with it.

## Kept dependencies

| Dependency | Why it remains |
| --- | --- |
| chessops 0.15.1 | Legal moves, check/mate/draw rules, standard chess and Chess960, SAN/FEN/PGN, and puzzle replay. A correct replacement is a chess rules engine, far beyond a small helper. |
| express 4.22.3 | Routing, bounded JSON parsing, error responses, static files, downloads, and HTTP behavior used throughout server.js. Replacing this stack would expand security and compatibility scope. |
| @resvg/resvg-js 2.6.2 | Produces the actual PNG board images stored by the Brilliant collection. Its platform binary performs SVG rasterization, fonts, and antialiasing; a few dozen JavaScript lines cannot preserve that behavior. |

No large dependency remains uncertain. The resvg Windows native module is the largest installed component (4,519,193 bytes) and directly supports an existing requested feature. Removing it would remove or change PNG exports.

## Work written by hand

| Item | Lines | Purpose |
| --- | ---: | --- |
| Runtime dependency replacement | 0 | Existing rules/chessops APIs cover every former chess.js call. |
| Perft counter in test/rules.test.js | 2 | Counts legal move-tree leaves against independent fixed totals. |
| test/fixtures/standard-line.json | 12 | Frozen data: 10 positions with SAN, FEN and exhaustive legal-move sets. |

## Validation

- Before uninstall: 137 tests passed and npm run build passed with the migrated callers and new fixtures while chess.js was still installed.
- After uninstall: 137 tests passed and npm run build passed.
- Final dependency verification, including the independently added real-game classifier fixtures: 140 tests passed and npm run build checked 32 JavaScript files and local page assets.
- Completion verification after the UI, archive, confidence, hint, and exact-reference regression changes: 158 tests pass with zero skips, and npm run build checks 36 JavaScript files and local page assets. No further dependency changed.
- A clean npm ci succeeded in .impeccable/dependency-clean-install with 0 reported vulnerabilities. That isolated directory holds the unchanged manifest and lockfile used for the clean size measurement.
- The working node_modules independently measures the same 7,823,893 bytes and 743 files. The ignored clean-install scratch copy remains as audit evidence: automatic approval review rejected its deletion without returning a specific reason. It is additional local artifact storage, outside the measured working install.
- npm ls --all reports no missing, invalid, or extraneous dependency problems. Dependency entries in the lockfile remove only chess.js; retained package versions did not change. npm also synchronized the lockfile's stale root Node requirement from >=18 to the manifest's pre-existing >=20.
- The first in-place npm ci could not unlink a native resvg module held by a running process (Windows EPERM). npm install restored the working tree, then 137 tests and the build passed again. No user-owned process was stopped. npm temporary residue was moved out of node_modules into .impeccable/native-lock-residue; its locked file can be removed after the owning app exits.

## Every installed package

The ledger below includes nested package copies, not only top-level directories. The remaining lockfile-only entries are 11 resvg binaries for other operating systems/CPU architectures, which npm excludes on this machine. Transitive libraries stay owned by their upstream dependency; none is imported as an additional application dependency.

| Installed path | Version | Own file bytes | Required by |
| --- | --- | ---: | --- |
| node_modules/@badrap/result | 0.3.1 | 75,604 | chessops@0.15.1 |
| node_modules/@resvg/resvg-js | 2.6.2 | 44,489 | v4 direct dependency |
| node_modules/@resvg/resvg-js-win32-x64-msvc | 2.6.2 | 4,519,193 | @resvg/resvg-js@2.6.2 |
| node_modules/accepts | 1.3.8 | 16,795 | express@4.22.3 |
| node_modules/array-flatten | 1.1.1 | 4,422 | express@4.22.3 |
| node_modules/body-parser | 1.20.9 | 61,584 | express@4.22.3 |
| node_modules/bytes | 3.1.2 | 12,270 | body-parser@1.20.9, raw-body@2.5.3 |
| node_modules/call-bind-apply-helpers | 1.0.2 | 15,952 | call-bound@1.0.4, dunder-proto@1.0.1, get-intrinsic@1.3.0 |
| node_modules/call-bound | 1.0.4 | 17,106 | side-channel-map@1.0.1, side-channel-weakmap@1.0.2 |
| node_modules/chessops | 0.15.1 | 795,990 | v4 direct dependency |
| node_modules/content-disposition | 0.5.4 | 19,113 | express@4.22.3 |
| node_modules/content-type | 1.0.5 | 10,471 | body-parser@1.20.9, express@4.22.3 |
| node_modules/cookie | 0.7.2 | 23,382 | express@4.22.3 |
| node_modules/cookie-signature | 1.0.7 | 4,083 | express@4.22.3 |
| node_modules/debug | 2.6.9 | 51,243 | body-parser@1.20.9, express@4.22.3, finalhandler@1.3.2, send@0.19.2 |
| node_modules/depd | 2.0.0 | 27,117 | body-parser@1.20.9, express@4.22.3, http-errors@2.0.1, send@0.19.2 |
| node_modules/destroy | 1.2.0 | 9,018 | body-parser@1.20.9, send@0.19.2 |
| node_modules/dunder-proto | 1.0.1 | 13,003 | get-proto@1.0.1 |
| node_modules/ee-first | 1.1.1 | 6,259 | on-finished@2.4.2 |
| node_modules/encodeurl | 2.0.0 | 6,980 | express@4.22.3, finalhandler@1.3.2, send@0.19.2, serve-static@1.16.3 |
| node_modules/es-define-property | 1.0.1 | 10,217 | get-intrinsic@1.3.0, qs@6.16.1 |
| node_modules/es-errors | 1.3.0 | 12,324 | call-bind-apply-helpers@1.0.2, dunder-proto@1.0.1, es-object-atoms@1.1.2, get-intrinsic@1.3.0, side-channel@1.1.1, side-channel-list@1.0.1, side-channel-map@1.0.1, side-channel-weakmap@1.0.2 |
| node_modules/es-object-atoms | 1.1.2 | 11,967 | get-intrinsic@1.3.0, get-proto@1.0.1 |
| node_modules/escape-html | 1.0.3 | 3,660 | express@4.22.3, finalhandler@1.3.2, send@0.19.2, serve-static@1.16.3 |
| node_modules/etag | 1.8.1 | 10,809 | express@4.22.3, send@0.19.2 |
| node_modules/express | 4.22.3 | 215,553 | v4 direct dependency |
| node_modules/finalhandler | 1.3.2 | 19,149 | express@4.22.3 |
| node_modules/forwarded | 0.2.0 | 5,876 | proxy-addr@2.0.8 |
| node_modules/fresh | 0.5.2 | 10,116 | express@4.22.3, send@0.19.2 |
| node_modules/function-bind | 1.1.2 | 31,427 | call-bind-apply-helpers@1.0.2, get-intrinsic@1.3.0, hasown@2.0.4 |
| node_modules/get-intrinsic | 1.3.0 | 46,542 | call-bound@1.0.4, side-channel-map@1.0.1, side-channel-weakmap@1.0.2 |
| node_modules/get-proto | 1.0.1 | 10,840 | get-intrinsic@1.3.0 |
| node_modules/gopd | 1.2.0 | 9,869 | dunder-proto@1.0.1, get-intrinsic@1.3.0 |
| node_modules/has-symbols | 1.1.0 | 23,409 | get-intrinsic@1.3.0 |
| node_modules/hasown | 2.0.4 | 10,332 | get-intrinsic@1.3.0 |
| node_modules/http-errors | 2.0.1 | 19,064 | body-parser@1.20.9, express@4.22.3, raw-body@2.5.3, send@0.19.2 |
| node_modules/iconv-lite | 0.4.24 | 335,941 | body-parser@1.20.9, raw-body@2.5.3 |
| node_modules/inherits | 2.0.4 | 3,958 | http-errors@2.0.1 |
| node_modules/ipaddr.js | 1.9.1 | 42,145 | proxy-addr@2.0.8 |
| node_modules/math-intrinsics | 1.1.0 | 17,323 | get-intrinsic@1.3.0 |
| node_modules/media-typer | 0.3.0 | 11,055 | type-is@1.6.18 |
| node_modules/merge-descriptors | 1.0.3 | 5,081 | express@4.22.3 |
| node_modules/methods | 1.1.2 | 5,288 | express@4.22.3 |
| node_modules/mime | 1.6.0 | 51,738 | send@0.19.2 |
| node_modules/mime-db | 1.52.0 | 205,539 | mime-types@2.1.35 |
| node_modules/mime-types | 2.1.35 | 18,272 | accepts@1.3.8, type-is@1.6.18 |
| node_modules/ms | 2.0.0 | 6,266 | debug@2.6.9 |
| node_modules/negotiator | 0.6.3 | 27,375 | accepts@1.3.8 |
| node_modules/object-inspect | 1.13.4 | 102,920 | side-channel@1.1.1, side-channel-list@1.0.1, side-channel-map@1.0.1, side-channel-weakmap@1.0.2 |
| node_modules/on-finished | 2.4.2 | 12,172 | body-parser@1.20.9, express@4.22.3, finalhandler@1.3.2, send@0.19.2 |
| node_modules/parseurl | 1.3.3 | 10,299 | express@4.22.3, finalhandler@1.3.2, serve-static@1.16.3 |
| node_modules/path-to-regexp | 0.1.13 | 6,644 | express@4.22.3 |
| node_modules/proxy-addr | 2.0.8 | 16,326 | express@4.22.3 |
| node_modules/qs | 6.16.1 | 418,793 | body-parser@1.20.9, express@4.22.3 |
| node_modules/range-parser | 1.2.1 | 8,457 | express@4.22.3, send@0.19.2 |
| node_modules/raw-body | 2.5.3 | 18,483 | body-parser@1.20.9 |
| node_modules/safe-buffer | 5.2.1 | 32,101 | content-disposition@0.5.4, express@4.22.3 |
| node_modules/safer-buffer | 2.1.2 | 42,299 | iconv-lite@0.4.24 |
| node_modules/send | 0.19.2 | 50,398 | express@4.22.3, serve-static@1.16.3 |
| node_modules/send/node_modules/ms | 2.1.3 | 6,721 | send@0.19.2 |
| node_modules/serve-static | 1.16.3 | 25,518 | express@4.22.3 |
| node_modules/setprototypeof | 1.2.0 | 4,025 | express@4.22.3, http-errors@2.0.1 |
| node_modules/side-channel | 1.1.1 | 22,864 | qs@6.16.1 |
| node_modules/side-channel-list | 1.0.1 | 16,973 | side-channel@1.1.1 |
| node_modules/side-channel-map | 1.0.1 | 13,348 | side-channel@1.1.1, side-channel-weakmap@1.0.2 |
| node_modules/side-channel-weakmap | 1.0.2 | 14,667 | side-channel@1.1.1 |
| node_modules/statuses | 2.0.2 | 12,505 | express@4.22.3, finalhandler@1.3.2, http-errors@2.0.1, send@0.19.2 |
| node_modules/toidentifier | 1.0.1 | 4,685 | http-errors@2.0.1 |
| node_modules/type-is | 1.6.18 | 18,497 | body-parser@1.20.9, express@4.22.3 |
| node_modules/unpipe | 1.0.0 | 4,311 | body-parser@1.20.9, finalhandler@1.3.2, raw-body@2.5.3 |
| node_modules/utils-merge | 1.0.1 | 3,720 | express@4.22.3 |
| node_modules/vary | 1.1.2 | 8,747 | express@4.22.3 |

The two ms versions remain pinned by their upstream consumers (debug and send). They are tiny transitive compatibility requirements; forcing an override would change upstream resolution for negligible savings.
