const rules = require('./rules');
const names = require('../data/openings.json');
const notes = require('../data/opening-guide.json');

// Game FENs come from rules.apply. Move counters don't affect opening identity.
const positionKey = (fen) => fen.split(' ', 4).join(' ');
const positions = new Map();
for (const sequence of new Set([...Object.keys(names), ...Object.keys(notes)])) {
  let fen = rules.startFen();
  for (const uci of sequence.split(' ')) fen = rules.apply(fen, rules.parseUciMove(fen, uci)).fen;
  const key = positionKey(fen);
  const note = notes[sequence];
  const previous = positions.get(key);
  positions.set(key, {
    name: note?.name || previous?.name || names[sequence] || null,
    plans: note ? { white: note.white, black: note.black } : previous?.plans,
    ideas: note?.ideas || previous?.ideas,
  });
}

function openingAt(fens, ply) {
  for (let i = ply; i > 0; i--) {
    const name = positions.get(positionKey(fens[i]))?.name;
    if (name) return name;
  }
  return null;
}

function guideAt(fen) {
  return positions.get(positionKey(fen));
}

module.exports = { openingAt, guideAt };
