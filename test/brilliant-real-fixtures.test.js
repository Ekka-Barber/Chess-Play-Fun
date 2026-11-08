const { test } = require('node:test');
const assert = require('node:assert/strict');
const rules = require('../lib/rules');
const { assessMove } = require('../lib/tutor');

// Stockfish 19 snapshots: one thread, 32 MB, 1.8 seconds per position. Badges are our local assessments.
// PGNs: chessigma.com/benchmarks/brilliant/data; its Chess.com badge-agreement claims were not independently verified.
const sacrifices = [
  {
    source: 'https://www.chess.com/game/live/141133647564',
    fen: 'r1b1k1nr/ppp2pQp/2np1q1B/2b1p3/4P3/3P3N/PPP2PPP/RN2KB1R b KQkq - 2 6',
    uci: 'f6h6', depth: 18,
    choices: [['f6h6', -733], ['c5b4', -99], ['c8h3', -14]],
    whiteCp: -719, pv: ['g7h6', 'g8h6', 'f2f4', 'h6g4'],
    postAlternatives: [['g7g5', -780], ['g7f7', -1101]], expectedLoss: 0.0031140033771617226,
    offeredPiece: 'r', offeredSquare: 'h8',
  },
  {
    source: 'https://www.chess.com/game/live/146561042352',
    fen: '3r1rk1/pp3ppp/1qp1pn2/2R2b2/3P4/PB3N1P/2P2PP1/R2Q2K1 b - - 0 17',
    uci: 'b6c5', depth: 16,
    choices: [['b6c5', -392], ['f5e4', -264], ['h7h6', -247]],
    whiteCp: -365, pv: ['d4c5', 'd8d1', 'a1d1', 'f6e4'],
    postAlternatives: [['g2g4', -755], ['b3e6', -846]], expectedLoss: 0.01583652466166252,
    offeredPiece: 'q', offeredSquare: 'c5',
  },
  {
    source: 'https://www.chess.com/game/live/122947746214',
    fen: 'r2qk2r/2p2p1p/b1np1np1/1Nb1p3/p3P3/P4Q1P/BPPPNPP1/R1B1K2R w KQkq - 1 12',
    uci: 'b5c7', depth: 15,
    choices: [['b5c7', 402], ['d2d3', 321], ['b5c3', 192]],
    whiteCp: 414, pv: ['d8c7', 'f3f6', 'e8g8', 'd2d3'],
    postAlternatives: [], expectedLoss: 0,
    offeredPiece: 'n', offeredSquare: 'c7',
  },
];

test('real-game engine snapshots recognize direct, indirect and voluntary sacrifices', () => {
  for (const fixture of sacrifices) {
    const played = rules.apply(fixture.fen, rules.parseUciMove(fixture.fen, fixture.uci));
    const result = assessMove({ beforeFen: fixture.fen, afterFen: played.fen, move: played.move,
      pre: { depth: fixture.depth, lines: fixture.choices.map(([uci, whiteCp]) => ({ uci, whiteCp })) },
      post: { depth: fixture.depth, lines: [{ whiteCp: fixture.whiteCp, pv: fixture.pv },
        ...fixture.postAlternatives.map(([uci, whiteCp]) => ({ uci, whiteCp }))] } });
    assert.equal(result.type, 'brilliant', fixture.source);
    assert.equal(result.sacrifice.piece, fixture.offeredPiece);
    assert.equal(result.sacrifice.square, fixture.offeredSquare);
    assert.ok(Math.abs(result.lossPoints - fixture.expectedLoss) < 1e-12);
    assert.doesNotThrow(() => rules.parseUciMove(played.fen, result.sacrifice.captureUci));
    assert.deepEqual(result.continuation.map(step => step.uci), fixture.pv);
  }
});

test('real Greek-gift analysis rejects the sacrifice when a much stronger continuation exists', () => {
  const fen = 'r1bq1rk1/ppp2ppp/2np1n2/4P3/8/2NB1N2/PPP2PPP/R1BQ1RK1 w - - 0 8';
  const played = rules.apply(fen, rules.parseUciMove(fen, 'd3h7'));
  const result = assessMove({ beforeFen: fen, afterFen: played.fen, move: played.move,
    pre: { depth: 17, lines: [['e5f6', 991], ['e5d6', 759], ['c1f4', 711]].map(([uci, whiteCp]) => ({ uci, whiteCp })) },
    post: { depth: 18, lines: [{ whiteCp: 231, pv: ['f6h7', 'e5d6', 'c7d6', 'f3d4'] },
      { uci: 'g8h7', whiteCp: 757 }, { uci: 'g8h8', whiteCp: 892 }] } });
  assert.equal(result.type, 'blunder');
  assert.ok(Math.abs(result.lossPoints - 0.2739564400953718) < 1e-12);
  assert.deepEqual(result.continuation.map(step => step.san), ['Nxh7', 'exd6', 'cxd6', 'Nd4']);
});

test('real engine evaluation refuses an unsound rook-for-bishop offer despite material sacrifice', () => {
  const fen = '6k1/8/8/8/1p6/2bR4/8/6K1 w - - 0 1';
  const played = rules.apply(fen, rules.parseUciMove(fen, 'd3c3'));
  const result = assessMove({ beforeFen: fen, afterFen: played.fen, move: played.move,
    pre: { depth: 18, lines: [{ uci: 'd3d7', whiteCp: 33 }] },
    post: { depth: 18, lines: [{ uci: 'b4c3', whiteCp: -617 }] } });
  assert.equal(result.type, 'blunder');
  assert.equal(result.sacrifice, undefined);
});

test('an attacked piece needs a searched sound escape before its continued offer can be Brilliant', () => {
  const fixture = sacrifices[2], played = rules.apply(fixture.fen, rules.parseUciMove(fixture.fen, fixture.uci));
  const assess = choices => assessMove({ beforeFen: fixture.fen, afterFen: played.fen, move: played.move,
    pre: { depth: 15, lines: choices.map(([uci, whiteCp]) => ({ uci, whiteCp })) },
    post: { depth: 17, lines: [{ whiteCp: 414, pv: fixture.pv }] } });
  assert.equal(assess(fixture.choices).type, 'brilliant');
  assert.notEqual(assess(fixture.choices.slice(0, 2)).type, 'brilliant', 'd3 leaves the knight exposed');
  assert.notEqual(assess([fixture.choices[0], ['b5c3', -600]]).type, 'brilliant', 'an escape losing the game is insufficient');
});

test('the shared Take Take Take Rxc5 stays Excellent when other simple moves also win', () => {
  // Stockfish 19, one thread, 32 MB, depth 18 with a 2.5 second cap per position.
  const fen = '2r3k1/2N4p/1K4p1/2P5/8/2r5/8/8 b - - 0 44';
  const played = rules.apply(fen, rules.parseUciMove(fen, 'c3c5'));
  assert.equal(played.fen, '2r3k1/2N4p/1K4p1/2r5/8/8/8/8 w - - 0 45');
  const result = assessMove({ beforeFen: fen, afterFen: played.fen, move: played.move,
    pre: { depth: 18, lines: [['g6g5', -839], ['c3c1', -787], ['c8b8', -785]].map(([uci, whiteCp]) => ({ uci, whiteCp })) },
    post: { depth: 18, lines: [{ whiteCp: -931, pv: ['b6c5', 'c8c7', 'c5d4', 'g6g5'] }] } });
  assert.equal(result.type, 'excellent');
  assert.equal(result.lossPoints, 0);
  assert.deepEqual(result.continuation.map(step => step.san).slice(0, 2), ['Kxc5', 'Rxc7+']);
});
