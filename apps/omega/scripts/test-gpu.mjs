// Pixel tests for the WebGL2 compositor (src/engine/gpu). Bundles
// src/engine/gpu/Renderer.pixeltest.ts with esbuild, opens it from a file://
// page (a secure context, so WebGL2 and WebCodecs work) in headless Chromium
// with SwiftShader, and prints the results.
//
//   node scripts/test-gpu.mjs            (npm run test:gpu)
//   OMEGA_CHROME=/path/to/chrome node scripts/test-gpu.mjs
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import { mkdirSync, rmSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(fileURLToPath(import.meta.url), '../..');
const out = join(root, 'node_modules/.cache/gpu-test');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

await build({
  entryPoints: [join(root, 'src/engine/gpu/Renderer.pixeltest.ts')],
  outfile: join(out, 'bundle.js'),
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'chrome120',
  logLevel: 'error',
  define: { 'import.meta.env': '{"DEV":false}' },
  loader: { '.css': 'empty', '.png': 'dataurl', '.svg': 'dataurl', '.woff2': 'empty' },
});
writeFileSync(join(out, 'index.html'), '<!doctype html><meta charset="utf-8"><title>gpu pixel tests</title><body><script src="bundle.js"></script></body>');

function findChrome() {
  if (process.env.OMEGA_CHROME) return process.env.OMEGA_CHROME;
  const base = '/opt/pw-browsers';
  const preferred = join(base, 'chromium-1194/chrome-linux/chrome');
  if (existsSync(preferred)) return preferred;
  if (existsSync(base))
    for (const d of readdirSync(base).sort().reverse()) {
      const p = join(base, d, 'chrome-linux/chrome');
      if (d.startsWith('chromium-') && existsSync(p)) return p;
    }
  return undefined; // let playwright find its own
}

const browser = await chromium.launch({
  executablePath: findChrome(),
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
let failed = 1;
try {
  const page = await browser.newPage();
  const logs = [];
  page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  await page.goto(pathToFileURL(join(out, 'index.html')).href);
  await page.waitForFunction(() => window.__done === true, null, { timeout: 600_000 });
  const results = await page.evaluate(() => window.__results);
  failed = 0;
  for (const r of results) {
    if (!r.ok) failed++;
    console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.name} (${r.ms.toFixed(0)} ms)`);
    if (r.details) console.log(`     ${String(r.details).replace(/\n/g, '\n     ')}`);
  }
  // Expected noise: the deliberately broken test effect and unknown types.
  const unexpected = logs.filter((l) => /\[(error|pageerror)\]/.test(l) && !/pixeltestBroken|noSuchEffect|closed|detached|VideoFrame/i.test(l));
  if (process.env.VERBOSE || unexpected.length) {
    console.log('\nbrowser console:');
    for (const l of process.env.VERBOSE ? logs : unexpected) console.log('  ' + l);
  }
  console.log(`\n${results.length - failed}/${results.length} passed`);
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
