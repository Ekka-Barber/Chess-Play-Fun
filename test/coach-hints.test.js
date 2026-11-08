const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('the coach waits for completed analysis before requesting a hint and deduplicates it', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
  const helper = source.match(/function maybeFetchHint\(live\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(helper);
  const calls = [], hint = { title: 'Try Bxf7+', continuation: [{ uci: 'c4f7' }] };
  let renders = 0;
  const context = { game: { revision: 7 }, viewIndex: 9, hints: new Map(),
    api: async route => { calls.push(route); return hint; }, renderPanels: () => { renders++; } };
  vm.createContext(context); vm.runInContext(helper, context);
  for (const live of [null, { phase: 'idle', lines: [] }, { phase: 'thinking', lines: [{ uci: 'c4f7' }] }]) context.maybeFetchHint(live);
  assert.deepEqual(calls, [], 'progressive lines do not imply a committed engine result');
  assert.equal(context.hints.size, 0);
  context.maybeFetchHint({ phase: 'ready', lines: [{ uci: 'c4f7' }] });
  context.maybeFetchHint({ phase: 'ready', lines: [{ uci: 'c4f7' }] });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, ['hint?ply=9']);
  assert.equal(context.hints.get('7:9'), hint);
  assert.equal(renders, 1);
});
