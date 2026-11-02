// Node >= 21 treats every `node --test` positional argument as a glob, so a bare directory
// path (e.g. `node --test v4/test/`) matches the directory itself and is executed as a test
// file instead of being searched - MODULE_NOT_FOUND, zero real tests run. Giving the test
// directory an index.js makes it a loadable CommonJS entry again: it runs every *.test.js as
// its own child process, the same per-file isolation `node --test <files>` provides, and one
// failing file fails the whole run so exit codes stay honest.
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const files = fs.readdirSync(__dirname).filter(f => f.endsWith('.test.js')).sort();
let failed = 0;
for (const file of files) {
  // cwd = project root so the suite behaves exactly as it does under `npm test`.
  const run = spawnSync(process.execPath, [path.join(__dirname, file)], {
    cwd: path.join(__dirname, '..'), stdio: 'inherit',
  });
  if (run.error || run.status !== 0) {
    failed++;
    console.error(`[suite] ${file} failed (${run.error ? run.error.message : 'exit ' + run.status})`);
  }
}
console.error(`[suite] ${files.length} test files, ${failed} failed`);
process.exit(failed ? 1 : 0);
