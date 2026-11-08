const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const rules = require('../lib/rules');
const { Engine, SEARCH_CANCELLED } = require('../lib/engine');
const { createGovernor } = require('../lib/governor');
const { app, engine, playingEngine, reviewEngine } = require('../server');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let server, origin;
// Deterministic UCI boundary, exactly as server.test.js stubs it: start() is the only spawn site, so the real
// 103 MB binary can never launch from this suite.
engine.start = async () => {};
engine.go = async (fen) => {
  const move = rules.legalMoves(fen)[0];
  return { lines: move ? [{ score: { type: 'cp', value: 25 }, pv: [move.uci] }] : [], depth: 12, nps: 100000, best: move?.uci };
};
reviewEngine.start = engine.start;
reviewEngine.go = (...args) => engine.go(...args);
// The 150 ms think window lets tests observe Stockfish still replying while every tab is hidden.
playingEngine.start = engine.start;
playingEngine.go = async (...args) => { await delay(150); return engine.go(...args); };
before(async () => { server = app.listen(0, '127.0.0.1'); await new Promise((resolve) => server.once('listening', resolve)); origin = `http://127.0.0.1:${server.address().port}`; });
after(() => server.close());
async function post(path, body = {}, status = 200) {
  const response = await fetch(`${origin}/api/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const result = await response.json();
  assert.equal(response.status, status, JSON.stringify(result));
  return result;
}
const state = () => fetch(`${origin}/api/state`).then((r) => r.json());
const analysisOf = () => fetch(`${origin}/api/analysis`).then((r) => r.json());
async function moves(sequence) { let result; for (const uci of sequence.split(' ')) result = await post('move', { from: uci.slice(0,2), to: uci.slice(2,4), ...(uci[4] ? { promotion: uci[4] } : {}) }); return result; }
async function waitFor(check, attempts = 150) { let last; for (let i = 0; i < attempts; i++) { last = await check(); if (last) return last; await delay(20); } return last; }
const startFen = () => rules.startFen();

// Just enough UCI for the REAL Engine.go() to run end to end without a process: every write is recorded and each
// command is answered through the engine's own stdout→feed wiring (installed by the stubbed start below, mirroring
// the real one). goDelay simulates search time so a go can be observed in flight.
function uciProc({ goDelay = 0 } = {}) {
  const writes = [], feeds = [];
  const proc = {
    writes,
    stdin: { destroyed: false, write: (line) => { writes.push(line); answer(line); } },
    stdout: { on: (_, feed) => feeds.push(feed) },
    on: () => {},
    kill: () => {},
  };
  const emit = (line) => feeds.forEach((feed) => feed(line + '\n'));
  function answer(line) {
    const command = line.trim();
    if (command === 'uci') emit('uciok');
    else if (command === 'isready') emit('readyok');
    else if (command.startsWith('go ')) setTimeout(() => {
      emit('info depth 12 multipv 1 score cp 25 pv e2e4 e7e5');
      emit('bestmove e2e4');
    }, goDelay);
  }
  return proc;
}

test('UCI previews contain real PVs before bestmove and ignore info string diagnostics', async () => {
  const e = new Engine({ idleMs: 0 });
  const updates = [];
  let finished = false;
  e.start = async () => {};
  e.send = command => {
    if (!command.startsWith('go ')) return;
    e.feed('info string max 300 depth 200 timeset 1\n');
    e.feed('info depth 8 multipv 1 score cp 25 nodes 100 nps 2000 pv e2e4 e7e5\n');
    setTimeout(() => { finished = true; e.feed('bestmove e2e4\n'); }, 30);
  };
  const raw = await e.go(startFen(), 1, 300, { onUpdate: update => updates.push({ ...update, finished }) });
  assert.equal(raw.depth, 8, 'a debug string is not a searched depth');
  assert.ok(updates.some(update => !update.finished && update.lines?.[0]?.pv[0] === 'e2e4'), 'publish a legal PV during search');
});

test('governor budgets: full 3/2/3 below_normal deep, balanced 2/2/2 idle (today\'s hashes), laptop 1/1/1 idle', () => {
  const full = createGovernor({ mode: 'full' });
  assert.deepEqual(full.budgets, { analysis: 3, playing: 2, deep: 3 });
  assert.deepEqual(full.hashBudgets, { analysis: 256, playing: 256, deep: 512 });
  assert.equal(full.deepPriority, 'below_normal');
  const balanced = createGovernor(); // the default mode
  assert.equal(balanced.mode, 'balanced');
  assert.deepEqual(balanced.budgets, { analysis: 2, playing: 2, deep: 2 });
  assert.deepEqual(balanced.hashBudgets, { analysis: 128, playing: 128, deep: 256 }); // today's configured hashes
  assert.equal(balanced.deepPriority, 'idle');
  const laptop = createGovernor({ mode: 'laptop' });
  assert.deepEqual(laptop.budgets, { analysis: 1, playing: 1, deep: 1 });
  assert.deepEqual(laptop.hashBudgets, { analysis: 64, playing: 64, deep: 128 });
  assert.equal(laptop.deepPriority, 'idle');
});
test('setMode switches the whole table and rejects unknown modes', () => {
  const g = createGovernor();
  g.setMode('full');
  assert.deepEqual(g.budgets, { analysis: 3, playing: 2, deep: 3 });
  g.setMode('laptop');
  assert.deepEqual(g.budgets, { analysis: 1, playing: 1, deep: 1 });
  assert.throws(() => g.setMode('turbo'), /Unknown power mode/);
  assert.equal(g.mode, 'laptop', 'a rejected setMode leaves the mode unchanged');
  assert.throws(() => createGovernor({ mode: 'turbo' }), /Unknown power mode/);
});
test('the interactive slot is exclusive: a second acquire waits, release admits the next', async () => {
  const g = createGovernor();
  const first = await g.acquire('analysis');
  assert.equal(g.status().busy, true);
  let admitted = false;
  g.acquire('analysis').then((release) => { admitted = true; release(); });
  await delay(5);
  assert.equal(admitted, false, 'two acquirers never overlap');
  assert.equal(g.status().waiting, 1);
  first();
  await delay(5);
  assert.equal(admitted, true, 'release admits the queued acquirer');
  assert.deepEqual(g.status(), { mode: 'balanced', budgets: { analysis: 2, playing: 2, deep: 2 }, hashBudgets: { analysis: 128, playing: 128, deep: 256 }, busy: false, waiting: 0 });
});
test('a playing acquire jumps queued analyses and preempts the running analysis exactly once; analyses stay FIFO', async () => {
  const preempts = [];
  const g = createGovernor({ preempt: () => preempts.push(preempts.length) });
  const holder = await g.acquire('analysis');
  const order = [];
  const waiters = [g.acquire('analysis'), g.acquire('analysis')].map((p) => p.then((release) => (order.push('analysis'), release())));
  await delay(5);
  assert.equal(g.status().waiting, 2);
  const playingHolder = g.acquire('playing').then((release) => (order.push('playing'), release()));
  assert.equal(preempts.length, 1, 'the running analysis was asked to stop exactly once');
  assert.equal(g.status().waiting, 3, 'the reply queued ahead of both analyses');
  holder(); // release cascades: playing first, then the analyses in the order they queued
  await Promise.all([playingHolder, ...waiters]);
  assert.deepEqual(order, ['playing', 'analysis', 'analysis']);
  assert.equal(g.status().busy, false);
});
test('a playing search holding the slot is never preempted', async () => {
  const preempts = [];
  const g = createGovernor({ preempt: () => preempts.push(1) });
  const holder = await g.acquire('playing');
  const queued = g.acquire('playing').then((release) => release());
  await delay(5);
  assert.equal(preempts.length, 0);
  holder();
  await queued;
});
test('idle-quit fires on a drained chain and the next go respawns through start(), re-arming the timer', async () => {
  const e = new Engine({ idleMs: 25 });
  e.start = async () => { if (e.proc) return; const proc = uciProc(); e.proc = proc; e.buffer = ''; proc.stdout.on('data', (chunk) => e.feed(chunk)); };
  // Private state on purpose: a fake child process injected via engine.proc, driven through the public exec path.
  const injected = uciProc();
  e.proc = injected;
  await e.exec(async () => {});
  await delay(60);
  assert.deepEqual(injected.writes, ['quit\n'], 'the idle engine was quit');
  assert.equal(e.proc, null);
  // The next go must respawn: position is sent per go, so a fresh process answers normally and re-arms idle-quit.
  await e.exec(() => e.go(startFen(), 3, 100));
  const respawned = e.proc; // held across the delay: the re-armed idle-quit nulls e.proc when it fires
  assert.ok(respawned && respawned !== injected, 'a new process was spawned');
  assert.ok(respawned.writes.some((line) => line.startsWith('go movetime 100')), 'a real search ran on the respawn');
  await delay(60);
  assert.ok(respawned.writes.includes('quit\n'), 'idle-quit re-armed after the respawned search drained');
  assert.equal(e.proc, null);
});
test('an in-flight go cancels the armed idle-quit; nothing fires mid-search and the timer re-arms only after the drain', async () => {
  const e = new Engine({ idleMs: 25 });
  const proc = uciProc({ goDelay: 80 }); // the search stays in flight past the idle deadline
  e.start = async () => { if (e.proc) return; e.proc = proc; e.buffer = ''; proc.stdout.on('data', (chunk) => e.feed(chunk)); };
  await e.exec(async () => {}); // drained chain arms the timer
  await delay(5);
  const search = e.exec(() => e.go(startFen(), 3, 500)); // exec's clearIdle plus the go cancel it
  await delay(40); // past the original 25 ms deadline, the search is still running
  assert.equal(e.proc, proc, 'the engine was not quit mid-search');
  assert.ok(!proc.writes.includes('quit\n'));
  await search;
  await delay(60); // drained again → re-armed → fires
  assert.ok(proc.writes.includes('quit\n'));
  assert.equal(e.proc, null);
});
test('a drained chain with no process arms nothing', async () => {
  const e = new Engine({ idleMs: 25 });
  e.start = async () => {};
  await e.exec(async () => {});
  await delay(60);
  assert.equal(e.proc, null, 'no timer was armed and nothing spawned');
});
test('interrupt kills a go parked on the interactive slot: SEARCH_CANCELLED, the gate released, start never reached', async () => {
  const g = createGovernor();
  const holder = await g.acquire('analysis'); // the slot is busy, so go must park on the gate
  const e = new Engine({ gate: () => g.acquire('analysis') });
  e.start = async () => { throw new Error('a parked go must never reach start'); };
  const search = e.go(startFen(), 1, 100);
  await delay(5);
  assert.equal(g.status().waiting, 1, 'the go is parked on the slot');
  e.stop(); // the app's pattern: bump the ticket in the same turn, then interrupt
  holder(); // the preempted acquire is admitted…
  await assert.rejects(search, (error) => error.code === SEARCH_CANCELLED);
  await delay(5);
  assert.equal(g.status().busy, false, 'the cancelled go released the slot');
  assert.equal(g.status().waiting, 0);
});
test('interrupt kills a go inside the uci handshake via the post-start epoch check; nothing is sent to the process', async () => {
  const e = new Engine();
  e.start = async () => { await delay(30); }; // the handshake is still running at t=10
  const search = e.go(startFen(), 1, 100);
  await delay(10);
  e.interrupt();
  await assert.rejects(search, (error) => error.code === SEARCH_CANCELLED);
  assert.equal(e.active, 0);
});
test('powerMode is strictly validated, lands in settings and retunes the governor through the live settings path', async () => {
  await post('settings', { powerMode: 'turbo' }, 400);
  await post('settings', { powerMode: 'laptop' });
  let game = await state();
  assert.equal(game.settings.powerMode, 'laptop');
  assert.equal(game.governor.mode, 'laptop');
  assert.deepEqual(game.governor.budgets, { analysis: 1, playing: 1, deep: 1 });
  assert.deepEqual(game.governor.hashBudgets, { analysis: 64, playing: 64, deep: 128 });
  assert.equal(typeof game.governor.paused, 'boolean');
  await post('settings', { powerMode: 'balanced' }); // restore
  game = await state();
  assert.equal(game.governor.mode, 'balanced');
  assert.deepEqual(game.governor.budgets, { analysis: 2, playing: 2, deep: 2 });
});
test('engineId is validated against the registry; /api/engines lists the registered engines', async () => {
  const listed = await fetch(`${origin}/api/engines`).then((r) => r.json());
  assert.equal(listed.defaultId, 'stockfish');
  // Stockfish leads the registry. CI clones
  // have no binaries, so there the documented single-engine fallback lists exactly one: Stockfish itself.
  assert.ok([1, require("../engines.json").length].includes(listed.engines.length), `expected the full registry or Stockfish fallback, got ${listed.engines.length}`);
  assert.deepEqual(Object.keys(listed.engines[0]), ['id', 'name', 'chess960', 'elo', 'multipv']);
  assert.equal(listed.engines[0].id, 'stockfish');
  assert.equal(listed.engines[0].elo, true, 'only the calibrated engine leads the registry');
  await post('settings', { engineId: 'nope' }, 400);
  await post('settings', { engineId: 'stockfish' }); // the listed id is accepted (already selected: no retire churn)
  assert.equal((await state()).settings.engineId, 'stockfish');
});
test('a new game overrides body powerMode/engineId with the live session values', async () => {
  await post('settings', { powerMode: 'laptop' });
  // engineId 'nope' would 400 and powerMode 'full' would desync the header select if the body could win.
  const game = await post('new', { powerMode: 'full', engineId: 'nope' });
  assert.equal(game.settings.powerMode, 'laptop');
  assert.equal(game.settings.engineId, 'stockfish');
  assert.equal((await state()).governor.mode, 'laptop', 'the governor was not re-wired by /api/new');
  await post('settings', { powerMode: 'balanced' }); // restore
});
test('a powerMode change mid-search discards the cut-short result and re-searches the ply at full depth', async () => {
  const go = engine.go;
  let held = true, releaseHeld;
  const calls = [];
  engine.go = async (fen, ...rest) => {
    calls.push(fen);
    if (held) { held = false; await new Promise((resolve) => (releaseHeld = resolve)); return { lines: [], depth: 3, nps: 1, best: null }; } // cut short by the mode change
    return go(fen, ...rest); // full depth thereafter
  };
  try {
    const game = await post('new');
    await delay(10); // the live analysis search is now in flight
    await post('settings', { powerMode: 'laptop' }); // bump-then-stop in one synchronous handler
    releaseHeld?.();
    const report = await waitFor(async () => { const r = await analysisOf(); return r.phase === 'ready' && r.ply === 0 ? r : null; });
    assert.ok(report, 'analysis finished after the mode change');
    assert.equal(report.depth, 12, 'the shown result is the full-depth re-search, never the depth-3 cut-short one');
    assert.equal(calls.filter((fen) => fen === game.fens[0]).length, 2, 'the ply was searched again after the cut-short result was discarded');
  } finally {
    releaseHeld?.();
    engine.go = go;
    await post('settings', { powerMode: 'balanced' }); // restore
  }
});
test('pause follows the {hidden} contract: tab is optional, a present tab must be a non-empty string, and hidden/hello stay boolean', async () => {
  await post('pause', { hidden: 'yes', tab: 't' }, 400);
  await post('pause', { hidden: true }, 200); // the documented contract is a bare {hidden:boolean}
  assert.equal((await state()).governor.paused, true);
  await post('pause', { hidden: true, tab: '' }, 400);
  await post('pause', { hidden: false, tab: 't', hello: 'no' }, 400);
  // A visible tab resumes analysis without discarding another tab's hidden lease.
  assert.deepEqual(await post('pause', { hidden: false, tab: 't', hello: true }), { ok: true, paused: false });
  await post('pause', { hidden: false }); // the synthetic '(untabbed)' key the bare {hidden:true} used
  assert.deepEqual(await post('pause', { hidden: false, tab: 't', hello: true }), { ok: true, paused: false });
});
test('pausing mid-analysis freezes the panel at paused (never error) and un-hide resumes', async () => {
  const go = engine.go;
  let held = true, releaseHeld;
  engine.go = async (...args) => {
    if (held) { held = false; await new Promise((resolve) => (releaseHeld = resolve)); } // the search is in flight when the pause lands
    return go(...args);
  };
  try {
    await post('new');
    await post('pause', { hidden: true, tab: 'solo' });
    assert.equal((await analysisOf()).phase, 'paused');
    assert.equal((await state()).governor.paused, true);
    releaseHeld?.(); // the cut-short search resolves now; its result must be discarded silently
    await delay(100);
    assert.equal((await analysisOf()).phase, 'paused', 'the discarded search set no error phase and nothing re-scheduled while hidden');
    await post('pause', { hidden: false, tab: 'solo' });
    const report = await waitFor(async () => { const r = await analysisOf(); return r.phase === 'ready' && r.ply === 0 ? r : null; });
    assert.ok(report, 'analysis resumed at the tail after un-hide');
  } finally {
    releaseHeld?.();
    engine.go = go;
  }
});
test('two hidden tabs pause analysis while Stockfish replies; the first visible tab resumes at the live tail', async () => {
  await post('new', { mode: 'engine', humanColor: 'b', strength: 30 });
  let game; for (let i = 0; i < 100 && (game = await state()).moveLog.length < 1; i++) await delay(20);
  const reply = game.legalMoves[0];
  const playingInterrupt = playingEngine.interrupt.bind(playingEngine); let playingInterrupts = 0;
  playingEngine.interrupt = (...args) => { playingInterrupts++; return playingInterrupt(...args); };
  try {
    game = await post('move', { from: reply.from, to: reply.to }); // tail 2; Stockfish is thinking its 150 ms
    const hidePly = game.moveLog.length;
    await post('pause', { hidden: true, tab: 'a' });
    await post('pause', { hidden: true, tab: 'b' });
    assert.equal((await state()).governor.paused, true);
    assert.equal((await analysisOf()).phase, 'paused');
    for (let i = 0; i < 100 && (game = await state()).moveLog.length < 3; i++) await delay(20);
    assert.equal(game.moveLog.length, 3, 'the game reply was never paused');
    assert.equal(game.moveLog[2].engine, true);
    assert.equal(playingInterrupts, 0, 'pause never interrupted the playing engine');
    await post('pause', { hidden: false, tab: 'a' });
    assert.equal((await state()).governor.paused, false, 'one visible tab needs analysis even while another is hidden');
    assert.notEqual((await analysisOf()).phase, 'paused');
    await post('pause', { hidden: false, tab: 'b' });
    assert.equal((await state()).governor.paused, false);
    const report = await waitFor(async () => { const r = await analysisOf(); return r.phase === 'ready' && r.ply === 3 ? r : null; });
    assert.ok(report, 'analysis resumed after a tab became visible');
    assert.equal(report.ply, 3, `resumed at the live tail (3), not the hide-time ply (${hidePly})`);
  } finally {
    playingEngine.interrupt = playingInterrupt;
    await post('new', { mode: 'free', engineSide: null, humanColor: 'w' });
  }
});
test('any user action clears the pause set and analysis resumes', async () => {
  await post('new');
  await post('pause', { hidden: true, tab: 'ghost' });
  assert.equal((await state()).governor.paused, true);
  await moves('e2e4');
  assert.equal((await state()).governor.paused, false, 'the move cleared the pause');
  const report = await waitFor(async () => { const r = await analysisOf(); return r.phase === 'ready' && r.ply === 1 ? r : null; });
  assert.ok(report, 'analysis resumed at the new tail');
});
test('visibility leases survive another hello and stale leases expire through normal polls', async () => {
  const { prunePausedTabs, PAUSE_TTL } = require('../server');
  await post('new');
  await post('pause', { hidden: true, tab: 'crashed-without-pagehide' });
  assert.equal((await state()).governor.paused, true);
  await post('pause', { hidden: false, tab: 'fresh-page', hello: true });
  assert.equal((await state()).governor.paused, false, 'a visible page resumes analysis');
  await post('pause', { hidden: false, tab: 'fresh-page', bye: true });
  assert.equal((await state()).governor.paused, true, 'closing the visible page preserves the hidden page lease');
  prunePausedTabs(Date.now() + PAUSE_TTL + 1);
  assert.equal((await state()).governor.paused, false, 'the stale entry expired with the TTL');
  const report = await waitFor(async () => { const r = await analysisOf(); return r.phase === 'ready' && r.ply === 0 ? r : null; });
  assert.ok(report, 'normal polling resumed the tail after expiry without another visibility event');
});

test('a visible poll heals a missed visibility message without erasing hidden tabs', async () => {
  await post('new');
  await post('pause', { hidden: true, tab: 'hidden' });
  const visible = await fetch(`${origin}/api/analysis?tab=visible&visible=true`).then(r => r.json());
  assert.equal(visible.game.governor.paused, false);
  await post('pause', { hidden: false, tab: 'visible', bye: true });
  assert.equal((await state()).governor.paused, true, 'the hidden lease was retained');
  await post('pause', { hidden: false, tab: 'hidden' });
  await post('pause', { hidden: false, tab: 'hidden', bye: 'yes' }, 400);
});
