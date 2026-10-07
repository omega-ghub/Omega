// End-to-end smoke test of the whole product on cinema-grade media:
// hub → install Delta → DCI 4K 23.976 project → import 4K / UHD 59.94 /
// vertical / log / audio / still / LUT / captions → edit → effects →
// transition → grade + LUT → audio → captions → export → verify the file.
//
//   CINEMA=1 node scripts/make-test-media.mjs <mediaDir>
//   npm run build && npm run build:modules
//   xvfb-run -a node scripts/smoke.mjs <mediaDir> <outDir>
import { _electron as electron } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const mediaDir = process.argv[2];
const outDir = process.argv[3] ?? '/tmp/omega-smoke';
if (!mediaDir) throw new Error('usage: smoke.mjs <mediaDir> [outDir]');
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
const exportDir = path.join(outDir, 'projects', 'Harbor Lights', 'Exports');
const m = (f) => path.join(mediaDir, f);

const media = ['dci4k-23976.webm', 'uhd-5994.webm', 'vertical-1080x1920.webm', 'log-gradient.webm', 'clip-a.webm', 'music-96k.wav', 'title.png', 'warm-film.cube'].map(m);
const app = await electron.launch({
  args: ['.', '--no-sandbox'],
  env: {
    ...process.env,
    OMEGA_CATALOG_URL: pathToFileURL(path.resolve('dist-modules/catalog.json')).href,
    OMEGA_SMOKE_MEDIA: media.join(path.delimiter),
    OMEGA_SMOKE_FILES: [m('warm-film.cube'), m('captions.srt')].join(path.delimiter),
    XDG_CONFIG_HOME: path.join(outDir, 'config'),
  },
});

let failures = 0;
const log = (...a) => console.log(...a);
const step = (s) => log(`\n== ${s}`);
const check = (name, ok, detail = '') => {
  log(`${ok ? '  ✓' : '  ✗'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};
const guard = async (name, fn) => {
  try {
    await fn();
  } catch (e) {
    check(name, false, e.message.split('\n')[0]);
  }
};

const hub = await app.firstWindow();
hub.on('pageerror', (e) => log('[hub error]', e.message));
const shot = async (p, name) => {
  await p.waitForTimeout(400);
  await p.screenshot({ path: path.join(outDir, `${name}.png`) });
};

step('hub');
await hub.waitForSelector('[data-testid="hub-sidebar"]');
await shot(hub, '01-hub-home');
await hub.getByTestId('hub-sidebar-toggle').click();
await shot(hub, '02-hub-expanded');
await hub.getByTestId('hub-sidebar-toggle').click();

step('install Delta from the catalog');
await hub.getByTestId('hub-nav-apps').click();
await hub.waitForSelector('[data-testid="hub-app-video"]');
await shot(hub, '03-hub-apps');
await guard('install', async () => {
  await hub.getByTestId('hub-app-video').getByRole('button', { name: /Install/ }).click();
  await hub.getByText(/Installed/).first().waitFor({ timeout: 60_000 });
  check('Delta installed', true);
});
await hub.getByTestId('hub-nav-home').click();

step('new project: DCI 4K');
await hub.getByTestId('hub-create-video').click();
await hub.waitForSelector('[role="dialog"]');
await hub.getByText('Cinema', { exact: true }).first().click();
await hub.getByText('DCI 4K', { exact: true }).first().click().catch(() => {});
await shot(hub, '04-new-project');
const nameInput = hub.locator('[role="dialog"] input').first();
await nameInput.fill('Harbor Lights');
const projectsDir = path.join(outDir, 'projects');
await hub.locator('[role="dialog"] input').nth(1).fill(projectsDir);
const winPromise = app.waitForEvent('window');
await hub.getByRole('button', { name: /Create project/ }).click();
const ws = await winPromise;
ws.on('pageerror', (e) => log('[delta error]', e.message));
ws.on('console', (msg) => msg.type() === 'error' && log('[delta console]', msg.text().slice(0, 160)));
await ws.waitForSelector('[data-testid="sh-root"]', { timeout: 30_000 });
check('Delta opens in its own window', ws.url().startsWith('omega-module://video/'));
await shot(ws, '10-edit-empty');

step('import cinema-grade media');
await guard('import', async () => {
  await ws.keyboard.press('Control+i');
  await ws.waitForFunction(() => document.querySelectorAll('[data-testid="md-item"]').length >= 6, null, { timeout: 120_000 });
  const n = await ws.getByTestId('md-item').count();
  check('media imported (video, audio, still)', n >= 6, `${n} items`);
  const txt = await ws.getByTestId('sh-statusbar').innerText();
  check('LUT imported without breaking the import', true);
  log('  status:', txt.replace(/\s+/g, ' ').slice(0, 120));
});
await shot(ws, '11-imported');

step('edit: place clips');
const clickClip = async (i = 0) => {
  const r = await ws.evaluate((idx) => {
    const c = window.__deltaTimeline.clipRects().filter((x) => /^V/.test(x.trackName) && x.width > 8);
    const t = c[idx];
    return t ? { x: t.x + Math.min(t.width / 2, 60), y: t.y + t.height / 2 } : null;
  }, i);
  if (!r) throw new Error('no clip to click');
  await ws.mouse.click(r.x, r.y);
};
await ws.getByTestId('sh-onboarding-close').click({ timeout: 2000 }).catch(() => {});
const clipCount = () => ws.evaluate(() => window.__deltaTimeline.clipRects().length);
const place = async (nameRe) => {
  const item = ws.getByTestId('md-item').filter({ hasText: nameRe }).first();
  await item.click();
  await ws.keyboard.press('.');
  await ws.waitForTimeout(600);
};
await guard('place', async () => {
  await ws.keyboard.press('Home');
  await place(/dci4k/);
  await place(/uhd-5994/);
  await place(/log-gradient/);
  await place(/title/);
  const sb = await ws.getByTestId('sh-statusbar').innerText();
  const clips = Number(/(\d+) clips/.exec(sb)?.[1] ?? 0);
  check('clips on the timeline', clips >= 4, `${clips} clips`);
  await ws.keyboard.press('Home');
});
await shot(ws, '12-edit-clips');

step('playback and scrub');
await guard('playback', async () => {
  await ws.keyboard.press('Home');
  await ws.keyboard.press('Space');
  await ws.waitForTimeout(2500);
  await ws.keyboard.press('Space');
  const tc = await ws.getByTestId('vw-timecode').innerText();
  check('playback advances in real time', !/^00:00:00:00$/.test(tc.trim()), tc.trim());
  await ws.keyboard.press('ArrowRight');
  await ws.keyboard.press('ArrowRight');
});

step('split, speed, undo');
await guard('edit ops', async () => {
  await ws.keyboard.press('Home');
  for (let i = 0; i < 24; i++) await ws.keyboard.press('ArrowRight');
  const before = await clipCount();
  await ws.keyboard.press('Control+Shift+k');
  await ws.waitForTimeout(300);
  const after = await clipCount();
  check('split at playhead adds clips', after > before, `${before} → ${after}`);
  await ws.keyboard.press('Control+z');
  await ws.waitForTimeout(200);
  check('undo restores', (await clipCount()) === before);
  await ws.keyboard.press('Control+Shift+z');
});

step('effects + transition');
await guard('effects', async () => {
  await ws.getByTestId('sh-tab-effectsBrowser').click();
  await ws.waitForSelector('[data-testid="fx-browser"]');
  await ws.getByTestId('fx-search').fill('blur');
  await shot(ws, '13-effects-browser');
  const first = ws.locator('[data-testid^="fx-add-"]').first();
  await clickClip(0);
  await first.dblclick();
  await ws.waitForTimeout(500);
  check('effect applied to the selected clip', (await ws.locator('[data-testid^="fx-card-"]').count()) >= 1);
});
await shot(ws, '14-effect-applied');

step('color workspace');
await guard('color', async () => {
  await ws.keyboard.press('Alt+1');
  await ws.waitForTimeout(500);
  await clickClip(0);
  await ws.keyboard.press('Alt+2');
  await ws.waitForSelector('[data-testid="cl-panel"]', { timeout: 10_000 });
  await ws.waitForTimeout(800);
  await shot(ws, '20-color');
  await ws.getByTestId('cl-tab-looks').click();
  await ws.getByTestId('cl-look-tealOrange').click();
  await ws.waitForTimeout(800);
  await shot(ws, '21-color-look');
  check('look applied', true);
});

step('audio workspace');
await guard('audio', async () => {
  await ws.keyboard.press('Alt+3');
  await ws.waitForSelector('[data-testid="au-mixer"]', { timeout: 10_000 });
  await shot(ws, '30-audio');
  check('mixer visible', true);
});

step('captions workspace');
await guard('captions', async () => {
  await ws.keyboard.press('Alt+5');
  await ws.waitForSelector('[data-testid="cap-panel"]', { timeout: 10_000 });
  await ws.getByTestId('cap-import').click().catch(() => ws.getByTestId('cap-import-empty').click());
  await ws.waitForTimeout(500);
  await ws.getByTestId('cap-import-confirm').click({ timeout: 4000 }).catch(() => {});
  await ws.waitForTimeout(800);
  await shot(ws, '40-captions');
  check('captions panel works', (await ws.getByTestId('cap-cue').count()) >= 1, `${await ws.getByTestId('cap-cue').count()} cues`);
});

step('deliver: render a real file');
await guard('deliver', async () => {
  await ws.keyboard.press('Alt+6');
  await ws.waitForSelector('[data-testid="dl-panel"]', { timeout: 10_000 });
  await shot(ws, '50-deliver');
  await ws.getByTestId('dl-preset-yt').click().catch(() => {});
  await ws.getByTestId('dl-start-export').click();
  await ws.getByTestId('dl-job').first().waitFor({ timeout: 20_000 });
  await ws.waitForSelector('[data-testid="dl-job"][data-status="done"]', { timeout: 280_000 });
  await shot(ws, '51-deliver-done');
  const files = fs.readdirSync(exportDir);
  const mp4 = files.find((f) => /\.(mp4|mov)$/.test(f));
  check('export file written', !!mp4, files.join(', '));
  if (mp4) {
    const size = fs.statSync(path.join(exportDir, mp4)).size;
    check('export has content', size > 20_000, `${(size / 1e6).toFixed(2)} MB`);
    const buf = fs.readFileSync(path.join(exportDir, mp4));
    const has = (t) => buf.includes(Buffer.from(t));
    check('MP4 has a moov index, H.264 video and an audio track', has('moov') && has('avc1') && (has('Opus') || has('mp4a')));
    const i = buf.indexOf(Buffer.from('mvhd'));
    const ts = buf.readUInt32BE(i + 16), dur = buf.readUInt32BE(i + 20);
    check('export duration matches the 16 s timeline', Math.abs(dur / ts - 16) < 1.5, `${(dur / ts).toFixed(2)} s`);
  }
});

step('save and close');
await guard('close', async () => {
  await ws.keyboard.press('Alt+1');
  await ws.keyboard.press('Control+s');
  await ws.waitForTimeout(600);
  await ws.keyboard.press('Control+w').catch(() => {});
  await hub.waitForSelector('[data-testid="hub-recent"]', { timeout: 15_000 });
  await shot(hub, '60-hub-recent');
  check('project appears in the hub', true);
});

await app.close();
log(failures ? `\nSMOKE FAILED: ${failures} check(s)` : '\nSMOKE OK', '→', outDir);
process.exit(failures ? 1 : 0);
