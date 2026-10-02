// Runs every src/**/*.test.ts with Node's built-in test runner (bundled by
// esbuild first). Tests must be pure (no DOM, no Electron).
//   node scripts/test-unit.mjs [filter]
import { build } from 'esbuild';
import { readdirSync, statSync, mkdirSync, rmSync } from 'node:fs';
import { join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(import.meta.url), '../..');
const filter = process.argv[2] ?? '';
const files = [];
(function walk(d) {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    if (statSync(p).isDirectory()) walk(p);
    else if (n.endsWith('.test.ts') && p.includes(filter)) files.push(p);
  }
})(join(root, 'src'));
if (!files.length) {
  console.log('no tests found');
  process.exit(0);
}
const out = join(root, 'node_modules/.cache/unit');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const outFiles = [];
for (const f of files) {
  const o = join(out, relative(join(root, 'src'), f).replace(/[\\/]/g, '__').replace(/\.ts$/, '.mjs'));
  await build({ entryPoints: [f], outfile: o, bundle: true, platform: 'node', format: 'esm', target: 'node22', logLevel: 'error', define: { 'import.meta.env': '{"DEV":false}' } });
  outFiles.push(o);
}
const r = spawnSync(process.execPath, ['--test', ...outFiles], { stdio: 'inherit' });
process.exit(r.status ?? 1);
