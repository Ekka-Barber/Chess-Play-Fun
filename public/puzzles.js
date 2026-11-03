/* Puzzle state is separate from the shared game; only an explicit Daily action contacts Lichess. */
window.CHESS_PUZZLES = (() => {
  function init({ root, openButton, onOpen = () => {}, onClose = () => {}, pieceUrl }) {
    let state = null, initial = null, index = 0, selected = null, hintSquare = null, promotion = null;
    let busy = false, revealed = false, assisted = false, solution = [], message = '', kind = '', ticket = 0, focusSquare = null;
    let storageFailed = false;
    const sessionKey = 'chess.puzzle-session';
    const validMove = (move) => move && typeof move.from === 'string' && /^[a-h][1-8]$/.test(move.from) && typeof move.to === 'string' && /^[a-h][1-8]$/.test(move.to) && typeof move.uci === 'string' && /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(move.uci);
    const validState = (data) => data && typeof data.id === 'string' && /^[a-zA-Z0-9-]{1,40}$/.test(data.id) && typeof data.fen === 'string' && data.fen.length <= 200
      && ['w', 'b'].includes(data.side) && typeof data.title === 'string' && data.title.length <= 160 && typeof data.solved === 'boolean'
      && Array.isArray(data.themes) && data.themes.length <= 8 && data.themes.every((theme) => typeof theme === 'string' && theme.length <= 160)
      && Array.isArray(data.moves) && data.moves.length <= 16 && data.moves.every((move) => typeof move === 'string' && /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(move))
      && Array.isArray(data.legalMoves) && data.legalMoves.length <= 256 && data.legalMoves.every(validMove)
      && data.board && typeof data.board === 'object' && !Array.isArray(data.board) && Object.keys(data.board).length <= 32
      && Object.entries(data.board).every(([square, piece]) => /^[a-h][1-8]$/.test(square) && typeof piece === 'string' && /^[kqrbnpKQRBNP]$/.test(piece))
      && (data.rating == null || Number.isFinite(data.rating)) && (data.total == null || (Number.isSafeInteger(data.total) && data.total > 0))
      && (!data.lastMove || validMove(data.lastMove)) && (!data.source || (typeof data.source === 'string' && /^https:\/\/lichess\.org\/training\/[a-zA-Z0-9]+$/.test(data.source)));
    try {
      const raw = sessionStorage.getItem(sessionKey), saved = raw && raw.length <= 64000 ? JSON.parse(raw) : null;
      if (saved?.version === 1 && validState(saved.initial) && validState(saved.state) && saved.initial.id === saved.state.id
        && Number.isInteger(saved.index) && saved.index >= 0 && saved.index < 4 && typeof saved.revealed === 'boolean' && typeof saved.assisted === 'boolean'
        && Array.isArray(saved.solution) && saved.solution.length <= 30 && saved.solution.every((move) => typeof move?.san === 'string' && move.san.length <= 20)
        && typeof saved.message === 'string' && saved.message.length <= 400 && ['', 'success', 'error'].includes(saved.kind)) {
        ({ state, initial, index, revealed, assisted, solution, message, kind } = saved);
        if (/^[a-h][1-8]$/.test(saved.hintSquare)) hintSquare = saved.hintSquare;
      } else sessionStorage.removeItem(sessionKey);
    } catch { /* Unavailable or damaged tab storage starts a fresh puzzle. */ }
    function remember() {
      if (!state) return;
      try { sessionStorage.setItem(sessionKey, JSON.stringify({ version: 1, state, initial, index, revealed, assisted, solution, message, kind, hintSquare })); storageFailed = false; }
      catch { storageFailed = true; }
    }
    root.tabIndex = -1;
    root.innerHTML = `<div class="puzzle-heading"><h1>Puzzles</h1><button data-puzzle-action="close">Back to game</button></div>
      <div class="puzzle-layout"><div class="puzzle-board" role="group" aria-label="Puzzle chessboard"></div>
      <section class="puzzle-panel"><p class="puzzle-source"></p><h2 class="puzzle-title">Choose a puzzle</h2><p class="puzzle-meta"></p>
      <p class="puzzle-turn"></p><p class="puzzle-message" role="status"></p><div class="puzzle-promotions" role="group" aria-label="Promote pawn"></div>
      <p class="puzzle-solution"></p><p class="puzzle-storage hidden" role="status">Your browser could not save this attempt. Refreshing may reset your progress.</p><div class="puzzle-actions"><button data-puzzle-action="hint">Hint</button><button data-puzzle-action="reveal">Show solution</button><button data-puzzle-action="retry">Retry</button><button data-puzzle-action="next">Next starter</button></div>
      <button data-puzzle-action="daily" class="puzzle-daily">Load Lichess daily</button><p class="muted">Four starter positions work offline. Daily requires Lichess lookups in Analysis. Your game stays separate.</p></section></div>`;
    const find = (selector) => root.querySelector(selector);
    const names = { k: 'king', q: 'queen', r: 'rook', b: 'bishop', n: 'knight', p: 'pawn' };
    const color = (side) => side === 'w' ? 'White' : 'Black';
    function render() {
      find('.puzzle-title').textContent = state?.title ?? 'Loading starter puzzle…';
      find('.puzzle-meta').textContent = state ? [...state.themes, ...(state.rating ? [`Rating ${state.rating}`] : [])].join(' · ') : '';
      find('.puzzle-turn').textContent = state ? state.solved ? assisted ? 'Completed with help' : 'Puzzle complete' : revealed ? 'Solution shown' : `${color(state.side)} to move` : '';
      const status = find('.puzzle-message'); status.textContent = busy ? 'Checking…' : message; status.dataset.kind = kind;
      find('.puzzle-storage').classList.toggle('hidden', !storageFailed);
      find('.puzzle-solution').textContent = solution.length ? `Solution: ${solution.map((move) => move.san).join(' ')}` : '';
      const source = find('.puzzle-source'); source.replaceChildren();
      if (state?.source) { const link = document.createElement('a'); link.href = state.source; link.target = '_blank'; link.rel = 'noopener'; link.textContent = 'View original on Lichess'; source.append(link); }
      else source.textContent = state ? `Starter ${index + 1} of ${state.total ?? 4}` : '';
      for (const button of root.querySelectorAll('[data-puzzle-action]')) {
        const action = button.dataset.puzzleAction;
        button.disabled = action === 'close' ? false : busy || (['hint', 'reveal'].includes(action) && (!state || state.solved || revealed)) || (action === 'retry' && !state);
      }
      const focused = document.activeElement?.closest('[data-puzzle-square]')?.dataset.puzzleSquare;
      if (focused) focusSquare = focused;
      const board = find('.puzzle-board'), squares = document.createDocumentFragment();
      const files = state?.side === 'b' ? 'hgfedcba' : 'abcdefgh', ranks = state?.side === 'b' ? '12345678' : '87654321';
      for (const rank of ranks) for (const file of files) {
        const square = file + rank, piece = state?.board[square], button = document.createElement('button');
        const target = state?.legalMoves.some((move) => move.from === selected && move.to === square);
        button.className = `square puzzle-square ${(file.charCodeAt(0) - 97 + Number(rank)) % 2 ? 'dark' : 'light'}${selected === square || hintSquare === square ? ' sel' : ''}${target ? ` target${piece ? ' capture' : ''}` : ''}${state?.lastMove && [state.lastMove.from, state.lastMove.to].includes(square) ? ' lastmove' : ''}`;
        button.dataset.puzzleSquare = square;
        button.setAttribute('aria-label', `${square}, ${piece ? `${color(piece === piece.toUpperCase() ? 'w' : 'b')} ${names[piece.toLowerCase()]}` : 'empty'}`);
        button.setAttribute('aria-pressed', String(selected === square)); button.disabled = busy || !state || state.solved || revealed;
        if (piece) { const image = document.createElement('img'); image.src = pieceUrl(piece); image.alt = ''; image.draggable = false; button.append(image); }
        if (file === files[0]) { const coord = document.createElement('span'); coord.className = 'coord rank'; coord.textContent = rank; button.append(coord); }
        if (rank === ranks.at(-1)) { const coord = document.createElement('span'); coord.className = 'coord file'; coord.textContent = file; button.append(coord); }
        squares.append(button);
      }
      board.replaceChildren(squares);
      if (!busy && focusSquare) board.querySelector(`[data-puzzle-square="${focusSquare}"]`)?.focus({ preventScroll: true });
      const promotions = find('.puzzle-promotions'); promotions.replaceChildren();
      if (promotion) for (const move of promotion) {
        const button = document.createElement('button'); button.dataset.puzzlePromotion = move.promotion;
        button.textContent = `Promote to ${names[move.promotion]}`; button.disabled = busy; promotions.append(button);
      }
    }
    async function ask(path, body, accept) {
      const request = ++ticket; busy = true; render();
      try {
        const response = await fetch(path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'The puzzle could not be loaded.');
        if (request === ticket) { accept(data); remember(); }
      } catch (error) { if (request === ticket) { message = error.message; kind = 'error'; } }
      finally { if (request === ticket) { busy = false; render(); } }
    }
    function install(data) {
      state = data; initial = data; selected = hintSquare = promotion = focusSquare = null; revealed = assisted = false; solution = [];
      if (Number.isInteger(data.index)) index = data.index;
      message = `Find the best move for ${color(data.side)}.`; kind = '';
    }
    const starter = (number) => ask(`/api/puzzles?index=${number}`, undefined, install);
    function play(move) {
      selected = hintSquare = promotion = null;
      ask('/api/puzzles/move', { id: state.id, moves: [...state.moves, move.uci] }, (data) => {
        state = { ...state, ...data }; message = data.solved && assisted ? 'Completed with help. Retry to solve it unaided.' : data.message; kind = data.correct ? 'success' : 'error';
      });
    }
    function close() { ticket++; busy = false; selected = promotion = null; remember(); root.classList.add('hidden'); openButton.setAttribute('aria-pressed', 'false'); if (location.hash === '#puzzles') location.hash = ''; onClose(); openButton.focus(); }
    function open() { root.classList.remove('hidden'); openButton.setAttribute('aria-pressed', 'true'); if (location.hash !== '#puzzles') location.hash = 'puzzles'; onOpen(); root.focus(); if (!state) starter(0); else render(); }
    window.addEventListener('hashchange', () => {
      if ((location.hash === '#puzzles') === !root.classList.contains('hidden')) return;
      if (location.hash === '#puzzles') open(); else close();
    });
    openButton.addEventListener('click', open);
    root.addEventListener('click', (event) => {
      const action = event.target.closest('[data-puzzle-action]')?.dataset.puzzleAction;
      if (action === 'close') return close();
      if (busy) return;
      if (action === 'next') return starter(index + 1);
      if (action === 'daily') return ask('/api/puzzles/daily', {}, install);
      if (action === 'retry' && initial) { install(initial); remember(); render(); return; }
      if (action === 'hint' && state) return ask('/api/puzzles/hint', { id: state.id, moves: state.moves }, (data) => { hintSquare = data.square; assisted = true; message = data.message; kind = ''; });
      if (action === 'reveal' && state) return ask('/api/puzzles/reveal', { id: state.id, moves: state.moves }, (data) => { solution = data.solution; revealed = assisted = true; selected = hintSquare = null; message = 'Solution revealed. Retry to practice it.'; kind = ''; });
      const choice = event.target.closest('[data-puzzle-promotion]')?.dataset.puzzlePromotion;
      if (choice && promotion) return play(promotion.find((move) => move.promotion === choice));
      const square = event.target.closest('[data-puzzle-square]')?.dataset.puzzleSquare;
      if (!square || !state || state.solved || revealed) return;
      const moves = state.legalMoves.filter((move) => move.from === selected && move.to === square);
      if (moves.length > 1) { promotion = moves; render(); return; }
      if (moves.length === 1) return play(moves[0]);
      selected = state.legalMoves.some((move) => move.from === square) ? square : null; hintSquare = promotion = null; render();
    });
    root.addEventListener('keydown', (event) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      event.stopPropagation();
      if (event.key === 'Escape') { event.preventDefault(); close(); return; }
      const square = event.target.closest('[data-puzzle-square]');
      if (square && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
        event.preventDefault(); const cells = [...find('.puzzle-board').children], position = cells.indexOf(square);
        const delta = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -8, ArrowDown: 8 }[event.key];
        if ((delta === -1 && position % 8 === 0) || (delta === 1 && position % 8 === 7)) return;
        cells[position + delta]?.focus();
      }
    });
    if (location.hash === '#puzzles') open();
    return { open, close, refreshAppearance: () => { if (!root.classList.contains('hidden')) render(); } };
  }
  return { init };
})();
