const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createPuzzles, STARTERS } = require('../lib/puzzles');
const rules = require('../lib/rules');

test('starter puzzles legally replay, teach checkmate, and automatically answer a combination', () => {
  const puzzles = createPuzzles();
  for (let i = 0; i < 3; i++) {
    const start = puzzles.starter(i), result = puzzles.move(start.id, [STARTERS[i].solution[0]]);
    assert.equal(result.solved, true); assert.equal(result.correct, true);
    assert.match(rules.status([result.fen]).result, /Checkmate/);
    assert.ok(!Object.hasOwn(start, 'solution'), 'the opening response must not reveal the answer');
  }
  const start = puzzles.starter(3), first = puzzles.move(start.id, ['g1h2']);
  assert.equal(first.solved, false); assert.equal(first.lastMove.uci, 'f6g4');
  assert.equal(first.fen.split(' ')[1], 'w', 'the opponent replies before input returns');
  const end = puzzles.move(start.id, ['g1h2', 'd1g4', 'g5d8']);
  assert.equal(end.solved, true); assert.equal(end.board.d8, 'B');
});

test('wrong moves retain the puzzle and cannot modify another attempt; illegal or fabricated prefixes fail', () => {
  const puzzles = createPuzzles(), start = puzzles.starter();
  const wrong = puzzles.move(start.id, ['e1e2']);
  assert.equal(wrong.correct, false); assert.equal(wrong.fen, start.fen); assert.deepEqual(wrong.moves, []);
  assert.throws(() => puzzles.move(start.id, ['e1f2']), { code: 'ILLEGAL_MOVE' });
  assert.throws(() => puzzles.move(start.id, ['e1e2', 'e1e8']), /attempt/);
  for (const input of [null, 'e1e8', [], [42], ['../x'], Array(17).fill('e1e8')]) assert.throws(() => puzzles.move(start.id, input));
  const solved = puzzles.move(start.id, ['e1e8']);
  assert.equal(solved.solved, true); assert.equal(puzzles.starter().fen, start.fen, 'a second tab starts independently');
  assert.throws(() => puzzles.starter(-1)); assert.throws(() => puzzles.starter(1.5)); assert.throws(() => puzzles.starter(Infinity));
});

test('hint points to a piece, reveal returns the legal line, and both validate the attempt identity', () => {
  const puzzles = createPuzzles(), start = puzzles.starter();
  assert.deepEqual(puzzles.hint(start.id, []), { square: 'e1', message: 'Look at the piece on e1.' });
  assert.deepEqual(puzzles.reveal(start.id, []), [{ uci: 'e1e8', san: 'Re8#' }]);
  assert.throws(() => puzzles.hint('unknown', []));
  assert.throws(() => puzzles.reveal(start.id, ['e1e2']));
  assert.throws(() => puzzles.hint(start.id, ['e1e8']), /already solved/);
});

const dailyFixture = { puzzle: { id: 'test1', fen: STARTERS[0].fen, solution: STARTERS[0].solution, rating: 900, themes: ['backRankMate'] } };
async function directory(t) {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'chess-puzzles-'));
  t.after(() => fs.rm(folder, { recursive: true, force: true }));
  return folder;
}
test('daily fetch is explicit, coalesced, validated, cached, and refreshed on the next day', async (t) => {
  const cacheDir = await directory(t); let calls = 0, clock = 86400000;
  const puzzles = createPuzzles({ cacheDir, now: () => clock, fetchImpl: async (url, options) => {
    calls++; assert.equal(url, 'https://lichess.org/api/puzzle/daily'); assert.ok(options.signal);
    return { ok: true, status: 200, json: async () => dailyFixture };
  } });
  assert.equal(calls, 0, 'initialization and starters never contact Lichess');
  const results = await Promise.all([puzzles.daily(), puzzles.daily()]);
  assert.equal(calls, 1); assert.deepEqual(results[0], results[1]);
  assert.equal((await puzzles.daily()).id, 'daily-test1'); assert.equal(calls, 1);
  clock += 86400000; await puzzles.daily(); assert.equal(calls, 2);
  assert.equal(puzzles.move('daily-test1', ['e1e8']).solved, true);
});

test('daily supports PGN-only API responses, rejects illegal solutions, and backs off after 429', async (t) => {
  const cacheDir = await directory(t); let clock = 0, calls = 0;
  const blocked = createPuzzles({ cacheDir, now: () => clock, fetchImpl: async () => {
    calls++; return { ok: false, status: 429, headers: { get: () => '120' } };
  } });
  await assert.rejects(blocked.daily(), { code: 'PUZZLE_RATE_LIMIT' });
  clock += 60000; await assert.rejects(blocked.daily(), { code: 'PUZZLE_RATE_LIMIT' }); assert.equal(calls, 1);
  clock += 60000; await assert.rejects(blocked.daily()); assert.equal(calls, 2);
  const pgn = createPuzzles({ cacheDir, fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ game: { pgn: 'f3 e5 g4' }, puzzle: { id: 'mate2', solution: ['d8h4'], themes: [] } }) }) });
  const start = await pgn.daily(); assert.equal(start.side, 'b');
  assert.equal(pgn.move(start.id, ['d8h4']).solved, true);
  const bad = createPuzzles({ cacheDir: path.join(cacheDir, 'bad'), fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ puzzle: { ...dailyFixture.puzzle, solution: ['a1a8'] } }) }) });
  await assert.rejects(bad.daily(), { code: 'PUZZLE_UNAVAILABLE' });
  const offline = createPuzzles({ cacheDir: path.join(cacheDir, 'offline'), fetchImpl: async () => { throw new Error('raw socket detail'); } });
  await assert.rejects(offline.daily(), (error) => error.code === 'PUZZLE_UNAVAILABLE' && !error.message.includes('socket'));
  assert.equal(offline.starter().id, 'back-rank');
});

let server, origin;
test('daily respects Retry-After HTTP dates without issuing requests during the cooldown', async (t) => {
  const cacheDir = await directory(t); let clock = Date.UTC(2026, 10, 3), calls = 0;
  const retryAt = new Date(clock + 120000).toUTCString();
  const puzzles = createPuzzles({ cacheDir, now: () => clock, fetchImpl: async () => {
    calls++; return { ok: false, status: 429, headers: { get: () => retryAt } };
  } });
  await assert.rejects(puzzles.daily(), { code: 'PUZZLE_RATE_LIMIT' });
  clock += 61000;
  await assert.rejects(puzzles.daily(), { code: 'PUZZLE_RATE_LIMIT' }); assert.equal(calls, 1);
  clock += 59000;
  await assert.rejects(puzzles.daily(), { code: 'PUZZLE_RATE_LIMIT' }); assert.equal(calls, 2);
});

test('daily rejects missing or malformed upstream puzzle identities before caching them', async (t) => {
  const cacheDir = await directory(t);
  for (const [i, id] of [undefined, null, 0, '', 'bad/id', 'x'.repeat(35)].entries()) {
    const puzzles = createPuzzles({ cacheDir: path.join(cacheDir, String(i)), fetchImpl: async () => ({
      ok: true, status: 200, json: async () => ({ puzzle: { ...dailyFixture.puzzle, id } }),
    }) });
    await assert.rejects(puzzles.daily(), { code: 'PUZZLE_UNAVAILABLE' });
    assert.equal(puzzles.starter().id, 'back-rank');
  }
  assert.deepEqual(await fs.readdir(cacheDir), [], 'malformed records must not be cached');
});

const realFetch = globalThis.fetch;
before(async () => {
  const { app } = require('../server');
  server = app.listen(0, '127.0.0.1'); await new Promise((resolve) => server.once('listening', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());
test('puzzle routes leave the main game unchanged and preserve Online and same-origin gates', async () => {
  const beforeState = await realFetch(`${origin}/api/state`).then((response) => response.json());
  const start = await realFetch(`${origin}/api/puzzles`).then((response) => response.json());
  const post = (route, body, headers = {}) => realFetch(`${origin}/api/puzzles/${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  assert.equal((await post('daily', {})).status, 409);
  assert.equal((await post('move', { id: start.id, moves: ['e1e8'] }, { Origin: 'https://example.com' })).status, 403);
  assert.equal((await post('move', { id: start.id, moves: ['e1e8'] })).status, 200);
  assert.equal((await post('hint', { id: start.id, moves: [] })).status, 200);
  assert.equal((await post('reveal', { id: start.id, moves: [] })).status, 200);
  const afterState = await realFetch(`${origin}/api/state`).then((response) => response.json());
  for (const field of ['id', 'revision', 'fens', 'moveLog', 'settings']) assert.deepEqual(afterState[field], beforeState[field], `${field} changed during puzzle play`);
});
