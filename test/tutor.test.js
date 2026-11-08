const { test } = require("node:test");
const assert = require("node:assert/strict");
const rules = require("../lib/rules");
const { assessMove, hint, expectedPoints } = require("../lib/tutor");

function review(fen, uci, { best = uci, beforeCp = 0, afterCp = 0, reply, depth = 16, alternatives = [], book = false, opening } = {}) {
  const played = rules.apply(fen, rules.parseUciMove(fen, uci));
  return assessMove({ beforeFen: fen, afterFen: played.fen, move: played.move,
    pre: { depth, lines: [{ uci: best, whiteCp: beforeCp }, ...alternatives] },
    post: { depth, lines: [{ uci: reply || rules.legalMoves(played.fen)[0]?.uci, whiteCp: afterCp }] }, book, opening });
}

const cpForPoints = (points) => Math.log(points / (1 - points)) / 0.00368208;
const gift = "r1bq1rk1/ppp2ppp/2np1n2/4P3/8/2NB1N2/PPP2PPP/R1BQ1RK1 w - - 0 8";
const legalMate = "rn1qkbnr/ppp2p1p/3p2p1/4p3/2B1P1b1/2N2N2/PPPP1PPP/R1BQK2R w KQkq - 0 5";

test("local sigmoid keeps White/Black POV symmetric and handles mate-sized scores", () => {
  assert.equal(expectedPoints(0), 0.5);
  assert.equal(expectedPoints(100, "w"), expectedPoints(-100, "b"));
  assert.equal(expectedPoints(100000), 1);
  assert.ok(expectedPoints(-100000) < 1e-100);
});

test("expected-points loss uses all five ordinary grading bands", () => {
  for (const [loss, type] of [[0.01, "excellent"], [0.03, "good"], [0.07, "inaccuracy"], [0.15, "mistake"], [0.30, "blunder"]]) {
    const result = review(rules.startFen(), "e2e4", { best: "d2d4", afterCp: cpForPoints(0.5 - loss) });
    assert.equal(result.type, type);
    assert.ok(Math.abs(result.lossPoints - loss) < 1e-12);
    assert.equal(result.betterSan, "d4");
    assert.equal(result.rule, "local-v2");
  }
});

test("Black's deterioration and White's improvement use the correct score sign", () => {
  const fen = rules.apply(rules.startFen(), { from: "e2", to: "e4" }).fen;
  const result = review(fen, "d7d5", { best: "c7c5", afterCp: -cpForPoints(0.2) });
  assert.equal(result.type, "blunder");
  assert.ok(result.lossCp > 0);
  assert.ok(Math.abs(result.lossPoints - 0.3) < 1e-12);
  const improved = review(fen, "d7d5", { best: "c7c5", afterCp: -100 });
  assert.equal(improved.lossPoints, 0);
  assert.equal(improved.lossCp, 0);
  assert.equal(improved.type, "excellent");
});

test("exact engine top move is Best, while absence from MultiPV does not imply a mistake", () => {
  const best = review(rules.startFen(), "e2e4");
  assert.equal(best.type, "best");
  assert.equal(best.betterUci, null);
  assert.equal(review(rules.startFen(), "e2e4", { best: "d2d4", afterCp: 0 }).type, "excellent");
  const played = rules.apply(rules.startFen(), { from: "e2", to: "e4" });
  const unavailable = assessMove({ beforeFen: rules.startFen(), afterFen: played.fen, move: played.move,
    pre: { depth: 14, lines: [{ uci: "d2d4", whiteCp: 20 }] }, post: { depth: 14, lines: [] } });
  assert.equal(unavailable.type, "unrated");
  assert.equal(unavailable.lossPoints, null);
});

test("Book requires supplied opening knowledge and keeps its name", () => {
  const result = review(rules.startFen(), "e2e4", { book: true, opening: { name: "King's Pawn Game" } });
  assert.equal(result.type, "book");
  assert.match(result.explanation, /King's Pawn Game/);
  assert.notEqual(review(rules.startFen(), "e2e4").type, "book");
});

test("Great requires a legal only-good alternative gap and adequate depth", () => {
  const options = { alternatives: [{ uci: "d2d4", whiteCp: -200 }] };
  assert.equal(review(rules.startFen(), "e2e4", options).type, "great");
  assert.equal(review(rules.startFen(), "e2e4", { ...options, depth: 10 }).type, "best");
  assert.equal(review(rules.startFen(), "e2e4", { alternatives: [{ uci: "d2d4", whiteCp: -10 }] }).type, "best");
  assert.equal(review(rules.startFen(), "e2e4", { alternatives: [{ uci: "d2d8", whiteCp: -200 }] }).type, "best");
  const forced = "7k/5K2/6R1/8/8/8/8/8 b - - 0 1";
  assert.equal(rules.legalMoves(forced).length, 1);
  assert.equal(review(forced, "h8h7", { alternatives: [{ uci: "h8g8", whiteCp: 200 }] }).type, "best");
});

test("hint legally replays PV and states verified development, capture, check and castle facts", () => {
  const result = hint({ fen: rules.startFen(), line: { uci: "g1f3", pv: ["g1f3", "d7d5", "not-a-move", "e2e4"] } });
  assert.equal(result.title, "Try Nf3");
  assert.match(result.text, /knight off its starting square/);
  assert.deepEqual(result.continuation.map((step) => step.san), ["Nf3", "d5"]);
  assert.equal(rules.board(result.continuation[0].fen).f3, "N");
  assert.match(hint({ fen: gift, line: { uci: "d3h7" } }).text, /captures a pawn and gives check/);
  assert.match(hint({ fen: "4k3/8/8/8/8/8/8/R3K2R w KQ - 0 1", line: { uci: "e1g1" } }).text, /castles kingside/);
  assert.equal(hint({ fen: rules.startFen(), line: { uci: "e2e5" } }).continuation.length, 0);
});

test("blunder explanation uses the actual legal searched reply and better move", () => {
  const fen = "4k3/8/8/8/8/8/3r4/3QK3 w - - 0 1";
  const result = review(fen, "d1e2", { best: "d1d2", beforeCp: 100, afterCp: -700, reply: "d2e2" });
  assert.equal(result.type, "blunder");
  assert.match(result.explanation, /Black can reply Rxe2\+, capturing your queen/);
  assert.match(result.explanation, /Try Qxd2 instead/);
  assert.equal(result.continuation[0].san, "Rxe2+");
  const invalidReply = review(fen, "d1e2", { best: "d1d2", beforeCp: 100, afterCp: -700, reply: "d2e8" });
  assert.ok(!invalidReply.explanation.includes("can reply"));
  assert.deepEqual(invalidReply.continuation, []);
});

test("Brilliant recognizes a newly offered bishop with a verified material concession", () => {
  const result = review(gift, "d3h7", { beforeCp: 30, afterCp: 25, reply: "g8h7" });
  assert.equal(result.type, "brilliant");
  assert.equal(result.sacrifice.piece, "b");
  assert.equal(result.sacrifice.square, "h7");
  assert.ok(result.sacrifice.materialCost >= 2);
  const after = rules.apply(gift, rules.parseUciMove(gift, "d3h7")).fen;
  assert.doesNotThrow(() => rules.parseUciMove(after, result.sacrifice.captureUci));
  assert.ok(result.explanation.includes(`If Black accepts with ${result.sacrifice.captureSan}`));
});

test("Brilliant can recognize an unmoved queen exposed by moving a blocker", () => {
  const result = review(legalMate, "f3e5", { beforeCp: 30, afterCp: 25, reply: "g4d1" });
  assert.equal(result.type, "brilliant");
  assert.equal(result.sacrifice.piece, "q");
  assert.equal(result.sacrifice.square, "d1");
  assert.equal(result.sacrifice.captureSan, "Bxd1");
  const after = rules.apply(legalMate, rules.parseUciMove(legalMate, "f3e5")).fen;
  const shown = hint({ fen: after, line: { pv: ["g4d1", "c4f7", "e8e7", "c3d5"] } });
  assert.deepEqual(shown.continuation.map((step) => step.san), ["Bxd1", "Bxf7+", "Ke7", "Nd5#"]);
  assert.ok(rules.load(shown.continuation.at(-1).fen).isCheckmate());
});

test("Chess960 hints and assessment retain stationary-king castling semantics", () => {
  const fen = "4k3/8/8/8/8/8/8/6KR w H - 0 1", variant = "chess960";
  const played = rules.apply(fen, { from: "g1", to: "h1" }, variant);
  const pre = { depth: 16, lines: [{ uci: "g1h1", whiteCp: 0 }] };
  const post = { depth: 16, lines: [{ uci: "e8d7", whiteCp: 0 }] };
  const result = assessMove({ beforeFen: fen, afterFen: played.fen, move: played.move, pre, post, variant });
  assert.equal(result.type, "best");
  const shown = hint({ fen, line: pre.lines[0], variant });
  assert.equal(shown.title, "Try O-O");
  assert.equal(shown.continuation[0].from, "g1");
  assert.equal(shown.continuation[0].to, "g1");
  assert.equal(rules.board(shown.continuation[0].fen).f1, "R");
});

test("ordinary play, low depth, already-winning positions and poor outcomes are not Brilliant", () => {
  assert.notEqual(review(rules.startFen(), "g1f3").type, "brilliant");
  assert.notEqual(review(gift, "d3h7", { depth: 13, reply: "g8h7" }).type, "brilliant");
  assert.notEqual(review(gift, "d3h7", { beforeCp: 600, afterCp: 600, reply: "g8h7" }).type, "brilliant");
  assert.notEqual(review(gift, "d3h7", { beforeCp: -150, afterCp: -150, reply: "g8h7" }).type, "brilliant");
});

test("already-hanging pieces, equal exchanges and checked recaptures are excluded", () => {
  const hanging = "3rk3/8/8/8/8/8/8/3QK3 w - - 0 1";
  assert.notEqual(review(hanging, "d1d2", { reply: "d8d2" }).type, "brilliant");
  const exchange = "3rk3/8/8/8/8/8/3r4/3RK3 w - - 0 1";
  assert.notEqual(review(exchange, "d1d2", { reply: "d8d2" }).type, "brilliant");
  const recapture = "4k3/8/8/8/8/8/4q3/3QK3 w - - 0 1";
  assert.ok(rules.load(recapture).isCheck());
  assert.notEqual(review(recapture, "d1e2").type, "brilliant");
});

test("assessment is deterministic, does not mutate input, and rejects mismatched result positions", () => {
  const played = rules.apply(gift, rules.parseUciMove(gift, "d3h7"));
  const input = { beforeFen: gift, afterFen: played.fen, move: played.move,
    pre: { depth: 16, lines: [{ uci: "d3h7", whiteCp: 30 }] }, post: { depth: 16, lines: [{ uci: "g8h7", whiteCp: 25 }] } };
  const original = JSON.stringify(input), first = assessMove(input);
  assert.deepEqual(assessMove(input), first);
  assert.equal(JSON.stringify(input), original);
  assert.throws(() => assessMove({ ...input, afterFen: gift }), /does not match/);
});

test("Brilliant accepts voluntary exchange sacrifices for either color", () => {
  for (const [fen, uci, reply] of [
    ["6k1/8/8/8/1p6/2bR4/8/6K1 w - - 0 1", "d3c3", "b4c3"],
    ["6k1/8/2Br4/1P6/8/8/8/6K1 b - - 0 1", "d6c6", "b5c6"],
  ]) {
    const result = review(fen, uci, { reply });
    assert.equal(result.type, "brilliant");
    assert.equal(result.sacrifice.materialCost, 2);
  }
});

test("an equal exchange available before the move does not make a defended piece already hanging", () => {
  const fen = "6k1/7p/8/4n3/8/3B4/8/3R2K1 w - - 0 1";
  const result = review(fen, "d3h7", { reply: "g8h7" });
  assert.equal(result.type, "brilliant");
  assert.equal(result.sacrifice.piece, "b");
});

test("sacrifice material considers a recapture that would itself lose the queen", () => {
  const fen = "3r2k1/8/4p3/3p4/8/8/3R4/3Q2K1 w - - 0 1";
  const result = review(fen, "d2d5", { reply: "d8d5" });
  assert.equal(result.type, "brilliant");
  assert.equal(result.sacrifice.materialCost, 4);
});

test("a winning sacrifice is assessed against alternatives instead of its own winning evaluation", () => {
  const options = { beforeCp: 100000, afterCp: 100000, reply: "g8h7", alternatives: [{ uci: "c1e3", whiteCp: 0 }] };
  assert.equal(review(gift, "d3h7", options).type, "brilliant");
  assert.notEqual(review(gift, "d3h7", { ...options, alternatives: [{ uci: "c1e3", whiteCp: 600 }] }).type, "brilliant");
  assert.notEqual(review(gift, "d3h7", { ...options, alternatives: [{ uci: "c1e8", whiteCp: 0 }] }).type, "brilliant");
  const shallow = review(gift, "d3h7", { ...options, depth: 13 });
  assert.notEqual(shallow.type, "brilliant");
  assert.equal(shallow.needsDepth, 14);
});

test("a confirmed sacrifice can be Brilliant even when it is opening theory", () => {
  assert.equal(review(gift, "d3h7", { book: true, reply: "g8h7" }).type, "brilliant");
});

test("a sacrifice underestimated by shallow analysis requests confirmation before rejecting it", () => {
  const options = { best: "c1e3", beforeCp: 30, afterCp: -200, reply: "g8h7" };
  const shallow = review(gift, "d3h7", { ...options, depth: 12 });
  assert.equal(shallow.needsDepth, 14);
  assert.notEqual(shallow.type, "brilliant");
  const confirmed = review(gift, "d3h7", options);
  assert.equal(confirmed.needsDepth, undefined);
  assert.notEqual(confirmed.type, "brilliant");
});

test("a winning Chess960 stationary-king castle is a valid non-sacrificing alternative", () => {
  const fen = "6k1/8/8/8/1p6/2bR4/8/6KR w H - 0 1", variant = "chess960";
  const played = rules.apply(fen, { from: "d3", to: "c3" }, variant);
  const result = assessMove({ beforeFen: fen, afterFen: played.fen, move: played.move, variant,
    pre: { depth: 16, lines: [{ uci: "d3c3", whiteCp: 500 }, { uci: "g1h1", whiteCp: 500 }] },
    post: { depth: 16, lines: [{ uci: "b4c3", whiteCp: 500 }] } });
  assert.notEqual(result.type, "brilliant");
});
