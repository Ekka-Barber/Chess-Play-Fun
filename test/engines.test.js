const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
// Requiring server.js constructs engine handles lazily (no process spawns) and loads the real engines.json.
const { pickEngines, sweepPlan } = require("../server");

test("engines.json registers the four engines with their probed capabilities", () => {
  const entries = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "engines.json"), "utf8"));
  assert.deepEqual(entries.map(({ id }) => id), ["stockfish", "obsidian", "plentychess", "lc0"]);
  // CI clones have no engine binaries (setup:engines is a Windows post-clone step): when ANY binary is
  // installed, ALL must be; a binary-less checkout is the documented fallback, not a broken registry.
  const installed = entries.some((entry) => fs.existsSync(path.join(__dirname, "..", entry.path)));
  for (const entry of entries) {
    assert.match(entry.id, /^[a-z0-9]+$/, `${entry.id}: stable id`);
    if (installed) assert.ok(fs.existsSync(path.join(__dirname, "..", entry.path)), `${entry.id}: executable missing at ${entry.path}`);
  }
  const byId = Object.fromEntries(entries.map((entry) => [entry.id, entry]));
  // Only Stockfish limits Elo. Obsidian lacks UCI_Chess960.
  assert.equal(byId.stockfish.elo, true);
  assert.equal(byId.obsidian.chess960, false);
  assert.equal(byId.plentychess.chess960, true);
  assert.equal(byId.lc0.chess960, true);
  assert.equal(byId.lc0.multipv, true);
  assert.equal(byId.lc0.elo, false);
});

test("the chosen engine is used wherever it is capable", () => {
  const stockfish = { id: "stockfish", name: "Stockfish 19", chess960: true, elo: true, multipv: true };
  const leela = { id: "lc0", name: "Leela Chess Zero", chess960: true, elo: false, multipv: true };
  const plain = pickEngines(stockfish, { mode: "engine", strength: 30, variant: "chess960" });
  assert.equal(plain.analysis.id, "stockfish");
  assert.equal(plain.playing.id, "stockfish");
  assert.equal(plain.notices.length, 0);
  const free = pickEngines(leela, { mode: "free", strength: 100, variant: "standard" });
  assert.equal(free.analysis.id, "lc0");
  assert.equal(free.playing.id, "lc0");
  assert.equal(free.notices.length, 0);
});

test("Stockfish fills capability gaps with a notice", () => {
  const leela = { id: "lc0", name: "Leela Chess Zero", chess960: true, elo: false, multipv: true };
  const obsidian = { id: "obsidian", name: "Obsidian 16.0", chess960: false, elo: false, multipv: true };
  const singleLine = { id: "single", name: "Single-line engine", chess960: true, elo: false, multipv: false };
  // Limited-strength play falls back to the calibrated engine; analysis stays on the choice.
  const limited = pickEngines(leela, { mode: "engine", strength: 50, variant: "standard" });
  assert.equal(limited.analysis.id, "lc0");
  assert.equal(limited.playing.id, "stockfish");
  assert.equal(limited.notices.length, 1);
  assert.match(limited.notices[0], /Elo calibration/);
  // Chess960 analysis falls back for an engine without UCI_Chess960.
  const nine60 = pickEngines(obsidian, { mode: "free", strength: 100, variant: "chess960" });
  assert.equal(nine60.analysis.id, "stockfish");
  assert.equal(nine60.playing.id, "stockfish");
  assert.match(nine60.notices[0], /Chess960/);
  // A single-line engine cannot feed grading, threats or variety, so analysis falls back entirely.
  const single = pickEngines(singleLine, { mode: "free", strength: 100, variant: "standard" });
  assert.equal(single.analysis.id, "stockfish");
  assert.equal(single.playing.id, "single");
  assert.match(single.notices[0], /one line/);
});

test("sweepPlan asks every engine in standard games and skips only Chess960-incapable engines in 960", () => {
  const stockfish = { id: "stockfish", name: "Stockfish 19", chess960: true, elo: true, multipv: true };
  const obsidian = { id: "obsidian", name: "Obsidian 16.0", chess960: false, elo: false, multipv: true };
  const singleLine = { id: "single", name: "Single-line engine", chess960: true, elo: false, multipv: false };
  const registry = [stockfish, obsidian, singleLine];
  const standard = sweepPlan(registry, false);
  assert.deepEqual(standard.map((entry) => entry.engineId), ["stockfish", "obsidian", "single"], "registry order is the colour slot");
  assert.ok(standard.every((entry) => entry.ask === true), "a standard game asks every engine — even single-line ones (first choice only)");
  const nine60 = sweepPlan(registry, true);
  assert.equal(nine60[1].skipped, "chess960");
  assert.equal(nine60[1].ask, undefined);
  assert.equal(nine60[0].ask, true);
  assert.equal(nine60[2].ask, true);
});
