// Screenshot tour of the hub and every Delta workspace (integration aid).
//   OMEGA_SMOKE_MEDIA=a.webm:b.wav xvfb-run -a node scripts/screenshots.mjs <outDir>
import { _electron as electron } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const out = process.argv[2];
fs.mkdirSync(out, { recursive: true });
fs.rmSync(path.join(out, 'cfg'), { recursive: true, force: true });
const app = await electron.launch({
  args: ['.', '--no-sandbox', '--disable-gpu-sandbox'],
  env: { ...process.env, OMEGA_CATALOG_URL: pathToFileURL(path.resolve('dist-modules/catalog.json')).href, XDG_CONFIG_HOME: path.join(out, 'cfg') },
});
let page = await app.firstWindow();
await page.setViewportSize?.({ width: 1600, height: 960 }).catch(() => {});
// Retry: under a virtual display the first frames can arrive before the
// compositor is ready, which fails capture with "Unable to capture screenshot".
const shot = async (p, n) => {
  for (let i = 0; i < 8; i++) {
    await p.waitForTimeout(i ? 1000 : 500);
    try { await p.screenshot({ path: path.join(out, n + '.png') }); console.log('shot', n); return; }
    catch (e) { if (i === 7) console.log('shot failed', n, e.message.split('\n')[0]); }
  }
};
const tryStep = async (name, fn) => { try { await fn(); } catch (e) { console.log('step failed:', name, e.message.split('\n')[0]); } };
page.on('pageerror', (e) => console.log('[hub error]', e.message));
await page.waitForTimeout(2500);
await shot(page, '01-hub-home');
await tryStep('apps', async () => { await page.locator('[aria-label="Apps"], button:has-text("Apps")').first().click({ timeout: 4000 }); await shot(page, '02-hub-apps'); });
await tryStep('install', async () => { await page.getByRole('button', { name: /Install/ }).first().click({ timeout: 4000 }); await page.waitForTimeout(2500); await shot(page, '03-hub-apps-installed'); });
await tryStep('home', async () => { await page.locator('[aria-label="Home"], button:has-text("Home")').first().click({ timeout: 4000 }); });
let ws = null;
await tryStep('create', async () => {
  await page.locator('.create-card, [data-testid^="hub-create"]').first().click({ timeout: 4000 });
  await page.waitForTimeout(800);
  await shot(page, '04-new-project');
  const wp = app.waitForEvent('window', { timeout: 20000 });
  await page.getByRole('button', { name: /Create project/ }).click();
  ws = await wp;
});
if (ws) {
  ws.on('pageerror', (e) => console.log('[delta error]', e.message));
  ws.on('console', (m) => m.type() === 'error' && console.log('[delta console]', m.text().slice(0, 200)));
  await ws.waitForTimeout(4000);
  await shot(ws, '05-delta-empty');
  await tryStep('import', async () => { await ws.keyboard.press('Control+i'); await ws.waitForTimeout(6000); await shot(ws, '06-delta-imported'); });
  await tryStep('place', async () => {
    const item = ws.locator('[data-testid^="md-item"], [data-testid^="md-asset"], .md-card, .md-row').first();
    await item.click({ timeout: 4000 });
    await ws.keyboard.press(',');
    await ws.waitForTimeout(1500);
    const item2 = ws.locator('[data-testid^="md-item"], [data-testid^="md-asset"], .md-card, .md-row').nth(1);
    await item2.click({ timeout: 4000 });
    await ws.keyboard.press(',');
    await ws.waitForTimeout(3000);
  });
  // Clear first-run popups so they don't cover the timeline in every shot.
  await tryStep('dismiss', async () => {
    for (const id of ['sh-onboarding-close', 'md-suggest-dismiss']) {
      const b = ws.getByTestId(id);
      if (await b.count()) await b.first().click({ timeout: 2000 });
    }
  });
  // Park the playhead 3 s in (not on the black frame past the end) and select
  // the first clip so the inspector, color and audio panels show real controls.
  await tryStep('playhead', async () => {
    await ws.keyboard.press('Home');
    for (let i = 0; i < 18; i++) await ws.keyboard.press('Shift+ArrowRight');
    await ws.waitForTimeout(1200);
  });
  await tryStep('select clip', async () => {
    const c = await ws.evaluate(() => {
      const el = document.querySelector('[data-testid="tl-clip"][data-kind="video"]') || document.querySelector('[data-testid="tl-clip"]');
      return el && { x: +el.dataset.x + +el.dataset.w / 2, y: +el.dataset.y + +el.dataset.h / 2 };
    });
    if (!c) throw new Error('no clip on the timeline');
    await ws.mouse.click(c.x, c.y);
    await ws.waitForTimeout(1500);
  });
  await shot(ws, '07-delta-edit');
  const names = ['edit', 'color', 'audio', 'effects', 'captions', 'deliver'];
  for (let i = 0; i < names.length; i++) {
    await tryStep('ws ' + names[i], async () => { await ws.keyboard.press(`Alt+${i + 1}`); await ws.waitForTimeout(2000); await shot(ws, `08-${i + 1}-${names[i]}`); });
  }
}
await app.close();
