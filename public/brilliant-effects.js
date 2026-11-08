(function (root) {
  let active = null;

  function cancel() {
    const run = active;
    active = null;
    if (!run) return;
    root.clearTimeout(run.timer);
    run.motion?.removeEventListener?.('change', run.motionChange);
    for (const animation of run.animations) animation.cancel();
    for (const decoration of run.decorations) decoration.remove();
  }

  function play({ badge, board = null, square = null, piece = null, color = '#0d7a73' } = {}) {
    cancel();
    const svg = badge?.querySelector('svg');
    const motion = root.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!svg || typeof svg.animate !== 'function' || motion?.matches) return false;
    const run = { animations: [], decorations: [], motion, timer: null, motionChange: event => { if (event.matches) cancel(); } };
    active = run;
    const animate = (element, frames, timing) => {
      const animation = element.animate(frames, { ...timing, fill: 'none' });
      // Cancelling a replay must never leave a rejected finished promise unhandled.
      animation.finished?.catch(() => {});
      run.animations.push(animation);
    };
    const decorate = (parent, className) => {
      const element = parent.ownerDocument.createElement('span');
      element.className = className;
      element.setAttribute('aria-hidden', 'true');
      element.style.pointerEvents = 'none';
      parent.append(element);
      run.decorations.push(element);
      return element;
    };
    const impact = board ? 320 : 0;
    animate(svg, [
      { transform: 'scale(1) rotate(0deg)' },
      { transform: 'scale(1.38) rotate(-8deg)', offset: 0.2 },
      { transform: 'scale(0.96) rotate(3deg)', offset: 0.58 },
      { transform: 'scale(1) rotate(0deg)' },
    ], { duration: 640, delay: impact, easing: 'cubic-bezier(0.22,1,0.36,1)' });
    const pieceBox = piece?.getBoundingClientRect(), boardBox = board?.getBoundingClientRect();
    // Keep the airborne piece inside the board, including the top rank after a flip.
    const lift = pieceBox && boardBox ? Math.min(pieceBox.height * 0.55, Math.max(0, pieceBox.top - boardBox.top - 2)) : 0;
    if (typeof piece?.animate === 'function') animate(piece, [
      { transform: 'translateY(0) scale(1)' },
      { transform: `translateY(${-lift}px) scale(1)`, offset: 0.28 },
      { transform: 'translateY(0) scale(1,0.92)', offset: 320 / 520 },
      { transform: 'translateY(0) scale(1)' },
    ], { duration: 520, easing: 'cubic-bezier(0.3,0,0.2,1)' });

    const squares = board ? [...board.querySelectorAll('#squares .square')] : [];
    const origin = squares.find(element => element.dataset.square === square);
    if (origin && /^[a-h][1-8]$/.test(square)) {
      const file = square.charCodeAt(0), rank = Number(square[1]);
      for (const cell of squares) {
        const target = cell.dataset.square;
        if (!/^[a-h][1-8]$/.test(target)) continue;
        const wave = decorate(cell, 'brilliant-wave-cell');
        wave.style.backgroundColor = '#00aaa6';
        const distance = Math.hypot(target.charCodeAt(0) - file, Number(target[1]) - rank);
        animate(wave, [{ opacity: 0, transform: 'scale(0.94)' },
          { opacity: 0.78, transform: 'scale(1)', offset: 120 / 520 },
          { opacity: 0, transform: 'scale(1)' }], { duration: 520, delay: impact + distance * 75, easing: 'linear' });
      }

      const layer = decorate(board, 'brilliant-effects');
      const pieces = board.querySelector('.pieces');
      if (pieces) board.insertBefore(layer, pieces);
      layer.style.setProperty('--brilliant-color', color);
      const area = board.getBoundingClientRect(), target = origin.getBoundingClientRect();
      const x = target.left - area.left + target.width / 2, y = target.top - area.top + target.height / 2;
      const padding = Math.min(24, area.width / 8);
      for (let index = 0; index < 14; index++) {
        const glyph = decorate(layer, 'brilliant-glyph');
        const spread = (index - 6.5) / 6.5, rise = area.height * (0.12 + (index % 3) * 0.025);
        glyph.textContent = '!!';
        glyph.style.left = `${Math.max(padding, Math.min(area.width - padding, x + spread * area.width * 0.18))}px`;
        glyph.style.top = `${Math.max(padding, Math.min(area.height - padding, y))}px`;
        animate(glyph, [
          { transform: 'translate3d(0,0,0) rotate(0deg) scale(0.9)', opacity: 0 },
          { transform: `translate3d(${spread * 16}px,${-rise}px,0) rotate(${spread * 12}deg) scale(1)`, opacity: 0.75, offset: 0.28 },
          { transform: `translate3d(${spread * 42}px,${area.height * 0.32}px,0) rotate(${spread * 28}deg) scale(0.9)`, opacity: 0 },
        ], { duration: 1200, delay: impact + index * 38, easing: 'cubic-bezier(0.2,0.6,0.4,1)' });
      }
    }
    motion?.addEventListener?.('change', run.motionChange);
    run.timer = root.setTimeout(() => { if (active === run) cancel(); }, 2200);
    return true;
  }

  const api = { play, cancel };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CHESS_BRILLIANT = api;
})(typeof window !== 'undefined' ? window : globalThis);
