const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../public/brilliant-effects.js'), 'utf8');

function setup(flipped = false) {
  const animations = [], timers = new Map(), listeners = new Set();
  let sequence = 0;
  const motion = { matches: false, addEventListener: (name, fn) => listeners.add(fn), removeEventListener: (name, fn) => listeners.delete(fn) };
  const document = { createElement: () => element() };
  function element(rect = { left: 0, top: 0, width: 80, height: 80 }) {
    const result = { ownerDocument: document, dataset: {}, children: [], attributes: {},
      style: { setProperty(name, value) { this[name] = value; } },
      setAttribute(name, value) { this.attributes[name] = value; },
      append(child) { child.remove(); this.children.push(child); child.parent = this; },
      remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); this.parent = null; },
      getBoundingClientRect: () => rect,
      animate(frames, timing) {
        let reject;
        const animation = { element: this, frames, timing, cancelled: false,
          finished: new Promise((resolve, fail) => { reject = fail; }),
          cancel() { this.cancelled = true; reject(new Error('Animation cancelled')); } };
        animations.push(animation);
        return animation;
      },
    };
    return result;
  }
  const svg = element(), badge = { querySelector: selector => selector === 'svg' ? svg : null };
  const board = element({ left: 40, top: 60, width: 640, height: 640 }), pieces = element(), squares = [];
  for (let rank = 1; rank <= 8; rank++) for (let file = 0; file < 8; file++) {
    const col = flipped ? 7 - file : file, row = flipped ? rank - 1 : 8 - rank;
    const cell = element({ left: 40 + col * 80, top: 60 + row * 80, width: 80, height: 80 });
    cell.dataset.square = 'abcdefgh'[file] + rank;
    squares.push(cell);
  }
  board.querySelectorAll = selector => selector === '#squares .square' ? squares : [];
  board.querySelector = selector => selector === '.pieces' ? pieces : null;
  board.append(pieces);
  board.insertBefore = (child, before) => { child.remove(); board.children.splice(board.children.indexOf(before), 0, child); child.parent = board; };
  const window = { matchMedia: () => motion, setTimeout: fn => { timers.set(++sequence, fn); return sequence; }, clearTimeout: id => timers.delete(id) };
  vm.runInNewContext(source, { window });
  return { api: window.CHESS_BRILLIANT, animations, timers, listeners, motion, svg, badge, board, pieces, squares,
    piece: element({ left: 360, top: 380, width: 80, height: 80 }),
    finish: () => { for (const fn of [...timers.values()]) fn(); } };
}

test('module also exports its native play/cancel API to CommonJS', () => {
  const effects = require('../public/brilliant-effects');
  assert.equal(typeof effects.play, 'function');
  assert.equal(typeof effects.cancel, 'function');
  assert.equal(effects.play(), false);
});

test('reduced motion and missing badge SVG leave live content untouched', () => {
  const env = setup();
  env.motion.matches = true;
  assert.equal(env.api.play({ badge: env.badge, board: env.board, square: 'e4' }), false);
  env.motion.matches = false;
  assert.equal(env.api.play({ badge: { querySelector: () => null } }), false);
  assert.equal(env.animations.length, 0);
  assert.equal(env.listeners.size, 0);
  assert.equal(env.timers.size, 0);
  assert.deepEqual(env.board.children, [env.pieces]);
});

test('badge-only previews animate the mark without changing its placement or hiding it', () => {
  const env = setup();
  assert.equal(env.api.play({ badge: env.badge }), true);
  assert.equal(env.animations.length, 1);
  assert.equal(env.animations[0].element, env.svg);
  assert.ok(env.animations[0].frames.every(frame => frame.opacity === undefined));
  assert.equal(env.svg.style.transform, undefined);
  env.finish();
  assert.ok(env.animations.every(animation => animation.cancelled));
  assert.equal(env.timers.size, 0);
  assert.equal(env.listeners.size, 0);
});

test('radial wave starts at the destination and preserves square ordering after board flip', () => {
  const orders = [];
  for (const flipped of [false, true]) {
    const env = setup(flipped);
    assert.equal(env.api.play({ badge: env.badge, board: env.board, square: 'e4', piece: env.piece }), true);
    const wave = new Map(env.animations.filter(animation => animation.element.className === 'brilliant-wave-cell')
      .map(animation => [animation.element.parent.dataset.square, animation.timing.delay]));
    assert.equal(wave.size, 64);
    assert.equal(wave.get('e4'), 320);
    assert.equal(wave.get('e5') - wave.get('e4'), 75);
    assert.equal(wave.get('e5'), wave.get('d4'));
    assert.ok(wave.get('a8') > wave.get('d5'));
    orders.push([...wave.entries()].sort());
    const layer = env.board.children[0];
    assert.equal(layer.className, 'brilliant-effects');
    assert.equal(env.board.children[1], env.pieces, 'glyphs stay beneath the live piece layer');
    assert.equal(layer.children.length, 14);
    assert.ok(layer.children.every(glyph => glyph.textContent === '!!'));
    assert.ok(env.animations.every(animation => animation.timing.duration + (animation.timing.delay || 0) <= 2200));
    const landing = env.animations.find(animation => animation.element === env.piece);
    assert.equal(landing.frames[1].transform, 'translateY(-44px) scale(1)');
    assert.equal(landing.frames[2].offset * landing.timing.duration, wave.get('e4'));
    assert.equal(env.piece.style.transform, undefined);
    env.api.cancel();
  }
  assert.deepEqual(orders[0], orders[1]);
});

test('a piece on the top edge stays inside the board during its landing animation', () => {
  const env = setup();
  env.piece.getBoundingClientRect = () => ({ left: 40, top: 60, width: 80, height: 80 });
  env.api.play({ badge: env.badge, board: env.board, square: 'a8', piece: env.piece });
  const landing = env.animations.find(animation => animation.element === env.piece);
  assert.equal(landing.frames[1].transform, 'translateY(0px) scale(1)');
  env.api.cancel();
});

test('effects never intercept pointers and cancellation removes only owned decorations and animations', async () => {
  const env = setup();
  const foreign = { cancelled: false };
  env.svg.getAnimations = () => { throw new Error('Do not enumerate unrelated animations'); };
  env.api.play({ badge: env.badge, board: env.board, square: 'h8', piece: env.piece });
  const layer = env.board.children[0];
  assert.equal(layer.style.pointerEvents, 'none');
  for (const cell of env.squares) for (const child of cell.children) {
    assert.equal(child.style.pointerEvents, 'none');
    assert.equal(child.attributes['aria-hidden'], 'true');
  }
  assert.ok(layer.children.every(child => child.style.pointerEvents === 'none' && child.attributes['aria-hidden'] === 'true'));
  env.api.cancel();
  env.api.cancel();
  await Promise.resolve();
  assert.ok(env.animations.every(animation => animation.cancelled));
  assert.equal(foreign.cancelled, false);
  assert.deepEqual(env.board.children, [env.pieces]);
  assert.ok(env.squares.every(cell => cell.children.length === 0));
  assert.equal(env.listeners.size, 0);
  assert.equal(env.timers.size, 0);
});

test('replays replace previous effects and a changed motion preference clears the active run', async () => {
  const env = setup();
  env.api.play({ badge: env.badge, board: env.board, square: 'a1' });
  const previous = [...env.animations];
  env.api.play({ badge: env.badge, board: env.board, square: 'h8' });
  assert.ok(previous.every(animation => animation.cancelled));
  assert.equal(env.board.children.filter(child => child.className === 'brilliant-effects').length, 1);
  assert.equal(env.listeners.size, 1);
  for (const fn of [...env.listeners]) fn({ matches: true });
  await Promise.resolve();
  assert.ok(env.animations.every(animation => animation.cancelled));
  assert.deepEqual(env.board.children, [env.pieces]);
  assert.ok(env.squares.every(cell => cell.children.length === 0));
  assert.equal(env.timers.size, 0);
});
