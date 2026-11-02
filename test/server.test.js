const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { Chess } = require('chess.js');
const { request } = require('node:http');
const { app, engine, playingEngine, reviewEngine, timing, prettyLine, scoreText, mkLine } = require('../server');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let server, origin;
// Deterministic UCI boundary; browser verification uses the real executable.
engine.start = async () => {};
engine.go = async (fen) => {
  const c = new Chess(fen), move = c.moves({ verbose: true })[0];
  return { lines: move ? [{ score: { type: 'cp', value: 25 }, pv: [move.from + move.to + (move.promotion || '')] }] : [], depth: 12, nps: 100000, best: move?.lan };
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
test('castling and en passant preserve the complete legal position', async () => {
  await post('new'); let result = await moves('e2e4 e7e5 g1f3 b8c6 f1c4 g8f6 e1g1');
  let c = new Chess(result.fens.at(-1)); assert.equal(c.get('g1').type,'k'); assert.equal(c.get('f1').type,'r'); assert.equal(result.moveLog.at(-1).san,'O-O');
  await post('new'); result = await moves('e2e4 a7a6 e4e5 d7d5 e5d6');
  c = new Chess(result.fens.at(-1)); assert.equal(c.get('d5'),undefined); assert.equal(c.get('d6').color,'w');
});
test('legal underpromotion retains promotion in history and UCI', async () => {
  await post('new'); let result = await moves('a2a4 h7h5 a4a5 h5h4 a5a6 h4h3 a6b7 h3g2 b7a8n');
  assert.equal(result.moveLog.at(-1).uci,'b7a8n'); assert.equal(result.moveLog.at(-1).promotion,'n');
  assert.equal(new Chess(result.fens.at(-1)).get('a8').type,'n');
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
  await post('analyze',{fen:new Chess('8/8/8/4k3/8/8/8/4K3 w - - 0 1').fen()},400);
  await post('analyze',{fen:original.fens[0]});
  for (const atPly of [-1,Infinity,'0',100]) await post('undo',{atPly},400);
  await post('settings',{analysisMs:'900'},400); await post('settings',{analysisMs:900});
  assert.equal((await state()).analysisMs,900);
});
test('evaluation separates high material advantage from mate; black variations number correctly', () => {
  assert.equal(scoreText(1200),'+12.00');
  assert.equal(prettyLine('8/8/8/4k3/8/8/8/4K3 b - - 0 12',['Ke6','Ke2','Kd5','Kd3']),'12… Ke6 13. Ke2 Kd5 14. Kd3');
  const line = mkLine({ score:{type:'mate',value:3},pv:['e2e4'] },1,new Chess().fen()); assert.equal(line.text,'M3');
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
test('free play can hand one side to full-strength Stockfish, which pauses before moving', async () => {
  const go = playingEngine.go, skills = [];
  playingEngine.go = (...args) => { skills.push(args[3].skill); return go(...args); };
  timing.replyDelay = () => 600;
  try {
    await post('new', { mode:'free', engineSide:'b' });
    await post('move', { from:'e2', to:'e4' });
    const movedAt = Date.now();
    assert.equal((await post('move', { from:'e7', to:'e5' }, 400)).code,'ILLEGAL_MOVE');
    let game; for (let i = 0; i < 150 && (game = await state()).moveLog.length < 2; i++) await delay(20);
    // The 600 ms pause starts just before the move response, so allow some request latency.
    assert.ok(Date.now() - movedAt >= 450, 'Stockfish paused before replying');
    assert.equal(game.moveLog[1].engine,true); assert.deepEqual(skills,[20]);
    assert.equal((await post('new', { mode:'engine', engineSide:'b' })).settings.engineSide,null);
  } finally {
    playingEngine.go = go;
    await post('new', { mode:'free', engineSide:null, humanColor:'w', strength:50 });
  }
});
test('free-play Stockfish: best move by default; Random top-5 picks randomly, plays forced mates, and turns full strength at -3', async () => {
  for (let i = 0; i < 300; i++) {
    const five = timing.pick(5), two = timing.pick(2);
    assert.ok(Number.isInteger(five) && five >= 0 && five <= 4); assert.ok(two >= 0 && two <= 1);
  }
  const go = playingEngine.go, pick = timing.pick, replyDelay = timing.replyDelay;
  const legal = (fen) => new Chess(fen).moves({ verbose:true }).slice(0, 5).map((m) => m.from + m.to + (m.promotion || ''));
  const cp = (value) => ({ type:'cp', value }), mate = (value) => ({ type:'mate', value }), calls = [];
  let scores;
  // Scores are from Stockfish's side, best first, as Stockfish reports them.
  playingEngine.go = async (fen, lines, ms) => {
    calls.push({ lines, ms });
    const moves = legal(fen);
    return { lines: moves.slice(0, lines).map((uci, i) => ({ score: scores[i] ?? scores.at(-1), pv:[uci] })), depth:12, nps:1, best:moves[0] };
  };
  timing.pick = (count) => Math.min(3, count - 1);
  timing.replyDelay = () => 0;
  const engineMove = async (n) => { let game; for (let i = 0; i < 100 && (game = await state()).moveLog.length < n; i++) await delay(20); return game; };
  const opening = (variety, lineScores) => { scores = lineScores; return post('new', { mode:'free', engineSide:'w', variety }).then(() => engineMove(1)); };
  const reply = async (n) => { const game = await state(); await post('move', { from:game.legalMoves[0].from, to:game.legalMoves[0].to }); return engineMove(n); };
  const start = legal(new Chess().fen());
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
    playingEngine.go = go; timing.pick = pick; timing.replyDelay = replyDelay;
    await post('new', { mode:'free', engineSide:null, variety:false });
  }
});
test('free play takeback removes one move, pauses Stockfish, and resumes on request or your next move', async () => {
  const original = timing.replyDelay;
  const plies = async (n) => { let game; for (let i = 0; i < 100 && (game = await state()).moveLog.length !== n; i++) await delay(20); return game; };
  timing.replyDelay = () => 0;
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
    timing.replyDelay = original;
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
