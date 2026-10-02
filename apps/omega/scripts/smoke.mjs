// End-to-end smoke test: launches the built app under Playwright, walks the
// dashboard → new project → import → timeline → export flow, and saves
// screenshots. Run `npm run build` first.
//
//   OMEGA_SMOKE_MEDIA=/path/a.mp4:/path/b.mp4 node scripts/smoke.mjs [outDir]
import { _electron as electron } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const outDir = process.argv[2] ?? path.join(os.tmpdir(), 'omega-smoke');
fs.mkdirSync(outDir, { recursive: true });
const exportPath = path.join(outDir, 'export.mp4');
try {
  fs.rmSync(exportPath);
} catch {}

const app = await electron.launch({
  args: ['.', '--no-sandbox', '--disable-gpu-sandbox'],
  env: {
    ...process.env,
    OMEGA_SMOKE_EXPORT: exportPath,
    // isolate recents from the developer's real profile
    XDG_CONFIG_HOME: path.join(outDir, 'config'),
  },
});
const page = await app.firstWindow();
page.on('console', (m) => {
  if (['error', 'warning'].includes(m.type())) console.log(`[renderer:${m.type()}] ${m.text()}`);
});
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

const shot = async (name) => {
  await page.screenshot({ path: path.join(outDir, `${name}.png`) });
  console.log('screenshot', name);
};
const step = (msg) => console.log(`\n== ${msg}`);

step('dashboard');
await page.waitForSelector('.dash');
await page.waitForTimeout(400);
await shot('01-dashboard');

for (const tab of ['Apps', 'Plans', 'Learn']) {
  await page.getByRole('button', { name: tab, exact: true }).click();
  await page.waitForTimeout(150);
  await shot(`01-dashboard-${tab.toLowerCase()}`);
}
await page.getByRole('button', { name: 'Home', exact: true }).click();

step('new project dialog');
await page.locator('.create-card').first().click();
await page.waitForSelector('.newproj');
await shot('02-new-project');
await page.getByText('Vertical').click();
await page.getByText('Advanced settings').click();
await shot('02-new-project-advanced');
await page.getByText('Landscape').click();
const nameInput = page.locator('.newproj input').first();
await nameInput.fill('Smoke Test');
await page.getByRole('button', { name: 'Create project' }).click();

step('workspace');
await page.waitForSelector('.ws');
await page.waitForTimeout(300);
await shot('03-workspace-empty');

if (process.env.OMEGA_SMOKE_MEDIA) {
  step('import media');
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await page.waitForSelector('.media-item');
  await page.waitForTimeout(800);
  const items = page.locator('.media-item');
  const count = await items.count();
  console.log('imported', count, 'assets');
  for (let i = 0; i < count; i++) await items.nth(i).dblclick();
  await page.waitForTimeout(500);
  await shot('04-timeline');

  step('split + playback');
  await page.keyboard.press('Home');
  for (let i = 0; i < 30; i++) await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Control+k');
  await page.waitForTimeout(100);
  const clips = await page.locator('.clip').count();
  console.log('clips after split:', clips);
  if (clips <= 6) throw new Error(`split did not add clips (got ${clips})`);
  await page.locator('.clip').first().click();
  await page.keyboard.press('Space');
  await page.waitForTimeout(1200);
  await page.keyboard.press('Space');
  await page.waitForTimeout(300);
  const tc = await page.locator('.tc--big').textContent();
  console.log('timecode after playback:', tc);
  await shot('05-playback');

  step('export');
  await page.keyboard.press('Control+m');
  await page.waitForSelector('.export');
  await page.waitForFunction(() => !document.body.textContent.includes('Checking…'));
  await shot('06-export');
  await page.getByRole('button', { name: 'Export', exact: true }).last().click();
  await page.waitForSelector('.note--ok', { timeout: 180_000 });
  await shot('07-export-done');
  const size = fs.statSync(exportPath).size;
  console.log('export size', size, 'bytes at', exportPath);
  if (size < 1000) throw new Error('export file is suspiciously small');
  await page.keyboard.press('Escape');
}

step('save + back to dashboard');
await page.keyboard.press('Control+s');
await page.waitForTimeout(300);
await page.locator('.ws__left .icon-btn').first().click();
await page.waitForSelector('.recent-card');
await shot('08-dashboard-recents');

await app.close();
console.log('\nSMOKE OK →', outDir);
