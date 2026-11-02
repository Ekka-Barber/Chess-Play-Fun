// Chess clock: the pure half lives in public/clock.js (themes.js's dual browser/node export), and
// this file drives it the way app.js does — tick for display, syncClock for every adopted server
// state. The flag's consequences (input lock, result notice) are wiring in app.js; a structural
// test below pins that wiring and the dialog/readout markup so it cannot silently disappear.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const clock = require("../public/clock.js");

// A game seen from the client: colors of moveLog entries plus the side to move at that ply.
const moves = (colors) => colors.map((color) => ({ color }));

test("a fresh clock starts counting the side to move and only that side", () => {
  const state = clock.newClock(5, 0);
  assert.equal(state.stamp, null);
  clock.syncClock(state, 0, [], "w", false, 1000);
  assert.equal(state.running, "w");
  assert.equal(state.ms.w, 300000);
  clock.tickClock(state, 2500);
  assert.equal(state.ms.w, 298500); // 1.5 s paid
  assert.equal(state.ms.b, 300000); // the idle side keeps its full time
});

test("a completed move banks a Fischer increment for its mover and switches the runner", () => {
  const state = clock.newClock(3, 2);
  clock.syncClock(state, 0, [], "w", false, 0);
  clock.tickClock(state, 4000); // White thinks 4 s
  clock.syncClock(state, 1, moves(["w"]), "b", false, 4000);
  assert.equal(state.ms.w, 180000 - 4000 + 2000); // paid 4 s, earned +2 s
  assert.equal(state.ms.b, 180000);
  assert.equal(state.running, "b");
  assert.deepEqual(state.snaps[1], { w: state.ms.w, b: state.ms.b });
  clock.tickClock(state, 9000);
  clock.syncClock(state, 2, moves(["w", "b"]), "w", false, 9000);
  assert.equal(state.ms.b, 180000 - 5000 + 2000); // Black paid the 5 s after its stamp, then +2 s
  assert.equal(state.running, "w");
});

test("plies that batch between two polls each earn their increment", () => {
  const state = clock.newClock(10, 3);
  clock.syncClock(state, 0, [], "w", false, 0);
  clock.syncClock(state, 2, moves(["w", "b"]), "w", false, 8000);
  assert.equal(state.ms.w, 600000 - 8000 + 3000); // the counted side pays the span once
  assert.equal(state.ms.b, 600000 + 3000); // the batched reply pays nothing, still earns +3 s
  assert.equal(state.ply, 2);
});

test("the side to move flags at zero, once, and the clock stops", () => {
  const state = clock.newClock(1, 0);
  clock.syncClock(state, 0, [], "w", false, 0);
  assert.equal(clock.tickClock(state, 59999), null); // 1 ms left, no flag yet
  assert.equal(state.ms.w, 1);
  assert.equal(clock.tickClock(state, 60001), "w");
  assert.equal(state.flagged, "w");
  assert.equal(state.running, null);
  assert.equal(state.ms.w, 0); // never negative, never refilled by later ticks
  assert.equal(clock.tickClock(state, 70000), null);
  assert.equal(state.ms.w, 0);
});

test("a takeback rewinds to the snapshot for that ply and clears the flag", () => {
  const state = clock.newClock(5, 2);
  clock.syncClock(state, 0, [], "w", false, 0);
  clock.tickClock(state, 1000);
  clock.syncClock(state, 1, moves(["w"]), "b", false, 1000);
  clock.tickClock(state, 2500);
  clock.syncClock(state, 2, moves(["w", "b"]), "w", false, 2500);
  const afterTwo = { ...state.ms };
  assert.equal(clock.tickClock(state, 1000000), "w"); // White runs out on move 2
  assert.equal(state.flagged, "w");
  clock.syncClock(state, 1, moves(["w"]), "b", false, 1250000); // take back to ply 1
  assert.equal(state.flagged, null);
  assert.deepEqual(state.ms, state.snaps[1]);
  assert.notDeepEqual(state.ms, afterTwo);
  assert.equal(state.running, "b"); // counting resumes for the side to move there
});

test("a ply that lands after the flag is banked frozen, so a rewind past it stays clean", () => {
  const state = clock.newClock(3, 2);
  clock.syncClock(state, 0, [], "w", false, 0);
  assert.equal(clock.tickClock(state, 300001), "w");
  clock.syncClock(state, 1, moves(["w"]), "b", false, 300100); // engine reply lands post-flag
  assert.equal(state.flagged, "w"); // the flag stands; the local game stays over
  assert.equal(state.ms.b, 180000); // and no increment is paid for it
  clock.syncClock(state, 0, moves([]), "w", false, 300200); // take back to the start
  assert.equal(state.flagged, null);
  assert.deepEqual(state.ms, { w: 180000, b: 180000 });
});

test("a server game end freezes the clock without a flag", () => {
  const state = clock.newClock(5, 0);
  clock.syncClock(state, 0, [], "w", false, 0);
  clock.tickClock(state, 3000);
  clock.syncClock(state, 1, moves(["w"]), "b", true, 3000); // mating move: over arrives with the ply
  assert.equal(state.running, null);
  assert.equal(state.flagged, null);
  assert.equal(clock.tickClock(state, 9000), null); // nothing counts after the game ended
  assert.equal(state.ms.b, 300000);
});

test("readouts round up to the last whole unit and switch to tenths at low time", () => {
  assert.equal(clock.formatClock(0), "0:00.0");
  assert.equal(clock.formatClock(1), "0:00.1");
  assert.equal(clock.formatClock(19501), "0:19.6");
  assert.equal(clock.formatClock(20000), "0:20.0"); // low boundary keeps tenths
  assert.equal(clock.formatClock(20001), "0:21"); // back to whole seconds, rounded up
  assert.equal(clock.formatClock(59999), "1:00");
  assert.equal(clock.formatClock(300000), "5:00");
  assert.equal(clock.formatClock(3599999), "1:00:00"); // custom hours ceiling
  assert.equal(clock.formatClock(3661000), "1:01:01");
  assert.equal(clock.isLow(20000), true);
  assert.equal(clock.isLow(20100), false);
});

test("the clock wiring stays pinned in the markup and app.js", () => {
  const app = fs.readFileSync(path.join(__dirname, "..", "public", "app.js"), "utf8");
  const html = fs.readFileSync(path.join(__dirname, "..", "public", "index.html"), "utf8");
  const css = fs.readFileSync(path.join(__dirname, "..", "public", "style.css"), "utf8");
  // Input lock + result notice, mirroring how game.over is handled in mover()/renderPanels().
  assert.match(app, /game\.over \|\| clockFlagged\(\)/, "mover() must treat a flag like game over");
  assert.match(app, /ran out of time/, "the flag notice must name the side that ran out of time");
  assert.match(app, /writeClock\(el, color\)/, "player rows must render the clock");
  // Labelled readouts in both rows, dialog controls, and the module actually loaded.
  assert.equal((html.match(/class="player-clock" role="timer" hidden/g) || []).length, 2);
  assert.match(html, /<script src="clock\.js"><\/script>/);
  assert.match(html, /id="gameClock"/);
  assert.match(html, /id="clockMinField"/);
  assert.match(html, /id="clockIncField"/);
  // Low time is more than colour: the tenths format change plus these classes/labels carry it.
  assert.match(css, /\.player-clock\.low/);
  assert.match(app, /time is low/);
});
