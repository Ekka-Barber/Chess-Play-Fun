const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const rules = require('../lib/rules');
const { randomUUID } = require('node:crypto');
const { createOnline, OnlineError, CLOUD_TTL_MS } = require('../lib/online');

// Throwaway archive and online cache, plus a fetch spy, all installed BEFORE the server loads: the online
// layer binds fetch once at require time, and these tests must never touch the real folders or the network.
process.env.CHESS_ARCHIVE_DIR = path.join(os.tmpdir(), `chess-online-archive-${process.pid}`);
process.env.CHESS_ONLINE_CACHE_DIR = path.join(os.tmpdir(), `chess-online-cache-${process.pid}`);
const realFetch = globalThis.fetch;
const fetchLog = [];
let respond = async () => ({ ok: false, status: 503, json: async () => ({}) });
globalThis.fetch = async (url, options) => { fetchLog.push(String(url)); return respond(String(url), options); };
const { app, archive, engine, playingEngine, reviewEngine } = require('../server');
globalThis.fetch = realFetch; // only the online layer keeps the spy; the test's own HTTP calls stay unlogged
// Deterministic UCI boundary, as in server.test.js: no real engine is ever spawned here.
engine.start = async () => {};
engine.go = async (fen) => {
  const move = rules.legalMoves(fen)[0];
  return { lines: move ? [{ score: { type: 'cp', value: 25 }, pv: [move.uci] }] : [], depth: 12, nps: 100000, best: move?.uci };
};
reviewEngine.start = engine.start;
reviewEngine.go = (...args) => engine.go(...args);
playingEngine.start = engine.start;
playingEngine.go = async (...args) => engine.go(...args);

let server, origin;
before(async () => { server = app.listen(0, '127.0.0.1'); await new Promise((resolve) => server.once('listening', resolve)); origin = `http://127.0.0.1:${server.address().port}`; });
after(async () => {
  server.close();
  await fs.rm(process.env.CHESS_ARCHIVE_DIR, { recursive: true, force: true });
  await fs.rm(process.env.CHESS_ONLINE_CACHE_DIR, { recursive: true, force: true });
});
async function post(route, body = {}, status = 200) {
  const response = await realFetch(`${origin}/api/${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const result = await response.json();
  assert.equal(response.status, status, JSON.stringify(result));
  return result;
}
const state = () => realFetch(`${origin}/api/state`).then((r) => r.json());

// Lichess-shaped fixtures captured from the live endpoints (see lib/online.js).
const TB = { checkmate: false, stalemate: false, variant_win: false, variant_loss: false, insufficient_material: false, dtz: 15, precise_dtz: 15, dtm: 15, dtw: null, dtc: null, category: 'win', moves: [
  { uci: 'h1h8', san: 'Rh8+', zeroing: false, conversion: false, checkmate: false, stalemate: false, variant_win: false, variant_loss: false, insufficient_material: false, dtz: -14, precise_dtz: -14, dtm: -14, dtw: null, dtc: null, category: 'loss' },
  { uci: 'a1a2', san: 'Ka2', zeroing: false, conversion: false, checkmate: false, stalemate: false, variant_win: false, variant_loss: false, insufficient_material: false, dtz: -16, precise_dtz: -16, dtm: -16, dtw: null, dtc: null, category: 'loss' },
] };

test('online endpoints refuse with a clear 409 error while onlineFeatures is off (the default)', async () => {
  fetchLog.length = 0;
  const game = await post('new');
  assert.equal(game.settings.onlineFeatures, false, 'online features default to off');
  for (const route of ['online/tablebase', 'online/cloud-eval']) {
    const refusal = await post(route, { fen: game.fens[0] }, 409);
    assert.equal(refusal.code, 'ONLINE_DISABLED');
    assert.match(refusal.error, /[Oo]nline features are off/);
  }
  assert.deepEqual(fetchLog, [], 'no outbound request was attempted while the feature is off');
});

test('onlineFeatures round-trips through settings, survives a /api/new echo, and rejects non-booleans', async () => {
  await post('settings', { onlineFeatures: 'yes' }, 400);
  await post('settings', { onlineFeatures: true });
  assert.equal((await state()).settings.onlineFeatures, true);
  assert.equal((await post('new', { onlineFeatures: false })).settings.onlineFeatures, true, 'a client echoing a stale value into /api/new cannot flip the session switch');
  await post('settings', { onlineFeatures: false });
  assert.equal((await state()).settings.onlineFeatures, false);
});

test('online lookups accept only positions of the current game, and >7-piece tablebase asks stay local', async () => {
  fetchLog.length = 0;
  await post('settings', { onlineFeatures: true });
  const game = await post('new');
  const foreign = '8/8/8/4k3/8/8/8/4K3 w - - 0 1';
  for (const route of ['online/tablebase', 'online/cloud-eval']) {
    assert.equal((await post(route, { fen: foreign }, 400)).code, 'BAD_POSITION');
    await post(route, {}, 400);
    await post(route, { fen: 42 }, 400);
  }
  const oversized = await post('online/tablebase', { fen: game.fens[0] }, 400); // the 32-piece start position
  assert.equal(oversized.code, 'TOO_MANY_PIECES');
  assert.match(oversized.error, /7 pieces or fewer/);
  assert.deepEqual(fetchLog, [], 'foreign, malformed and oversized positions are all refused locally');
  await post('settings', { onlineFeatures: false });
});

test('an allowed cloud-eval answers with White-POV eval and depth, and the cache hit never refetches', async () => {
  fetchLog.length = 0;
  const start = rules.startFen();
  respond = async () => ({ ok: true, status: 200, json: async () => ({ fen: start, knodes: 105848192, depth: 70, pvs: [{ moves: 'e2e4 e7e5 g1f3', cp: 19 }] }) });
  await post('settings', { onlineFeatures: true });
  await post('new');
  const first = await post('online/cloud-eval', { fen: start });
  assert.deepEqual(first, { fen: start, depth: 70, knodes: 105848192, pvs: [{ whiteCp: 19, mate: null, moves: ['e2e4', 'e7e5', 'g1f3'] }], source: 'live' });
  assert.deepEqual(fetchLog, [`https://lichess.org/api/cloud-eval?fen=${encodeURIComponent(start)}&multiPv=1`]);
  const second = await post('online/cloud-eval', { fen: start });
  assert.equal(second.source, 'cache');
  assert.equal(fetchLog.length, 1, 'the cached answer was served without touching the network');
});

test('an allowed tablebase answers a <=7-piece position of the current game, then from cache', async () => {
  fetchLog.length = 0;
  await post('settings', { onlineFeatures: true });
  // Only /api/restore can put a short endgame into the live history: a synthetic archived brilliant whose
  // start position is a 3-piece KRK.
  const before = 'k7/8/8/8/8/8/8/K6R w - - 0 1';
  const move = { from: 'h1', to: 'h8', san: 'Rh8+', uci: 'h1h8', color: 'w' };
  const fixture = { gameId: randomUUID(), ply: 1, beforeFen: before, fen: 'k6R/8/8/8/8/8/8/K7 b - - 1 1', startFen: before, move, moves: [move], variant: 'standard', seed: null, theme: 'classic', flipped: false, pgn: '[Event "Synthetic online test"]\n\n1. Rh8+ *\n', annotation: { type: 'brilliant', label: 'Brilliant', explanation: 'Synthetic fixture so a 3-piece position enters the live game history.', whiteCp: 25, depth: 18, rule: 'online-test-only' } };
  await archive.save(fixture);
  const restored = await post('restore', { id: `${fixture.gameId}-1`, revision: (await state()).revision });
  assert.equal(restored.fens[0], before);
  respond = async () => ({ ok: true, status: 200, json: async () => TB });
  const answer = await post('online/tablebase', { fen: restored.fens[0] });
  assert.equal(answer.category, 'win');
  assert.equal(answer.wdl, 1);
  assert.equal(answer.dtz, 15);
  assert.deepEqual(answer.moves[0], { uci: 'h1h8', san: 'Rh8+', category: 'loss', wdl: -1, dtz: -14, dtm: -14 });
  assert.equal(answer.source, 'live');
  const cached = await post('online/tablebase', { fen: restored.fens[0] });
  assert.equal(cached.source, 'cache');
  assert.equal(fetchLog.length, 1, 'the immutable tablebase fact was served from disk on the second ask');
});

test('lib/online keeps tablebase forever, expires cloud evals after a day, and never leaks raw upstream errors', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'chess-online-lib-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const clock = { now: 1000 };
  // Tablebase entries are immutable: the cached answer survives far beyond any TTL without a refetch.
  let tableCalls = 0;
  const table = createOnline({ cacheDir: directory, fetchImpl: async () => { tableCalls++; return { ok: true, status: 200, json: async () => TB }; }, now: () => clock.now });
  const endgame = '4k3/8/8/8/8/8/8/4KQ2 w - - 0 1';
  const first = await table.tablebase(endgame);
  assert.equal(first.wdl, 1); assert.equal(first.dtz, 15); assert.equal(first.source, 'live');
  clock.now += 10 * CLOUD_TTL_MS;
  assert.equal((await table.tablebase(endgame)).source, 'cache', 'a tablebase fact older than any TTL is still cached');
  assert.equal(tableCalls, 1);
  // Cloud evals: fresh inside the TTL, refetched after it; a corrupt cache file is just a miss.
  let cloudCalls = 0;
  const cloud = createOnline({ cacheDir: directory, fetchImpl: async () => { cloudCalls++; return { ok: true, status: 200, json: async () => ({ fen: 'f', depth: 30, knodes: 1, pvs: [{ moves: 'e2e4', cp: 12 }] }) }; }, now: () => clock.now });
  const start = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  assert.equal((await cloud.cloudEval(start)).source, 'live');
  assert.equal((await cloud.cloudEval(start)).source, 'cache');
  clock.now += CLOUD_TTL_MS;
  assert.equal((await cloud.cloudEval(start)).source, 'live', 'the day-old entry was refetched');
  const files = await fs.readdir(path.join(directory, 'cloud-eval'));
  await fs.writeFile(path.join(directory, 'cloud-eval', files[0]), '{invalid');
  assert.equal((await cloud.cloudEval(start)).source, 'live', 'a corrupt cache entry is treated as a miss');
  assert.equal(cloudCalls, 3);
  // Upstream failures become one honest sentence, never the raw error; a hung call is aborted by the timeout.
  const missing = createOnline({ cacheDir: directory, fetchImpl: async () => ({ ok: false, status: 404, json: async () => ({ error: 'No cloud evaluation available for that position' }) }), now: () => clock.now });
  await assert.rejects(missing.cloudEval('8/8/8/8/8/8/8/K6R w - - 0 1'), (error) => error instanceof OnlineError && error.code === 'NO_UPSTREAM_ANSWER' && error.status === 404);
  const raw = new Error('getaddrinfo ENOTFOUND lichess.org');
  const unreachable = createOnline({ cacheDir: directory, fetchImpl: async () => { throw raw; }, now: () => clock.now });
  await assert.rejects(unreachable.cloudEval('8/8/8/8/8/8/8/K6R b - - 0 1'), (error) => error instanceof OnlineError && error.code === 'LICHESS_UNREACHABLE' && !error.message.includes('ENOTFOUND') && error.cause === raw);
  const hung = createOnline({ cacheDir: directory, timeoutMs: 25, fetchImpl: (url, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('This operation was aborted')))), now: () => clock.now });
  await assert.rejects(hung.cloudEval('8/8/8/8/6R1/8/7K b - - 0 1'), { code: 'LICHESS_UNREACHABLE' });
});
