const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { randomUUID } = require('node:crypto');
const { Resvg } = require('@resvg/resvg-js');
const { createArchive, renderSvg, ArchiveError } = require('../lib/archive');
const themes = require('../public/themes');

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const AFTER = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';

// Synthetic classification exercises storage; it does not claim that 1.e4 is Brilliant.
function entry(overrides = {}) {
  const move = { from: 'e2', to: 'e4', san: 'e4', uci: 'e2e4', color: 'w' };
  return {
    gameId: randomUUID(), ply: 1, beforeFen: START, fen: AFTER, startFen: START,
    move, moves: [move], variant: 'standard', seed: null, theme: 'classic', flipped: false,
    pgn: '[Event "Synthetic archive test"]\n\n1. e4 *\n',
    annotation: { type: 'brilliant', label: 'Brilliant', explanation: 'Synthetic archive fixture: keep the exact played position and engine evidence.', whiteCp: 25, depth: 18, rule: 'archive-test-only' },
    ...overrides,
  };
}

async function temporaryArchive(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'chess-archive-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return createArchive(path.join(directory, 'Brilliant Moves'));
}

test('empty archive does not create a directory', async (t) => {
  const archive = await temporaryArchive(t);
  assert.deepEqual(await archive.list(), []);
  await assert.rejects(fs.stat(archive.rootDir), { code: 'ENOENT' });
});

test('archive commits crisp PNG, metadata, and exact PGN, then survives reload', async (t) => {
  const archive = await temporaryArchive(t), input = entry();
  const saved = await archive.save(input);
  assert.equal(saved.id, `${input.gameId}-1`);
  assert.match(saved.createdAt, /^\d{4}-\d\d-\d\dT/);
  const png = await fs.readFile(archive.imagePath(saved.id));
  assert.deepEqual(png.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  assert.equal(png.readUInt32BE(16), 1024);
  assert.equal(png.readUInt32BE(20), 1240);
  assert.equal(await fs.readFile(archive.pgnPath(saved.id), 'utf8'), input.pgn);
  const restored = await createArchive(archive.rootDir).get(saved.id);
  assert.equal(restored.beforeFen, START);
  assert.equal(restored.fen, AFTER);
  assert.deepEqual(restored.moves, input.moves);
  assert.deepEqual(restored.annotation, input.annotation);
  assert.deepEqual((await archive.list()).map((item) => item.id), [saved.id]);
  assert.equal('moves' in (await archive.list())[0], false);
  assert.deepEqual((await fs.readdir(archive.rootDir)), [saved.id]);
});

test('same game and ply are idempotent, including concurrent saves', async (t) => {
  const archive = await temporaryArchive(t), input = entry();
  const [first, concurrent] = await Promise.all([archive.save(input), archive.save(input)]);
  assert.equal(first.id, concurrent.id);
  assert.equal(first.createdAt, concurrent.createdAt);
  const again = await archive.save({ ...input, annotation: { ...input.annotation, explanation: 'Later analysis does not overwrite the saved evidence.' } });
  assert.equal(again.annotation.explanation, input.annotation.explanation);
  assert.equal((await archive.list()).length, 1);
  assert.deepEqual(await fs.readdir(archive.rootDir), [first.id]);
});

test('orientation, pieces, highlights, coordinates, and theme derive from the saved position', () => {
  const input = entry({ theme: 'ocean' });
  const normal = renderSvg(input), flipped = renderSvg({ ...input, flipped: true });
  assert.match(normal, /data-square="a8" data-x="64" data-y="144"/);
  assert.match(normal, new RegExp(`data-square="a8"[^>]*><rect[^>]*fill="${themes.ocean.light}"`));
  assert.match(flipped, /data-square="h1" data-x="64" data-y="144"/);
  assert.match(normal, /data-square="e4" data-x="512" data-y="592"[\s\S]*?data-piece="wP"/);
  assert.match(flipped, /data-square="e4" data-x="400" data-y="480"[\s\S]*?data-piece="wP"/);
  assert.match(normal, /data-highlight="e2"/);
  assert.match(normal, /data-highlight="e4"/);
  assert.match(normal, /data-badge="e4"/);
  assert.ok(normal.includes(`fill="${themes.ocean.bg}"`));
  assert.match(normal, /x="120" y="1076"[^>]*>a<\/text>/);
  assert.match(flipped, /x="120" y="1076"[^>]*>h<\/text>/);
  assert.match(normal, /<path/);
  assert.match(normal, /data-piece="bP" fill="#000"/);
  assert.doesNotMatch(normal, /\b(?:href|xlink:href)\s*=/);
  const image = new Resvg(flipped).render();
  assert.equal(image.width, 1024);
  assert.equal(image.height, 1240);
});

test('all shared themes have readable caption and badge contrast', () => {
  const luminance = (hex) => hex.slice(1).match(/../g).map((value) => parseInt(value, 16) / 255).map((v) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
  const contrast = (a, b) => { const values = [luminance(a), luminance(b)].sort((x, y) => y - x); return (values[0] + 0.05) / (values[1] + 0.05); };
  for (const palette of Object.values(themes)) {
    assert.ok(contrast(palette.bg, palette.text) >= 4.5, palette.name);
    assert.ok(contrast(palette.bg, palette.muted) >= 4.5, palette.name);
    assert.ok(contrast(palette.accent, palette.ink) >= 4.5, palette.name);
  }
});

test('untrusted fields and traversal fail before creating archive entries', async (t) => {
  const archive = await temporaryArchive(t), input = entry();
  for (const bad of [
    { gameId: '../outside' }, { ply: 0 }, { ply: 1.5 }, { annotation: { ...input.annotation, type: 'best' } },
    { fen: '8/8/8/8/8/8/8/8 w - - 0 1' }, { beforeFen: 'not a FEN' }, { theme: '__proto__' },
    { theme: '../classic' }, { flipped: 'false' }, { seed: 960 }, { moves: [] }, { pgn: '' },
    { annotation: { ...input.annotation, depth: -1 } }, { move: { ...input.move, from: '../../x' } },
  ]) await assert.rejects(archive.save({ ...input, ...bad }), (error) => error instanceof ArchiveError && error.code === 'INVALID_ENTRY');
  for (const id of ['../outside', `${input.gameId}-1/../../file`, `${input.gameId}-01`, 'move.png']) {
    assert.throws(() => archive.imagePath(id), { code: 'INVALID_ID' });
    assert.throws(() => archive.pgnPath(id), { code: 'INVALID_ID' });
    await assert.rejects(archive.get(id), { code: 'INVALID_ID' });
  }
  assert.deepEqual(await archive.list(), []);
});

test('failed writes produce descriptive error and no committed entry', async (t) => {
  const archive = await temporaryArchive(t);
  await fs.writeFile(archive.rootDir, 'Keep this pre-existing file.');
  await assert.rejects(archive.save(entry()), (error) => error instanceof ArchiveError && error.code === 'ARCHIVE_SAVE_FAILED');
  assert.equal(await fs.readFile(archive.rootDir, 'utf8'), 'Keep this pre-existing file.');
});

test('render and mid-write failures never leave a partial gallery entry', async (t) => {
  const archive = await temporaryArchive(t);
  const render = t.mock.method(Resvg.prototype, 'render', () => { throw new Error('Synthetic render failure'); });
  await assert.rejects(archive.save(entry()), { code: 'ARCHIVE_SAVE_FAILED' });
  render.mock.restore();
  assert.deepEqual(await archive.list(), []);
  const writeFile = fs.writeFile;
  t.mock.method(fs, 'writeFile', async (filename, ...args) => {
    if (path.basename(filename) === 'move.png') throw Object.assign(new Error('Synthetic full disk'), { code: 'ENOSPC' });
    return writeFile(filename, ...args);
  });
  await assert.rejects(archive.save(entry()), { code: 'ARCHIVE_SAVE_FAILED' });
  assert.deepEqual(await archive.list(), []);
  assert.deepEqual(await fs.readdir(archive.rootDir), []);
});

test('corrupt and incomplete entries are omitted and list order is newest first', async (t) => {
  const archive = await temporaryArchive(t);
  const first = await archive.save(entry()), second = await archive.save(entry({ flipped: true }));
  const firstPath = path.join(archive.rootDir, first.id, 'metadata.json');
  const metadata = JSON.parse(await fs.readFile(firstPath, 'utf8'));
  metadata.createdAt = '2000-01-01T00:00:00.000Z';
  await fs.writeFile(firstPath, JSON.stringify(metadata));
  assert.deepEqual((await archive.list()).map((item) => item.id), [second.id, first.id]);
  await fs.unlink(archive.imagePath(second.id));
  assert.deepEqual((await archive.list()).map((item) => item.id), [first.id]);
  await fs.writeFile(firstPath, '{invalid');
  assert.deepEqual(await archive.list(), []);
  await assert.rejects(archive.get(first.id), { code: 'ARCHIVE_READ_FAILED' });
});
