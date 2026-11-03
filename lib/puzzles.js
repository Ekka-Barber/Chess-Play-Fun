const fs = require('node:fs/promises');
const path = require('node:path');
const rules = require('./rules');
const chessops = (name) => require(path.join(path.dirname(require.resolve('chessops')), '..', 'esm', `${name}.js`));
const { parsePgn, startingPosition } = chessops('pgn');
const { parseSan } = chessops('san');
const { makeFen } = chessops('fen');

const DAY = 86400000;
const DAILY_URL = 'https://lichess.org/api/puzzle/daily';
const fail = (message, status = 400, code = 'BAD_PUZZLE') => Object.assign(new Error(message), { status, code });
// Original teaching positions, followed by the public-domain puzzle in Lichess's API example.
const STARTERS = [
  { id: 'back-rank', title: 'Close the back rank', fen: '6k1/5ppp/8/8/8/8/8/4R1K1 w - - 0 1', solution: ['e1e8'], themes: ['Mate in one', 'Back rank'] },
  { id: 'queen-and-king', title: 'Let your king help', fen: '7k/7p/5KQ1/8/8/8/8/8 w - - 0 1', solution: ['g6g7'], themes: ['Mate in one', 'King support'] },
  { id: 'smothered-mate', title: 'A knight needs no open file', fen: '6rk/6pp/7N/8/8/8/8/6K1 w - - 0 1', solution: ['h6f7'], themes: ['Mate in one', 'Smothered mate'] },
  { id: 'lichess-m5n0s', title: 'Find the forcing sequence', fen: 'r1bqr1k1/pp3ppp/2p2n2/3p2B1/8/2P1P3/PP1N1PPb/1BRQ1RK1 w - - 0 1', solution: ['g1h2', 'f6g4', 'd1g4', 'c8g4', 'g5d8'], themes: ['Combination', 'Hanging piece'], rating: 1957, source: 'https://lichess.org/training/m5n0s' },
];

function prepare(record) {
  if (!record || !/^[a-zA-Z0-9-]{1,40}$/.test(record.id) || typeof record.fen !== 'string' || record.fen.length > 200
    || !Array.isArray(record.solution) || !record.solution.length || record.solution.length > 30) throw fail('Puzzle data is incomplete.');
  const fens = [record.fen], line = [];
  for (const uci of record.solution) {
    const result = rules.apply(fens.at(-1), rules.parseUciMove(fens.at(-1), uci));
    fens.push(result.fen); line.push(result.move);
  }
  return { ...record, fens, line, side: record.fen.split(' ')[1] };
}

function createPuzzles({ cacheDir = path.join(process.cwd(), '.cache', 'puzzles'), fetchImpl = fetch, now = Date.now } = {}) {
  const starters = STARTERS.map(prepare), known = new Map(starters.map((puzzle) => [puzzle.id, puzzle]));
  let pending = null, cooldownUntil = 0;
  function get(id) {
    if (typeof id !== 'string' || !known.has(id)) throw fail('Choose a puzzle from this session.');
    return known.get(id);
  }
  function snapshot(puzzle, moves = []) {
    if (!Array.isArray(moves) || moves.length > Math.ceil(puzzle.line.length / 2)
      || moves.some((move, i) => typeof move !== 'string' || move !== puzzle.line[i * 2].uci)) throw fail('The puzzle attempt does not match this position.');
    const cursor = Math.min(moves.length * 2, puzzle.line.length), fen = puzzle.fens[cursor], solved = cursor === puzzle.line.length;
    return { id: puzzle.id, title: puzzle.title, themes: puzzle.themes, rating: puzzle.rating ?? null, source: puzzle.source ?? null,
      side: puzzle.side, fen, board: rules.board(fen), moves, solved, legalMoves: solved ? [] : rules.legalMoves(fen), lastMove: puzzle.line[cursor - 1] ?? null };
  }
  function starter(index = 0) {
    if (!Number.isSafeInteger(index) || index < 0) throw fail('Choose a valid puzzle number.');
    return { ...snapshot(starters[index % starters.length]), index: index % starters.length, total: starters.length };
  }
  function move(id, moves) {
    const puzzle = get(id);
    if (!Array.isArray(moves) || !moves.length || moves.length > 16 || moves.some((uci) => typeof uci !== 'string' || !/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci))) throw fail('Choose a legal puzzle move.');
    const before = snapshot(puzzle, moves.slice(0, -1));
    if (before.solved) throw fail('This puzzle is already solved.');
    const uci = moves.at(-1);
    rules.apply(before.fen, rules.parseUciMove(before.fen, uci));
    if (uci !== puzzle.line[before.moves.length * 2].uci) return { ...before, correct: false, message: 'That is not the solution. Look for a stronger move.' };
    const result = snapshot(puzzle, moves);
    return { ...result, correct: true, message: result.solved ? 'Solved. Well found.' : 'Good move. Your opponent replied. Find the continuation.' };
  }
  function hint(id, moves) {
    const puzzle = get(id), state = snapshot(puzzle, moves);
    if (state.solved) throw fail('This puzzle is already solved.');
    const from = puzzle.line[state.moves.length * 2].from;
    return { square: from, message: `Look at the piece on ${from}.` };
  }
  const reveal = (id, moves) => { const puzzle = get(id); snapshot(puzzle, moves); return puzzle.line.map(({ uci, san }) => ({ uci, san })); };
  async function daily() {
    if (pending) return pending;
    pending = (async () => {
      const file = path.join(cacheDir, 'daily.json');
      try {
        const cached = JSON.parse(await fs.readFile(file, 'utf8'));
        if (Math.floor(cached.at / DAY) === Math.floor(now() / DAY)) {
          const puzzle = prepare(cached.puzzle); known.set(puzzle.id, puzzle); return snapshot(puzzle);
        }
      } catch { /* A missing or invalid cache entry is a miss. */ }
      if (now() < cooldownUntil) throw fail('Lichess is busy. Try again after a minute, or play a starter puzzle.', 429, 'PUZZLE_RATE_LIMIT');
      const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 4000);
      try {
        const response = await fetchImpl(DAILY_URL, { headers: { Accept: 'application/json', 'User-Agent': 'chess-play-fun/4.0 (local chess trainer)' }, signal: controller.signal });
        if (response.status === 429) {
          const retryAfter = response.headers?.get('retry-after'), seconds = Number(retryAfter);
          const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retryAfter) - now();
          cooldownUntil = now() + Math.max(60000, Number.isFinite(delay) ? delay : 60000);
          throw fail('Lichess is busy. Try again after a minute, or play a starter puzzle.', 429, 'PUZZLE_RATE_LIMIT');
        }
        if (!response.ok) throw fail('The daily puzzle is unavailable. Play a starter puzzle or try again later.', 502, 'PUZZLE_UNAVAILABLE');
        const json = await response.json(), record = json?.puzzle;
        if (typeof record?.id !== 'string' || !/^[a-zA-Z0-9]{1,34}$/.test(record.id)) throw fail('The daily puzzle data is incomplete.', 502, 'PUZZLE_UNAVAILABLE');
        let fen = record?.fen;
        if (!fen && typeof json?.game?.pgn === 'string' && json.game.pgn.length < 20000) {
          const game = parsePgn(json.game.pgn)[0], pos = startingPosition(game.headers).unwrap();
          for (const node of game.moves.mainline()) { const move = parseSan(pos, node.san); if (!move) throw fail('The daily game contains an invalid move.'); pos.play(move); }
          fen = makeFen(pos.toSetup());
        }
        const puzzle = prepare({ id: `daily-${record?.id}`, title: 'Lichess daily puzzle', fen, solution: record?.solution,
          rating: Number.isFinite(record?.rating) ? record.rating : null, themes: Array.isArray(record?.themes) ? record.themes.filter((theme) => typeof theme === 'string').slice(0, 8) : [], source: `https://lichess.org/training/${encodeURIComponent(record?.id ?? '')}` });
        known.set(puzzle.id, puzzle);
        try { await fs.mkdir(cacheDir, { recursive: true }); await fs.writeFile(file, JSON.stringify({ at: now(), puzzle })); } catch { /* Cache failure does not discard a playable puzzle. */ }
        return snapshot(puzzle);
      } catch (error) {
        if (error.code === 'PUZZLE_RATE_LIMIT' || error.code === 'PUZZLE_UNAVAILABLE') throw error;
        throw fail('The daily puzzle could not be loaded. Starter puzzles work offline.', 502, 'PUZZLE_UNAVAILABLE');
      } finally { clearTimeout(timer); }
    })();
    try { return await pending; } finally { pending = null; }
  }
  return { starter, move, hint, reveal, daily };
}

module.exports = { createPuzzles, STARTERS };
