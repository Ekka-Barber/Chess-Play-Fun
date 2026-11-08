const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const rules = require('../lib/rules');

// Both engines are portable stubs; their declared paths must exist even in engineless CI.
const read = fs.readFileSync;
fs.readFileSync = function (file, ...args) {
  if (String(file) === path.resolve(__dirname, '../engines.json')) return JSON.stringify([
    { id: 'stockfish', name: 'Stockfish verifier', path: process.execPath, multipv: true, chess960: true, elo: true },
    { id: 'lc0', name: 'Leela test', path: process.execPath, multipv: true, chess960: true },
  ]);
  return read.call(this, file, ...args);
};
const { app, engine, playingEngine, reviewEngine, coachEngines, archive } = require('../server');
fs.readFileSync = read;
const calls = [];
let failVerifier = false, selectedDepth = 5;
for (const [index, source] of [engine, playingEngine, reviewEngine, ...coachEngines].entries()) {
  source.start = async () => {};
  source.go = async (fen, multipv, ms, options = {}) => {
    if (index === 3 && failVerifier) throw new Error('Verifier unavailable');
    calls.push({ source: index, fen, options });
    const moves = options.searchmoves ? options.searchmoves.map(uci => rules.parseUciMove(fen, uci)) : rules.legalMoves(fen).slice(0, multipv);
    return { depth: index === 0 ? selectedDepth : 16, nps: 100, best: moves[0]?.uci,
      lines: moves.map(move => ({ score: { type: 'cp', value: 0 }, pv: [move.uci || move.from + move.to] })) };
  };
}
archive.save = async () => ({ id: 'confirmation-test' });
let server, origin;
before(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});
after(() => { for (const source of [engine, playingEngine, reviewEngine, ...coachEngines]) source.quit(); server.close(); });
async function post(route, body = {}) {
  const response = await fetch(`${origin}/api/${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal(response.status, 200);
  return response.json();
}
async function playTrap() {
  await post('new', { mode: 'free', engineSide: null });
  for (const uci of 'e2e4 e7e5 g1f3 d7d6 f1c4 c8g4 b1c3 g7g6 f3e5'.split(' ')) {
    await post('move', { from: uci.slice(0, 2), to: uci.slice(2, 4) });
  }
}

test('a shallow selected engine gets separately attributed Stockfish sacrifice confirmation and an acceptance line', async () => {
  await post('settings', { engineId: 'lc0' });
  await playTrap();
  await engine.chain;
  const state = await fetch(`${origin}/api/state`).then(response => response.json());
  const note = state.annotations[8];
  assert.equal(state.settings.engineId, 'lc0', 'selected engine remains selected');
  assert.equal(note.type, 'brilliant');
  assert.equal(note.engine, 'Stockfish verifier');
  assert.equal(note.depth, 16);
  assert.ok(calls.some(call => call.source === 3 && call.options.depth === 16));
  assert.equal(note.sacrifice.continuation[0].uci, note.sacrifice.captureUci);
  assert.ok(note.sacrifice.continuation[0].explanation.includes('queen'));
  assert.equal(state.moveLog.length, 9, 'studying the acceptance line never plays it in the game');
});

test('an unavailable verifier leaves an explicit unconfirmed candidate instead of a stuck review', async () => {
  failVerifier = true;
  try {
    await playTrap(); await engine.chain;
    const state = await fetch(`${origin}/api/state`).then(response => response.json());
    assert.notEqual(state.annotations[8].type, 'pending');
    assert.notEqual(state.annotations[8].type, 'brilliant');
    assert.equal(state.annotations[8].needsDepth, 14);
    assert.ok(state.annotations[8].verificationError);
  } finally { failVerifier = false; }
});

test('Leela depth above fourteen still needs independent alpha-beta confirmation', async () => {
  selectedDepth = 18; failVerifier = true;
  try {
    await playTrap(); await engine.chain;
    const state = await fetch(`${origin}/api/state`).then(response => response.json());
    assert.notEqual(state.annotations[8].type, 'brilliant');
    assert.equal(state.annotations[8].needsDepth, 14);
    assert.ok(state.annotations[8].verificationError);
    assert.equal(state.annotations[8].engine, 'Leela test');
    assert.equal(state.annotations[8].depth, 18, 'retain the actual MCTS depth as evidence');
  } finally { selectedDepth = 5; failVerifier = false; }
});

test('a confirmation finishing after a new game cannot write into the new game', async () => {
  const verifier = coachEngines[0], go = verifier.go;
  let release, begun;
  const gate = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { begun = resolve; });
  verifier.go = async (...args) => { begun(); await gate; return go(...args); };
  try {
    await playTrap(); await started;
    const fresh = await post('new'); release(); await engine.chain;
    const state = await fetch(`${origin}/api/state`).then(response => response.json());
    assert.equal(state.id, fresh.id);
    assert.equal(state.moveLog.length, 0);
    assert.deepEqual(state.annotations, []);
  } finally { release(); verifier.go = go; }
});
