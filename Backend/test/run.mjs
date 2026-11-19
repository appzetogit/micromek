// Runs every *.test.mjs in this folder in its own Node process (each starts
// its own in-memory Mongo) and fails if any of them fails.
//   npm test                 all files
//   npm test -- franchise    only files whose name contains "franchise"
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const filter = process.argv[2] || '';
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.test.mjs') && f.includes(filter)).sort();

const results = [];
for (const file of files) {
  console.log(`\n=== ${file}`);
  const run = spawnSync(process.execPath, [path.join(dir, file)], {
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
    env: { ...process.env, NODE_ENV: 'test' },
  });
  // Only the check lines and summary; request logs and driver noise are dropped.
  const lines = `${run.stdout}\n${run.stderr}`.split('\n').filter((l) => /^\s{2}(ok|FAIL) |^[a-z].*$|PASSED|FAILED|Error:/.test(l) && !/^\s*at /.test(l));
  console.log(lines.join('\n'));
  results.push({ file, ok: run.status === 0 });
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} test files passed${failed.length ? `; failed: ${failed.map((f) => f.file).join(', ')}` : ''}`);
process.exit(failed.length ? 1 : 0);
