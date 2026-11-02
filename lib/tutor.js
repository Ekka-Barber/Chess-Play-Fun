const rules = require("./rules");

const BADGES = {
  brilliant: ["Brilliant", "!!"], great: ["Great", "!"], best: ["Best", "★"],
  excellent: ["Excellent", "✓"], good: ["Good", "✓"], inaccuracy: ["Inaccuracy", "?!"],
  mistake: ["Mistake", "?"], blunder: ["Blunder", "??"], book: ["Book", "▤"], unrated: ["Unrated", ""],
};

// This local sigmoid and the published error bands are not Chess.com's rating-sensitive formula.
function expectedPoints(whiteCp, color = "w") {
  return 1 / (1 + Math.exp(-0.00368208 * whiteCp * (color === "w" ? 1 : -1)));
}

function pv(line) {
  return Array.isArray(line?.pv) ? line.pv : typeof line?.uci === "string" ? line.uci.trim().split(/\s+/) : [];
}

function continuation(fen, line, variant) {
  const steps = [];
  for (const uci of pv(line).slice(0, 12)) {
    try {
      const result = rules.apply(fen, rules.parseUciMove(fen, uci, variant), variant);
      steps.push({ uci: result.move.uci, san: result.move.san, from: result.move.from, to: result.move.to, fen: result.fen });
      fen = result.fen;
    } catch {
      break;
    }
  }
  return steps;
}

function firstMove(fen, line, variant) {
  try {
    return rules.apply(fen, rules.parseUciMove(fen, pv(line)[0], variant), variant).move;
  } catch {
    return null;
  }
}

function observation(move, afterFen, variant) {
  const name = rules.NAMES[move.piece].toLowerCase();
  let fact;
  if (move.castle) fact = `${move.san} castles ${move.castle === "k" ? "kingside" : "queenside"}`;
  else if (move.promotion) fact = `${move.san} promotes your pawn to a ${rules.NAMES[move.promotion].toLowerCase()}`;
  else if (move.captured) fact = `${move.san} captures a ${rules.NAMES[move.captured].toLowerCase()}`;
  else if (variant === "standard" && ((move.piece === "n" && ["b1", "g1", "b8", "g8"].includes(move.from))
    || (move.piece === "b" && ["c1", "f1", "c8", "f8"].includes(move.from)))) {
    fact = `${move.san} brings your ${name} off its starting square`;
  } else if (move.piece === "p" && ["d4", "e4", "d5", "e5"].includes(move.to)) {
    fact = `${move.san} places your pawn in the center`;
  } else fact = `${move.san} moves your ${name} to ${move.to}`;
  const pos = rules.load(afterFen);
  if (pos.isCheckmate()) return `${fact} and delivers checkmate.`;
  return `${fact}${pos.isCheck() ? " and gives check" : ""}.`;
}

function offeredSacrifice(beforeFen, afterFen, move, variant) {
  const before = rules.load(beforeFen);
  if (before.isCheck() || move.promotion || rules.legalMoves(beforeFen, variant).length <= 1) return null;
  // shortcut: exclude non-pawn captures until preceding-ply history can distinguish forced recaptures.
  if (move.captured && move.captured !== "p") return null;
  const beforeBoard = rules.board(beforeFen), afterBoard = rules.board(afterFen);
  const oppositeFen = beforeFen.split(" ");
  oppositeFen[1] = move.color === "w" ? "b" : "w";
  oppositeFen[3] = "-";
  let alreadyOffered;
  try {
    alreadyOffered = new Set(rules.legalMoves(oppositeFen.join(" "), variant).filter((candidate) => {
      const victim = beforeBoard[candidate.to];
      return victim && (victim === victim.toUpperCase()) === (move.color === "w");
    }).map((candidate) => candidate.to));
  } catch {
    return null;
  }
  for (const candidate of rules.legalMoves(afterFen, variant)) {
    const victim = afterBoard[candidate.to], piece = victim?.toLowerCase();
    if (!victim || !["n", "b", "r", "q"].includes(piece)
      || (victim === victim.toUpperCase()) !== (move.color === "w")) continue;
    const origin = candidate.to === move.to ? move.from : candidate.to;
    if (beforeBoard[origin] !== victim || alreadyOffered.has(origin)) continue;
    const captured = rules.apply(afterFen, candidate, variant);
    const recapture = rules.legalMoves(captured.fen, variant).some((reply) => reply.to === captured.move.to);
    const recovered = recapture ? rules.VALUES[captured.move.promotion || captured.move.piece] : 0;
    const cost = rules.VALUES[piece] - (rules.VALUES[move.captured] || 0) - recovered;
    if (cost < 2) continue;
    return { piece, square: candidate.to, captureUci: captured.move.uci, captureSan: captured.move.san, materialCost: cost };
  }
  return null;
}

function grade(loss) {
  if (loss <= 0.02) return "excellent";
  if (loss <= 0.05) return "good";
  if (loss <= 0.10) return "inaccuracy";
  if (loss <= 0.20) return "mistake";
  return "blunder";
}

function assessMove({ beforeFen, afterFen, move, pre, post, book = false, opening, variant = "standard" }) {
  const played = rules.apply(beforeFen, { from: move.from, to: move.inputTo || move.to,
    ...(move.promotion ? { promotion: move.promotion } : {}) }, variant);
  if (played.fen !== afterFen) throw new RangeError("Move does not match resulting position");
  move = played.move;
  const bestLine = pre?.lines?.[0], replyLine = post?.lines?.[0];
  const best = firstMove(beforeFen, bestLine, variant), reply = firstMove(afterFen, replyLine, variant);
  const known = Number.isFinite(bestLine?.whiteCp) && Number.isFinite(replyLine?.whiteCp) && Boolean(best);
  const whiteCp = Number.isFinite(replyLine?.whiteCp) ? replyLine.whiteCp : null;
  const beforePoints = known ? expectedPoints(bestLine.whiteCp, move.color) : null;
  const afterPoints = known ? expectedPoints(whiteCp, move.color) : null;
  const lossPoints = known ? Math.max(0, beforePoints - afterPoints) : null;
  const lossCp = known ? Math.max(0, (bestLine.whiteCp - whiteCp) * (move.color === "w" ? 1 : -1)) : null;
  const depth = Math.min(pre?.depth || 0, post?.depth || 0);
  const exactBest = best?.uci === move.uci;
  let type = book ? "book" : !known ? "unrated" : exactBest ? "best" : grade(lossPoints);
  let sacrifice, needsDepth;
  if (!book && known && lossPoints <= 0.02 && beforePoints < 0.8 && afterPoints >= 0.45) {
    sacrifice = offeredSacrifice(beforeFen, afterFen, move, variant);
    // Too shallow to confirm: the caller can search deeper and assess again instead of silently missing a Brilliant.
    if (sacrifice && depth < 14) { needsDepth = 14; sacrifice = null; }
    if (sacrifice) type = "brilliant";
  }
  const second = pre?.lines?.[1], secondMove = firstMove(beforeFen, second, variant);
  if (type === "best" && lossPoints <= 0.02 && depth >= 14 && rules.legalMoves(beforeFen, variant).length > 1
    && Number.isFinite(second?.whiteCp) && secondMove && secondMove.uci !== best.uci
    && afterPoints >= 0.48 && expectedPoints(second.whiteCp, move.color) < 0.40
    && beforePoints - expectedPoints(second.whiteCp, move.color) >= 0.12) type = "great";
  let explanation = observation(move, afterFen, variant);
  if (type === "book") {
    const name = typeof opening === "string" ? opening : opening?.name;
    explanation += ` This position is in the opening book${name ? `: ${name}.` : "."}`;
  } else if (type === "brilliant") {
    explanation += ` It newly offers your ${rules.NAMES[sacrifice.piece].toLowerCase()} on ${sacrifice.square}: ${sacrifice.captureSan} is legal, conceding ${sacrifice.materialCost} points of immediate material after available recaptures. The searched position remains sound. This is a conservative local sacrifice estimate.`;
  } else if (type === "great") explanation += " It is the only searched move that avoids a clearly worse result at this depth.";
  else if (type === "best") explanation += ` It is the engine's first choice at depth ${depth}.`;
  else if (type === "unrated") explanation += " A complete before-and-after engine search is needed to grade it.";
  else if (["inaccuracy", "mistake", "blunder"].includes(type)) {
    if (reply) explanation += ` ${move.color === "w" ? "Black" : "White"} can reply ${reply.san}${reply.captured ? `, capturing your ${rules.NAMES[reply.captured].toLowerCase()}` : ""}.`;
    if (best && !exactBest) explanation += ` Try ${best.san} instead.`;
    explanation += ` The local expected-points estimate falls by ${(lossPoints * 100).toFixed(1)} percentage points.`;
  } else explanation += " It stays close to the best searched result.";
  return {
    type, label: BADGES[type][0], symbol: BADGES[type][1], whiteCp, lossCp, lossPoints,
    betterSan: best && !exactBest ? best.san : null, betterUci: best && !exactBest ? best.uci : null,
    explanation, continuation: continuation(afterFen, replyLine, variant), depth, rule: "local-v1",
    ...(sacrifice ? { sacrifice } : {}),
    ...(needsDepth ? { needsDepth } : {}),
  };
}

function hint({ fen, line, variant = "standard" }) {
  rules.load(fen);
  const steps = continuation(fen, line, variant);
  if (!steps.length) return { title: "No legal hint", text: "No legal engine continuation is available for this position.", continuation: [] };
  const best = firstMove(fen, line, variant);
  return { title: `Try ${best.san}`, text: observation(best, steps[0].fen, variant), continuation: steps };
}

module.exports = { assessMove, hint, expectedPoints };
