// Generates small test media files (video with tone, audio-only, still image)
// using headless Chromium + Mediabunny, so the smoke test has real inputs
// without shipping binaries in the repository.
//
//   node scripts/make-test-media.mjs <outDir>
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = process.argv[2] ?? path.join(root, '.test-media');
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || findChromium(),
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage();
page.on('console', (m) => console.log('[page]', m.text()));
// WebCodecs needs a secure context; a file:// page is one, about:blank is not.
const host = path.join(outDir, '_host.html');
fs.writeFileSync(host, '<!doctype html><html><body></body></html>');
await page.goto('file://' + host);
// Load the CommonJS bundle through a tiny shim so it lands on window.M.
const cjs = fs.readFileSync(path.join(root, 'node_modules/mediabunny/dist/bundles/mediabunny.min.cjs'), 'utf8');
await page.addScriptTag({ content: `window.M = (function(){ var module = { exports: {} }; var exports = module.exports;\n${cjs}\n; return module.exports; })();` });
await page.waitForFunction(() => typeof window.M?.Output === 'function');

const files = await page.evaluate(async () => {
  const M = window.M;
  const out = {};

  async function makeVideo(name, seconds, fps, w, h, hue, freq) {
    const videoCodec = await M.getFirstEncodableVideoCodec(['avc', 'vp9', 'vp8'], { width: w, height: h });
    const audioCodec = await M.getFirstEncodableAudioCodec(['aac', 'opus'], { numberOfChannels: 2, sampleRate: 48000 });
    const mp4 = videoCodec === 'avc';
    const format = mp4 ? new M.Mp4OutputFormat({ fastStart: 'in-memory' }) : new M.WebMOutputFormat();
    const target = new M.BufferTarget();
    const output = new M.Output({ format, target });
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d');
    const vs = new M.CanvasSource(canvas, { codec: videoCodec, bitrate: 4_000_000 });
    output.addVideoTrack(vs, { frameRate: fps });
    let as = null;
    if (audioCodec) {
      as = new M.AudioBufferSource({ codec: audioCodec, bitrate: 128_000 });
      output.addAudioTrack(as);
    }
    await output.start();
    if (as) {
      const sr = 48000;
      const octx = new OfflineAudioContext(2, sr * seconds, sr);
      const osc = octx.createOscillator();
      osc.frequency.value = freq;
      const g = octx.createGain();
      g.gain.value = 0.2;
      osc.connect(g).connect(octx.destination);
      osc.start();
      const buf = await octx.startRendering();
      await as.add(buf);
      as.close();
    }
    const frames = seconds * fps;
    for (let i = 0; i < frames; i++) {
      const t = i / fps;
      ctx.fillStyle = `hsl(${hue}, 40%, 12%)`;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = `hsl(${hue}, 90%, 55%)`;
      const x = (w * 0.1) + ((w * 0.8) * ((t / seconds) % 1));
      ctx.beginPath();
      ctx.arc(x, h / 2 + Math.sin(t * 4) * h * 0.2, h * 0.12, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = `${Math.round(h * 0.1)}px sans-serif`;
      ctx.fillText(`${name}  ${t.toFixed(2)}s  f${i}`, 24, h * 0.15);
      await vs.add(t, 1 / fps);
    }
    vs.close();
    await output.finalize();
    out[`${name}.${mp4 ? 'mp4' : 'webm'}`] = Array.from(new Uint8Array(target.buffer));
  }

  await makeVideo('clip-a', 6, 30, 1280, 720, 210, 440);
  await makeVideo('clip-b', 4, 30, 1280, 720, 20, 660);

  // audio only: WAV
  {
    const sr = 48000;
    const octx = new OfflineAudioContext(2, sr * 5, sr);
    const osc = octx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = 220;
    const g = octx.createGain();
    g.gain.value = 0.15;
    osc.connect(g).connect(octx.destination);
    osc.start();
    const buf = await octx.startRendering();
    const target = new M.BufferTarget();
    const output = new M.Output({ format: new M.WavOutputFormat(), target });
    const src = new M.AudioBufferSource({ codec: 'pcm-s16' });
    output.addAudioTrack(src);
    await output.start();
    await src.add(buf);
    src.close();
    await output.finalize();
    out['music.wav'] = Array.from(new Uint8Array(target.buffer));
  }

  // still image
  {
    const c = new OffscreenCanvas(1920, 1080);
    const ctx = c.getContext('2d');
    const grad = ctx.createLinearGradient(0, 0, 1920, 1080);
    grad.addColorStop(0, '#ff0000');
    grad.addColorStop(1, '#2a0008');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 1920, 1080);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 160px sans-serif';
    ctx.fillText('Ω  still', 300, 600);
    const blob = await c.convertToBlob({ type: 'image/png' });
    out['title.png'] = Array.from(new Uint8Array(await blob.arrayBuffer()));
  }
  return out;
});

for (const [name, bytes] of Object.entries(files)) {
  const p = path.join(outDir, name);
  fs.writeFileSync(p, Buffer.from(bytes));
  console.log('wrote', p, bytes.length, 'bytes');
}
await browser.close();

function findChromium() {
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  for (const d of fs.readdirSync(base)) {
    if (d.startsWith('chromium-')) {
      const p = path.join(base, d, 'chrome-linux', 'chrome');
      if (fs.existsSync(p)) return p;
    }
  }
  throw new Error('Chromium not found; set CHROMIUM_PATH');
}
