const { test } = require("node:test");
const assert = require("node:assert/strict");
const { Chess: StandardChess } = require("chess.js");
const path = require("node:path");
const chessops = (name) => require(path.join(path.dirname(require.resolve("chessops")), "..", "esm", name + ".js"));
const { parsePgn, startingPosition } = chessops("pgn");
const { parseSan } = chessops("san");
const { makeFen } = chessops("fen");
const rules = require("../lib/rules");

function play(sequence, fen = rules.startFen(), variant = "standard") {
  const fens = [fen], moves = [];
  for (const uci of sequence.split(" ")) {
    const result = rules.apply(fen, rules.parseUciMove(fen, uci, variant), variant);
    fen = result.fen;
    fens.push(fen);
    moves.push(result.move);
  }
  return { fen, fens, moves };
}

const castles = (fen, variant = "chess960") => rules.legalMoves(fen, variant).filter((move) => move.castle);

test("all 960 numbered starts are unique and satisfy Chess960 restrictions", () => {
  const fens = Array.from({ length: 960 }, (_, seed) => rules.startFen("chess960", seed));
  assert.equal(new Set(fens).size, 960);
  for (const fen of fens) {
    const pos = rules.load(fen), rank = fen.split("/")[7].split(" ")[0];
    const rooks = [...rank].flatMap((piece, i) => piece === "R" ? [i] : []);
    const bishops = [...rank].flatMap((piece, i) => piece === "B" ? [i] : []);
    assert.ok(rooks[0] < rank.indexOf("K") && rank.indexOf("K") < rooks[1]);
    assert.notEqual(bishops[0] % 2, bishops[1] % 2);
    assert.equal(pos.board.occupied.size(), 32);
    assert.equal(pos.castles.castlingRights.size(), 4);
  }
  assert.equal(fens[0].split("/")[0], "bbqnnrkr");
  assert.equal(fens[518].split("/")[0], "rnbqkbnr");
  assert.equal(fens[959].split("/")[0], "rkrnnqbb");
  for (const seed of [-1, 960, 0.5, "518", null]) assert.throws(() => rules.startFen("chess960", seed), RangeError);
});

test("board and metadata preserve FEN letter conventions", () => {
  const pieces = rules.board(rules.startFen());
  assert.equal(Object.keys(pieces).length, 32);
  assert.equal(pieces.a1, "R");
  assert.equal(pieces.e8, "k");
  assert.equal(pieces.e4, undefined);
  assert.equal(rules.VALUES.q, 9);
  assert.equal(rules.NAMES.n, "Knight");
});

test("ordinary play and legal destinations agree with standard chess", () => {
  let fen = rules.startFen(), standard = new StandardChess();
  for (const uci of "e2e4 c7c5 g1f3 d7d6 d2d4 c5d4 f3d4 g8f6 b1c3 a7a6".split(" ")) {
    const actual = rules.legalMoves(fen).map((move) => move.uci).sort();
    const expected = standard.moves({ verbose: true }).map((move) => move.from + move.to + (move.promotion || "")).sort();
    assert.deepEqual(actual, expected);
    const result = rules.apply(fen, rules.parseUciMove(fen, uci));
    const move = standard.move({ from: uci.slice(0, 2), to: uci.slice(2, 4) });
    assert.equal(result.move.san, move.san);
    assert.equal(result.fen, standard.fen());
    fen = result.fen;
  }
  assert.equal(rules.allMoves(rules.load(rules.startFen())).length, 20);
});

test("standard castling exposes c/g destinations and canonical standard UCI", () => {
  const fen = "4k3/8/8/8/8/8/8/R3K2R w KQ - 0 1";
  assert.deepEqual(castles(fen, "standard").map((move) => move.to).sort(), ["c1", "g1"]);
  for (const [to, rookTo, castle] of [["g1", "f1", "k"], ["c1", "d1", "q"]]) {
    const result = rules.apply(fen, { from: "e1", to });
    assert.equal(rules.board(result.fen)[to], "K");
    assert.equal(rules.board(result.fen)[rookTo], "R");
    assert.equal(result.move.uci, "e1" + to);
    assert.equal(result.move.castle, castle);
    assert.equal(result.move.captured, undefined);
  }
  assert.deepEqual(rules.parseUciMove(fen, "e1h1"), { from: "e1", to: "g1" });
  assert.deepEqual(rules.parseUciMove(fen, "e1g1"), { from: "e1", to: "g1" });
});

test("stationary king Chess960 castling moves the rook and retains input target", () => {
  const fen = "4k3/8/8/8/8/8/8/6KR w H - 0 1";
  assert.deepEqual(castles(fen), [{ from: "g1", to: "h1", uci: "g1h1", castle: "k", kingTo: "g1" }]);
  const result = rules.apply(fen, { from: "g1", to: "h1" }, "chess960");
  assert.equal(rules.board(result.fen).g1, "K");
  assert.equal(rules.board(result.fen).f1, "R");
  assert.equal(rules.board(result.fen).h1, undefined);
  assert.equal(result.move.to, "g1");
  assert.equal(result.move.inputTo, "h1");
  assert.equal(result.move.uci, "g1h1");
  assert.equal(result.move.san, "O-O");
  assert.equal(result.move.captured, undefined);
  assert.deepEqual(rules.parseUciMove(fen, "g1h1", "chess960"), { from: "g1", to: "h1" });
});

test("Chess960 castling swaps adjacent king and rook, including queenside", () => {
  for (const [rank, rights, from, to, kingTo, rookTo, san] of [
    ["5KR1", "G", "f1", "g1", "g1", "f1", "O-O"],
    ["2RK4", "C", "d1", "c1", "c1", "d1", "O-O-O"],
  ]) {
    const fen = `4k3/8/8/8/8/8/8/${rank} w ${rights} - 0 1`;
    const result = rules.apply(fen, { from, to }, "chess960");
    assert.equal(rules.board(result.fen)[kingTo], "K");
    assert.equal(rules.board(result.fen)[rookTo], "R");
    assert.equal(result.move.to, kingTo);
    assert.equal(result.move.san, san);
  }
});

test("castling rejects attacked paths, occupied paths, and missing rights", () => {
  const positions = [
    "4kr2/8/8/8/8/8/8/4K2R w H - 0 1",
    "4k3/8/8/8/8/8/8/4KB1R w H - 0 1",
    "4k3/8/8/8/8/8/8/4K2R w - - 0 1",
    "4k1r1/8/8/8/8/8/8/6KR w H - 0 1",
  ];
  for (const fen of positions) {
    const from = rules.board(fen).g1 === "K" ? "g1" : "e1";
    assert.deepEqual(castles(fen), []);
    assert.throws(() => rules.apply(fen, { from, to: "h1" }, "chess960"), { code: "ILLEGAL_MOVE" });
  }
});

test("an ordinary king move remains distinct from Chess960 castling", () => {
  const fen = "4k3/8/8/8/8/8/8/5K1R w H - 0 1";
  const normal = rules.apply(fen, { from: "f1", to: "g1" }, "chess960");
  const castle = rules.apply(fen, { from: "f1", to: "h1" }, "chess960");
  assert.equal(normal.move.san, "Kg1");
  assert.equal(normal.move.castle, undefined);
  assert.equal(rules.board(normal.fen).h1, "R");
  assert.equal(castle.move.san, "O-O");
  assert.equal(rules.board(castle.fen).f1, "R");
});

test("en passant updates board, capture metadata, SAN, and FEN undo state", () => {
  const { fens, fen, moves } = play("e2e4 a7a6 e4e5 d7d5 e5d6");
  assert.equal(rules.board(fen).d5, undefined);
  assert.equal(rules.board(fen).d6, "P");
  assert.equal(moves.at(-1).captured, "p");
  assert.equal(moves.at(-1).san, "exd6");
  const before = fens.at(-2);
  assert.equal(makeFen(rules.load(before).toSetup()), before);
  assert.ok(rules.legalMoves(before).some((move) => move.uci === "e5d6"));
  const pinned = "k3r3/8/8/3pP3/8/8/8/4K3 w - d6 0 1";
  assert.ok(!rules.legalMoves(pinned).some((move) => move.uci === "e5d6"));
});

test("all four promotions are legal and underpromotion survives serialization", () => {
  const fen = "4k3/P7/8/8/8/8/8/4K3 w - - 0 1";
  const promotions = rules.legalMoves(fen).filter((move) => move.from === "a7");
  assert.deepEqual(promotions.map((move) => move.promotion).sort(), ["b", "n", "q", "r"]);
  const result = rules.apply(fen, { from: "a7", to: "a8", promotion: "n" });
  assert.equal(rules.board(result.fen).a8, "N");
  assert.equal(result.move.uci, "a7a8n");
  assert.equal(result.move.promotion, "n");
  assert.equal(result.move.san, "a8=N");
  assert.throws(() => rules.apply(fen, { from: "a7", to: "a8" }), { code: "ILLEGAL_MOVE" });
});

test("invalid inputs cannot move pieces or manufacture promotions", () => {
  const fen = rules.startFen();
  for (const request of [
    null, {}, { from: "a9", to: "a3" }, { from: "E2", to: "e4" },
    { from: "e7", to: "e5" }, { from: "a1", to: "a5" }, { from: "e2", to: "e2" },
    ...["k", "p", "queen", null, "", 1, {}].map((promotion) => ({ from: "e2", to: "e4", promotion })),
    { from: "e2", to: "e4", promotion: "q" },
  ]) assert.throws(() => rules.apply(fen, request), { code: "ILLEGAL_MOVE" });
  for (const uci of ["0000", "(none)", "e2e4q", "e2e9", "e2e4extra", null]) {
    assert.throws(() => rules.parseUciMove(fen, uci), { code: "ILLEGAL_MOVE" });
  }
  const checked = play("e2e4 d7d5 f1b5").fen;
  assert.throws(() => rules.apply(checked, { from: "h7", to: "h6" }), { code: "ILLEGAL_MOVE" });
});

test("status counts only history through selected ply, with canonical castling rights", () => {
  const { fens } = play("g1f3 g8f6 f3g1 f6g8 g1f3 g8f6 f3g1 f6g8", rules.startFen("chess960", 518), "chess960");
  assert.match(rules.status(fens).result, /threefold/);
  assert.equal(rules.status(fens, 4).over, false);
  assert.equal(rules.status(fens).turn, "w");
  for (const ply of [-1, fens.length, 0.5]) assert.throws(() => rules.status(fens, ply), RangeError);
});

test("status handles draw rules with checkmate priority", () => {
  assert.match(rules.status(["4k3/8/8/8/8/8/8/R3K3 w - - 100 51"]).result, /fifty/);
  assert.match(rules.status(["4k3/8/8/8/8/8/8/4K3 w - - 0 1"]).result, /insufficient/);
  assert.match(rules.status(["k7/8/1QK5/8/8/8/8/8 b - - 0 1"]).result, /stalemate/);
  const mate = "7k/6Q1/5K2/8/8/8/8/8 b - - 150 80";
  const result = rules.status([mate, mate, mate]);
  assert.equal(result.over, true);
  assert.equal(result.inCheck, true);
  assert.match(result.result, /White wins/);
  assert.match(rules.status(play("f2f3 e7e5 g2g4 d8h4").fens).result, /Black wins/);
});

test("PGN carries Chess960 setup and legally round-trips stationary castling", () => {
  const initial = "4k3/8/8/8/8/8/8/6KR w H - 0 1";
  const { moves, fen } = play("g1h1 e8d7", initial, "chess960");
  const text = rules.pgn(initial, moves, "chess960");
  assert.match(text, /\[Variant "Chess960"\]/);
  assert.match(text, /\[SetUp "1"\]/);
  assert.match(text, /\[FEN "/);
  const game = parsePgn(text)[0], pos = startingPosition(game.headers).unwrap();
  for (const node of game.moves.mainline()) {
    const move = parseSan(pos, node.san);
    assert.ok(move);
    pos.play(move);
  }
  assert.equal(makeFen(pos.toSetup()), fen);
  const standard = play("e2e4 e7e5");
  const standardPgn = rules.pgn(rules.startFen(), standard.moves);
  assert.match(standardPgn, /1\. e4 e5 \*/);
  assert.ok(!standardPgn.includes("[FEN"));
  assert.ok(!standardPgn.includes("[Variant"));
  const blackInitial = "4k3/8/8/8/8/8/8/R3K3 b - - 0 12";
  const black = play("e8d7", blackInitial);
  assert.match(rules.pgn(blackInitial, black.moves), /12\.\.\. Kd7/);
});
