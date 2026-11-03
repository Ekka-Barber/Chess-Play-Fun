const $ = (selector) => document.querySelector(selector);
const FILES = 'abcdefgh';
const NAMES = { k: 'king', q: 'queen', r: 'rook', b: 'bishop', n: 'knight', p: 'pawn' };
const THEMES = window.CHESS_THEMES;
const PIECE_SETS = window.PIECE_SETS || [{ id: 'cburnett', name: 'Cburnett', base: 'pieces/' }];
let pieceSetKey = 'cburnett';
try {
  const saved = localStorage.getItem('chess.pieceSet');
  if (PIECE_SETS.some((set) => set.id === saved)) pieceSetKey = saved;
} catch (_) {}
// Pure chess-clock math (public/clock.js); the wiring below keeps it client-side only.
const CLOCK = window.CHESS_CLOCK;
// Move-quality icons in the widely recognised review style: coloured disc, bold glyph. Disc colours
// are tuned so the white glyph keeps >=3:1 (WCAG 1.4.11 graphics); only inaccuracy keeps its bright
// yellow disc and flips to dark ink - white on yellow measured 1.6:1, and darkening yellow enough
// for white would erase the badge's character. test/ui-contrast.test.js pins every ratio.
const BADGES = (() => {
  const mark = (glyph, size = 12.5, spacing = 0, ink = '#fff') => `<text x="10" y="14.4" font-size="${size}" letter-spacing="${spacing}" fill="${ink}" font-family="'Segoe UI',Arial,sans-serif" font-weight="800" text-anchor="middle">${glyph}</text>`;
  const glyphs = {
    brilliant: ['#0d7a73', mark('!!', 12.5, -1)],
    great: ['#5c8bb0', mark('!', 13.5)],
    best: ['#4d7a22', '<path fill="#fff" transform="translate(0 .5)" d="M10 3.7l1.56 4.16 4.43.19-3.47 2.77 1.18 4.28L10 12.65 6.3 15.1l1.18-4.28-3.47-2.77 4.43-.19z"/>'],
    excellent: ['#5d8026', '<path fill="#fff" d="M4.6 9.3h2.5v6.1H4.6zM8 9.2l2.5-4.1c.45-.7 1.55-.45 1.5.4l-.2 2.9h2.9c.8 0 1.35.75 1.15 1.5l-1.05 4.4c-.15.6-.7 1.05-1.3 1.05H8z"/>'],
    good: ['#5c7d43', '<path fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" d="M5.6 10.3l2.9 2.9 5.9-6.3"/>'],
    book: ['#a88865', '<path fill="#fff" d="M4.3 6.3c2-.6 3.9-.4 5.2.6v8.2c-1.3-.9-3.2-1.1-5.2-.5zM15.7 6.3c-2-.6-3.9-.4-5.2.6v8.2c1.3-.9 3.2-1.1 5.2-.5z"/>'],
    inaccuracy: ['#f7c631', mark('?!', 11.5, -.6, '#24251f')],
    mistake: ['#c26a12', mark('?', 13.5)],
    blunder: ['#fa412d', mark('??', 11.5, -.6)],
  };
  return Object.fromEntries(Object.entries(glyphs).map(([type, [color, glyph]]) => [type, { color, svg: `<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="10" fill="${color}"/>${glyph}</svg>` }]));
})();
let game, analysis, viewIndex = 0, flipped = false, arrowMode = 'best', selected = null;
let lastAnimatedBrilliant = '';
let busy = false, promoting = false, gesture = null, focusedSquare = 'e2';
let pieces = new Map(), boardFen = '', panelFingerprint = '', pollTimer, analysisTimer, toastTimer, pauseTimer;
let online = true, polling = false, themeKey = 'classic', collection = null, seenArchive = null, restoreId = null, reviewOpenedFor = null;
// The engine name follows the server's registry (/api/engines) and settings.engineId; the default is the built-in entry.
let engineName = 'Stockfish 19', engineRegistry = null, pauseSent = false;
// Per-tab id for /api/pause: hidden 30 s pauses live analysis; pagehide and the startup hello release it.
const TAB_ID = crypto.randomUUID ? crypto.randomUUID() : `tab-${Date.now()}-${Math.random().toString(36).slice(2)}`;
// Review walkthrough: the open key moment, an active retry ({ ply, fen?, move?, solved?, message }) and solved retries.
let activeMoment = null, bothSides = false, retry = null, bestShown = null;
// Optional chess clock, this tab only: `clock` is the armed state for the CURRENT game (CLOCK.newClock
// shape), `pendingClock` the {minutes, incrementSeconds} chosen in the new-game dialog, armed when that
// fresh game arrives. Never posted, never persisted — reload drops it (see clock.js header).
let clock = null, pendingClock = null, clockTimer = 0;
const solved = new Set();
const legalByFen = new Map(), hints = new Map(), revealed = new Set();
// Online answers, remembered per FEN for the session: tablebase facts are immutable and cloud evals only
// need to outlive the local search they bridge. Emptied the moment the Online switch goes back off.
const onlineByFen = new Map();
const board = $('#board');
const graphSize = { width: 300, height: 70 };
const ghost = document.createElement('div');
ghost.id = 'ghost';
ghost.setAttribute('aria-hidden', 'true');
document.body.append(ghost);
const pieceImage = (code) => `${PIECE_SETS.find((set) => set.id === pieceSetKey).base}${code === code.toUpperCase() ? 'w' : 'b'}${code.toUpperCase()}.svg`;
const col = (sq) => flipped ? 7 - FILES.indexOf(sq[0]) : FILES.indexOf(sq[0]);
const row = (sq) => flipped ? +sq[1] - 1 : 8 - +sq[1];
const colorOf = (code) => code === code.toUpperCase() ? 'w' : 'b';
const colorName = (color) => color === 'w' ? 'White' : 'Black';
const currentFen = () => game?.fens[viewIndex];
// Same count the server gates tablebase lookups on (server.js /api/online/tablebase): piece letters of the
// board field only, computed locally so the client never even asks for a bigger position.
const pieceCount = (fen) => fen.split(' ')[0].replace(/[^KQRBNPkqrbnp]/g, '').length;
const scoreLabel = (cp) => cp == null ? '—' : Math.abs(cp) >= 90000 ? `${cp < 0 ? '-' : ''}M` : `${cp > 0 ? '+' : ''}${(cp / 100).toFixed(2)}`;
// Eval columns: the leading glyph (+, -, M — advances 5.7-13.4px at 14px) gets a fixed .96em box
// (.ev .sg in style.css) so every row's digits start at the same offset; a missing glyph keeps the box.
const evHtml = (score) => /^[+\-M—]/.test(score) ? `<span class="sg">${score[0]}</span>${score.slice(1)}` : `<span class="sg"></span>${score}`;

function parseBoard(fen) {
  const result = {};
  fen.split(' ')[0].split('/').forEach((rank, i) => {
    let file = 0;
    for (const code of rank) {
      if (/\d/.test(code)) file += +code;
      else result[FILES[file++] + (8 - i)] = code;
    }
  });
  return result;
}

// Mirrors the server's numbering so Black-first lines read "12… Nf6 13. Bd3".
function lineText(fen, sans) {
  let number = +fen.split(' ')[5];
  const white = fen.split(' ')[1] === 'w';
  return sans.map((san, i) => {
    if ((i % 2 === 0) === white) return `${number}. ${san}`;
    const label = i === 0 ? `${number}… ${san}` : san;
    number++;
    return label;
  }).join(' ');
}
const moveLabel = (ply) => `${game.fens[ply].split(' ')[5]}${game.moveLog[ply].color === 'w' ? '.' : '…'} ${game.moveLog[ply].san}`;

const choiceValue = (id) => $(`#${id} input:checked`)?.value ?? '';
function setChoiceValue(id, value) {
  for (const input of document.querySelectorAll(`#${id} input[type="radio"]`)) input.checked = input.value === String(value);
}
function makeChoice(id, value, name) {
  const label = document.createElement('label'), input = document.createElement('input'), content = document.createElement('span');
  label.className = 'choice-label';
  input.type = 'radio'; input.name = id; input.value = value;
  content.textContent = name;
  label.append(input, content);
  $(`#${id} .choice-row`).append(label);
  return content;
}
function applyPieceSet(key) {
  pieceSetKey = PIECE_SETS.some((set) => set.id === key) ? key : 'cburnett';
  setChoiceValue('pieceSet', pieceSetKey);
  const base = PIECE_SETS.find((set) => set.id === pieceSetKey).base;
  for (const image of document.querySelectorAll('.piece img,#ghost img,#promoChoices img,.player-row img,#reviewPlayers img')) image.src = base + image.getAttribute('src').split('/').pop();
  try { localStorage.setItem('chess.pieceSet', pieceSetKey); } catch (_) {}
  document.dispatchEvent(new Event('chessappearancechange'));
}
function applyTheme(key) {
  themeKey = THEMES[key] ? key : 'classic';
  const theme = THEMES[themeKey], root = document.documentElement;
  for (const [name, value] of Object.entries(theme)) {
    if (typeof value === 'string' && value[0] === '#') root.style.setProperty(`--${name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`, value);
  }
  root.style.colorScheme = theme.lightMode ? 'light' : 'dark';
  root.dataset.scheme = theme.lightMode ? 'light' : 'dark';
  $('meta[name="theme-color"]').content = theme.bg;
  setChoiceValue('theme', themeKey);
  try { localStorage.setItem('chess-theme', themeKey); } catch (_) {}
  document.dispatchEvent(new Event('chessappearancechange'));
}
for (const [key, theme] of Object.entries(THEMES)) {
  const content = makeChoice('theme', key, theme.name), preview = document.createElement('span');
  preview.className = 'theme-preview'; preview.setAttribute('aria-hidden', 'true');
  preview.style.setProperty('--preview-light', theme.light); preview.style.setProperty('--preview-dark', theme.dark);
  for (let i = 0; i < 4; i++) preview.append(document.createElement('i'));
  content.prepend(preview);
}
for (const set of PIECE_SETS) {
  const content = makeChoice('pieceSet', set.id, set.name), preview = document.createElement('span');
  preview.className = 'piece-preview'; preview.setAttribute('aria-hidden', 'true');
  for (const piece of ['wN', 'bQ']) {
    const image = document.createElement('img'); image.src = `${set.base}${piece}.svg`; image.alt = ''; preview.append(image);
  }
  content.prepend(preview);
}
setChoiceValue('pieceSet', pieceSetKey);
try { applyTheme(localStorage.getItem('chess-theme') || 'classic'); } catch (_) { applyTheme('classic'); }
applyPieceSet(pieceSetKey);

function buildSquares() {
  $('#squares').replaceChildren();
  for (let r = 0; r < 8; r++) {
    const rank = document.createElement('div');
    rank.className = 'board-row';
    rank.setAttribute('role', 'row');
    for (let c = 0; c < 8; c++) {
      const file = flipped ? FILES[7 - c] : FILES[c];
      const n = flipped ? r + 1 : 8 - r;
      const square = document.createElement('button');
      square.type = 'button';
      square.className = `square ${(FILES.indexOf(file) + n) % 2 ? 'dark' : 'light'}`;
      square.dataset.square = file + n;
      square.setAttribute('role', 'gridcell');
      square.tabIndex = -1;
      if (r === 7) square.innerHTML += `<span class="coord file" aria-hidden="true">${file}</span>`;
      if (c === 0) square.innerHTML += `<span class="coord rank" aria-hidden="true">${n}</span>`;
      rank.append(square);
    }
    $('#squares').append(rank);
  }
}

function place(el, sq, instant = false) {
  if (!el) return;
  el.style.transition = instant ? 'none' : '';
  el.style.visibility = '';
  el.style.transform = `translate(${col(sq) * 100}%,${row(sq) * 100}%)`;
}

function syncBoard(fen, instant = false) {
  const position = parseBoard(fen);
  const available = new Set(pieces.values());
  const next = new Map();
  for (const [sq, code] of Object.entries(position)) {
    const existing = pieces.get(sq);
    if (existing?.dataset.code === code) { next.set(sq, existing); available.delete(existing); }
  }
  for (const [sq, code] of Object.entries(position)) {
    if (next.has(sq)) continue;
    let el = [...available].find((candidate) => candidate.dataset.code === code);
    if (el) available.delete(el);
    else {
      el = document.createElement('div');
      el.className = 'piece';
      el.dataset.code = code;
      const image = document.createElement('img');
      image.src = pieceImage(code);
      image.alt = '';
      image.draggable = false;
      el.append(image);
      $('#pieces').append(el);
    }
    next.set(sq, el);
  }
  for (const el of available) el.remove();
  for (const [sq, el] of next) { el.dataset.square = sq; place(el, sq, instant); }
  pieces = next;
  boardFen = fen;
  updateHighlights();
}

// Legal moves come from the server: game.legalMoves for the latest position, /api/analyze for history.
function movesFrom(sq) {
  const legal = legalByFen.get(currentFen());
  return legal ? legal.filter((m) => m.from === sq) : null;
}
function targetsFor(sq) {
  return new Set((movesFrom(sq) || []).flatMap((m) => m.kingTo && m.kingTo !== sq ? [m.to, m.kingTo] : [m.to]));
}
// Returns null when legality is unknown, so the server decides.
function matchMoves(from, to) {
  const moves = movesFrom(from);
  if (!moves) return null;
  const direct = moves.filter((m) => m.to === to);
  return direct.length ? direct : moves.filter((m) => m.kingTo === to);
}
function mover() {
  if (!game || busy || promoting) return null;
  const turn = currentFen().split(' ')[1];
  if (retry && viewIndex === retry.ply) return retry.fen ? null : turn;
  // A clock flag ends the game exactly like the server's own result does (the server never learns of it).
  if (viewIndex === game.moveLog.length && (game.over || clockFlagged())) return null;
  if (botLocked(turn)) return null;
  return turn;
}

function updateHighlights() {
  if (!game) return;
  const position = parseBoard(currentFen()), move = retry?.fen ? retry.move : game.moveLog[viewIndex - 1], side = mover();
  const targets = selected ? targetsFor(selected) : new Set();
  // Scope to the game board's own squares: the puzzle workspace reuses the .square class, and a
  // global query would rewrite its board with undefined names during every analysis poll.
  for (const square of document.querySelectorAll('#squares .square')) {
    const sq = square.dataset.square, code = position[sq];
    square.classList.toggle('movable', Boolean(code) && colorOf(code) === side);
    square.classList.toggle('sel', sq === selected);
    square.classList.toggle('target', targets.has(sq));
    square.classList.toggle('capture', targets.has(sq) && Boolean(code));
    square.classList.toggle('lastmove', sq === move?.from || sq === move?.to);
    square.classList.toggle('check', viewIndex === game.moveLog.length && game.inCheck && code === (game.turn === 'w' ? 'K' : 'k'));
    square.setAttribute('aria-label', `${sq}${code ? `, ${colorName(colorOf(code))} ${NAMES[code.toLowerCase()]}` : ', empty'}${targets.has(sq) ? ', legal move' : ''}`);
    square.setAttribute('aria-selected', String(sq === selected));
  }
  renderBoardBadge();
}

function renderBoardBadge() {
  const el = $('#boardBadge'), move = game.moveLog[viewIndex - 1], note = game.annotations[viewIndex - 1];
  if (!move || !BADGES[note?.type] || retry) { el.className = 'board-badge hidden'; return; }
  if (el.dataset.type !== note.type) { el.innerHTML = BADGES[note.type].svg; el.dataset.type = note.type; }
  el.className = 'board-badge';
  el.setAttribute('aria-label', `${move.san}: ${note.label}`);
  el.style.left = `${(col(move.to) + 1) * 12.5}%`;
  el.style.top = `${row(move.to) * 12.5}%`;
  const key = `${game.id}:${viewIndex}`;
  if (note.type === 'brilliant' && viewIndex === game.moveLog.length && move.color !== botSide(game.settings) && key !== lastAnimatedBrilliant) {
    lastAnimatedBrilliant = key;
    animateBrilliant(el);
  }
}

function animateBrilliant(element) {
  const icon = element.querySelector('svg');
  if (!icon || matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
  icon.getAnimations().forEach(animation => animation.cancel());
  icon.animate([{ transform: 'scale(.75) rotate(-12deg)' }, { transform: 'scale(1.25) rotate(4deg)', offset: .45 }, { transform: 'scale(1) rotate(0)' }], { duration: 650, easing: 'cubic-bezier(.16,1,.3,1)' });
  element.querySelector('.brilliant-burst')?.remove();
  const burst = document.createElement('span'); burst.className = 'brilliant-burst'; burst.setAttribute('aria-hidden', 'true');
  burst.innerHTML = '<svg viewBox="0 0 100 100"><path d="M50 10v10m0 60v10M10 50h10m60 0h10M22 22l7 7m42 42 7 7M22 78l7-7m42-42 7-7" fill="none" stroke="#0d7a73" stroke-width="3" stroke-linecap="round"/></svg>';
  element.append(burst);
  const animation = burst.animate([{ transform: 'scale(.6) rotate(-8deg)', opacity: 1 }, { transform: 'scale(1.15) rotate(4deg)', opacity: 0 }], { duration: 700, easing: 'ease-out', fill: 'forwards' });
  animation.finished.then(() => burst.remove(), () => burst.remove());
  return true;
}

function select(sq) { selected = sq; updateHighlights(); }

function squareAt(x, y) {
  const rect = board.getBoundingClientRect();
  const c = Math.floor((x - rect.left) * 8 / rect.width), r = Math.floor((y - rect.top) * 8 / rect.height);
  if (c < 0 || c > 7 || r < 0 || r > 7) return null;
  return (flipped ? FILES[7 - c] : FILES[c]) + (flipped ? r + 1 : 8 - r);
}

function cancelGesture() {
  const previous = gesture;
  gesture = null;
  ghost.style.display = 'none';
  board.classList.remove('dragging');
  if (previous?.el) previous.el.style.visibility = '';
  document.querySelectorAll('.dragover').forEach((el) => el.classList.remove('dragover'));
  if (previous && board.hasPointerCapture(previous.id)) board.releasePointerCapture(previous.id);
}

// Illegal drop: start the piece under the pointer and let it slide home. No message.
function snapBack(el, x, y) {
  if (!el) return;
  const rect = board.getBoundingClientRect(), size = rect.width / 8, home = el.style.transform;
  el.style.transition = 'none';
  el.style.transform = `translate(${(x - rect.left - size / 2) / size * 100}%,${(y - rect.top - size / 2) / size * 100}%)`;
  el.getBoundingClientRect();
  el.style.transition = '';
  el.style.transform = home;
}

function tapSquare(sq) {
  if (!game || busy || promoting) return;
  focusedSquare = sq;
  const code = parseBoard(currentFen())[sq], own = Boolean(code) && colorOf(code) === mover();
  if (selected && selected !== sq) {
    const matches = matchMoves(selected, sq);
    if (matches ? matches.length : !own) { const from = selected; select(null); chooseMove(from, sq); return; }
  }
  select(own && selected !== sq ? sq : null);
}

board.addEventListener('pointerdown', (event) => {
  if (!game || busy || promoting || !event.isPrimary || event.button !== 0) return;
  const sq = squareAt(event.clientX, event.clientY);
  if (!sq) return;
  cancelGesture();
  event.preventDefault();
  focusedSquare = sq;
  board.focus({ preventScroll: true });
  const code = parseBoard(currentFen())[sq], own = Boolean(code) && colorOf(code) === mover();
  if (!own || (selected && selected !== sq && matchMoves(selected, sq)?.length)) { tapSquare(sq); return; }
  gesture = { id: event.pointerId, sq, el: pieces.get(sq), x: event.clientX, y: event.clientY, moved: false, code, wasSelected: selected === sq };
  select(sq);
  board.setPointerCapture(event.pointerId);
});
board.addEventListener('pointermove', (event) => {
  if (!gesture || event.pointerId !== gesture.id || !gesture.el) return;
  if (!gesture.moved && Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) < 5) return;
  const size = board.getBoundingClientRect().width / 8;
  if (!gesture.moved) {
    gesture.moved = true;
    gesture.el.style.visibility = 'hidden';
    ghost.style.width = ghost.style.height = `${size}px`;
    ghost.innerHTML = `<img src="${pieceImage(gesture.code)}" alt="">`;
    ghost.style.display = 'grid';
    board.classList.add('dragging');
  }
  ghost.style.left = `${event.clientX - size / 2}px`;
  ghost.style.top = `${event.clientY - size / 2}px`;
  const over = squareAt(event.clientX, event.clientY);
  document.querySelectorAll('.dragover').forEach((el) => el.classList.remove('dragover'));
  if (over) $(`[data-square="${over}"].square`)?.classList.add('dragover');
});
board.addEventListener('pointerup', (event) => {
  if (!gesture || gesture.id !== event.pointerId) return;
  const previous = gesture, to = squareAt(event.clientX, event.clientY);
  cancelGesture();
  if (!previous.moved) { if (previous.wasSelected) select(null); return; }
  const matches = to && to !== previous.sq ? matchMoves(previous.sq, to) : [];
  if (matches && !matches.length) { snapBack(previous.el, event.clientX, event.clientY); return; }
  select(null);
  place(previous.el, matches?.[0].kingTo || to, true);
  chooseMove(previous.sq, to);
});
board.addEventListener('pointercancel', cancelGesture);
board.addEventListener('lostpointercapture', cancelGesture);
window.addEventListener('blur', cancelGesture);
window.addEventListener('resize', cancelGesture);
// A tab hidden for 30 s pauses live analysis only — never a game reply, never the deep review. Coming back (or any
// user action, or a fresh page load's hello) resumes at the board's current position, never the hide-time ply.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    cancelGesture();
    clearTimeout(pauseTimer);
    pauseTimer = setTimeout(() => { pauseSent = true; pausePost({ hidden: true, tab: TAB_ID }); }, 30000);
  } else {
    clearTimeout(pauseTimer);
    if (pauseSent) { pauseSent = false; pausePost({ hidden: false, tab: TAB_ID }); scheduleSweep(); }
  }
});
window.addEventListener('pagehide', () => pausePost({ hidden: false, tab: TAB_ID, bye: true }));
board.addEventListener('click', (event) => {
  if (event.detail === 0) {
    const sq = event.target.closest('.square')?.dataset.square;
    if (sq) tapSquare(sq);
  }
});
board.addEventListener('focusin', (event) => {
  const square = event.target.closest('.square');
  if (square) focusedSquare = square.dataset.square;
});

function promotionFor(code, to) {
  if (!code || code.toLowerCase() !== 'p' || to[1] !== (code === 'P' ? '8' : '1')) return Promise.resolve(undefined);
  promoting = true;
  cancelGesture();
  const dialog = $('#promo'), choices = $('#promoChoices');
  choices.replaceChildren();
  return new Promise((resolve) => {
    let choice = null;
    for (const type of ['q', 'r', 'b', 'n']) {
      const button = document.createElement('button');
      const pieceCode = code === 'P' ? type.toUpperCase() : type;
      button.innerHTML = `<img src="${pieceImage(pieceCode)}" alt=""><span>${NAMES[type][0].toUpperCase() + NAMES[type].slice(1)}</span>`;
      button.addEventListener('click', () => { choice = type; dialog.close(); });
      choices.append(button);
    }
    dialog.addEventListener('close', () => { promoting = false; resolve(choice); }, { once: true });
    dialog.showModal();
    choices.firstElementChild.focus();
  });
}

// A move or undo at a browsed ply replaces the continuation after it — there is no variation tree and no redo, so the
// cost is named and confirmed first (restoreDialog's native confirm pattern). Escape and Keep resolve false.
function confirmDiscard(heading, confirmLabel, discarded, keepPly) {
  const dialog = $('#discardDialog');
  text($('#discardTitle'), heading);
  text($('#discardConfirm'), confirmLabel);
  text($('#discardText'), `This discards the ${discarded} ${discarded === 1 ? 'move' : 'moves'} after position ${keepPly}. There is no redo.`);
  return new Promise((resolve) => {
    let confirmed = false;
    $('#discardCancel').onclick = () => dialog.close();
    $('#discardConfirm').onclick = () => { confirmed = true; dialog.close(); };
    dialog.addEventListener('close', () => resolve(confirmed), { once: true });
    dialog.showModal();
    $('#discardCancel').focus();
  });
}

async function chooseMove(from, to, fixedPromotion) {
  if (busy || promoting || !game) return;
  if (clockFlagged()) return; // no moves for a flagged game, not even a promotion choice
  const fen = currentFen(), revision = game.revision, matches = matchMoves(from, to);
  if (matches && !matches.length) { syncBoard(fen); return; }
  // Off the live position a committed move branches the game and discards the rest of the line; a retry is judged on
  // a scratch position and never changes the game, so it asks nothing.
  if (viewIndex < game.moveLog.length && !(retry && viewIndex === retry.ply)
    && !await confirmDiscard('Start a new line from here?', 'Discard and move', game.moveLog.length - viewIndex, viewIndex)) { syncBoard(fen); return; }
  const promotion = fixedPromotion || await promotionFor(parseBoard(fen)[from], matches?.[0].to || to);
  if (promotion === null || currentFen() !== fen || game.revision !== revision) { syncBoard(currentFen()); return; }
  return submitMove(from, matches?.[0].to || to, promotion, matches?.[0].kingTo);
}

async function api(path, body) {
  const response = await fetch(`/api/${path}`, { method: body === undefined ? 'GET' : 'POST', headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10000) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(data.error || 'The change could not be saved. Try again.'), { code: data.code });
  return data;
}
// Pause pings ride fetch keepalive so the pagehide un-hide still reaches the server while the tab is closing.
const pausePost = (body) => fetch('/api/pause', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), keepalive: true }).catch(() => {});

// ---- five-engine coach view ("Engines" arrow mode) ----
// The Arrows button cycles Off -> Best -> Engines (aria-pressed false/true/mixed). Engines mode asks the server,
// strictly one engine at a time, for each registry engine's first choice at the position on screen
// (POST /api/sweep); answers stream in through the analysis poll and render progressively. Leaving the mode
// stops the server-side sweep.
let sweepTimer = 0;
function setArrowMode(mode) {
  arrowMode = mode;
  $('#coach').setAttribute('aria-pressed', mode === 'off' ? 'false' : mode === 'best' ? 'true' : 'mixed');
}
const stopSweepRemote = () => {
  clearTimeout(sweepTimer);
  if (analysis) analysis.sweep = { phase: 'idle', results: [] };
  return api('sweep', { stop: true }).then(pollAnalysis).catch(() => {});
};
function scheduleSweep() {
  if (document.hidden || arrowMode !== 'engines' || !game || retry || game.computer?.phase === 'thinking') return;
  clearTimeout(sweepTimer);
  sweepTimer = setTimeout(() => {
    if (document.hidden || arrowMode !== 'engines' || !game || retry || game.computer?.phase === 'thinking') return;
    const fen = currentFen(), ply = viewIndex, current = analysis?.sweep;
    // Re-post only when nothing already covers the on-screen position; 'paused' re-posts so an un-hide resumes it.
    if (current && current.fen === fen && current.ply === ply && (current.phase === 'running' || current.phase === 'ready')) return;
    api('sweep', { fen, atPly: ply, revision: game.revision }).then(pollAnalysis).catch(() => {});
  }, 180);
}

// The registry loads once at startup; afterwards the displayed name tracks settings.engineId from every adopted state.
function syncEngineName() {
  const id = game?.settings?.engineId ?? engineRegistry?.defaultId;
  if (engineRegistry) engineName = engineRegistry.engines.find((entry) => entry.id === id)?.name || engineName;
  setChoiceValue('engine', id);
  const note = $('#engineNote');
  if (note) {
    const text = game?.engineNotices?.join(' ') || '';
    note.textContent = text;
    note.classList.toggle('hidden', !text);
  }
}

function fillEngineChoices() {
  if (!engineRegistry) return;
  $('#engine .choice-row').replaceChildren();
  for (const entry of engineRegistry.engines) makeChoice('engine', entry.id, entry.name);
  setChoiceValue('engine', game?.settings?.engineId ?? engineRegistry.defaultId);
}

// Returns true when a new game (or a restored one) arrived.
function adoptGame(next) {
  const fresh = next.id !== game?.id;
  game = next;
  syncEngineName();
  // An older server (still running after an update) sends no deep-review status; never crash on it.
  game.deep ||= { active: false, done: 0, total: Infinity, depth: 20, startedAt: 0 };
  if (fresh) {
    legalByFen.clear(); hints.clear(); revealed.clear(); solved.clear();
    activeMoment = retry = bestShown = null;
    // A fresh engine game starts with arrows off, every other fresh game at best-lines — Engines mode is always
    // re-asked for (its sweeps are paid work), so no game ever starts sweeping on its own.
    setArrowMode(game.settings.mode === 'engine' ? 'off' : 'best');
    if (flipped !== game.settings.flipped) { flipped = game.settings.flipped; buildSquares(); }
    // A fresh game arms the clock chosen in the dialog; any other fresh game (restore/study, first
    // load) arrives with no pending choice, so it simply plays untimed.
    clearInterval(clockTimer);
    clock = pendingClock ? CLOCK.newClock(pendingClock.minutes, pendingClock.incrementSeconds) : null;
    pendingClock = null;
    if (clock) clockTimer = setInterval(clockTick, 100);
  }
  legalByFen.set(game.fens.at(-1), game.legalMoves);
  for (const note of game.annotations) {
    if (!note?.archiveId || seenArchive?.has(note.archiveId)) continue;
    if (seenArchive) { notify('Brilliant move! Saved to your collection.'); refreshCollection(); }
    (seenArchive ||= new Set()).add(note.archiveId);
  }
  seenArchive ||= new Set();
  // Every adopted state reconciles the clock: completed plies bank their Fischer increments, an
  // engine reply that lands while we browse history still switches the running side, a takeback
  // rewinds to its snapshot, and a server game end freezes the count.
  if (clock) clockSyncGame();
  return fresh;
}

// ---- clock wiring (all of it lives in this tab; see clock.js for the math) ----
// The flag is a local game end: true only at the live position, like game.over in mover().
const clockFlagged = () => viewIndex === game.moveLog.length && Boolean(clock?.flagged);

function clockSyncGame() {
  CLOCK.sync(clock, game.moveLog.length, game.moveLog, game.turn, game.over, performance.now());
}

// 100 ms cadence: smooth enough for tenths, cheap enough to leave running while a clock is armed.
// Hidden tabs throttle the interval to ~1 s; the stamp-based math keeps the elapsed count exact.
function clockTick() {
  if (!clock || clock.flagged || !clock.running) return;
  // A flag changes state the fingerprint does not know (the play buttons sit behind its gate), so
  // the one-time rebuild is forced — same as every other rare structural change in this file.
  if (CLOCK.tick(clock, performance.now())) renderPanels(true); // notice, readouts, input lock
  else renderClocks();
}

// The readouts are plain text nodes (like the depth/nps chips) so the tick never rebuilds panels.
function renderClocks() {
  if (!clock) return;
  for (const [id, color] of [['topPlayer', flipped ? 'w' : 'b'], ['bottomPlayer', flipped ? 'b' : 'w']])
    writeClock($(`#${id}`), color);
}

function writeClock(el, color) {
  const read = el.querySelector('.player-clock');
  if (!clock) { read.hidden = true; return; }
  read.hidden = false;
  const ms = clock.ms[color];
  text(read, CLOCK.formatClock(ms));
  const low = !clock.flagged && CLOCK.isLow(ms);
  read.classList.toggle('low', low);
  read.classList.toggle('running', clock.running === color);
  read.classList.toggle('out', clock.flagged === color);
  // Labelled for screen readers; the words carry the low/flag state, and the tenths format switch
  // (clock.js) is the visual cue, so low time never rides on colour alone.
  read.setAttribute('aria-label', `${colorName(color)}'s clock${low ? ', time is low' : ''}${clock.flagged === color ? ', flagged' : ''}`);
}

function setBusy(value) {
  busy = value;
  board.setAttribute('aria-busy', String(value));
  renderControls();
}

async function submitMove(from, to, promotion, kingTo) {
  if (busy || !game) return;
  if (retry && viewIndex === retry.ply) return tryMove(from, to, promotion, kingTo);
  if (clockFlagged()) return; // a flag can land while a promotion dialog was open; the move dies with it
  const atPly = viewIndex, baseFen = currentFen(), revision = game.revision;
  const moving = pieces.get(from), captured = pieces.get(to);
  clearTimeout(analysisTimer);
  setBusy(true);
  select(null);
  place(moving, kingTo || to, moving?.style.transition === 'none');
  if (captured && moving && colorOf(captured.dataset.code) !== colorOf(moving.dataset.code)) captured.style.visibility = 'hidden';
  try {
    adoptGame(await api('move', { from, to, promotion, atPly, baseFen, revision }));
    viewIndex = game.moveLog.length;
    analysis = null;
    syncBoard(currentFen());
    renderPanels(true);
  } catch (error) {
    try { adoptGame(await api('state')); viewIndex = Math.min(atPly, game.moveLog.length); } catch (_) { online = false; }
    syncBoard(currentFen());
    if (error.code !== 'ILLEGAL_MOVE') notify(error.message, true);
  } finally { setBusy(false); pollAnalysis(); }
}

function renderControls() {
  const last = game?.moveLog.length || 0;
  $('#undo').disabled = busy || promoting || viewIndex === 0;
  $('#new').disabled = $('#modeButton').disabled = busy || promoting;
  $('#flip').disabled = busy || promoting;
  $('#reviewGame').disabled = busy || !last || Boolean(game?.deep.active);
  $('#speed').disabled = busy;
  $('#navFirst').disabled = $('#navPrev').disabled = busy || promoting || viewIndex === 0;
  $('#navNext').disabled = $('#navLast').disabled = busy || promoting || viewIndex === last;
  $('#navPos').textContent = `${viewIndex} / ${last}`;
}

function text(el, value) { if (el.textContent !== value) el.textContent = value; }
// Stockfish's pieces are off-limits against Stockfish, and in free play only on the live position while it is playing
// (after a takeback it waits, and history is yours to branch). Mirrors the lock in server.js commitMove.
const botLocked = (turn) => turn === botSide(game.settings)
  && (game.settings.mode === 'engine' || (viewIndex === game.moveLog.length && !game.enginePaused));
// Where /api/undo lands: against Stockfish a takeback walks back to your turn. Mirrors server.js undo (the FEN's
// active colour is rules.status().turn), so the confirmation names the true cost; the posted atPly stays as before.
const undoTarget = () => {
  let target = Math.max(0, viewIndex - 1);
  if (game.settings.mode === 'engine') while (target > 0 && game.fens[target].split(' ')[1] === botSide(game.settings)) target--;
  return target;
};
const botWaiting = () => game.settings.mode === 'free' && game.enginePaused && !game.over && !clock?.flagged
  && viewIndex === game.moveLog.length && game.turn === botSide(game.settings);
// Mirrors eloFor in server.js.
const strengthLabel = (strength) => strength >= 100 ? 'Full strength' : `${Math.round(1320 + (strength - 10) * 18.5)} Elo`;
// The colour Stockfish moves: the opponent in engine mode, or the side handed to it in free play.
const botSide = (s) => s.mode === 'engine' ? (s.humanColor === 'w' ? 'b' : 'w') : s.engineSide || null;
function modeText(s) {
  const variant = s.variant === 'chess960' ? `Chess960 #${s.seed}` : 'Standard';
  if (s.mode === 'engine') return `vs Stockfish ${strengthLabel(s.strength)} · ${variant}`;
  return s.engineSide ? `Free play vs ${s.variety ? 'Stockfish (random top 5)' : 'best Stockfish'} · ${variant}` : `Free play · ${variant}`;
}

function renderPanels(force = false) {
  if (!game) return;
  const fen = currentFen(), turn = fen.split(' ')[1], last = game.moveLog.length, atTail = viewIndex === last;
  const s = game.settings, bot = botSide(s);
  const live = analysis?.fen === fen && (analysis.ply === undefined || analysis.ply === viewIndex) ? analysis : null;
  // The five-engine sweep covering the on-screen position (same fen+ply gate as live analysis).
  const sweepData = analysis?.sweep;
  const sweepLive = sweepData && sweepData.fen === fen && sweepData.ply === viewIndex && sweepData.phase !== 'idle' ? sweepData : null;
  // Shared analysis pauses only while every tracked tab is hidden.
  const paused = Boolean(game.governor?.paused) || live?.phase === 'paused';
  // A retry hides every answer: eval, arrows, best lines and threats.
  const cp = retry ? null : live?.terminalCp ?? live?.lines[0]?.whiteCp ?? game.evalHist[viewIndex] ?? null;
  const score = retry ? '—' : live?.lines[0]?.text || scoreLabel(cp);
  $('#evalFill').style.height = `${cp === null ? 50 : 100 / (1 + Math.exp(-.00368208 * cp))}%`;
  const evalLabel = retry ? 'Hidden during retry' : score === '—' ? 'Not evaluated' : `White ${score}`;
  $('#evalWrap').setAttribute('aria-label', `Evaluation: ${evalLabel}`);
  $('#evalWrap').dataset.empty = String(cp === null);
  $('#evalWrap').classList.toggle('flipped', flipped);
  text($('#evalNum'), evalLabel);
  const check = game.inCheck ? ' · Check' : '';
  text($('#status'), !online ? 'Connection lost. Reconnecting…'
    : retry ? `Retry: find a better move for ${colorName(turn)}.`
    : atTail && clock?.flagged ? `${colorName(clock.flagged)} ran out of time`
    : atTail && game.over ? game.result
    : !atTail ? `Position ${viewIndex} of ${last}. Move a piece to start a new line from here — the ${last - viewIndex} ${last - viewIndex === 1 ? 'move' : 'moves'} after this position will be discarded.`
    : bot && game.computer.phase === 'error' ? `${engineName} could not move. Use Retry engine.`
    : botWaiting() ? `${engineName} is waiting. Move for it, or let it play.`
    : turn === bot ? `${engineName} is thinking…`
    : bot ? `Your move${check}` : `${colorName(turn)} to move${check}`);
  for (const [id, color] of [['topPlayer', flipped ? 'w' : 'b'], ['bottomPlayer', flipped ? 'b' : 'w']]) {
    const el = $(`#${id}`), isEngine = color === bot;
    el.querySelector('img').src = pieceImage(color === 'w' ? 'K' : 'k');
    text(el.querySelector('strong'), bot ? (isEngine ? engineName : 'You') : colorName(color));
    text(el.querySelector('div span'), !isEngine ? `${colorName(color)} pieces` : s.mode === 'engine' ? strengthLabel(s.strength) : (game.survival ? 'Survival mode · full strength' : s.variety ? 'Random top-5 move' : 'Best move · full strength'));
    writeClock(el, color);
    // A flag replaces the turn chip: the flagged side reads "Flagged", the other side reads nothing.
    text(el.querySelector('.player-turn'), atTail && clock?.flagged ? (color === clock.flagged ? 'Flagged' : '')
      : turn !== color || (atTail && game.over) ? '' : isEngine && atTail ? (botWaiting() ? 'Waiting' : 'Thinking…') : 'To move');
  }
  $('#botPlay').classList.toggle('hidden', !botWaiting());
  text($('#modeButton'), modeText(s));
  text($('#modeDescription'), s.mode === 'engine' ? `You play ${colorName(s.humanColor)} against ${engineName} (${strengthLabel(s.strength)}).`
    : bot ? `You play ${colorName(bot === 'w' ? 'b' : 'w')}. ${engineName} plays ${s.variety ? 'one of its top 5 moves, picked at random' : 'its best move'} as soon as its search finishes.` : 'Your board. Both sides. Every possibility.');
  text($('#footerMode'), `${modeText(s)}. ${s.variant === 'chess960' ? 'To castle, move the king onto its rook.' : 'Standard chess rules.'}`);
  renderControls();
  if (game.analysisMs) setChoiceValue('speed', game.analysisMs);
  if (s.powerMode) setChoiceValue('power', s.powerMode);
  if (s.onlineFeatures !== undefined) $('#online').checked = s.onlineFeatures;
  $('#compareEngines').setAttribute('aria-pressed', String(arrowMode === 'engines'));
  updateHighlights();
  drawArrows(retry ? null : live, retry ? null : sweepLive);
  maybeFetchHint(live);
  maybeFetchOnline(); // opt-in answers for the position on screen; a no-op while the switch is off
  // Depth/nps tick every ~200ms while the engine thinks (server merges them into the live analysis), so they
  // ride OUTSIDE the fingerprint in this dedicated textContent-only write: a thinking tick costs two text
  // nodes at most, never the full panel rebuild below.
  text($('#depthChip'), `Depth ${live?.depth || '—'}`);
  text($('#npsChip'), live?.nps ? `${(live.nps / 1e6).toFixed(1)} MN/s` : '— MN/s');
  const hintKey = `${game.revision}:${viewIndex}`;
  // The fingerprint is content identity only — line moves/scores, threats, annotations, history, view and
  // review state. Embedding the live analysis object whole (with its per-tick depth/nps) changed it on every
  // poll and defeated the gate.
  const livePrint = live && [live.fen, live.ply, live.phase, live.terminalCp ?? null, live.error ?? null, live.opening ?? null,
    live.lines.map((line) => [line.uci, line.text, line.pretty, line.san, line.from, line.to, line.displayTo ?? null]),
    live.threats.map((line) => [line.uci, line.text, line.pretty, line.from, line.to, line.displayTo ?? null])];
  // Online answers join by content identity, like every other input, so a finished lookup rebuilds once.
  const onlineState = onlineByFen.get(fen);
  const onlinePrint = onlineState && [
    onlineState.tablebase && [onlineState.tablebase.state, onlineState.tablebase.message ?? null, onlineState.tablebase.data && [
      onlineState.tablebase.data.category, onlineState.tablebase.data.dtz, onlineState.tablebase.data.dtm,
      onlineState.tablebase.data.checkmate, onlineState.tablebase.data.stalemate, onlineState.tablebase.data.insufficientMaterial,
      onlineState.tablebase.data.moves.map((move) => [move.uci, move.san, move.category, move.dtz])]],
    onlineState.cloud && [onlineState.cloud.state, onlineState.cloud.data && [onlineState.cloud.data.depth, onlineState.cloud.data.pvs.map((pv) => [pv.whiteCp, pv.mate, pv.moves])]],
  ];
  // Sweep answers join by content identity too — engineId, move, eval, skip/error, never depth — so a finished
  // sweep rebuilds once while progressive answers rebuild as each engine lands.
  const sweepPrint = sweepLive && [sweepLive.phase, sweepLive.terminal ?? null,
    sweepLive.results.map((r) => [r.engineId, r.uci ?? null, r.text ?? null, r.displayTo ?? null, r.skipped ?? null, r.error ?? null])];
  const fingerprint = JSON.stringify([game.revision, game.annotations, game.evalHist, game.reviewAll, game.deep.active, game.deep.done, game.computer, viewIndex, livePrint, arrowMode, sweepPrint, online, hints.get(hintKey), revealed.has(hintKey), retry, activeMoment, bestShown, bothSides, solved.size, paused, engineName, s.powerMode, s.onlineFeatures, onlinePrint]);
  if (!force && fingerprint === panelFingerprint) return;
  panelFingerprint = fingerprint;
  const thinking = !paused && (!live || ['thinking', 'idle', 'threats'].includes(live.phase));
  const failed = !paused && (live?.phase === 'error' || game.computer.phase === 'error');
  const state = $('#engineState');
  state.className = `engine-state${thinking && online ? ' busy' : ''}${failed || !online ? ' error' : ''}`;
  text(state, !online ? 'Offline' : paused ? 'Paused (tab hidden)' : failed ? 'Engine unavailable' : thinking ? 'Analysing' : 'Analysis ready');
  $('#retryEngine').classList.toggle('hidden', !failed || !online);
  text($('#engineTitle'), engineName);
  text($('#powerChip'), `${engineName} · ${capital(s.powerMode || 'balanced')}`);
  text($('#turnChip'), `${colorName(turn)} to move`);
  text($('#opening'), live?.opening || (atTail ? game.opening : null) || (viewIndex === 0 ? 'Starting position' : 'Explore this position'));
  // The cloud line is a stopgap above the local lines: it shows only while the local search has nothing yet
  // (not ready, no lines) — the same conditions that gate its fetch in maybeFetchOnline — and drops the
  // moment local results arrive. Like the local lines it hides for retries and while offline/paused.
  const cloudSlot = onlineByFen.get(fen)?.cloud;
  const cloud = s.onlineFeatures && online && !paused && !retry && !(live && (live.phase === 'ready' || live.lines.length))
    && cloudSlot?.state === 'done' && cloudSlot.data.pvs[0]?.moves.length ? cloudSlot.data : null;
  const lines = $('#lines');
  const focusedPlay = document.activeElement?.closest('.play')?.dataset.rank;
  lines.replaceChildren();
  if (cloud) lines.append(cloudRow(cloud, fen));
  if (!paused && live?.lines.length && !retry) {
    for (const [i, line] of live.lines.entries()) {
      const el = document.createElement('div');
      el.className = 'line';
      el.innerHTML = `<span class="rank">${i + 1}</span><span class="ev">${evHtml(line.text)}</span><div class="pv"><strong>${line.san}</strong><span title="${line.pretty}">${line.pretty}</span></div><button class="play" data-rank="${i}" aria-label="Play ${line.san}" title="Play ${line.san}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4 20 12 7 20Z"/></svg></button>`;
      const button = el.querySelector('button');
      button.disabled = busy || mover() === null;
      button.onclick = () => chooseMove(line.from, line.to, line.uci[4]);
      el.onmouseenter = () => hotArrow(`suggestion-${i}`, true);
      el.onmouseleave = () => hotArrow(`suggestion-${i}`, false);
      button.onfocus = () => hotArrow(`suggestion-${i}`, true);
      button.onblur = () => hotArrow(`suggestion-${i}`, false);
      lines.append(el);
    }
  } else {
    const p = document.createElement('p');
    p.className = `empty-note${live?.error ? ' error' : ''}`;
    p.textContent = retry ? 'Hidden while you retry. Find the move yourself first.' : !online ? 'Start the local server to reconnect. Your board will refresh automatically.' : paused ? "Paused while this tab was hidden. Analysis resumes at the board's current position when you return." : live?.error || (live?.phase === 'ready' ? 'No continuations in this position.' : 'Finding the best continuations…');
    lines.append(p);
  }
  if (focusedPlay !== undefined) lines.querySelector(`[data-rank="${focusedPlay}"]`)?.focus({ preventScroll: true });
  const threats = $('#threats');
  threats.replaceChildren();
  $('#threatBox').classList.toggle('hidden', !live?.threats.length || Boolean(retry));
  for (const [i, line] of (retry ? [] : live?.threats || []).entries()) {
    const el = document.createElement('div'); el.className = 'threat';
    el.innerHTML = `<span class="rank">${i + 1}</span><span class="ev">${evHtml(line.text)}</span><span class="pv" title="${line.pretty}">${line.pretty}</span>`;
    el.onmouseenter = () => hotArrow(`threat-${i}`, true);
    el.onmouseleave = () => hotArrow(`threat-${i}`, false);
    threats.append(el);
  }
  renderTablebase(fen);
  renderEngineBand(sweepLive);
  renderEngineVotes(sweepLive);
  renderCoach(hintKey);
  renderMoves(); renderGraph(); renderReview();
  // When a game ends the server starts its review; show it once per game.
  if (game.over && game.reviewAll && reviewOpenedFor !== game.id) { reviewOpenedFor = game.id; selectTab($('#tabReview')); }
}

function badgeEl(note) {
  const badge = document.createElement('span');
  badge.className = 'badge';
  badge.innerHTML = BADGES[note.type].svg;
  return badge;
}

function renderCoach(hintKey) {
  const s = game.settings, engineGame = s.mode === 'engine', bot = botSide(s), last = game.moveLog.length;
  const turn = currentFen().split(' ')[1];
  // Against Stockfish the coach talks about your move, not the engine's reply.
  let ply = viewIndex - 1;
  if (bot && game.moveLog[ply]?.engine && game.moveLog[ply - 1]) ply--;
  const move = game.moveLog[ply], note = game.annotations[ply];
  const badge = $('#coachBadge'), continuation = $('#coachContinuation'), saved = $('#savedMove');
  badge.replaceChildren();
  saved.replaceChildren();
  if (!move) {
    // No move under view (ply resolves to -1 only at position 0): an empty game invites the first move; a game with
    // moves is being browsed, and the coach says what moving from here really does.
    if (last) {
      text($('#coachMove'), 'Viewing the start position.');
      text($('#coachText'), `Step through the game with the arrows. Move a piece to start a new line from here — the ${last} ${last === 1 ? 'move' : 'moves'} after this position will be discarded.`);
    } else {
      text($('#coachMove'), 'Make your first move.');
      text($('#coachText'), bot ? `You play ${colorName(bot === 'w' ? 'b' : 'w')}. Select a piece to see where it can go.` :'Select a piece. Its legal moves appear on the board. Move both sides to explore, or start a game against Stockfish.');
    }
  } else {
    text($('#coachMove'), moveLabel(ply));
    text($('#coachText'), note?.explanation || 'This move has not been reviewed.');
  }
  const graded = move && BADGES[note?.type];
  badge.classList.toggle('hidden', !graded);
  if (graded) { badge.style.setProperty('--badge', graded.color); badge.append(badgeEl(note), note.label); }
  const steps = move && note?.type !== 'book' ? note?.continuation || [] : [];
  continuation.classList.toggle('hidden', !steps.length);
  text(continuation, steps.length ? `Expected: ${lineText(game.fens[ply + 1], steps.slice(0, 6).map((step) => step.san))}` : '');
  text($('#coachEvidence'), graded && note.depth ? [`Depth ${note.depth}`, note.whiteCp != null ? `White ${scoreLabel(note.whiteCp)}` : null, note.lossCp > 0 && note.lossCp < 5000 ? `${(note.lossCp / 100).toFixed(1)} pawns below best` : null].filter(Boolean).join(' · ') : '');
  saved.classList.toggle('hidden', note?.type !== 'brilliant');
  if (note?.type === 'brilliant') {
    const label = document.createElement('span'), action = document.createElement('button');
    if (note.archiveError) {
      label.textContent = `Not saved: ${note.archiveError}`;
      action.textContent = 'Retry save';
      action.onclick = () => api('brilliants/retry', { ply }).then(() => { refreshCollection(); pollAnalysis(); }).catch((error) => notify(error.message, true));
    } else {
      label.textContent = note.archiveId ? 'Board image saved to your collection.' : 'Saving board image…';
      action.textContent = 'View collection';
      action.onclick = openGallery;
    }
    saved.append(label, action);
  }
  const hint = hints.get(hintKey), playHint = $('#playHint');
  let title = 'Find your next move', body = 'Your coach is analysing this position.', button = null;
  if (retry) { title = 'Retry in progress'; body = 'Find a better move on the board. Engine help comes back when you leave the retry.'; }
  else if (viewIndex === last && game.over) { title = 'Game over'; body = game.result; }
  else if (botLocked(turn)) { title = 'Stockfish to move'; body = 'Watch the reply, then find your answer.'; }
  else if (hint?.title) {
    if (engineGame && !revealed.has(hintKey)) { body = 'Think it through first. Ask your coach when you need help.'; button = 'Show hint'; }
    else { title = hint.title; body = hint.text; button = 'Play this move'; }
  }
  text($('#hintTitle'), title);
  text($('#hintText'), body);
  playHint.classList.toggle('hidden', button === null && title !== 'Find your next move');
  playHint.disabled = button === null;
  playHint.firstChild.textContent = button || 'Play this move';
  playHint.onclick = () => {
    if (button === 'Show hint') { revealed.add(hintKey); renderPanels(true); return; }
    const uci = hint.continuation[0].uci;
    chooseMove(uci.slice(0, 2), uci.slice(2, 4), uci[4]);
  };
}

function maybeFetchHint(live) {
  const key = `${game.revision}:${viewIndex}`;
  if (hints.has(key) || !live?.lines.length) return;
  hints.set(key, { loading: true });
  api(`hint?ply=${viewIndex}`).then((hint) => hints.set(key, hint)).catch(() => hints.delete(key)).finally(() => renderPanels());
}

// Online layer, client half. LOCAL-FIRST: nothing is requested while the Online switch is off — the check
// here mirrors the server's own refusal — and only ever for the position on screen, which the server
// re-verifies against the current game, so the app cannot become an open proxy. Answers are remembered per
// FEN; a transient failure (network, upstream) is retried after a pause, while "no lichess answer" is a
// fact about the position and is never retried.
const ONLINE_RETRY_MS = 15000;
function maybeFetchOnline() {
  if (!game?.settings?.onlineFeatures || !online) return;
  const fen = currentFen();
  const live = analysis?.fen === fen && (analysis.ply === undefined || analysis.ply === viewIndex) ? analysis : null;
  let entry = onlineByFen.get(fen);
  if (!entry) { entry = { tablebase: null, cloud: null }; onlineByFen.set(fen, entry); }
  const stale = (slot) => slot?.state === 'error' && slot.retry && Date.now() - slot.errorAt > ONLINE_RETRY_MS;
  const ask = (kind, run) => {
    entry[kind] = { state: 'loading' };
    run().then((data) => { entry[kind] = { state: 'done', data }; })
      .catch((error) => { entry[kind] = { state: 'error', message: error.message, errorAt: Date.now(), retry: error.code !== 'NO_UPSTREAM_ANSWER' }; })
      .finally(() => renderPanels());
  };
  // Exact endgame facts are worth an ask for every <= 7-piece position on screen (pieceCount mirrors the server's gate).
  if (pieceCount(fen) <= 7 && (!entry.tablebase || stale(entry.tablebase))) ask('tablebase', () => api('online/tablebase', { fen }));
  // The cloud line only bridges the gap before local lines exist, so once they exist it is not worth an ask.
  if (!(live && (live.phase === 'ready' || live.lines.length)) && (!entry.cloud || stale(entry.cloud))) ask('cloud', () => api('online/cloud-eval', { fen }));
}

// UCI -> SAN for a cloud line's first move. The panel speaks SAN and the position's own legal-move list is
// already in hand: piece type from the board, disambiguation from the other legal moves reaching the same
// square, castling from the move itself. Check/mate marks would need full rules, so the label runs without
// them for the second or two before the local lines take over.
function cloudSan(fen, uci) {
  const legal = legalByFen.get(fen) || [];
  const move = legal.find((m) => m.uci === uci);
  if (!move) return uci;
  if (move.castle) return move.castle === 'k' ? 'O-O' : 'O-O-O';
  const board = parseBoard(fen), piece = board[move.from];
  if (piece.toLowerCase() === 'p')
    return `${move.from[0] !== move.to[0] ? `${move.from[0]}x` : ''}${move.to}${move.promotion ? `=${move.promotion.toUpperCase()}` : ''}`;
  const rivals = legal.filter((m) => m.to === move.to && m.from !== move.from && board[m.from] === piece);
  const disambig = !rivals.length ? '' : !rivals.some((m) => m.from[0] === move.from[0]) ? move.from[0]
    : !rivals.some((m) => m.from[1] === move.from[1]) ? move.from[1] : move.from;
  return `${piece.toUpperCase()}${disambig}${board[move.to] ? 'x' : ''}${move.to}`;
}

// The cloud line: a local line's anatomy (score column, first move, play control) with a cloud glyph and a
// source note in place of the local pretty continuation, which the UCI-only cloud answer cannot provide.
function cloudRow(data, fen) {
  const pv = data.pvs[0], uci = pv.moves[0];
  const score = pv.mate != null ? `${pv.mate < 0 ? '-' : ''}M${Math.abs(pv.mate)}` : pv.whiteCp == null ? '—' : `${pv.whiteCp > 0 ? '+' : ''}${(pv.whiteCp / 100).toFixed(2)}`;
  const row = document.createElement('div');
  row.className = 'line cloud';
  row.title = 'lichess cloud evaluation';
  row.innerHTML = `<span class="rank"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96z"/></svg></span><span class="ev">${evHtml(score)}</span><div class="pv"><strong>${cloudSan(fen, uci)}</strong><span>Cloud eval · depth ${data.depth ?? '—'} · lichess</span></div>`;
  if ((legalByFen.get(fen) || []).some((move) => move.uci === uci)) {
    const play = document.createElement('button');
    play.className = 'play';
    play.setAttribute('aria-label', `Play ${uci}`);
    play.title = `Play ${uci}`;
    play.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4 20 12 7 20Z"/></svg>';
    play.disabled = busy || mover() === null;
    play.onclick = () => chooseMove(uci.slice(0, 2), uci.slice(2, 4), uci[4]);
    row.append(play);
  }
  return row;
}

// Tablebase categories are lichess's, from the side to move; moves carry the category of the position AFTER
// them (opponent to move), so both directions need the mirror map. Words follow lichess's own UI.
const TB_INVERT = { win: 'loss', loss: 'win', draw: 'draw', 'maybe-win': 'maybe-loss', 'maybe-loss': 'maybe-win', 'cursed-win': 'blessed-loss', 'blessed-loss': 'cursed-win' };
const TB_WORDS = { win: 'Win', 'maybe-win': 'Maybe win', 'cursed-win': 'Cursed win', draw: 'Draw', 'blessed-loss': 'Blessed loss', 'maybe-loss': 'Maybe loss', loss: 'Loss' };

function tbNote(message, error = false) {
  const note = document.createElement('p');
  note.className = `tb-hint${error ? ' error' : ''}`;
  note.textContent = message;
  return note;
}
function tablebaseNodes(data, fen) {
  const white = fen.split(' ')[1] === 'w';
  const fromWhite = (category) => white ? category : TB_INVERT[category] || category;
  const outcome = data.wdl == null ? null : white ? data.wdl : -data.wdl;
  const label = data.checkmate ? 'Checkmate' : data.stalemate ? 'Stalemate' : data.insufficientMaterial ? 'Draw · insufficient material'
    : outcome === 0 ? 'Draw' : outcome == null ? 'Unknown' : outcome > 0 ? 'White wins' : 'Black wins';
  // maybe/cursed/blessed stay one-sided but carry a rule nuance; the raw term keeps the verdict one line.
  const nuance = ['maybe-win', 'maybe-loss', 'cursed-win', 'blessed-loss'].includes(fromWhite(data.category)) ? ` · ${fromWhite(data.category)}` : '';
  const facts = [data.dtz != null ? `DTZ ${data.dtz}` : null, data.dtm != null ? `DTM ${data.dtm}` : null].filter(Boolean).join(' · ');
  const verdict = document.createElement('p');
  verdict.className = 'tb-verdict';
  verdict.innerHTML = `${label}${nuance}${facts ? `<span class="tb-facts"> · ${facts}</span>` : ''}`;
  const moves = document.createElement('div');
  moves.className = 'tb-moves';
  for (const move of data.moves) {
    const wdl = move.wdl == null ? null : -move.wdl; // mover's outcome: the entry's wdl is the opponent's
    const category = TB_INVERT[move.category] || move.category;
    const row = document.createElement('div');
    row.className = `tb-move${wdl > 0 ? ' win' : wdl < 0 ? ' loss' : ' draw'}`;
    row.innerHTML = `<strong>${move.san}</strong><span class="tb-cat">${TB_WORDS[category] || (wdl > 0 ? 'Win' : wdl < 0 ? 'Loss' : 'Draw')}</span><span class="tb-dtz">${move.dtz != null ? `DTZ ${move.dtz}` : ''}</span>`;
    moves.append(row);
  }
  return [verdict, moves];
}
// The tablebase block exists only for <= 7-piece positions; a retry hides it with every other engine answer
// (its best moves are answers too). With Online off it shrinks to the one-line opt-in hint.
function renderTablebase(fen) {
  const box = $('#tablebaseBox');
  if (pieceCount(fen) > 7 || retry) { box.classList.add('hidden'); return; }
  box.classList.remove('hidden');
  const body = $('#tablebaseBody'), title = $('#tablebaseTitle');
  if (!game.settings.onlineFeatures) {
    title.classList.add('hidden');
    const hint = document.createElement('p');
    hint.className = 'tb-hint';
    const turnOn = document.createElement('button');
    turnOn.className = 'text-action';
    turnOn.textContent = 'Turn Online on';
    turnOn.onclick = () => setOnline(true);
    hint.append('Perfect endgame information exists for this position — ', turnOn);
    body.replaceChildren(hint);
    return;
  }
  title.classList.remove('hidden');
  const slot = onlineByFen.get(fen)?.tablebase;
  if (!slot || slot.state === 'loading') return body.replaceChildren(tbNote('Checking lichess tablebase…'));
  if (slot.state === 'error') return body.replaceChildren(tbNote(slot.message, true));
  body.replaceChildren(...tablebaseNodes(slot.data, fen));
}

// Narrow, translucent annotations keep the pieces readable; colour identifies the engine across themes.
// Widths are half-widths in an 800-unit board. The panel repeats every suggestion as accessible text.
const ENGINE_PALETTE = [
  { hue: '#1467c8' }, // slot 1 · Stockfish — blue
  { hue: '#e68f00' }, // slot 2 · Berserk — amber (chessground yellow)
  { hue: '#9333ea' }, // slot 3 · Obsidian — purple
  { hue: '#d6218f' }, // slot 4 · PlentyChess — pink (chessground pink family)
  { hue: '#15781b' }, // slot 5 · Viridithas — green (chessground green)
];
const ARROWS = {
  best: { color: '#15781b', opacities: [0.6, 0.36, 0.22], widths: [12, 9, 7] },
  threat: { color: '#882020', opacities: [0.4, 0.26], widths: [7, 5] },
  engine: { opacity: 0.38, width: 12 },
};
// Head length stays distinct from shaft width, including short one-square moves.
function arrowPoints(from, to, width, proj) {
  const [x, y] = proj(from), [tx, ty] = proj(to);
  const dx = tx - x, dy = ty - y, length = Math.hypot(dx, dy);
  if (!length) return null;
  const ux = dx / length, uy = dy / length, px = -uy, py = ux;
  const head = width * 2, start = Math.min(28, length * 0.25), tip = Math.min(length * 0.45, Math.max(24, width * 3.4));
  const sx = x + ux * start, sy = y + uy * start, ex = x + dx - ux * tip, ey = y + dy - uy * tip;
  return [[sx + px * width, sy + py * width], [ex + px * width, ey + py * width], [ex + px * head, ey + py * head], [x + dx, y + dy], [ex - px * head, ey - py * head], [ex - px * width, ey - py * width], [sx - px * width, sy - py * width]];
}
const PROJECT = (sq) => [col(sq) * 100 + 50, row(sq) * 100 + 50];
// The five-engine overlay planner, pure so test/ui-contrast.test.js can exercise it headlessly (like BADGES):
// groups engines that agree on the same move, spaces the group perpendicular to the arrow (biased toward the
// board centre, where the room is), and clamps the spacing so no translated point can leave the 0..800 viewBox.
// The palette and style are passed in, keeping the block self-contained for extraction.
const ENGINE_ARROWS = (() => {
  const CENTRE = 400;
  const plan = (results, proj, palette, style) => {
    const groups = new Map();
    results.forEach((r, slot) => {
      if (!r.uci || r.skipped || r.error) return;
      const to = r.displayTo && r.displayTo !== r.from ? r.displayTo : r.to;
      const key = `${r.from}>${to}`;
      const list = groups.get(key) || [];
      list.push({ slot, engineId: r.engineId, from: r.from, to });
      groups.set(key, list);
    });
    const out = [];
    for (const list of groups.values()) {
      const { from, to } = list[0];
      const [x0, y0] = proj(from), [x1, y1] = proj(to);
      let px = -(y1 - y0), py = x1 - x0;
      const norm = Math.hypot(px, py) || 1; px /= norm; py /= norm;
      // Bias the offset direction toward the board centre (the roomy side).
      if ((CENTRE - (x0 + x1) / 2) * px + (CENTRE - (y0 + y1) / 2) * py < 0) { px = -px; py = -py; }
      const half = (list.length - 1) / 2;
      const width = Math.min(style.width, 18 / list.length), STEP = width * 4 + 4;
      let step = 0;
      if (half) {
        // Clamp the full arrowhead, not just the shaft, inside the board.
        const box = arrowPoints(from, to, width, proj);
        const xs = box.map((p) => p[0]), ys = box.map((p) => p[1]);
        const room = (dx, dy) => {
          let best = Infinity;
          if (dx > 1e-9) best = Math.min(best, (800 - Math.max(...xs)) / dx); else if (dx < -1e-9) best = Math.min(best, -Math.min(...xs) / dx);
          if (dy > 1e-9) best = Math.min(best, (800 - Math.max(...ys)) / dy); else if (dy < -1e-9) best = Math.min(best, -Math.min(...ys) / dy);
          return best;
        };
        step = Math.max(0, Math.min(STEP, room(px, py) / half, room(-px, -py) / half));
      }
      list.forEach((member, k) => {
        const points = arrowPoints(member.from, member.to, width, proj);
        if (!points) return;
        const off = (k - half) * step;
        out.push({ id: `engine-${member.engineId}`, fill: palette[member.slot % palette.length].hue, opacity: style.opacity, points: points.map(([X, Y]) => [X + px * off, Y + py * off]) });
      });
    }
    return out;
  };
  return { plan };
})();
function arrow(from, to, color, opacity, id, width = 12) {
  const points = arrowPoints(from, to, width, PROJECT);
  if (!points) return '';
  return `<polygon id="${id}" points="${points.map((p) => p.join(',')).join(' ')}" fill="${color}" opacity="${opacity}"/>`;
}
let renderedArrows = '';
function drawArrows(live, sweepLive) {
  let content = '';
  if (arrowMode === 'engines' && sweepLive) {
    // One arrow per engine's first choice in that engine's colour; agreement shows as parallel arrows, never
    // a merge — each answer stays traceable to its colour band chip and legend row.
    content = ENGINE_ARROWS.plan(sweepLive.results, PROJECT, ENGINE_PALETTE, ARROWS.engine)
      .map(({ id, fill, opacity, points }) => `<polygon id="${id}" points="${points.map((p) => p.join(',')).join(' ')}" fill="${fill}" opacity="${opacity}"/>`)
      .join('');
  } else if (arrowMode === 'best' && live) {
    live.threats.slice(0, 2).forEach((line, i) => { content += arrow(line.from, line.displayTo === line.from ? line.to : line.displayTo || line.to, ARROWS.threat.color, ARROWS.threat.opacities[i], `threat-${i}`, ARROWS.threat.widths[i]); });
    // Paint rank 1 last so weaker alternatives cannot cover it.
    content += live.lines.slice(0, 3).map((line, i) => arrow(line.from, line.displayTo === line.from ? line.to : line.displayTo || line.to, ARROWS.best.color, ARROWS.best.opacities[i], `suggestion-${i}`, ARROWS.best.widths[i])).reverse().join('');
  }
  if (renderedArrows !== content) { $('#arrows').innerHTML = content; renderedArrows = content; }
}
function hotArrow(id, on) { document.getElementById(id)?.classList.toggle('hot', on); }

// The on-board colour band: one chip per engine under the board, always visible in Engines mode, so an
// arrow's colour is identified ON the board — the chip's square is the exact arrow fill and the number is
// that engine's eval (… while it thinks, — when it cannot answer).
function renderEngineBand(sweepLive) {
  const band = $('#engineBand');
  const show = arrowMode === 'engines';
  band.classList.toggle('hidden', !show);
  if (!show) return;
  const rows = sweepLive?.results ?? (engineRegistry?.engines ?? []).map((entry) => ({ engineId: entry.id, name: entry.name }));
  band.replaceChildren(...rows.map((r, slot) => {
    const chip = document.createElement('span');
    const color = ENGINE_PALETTE[slot % ENGINE_PALETTE.length].hue;
    const detail = r.error ? '✕' : r.skipped ? '—' : r.uci ? r.text : '…';
    chip.className = 'band-chip' + ((r.skipped || r.error) && !r.uci ? ' dim' : '');
    chip.innerHTML = `<i style="background:${color}"></i>${r.name.split(' ')[0]}<b>${detail}</b>`;
    return chip;
  }));
}
// The Engines-mode legend: one row per registry engine — swatch in its arrow colour, SAN, eval, depth — plus
// skipped (no Chess960 / game over), errored and pending rows, a running count, and the paused note. Rows are
// buttons so hover/focus highlights that engine's arrow on the board.
function renderEngineVotes(sweepLive) {
  const box = $('#engineVotes');
  const show = arrowMode === 'engines' && !retry && sweepLive;
  box.classList.toggle('hidden', !show);
  if (!show) return;
  const rows = $('#engineVoteRows');
  rows.replaceChildren();
  sweepLive.results.forEach((r, slot) => {
    const el = document.createElement('button');
    const detail = r.error ? r.error : r.skipped ? (r.skipped === 'chess960' ? 'no Chess960' : r.skipped)
      : r.uci ? `${r.san} · ${r.text}${r.depth ? ` · d${r.depth}` : ''}` : '…';
    el.className = 'engine-vote' + ((r.skipped || !r.uci) && !r.error ? ' dim' : '');
    el.innerHTML = `<span class="swatch" style="background:${ENGINE_PALETTE[slot % ENGINE_PALETTE.length].hue}"></span><strong>${r.name}</strong><span class="vote-detail">${detail}</span>`;
    el.setAttribute('aria-label', `${r.name}: ${detail}`);
    el.onmouseenter = () => hotArrow(`engine-${r.engineId}`, true);
    el.onmouseleave = () => hotArrow(`engine-${r.engineId}`, false);
    el.onfocus = () => hotArrow(`engine-${r.engineId}`, true);
    el.onblur = () => hotArrow(`engine-${r.engineId}`, false);
    rows.append(el);
  });
  const done = sweepLive.results.filter((r) => r.uci || r.error || r.skipped).length;
  text($('#engineVotesNote'), sweepLive.terminal ? 'Game over — no moves to suggest.'
    : sweepLive.phase === 'paused' ? 'Paused while this tab was hidden.'
    : sweepLive.phase === 'running' ? `${done} of ${sweepLive.results.length} engines answered…`
    : 'Each engine asked for 300 ms, one at a time. Colours match the band under the board.');
}

// The move sheet is append-mostly, so it renders incrementally: while the logged plies still extend what is
// on screen (same order and san), rows are reused, only new plies are appended, and per-ply state (current
// marker, badge, disabled) is diffed in place. A history rewrite — undo, branch, restore, new game — fails
// the prefix check and rebuilds once. Auto-scroll measures everything BEFORE its single scrollTop write; the
// old pass wrote scroll and then read offsetTop, forcing a synchronous layout on every render.
function moveButton(ply) {
  const button = document.createElement('button');
  button.className = 'mv';
  button.dataset.ply = ply + 1;
  button.dataset.san = game.moveLog[ply].san;
  button.textContent = game.moveLog[ply].san;
  button.onclick = () => setView(ply + 1);
  return button;
}
function appendPly(ply) {
  const move = game.moveLog[ply], number = +game.fens[ply].split(' ')[5];
  const ol = $('#moves'), li = ol.lastElementChild;
  // Same grouping as a from-scratch build: a black move fills its number's waiting slot; any other ply opens
  // a numbered row, with an empty slot keeping the three-column grid aligned.
  const slot = move.color === 'b' && li?.dataset.number === String(number) ? li.lastElementChild : null;
  if (slot?.tagName === 'SPAN') { slot.replaceWith(moveButton(ply)); return; }
  const row = document.createElement('li');
  row.dataset.number = number;
  row.innerHTML = `<span class="n">${number}.</span>`;
  row.append(moveButton(ply));
  if (move.color === 'w') row.append(document.createElement('span'));
  ol.append(row);
}
function dressMove(ply, button) {
  const move = game.moveLog[ply], note = game.annotations[ply];
  const cur = viewIndex === ply + 1;
  button.classList.toggle('cur', cur);
  if (cur) button.setAttribute('aria-current', 'step'); else button.removeAttribute('aria-current');
  button.disabled = busy;
  const label = `Position ${ply + 1}: ${move.san}${note ? `, ${note.label}` : ''}`;
  if (button.getAttribute('aria-label') !== label) button.setAttribute('aria-label', label);
  // The grade arrives asynchronously (pending → badge), so it is diffed like everything else.
  const type = BADGES[note?.type] ? note.type : '';
  if (button.dataset.badge !== type) {
    button.dataset.badge = type;
    button.replaceChildren(...(type ? [badgeEl(note)] : []), document.createTextNode(move.san));
  }
}
function renderMoves() {
  const ol = $('#moves');
  const focusedPly = document.activeElement?.closest('.mv')?.dataset.ply;
  $('#movesEmpty').classList.toggle('hidden', game.moveLog.length > 0);
  text($('#moveCount'), game.moveLog.length ? `${game.moveLog.length} ${game.moveLog.length === 1 ? 'ply' : 'plies'}` : 'No moves yet');
  const shown = [...ol.querySelectorAll('.mv')];
  const reusable = shown.length <= game.moveLog.length
    && shown.every((button, i) => +button.dataset.ply === i + 1 && button.dataset.san === game.moveLog[i].san);
  let restore = null;
  if (reusable) for (let ply = shown.length; ply < game.moveLog.length; ply++) appendPly(ply);
  else {
    restore = ol.scrollTop; // captured before the rewrite; applied (browser-clamped) in the single write below
    ol.replaceChildren();
    for (let ply = 0; ply < game.moveLog.length; ply++) appendPly(ply);
  }
  for (const button of ol.querySelectorAll('.mv')) dressMove(+button.dataset.ply - 1, button);
  // One measuring pass, then at most one write — never a layout read after the scroll write. A rebuilt sheet
  // restores its scroll; a current move outside the visible band is re-centred, as before.
  const base = restore === null ? ol.scrollTop : Math.max(0, Math.min(restore, ol.scrollHeight - ol.clientHeight));
  const current = ol.querySelector('.mv.cur');
  let target = base;
  if (current) {
    const top = current.offsetTop - ol.offsetTop;
    if (top < base || top + current.offsetHeight > base + ol.clientHeight) target = top - ol.clientHeight / 2;
  }
  if (restore !== null || target !== base) ol.scrollTop = target;
  if (focusedPly) ol.querySelector(`[data-ply="${focusedPly}"]`)?.focus({ preventScroll: true });
}

function renderGraph() {
  const history = retry ? [] : game.evalHist, total = Math.max(1, game.moveLog.length);
  const { width, height } = graphSize, middle = height / 2, left = 24, span = width - 30;
  const y = (cp) => middle - Math.max(-1, Math.min(1, cp / 500)) * Math.max(0, middle - 7);
  const points = history.map((cp, i) => cp == null ? null : { x: left + i / total * span, y: y(cp), i }).filter(Boolean);
  const segments = [];
  for (const point of points) {
    if (!segments.length || segments[segments.length - 1].at(-1).i !== point.i - 1) segments.push([]);
    segments.at(-1).push(point);
  }
  const marker = points.find((p) => p.i === viewIndex);
  const bands = `<rect class="graph-white" x="${left}" width="${span}" height="${middle}"/><rect class="graph-black" x="${left}" y="${middle}" width="${span}" height="${middle}"/>`;
  const scale = [[500, '+5'], [0, '0'], [-500, '−5']].map(([cp, label]) => `<text class="graph-scale" x="0" y="${y(cp)}" dominant-baseline="central">${label}</text>`).join('');
  const areas = segments.filter(segment => segment.length > 1).map(segment => `<polygon class="graph-area" points="${segment[0].x},${middle} ${segment.map(p => `${p.x},${p.y}`).join(' ')} ${segment.at(-1).x},${middle}"/>`).join('');
  const cursor = retry ? '' : `<path class="graph-cursor" d="M${left + viewIndex / total * span} 3V${height - 3}"/>`;
  $('#graph').setAttribute('viewBox', `0 0 ${width} ${height}`);
  $('#graph').innerHTML = bands + areas + `<path class="graph-axis" d="M${left} ${middle}H${width - 6}"/>` + cursor + segments.map((segment) => `<polyline class="graph-line" points="${segment.map((p) => `${p.x},${p.y}`).join(' ')}"/>`).join('') + (marker ? `<circle class="graph-dot" cx="${marker.x}" cy="${marker.y}" r="3"/>` : '') + scale;
  $('#graph').setAttribute('aria-label', retry ? 'Evaluation hidden during retry.' : `White evaluation across ${game.moveLog.length} plies. Current: ${$('#evalNum').textContent}. Display range: -5 to +5 pawns.`);
  text($('#graphEnd'), retry ? 'Hidden during retry' : `${points.length} of ${game.moveLog.length + 1} positions analysed`);
}

// Game review. Accuracy follows lichess's published method (lila WinPercent / AccuracyPercent).
const REVIEW_TYPES = ['brilliant', 'great', 'best', 'excellent', 'good', 'book', 'inaccuracy', 'mistake', 'blunder'];
const GRAPH_TYPES = new Set(['brilliant', 'great', 'inaccuracy', 'mistake', 'blunder']);
const capital = (word) => word[0].toUpperCase() + word.slice(1);
const winPercent = (cp) => 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * Math.max(-1000, Math.min(1000, cp)))) - 1);
const moveAccuracy = (before, after) => after >= before ? 100
  : Math.max(0, Math.min(100, 103.1668100711649 * Math.exp(-0.04354415386753951 * (before - after)) - 3.166924740191411 + 1));
function stdev(xs) {
  const mean = xs.reduce((sum, x) => sum + x, 0) / xs.length;
  return Math.sqrt(xs.reduce((sum, x) => sum + (x - mean) ** 2, 0) / xs.length);
}
// evals: White-POV centipawns for every position 0..N. Returns { w, b } accuracy in percent.
function accuracies(evals, firstMover) {
  const wins = evals.map(winPercent), moves = wins.length - 1;
  const size = Math.max(2, Math.min(8, Math.floor(moves / 10)));
  const windows = [...Array(Math.max(0, size - 2)).fill(wins.slice(0, size)), ...Array.from({ length: Math.max(1, wins.length - size + 1) }, (_, i) => wins.slice(i, i + size))];
  const weights = windows.map((window) => Math.max(.5, Math.min(12, stdev(window))));
  const scored = { w: [], b: [] };
  for (let i = 0; i < moves; i++) {
    const color = (i % 2 === 0) === (firstMover === 'w') ? 'w' : 'b';
    const [before, after] = color === 'w' ? [wins[i], wins[i + 1]] : [100 - wins[i], 100 - wins[i + 1]];
    scored[color].push([moveAccuracy(before, after), weights[i]]);
  }
  const result = {};
  for (const color of ['w', 'b']) {
    const xs = scored[color];
    if (!xs.length) { result[color] = null; continue; }
    const weighted = xs.reduce((sum, [a, w]) => sum + a * w, 0) / xs.reduce((sum, [, w]) => sum + w, 0);
    const harmonic = xs.length / xs.reduce((sum, [a]) => sum + 1 / Math.max(1, a), 0);
    result[color] = (weighted + harmonic) / 2;
  }
  return result;
}

function reviewStatus() {
  const moves = game.moveLog.length, positions = game.fens.length;
  const evaluated = game.evalHist.filter(Number.isFinite).length;
  const graded = game.annotations.filter((note) => note && note.type !== 'pending').length;
  return { moves, done: evaluated + graded, total: positions + moves, complete: game.reviewAll && moves > 0 && evaluated >= positions && graded >= moves };
}

const solvedKey = (ply) => `${game.id}:${ply}`;
const missedMate = (ply) => {
  const sign = game.moveLog[ply].color === 'w' ? 1 : -1;
  return game.evalHist[ply] * sign >= 90000 && game.evalHist[ply + 1] * sign < 90000;
};
// Your own errors can be retried; Stockfish's moves cannot.
const retryable = (ply) => game.moveLog[ply].color !== botSide(game.settings)
  && (['inaccuracy', 'mistake', 'blunder'].includes(game.annotations[ply]?.type) || missedMate(ply));

// Key moments (see .impeccable/research/game-review.md): every mistake, blunder, brilliant, great move and missed
// forced mate; a side with fewer than two gets its worst inaccuracies (up to three); at most eight per side,
// keeping blunders, then brilliants, then the biggest losses. The last book move opens the list.
function keyMoments() {
  const notes = game.annotations, bot = botSide(game.settings), moments = [];
  const loss = (ply) => notes[ply]?.lossPoints || 0;
  for (const color of bot && !bothSides ? [bot === 'w' ? 'b' : 'w'] : ['w', 'b']) {
    const plies = game.moveLog.flatMap((move, ply) => move.color === color ? [ply] : []);
    const own = plies.filter((ply) => ['mistake', 'blunder', 'brilliant', 'great'].includes(notes[ply]?.type) || missedMate(ply));
    if (own.length < 2) own.push(...plies.filter((ply) => notes[ply]?.type === 'inaccuracy' && !own.includes(ply)).sort((a, b) => loss(b) - loss(a)).slice(0, 3));
    const rank = (ply) => notes[ply].type === 'blunder' ? 0 : notes[ply].type === 'brilliant' ? 1 : 2;
    moments.push(...own.sort((a, b) => rank(a) - rank(b) || loss(b) - loss(a)).slice(0, 8));
  }
  moments.sort((a, b) => a - b);
  const lastBook = notes.findLastIndex((note) => note?.type === 'book');
  return lastBook >= 0 ? [lastBook, ...moments] : moments;
}

function goToMoment(ply) {
  activeMoment = ply; bestShown = null; retry = null;
  setView(ply + 1);
  renderPanels(true);
}
function startRetry(ply) {
  activeMoment = ply; bestShown = null;
  setView(ply);
  retry = { ply, message: `Find a better move for ${colorName(game.moveLog[ply].color)}. Engine help is hidden.` };
  renderPanels(true);
}
// Shows the position before the move with the engine's arrow and line. It never changes the game.
function showBest(ply) {
  activeMoment = ply; retry = null; bestShown = ply;
  // "Show best" always speaks the classic language: the rank-1 best-line arrow (theme.arrowMove), so the mode
  // lands on Best from anywhere — its tint belongs to that ladder, not the five-engine palette.
  if (arrowMode === 'engines') stopSweepRemote();
  setArrowMode('best');
  setView(ply);
  renderPanels(true);
}

// A retry move is judged by the server on a scratch position; the game itself never changes.
async function tryMove(from, to, promotion, kingTo) {
  const { ply } = retry, played = game.moveLog[ply];
  if (`${from}${to}${promotion || ''}` === played.uci) {
    retry = { ply, message: `${played.san} is the move from the game. Find a different one.` };
    syncBoard(currentFen()); renderPanels(true);
    return;
  }
  const moving = pieces.get(from), captured = pieces.get(to);
  setBusy(true); select(null);
  place(moving, kingTo || to, moving?.style.transition === 'none');
  if (captured && moving && colorOf(captured.dataset.code) !== colorOf(moving.dataset.code)) captured.style.visibility = 'hidden';
  try {
    const result = await api('try', { ply, from, to, promotion });
    if (retry?.ply !== ply) return;
    const best = result.uci === result.bestUci;
    if (result.success) solved.add(solvedKey(ply));
    retry = { ply, fen: result.fen, move: { from, to: kingTo || to }, solved: result.success, message: result.success
      ? (best ? `${result.san} is the best move.` : `${result.san} works too: it stays within 5% of the best move, ${result.bestSan}.`)
      : `${result.san} gives away ${Math.max(1, Math.round(result.lossPoints * 100))}% of your winning chances.` };
    syncBoard(result.fen);
  } catch (error) {
    syncBoard(currentFen());
    if (error.code !== 'ILLEGAL_MOVE') notify(error.message, true);
  } finally { setBusy(false); renderPanels(true); }
}

function renderReview() {
  const status = reviewStatus(), bot = botSide(game.settings), deep = game.deep;
  const percent = Math.round(deep.active ? deep.done / Math.max(1, deep.total) * 100 : status.done / Math.max(1, status.total) * 100);
  const progress = deep.active || (game.reviewAll && !status.complete);
  // Time left comes from the deep review's own pace once a couple of positions are done.
  const left = deep.done >= 2 ? (Date.now() - deep.startedAt) / deep.done * (deep.total - deep.done) : null;
  const eta = left == null ? '' : left < 60000 ? ' · under a minute left' : ` · about ${Math.round(left / 60000)} min left`;
  text($('#reviewState'), !status.moves ? '' : deep.active ? `Depth ${deep.depth} review · ${percent}%${eta}`
    : status.complete ? 'Review ready' : game.reviewAll ? `Reviewing · ${percent}%` : '');
  $('#reviewProgress').classList.toggle('hidden', !progress);
  $('#reviewProgress').setAttribute('aria-valuenow', String(percent));
  $('#reviewBar').style.width = `${percent}%`;
  $('#reviewStart').classList.toggle('hidden', game.reviewAll);
  $('#reviewButton').disabled = !status.moves;
  // A review that ran at normal depth (e.g. the automatic one at game end) can be redone at full depth.
  $('#deepButton').classList.toggle('hidden', deep.active || !status.complete || deep.done >= deep.total);
  $('#reviewBody').classList.toggle('hidden', !status.complete);
  if (!status.complete) return;
  const name = (color) => bot ? (color === bot ? 'Stockfish' : 'You') : colorName(color);
  const depths = game.annotations.map((note) => note?.depth).filter((depth) => depth > 0);
  text($('#reviewSummary'), [game.over ? game.result.replace(' - ', ' · ') : 'Game in progress', `${Math.ceil(status.moves / 2)} moves`,
    `${engineName}${game.deep.done >= game.deep.total ? `, depth ${game.deep.depth}` : depths.length ? `, depth ${Math.min(...depths)}–${Math.max(...depths)}` : ''}`].join(' · '));
  // Whole numbers: local depth-14–18 searches make decimals false precision.
  const accuracy = accuracies(game.evalHist, game.fens[0].split(' ')[1]);
  $('#reviewPlayers').replaceChildren(...['w', 'b'].map((color) => {
    const card = document.createElement('div');
    card.className = 'review-player';
    card.innerHTML = `<span><img src="${pieceImage(color === 'w' ? 'K' : 'k')}" alt="" width="22" height="22">${name(color)}</span><strong>${accuracy[color] == null ? '—' : Math.round(accuracy[color])}</strong><small>Accuracy</small>`;
    return card;
  }));
  renderReviewGraph();
  const graph = $('#reviewGraph');
  const rows = REVIEW_TYPES.map((type) => {
    const row = document.createElement('tr');
    const cell = (color) => {
      const td = document.createElement('td'), plies = game.annotations.flatMap((note, ply) => note?.type === type && game.moveLog[ply].color === color ? [ply] : []);
      if (!plies.length) { td.textContent = '0'; td.className = 'zero'; return td; }
      const button = document.createElement('button');
      button.textContent = String(plies.length);
      button.setAttribute('aria-label', `${name(color)}: ${plies.length} ${type}. Show the next one.`);
      // Each click steps to the next move of this grade for this side, wrapping around (lichess behaviour).
      button.onclick = () => setView((plies.find((ply) => ply + 1 > viewIndex) ?? plies[0]) + 1);
      td.append(button);
      return td;
    };
    const label = document.createElement('th');
    label.scope = 'row';
    label.append(badgeEl({ type }), capital(type));
    label.style.setProperty('--badge', BADGES[type].color);
    row.append(cell('w'), label, cell('b'));
    row.onmouseenter = row.onfocusin = () => { graph.dataset.focus = type; };
    row.onmouseleave = row.onfocusout = () => { delete graph.dataset.focus; };
    return row;
  });
  $('#reviewTable tbody').replaceChildren(...rows);
  renderKeyMoments(keyMoments());
}

function renderReviewGraph() {
  const wrap = $('#reviewGraph'), svg = wrap.querySelector('svg'), last = game.moveLog.length;
  const x = (ply) => ply / Math.max(1, last) * 300, y = (cp) => 100 - winPercent(cp);
  const points = game.evalHist.map((cp, ply) => `${x(ply)},${y(cp)}`).join(' ');
  svg.innerHTML = `<rect class="review-graph-black" width="300" height="100"/><polygon class="review-graph-white" points="0,100 ${points} 300,100"/><path class="review-graph-mid" d="M0 50H300"/><path class="review-graph-now" d="M${x(viewIndex)} 0V100"/>`;
  wrap.querySelectorAll('.graph-marker').forEach((el) => el.remove());
  game.annotations.forEach((note, ply) => {
    if (!GRAPH_TYPES.has(note?.type)) return;
    const marker = document.createElement('button');
    marker.className = `graph-marker${['inaccuracy', 'great'].includes(note.type) ? ' minor' : ''}`;
    marker.dataset.type = note.type;
    marker.style.left = `${x(ply + 1) / 3}%`;
    marker.style.top = `${y(game.evalHist[ply + 1])}%`;
    marker.style.setProperty('--badge', BADGES[note.type].color);
    marker.setAttribute('aria-label', `${moveLabel(ply)}, ${note.label}`);
    marker.onclick = () => setView(ply + 1);
    marker.onmouseenter = () => showTip(ply + 1);
    wrap.append(marker);
  });
  // Click or drag anywhere selects the nearest ply; hovering shows the move and the evaluation change.
  const plyAt = (event) => { const rect = wrap.getBoundingClientRect(); return Math.max(0, Math.min(last, Math.round((event.clientX - rect.left) / rect.width * last))); };
  wrap.onpointerdown = (event) => {
    if (event.target.closest('.graph-marker')) return;
    wrap.setPointerCapture(event.pointerId);
    setView(plyAt(event));
  };
  wrap.onpointermove = (event) => {
    if (event.target.closest('.graph-marker')) return;
    const ply = plyAt(event);
    showTip(ply);
    if (wrap.hasPointerCapture(event.pointerId) && ply !== viewIndex) setView(ply);
  };
  wrap.onpointerleave = () => $('#graphTip').classList.add('hidden');
}
function showTip(ply) {
  const tip = $('#graphTip'), note = game.annotations[ply - 1], last = game.moveLog.length;
  tip.textContent = ply === 0 ? `Start · ${scoreLabel(game.evalHist[0])}`
    : `${moveLabel(ply - 1)}${BADGES[note?.type] ? ` · ${note.label}` : ''} · ${scoreLabel(game.evalHist[ply - 1])} → ${scoreLabel(game.evalHist[ply])}`;
  tip.style.left = `${Math.min(82, Math.max(18, ply / Math.max(1, last) * 100))}%`;
  tip.classList.remove('hidden');
}

function momentButton(label, onclick, primary = false) {
  const button = document.createElement('button');
  button.className = primary ? 'moment-primary' : 'text-action';
  button.textContent = label;
  button.onclick = onclick;
  return button;
}

function renderKeyMoments(moments) {
  const notes = game.annotations, list = $('#keyMoments'), bot = botSide(game.settings);
  const retries = moments.filter((ply) => notes[ply]?.type !== 'book' && retryable(ply));
  const solvedCount = retries.filter((ply) => solved.has(solvedKey(ply))).length;
  text($('#momentCount'), retries.length ? `· ${solvedCount} of ${retries.length} solved` : '');
  $('#momentScope').classList.toggle('hidden', !bot);
  $('#momentScope').setAttribute('aria-pressed', String(bothSides));
  const index = moments.indexOf(activeMoment);
  $('#prevMoment').disabled = index <= 0;
  $('#nextMoment').disabled = !moments.length || index === moments.length - 1;
  $('#startReview').classList.toggle('hidden', !moments.length || index >= 0);
  list.replaceChildren();
  if (!moments.length) {
    const empty = document.createElement('li');
    empty.className = 'empty-note';
    empty.textContent = 'No turning points. Both sides kept close to the best moves.';
    list.append(empty);
    return;
  }
  for (const ply of moments) {
    const note = notes[ply], book = note?.type === 'book', mate = !book && missedMate(ply);
    const type = mate && !['mistake', 'blunder'].includes(note.type) ? 'mistake' : note.type;
    const open = ply === activeMoment, item = document.createElement('li');
    const button = document.createElement('button');
    button.className = `moment${open ? ' cur' : ''}`;
    button.style.setProperty('--badge', BADGES[type].color);
    button.setAttribute('aria-expanded', String(open));
    const move = document.createElement('span'); move.textContent = moveLabel(ply);
    const change = document.createElement('span'); change.className = 'moment-change';
    if (!book) change.textContent = `${scoreLabel(game.evalHist[ply])} → ${scoreLabel(game.evalHist[ply + 1])}`;
    const label = document.createElement('span'); label.className = 'moment-label';
    label.textContent = `${solved.has(solvedKey(ply)) ? '✓ ' : ''}${book ? 'Opening' : mate ? 'Missed mate' : note.label}`;
    button.append(badgeEl({ type }), move, change, label);
    button.onclick = () => goToMoment(ply);
    item.append(button);
    if (open) item.append(momentDetail(ply, note, ply !== moments.at(-1)));
    list.append(item);
  }
}

function momentDetail(ply, note, hasNext) {
  const detail = document.createElement('div');
  detail.className = 'moment-detail';
  const why = document.createElement('p');
  why.textContent = note.explanation;
  detail.append(why);
  const actions = document.createElement('div');
  actions.className = 'moment-actions';
  const next = hasNext ? momentButton('Next moment', () => $('#nextMoment').click(), true) : document.createDocumentFragment();
  if (retry?.ply === ply) {
    const status = document.createElement('p');
    status.className = `retry-status${retry.fen ? (retry.solved ? ' solved' : ' wrong') : ''}`;
    status.setAttribute('role', 'status');
    status.textContent = retry.message;
    detail.append(status);
    if (retry.fen && retry.solved) actions.append(next);
    else if (retry.fen) actions.append(momentButton('Try again', () => { retry = { ply, message: 'Find a better move.' }; syncBoard(currentFen()); renderPanels(true); }, true), momentButton('Show best', () => showBest(ply)));
    else actions.append(momentButton('Show best', () => showBest(ply)));
  } else if (bestShown === ply) {
    const hint = hints.get(`${game.revision}:${ply}`), line = document.createElement('p');
    line.className = 'retry-status';
    line.textContent = hint?.continuation?.length ? `Best: ${lineText(game.fens[ply], hint.continuation.slice(0, 6).map((step) => step.san))}` : `Best was ${note.betterSan}. Loading the line…`;
    detail.append(line);
    actions.append(next);
  } else if (note.type !== 'book' && retryable(ply)) {
    actions.append(momentButton('Retry', () => startRetry(ply), true));
    if (note.betterSan) actions.append(momentButton('Show best', () => showBest(ply)));
  } else if (note.betterSan) actions.append(momentButton(`Show the better move, ${note.betterSan}`, () => showBest(ply)));
  if (actions.childElementCount) detail.append(actions);
  return detail;
}

function setView(index) {
  if (!game || busy || promoting) return;
  cancelGesture();
  if (retry && index !== retry.ply) retry = null;
  viewIndex = Math.max(0, Math.min(index, game.moveLog.length));
  selected = null;
  syncBoard(currentFen()); renderPanels();
  clearTimeout(analysisTimer);
  const fen = currentFen(), ply = viewIndex;
  if (analysis?.fen !== fen || analysis.ply !== ply || !legalByFen.has(fen)) {
    analysisTimer = setTimeout(() => api('analyze', { fen, atPly: ply, revision: game.revision }).then((data) => {
      legalByFen.set(fen, data.legalMoves);
      updateHighlights();
      pollAnalysis();
    }).catch(() => {}), 180);
  }
  scheduleSweep(); // no-op unless the Engines coach view is on for this position
}

async function mutate(action, body = {}, onError = (error) => notify(error.message, true)) {
  if (busy || promoting) return false;
  cancelGesture(); clearTimeout(analysisTimer); setBusy(true);
  try {
    const fresh = adoptGame(await api(action, body));
    viewIndex = game.moveLog.length; selected = null; analysis = null;
    if (fresh) focusedSquare = botSide(game.settings) === 'w' ? 'e7' : 'e2';
    syncBoard(currentFen(), fresh); renderPanels(true);
    return true;
  } catch (error) { onError(error); return false; }
  finally { setBusy(false); pollAnalysis(); }
}

function notify(message, error = false) {
  const el = $('#toast'); el.textContent = message; el.className = `toast${error ? ' error' : ''}`;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.add('hidden'), error ? 6500 : 3500);
}

// Idle-aware polling. While anything is active — analysis thinking, the computer thinking, a deep review
// running, a quick game review still filling positions, or a revision bump just observed — the loop keeps
// a 200 ms cadence; once the analysis is ready and nothing else runs it backs off to 5 s. Any user
// action calls pollAnalysis(), which kicks the fast cadence at once, even mid-flight (the flag is read by
// the next re-arm). A hidden tab keeps its old 2.5 s back-off untouched, ahead of every other rule.
const POLL_ACTIVE = 200, POLL_IDLE = 5000, POLL_HIDDEN = 2500;
let pollKick = true; // start fast: the first poll is the connection attempt
const pollBusy = () => !game || !analysis || analysis.phase !== 'ready' || game.computer?.phase === 'thinking'
  || game.annotations.some(a => a?.type === 'pending') || game.deep.active || (game.reviewAll && !reviewStatus().complete) || analysis.sweep?.phase === 'running';
async function pollTick() {
  if (busy || promoting || gesture) { pollTimer = setTimeout(pollTick, 500); return; }
  polling = true;
  const revision = game?.revision;
  try {
    const data = await api(`analysis?tab=${encodeURIComponent(TAB_ID)}&visible=${!document.hidden}`);
    if (busy || gesture || promoting || game?.revision !== revision) return;
    online = true;
    const first = !game, wasTail = first || viewIndex === game.moveLog.length;
    const changed = first || data.game.revision !== game.revision;
    if (changed) pollKick = true; // an observed revision bump keeps the fast cadence for one more poll
    const fresh = adoptGame(data.game); delete data.game; analysis = data;
    if (first && game.settings.theme !== themeKey) api('settings', { theme: themeKey }).catch(() => {});
    if (changed) {
      viewIndex = wasTail ? game.moveLog.length : Math.min(viewIndex, game.moveLog.length);
      selected = null; retry = null;
    }
    scheduleSweep(); // also recover a stopped/paused sweep after visibility changes
    // While a retry attempt is on show, the board holds the scratch position.
    const shown = retry?.fen || currentFen();
    if (boardFen !== shown) syncBoard(shown, fresh);
    renderPanels();
  } catch (_) {
    online = false;
    if (game) renderPanels();
    else { text($('#status'), 'Cannot connect. Run npm start to open your board.'); text($('#engineState'), 'Offline'); }
  } finally {
    polling = false;
    const fast = pollKick;
    pollKick = false;
    pollTimer = setTimeout(pollTick, document.hidden ? POLL_HIDDEN : (fast || pollBusy()) ? POLL_ACTIVE : POLL_IDLE);
  }
}
function pollAnalysis() { pollKick = true; clearTimeout(pollTimer); if (!polling) pollTick(); }

async function refreshCollection() {
  try {
    collection = await api('brilliants');
    for (const entry of collection.entries) (seenArchive ||= new Set()).add(entry.id);
    text($('#collectionCount'), collection.entries.length ? String(collection.entries.length) : '');
    $('#collection').setAttribute('aria-label', `Brilliants, ${collection.entries.length} saved`);
    if ($('#galleryDialog').open) renderGallery();
  } catch (_) {}
}

function renderGallery() {
  const list = $('#galleryEntries');
  list.replaceChildren();
  text($('#archiveFolder'), collection?.folder ? `Saved in ${collection.folder}` : '');
  if (!collection?.entries.length) {
    const empty = document.createElement('p');
    empty.className = 'empty-note';
    empty.textContent = 'No brilliant moves yet. When you find a sound sacrifice, its board image, explanation and game are saved here automatically.';
    list.append(empty);
    return;
  }
  for (const entry of collection.entries) {
    const id = encodeURIComponent(entry.id), card = document.createElement('article');
    card.className = 'gallery-card';
    const image = new Image(1024, 1240);
    image.src = `/api/brilliants/${id}/image.png`;
    image.alt = `Board after ${entry.move.san}`;
    image.loading = 'lazy';
    const body = document.createElement('div');
    const title = document.createElement('h3');
    title.textContent = `${entry.beforeFen.split(' ')[5]}${entry.move.color === 'w' ? '.' : '…'} ${entry.move.san}!!`;
    const meta = document.createElement('p');
    meta.className = 'gallery-meta';
    meta.textContent = `${new Date(entry.createdAt).toLocaleDateString(undefined, { dateStyle: 'medium' })} · ${entry.variant === 'chess960' ? `Chess960 #${entry.seed}` : 'Standard'}`;
    const explanation = document.createElement('p');
    explanation.className = 'gallery-text';
    explanation.textContent = entry.annotation.explanation;
    const actions = document.createElement('div');
    actions.className = 'gallery-actions';
    const study = document.createElement('button');
    study.textContent = 'Study';
    study.onclick = () => { restoreId = entry.id; $('#restoreDialog').showModal(); };
    const pgn = document.createElement('a');
    pgn.className = 'button-link';
    pgn.href = `/api/brilliants/${id}/game.pgn`;
    pgn.textContent = 'PGN';
    const png = document.createElement('a');
    png.className = 'button-link';
    png.href = image.src;
    png.download = `brilliant-${entry.move.san}.png`;
    png.textContent = 'Image';
    actions.append(study, pgn, png);
    body.append(title, meta, explanation, actions);
    card.append(image, body);
    list.append(card);
  }
}
function openGallery() { renderGallery(); $('#galleryDialog').showModal(); refreshCollection(); }

function openNewDialog() {
  const s = game?.settings;
  if (!s || busy) return;
  setChoiceValue('gameMode', s.mode);
  setChoiceValue('gameVariant', s.variant);
  setChoiceValue('gameSide', s.humanColor);
  setChoiceValue('gameBot', s.engineSide || '');
  $('#gameVariety').checked = Boolean(s.variety);
  $('#gameSeed').value = '';
  // The clock never reaches the server, so the dialog mirrors the armed client-side one; untimed games
  // show Off, and a non-preset value falls back to Custom with its minutes/increment filled in.
  const pick = clock ? `${clock.minutes}+${clock.incrementSeconds}` : 'off';
  setChoiceValue('gameClock', ['off', '3+2', '5+0', '10+0'].includes(pick) ? pick : 'custom');
  if (clock) { $('#gameClockMin').value = clock.minutes; $('#gameClockInc').value = clock.incrementSeconds; }
  $('#strength').value = s.strength;
  // The dialog names the chosen engine; where its capabilities run out the server's pickEngines notices say so.
  const chosen = engineRegistry?.engines.find((entry) => entry.id === (s.engineId ?? engineRegistry?.defaultId));
  $('#gameMode input[value="engine"]').nextElementSibling.textContent = `Vs ${chosen?.name || 'Stockfish'}`;
  $('#strengthHelp').textContent = chosen && !chosen.elo
    ? `At 10–90% the calibrated Stockfish plays (${chosen.name} has no Elo limits); at 100% ${chosen.name} plays at full strength. Your coach always analyses at full strength.`
    : "Uses Stockfish's own Elo calibration (1320–2800), then unlimited. Your coach always analyses at full strength.";
  $('#setupError').classList.add('hidden');
  syncSetup();
  $('#newDialog').showModal();
}
function syncSetup() {
  const engine = choiceValue('gameMode') === 'engine';
  $('#sideField').classList.toggle('hidden', !engine);
  $('#botField').classList.toggle('hidden', engine);
  $('#varietyField').classList.toggle('hidden', engine || !choiceValue('gameBot'));
  $('#strengthField').classList.toggle('hidden', !engine);
  $('#seedField').classList.toggle('hidden', choiceValue('gameVariant') !== 'chess960');
  const customClock = choiceValue('gameClock') === 'custom';
  $('#clockMinField').classList.toggle('hidden', !customClock);
  $('#clockIncField').classList.toggle('hidden', !customClock);
  $('#strengthOutput').textContent = `${$('#strength').value}% · ${strengthLabel(+$('#strength').value)}`;
}
$('#gameMode').onchange = $('#gameVariant').onchange = $('#gameBot').onchange = $('#gameClock').onchange = $('#strength').oninput = syncSetup;
$('#newForm').onsubmit = async (event) => {
  event.preventDefault();
  const mode = choiceValue('gameMode'), variant = choiceValue('gameVariant'), humanColor = choiceValue('gameSide'), seed = $('#gameSeed').value.trim();
  // The clock rides along client-side: validated here, armed when that fresh game is adopted, never posted.
  let chosen = null;
  if (choiceValue('gameClock') !== 'off') {
    const [minutes, incrementSeconds] = choiceValue('gameClock') === 'custom'
      ? [+$('#gameClockMin').value, +$('#gameClockInc').value]
      : choiceValue('gameClock').split('+').map(Number);
    const refuse = (message) => { $('#setupError').textContent = message; $('#setupError').classList.remove('hidden'); };
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 180) return refuse('Clock minutes must be a whole number from 1 to 180.');
    if (!Number.isInteger(incrementSeconds) || incrementSeconds < 0 || incrementSeconds > 60) return refuse('Clock increment must be a whole number of seconds from 0 to 60.');
    chosen = { minutes, incrementSeconds };
  }
  pendingClock = chosen;
  const engineSide = mode === 'free' ? choiceValue('gameBot') || null : null;
  const body = { mode, variant, humanColor, engineSide, variety: Boolean(engineSide) && $('#gameVariety').checked, strength: +$('#strength').value, seed: variant === 'chess960' && seed ? +seed : null, theme: themeKey, flipped: (mode === 'engine' && humanColor === 'b') || engineSide === 'w' };
  const ok = await mutate('new', body, (error) => { $('#setupError').textContent = error.message; $('#setupError').classList.remove('hidden'); });
  if (ok) { $('#newDialog').close(); if (!$('#puzzleWorkspace').classList.contains('hidden')) puzzles.close(); }
  else pendingClock = null; // the choice belongs to the game it was made for, never the next one
};
$('#new').onclick = $('#modeButton').onclick = openNewDialog;
$('#newCancel').onclick = () => $('#newDialog').close();
$('#promoCancel').onclick = () => $('#promo').close();
$('#collection').onclick = openGallery;
$('#galleryClose').onclick = () => $('#galleryDialog').close();
$('#openFolder').onclick = () => api('brilliants/open-folder', {}).then((data) => text($('#archiveFolder'), `Saved in ${data.folder}`)).catch((error) => notify(error.message, true));
$('#restoreCancel').onclick = () => $('#restoreDialog').close();
$('#restoreConfirm').onclick = async () => {
  $('#restoreDialog').close();
  const entry = collection?.entries.find((item) => item.id === restoreId);
  if (await mutate('restore', { id: restoreId, revision: game.revision })) { $('#galleryDialog').close(); if (!$('#puzzleWorkspace').classList.contains('hidden')) puzzles.close(); if (entry) setView(entry.ply); }
};
$('#appearance').onclick = () => $('#appearanceDialog').showModal();
$('#appearanceClose').onclick = () => $('#appearanceDialog').close();
$('#brilliantPreview').innerHTML = BADGES.brilliant.svg;
$('#previewBrilliant').onclick = () => text($('#brilliantPreviewStatus'), animateBrilliant($('#brilliantPreview')) ? '' : 'Reduced motion is on.');
$('#theme').onchange = () => { applyTheme(choiceValue('theme')); api('settings', { theme: themeKey }).catch(() => {}); };
$('#pieceSet').onchange = () => applyPieceSet(choiceValue('pieceSet'));
// Puzzles own their board and state; we lend the current piece images and swap the game view
// out while the puzzle workspace is open. The shared game on the server is untouched.
const puzzles = window.CHESS_PUZZLES.init({
  root: $('#puzzleWorkspace'),
  openButton: $('#openPuzzles'),
  onOpen: () => { cancelGesture(); $('.workspace-heading').classList.add('hidden'); $('.workspace').classList.add('hidden'); $('.app-footer').classList.add('hidden'); if (clock && !clock.flagged && !game?.over) notify('Your game clock keeps running while you solve puzzles.'); },
  onClose: () => { $('.workspace-heading').classList.remove('hidden'); $('.workspace').classList.remove('hidden'); $('.app-footer').classList.remove('hidden'); },
  pieceUrl: pieceImage,
});
document.addEventListener('chessappearancechange', () => puzzles.refreshAppearance());
$('#power').onchange = () => api('settings', { powerMode: choiceValue('power') }).then(pollAnalysis).catch((error) => notify(error.message, true));
// So is the engine pick: the server re-aims its processes (with Stockfish filling any capability gap) and the
// next poll brings back the name and any notice.
function chooseEngine(id) {
  if (id === '__votes__') {
    if (arrowMode !== 'engines') { setArrowMode('engines'); scheduleSweep(); renderPanels(true); }
    notify('Engine votes: every engine answers with its own coloured arrow.');
    return;
  }
  // Picking a single engine leaves the coach view; Best mode and everything else follow the choice.
  if (arrowMode === 'engines') { stopSweepRemote(); setArrowMode('best'); renderPanels(true); }
  api('settings', { engineId: id }).then(pollAnalysis).catch((error) => { syncEngineName(); notify(error.message, true); });
}
$('#engine').onchange = () => chooseEngine(choiceValue('engine'));
$('#compareEngines').onclick = () => {
  if (arrowMode !== 'engines') return chooseEngine('__votes__');
  stopSweepRemote(); setArrowMode('best'); renderPanels(true);
};
// And so is Online, the local-first opt-in: one POST, the next poll syncs the switch back. Enabling fetches
// the position on screen once, immediately; disabling forgets every cached answer so nothing online lingers.
async function setOnline(on) {
  try {
    const data = await api('settings', { onlineFeatures: on });
    if (game) game.settings = { ...game.settings, ...data.settings };
  } catch (error) {
    $('#online').checked = Boolean(game?.settings?.onlineFeatures);
    return notify(error.message, true);
  }
  if (!on) onlineByFen.clear();
  else maybeFetchOnline();
  pollAnalysis();
  renderPanels();
}
$('#online').onchange = () => setOnline($('#online').checked);
// At the live position a takeback is the familiar one-move undo; off-tail it also discards the browsed continuation,
// so the cost is confirmed first (a variation tree is out of scope — see README). The off-tail post pins the
// revision it quoted, so a reply that lands while the dialog is open can never be silently swallowed with it.
$('#undo').onclick = async () => {
  if (busy || promoting || !game || viewIndex === 0) return;
  if (viewIndex < game.moveLog.length) {
    const atPly = Math.max(0, viewIndex - 1), revision = game.revision, target = undoTarget();
    if (!await confirmDiscard(`Take back to position ${target}?`, 'Discard and take back', game.moveLog.length - target, target)) return;
    return mutate('undo', { atPly, revision });
  }
  mutate('undo', { atPly: Math.max(0, viewIndex - 1) });
};
$('#flip').onclick = () => {
  cancelGesture(); flipped = !flipped; selected = null;
  if (game) { game.settings.flipped = flipped; api('settings', { flipped }).catch(() => {}); }
  buildSquares(); syncBoard(currentFen(), true); renderPanels(true);
};
$('#botPlay').onclick = () => mutate('engine-move', { revision: game.revision });
$('#startReview').onclick =() => { const first = keyMoments()[0]; if (first !== undefined) goToMoment(first); };
$('#prevMoment').onclick = () => { const moments = keyMoments(), i = moments.indexOf(activeMoment); if (i > 0) goToMoment(moments[i - 1]); };
$('#nextMoment').onclick = () => { const moments = keyMoments(), i = moments.indexOf(activeMoment); if (i < moments.length - 1) goToMoment(moments[i + 1]); };
$('#momentScope').onclick = () => { bothSides = !bothSides; renderPanels(true); };
// Every review button runs the deep (depth 20) review of the whole game; grading during play stays quick.
$('#reviewGame').onclick = $('#reviewButton').onclick = $('#deepButton').onclick = () => api('review', { deep: true })
  .then((next) => { adoptGame(next); selectTab($('#tabReview')); renderPanels(true); pollAnalysis(); })
  .catch((error) => notify(error.message, true));
// The Arrows button cycles Off -> Best -> Engines. Entering Engines asks for a sweep of the position on
// screen; leaving it stops any running sweep server-side.
$('#coach').onclick = () => {
  const next = arrowMode === 'off' ? 'best' : arrowMode === 'best' ? 'engines' : 'off';
  if (arrowMode === 'engines' && next !== 'engines') stopSweepRemote();
  setArrowMode(next);
  if (next === 'engines') scheduleSweep();
  renderPanels(true);
};
$('#retryEngine').onclick = () => api('retry', {}).then(() => pollAnalysis()).catch((error) => notify(error.message, true));
$('#speed').onchange = async () => {
  try { await api('settings', { analysisMs: +choiceValue('speed') }); pollAnalysis(); }
  catch (error) { notify(error.message, true); }
};
$('#navFirst').onclick = () => setView(0);
$('#navPrev').onclick = () => setView(viewIndex - 1);
$('#navNext').onclick = () => setView(viewIndex + 1);
$('#navLast').onclick = () => setView(game?.moveLog.length || 0);

const evaluationSection = $('.advantage-section');
const wideEvaluation = matchMedia('(min-width: 761px) and (min-height: 501px)');
const positionEvaluation = () => {
  const docked = wideEvaluation.matches;
  (docked ? $('#boardEvaluation') : $('#analysisPanel')).append(evaluationSection);
  if (docked) $('#evaluationScore').append($('#evalNum'));
  else $('#topPlayer').insertBefore($('#evalNum'), $('#topPlayer .player-turn'));
  $('.stage').classList.toggle('chart-docked', docked);
};
wideEvaluation.addEventListener('change', positionEvaluation);
positionEvaluation();
new ResizeObserver(([entry]) => {
  const { width, height } = entry.contentRect;
  if (!width || !height) return;
  graphSize.width = width; graphSize.height = height;
  if (game) renderGraph();
}).observe($('.graph-viewport'));

const tabs = [...document.querySelectorAll('[role="tab"]')];
function selectTab(tab, focus = false) {
  for (const item of tabs) {
    const on = item === tab;
    item.setAttribute('aria-selected', String(on));
    item.tabIndex = on ? 0 : -1;
    $(`#${item.getAttribute('aria-controls')}`).classList.toggle('hidden', !on);
  }
  if (focus) tab.focus();
}
tabs.forEach((tab, i) => {
  tab.onclick = () => selectTab(tab);
  tab.onkeydown = (event) => {
    const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
    if (!step) return;
    event.preventDefault(); event.stopPropagation();
    selectTab(tabs[(i + step + tabs.length) % tabs.length], true);
  };
});

document.addEventListener('keydown', (event) => {
  if (!game || !$('#puzzleWorkspace').classList.contains('hidden') || event.target.closest('dialog,input,textarea') || event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.key === 'Escape') { cancelGesture(); select(null); return; }
  if (board.contains(event.target) && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Enter', ' '].includes(event.key)) {
    event.preventDefault();
    if (event.key === 'Enter' || event.key === ' ') { tapSquare(focusedSquare); return; }
    let c = col(focusedSquare), r = row(focusedSquare);
    c = Math.max(0, Math.min(7, c + (event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0)));
    r = Math.max(0, Math.min(7, r + (event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0)));
    focusedSquare = (flipped ? FILES[7 - c] : FILES[c]) + (flipped ? r + 1 : 8 - r);
    $(`.square[data-square="${focusedSquare}"]`).focus({ preventScroll: true });
    return;
  }
  const actions = { ArrowLeft: () => setView(viewIndex - 1), ArrowRight: () => setView(viewIndex + 1), Home: () => setView(0), End: () => setView(game.moveLog.length), f: () => $('#flip').click(), F: () => $('#flip').click() };
  if (actions[event.key]) { event.preventDefault(); actions[event.key](); }
});

buildSquares();
pollAnalysis();
refreshCollection();
// hello reports this tab's REAL visibility: a tab loaded in the background is hidden by definition
// (visibilitychange never fires for it), so it registers its own pause instead of assuming visibility —
// and pauseSent makes its first un-hide release that registration. Other tabs' pauses are never touched.
const startHidden = document.visibilityState === 'hidden';
pauseSent = startHidden;
pausePost({ hidden: startHidden, tab: TAB_ID, hello: true });
// One registry fetch; the name then follows settings.engineId on every adopted state.
api('engines').then((data) => { engineRegistry = data; fillEngineChoices(); syncEngineName(); renderPanels(); }).catch(() => {});
