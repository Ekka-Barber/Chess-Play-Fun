const { test } = require('node:test');
const assert = require('node:assert/strict');
const rules = require('../lib/rules');
const { assessMove } = require('../lib/tutor');

// Frozen Stockfish 19 snapshots (4 threads, 256 MB, depth 16 target with a 15 s cap; achieved depth recorded) of 17
// moves from the saved Brilliant collection, re-judged by hand on 18 November 2026 (the Nxc6 desperado was
// searched to depth 24, 4 threads, 512 MB, no time cap), plus three Chess.com-labelled
// games (PGNs: chessigma.com/benchmarks/brilliant/data; those labels were not independently verified).
// Badges are our local assessments: a sacrifice that wins its material straight back counts as a tactic here.
const cases = require('./fixtures/brilliant-cases.json');
function judge(fixture) {
  const played = rules.apply(fixture.fen, rules.parseUciMove(fixture.fen, fixture.uci));
  const input = { beforeFen: fixture.fen, afterFen: played.fen, move: played.move,
    pre: { depth: fixture.depth, lines: fixture.pre.map(([uci, whiteCp]) => ({ uci, whiteCp })) },
    post: { depth: fixture.depth, lines: fixture.post.map(([line, whiteCp]) => ({ pv: line.split(' '), whiteCp })) } };
  const first = assessMove(input);
  // Mirrors the server: a candidate is confirmed on the searched line where the offer is taken.
  if (!first.needsAcceptance || !fixture.accepted?.[0].startsWith(first.needsAcceptance)) return first;
  return assessMove({ ...input, accepted: { pv: fixture.accepted[0].split(' '), whiteCp: fixture.accepted[1] } });
}

test('saved false Brilliants are no longer flagged', () => {
  const wrong = cases.filter(fixture => !fixture.brilliant);
  assert.equal(wrong.length, 16);
  for (const fixture of wrong) assert.notEqual(judge(fixture).type, 'brilliant', `${fixture.name}: ${fixture.why}`);
});

test('real sacrifices are still Brilliant', () => {
  const real = cases.filter(fixture => fixture.brilliant);
  assert.equal(real.length, 4);
  for (const fixture of real) {
    const result = judge(fixture);
    assert.equal(result.type, 'brilliant', `${fixture.name}: ${fixture.why}`);
    assert.ok(result.sacrifice.materialCost >= 2);
    assert.equal(result.rule, 'local-v3');
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
