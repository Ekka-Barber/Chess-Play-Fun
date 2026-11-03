const { test, mock } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const childProcess = require('node:child_process');

test('output from a retired process cannot complete the replacement engine search', async () => {
  const processes = [];
  const spawn = mock.method(childProcess, 'spawn', () => {
    const proc = new EventEmitter();
    proc.stdout = new EventEmitter();
    proc.stdin = new EventEmitter();
    proc.stdin.write = command => queueMicrotask(() => {
      if (command === 'uci\n') proc.stdout.emit('data', Buffer.from('uciok\n'));
      if (command === 'isready\n') proc.stdout.emit('data', Buffer.from('readyok\n'));
      if (command.startsWith('go ')) {
        processes[0].stdout.emit('data', Buffer.from('info depth 99 score cp 900 pv a2a3\nbestmove a2a3\n'));
        proc.stdout.emit('data', Buffer.from('info depth 10 score cp 20 pv e2e4\nbestmove e2e4\n'));
      }
    });
    processes.push(proc);
    return proc;
  });
  const modulePath = require.resolve('../lib/engine');
  delete require.cache[modulePath];
  const { Engine } = require('../lib/engine');
  const e = new Engine();
  try {
    await e.start();
    e.retire();
    const raw = await e.exec(() => e.go('unused by fixture', 1, 300));
    assert.equal(raw.best, 'e2e4');
    assert.equal(raw.depth, 10);
    assert.equal(raw.lines[0].pv[0], 'e2e4');
  } finally { e.retire(); spawn.mock.restore(); delete require.cache[modulePath]; }
});
