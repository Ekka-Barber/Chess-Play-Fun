const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const rules = require('../lib/rules');
const { request } = require('node:http');
const { app, engine, playingEngine, reviewEngine, archive, timing, prettyLine, scoreText, mkLine } = require('../server');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let server, origin;
// Deterministic UCI boundary; browser verification uses the real executable.
engine.start = async () => {};
engine.go = async (fen) => {
  const move = rules.legalMoves(fen)[0];
  return { lines: move ? [{ score: { type: 'cp', value: 25 }, pv: [move.uci] }] : [], depth: 12, nps: 100000, best: move?.uci };
};
reviewEngine.start = engine.start;
reviewEngine.go = (...args) => engine.go(...args);
// A short think window lets tests observe the "Stockfish to move" state.
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
async function moves(sequence) { let result; for (const uci of sequence.split(' ')) result = await post('move', { from: uci.slice(0,2), to: uci.slice(2,4), ...(uci[4] ? { promotion: uci[4] } : {}) }); return result; }

test('next suggestions precede grading and previews stay out of the completed-result cache', { timeout: 10000 }, async () => {
  const original = engine.go, calls = [];
  let releaseInitial, releasePreview, previewReady, targetFen;
  const initialGate = new Promise(resolve => { releaseInitial = resolve; });
  const previewGate = new Promise(resolve => { releasePreview = resolve; });
  const previewStarted = new Promise(resolve => { previewReady = resolve; });
  engine.go = async (fen, multipv, ms, options = {}) => {
    calls.push({ fen, multipv });
    const raw = await original(fen);
    options.onUpdate?.(raw);
    if (calls.length === 1) await initialGate;
    else if (fen === targetFen) { previewReady(); await previewGate; }
    return raw;
  };
  try {
    await post('new', { mode: 'free', engineSide: null, variant: 'standard' });
    const game = await moves('a2a3');
    targetFen = game.fens[1]; releaseInitial();
    await previewStarted;
    assert.equal(calls[1]?.fen, game.fens[1], 'search the displayed position before the ungraded pre-position');
    const preview = await fetch(`${origin}/api/analysis`).then(r => r.json());
    assert.equal(preview.phase, 'thinking');
    assert.ok(preview.lines[0]?.san, 'preview PVs use the normal client line format');
    await fetch(`${origin}/api/hint?ply=1`).then(r => assert.equal(r.status, 409, 'partial results cannot judge a hint or retry'));
    releasePreview();
    await engine.chain;
    const completed = await fetch(`${origin}/api/analysis`).then(r => r.json());
    assert.equal(completed.phase, 'ready');
    assert.ok((await state()).annotations.every(a => a.type !== 'pending'), 'grading still completes');
  } finally { releaseInitial(); releasePreview(); engine.go = original; await engine.chain; }
});

test('switching engines searches again instead of relabelling another engine cache', async t => {
  const registry = await fetch(`${origin}/api/engines`).then(r => r.json());
  const alternative = registry.engines.find(e => e.id !== 'stockfish' && e.multipv);
  if (!alternative) return t.skip('No alternative engine installed');
  const original = engine.go, calls = [];
  engine.go = async (...args) => { calls.push(args); return original(...args); };
  try {
    await post('settings', { engineId: 'stockfish' });
    const game = await post('new', { mode: 'free', engineSide: null, variant: 'standard' });
    await engine.chain;
    calls.length = 0;
    await post('settings', { engineId: alternative.id });
    await engine.chain;
    assert.ok(calls.some(([fen, multipv]) => fen === game.fens[0] && multipv === 3), 'new engine must compute its own result');
  } finally { engine.go = original; await post('settings', { engineId: 'stockfish' }); await engine.chain; }
});

test('invalid branches preserve the complete game; valid branches truncate atomically', async () => {
  await post('new'); const original = await moves('e2e4 e7e5 g1f3');
  await post('move', { from:'a3', to:'a4', atPly:1 }, 400);
  await post('move', { from:'d7', to:'d5', atPly:1.5 }, 400);
  await post('move', { from:'d1', to:'e8', atPly:0 }, 400);
  assert.deepEqual((await state()).fens, original.fens);
  const branch = await post('move', { from:'d7', to:'d5', atPly:1 });
  assert.equal(branch.moveLog.length, 2); assert.equal(branch.moveLog[1].san,'d5');
});
test('stale revisions cannot overwrite the board', async () => {
  const original = await post('new'); await moves('e2e4');
  await post('move', { from:'d2', to:'d4', atPly:0, revision:original.revision, baseFen:original.fens[0] },409);
  assert.equal((await state()).moveLog.length,1);
});

test('restore cannot overwrite a move made while the archive is loading', async () => {
  const game = await post('new');
  const original = archive.get;
  let release, entered;
  const ready = new Promise(resolve => { entered = resolve; });
  const loading = new Promise(resolve => { release = resolve; });
  archive.get = async () => {
    entered(); await loading;
    return { startFen: game.fens[0], moves: [{ uci: 'e2e4' }], variant: 'standard', seed: 518, ply: 1, annotation: { type: 'brilliant' } };
  };
  try {
    const restoring = post('restore', { id: 'saved', revision: game.revision }, 409);
    await ready;
    const moved = await moves('a2a3');
    release(); await restoring;
    assert.deepEqual((await state()).fens, moved.fens);
  } finally { release(); archive.get = original; }
});

test('retry results are rejected when an undo changes the position during judging', async () => {
  await post('new', { mode: 'free', engineSide: null });
  await moves('a2a3 a7a6');
  await engine.chain;
  const judging = post('try', { ply: 0, from: 'b2', to: 'b3' }, 409);
  await delay(25);
  const undone = await post('undo');
  await judging;
  assert.deepEqual((await state()).fens, undone.fens);
});
test('castling and en passant preserve the complete legal position', async () => {
  await post('new'); let result = await moves('e2e4 e7e5 g1f3 b8c6 f1c4 g8f6 e1g1');
  assert.equal(result.fens.at(-1),'r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQ1RK1 b kq - 5 4'); assert.equal(result.moveLog.at(-1).san,'O-O');
  await post('new'); result = await moves('e2e4 a7a6 e4e5 d7d5 e5d6');
  assert.equal(result.fens.at(-1),'rnbqkbnr/1pp1pppp/p2P4/8/8/8/PPPP1PPP/RNBQKBNR b KQkq - 0 3');
});
test('legal underpromotion retains promotion in history and UCI', async () => {
  await post('new'); let result = await moves('a2a4 h7h5 a4a5 h5h4 a5a6 h4h3 a6b7 h3g2 b7a8n');
  assert.equal(result.moveLog.at(-1).uci,'b7a8n'); assert.equal(result.moveLog.at(-1).promotion,'n');
  assert.equal(result.fens.at(-1),'Nnbqkbnr/p1ppppp1/8/8/8/8/1PPPPPpP/RNBQKBNR b KQk - 0 5');
  const before = result.fens;
  await post('move',{from:'b2',to:'b8',promotion:'k'},400);
  assert.deepEqual((await state()).fens,before);
});
test('turn order, piece movement and check cannot be bypassed', async () => {
  await post('new'); await moves('e2e4');
  await post('move',{from:'g1',to:'f3'},400);
  assert.equal((await state()).moveLog.length,1);
  await moves('e7e5');await post('move',{from:'a1',to:'a5'},400);
  assert.equal((await state()).moveLog.length,2);
  await post('new');await moves('e2e4 d7d5 f1b5');
  await post('move',{from:'h7',to:'h6'},400);
  await moves('c7c6');assert.equal((await state()).moveLog.length,4);
});
test('threefold repetition and checkmate are reported from game history', async () => {
  await post('new'); let result = await moves('g1f3 g8f6 f3g1 f6g8 g1f3 g8f6 f3g1 f6g8');
  assert.equal(result.over,true); assert.match(result.result,/threefold/);
  await post('new'); result = await moves('f2f3 e7e5 g2g4 d8h4');
  assert.equal(result.over,true); assert.match(result.result,/Black wins/);
});
test('history navigation and settings reject invalid input', async () => {
  const original = await post('new');
  await post('analyze',{fen:'anything'},400);
  await post('analyze',{fen:'8/8/8/4k3/8/8/8/4K3 w - - 0 1'},400);
  await post('analyze',{fen:original.fens[0]});
  for (const atPly of [-1,Infinity,'0',100]) await post('undo',{atPly},400);
  await post('settings',{analysisMs:'900'},400); await post('settings',{analysisMs:900});
  assert.equal((await state()).analysisMs,900);
});
test('evaluation separates high material advantage from mate; black variations number correctly', () => {
  assert.equal(scoreText(1200),'+12.00');
  assert.equal(prettyLine('8/8/8/4k3/8/8/8/4K3 b - - 0 12',['Ke6','Ke2','Kd5','Kd3']),'12… Ke6 13. Ke2 Kd5 14. Kd3');
  const line = mkLine({ score:{type:'mate',value:3},pv:['e2e4'] },1,rules.startFen()); assert.equal(line.text,'M3');
});

test('live Analysis follows the position with opening plans, move ideas, and off-book feedback', async () => {
  await post('new', { mode: 'free', variant: 'standard' });
  const advance = await moves('e2e4 c7c6 d2d4 d7d5 e4e5');
  assert.match(advance.opening, /Caro-Kann.*Advance/);
  assert.match(advance.guide.plans.black, /Bf5.*c5/);
  assert.match(advance.guide.lastMove, /^e5/);
  const fen = advance.fens.at(-1);
  const position = await fetch(`${origin}/api/analysis`).then(response => response.json());
  assert.equal(position.fen, fen);
  assert.deepEqual(position.guide, advance.guide);
  const candidate = mkLine({ score: { type: 'cp', value: 15 }, pv: ['c8f5', 'g1f3'] }, 1, fen);
  assert.match(candidate.idea, /outside the pawn chain/);
  const flankMove = mkLine({ score: { type: 'cp', value: 12 }, pv: ['a7a6'] }, 2, fen);
  assert.equal(flankMove.idea, 'Controls b5 with the pawn.');

  const unlisted = await moves('c8f5 a2a3');
  assert.equal(unlisted.guide.plans, null);
  assert.equal(unlisted.guide.leftPlan, true);
  assert.match(unlisted.guide.lastMove, /^a3/);
  const exchange = 'rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2';
  const line = mkLine({ score: { type: 'cp', value: 10 }, pv: ['e4d5', 'd8d5'] }, 1, exchange);
  assert.match(line.idea, /Captures a pawn.*Qxd5 recaptures/);
  await engine.chain;
});

test('a different move order reaches the same named opening and coaching plans', async () => {
  await post('new', { mode: 'free', variant: 'standard' });
  const normal = await moves('d2d4 g8f6 c2c4 e7e6 b1c3 f8b4');
  await post('new', { mode: 'free', variant: 'standard' });
  const transposed = await moves('c2c4 g8f6 b1c3 e7e6 d2d4 f8b4');
  assert.equal(transposed.opening, 'Nimzo-Indian Defense');
  assert.deepEqual(transposed.guide.plans, normal.guide.plans);
  assert.match(transposed.guide.plans.white, /c3 knight is pinned/);
  await engine.chain;
});
test('engine mode replies for Stockfish and blocks the human on its turn', async () => {
  const waitFor = async (plies) => { let game; for (let i = 0; i < 100; i++) { game = await state(); if (game.moveLog.length >= plies) break; await delay(20); } return game; };
  await post('new', { mode:'engine', humanColor:'b', strength:30 });
  let game = await waitFor(1);
  assert.equal(game.moveLog.length,1); assert.equal(game.moveLog[0].engine,true); assert.equal(game.turn,'b');
  const reply = game.legalMoves[0];
  game = await post('move', { from:reply.from, to:reply.to });
  const early = await post('move', { from:game.legalMoves[0].from, to:game.legalMoves[0].to }, 400);
  assert.equal(early.code,'ILLEGAL_MOVE');
  game = await waitFor(3);
  assert.equal(game.moveLog.length,3); assert.equal(game.moveLog[2].engine,true);
  await post('new', { strength:55 }, 400);
  await post('new', { mode:'free', humanColor:'w', strength:50 });
});
test('free play commits full-strength replies without an artificial pause and preserves search budgets', async () => {
  const go = playingEngine.go, thinkTime = timing.thinkTime, skills = [], budgets = [];
  playingEngine.go = (...args) => { skills.push(args[3].skill); budgets.push(args[2]); return go(...args); };
  timing.thinkTime = () => 9000;
  try {
    await post('new', { mode:'free', engineSide:'b' });
    await post('move', { from:'e2', to:'e4' });
    assert.equal((await post('move', { from:'e7', to:'e5' }, 400)).code,'ILLEGAL_MOVE');
    let game; for (let i = 0; i < 60 && (game = await state()).moveLog.length < 2; i++) await delay(20);
    assert.equal(game.moveLog.length, 2, 'a finished search is committed without the old 9-second pause');
    assert.deepEqual(budgets, [3000], 'the full-strength search budget is unchanged');
    assert.equal(game.moveLog[1].engine,true); assert.deepEqual(skills,[20]);
    assert.equal((await post('new', { mode:'engine', engineSide:'b' })).settings.engineSide,null);
  } finally {
    playingEngine.go = go; timing.thinkTime = thinkTime;
    await post('new', { mode:'free', engineSide:null, humanColor:'w', strength:50 });
  }
});
test('free-play Stockfish: best move by default; Random top-5 picks randomly, plays forced mates, and turns full strength at -3', async () => {
  for (let i = 0; i < 300; i++) {
    const five = timing.pick(5), two = timing.pick(2);
    assert.ok(Number.isInteger(five) && five >= 0 && five <= 4); assert.ok(two >= 0 && two <= 1);
  }
  const go = playingEngine.go, pick = timing.pick, thinkTime = timing.thinkTime;
  const legal = (fen) => rules.legalMoves(fen).slice(0, 5).map((move) => move.uci);
  const cp = (value) => ({ type:'cp', value }), mate = (value) => ({ type:'mate', value }), calls = [];
  let scores;
  // Scores are from Stockfish's side, best first, as Stockfish reports them.
  playingEngine.go = async (fen, lines, ms) => {
    calls.push({ lines, ms });
    const moves = legal(fen);
    return { lines: moves.slice(0, lines).map((uci, i) => ({ score: scores[i] ?? scores.at(-1), pv:[uci] })), depth:12, nps:1, best:moves[0] };
  };
  timing.pick = (count) => Math.min(3, count - 1);
  timing.thinkTime = () => 0;
  const engineMove = async (n) => { let game; for (let i = 0; i < 100 && (game = await state()).moveLog.length < n; i++) await delay(20); return game; };
  const opening = (variety, lineScores) => { scores = lineScores; return post('new', { mode:'free', engineSide:'w', variety }).then(() => engineMove(1)); };
  const reply = async (n) => { const game = await state(); await post('move', { from:game.legalMoves[0].from, to:game.legalMoves[0].to }); return engineMove(n); };
  const start = legal(rules.startFen());
  const level = [cp(30), cp(25), cp(20), cp(15), cp(10)];
  try {
    let game = await opening(false, level);
    assert.equal(game.moveLog[0].uci,start[0], 'Random top-5 off: best move'); assert.equal(calls.at(-1).lines,1);
    game = await opening(true, level);
    assert.equal(game.moveLog[0].uci,start[3], 'calm: random top-5 pick'); assert.equal(calls.at(-1).lines,5); assert.equal(game.survival,false);
    game = await opening(true, [mate(2), cp(500)]);
    assert.equal(game.moveLog[0].uci,start[0], 'plays its own forced mate');
    game = await opening(true, [cp(-250), cp(-260), cp(-280), cp(-290), cp(-300)]);
    assert.equal(game.moveLog[0].uci,start[3], 'down 2.5 is not survival yet'); assert.equal(game.survival,false);
    game = await opening(true, [mate(-3), mate(-2)]);
    assert.equal(game.moveLog[0].uci,start[0], 'being mated: survival'); assert.equal(game.survival,true);
    // At -3 it plays its best move now, then thinks at full strength (one line, the whole pause) while still losing.
    game = await opening(true, [cp(-300), cp(-320), cp(-350), cp(-400), cp(-500)]);
    assert.equal(game.moveLog[0].uci,start[0]); assert.equal(game.survival,true);
    game = await reply(3);
    assert.equal(calls.at(-1).lines,1); assert.ok(calls.at(-1).ms >= 2000);
    assert.equal(game.moveLog[2].uci,legal(game.fens[2])[0]); assert.equal(game.survival,true);
    // Back above -1.5 it returns to the random top-5 pick.
    scores = [cp(0), cp(-10), cp(-20), cp(-30), cp(-40)];
    game = await reply(5);
    assert.equal(game.survival,false);
    game = await reply(7);
    assert.equal(calls.at(-1).lines,5); assert.equal(game.moveLog[6].uci,legal(game.fens[6])[3]);
  } finally {
    playingEngine.go = go; timing.pick = pick; timing.thinkTime = thinkTime;
    await post('new', { mode:'free', engineSide:null, variety:false });
  }
});
test('free play takeback removes one move, pauses Stockfish, and resumes on request or your next move', async () => {
  const original = timing.thinkTime;
  const plies = async (n) => { let game; for (let i = 0; i < 100 && (game = await state()).moveLog.length !== n; i++) await delay(20); return game; };
  timing.thinkTime = () => 0;
  try {
    await post('new', { mode:'free', engineSide:'w' });
    let game = await plies(1);
    assert.equal(game.moveLog[0].engine,true);
    game = await post('undo', { atPly:0 });
    assert.equal(game.moveLog.length,0); assert.equal(game.enginePaused,true);
    await delay(400);
    assert.equal((await state()).moveLog.length,0, 'Stockfish waits after its move is taken back');
    game = await post('move', { from:'d2', to:'d4' });
    assert.equal(game.moveLog[0].engine,false); assert.equal(game.enginePaused,false);
    await post('move', { from:'d7', to:'d5' });
    game = await plies(3);
    assert.equal(game.moveLog[2].engine,true);
    game = await post('undo', { atPly:2 });
    assert.equal(game.moveLog.length,2, 'exactly one move is taken back'); assert.equal(game.enginePaused,true);
    await post('engine-move', {});
    game = await plies(3);
    assert.equal(game.moveLog[2].engine,true); assert.equal(game.enginePaused,false);
  } finally {
    timing.thinkTime = original;
    await post('new', { mode:'free', engineSide:null });
  }
});
test('grading stays quick; only a sacrifice the quick search could not confirm is searched to depth 16', async () => {
  const go = engine.go, calls = [];
  // Level evaluations at depth 12 make 5.Nxe5 (offering the queen) a Brilliant candidate that is too shallow to confirm.
  engine.go = async (fen, multipv, ms, options) => {
    calls.push({ fen, depth: options?.depth });
    const result = await go(fen, multipv, ms, options);
    return { ...result, lines: result.lines.map((line) => ({ ...line, score: { type:'cp', value:0 } })) };
  };
  try {
    await post('new');
    const game = await moves('e2e4 e7e5 g1f3 d7d6 f1c4 c8g4 b1c3 g7g6 f3e5');
    let graded; for (let i = 0; i < 150 && (graded = await state()).annotations.some((a) => a.type === 'pending'); i++) await delay(20);
    const deep = (fen) => calls.some((call) => call.fen === fen && call.depth === 16);
    assert.ok(deep(game.fens[8]) && deep(game.fens[9]), 'the sacrifice was confirmed with a deeper search');
    assert.ok(game.fens.slice(0, 8).every((fen) => !deep(fen)), 'ordinary moves keep the quick search');
    assert.ok(graded.annotations.every((a) => a.type !== 'pending'));
  } finally { engine.go = go; }
});
test('deep review searches every position at depth 20 on its own engine and re-grades every move', async () => {
  const go = reviewEngine.go, calls = [];
  reviewEngine.go = (fen, multipv, ms, options) => { calls.push({ fen, depth: options?.depth }); return go(fen, multipv, ms, options); };
  try {
    await post('new'); await moves('e2e4 e7e5 a2a3 h7h6');
    assert.equal((await post('review', { deep:true })).deep.active,true);
    let game; for (let i = 0; i < 150 && (game = await state()).deep.active; i++) await delay(20);
    assert.equal(game.deep.active,false); assert.equal(game.deep.done,game.deep.total); assert.equal(game.deep.total,5);
    for (const fen of game.fens) assert.ok(calls.some((call) => call.fen === fen && call.depth === 20), fen);
    assert.ok(game.annotations.every((note) => note.type !== 'pending'));
    assert.equal(game.annotations[0].rule,'local-v2', 'opening theory is also assessed for a sound sacrifice');
    assert.equal(game.annotations[0].depth,12, 'report the achieved depth from the engine stub, not the requested target');
    assert.ok(game.evalHist.every(Number.isFinite));
  } finally { reviewEngine.go = go; }
});
test('game review grades every move and evaluates every position, and starts itself at game end', async () => {
  const settled = async () => { let game; for (let i = 0; i < 150; i++) { game = await state(); if (game.evalHist.filter(Number.isFinite).length === game.fens.length && !game.annotations.some((a) => a.type === 'pending')) break; await delay(20); } return game; };
  await post('new'); await moves('e2e4 e7e5 g1f3');
  assert.equal((await post('review')).reviewAll,true);
  let game = await settled();
  assert.equal(game.evalHist.length,4); assert.ok(game.evalHist.every(Number.isFinite));
  assert.ok(game.annotations.every((a) => a.type !== 'pending'));
  await post('new'); game = await moves('f2f3 e7e5 g2g4 d8h4');
  assert.equal(game.reviewAll,true);
  game = await settled();
  assert.equal(game.evalHist[4],-100000);
  assert.equal((await post('new')).reviewAll,false);
});
test('review retry judges an alternative move without changing the game', async () => {
  await post('new'); await moves('e2e4 e7e5 g1f3');
  await post('review');
  for (let i = 0; i < 150 && !(await fetch(`${origin}/api/hint?ply=1`)).ok; i++) await delay(20);
  const best = (await fetch(`${origin}/api/hint?ply=1`).then((r) => r.json())).continuation[0];
  const before = await state();
  const tried = await post('try', { ply:1, from:best.from, to:best.to });
  assert.equal(tried.success,true); assert.equal(tried.uci,best.uci); assert.equal(tried.bestUci,best.uci);
  assert.equal((await post('try', { ply:1, from:'e8', to:'e6' }, 400)).code,'ILLEGAL_MOVE');
  await post('try', { ply:3, from:'d7', to:'d5' }, 400);
  assert.deepEqual((await state()).fens,before.fens);
});
test('cross-origin mutation is refused', async () => {
  const response = await fetch(`${origin}/api/new`,{method:'POST',headers:{Origin:'https://untrusted.example'}});
  assert.equal(response.status,403);
  const rebinding = await new Promise((resolve,reject) => {
    request(`${origin}/api/state`,{headers:{Host:'untrusted.example'}},(response)=>{ response.resume();resolve(response.statusCode); }).on('error',reject).end();
  });
  assert.equal(rebinding,403);
});
