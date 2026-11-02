const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { Resvg } = require('@resvg/resvg-js');
const themes = require('../public/themes');

const PROJECT = path.join(__dirname, '..');
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const ID = /^([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})-([1-9]\d{0,15})$/i;
const SQUARE = /^[a-h][1-8]$/;

class ArchiveError extends Error {
  constructor(code, message, cause) {
    super(message, { cause });
    this.name = 'ArchiveError';
    this.code = code;
  }
}

function requireValue(condition, message) {
  if (!condition) throw new ArchiveError('INVALID_ENTRY', message);
}

function text(value, name, max = 1200) {
  requireValue(typeof value === 'string' && value.trim().length > 0 && value.length <= max && !/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value), `${name} must be non-empty text (maximum ${max} characters).`);
  return value;
}

function fenBoard(fen) {
  text(fen, 'FEN', 200);
  const fields = fen.trim().split(/\s+/);
  requireValue(fields.length === 6 && /^[wb]$/.test(fields[1]) && /^(?:-|[KQkqA-Ha-h]+)$/.test(fields[2]) && /^(?:-|[a-h][36])$/.test(fields[3]) && /^\d+$/.test(fields[4]) && /^[1-9]\d*$/.test(fields[5]), 'FEN must contain a valid board, turn, castling, en passant, and move counters.');
  requireValue(Number.isSafeInteger(Number(fields[4])) && Number.isSafeInteger(Number(fields[5])), 'FEN move counters must be safe integers.');
  const ranks = fields[0].split('/');
  requireValue(ranks.length === 8, 'FEN must have eight ranks.');
  const board = {};
  for (let rank = 0; rank < 8; rank++) {
    let file = 0;
    for (const token of ranks[rank]) {
      requireValue(/^[prnbqkPRNBQK1-8]$/.test(token), 'FEN contains an invalid piece or empty-square count.');
      if (/^[1-8]$/.test(token)) file += Number(token);
      else board[`${'abcdefgh'[file++]}${8 - rank}`] = token;
      requireValue(file <= 8, 'FEN rank contains more than eight squares.');
    }
    requireValue(file === 8, 'Every FEN rank must contain eight squares.');
  }
  requireValue(Object.values(board).filter((p) => p === 'K').length === 1 && Object.values(board).filter((p) => p === 'k').length === 1, 'FEN must contain one king of each color.');
  return board;
}

function normalizeMove(move) {
  requireValue(move && typeof move === 'object' && !Array.isArray(move), 'Move must be an object.');
  requireValue(SQUARE.test(move.from) && SQUARE.test(move.to), 'Move squares must use algebraic coordinates.');
  const color = move.color === 'white' ? 'w' : move.color === 'black' ? 'b' : move.color;
  requireValue(color === 'w' || color === 'b', 'Move color must be white or black.');
  const san = text(move.san, 'Move SAN', 24);
  requireValue(/^(?:O-O(?:-O)?|[KQRBN]?[a-h]?[1-8]?x?[a-h][1-8](?:=[QRBN])?)[+#]?$/.test(san), 'Move SAN must use standard algebraic notation.');
  const result = { san, from: move.from, to: move.to, color };
  if (move.promotion != null) {
    requireValue(/^[qrbn]$/.test(move.promotion), 'Promotion piece is invalid.');
    result.promotion = move.promotion;
  }
  if (move.uci != null) {
    requireValue(/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(move.uci), 'UCI move is invalid.');
    result.uci = move.uci;
  }
  return result;
}

function normalizeEntry(entry) {
  requireValue(entry && typeof entry === 'object', 'Archive entry must be an object.');
  requireValue(UUID.test(entry.gameId), 'Game ID must be a UUID.');
  requireValue(Number.isSafeInteger(entry.ply) && entry.ply > 0, 'Ply must be a positive integer.');
  requireValue(entry.annotation?.type === 'brilliant', 'Only moves classified Brilliant can be archived.');
  requireValue(Object.hasOwn(themes, entry.theme), 'Board theme is unknown.');
  requireValue(typeof entry.flipped === 'boolean', 'Board orientation must be a boolean.');
  const before = fenBoard(entry.beforeFen);
  fenBoard(entry.fen);
  fenBoard(entry.startFen);
  const move = normalizeMove(entry.move);
  requireValue(before[move.from] && (before[move.from] === before[move.from].toUpperCase() ? 'w' : 'b') === move.color, 'The moved piece must exist in the before-position with the chosen color.');
  requireValue(entry.beforeFen.trim().split(/\s+/)[1] === move.color, 'The before-position must have the moving side to play.');
  requireValue(Array.isArray(entry.moves) && entry.moves.length === entry.ply, 'History must contain every move through the archived ply.');
  const moves = entry.moves.map((m) => typeof m === 'string' ? text(m, 'History move', 24) : normalizeMove(m));
  const { annotation } = entry;
  requireValue(annotation.whiteCp == null || Number.isFinite(annotation.whiteCp), 'Engine evaluation must be a finite number or null.');
  requireValue(Number.isSafeInteger(annotation.depth) && annotation.depth >= 0, 'Engine depth must be a non-negative integer.');
  const rule = annotation.rule ?? 'Local Stockfish heuristic; detailed rule not supplied';
  requireValue(typeof rule === 'string' || (rule && typeof rule === 'object' && !Array.isArray(rule)), 'Classification rule must be text or an evidence object.');
  let ruleJson;
  try { ruleJson = JSON.stringify(rule); } catch { throw new ArchiveError('INVALID_ENTRY', 'Classification evidence must be JSON serializable.'); }
  requireValue(ruleJson && ruleJson.length <= 12000, 'Classification evidence is too large.');
  const variant = entry.variant ?? 'standard';
  requireValue(typeof variant === 'string' && /^[a-z][a-z0-9_-]{0,31}$/.test(variant), 'Variant must be a short identifier.');
  requireValue(entry.seed == null || (Number.isInteger(entry.seed) && entry.seed >= 0 && entry.seed <= 959), 'Chess960 seed must be between 0 and 959.');
  return {
    version: 1, id: `${entry.gameId}-${entry.ply}`, gameId: entry.gameId, ply: entry.ply,
    fen: entry.fen, beforeFen: entry.beforeFen, startFen: entry.startFen, move, moves,
    annotation: { type: 'brilliant', label: text(annotation.label ?? 'Brilliant', 'Classification label', 80), explanation: text(annotation.explanation, 'Explanation'), whiteCp: annotation.whiteCp ?? null, depth: annotation.depth, rule: JSON.parse(ruleJson) },
    variant, seed: entry.seed ?? null, theme: entry.theme, flipped: entry.flipped,
  };
}

const xml = (value) => String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);

function captionLines(value) {
  const words = value.replace(/\s+/g, ' ').trim().match(/\S{1,44}/gu) || [];
  const lines = [];
  for (const word of words) {
    if (lines.length && lines.at(-1).length + word.length + 1 <= 44) lines[lines.length - 1] += ` ${word}`;
    else lines.push(word);
  }
  // shortcut: PNG captions show three lines; metadata retains the complete explanation.
  return lines.length > 3 ? [...lines.slice(0, 2), `${lines[2].slice(0, 41)}...`] : lines;
}

function renderSvg(input) {
  const entry = normalizeEntry(input);
  const palette = themes[entry.theme], board = fenBoard(entry.fen);
  const boardX = 64, boardY = 144, squareSize = 112;
  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1240" viewBox="0 0 1024 1240"><rect width="1024" height="1240" fill="${palette.bg}"/><g font-family="Segoe UI,Arial,sans-serif" fill="${palette.text}">`];
  const fields = entry.beforeFen.trim().split(/\s+/);
  parts.push(`<text x="64" y="70" font-size="32" font-weight="600">Brilliant move</text><text x="960" y="70" text-anchor="end" font-size="34" font-weight="600">${xml(`${fields[5]}${entry.move.color === 'w' ? '.' : '...'} ${entry.move.san}`)}</text>`);
  parts.push(`<text x="64" y="111" font-size="21" fill="${palette.muted}">${entry.move.color === 'w' ? 'White' : 'Black'} · ${xml(entry.variant === 'standard' ? 'Standard chess' : entry.variant === 'chess960' ? `Chess960${entry.seed == null ? '' : ` · seed ${entry.seed}`}` : entry.variant)}</text>`);
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const file = entry.flipped ? 7 - col : col, rank = entry.flipped ? row + 1 : 8 - row;
      const square = `${'abcdefgh'[file]}${rank}`, x = boardX + col * squareSize, y = boardY + row * squareSize;
      parts.push(`<g data-square="${square}" data-x="${x}" data-y="${y}"><rect x="${x}" y="${y}" width="112" height="112" fill="${(file + rank) % 2 ? palette.dark : palette.light}"/>`);
      if (square === entry.move.from || square === entry.move.to) parts.push(`<rect data-highlight="${square}" x="${x}" y="${y}" width="112" height="112" fill="${palette.selected || palette.accent}" fill-opacity="0.68"/>`);
      const piece = board[square];
      if (piece) {
        const name = `${piece === piece.toUpperCase() ? 'w' : 'b'}${piece.toUpperCase()}`;
        const source = fs.readFileSync(path.join(PROJECT, 'public', 'pieces', `${name}.svg`), 'utf8');
        const content = source.replace(/^[\s\S]*?<svg\b[^>]*>/i, '').replace(/<\/svg>\s*$/i, '');
        parts.push(`<svg data-piece="${name}" fill="#000" x="${x + 8}" y="${y + 8}" width="96" height="96" viewBox="0 0 45 45">${content}</svg>`);
      }
      parts.push('</g>');
    }
  }
  for (let i = 0; i < 8; i++) {
    parts.push(`<text x="42" y="${boardY + i * squareSize + 64}" text-anchor="middle" font-size="21" fill="${palette.muted}">${entry.flipped ? i + 1 : 8 - i}</text>`);
    parts.push(`<text x="${boardX + i * squareSize + 56}" y="1076" text-anchor="middle" font-size="21" fill="${palette.muted}">${'abcdefgh'[entry.flipped ? 7 - i : i]}</text>`);
  }
  const file = entry.move.to.charCodeAt(0) - 97, rank = Number(entry.move.to[1]);
  const badgeX = boardX + (entry.flipped ? 7 - file : file) * squareSize + 92;
  const badgeY = boardY + (entry.flipped ? rank - 1 : 8 - rank) * squareSize + 20;
  // Deep teal keeps the white !! at >=3:1 (WCAG 1.4.11); matches BADGES.brilliant in public/app.js.
  parts.push(`<g data-badge="${entry.move.to}"><circle cx="${badgeX}" cy="${badgeY}" r="17" fill="#0d7a73"/><text x="${badgeX}" y="${badgeY + 7}" text-anchor="middle" fill="#fff" font-size="20" font-weight="800" letter-spacing="-1.5">!!</text></g>`);
  captionLines(entry.annotation.explanation).forEach((line, index) => parts.push(`<text x="64" y="${1128 + index * 27}" font-size="20">${xml(line)}</text>`));
  const evaluation = entry.annotation.whiteCp == null ? '' : ` · White ${entry.annotation.whiteCp > 0 ? '+' : ''}${(entry.annotation.whiteCp / 100).toFixed(2)}`;
  parts.push(`<text x="64" y="1218" font-size="18" fill="${palette.muted}">Local Stockfish classification · depth ${entry.annotation.depth}${xml(evaluation)}</text></g></svg>`);
  return parts.join('');
}

function createArchive(directory = path.join(PROJECT, 'Brilliant Moves')) {
  if (typeof directory !== 'string' || !directory.trim() || directory.includes('\0')) throw new ArchiveError('INVALID_DIRECTORY', 'Archive directory must be a valid local path.');
  const rootDir = path.resolve(directory);

  function entryPath(id, filename) {
    const match = typeof id === 'string' && id.match(ID);
    if (!match || !Number.isSafeInteger(Number(match[2]))) throw new ArchiveError('INVALID_ID', 'Archive ID must contain a game UUID and a positive ply.');
    const dir = path.join(rootDir, id);
    for (const target of [dir, ...(filename ? [path.join(dir, filename)] : [])]) {
      try {
        if (fs.lstatSync(target).isSymbolicLink()) throw new ArchiveError('INVALID_PATH', 'Archive entries cannot use symbolic links.');
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    return filename ? path.join(dir, filename) : dir;
  }

  async function get(id) {
    try {
      const metadata = JSON.parse(await fsp.readFile(entryPath(id, 'metadata.json'), 'utf8'));
      const normalized = normalizeEntry(metadata);
      requireValue(metadata.id === id && normalized.id === id && !Number.isNaN(Date.parse(metadata.createdAt)), 'Saved metadata does not match the archive ID.');
      for (const file of ['move.png', 'game.pgn']) requireValue((await fsp.lstat(entryPath(id, file))).isFile(), 'Saved archive is missing a required file.');
      return { ...normalized, createdAt: metadata.createdAt };
    } catch (error) {
      if (error instanceof ArchiveError) throw error;
      if (error.code === 'ENOENT') throw new ArchiveError('NOT_FOUND', 'Saved Brilliant move was not found.', error);
      throw new ArchiveError('ARCHIVE_READ_FAILED', 'Could not read the saved Brilliant move.', error);
    }
  }

  async function save(input) {
    const metadata = { ...normalizeEntry(input), createdAt: new Date().toISOString() };
    const pgn = text(input.pgn, 'PGN', 2_000_000);
    try { return await get(metadata.id); } catch (error) { if (error.code !== 'NOT_FOUND') throw error; }
    let staging;
    try {
      const png = new Resvg(renderSvg(metadata), { font: { defaultFontFamily: 'Segoe UI', loadSystemFonts: true } }).render().asPng();
      await fsp.mkdir(rootDir, { recursive: true });
      staging = await fsp.mkdtemp(path.join(rootDir, `.${metadata.id}-`));
      await fsp.writeFile(path.join(staging, 'metadata.json'), `${JSON.stringify(metadata, null, 2)}\n`, { flag: 'wx' });
      await fsp.writeFile(path.join(staging, 'game.pgn'), pgn, { flag: 'wx' });
      await fsp.writeFile(path.join(staging, 'move.png'), png, { flag: 'wx' });
      try { await fsp.rename(staging, entryPath(metadata.id)); }
      catch (error) {
        if (['EEXIST', 'ENOTEMPTY', 'EPERM'].includes(error.code)) return await get(metadata.id);
        throw error;
      }
      return metadata;
    } catch (error) {
      if (error instanceof ArchiveError) throw error;
      throw new ArchiveError('ARCHIVE_SAVE_FAILED', 'Could not save the Brilliant move image, metadata, and PGN. Check the archive directory and available disk space.', error);
    } finally {
      if (staging) await fsp.rm(staging, { recursive: true, force: true }).catch(() => {});
    }
  }

  async function list() {
    let entries;
    try { entries = await fsp.readdir(rootDir, { withFileTypes: true }); }
    catch (error) {
      if (error.code === 'ENOENT') return [];
      throw new ArchiveError('ARCHIVE_READ_FAILED', 'Could not list saved Brilliant moves.', error);
    }
    const saved = await Promise.all(entries.filter((item) => item.isDirectory() && ID.test(item.name)).map(async (item) => {
      try { const { moves, startFen, ...summary } = await get(item.name); return summary; }
      catch { return null; }
    }));
    return saved.filter(Boolean).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
  }

  return { save, list, get, imagePath: (id) => entryPath(id, 'move.png'), pgnPath: (id) => entryPath(id, 'game.pgn'), rootDir };
}

module.exports = { createArchive, renderSvg, ArchiveError };
