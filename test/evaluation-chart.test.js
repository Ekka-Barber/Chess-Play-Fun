const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
const renderer = source.match(/function renderGraph\(\) \{[\s\S]*?\n\}/)?.[0];
assert.ok(renderer);

function chart(width, height) {
  const graph = { attributes: {}, setAttribute(key, value) { this.attributes[key] = value; } };
  const end = {}, nodes = { '#graph': graph, '#graphEnd': end, '#evalNum': { textContent: 'White -0.13' } };
  const game = { moveLog: Array(15), evalHist: [0, null, 100, -100, ...Array(11).fill(null), -13] };
  const controls = new Function('game', 'graphSize', '$', 'text', `
    let retry=null; const viewIndex=15;
    ${renderer}
    return {render:renderGraph,retry:value=>retry=value};
  `)(game, { width, height }, selector => nodes[selector], (node, value) => { node.textContent = value; });
  return { ...controls, graph, end, game };
}

test('evaluation chart fits its viewport while preserving unknown gaps and White perspective', () => {
  for (const [width, height] of [[735, 46], [300, 70]]) {
    const view = chart(width, height), original = [...view.game.evalHist];
    view.render();
    assert.equal(view.graph.attributes.viewBox, `0 0 ${width} ${height}`);
    assert.ok(view.graph.innerHTML.includes(`d="M24 ${height / 2}H${width - 6}"`));
    assert.equal((view.graph.innerHTML.match(/<polyline/g) || []).length, 3, 'unknown positions cannot be joined into an invented trend');
    const marker = view.graph.innerHTML.match(/<circle[^>]+cx="([^"]+)" cy="([^"]+)" r="3"/);
    assert.ok(marker, 'the current point keeps a three-pixel radius');
    assert.equal(Number(marker[1]), width - 6);
    assert.ok(Number(marker[2]) > height / 2, 'negative White evaluation falls below the equality line');
    assert.equal(view.end.textContent, '4 of 16 positions analysed');
    assert.equal((view.graph.innerHTML.match(/<polygon/g) || []).length, 1, 'only adjacent known evaluations receive an area fill');
    assert.deepEqual(view.game.evalHist, original);
  }
});

test('the always-visible desktop chart hides evaluation answers during a retry', () => {
  const view = chart(640, 52);
  view.render();
  view.retry({ ply: 1 }); view.render();
  assert.ok(!/<(?:polyline|circle|polygon)\b/.test(view.graph.innerHTML));
  assert.ok(!view.graph.innerHTML.includes('class="graph-cursor"'));
  assert.equal(view.graph.attributes['aria-label'], 'Evaluation hidden during retry.');
  assert.equal(view.end.textContent, 'Hidden during retry');
});
