const path = require("node:path");
// chessops 0.15.1 omits the CJS package marker; Node 24 can require its ESM build synchronously.
const chessops = (name) => require(path.join(path.dirname(require.resolve("chessops")), "..", "esm", name + ".js"));
const { Chess, castlingSide } = chessops("chess");
const { INITIAL_FEN, parseFen, makeFen } = chessops("fen");
const { makeSanAndPlay } = chessops("san");
const { defaultGame, extend, makePgn } = chessops("pgn");
const { makeSquare, parseSquare, makeUci, roleToChar, charToRole, kingCastlesTo } = chessops("util");

// Piece metadata uses the same letters as FEN and the existing move log.
const VALUES = Object.freeze({ p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 });
const NAMES = Object.freeze({ p: "Pawn", n: "Knight", b: "Bishop", r: "Rook", q: "Queen", k: "King" });
const PROMOTIONS = ["q", "r", "b", "n"];

function checkVariant(variant) {
  if (variant !== "standard" && variant !== "chess960") throw new RangeError("Unknown chess variant");
}

function startFen(variant = "standard", seed = 518) {
  checkVariant(variant);
  if (variant === "standard") return INITIAL_FEN;
  if (!Number.isInteger(seed) || seed < 0 || seed > 959) throw new RangeError("Chess960 seed must be 0..959");
  let n = seed;
  const rank = Array(8).fill("");
  rank[2 * (n % 4) + 1] = "B"; n = Math.floor(n / 4);
  rank[2 * (n % 4)] = "B"; n = Math.floor(n / 4);
  const empty = () => rank.flatMap((piece, file) => piece ? [] : [file]);
  rank[empty()[n % 6]] = "Q"; n = Math.floor(n / 6);
  const free = empty(), pairs = [];
  for (let a = 0; a < 4; a++) {
    for (let b = a + 1; b < 5; b++) pairs.push([a, b]);
  }
  for (const slot of pairs[n]) rank[free[slot]] = "N";
  empty().forEach((file, i) => { rank[file] = "RKR"[i]; });
  const back = rank.join("");
  const rooks = rank.flatMap((piece, file) => piece === "R" ? ["abcdefgh"[file]] : []).reverse().join("");
  return `${back.toLowerCase()}/pppppppp/8/8/8/8/PPPPPPPP/${back} w ${rooks.toUpperCase()}${rooks} - 0 1`;
}

function load(fen) {
  if (typeof fen !== "string") throw new TypeError("FEN must be a string");
  return Chess.fromSetup(parseFen(fen).unwrap()).unwrap();
}

function board(fen) {
  const pos = load(fen), pieces = {};
  for (const square of pos.board.occupied) {
    const piece = pos.board.get(square), letter = roleToChar(piece.role);
    pieces[makeSquare(square)] = piece.color === "white" ? letter.toUpperCase() : letter;
  }
  return pieces;
}

function allMoves(pos) {
  const moves = [];
  for (const [from, targets] of pos.allDests()) {
    for (const to of targets) {
      if (pos.board.pawn.has(from) && (to < 8 || to >= 56)) {
        for (const promotion of PROMOTIONS) moves.push({ from, to, promotion: charToRole(promotion) });
      } else moves.push({ from, to });
    }
  }
  return moves;
}

function describe(pos, move, variant) {
  const side = castlingSide(pos, move);
  const kingTo = side ? makeSquare(kingCastlesTo(pos.turn, side)) : undefined;
  const from = makeSquare(move.from);
  const to = side && variant === "standard" ? kingTo : makeSquare(move.to);
  return {
    from, to,
    ...(move.promotion ? { promotion: roleToChar(move.promotion) } : {}),
    uci: side && variant === "standard" ? from + kingTo : makeUci(move),
    ...(side ? { castle: side === "h" ? "k" : "q", kingTo } : {}),
  };
}

function legalMoves(fen, variant = "standard") {
  checkVariant(variant);
  const pos = load(fen);
  return allMoves(pos).map((move) => describe(pos, move, variant));
}

function illegalMove() {
  return Object.assign(new Error("That move is not legal. Choose another square."), { code: "ILLEGAL_MOVE" });
}

function findMove(pos, request, variant) {
  if (!request || typeof request.from !== "string" || typeof request.to !== "string"
    || !/^[a-h][1-8]$/.test(request.from) || !/^[a-h][1-8]$/.test(request.to)
    || (request.promotion !== undefined && !PROMOTIONS.includes(request.promotion))) throw illegalMove();
  const from = parseSquare(request.from), to = parseSquare(request.to);
  return allMoves(pos).find((move) => move.from === from
    && (move.promotion ? roleToChar(move.promotion) : undefined) === request.promotion
    && (move.to === to || describe(pos, move, variant).to === request.to));
}

function apply(fen, request, variant = "standard") {
  checkVariant(variant);
  const pos = load(fen), raw = findMove(pos, request, variant);
  if (!raw) throw illegalMove();
  const description = describe(pos, raw, variant);
  const piece = pos.board.get(raw.from), target = pos.board.get(raw.to);
  const captured = description.castle ? undefined : target ? roleToChar(target.role)
    : piece.role === "pawn" && raw.from % 8 !== raw.to % 8 ? "p" : undefined;
  const move = {
    from: request.from,
    to: description.kingTo || description.to,
    inputTo: request.to,
    uci: description.uci,
    color: pos.turn[0],
    piece: roleToChar(piece.role),
    ...(captured ? { captured } : {}),
    ...(description.promotion ? { promotion: description.promotion } : {}),
    ...(description.castle ? { castle: description.castle } : {}),
    san: makeSanAndPlay(pos, raw),
  };
  return { fen: makeFen(pos.toSetup()), move };
}

function parseUciMove(fen, uci, variant = "standard") {
  checkVariant(variant);
  if (typeof uci !== "string" || !/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci)) throw illegalMove();
  const pos = load(fen);
  const request = { from: uci.slice(0, 2), to: uci.slice(2, 4), ...(uci[4] ? { promotion: uci[4] } : {}) };
  const move = findMove(pos, request, variant);
  if (!move) throw illegalMove();
  const description = describe(pos, move, variant);
  return { from: description.from, to: description.to, ...(description.promotion ? { promotion: description.promotion } : {}) };
}

function status(fens, ply = fens.length - 1) {
  if (!Array.isArray(fens) || !Number.isInteger(ply) || ply < 0 || ply >= fens.length) throw new RangeError("Invalid history position");
  const pos = load(fens[ply]), turn = pos.turn[0], inCheck = pos.isCheck();
  let result = null;
  if (pos.isCheckmate()) result = `Checkmate - ${turn === "w" ? "Black" : "White"} wins`;
  else if (pos.isStalemate()) result = "Draw - stalemate";
  else if (pos.isInsufficientMaterial()) result = "Draw - insufficient material";
  else {
    const key = (fen) => makeFen(load(fen).toSetup()).split(" ").slice(0, 4).join(" ");
    const current = key(fens[ply]);
    if (fens.slice(0, ply + 1).filter((fen) => key(fen) === current).length >= 3) result = "Draw - threefold repetition";
    else if (pos.halfmoves >= 100) result = "Draw - fifty-move rule";
  }
  return { turn, over: result !== null, result, inCheck };
}

function pgn(initialFen, moves, variant = "standard") {
  checkVariant(variant);
  const fen = makeFen(load(initialFen).toSetup());
  const game = defaultGame();
  if (variant === "chess960") game.headers.set("Variant", "Chess960");
  if (variant === "chess960" || fen !== INITIAL_FEN) {
    game.headers.set("SetUp", "1");
    game.headers.set("FEN", fen);
  }
  extend(game.moves, moves.map((move) => ({ san: move.san })));
  return makePgn(game);
}

module.exports = { startFen, load, board, legalMoves, apply, status, pgn, parseUciMove, allMoves, VALUES, NAMES };
