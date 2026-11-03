// The five-engine coach view (/api/sweep): per-engine first choices for positions of the current game,
// sequential by construction (the governor's one interactive slot — pinned in governor.test.js), progressive
// through the analysis poll, and correctly parked by a hidden-tab pause, reset by restore/undo, and guarded
// by the same membership + revision rules as /api/analyze. The archive dir is redirected BEFORE the server
// loads so the restore fixture never touches the real Brilliant Moves folder.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
process.env.CHESS_ARCHIVE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "chess-sweep-test-"));
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { Chess } = require("chess.js");
const { app, engine, playingEngine, reviewEngine, coachEngines, archive } = require("../server");
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Deterministic UCI boundary for all engines (browser verification uses the real executables). Each coach
// answers with a different legal move so per-engine results are distinguishable on the wire.
engine.start = async () => {};
engine.go = async (fen) => {
  const moves = new Chess(fen).moves({ verbose: true });
  const move = moves[0];
  return { lines: move ? [{ score: { type: "cp", value: 25 }, pv: [move.from + move.to + (move.promotion || "")] }] : [], depth: 12, nps: 100000, best: move?.lan };
};
reviewEngine.start = engine.start;
reviewEngine.go = (...args) => engine.go(...args);
playingEngine.start = engine.start;
playingEngine.go = async (...args) => { await delay(120); return engine.go(...args); };
const coachCalls = [];
coachEngines.forEach((coach, i) => {
  coach.start = engine.start;
  coach.go = async (fen, multipv) => {
    coachCalls.push({ i, multipv });
    const moves = new Chess(fen).moves({ verbose: true });
    const move = moves[Math.min(i, moves.length - 1)];
    await delay(20);
    return { lines: move ? [{ score: { type: "cp", value: 25 - i }, pv: [move.from + move.to + (move.promotion || "")] }] : [], depth: 12, nps: 1, best: move?.lan };
  };
});

let server, origin;
before(async () => { server = app.listen(0, "127.0.0.1"); await new Promise((resolve) => server.once("listening", resolve)); origin = `http://127.0.0.1:${server.address().port}`; });
after(() => server.close());
async function post(pathName, body = {}, status = 200) {
  const response = await fetch(`${origin}/api/${pathName}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const result = await response.json();
  assert.equal(response.status, status, JSON.stringify(result));
  return result;
}
const state = () => fetch(`${origin}/api/state`).then((r) => r.json());
const sweepOf = () => fetch(`${origin}/api/analysis`).then((r) => r.json()).then((data) => data.sweep);
async function waitForSweep(phase, spins = 200) {
  let sweep;
  for (let i = 0; i < spins; i++) {
    sweep = await sweepOf();
    if (sweep && sweep.phase === phase) return sweep;
    await delay(20);
  }
  return sweep;
}

test("the sweep answers once per engine, multipv 1, only for positions of this game", async () => {
  coachCalls.length = 0;
  await post("new");
  const game = await state();
  await post("sweep", { fen: game.fens[0], atPly: 0, revision: game.revision });
  const sweep = await waitForSweep("ready");
  assert.equal(sweep.phase, "ready");
  assert.equal(sweep.results.length, coachEngines.length, "one result slot per registry engine");
  assert.equal(coachCalls.length, coachEngines.length, "one ask per registry engine");
  assert.ok(coachCalls.every((call) => call.multipv === 1), "first choice only: multipv 1, even for multi-line engines");
  assert.ok(sweep.results.every((r) => r.uci || r.error || r.skipped), "every engine answered, errored or was skipped");
  assert.ok(sweep.results.every((r) => !r.uci || /^[a-h][1-8][a-h][1-8]/.test(r.uci)), "results carry real UCI moves");
  // The same membership and revision rules as /api/analyze.
  await post("sweep", { fen: new Chess("8/8/8/4k3/8/8/8/4K3 w - - 0 1").fen(), atPly: 0 }, 400);
  await post("sweep", { fen: game.fens[0], atPly: 0, revision: game.revision - 1 }, 409);
  // A repeated sweep of the same ply is served from the per-ply cache: no new engine asks.
  const before = coachCalls.length;
  await post("sweep", { fen: game.fens[0], atPly: 0, revision: (await state()).revision });
  await delay(80);
  assert.equal(coachCalls.length, before, "the cached sweep answered without asking again");
});

test('cold coach handshakes overlap before searches enter the shared slot', async () => {
  await Promise.all(coachEngines.map(coach => coach.chain));
  const originals = coachEngines.map(coach => coach.start);
  let release, started = 0;
  const ready = new Promise(resolve => { release = resolve; });
  coachEngines.forEach(coach => { coach.start = async () => { started++; await ready; }; });
  try {
    const game = await post('new');
    coachCalls.length = 0;
    await post('sweep', { fen: game.fens[0], atPly: 0, revision: game.revision });
    await delay(20);
    assert.equal(started, coachEngines.length, 'each cold handshake starts without waiting for the prior search');
    assert.equal(coachCalls.length, 0, 'no search starts before its handshake finishes');
    release();
    assert.equal((await waitForSweep('ready')).phase, 'ready');
  } finally {
    release();
    await Promise.all(coachEngines.map(coach => coach.chain));
    coachEngines.forEach((coach, i) => { coach.start = originals[i]; });
  }
});

test("a terminal position sweeps without asking any engine", async () => {
  coachCalls.length = 0;
  await post("new");
  await post("move", { from: "f2", to: "f3" });
  await post("move", { from: "e7", to: "e5" });
  await post("move", { from: "g2", to: "g4" });
  const last = await post("move", { from: "d8", to: "h4" });
  assert.equal(last.over, true);
  const ply = last.moveLog.length;
  await post("sweep", { fen: last.fens[ply], atPly: ply, revision: last.revision });
  const sweep = await sweepOf();
  assert.equal(sweep.phase, "ready");
  assert.equal(sweep.terminal, true);
  assert.ok(sweep.results.every((r) => !r.uci), "no arrows on a finished game");
  assert.equal(coachCalls.length, 0, "the terminal report replaced every search");
});

test("stop cancels a running sweep; a hidden-tab pause parks it as paused and a fresh sweep resumes", async () => {
  const quick = coachEngines[0].go;
  coachEngines[0].go = async (...args) => { await delay(250); return quick(...args); };
  try {
    await post("new");
    const game = await state();
    await post("sweep", { fen: game.fens[0], atPly: 0, revision: game.revision });
    // Hide the tab mid-sweep: the sweep must park as paused (never a stuck 'running'), keeping partial results.
    await post("pause", { hidden: true, tab: "tab-a" });
    const parked = await sweepOf();
    assert.equal(parked.phase, "paused", "an interrupted sweep parks, so the poll can go idle");
    await post("pause", { hidden: false, tab: "tab-a" });
    // A new sweep of the same position re-runs cleanly (the interrupted one never wrote the cache).
    await post("sweep", { fen: game.fens[0], atPly: 0, revision: game.revision });
    const resumed = await waitForSweep("ready");
    assert.equal(resumed.phase, "ready");
    assert.ok(resumed.results.every((r) => r.uci || r.error || r.skipped));
    // {stop:true} returns the sweep to idle.
    await post("sweep", { stop: true });
    assert.equal((await sweepOf()).phase, "idle");
  } finally { coachEngines[0].go = quick; }
});

test("visible tabs keep analysis running while each hidden tab retains its own lease", async () => {
  await post("new");
  await post("pause", { hidden: true, tab: "tab-a" });
  await post("pause", { hidden: false, tab: "tab-b", hello: true });
  assert.equal((await state()).governor.paused, false, "visible tab-b needs analysis");
  await post("pause", { hidden: false, tab: "tab-a" });
  assert.equal((await state()).governor.paused, false);
  // A tab loaded in the background says hello hidden: it registers its own pause instead of assuming visibility.
  await post("pause", { hidden: true, tab: "tab-c", hello: true });
  assert.equal((await state()).governor.paused, false, 'a background hello cannot pause visible tabs');
  await post('pause', { hidden: false, tab: 'tab-a', bye: true });
  await post('pause', { hidden: false, tab: 'tab-b', bye: true });
  assert.equal((await state()).governor.paused, true, 'only hidden tab-c remains');
  await post("pause", { hidden: false, tab: "tab-c" });
  assert.equal((await state()).governor.paused, false);
});

test("restore re-aims engines for the restored variant and resets any in-flight sweep", async () => {
  const rules = require("../lib/rules");
  const startFen = rules.startFen("chess960", 42);
  const first = rules.legalMoves(startFen, "chess960")[0];
  const applied = rules.apply(startFen, rules.parseUciMove(startFen, first.from + first.to + (first.promotion || ""), "chess960"), "chess960");
  await archive.save({ gameId: randomUUID(), ply: 1, fen: applied.fen, beforeFen: startFen, move: applied.move,
    moves: [applied.move], startFen, variant: "chess960", seed: 42, theme: "classic", flipped: false,
    pgn: rules.pgn(startFen, [applied.move], "chess960"),
    annotation: { type: "brilliant", label: "Brilliant", explanation: "Synthetic fixture for the restore test.", whiteCp: 25, depth: 18, rule: "sweep-test-only" } });
  const entries = await archive.list();
  const fixture = entries.find((entry) => entry.variant === "chess960" && entry.seed === 42);
  assert.ok(fixture, "the chess960 fixture saved");

  const quick = coachEngines[0].go;
  coachEngines[0].go = async (...args) => { await delay(250); return quick(...args); };
  try {
    await post("new");
    const game = await state();
    await post("sweep", { fen: game.fens[0], atPly: 0, revision: game.revision }); // leave a sweep running
    const restored = await post("restore", { id: fixture.id, revision: (await state()).revision });
    assert.equal(restored.settings.variant, "chess960");
    assert.equal(restored.fens[0], startFen);
    assert.equal((await sweepOf()).phase, "idle", "restore reset the in-flight sweep instead of stranding it");
    assert.ok(Array.isArray(restored.engineNotices), "pickEngines re-aimed the engines for the restored game shape");
  } finally { coachEngines[0].go = quick; }
});
