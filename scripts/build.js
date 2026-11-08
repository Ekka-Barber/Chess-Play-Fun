// This app serves source directly; its build gate checks syntax and shipped page assets.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const assert = require('node:assert/strict');

process.chdir(path.join(__dirname, '..'));
const sources = ['server.js'];
function collect(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) collect(file);
    else if (/\.(?:js|cjs)$/.test(file)) sources.push(file);
  }
}
for (const dir of ['lib', 'public', 'scripts', 'test']) collect(dir);
for (const file of sources) {
  const check = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  assert.equal(check.status, 0, `Syntax check failed: ${file}`);
}
for (const [, asset] of fs.readFileSync('public/index.html', 'utf8').matchAll(/(?:src|href)="([^"#]+)"/g)) {
  if (!/^(?:https?:|data:|\/api\/)/.test(asset)) assert.ok(fs.statSync(path.join('public', asset)).isFile(), `Missing asset: ${asset}`);
}
console.log(`Build ready: ${sources.length} JavaScript files and local page assets checked.`);
