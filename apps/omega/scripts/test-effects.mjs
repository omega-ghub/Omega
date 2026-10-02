// GLSL validation harness for the effects library (src/engine/effects/library).
//
// Bundles the library, then in headless Chromium (SwiftShader WebGL2):
//   1. compiles and links EVERY effect pass, including every pass variant that
//      `expand()` produces across a sweep of param values, and every
//      transition, using the exact shader templates of src/engine/effects/types.ts;
//   2. renders each effect at its defaults on two test images (an opaque HDR
//      scene and an alpha-matted logo) and checks for NaN/Inf, all-black and
//      fully transparent output; renders every sweep variant and checks NaN;
//   3. renders each transition at several progress values and checks that it
//      starts on the outgoing picture and ends on the incoming one.
//
//   node scripts/test-effects.mjs [--filter name] [--sheet out.png] [--verbose]
//
// Exits non-zero on any compile/link error or failed check.
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(fileURLToPath(import.meta.url), '../..');
const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const filter = opt('--filter') ?? '';
const sheetPath = opt('--sheet');
const verbose = args.includes('--verbose');
const CHROME = process.env.OMEGA_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const outDir = join(root, 'node_modules/.cache/test-effects');
mkdirSync(outDir, { recursive: true });

const bundle = await build({
  stdin: {
    contents: `
      export { EFFECTS, TRANSITIONS } from './src/engine/effects/library/index.ts';
      export { GLSL_PRELUDE, GLSL_TRANSITION_PRELUDE, PARAM_GLSL_TYPE } from './src/engine/effects/types.ts';
    `,
    resolveDir: root,
    loader: 'ts',
    sourcefile: 'fx-entry.ts',
  },
  bundle: true,
  format: 'iife',
  globalName: 'FX',
  write: false,
  platform: 'browser',
  target: 'chrome120',
  logLevel: 'error',
});
const lib = bundle.outputFiles[0].text;

// ---------------------------------------------------------------------------
// In-page runner
// ---------------------------------------------------------------------------
function pageRunner() {
  const W = 192;
  const H = 108;
  const VS = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() { v_uv = a_pos * 0.5 + 0.5; gl_Position = vec4(a_pos, 0.0, 1.0); }`;

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const gl = canvas.getContext('webgl2', { premultipliedAlpha: false, antialias: false });
  if (!gl) throw new Error('WebGL2 unavailable');
  const floatRT = !!gl.getExtension('EXT_color_buffer_float');
  gl.getExtension('OES_texture_float_linear');
  const INTERNAL = floatRT ? gl.RGBA16F : gl.RGBA8;

  const vbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const vsh = gl.createShader(gl.VERTEX_SHADER);
  gl.shaderSource(vsh, VS);
  gl.compileShader(vsh);

  function effectSource(def, glsl) {
    const uni = def.params.map((p) => `uniform ${FX.PARAM_GLSL_TYPE[p.type]} u_${p.key};`).join('\n');
    return `#version 300 es
precision highp float;
uniform sampler2D u_src;
uniform sampler2D u_orig;
uniform vec2  u_resolution;
uniform vec2  u_texel;
uniform float u_time;
uniform float u_seed;
${uni}
in vec2 v_uv;
out vec4 outColor;
${FX.GLSL_PRELUDE}
${glsl}
void main() { outColor = effect(v_uv); }`;
  }
  function transitionSource(def) {
    const uni = def.params.map((p) => `uniform ${FX.PARAM_GLSL_TYPE[p.type]} u_${p.key};`).join('\n');
    return `#version 300 es
precision highp float;
uniform sampler2D u_from, u_to;
uniform float u_progress;
uniform vec2 u_resolution, u_texel;
${uni}
in vec2 v_uv;
out vec4 outColor;
${FX.GLSL_TRANSITION_PRELUDE}
${def.glsl}
void main() { outColor = transition(v_uv); }`;
  }

  const progCache = new Map();
  function compile(src) {
    if (progCache.has(src)) return progCache.get(src);
    const fsh = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fsh, src);
    gl.compileShader(fsh);
    let res;
    if (!gl.getShaderParameter(fsh, gl.COMPILE_STATUS)) {
      res = { error: 'compile', log: gl.getShaderInfoLog(fsh) || '(no log)', src };
    } else {
      const prog = gl.createProgram();
      gl.attachShader(prog, vsh);
      gl.attachShader(prog, fsh);
      gl.bindAttribLocation(prog, 0, 'a_pos');
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) res = { error: 'link', log: gl.getProgramInfoLog(prog) || '(no log)', src };
      else res = { prog, locs: new Map() };
    }
    progCache.set(src, res);
    return res;
  }
  function loc(p, name) {
    if (!p.locs.has(name)) p.locs.set(name, gl.getUniformLocation(p.prog, name));
    return p.locs.get(name);
  }

  function makeTex(w, h, data) {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, INTERNAL, w, h, 0, gl.RGBA, floatRT ? gl.FLOAT : gl.UNSIGNED_BYTE, data ?? null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    return { tex: t, fb, w, h };
  }

  // ---- test images (premultiplied scene-linear, rows bottom-first) ----
  const s2l = (v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  function hash(x, y) {
    const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
    return s - Math.floor(s);
  }
  function sceneA(u, v) {
    // v: 0 at bottom
    const top = 1 - v;
    let r = 0.18 + 0.5 * v;
    let g = 0.3 + 0.35 * v;
    let b = 0.65 - 0.1 * v;
    [r, g, b] = [0.75 - 0.5 * v, 0.62 - 0.3 * v, 0.55 + 0.1 * v];
    if (top > 0.62) {
      const n = hash(Math.floor(u * 96), Math.floor(v * 54));
      [r, g, b] = [0.05 + 0.04 * n, 0.16 + 0.08 * n, 0.04 + 0.02 * n];
    }
    // green screen with a subject
    if (u > 0.04 && u < 0.32 && top > 0.12 && top < 0.62) {
      [r, g, b] = [0.06, 0.55, 0.12];
      const dx = (u - 0.18) / 0.07;
      const dy = (top - 0.4) / 0.2;
      if (dx * dx + dy * dy < 1) [r, g, b] = [0.62, 0.38, 0.27];
      if (Math.abs(top - 0.62 + 0.05) < 0.05 && Math.abs(u - 0.18) < 0.09) [r, g, b] = [0.12, 0.12, 0.2];
    }
    // color bars
    if (top > 0.84) {
      const bars = [[0.8, 0.8, 0.8], [0.8, 0.8, 0.05], [0.05, 0.8, 0.8], [0.05, 0.8, 0.05], [0.8, 0.05, 0.8], [0.8, 0.05, 0.05], [0.05, 0.05, 0.8], [0.02, 0.02, 0.02]];
      [r, g, b] = bars[Math.min(7, Math.floor(u * 8))];
    }
    // checker detail
    if (u > 0.4 && u < 0.6 && top > 0.15 && top < 0.45) {
      const c = (Math.floor(u * W / 3) + Math.floor(top * H / 3)) % 2;
      [r, g, b] = c ? [0.9, 0.9, 0.9] : [0.03, 0.03, 0.03];
    }
    // HDR sun
    const sx = (u - 0.78) * (W / H);
    const sy = top - 0.22;
    const d = Math.sqrt(sx * sx + sy * sy);
    if (d < 0.06) [r, g, b] = [8, 7, 5];
    else if (d < 0.12) {
      const k = (0.12 - d) / 0.06;
      r += 1.5 * k * k;
      g += 1.2 * k * k;
      b += 0.8 * k * k;
    }
    return [r, g, b, 1];
  }
  function sceneB(u, v) {
    // white logo (rounded rect + ring) with an orange core on transparent
    const top = 1 - v;
    const x = (u - 0.5) * (W / H);
    const y = top - 0.5;
    const box = Math.max(Math.abs(x) - 0.42, Math.abs(y) - 0.16);
    const ring = Math.abs(Math.sqrt(x * x + y * y) - 0.3) - 0.035;
    const dd = Math.min(box, ring);
    const a = Math.min(1, Math.max(0, 0.5 - dd * H));
    let c = [0.9, 0.9, 0.9];
    if (box < -0.06) c = [0.95, 0.35, 0.05];
    return [c[0] * a, c[1] * a, c[2] * a, a];
  }
  function sceneC(u, v) {
    // transition "to" picture: cool gradient with a circle
    const top = 1 - v;
    let [r, g, b] = [0.05 + 0.3 * u, 0.1 + 0.2 * top, 0.35];
    const dx = (u - 0.35) * (W / H);
    const dy = top - 0.55;
    if (dx * dx + dy * dy < 0.06) [r, g, b] = [0.9, 0.75, 0.2];
    return [r, g, b, 1];
  }
  function bake(fn) {
    const a = new Float32Array(W * H * 4);
    for (let j = 0; j < H; j++)
      for (let i = 0; i < W; i++) {
        const px = fn((i + 0.5) / W, (j + 0.5) / H);
        a.set(px, (j * W + i) * 4);
      }
    return a;
  }
  const images = { A: bake(sceneA), B: bake(sceneB), C: bake(sceneC) };
  const texA = makeTex(W, H, images.A);
  const texB = makeTex(W, H, images.B);
  const texC = makeTex(W, H, images.C);
  const texBlank = makeTex(W, H, new Float32Array(W * H * 4));
  const ping = [makeTex(W, H), makeTex(W, H)];
  const scaled = new Map();
  function target(scale, idx) {
    if (!scale || scale === 1) return ping[idx];
    const key = `${scale}|${idx}`;
    if (!scaled.has(key)) scaled.set(key, makeTex(Math.max(1, Math.round(W * scale)), Math.max(1, Math.round(H * scale))));
    return scaled.get(key);
  }

  function parseColor(v) {
    const s = String(v).replace('#', '');
    if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(s)) return null;
    const n = (i) => parseInt(s.slice(i, i + 2), 16) / 255;
    return [s2l(n(0)), s2l(n(2)), s2l(n(4)), s.length === 8 ? n(6) : 1];
  }
  function setParam(p, def, value, overrides) {
    const l = loc(p, `u_${def.key}`);
    if (!l) return;
    const v = value;
    switch (def.type) {
      case 'number':
      case 'angle':
        gl.uniform1f(l, Number(v));
        break;
      case 'bool':
        gl.uniform1f(l, v === true || v === 1 || v === '1' || v === 'true' ? 1 : 0);
        break;
      case 'choice': {
        const idx = (def.choices ?? []).findIndex((c) => c.value === Number(v));
        gl.uniform1i(l, idx >= 0 ? idx : Number(v) | 0);
        break;
      }
      case 'color': {
        const c = overrides?.colorRaw ?? parseColor(v) ?? [0, 0, 0, 1];
        gl.uniform4f(l, c[0], c[1], c[2], c[3]);
        break;
      }
      case 'point': {
        const [x, y] = String(v).split(',').map(Number);
        gl.uniform2f(l, x, y);
        break;
      }
    }
  }

  function readback(t) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fb);
    const out = new Float32Array(t.w * t.h * 4);
    gl.readPixels(0, 0, t.w, t.h, gl.RGBA, gl.FLOAT, out);
    return out;
  }

  /** Runs a list of passes on an input texture; returns the final target. */
  function runEffect(def, passes, params, input, time = 1.25, seed = 0.37) {
    let srcTex = input;
    let flip = 0;
    for (const ps of passes) {
      const c = compile(effectSource(def, ps.glsl));
      if (c.error) throw new Error(`${c.error} error`);
      let tgt = target(ps.scale, flip);
      if (tgt === srcTex) {
        flip = 1 - flip;
        tgt = target(ps.scale, flip);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, tgt.fb);
      gl.viewport(0, 0, tgt.w, tgt.h);
      gl.useProgram(c.prog);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, srcTex.tex);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, input.tex);
      const l1 = loc(c, 'u_src');
      if (l1) gl.uniform1i(l1, 0);
      const l2 = loc(c, 'u_orig');
      if (l2) gl.uniform1i(l2, 1);
      // u_resolution is the LAYER size for every pass (pass.scale only changes the target)
      const lr = loc(c, 'u_resolution');
      if (lr) gl.uniform2f(lr, W, H);
      const lt = loc(c, 'u_texel');
      if (lt) gl.uniform2f(lt, 1 / W, 1 / H);
      const ltime = loc(c, 'u_time');
      if (ltime) gl.uniform1f(ltime, time);
      const lseed = loc(c, 'u_seed');
      if (lseed) gl.uniform1f(lseed, seed);
      for (const pd of def.params) setParam(c, pd, params[pd.key] ?? pd.default);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      srcTex = tgt;
      flip = 1 - flip;
    }
    return srcTex;
  }

  function runTransition(def, params, progress, from, to, overrides) {
    const c = compile(transitionSource(def));
    if (c.error) throw new Error(`${c.error} error`);
    const tgt = ping[0];
    gl.bindFramebuffer(gl.FRAMEBUFFER, tgt.fb);
    gl.viewport(0, 0, W, H);
    gl.useProgram(c.prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, from.tex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, to.tex);
    const lf = loc(c, 'u_from');
    if (lf) gl.uniform1i(lf, 0);
    const lto = loc(c, 'u_to');
    if (lto) gl.uniform1i(lto, 1);
    const lp = loc(c, 'u_progress');
    if (lp) gl.uniform1f(lp, progress);
    const lr = loc(c, 'u_resolution');
    if (lr) gl.uniform2f(lr, W, H);
    const lt = loc(c, 'u_texel');
    if (lt) gl.uniform2f(lt, 1 / W, 1 / H);
    for (const pd of def.params) setParam(c, pd, params[pd.key] ?? pd.default, pd.type === 'color' ? overrides : undefined);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    return tgt;
  }

  function stats(px, ref) {
    let nan = 0;
    let maxRGB = 0;
    let maxA = 0;
    let maxAbs = 0;
    let diff = 0;
    for (let i = 0; i < px.length; i++) {
      const v = px[i];
      if (!Number.isFinite(v)) {
        nan++;
        continue;
      }
      if (i % 4 === 3) maxA = Math.max(maxA, v);
      else maxRGB = Math.max(maxRGB, v);
      maxAbs = Math.max(maxAbs, Math.abs(v));
      if (ref) diff = Math.max(diff, Math.abs(v - ref[i]) / (1 + Math.abs(ref[i])));
    }
    return { nan, maxRGB, maxA, maxAbs, diff };
  }

  // tone-mapped RGBA8 tile for the contact sheet (composited over a checker)
  function tile(px, w, h) {
    const out = new Uint8ClampedArray(w * h * 4);
    const enc = (x) => {
      x = Math.max(0, x);
      x = x / (1 + x * 0.12); // gentle highlight roll-off
      return 255 * (x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055);
    };
    for (let j = 0; j < h; j++)
      for (let i = 0; i < w; i++) {
        const si = ((h - 1 - j) * w + i) * 4;
        const di = (j * w + i) * 4;
        const bg = ((i >> 3) + (j >> 3)) % 2 ? 0.16 : 0.1;
        const a = Math.min(1, Math.max(0, px[si + 3]));
        for (let k = 0; k < 3; k++) out[di + k] = enc(px[si + k] + bg * (1 - a));
        out[di + 3] = 255;
      }
    return out;
  }

  function sweepParams(def) {
    const base = Object.fromEntries(def.params.map((p) => [p.key, p.default]));
    const list = [base];
    for (const p of def.params) {
      if (p.type === 'number' || p.type === 'angle') {
        for (const v of [p.min, p.softMin, p.softMax, p.max]) if (v !== undefined) list.push({ ...base, [p.key]: v });
        list.push({ ...base, [p.key]: (Number(p.default) || 1) * 3.7 });
      } else if (p.type === 'choice') {
        for (const c of p.choices ?? []) list.push({ ...base, [p.key]: c.value });
      } else if (p.type === 'bool') {
        list.push({ ...base, [p.key]: !p.default });
      } else if (p.type === 'point') {
        list.push({ ...base, [p.key]: '0.1,0.9' });
      } else if (p.type === 'color') {
        list.push({ ...base, [p.key]: '#ff2040' });
      }
    }
    return list;
  }

  function formatLog(c) {
    const lines = c.src.split('\n');
    const nums = [...c.log.matchAll(/ERROR: \d+:(\d+)/g)].map((m) => Number(m[1]));
    const ctx = [...new Set(nums)]
      .slice(0, 4)
      .map((n) => lines.slice(Math.max(0, n - 3), n + 1).map((l, i) => `${String(Math.max(1, n - 2) + i).padStart(4)}| ${l}`).join('\n'))
      .join('\n   ...\n');
    return `${c.log.trim()}\n${ctx}`;
  }

  window.runAll = function runAll({ filter, wantSheet }) {
    const report = { effects: [], transitions: [], programs: 0, failures: [], notes: [], sheet: [] };
    const fail = (msg) => report.failures.push(msg);
    const note = (msg) => report.notes.push(msg);
    const inA = readback(texA);
    const inB = readback(texB);
    const inC = readback(texC);

    const types = new Set();
    for (const def of FX.EFFECTS) {
      if (types.has(def.type)) fail(`duplicate effect type ${def.type}`);
      types.add(def.type);
      if (filter && !def.type.toLowerCase().includes(filter.toLowerCase())) continue;
      const entry = { type: def.type, passes: 0, variants: 0 };
      report.effects.push(entry);
      // param sanity
      const keys = new Set();
      for (const p of def.params) {
        if (!/^[a-zA-Z][a-zA-Z0-9]*$/.test(p.key)) fail(`${def.type}: bad param key ${p.key}`);
        if (keys.has(p.key)) fail(`${def.type}: duplicate param ${p.key}`);
        keys.add(p.key);
        if (p.type === 'choice' && !(p.choices ?? []).length) fail(`${def.type}.${p.key}: choice without choices`);
        if ((p.type === 'number' || p.type === 'angle') && typeof p.default !== 'number') fail(`${def.type}.${p.key}: non-numeric default`);
        if ((p.type === 'number' || p.type === 'angle') && ((p.min !== undefined && p.default < p.min) || (p.max !== undefined && p.default > p.max))) fail(`${def.type}.${p.key}: default outside min/max`);
      }
      if (!def.passes.length) fail(`${def.type}: no static passes`);
      // collect every pass variant
      const variants = new Map();
      for (const ps of def.passes) variants.set(ps.glsl, ps);
      const sweeps = sweepParams(def);
      const runs = [];
      for (const sp of sweeps) {
        let passes = def.passes;
        if (def.expand) {
          try {
            passes = def.expand(sp, { w: W, h: H });
          } catch (e) {
            fail(`${def.type}: expand threw: ${e.message}`);
            continue;
          }
          if (!passes.length) fail(`${def.type}: expand returned no passes for ${JSON.stringify(sp)}`);
          const again = def.expand(sp, { w: W, h: H });
          if (again.some((p, i) => p !== passes[i])) note(`${def.type}: expand returns new pass objects each call (cache them)`);
        }
        for (const ps of passes) variants.set(ps.glsl, ps);
        runs.push({ params: sp, passes });
      }
      let ok = true;
      for (const [srcGlsl] of variants) {
        const c = compile(effectSource(def, srcGlsl));
        report.programs++;
        if (c.error) {
          ok = false;
          fail(`${def.type}: ${c.error} error\n${formatLog(c)}`);
        }
      }
      entry.passes = def.passes.length;
      entry.variants = variants.size;
      if (!ok) continue;
      // defaults on both images
      const t0 = performance.now();
      const defaults = runs[0];
      for (const [name, tex, ref] of [
        ['A', texA, inA],
        ['B', texB, inB],
      ]) {
        const out = runEffect(def, defaults.passes, defaults.params, tex);
        const px = readback(out);
        const st = stats(px, out.w === W ? ref : null);
        if (st.nan) fail(`${def.type}: ${st.nan} NaN/Inf values at defaults on image ${name}`);
        if (name === 'A' && st.maxRGB < 1e-4) fail(`${def.type}: all black at defaults`);
        if (name === 'A' && st.maxA < 1e-4) fail(`${def.type}: fully transparent at defaults`);
        if (st.maxAbs > 1e4) fail(`${def.type}: runaway values (${st.maxAbs}) on image ${name}`);
        if (name === 'A' && st.diff < 1e-3) note(`${def.type}: identity at defaults`);
        if (wantSheet) report.sheet.push({ label: `${def.type}${name === 'B' ? ' (alpha)' : ''}`, rgba: Array.from(tile(px, out.w, out.h)), w: out.w, h: out.h, alpha: name === 'B' });
      }
      entry.ms = Math.round(performance.now() - t0);
      // sweeps: NaN only
      for (const r of runs.slice(1)) {
        const px = readback(runEffect(def, r.passes, r.params, texA, 3.3, 0.71));
        const st = stats(px);
        if (st.nan) fail(`${def.type}: NaN/Inf with ${JSON.stringify(r.params)}`);
      }
    }

    const ttypes = new Set();
    for (const def of FX.TRANSITIONS) {
      if (ttypes.has(def.type)) fail(`duplicate transition type ${def.type}`);
      ttypes.add(def.type);
      if (filter && !def.type.toLowerCase().includes(filter.toLowerCase())) continue;
      report.transitions.push({ type: def.type });
      const c = compile(transitionSource(def));
      report.programs++;
      if (c.error) {
        fail(`transition ${def.type}: ${c.error} error\n${formatLog(c)}`);
        continue;
      }
      for (const p of def.params) {
        if (p.type === 'point') fail(`transition ${def.type}.${p.key}: point params cannot be stored in Transition.params (numbers only)`);
      }
      // the frame graph fills defaults with Number(default): mirror that for non-colors
      const base = Object.fromEntries(def.params.map((p) => [p.key, p.type === 'color' ? p.default : Number(p.default)]));
      const sweeps = [base];
      for (const p of def.params) {
        if (p.type === 'choice') for (const ch of p.choices ?? []) sweeps.push({ ...base, [p.key]: ch.value });
        if (p.type === 'number' || p.type === 'angle') for (const v of [p.min, p.max]) if (v !== undefined) sweeps.push({ ...base, [p.key]: v });
      }
      const colorVariants = def.params.some((p) => p.type === 'color') ? [undefined, { colorRaw: [NaN, NaN, NaN, NaN] }, { colorRaw: [0, 0, 0, 0] }] : [undefined];
      let si = 0;
      for (const sp of sweeps) {
        for (const ov of colorVariants) {
          for (const prog of [0, 0.25, 0.5, 0.75, 1]) {
            const px = readback(runTransition(def, sp, prog, texA, texC, ov));
            const st = stats(px);
            if (st.nan) fail(`transition ${def.type}: NaN at p=${prog} ${JSON.stringify(sp)}${ov ? ' (unset color)' : ''}`);
            if (prog === 0) {
              const d = stats(px, inA).diff;
              if (d > 0.02) fail(`transition ${def.type}: p=0 does not match the outgoing picture (max diff ${d.toFixed(3)}) ${JSON.stringify(sp)}`);
            }
            if (prog === 1) {
              const d = stats(px, inC).diff;
              if (d > 0.02) fail(`transition ${def.type}: p=1 does not match the incoming picture (max diff ${d.toFixed(3)}) ${JSON.stringify(sp)}`);
            }
            if (wantSheet && si === 0 && !ov && (prog === 0.25 || prog === 0.5 || prog === 0.75)) report.sheet.push({ label: `${def.type} ${prog}`, rgba: Array.from(tile(px, W, H)), w: W, h: H });
          }
        }
        si++;
      }
      // from transparent (no previous clip)
      for (const prog of [0.3, 0.7]) {
        const st = stats(readback(runTransition(def, base, prog, texBlank, texC)));
        if (st.nan) fail(`transition ${def.type}: NaN from a transparent input at p=${prog}`);
      }
    }
    return report;
  };
  window.__ready = true;
}

const html = `<!doctype html><meta charset="utf-8"><title>fx test</title><body><script>${lib}</script><script>(${pageRunner.toString()})();</script></body>`;
const htmlPath = join(outDir, 'index.html');
writeFileSync(htmlPath, html);

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
let exitCode = 0;
try {
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') pageErrors.push(m.text());
  });
  await page.goto(pathToFileURL(htmlPath).href);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 30000 });
  const t0 = Date.now();
  const report = await page.evaluate((o) => window.runAll(o), { filter, wantSheet: !!sheetPath });
  const secs = ((Date.now() - t0) / 1000).toFixed(1);

  if (verbose) {
    for (const e of report.effects) console.log(`  effect ${e.type.padEnd(22)} passes ${String(e.passes).padStart(2)}  variants ${String(e.variants).padStart(3)}  ${e.ms ?? '-'} ms`);
    for (const t of report.transitions) console.log(`  transition ${t.type}`);
  }
  for (const n of report.notes) console.log(`note: ${n}`);
  for (const e of pageErrors) report.failures.push(`page error: ${e}`);
  console.log(`\n${report.effects.length} effects, ${report.transitions.length} transitions, ${report.programs} programs compiled in ${secs}s`);
  if (report.failures.length) {
    console.log(`\n${report.failures.length} FAILURE(S):`);
    for (const f of report.failures) console.log(`\n✗ ${f}`);
    exitCode = 1;
  } else {
    console.log('all effect passes and transitions compile, link and render cleanly');
  }

  if (sheetPath && report.sheet.length) {
    const sheetFile = resolve(sheetPath);
    const dataUrl = await page.evaluate((tiles) => {
      const cols = 8;
      const tw = 192;
      const th = 108 + 16;
      const c = document.createElement('canvas');
      c.width = cols * tw;
      c.height = Math.ceil(tiles.length / cols) * th;
      const x = c.getContext('2d');
      x.fillStyle = '#111';
      x.fillRect(0, 0, c.width, c.height);
      tiles.forEach((t, i) => {
        const id = new ImageData(new Uint8ClampedArray(t.rgba), t.w, t.h);
        const ox = (i % cols) * tw;
        const oy = Math.floor(i / cols) * th;
        const tmp = document.createElement('canvas');
        tmp.width = t.w;
        tmp.height = t.h;
        tmp.getContext('2d').putImageData(id, 0, 0);
        x.drawImage(tmp, ox, oy + 16, 192, 108);
        x.fillStyle = '#ddd';
        x.font = '11px sans-serif';
        x.fillText(t.label, ox + 4, oy + 12);
      });
      return c.toDataURL('image/png');
    }, report.sheet);
    writeFileSync(sheetFile, Buffer.from(dataUrl.split(',')[1], 'base64'));
    console.log(`contact sheet: ${sheetFile}`);
  }
} finally {
  await browser.close();
}
process.exit(exitCode);
