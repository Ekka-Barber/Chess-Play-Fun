const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
// Requiring server.js constructs engine handles lazily (no process spawns) and loads the real engines.json.
const { pickEngines } = require("../server");

test("engines.json registers five engines with truthful probed capabilities", () => {
  const entries = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "engines.json"), "utf8"));
  assert.equal(entries.length, 5);
  assert.equal(entries[0].id, "stockfish", "the calibrated engine leads the registry");
  for (const entry of entries) {
    assert.match(entry.id, /^[a-z0-9]+$/, `${entry.id}: stable id`);
    assert.ok(fs.existsSync(path.join(__dirname, "..", entry.path)), `${entry.id}: executable missing at ${entry.path}`);
  }
  const byId = Object.fromEntries(entries.map((entry) => [entry.id, entry]));
  // Probed against the shipped binaries (see server.js pickEngines): only Stockfish limits Elo; Obsidian has no
  // UCI_Chess960; viridithas answers a single line.
  assert.equal(byId.stockfish.elo, true);
  assert.equal(byId.berserk.chess960, true);
  assert.equal(byId.obsidian.chess960, false);
  assert.equal(byId.plentychess.chess960, true);
  assert.equal(byId.viridithas.multipv, false);
});

test("the chosen engine is used wherever it is capable", () => {
  const stockfish = { id: "stockfish", name: "Stockfish 19", chess960: true, elo: true, multipv: true };
  const berserk = { id: "berserk", name: "Berserk 14", chess960: true, elo: false, multipv: true };
  const plain = pickEngines(stockfish, { mode: "engine", strength: 30, variant: "chess960" });
  assert.equal(plain.analysis.id, "stockfish");
  assert.equal(plain.playing.id, "stockfish");
  assert.equal(plain.notices.length, 0);
  // Full-strength and free-play use of Berserk needs no calibration at all.
  const free = pickEngines(berserk, { mode: "free", strength: 100, variant: "standard" });
  assert.equal(free.analysis.id, "berserk");
  assert.equal(free.playing.id, "berserk");
  assert.equal(free.notices.length, 0);
});

test("Stockfish fills capability gaps with a notice", () => {
  const berserk = { id: "berserk", name: "Berserk 14", chess960: true, elo: false, multipv: true };
  const obsidian = { id: "obsidian", name: "Obsidian 16.0", chess960: false, elo: false, multipv: true };
  const viridithas = { id: "viridithas", name: "Viridithas 20.0.0", chess960: true, elo: false, multipv: false };
  // Limited-strength play falls back to the calibrated engine; analysis stays on the choice.
  const limited = pickEngines(berserk, { mode: "engine", strength: 50, variant: "standard" });
  assert.equal(limited.analysis.id, "berserk");
  assert.equal(limited.playing.id, "stockfish");
  assert.equal(limited.notices.length, 1);
  assert.match(limited.notices[0], /Elo calibration/);
  // Chess960 analysis falls back for an engine without UCI_Chess960.
  const nine60 = pickEngines(obsidian, { mode: "free", strength: 100, variant: "chess960" });
  assert.equal(nine60.analysis.id, "stockfish");
  assert.equal(nine60.playing.id, "obsidian");
  assert.match(nine60.notices[0], /Chess960/);
  // A single-line engine cannot feed grading, threats or variety, so analysis falls back entirely.
  const single = pickEngines(viridithas, { mode: "free", strength: 100, variant: "standard" });
  assert.equal(single.analysis.id, "stockfish");
  assert.equal(single.playing.id, "viridithas");
  assert.match(single.notices[0], /one line/);
});
