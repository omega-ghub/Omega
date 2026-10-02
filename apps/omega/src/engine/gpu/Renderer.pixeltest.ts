// Pixel tests for the WebGL2 compositor. Runs in a real browser (headless
// Chromium + SwiftShader) via `npm run test:gpu` (scripts/test-gpu.mjs).
// OWNED BY THE RENDERER PACKAGE. Not a unit test: it needs WebGL2 and a DOM.

import { Renderer, type PixelReadback, type RenderOptions } from './Renderer';
import { compositePremul, BLEND_MODES } from './blend';
import type { FrameGraph, GraphItem, LayerNode, LayerSource, TransitionNode, CaptionNode } from '../render/graph';
import type { FrameImage, FrameProvider } from '../render/frames';
import { defaultCaptionStyle, defaultCrop, defaultGrade, defaultTextProps, defaultTransform, makeMask } from '../../state/defaults';
import type { BlendMode, ColorGrade, ColorSpace, InputTransform, Mask, Transform, TransitionType } from '../../state/types';
import { registerEffect, getTransition } from '../effects/registry';
import { identityLut, parseCube, setLoadedLut, writeCube } from '../color/lut';
import { gradePixel } from '../color/grade';
import { bt709InvOetf, bt709Oetf, decodeInputRgb, encodeInputRgb, outputEncodeRgb, srgbDecode, type OutputSpace, type Vec3 } from '../color/transforms';

// ---------------------------------------------------------------------------
// tiny test framework
// ---------------------------------------------------------------------------

interface Result {
  name: string;
  ok: boolean;
  ms: number;
  details: string;
}
const results: Result[] = [];
const tests: { name: string; fn: () => Promise<string | void> | string | void }[] = [];
const test = (name: string, fn: () => Promise<string | void> | string | void) => tests.push({ name, fn });

class Fail extends Error {}
function check(cond: boolean, msg: string): asserts cond {
  if (!cond) throw new Fail(msg);
}
function near(a: number, b: number, tol: number, msg: string) {
  check(Math.abs(a - b) <= tol, `${msg}: expected ${b.toFixed(3)} ±${tol}, got ${a.toFixed(3)}`);
}

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

const W = 128;
const H = 72;

function canvas(w: number, h: number, draw: (c: CanvasRenderingContext2D) => void): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const x = c.getContext('2d')!;
  draw(x);
  return c;
}
const rgbCss = (c: number[]) => `rgb(${c[0]},${c[1]},${c[2]})`;
const solid = (w: number, h: number, c: number[]) =>
  canvas(w, h, (x) => {
    x.fillStyle = rgbCss(c);
    x.fillRect(0, 0, w, h);
  });

function layer(clipId: string, source: LayerSource | null, over: Partial<LayerNode> = {}): LayerNode {
  return {
    type: 'layer',
    clipId,
    trackId: 't',
    adjustment: false,
    source,
    local: 0,
    transform: defaultTransform(),
    crop: defaultCrop(),
    masks: [],
    opacity: 1,
    blend: 'normal',
    effects: [],
    grade: null,
    inputTransform: 'rec709',
    seed: 0.5,
    ...over,
  };
}
function media(clipId: string, img: { width: number; height: number }, over: Partial<LayerNode> = {}, assetId = clipId): LayerNode {
  return layer(clipId, { kind: 'media', assetId, sourceTime: 0, width: img.width, height: img.height, isStill: true }, over);
}
function graph(items: GraphItem[], o: { w?: number; h?: number; colorSpace?: ColorSpace; background?: string; captions?: CaptionNode[] } = {}): FrameGraph {
  return { width: o.w ?? W, height: o.h ?? H, t: 0, background: o.background ?? '#000000', colorSpace: o.colorSpace ?? 'rec709', items, captions: o.captions ?? [] };
}
function provider(map: Record<string, FrameImage>): FrameProvider {
  return { frame: (assetId) => map[assetId] ?? null };
}
function tf(over: Partial<Transform>): Transform {
  return { ...defaultTransform(), ...over };
}
function grade(over: Partial<ColorGrade>): ColorGrade {
  return { ...defaultGrade(), ...over };
}

const mainCanvas = document.createElement('canvas');
document.body.appendChild(mainCanvas);
const R = new Renderer(mainCanvas);

function draw(g: FrameGraph, frames: FrameProvider, opts: RenderOptions = {}, size: [number, number] = [g.width, g.height], r: Renderer = R): PixelReadback {
  r.setSize(size[0], size[1]);
  r.render(g, frames, opts);
  return r.readPixels(size[0]);
}
function at(rb: PixelReadback, x: number, y: number): number[] {
  const i = (Math.round(y) * rb.width + Math.round(x)) * 4;
  return Array.from(rb.data.slice(i, i + 4));
}
const code = (v: number) => Math.min(Math.max(v, 0), 1) * 255;
/** Expected display code for a scene-linear color in an output space. */
const expectOut = (space: OutputSpace, lin: Vec3) => outputEncodeRgb(space, lin).map(code);
function nearRgb(got: number[], exp: number[], tol: number, msg: string) {
  for (let i = 0; i < 3; i++) near(got[i], exp[i], tol, `${msg} [${'rgb'[i]}]`);
}
const lin709 = (c: number[]): Vec3 => [bt709InvOetf(c[0] / 255), bt709InvOetf(c[1] / 255), bt709InvOetf(c[2] / 255)];

// ---------------------------------------------------------------------------
// tests
// ---------------------------------------------------------------------------

test('context: WebGL2 with float intermediates', () => {
  const i = R.info;
  check(i.backend === 'webgl2', `backend ${i.backend}`);
  check(i.format === 'RGBA16F' || i.format === 'RGBA32F', `format ${i.format}`);
  return `backend=${i.backend} format=${i.format} floatLinear=${i.floatLinear} maxTex=${i.maxTextureSize}`;
});

test('50% grey round-trips through rec709 within ±1 code value', () => {
  const src = solid(W, H, [128, 128, 128]);
  const rb = draw(graph([media('a', src)]), provider({ a: src }));
  let maxErr = 0;
  for (let i = 0; i < rb.data.length; i += 4) for (let c = 0; c < 3; c++) maxErr = Math.max(maxErr, Math.abs(rb.data[i + c] - 128));
  check(maxErr <= 1, `max error ${maxErr}`);
  // sRGB source in an sRGB sequence, and a graphics solid in rec709
  const rb2 = draw(graph([media('a', src, { inputTransform: 'srgb' })], { colorSpace: 'srgb' }), provider({ a: src }));
  nearRgb(at(rb2, 64, 36), [128, 128, 128], 1, 'srgb');
  const rb3 = draw(graph([layer('s', { kind: 'solid', color: '#808080', width: W, height: H }, { inputTransform: 'srgb' })]), provider({}));
  nearRgb(at(rb3, 64, 36), [128, 128, 128], 1, 'solid #808080');
  return `max |error| over frame = ${maxErr} code values; sRGB→sRGB ${at(rb2, 64, 36).slice(0, 3)}; solid ${at(rb3, 64, 36).slice(0, 3)}`;
});

test('every 8-bit code value round-trips (rec709 → rec709)', () => {
  const src = canvas(256, 1, (x) => {
    for (let i = 0; i < 256; i++) {
      x.fillStyle = rgbCss([i, i, i]);
      x.fillRect(i, 0, 1, 1);
    }
  });
  const rb = draw(graph([media('ramp', src, { transform: tf({ fit: 'stretch' }) })], { w: 256, h: 1 }), provider({ ramp: src }));
  let maxErr = 0;
  let exact = 0;
  for (let i = 0; i < 256; i++) {
    const e = Math.abs(rb.data[i * 4] - i);
    maxErr = Math.max(maxErr, e);
    if (e === 0) exact++;
  }
  check(maxErr <= 1, `max error ${maxErr}`);
  return `max |error| ${maxErr}, exact ${exact}/256`;
});

test('exposure +1 doubles linear light', () => {
  const src = solid(W, H, [90, 90, 90]);
  const rb = draw(graph([media('a', src, { grade: grade({ exposure: 1 }) })]), provider({ a: src }));
  const got = at(rb, 64, 36);
  const linIn = bt709InvOetf(90 / 255);
  const exp = code(bt709Oetf(2 * linIn));
  nearRgb(got, [exp, exp, exp], 1, 'exposure');
  const ratio = bt709InvOetf(got[0] / 255) / linIn;
  near(ratio, 2, 0.03, 'linear ratio');
  return `in ${linIn.toFixed(4)} lin → out code ${got[0]} (expected ${exp.toFixed(2)}), linear ratio ${ratio.toFixed(4)}`;
});

function patches(colors: number[][], w = W, h = H): HTMLCanvasElement {
  const pw = w / colors.length;
  return canvas(w, h, (x) =>
    colors.forEach((c, i) => {
      x.fillStyle = rgbCss(c);
      x.fillRect(Math.round(i * pw), 0, Math.ceil(pw), h);
    }),
  );
}
const PATCH_COLORS = [
  [20, 40, 60],
  [128, 128, 128],
  [230, 30, 40],
  [40, 200, 90],
  [30, 60, 220],
  [250, 240, 10],
  [5, 5, 5],
  [255, 255, 255],
];
const patchCenter = (i: number, n: number, w = W) => (i + 0.5) * (w / n);

test('identity 3D LUT (33³, via parseCube) is identity; channel-swap LUT is applied r-fastest', () => {
  setLoadedLut('px-ident', parseCube(writeCube(identityLut('3d', 33))));
  const swap = identityLut('3d', 17);
  for (let i = 0; i < swap.data.length; i += 3) {
    const r = swap.data[i];
    swap.data[i] = swap.data[i + 2];
    swap.data[i + 2] = r;
  }
  setLoadedLut('px-swap', swap);
  const src = patches(PATCH_COLORS);
  const base = draw(graph([media('a', src)]), provider({ a: src }));
  const lut = draw(graph([media('a', src, { grade: grade({ lut: { id: 'px-ident', intensity: 1 } }) })]), provider({ a: src }));
  let maxErr = 0;
  for (let i = 0; i < PATCH_COLORS.length; i++) {
    const x = patchCenter(i, PATCH_COLORS.length);
    const a = at(base, x, 36);
    const b = at(lut, x, 36);
    for (let c = 0; c < 3; c++) maxErr = Math.max(maxErr, Math.abs(a[c] - b[c]), Math.abs(a[c] - PATCH_COLORS[i][c]));
  }
  check(maxErr <= 1, `identity LUT max error ${maxErr}`);
  const sw = draw(graph([media('a', src, { grade: grade({ lut: { id: 'px-swap', intensity: 1 } }) })]), provider({ a: src }));
  const red = at(sw, patchCenter(2, PATCH_COLORS.length), 36);
  nearRgb(red, [40, 30, 230], 2, 'swap LUT on red patch');
  const half = draw(graph([media('a', src, { grade: grade({ lut: { id: 'px-swap', intensity: 0.5 } }) })]), provider({ a: src }));
  const hr = at(half, patchCenter(2, PATCH_COLORS.length), 36);
  nearRgb(hr, [135, 30, 135], 2, 'swap LUT at 50%');
  // not loaded → skipped, image unchanged
  const missing = draw(graph([media('a', src, { grade: grade({ lut: { id: 'px-nope', intensity: 1 } }) })]), provider({ a: src }));
  nearRgb(at(missing, patchCenter(2, PATCH_COLORS.length), 36), PATCH_COLORS[2], 1, 'unloaded LUT skipped');
  return `identity max error ${maxErr}; swap(red)=${red.slice(0, 3)}; 50%=${hr.slice(0, 3)}`;
});

test('blend modes match reference formulas (normal/multiply/screen/add exactly, all 14 vs W3C)', () => {
  const pairs = [
    [
      [180, 120, 60],
      [100, 200, 140],
    ],
    [
      [40, 90, 230],
      [220, 60, 128],
    ],
  ];
  const lines: string[] = [];
  let maxErr = 0;
  for (const [a, b] of pairs) {
    const ca = solid(W, H, a);
    const cb = solid(W, H, b);
    const la = lin709(a);
    const lb = lin709(b);
    const independent: Partial<Record<BlendMode, (x: number, y: number) => number>> = {
      normal: (_x, y) => y,
      multiply: (x, y) => x * y,
      screen: (x, y) => x + y - x * y,
      add: (x, y) => x + y,
    };
    for (const mode of BLEND_MODES) {
      const rb = draw(graph([media('a', ca), media('b', cb, { blend: mode })]), provider({ a: ca, b: cb }));
      const got = at(rb, 64, 36);
      const ref = independent[mode];
      const lin = [0, 1, 2].map((i) => (ref ? ref(la[i], lb[i]) : compositePremul(mode, la[i], 1, lb[i], 1)[0])) as Vec3;
      const exp = expectOut('rec709', lin);
      for (let i = 0; i < 3; i++) maxErr = Math.max(maxErr, Math.abs(got[i] - exp[i]));
      nearRgb(got, exp, 1.01, `${mode} ${a}/${b}`);
      if (ref) lines.push(`${mode}: got ${got.slice(0, 3)} exp ${exp.map((v) => v.toFixed(1))}`);
    }
    // normal at 50% opacity = linear mix
    const half = draw(graph([media('a', ca), media('b', cb, { opacity: 0.5 })]), provider({ a: ca, b: cb }));
    nearRgb(at(half, 64, 36), expectOut('rec709', [0, 1, 2].map((i) => 0.5 * la[i] + 0.5 * lb[i]) as Vec3), 1.01, 'normal 50%');
  }
  return `max error ${maxErr} over 14 modes × 2 pairs; ${lines.slice(0, 4).join('; ')}`;
});

test('crossDissolve at 0.5 is the linear-light mean (library def and fallback)', () => {
  const a = [200, 40, 40];
  const b = [20, 60, 220];
  const ca = solid(W, H, a);
  const cb = solid(W, H, b);
  const exp = expectOut('rec709', [0, 1, 2].map((i) => (lin709(a)[i] + lin709(b)[i]) / 2) as Vec3);
  const out: string[] = [];
  for (const type of ['crossDissolve', 'pixeltestMissingTransition']) {
    const node: TransitionNode = { type: 'transition', transition: type as TransitionType, params: {}, progress: 0.5, from: media('a', ca), to: media('b', cb), trackId: 't' };
    const rb = draw(graph([node]), provider({ a: ca, b: cb }));
    const got = at(rb, 64, 36);
    nearRgb(got, exp, 1.01, type);
    out.push(`${type}${getTransition(type) ? '' : ' (fallback)'}: ${got.slice(0, 3)}`);
  }
  // from nothing: half-transparent over the background
  const node: TransitionNode = { type: 'transition', transition: 'crossDissolve', params: {}, progress: 0.5, from: null, to: media('b', cb), trackId: 't' };
  const rb = draw(graph([node]), provider({ b: cb }));
  nearRgb(at(rb, 64, 36), expectOut('rec709', lin709(b).map((v) => v / 2) as Vec3), 1.01, 'from null');
  return `expected ${exp.map((v) => v.toFixed(1))}; ${out.join('; ')}`;
});

test('ellipse mask cuts outside; rect/invert/subtract/feather combine', () => {
  const white = solid(W, H, [255, 255, 255]);
  const m: Mask = { ...makeMask('ellipse'), x: 0.5, y: 0.5, width: 0.5, height: 0.5, feather: 0 };
  const rb = draw(graph([media('a', white, { masks: [m] })]), provider({ a: white }));
  nearRgb(at(rb, 64, 36), [255, 255, 255], 0, 'center');
  nearRgb(at(rb, 2, 2), [0, 0, 0], 0, 'corner');
  // inside the bounding box but outside the ellipse (near the box corner)
  nearRgb(at(rb, 64 - 30, 36 - 16), [0, 0, 0], 0, 'box corner outside ellipse');
  nearRgb(at(rb, 64 + 28, 36), [255, 255, 255], 0, 'inside near right edge');
  nearRgb(at(rb, 64 + 35, 36), [0, 0, 0], 0, 'outside right edge');
  // invert
  const inv = draw(graph([media('a', white, { masks: [{ ...m, invert: true }] })]), provider({ a: white }));
  nearRgb(at(inv, 64, 36), [0, 0, 0], 0, 'inverted center');
  nearRgb(at(inv, 2, 2), [255, 255, 255], 0, 'inverted corner');
  // rect minus a smaller ellipse
  const rect: Mask = { ...makeMask('rect'), x: 0.5, y: 0.5, width: 0.8, height: 0.8, feather: 0 };
  const hole: Mask = { ...m, width: 0.2, height: 0.2, mode: 'subtract' };
  const sub = draw(graph([media('a', white, { masks: [rect, hole] })]), provider({ a: white }));
  nearRgb(at(sub, 64, 36), [0, 0, 0], 0, 'subtracted hole');
  nearRgb(at(sub, 64 + 30, 36), [255, 255, 255], 0, 'rect body');
  nearRgb(at(sub, 3, 36), [0, 0, 0], 0, 'outside rect');
  // feathered edge is in between, and opacity scales coverage
  const soft = draw(graph([media('a', white, { masks: [{ ...m, feather: 16 }] })]), provider({ a: white }));
  const e = at(soft, 64 + 32, 36)[0];
  check(e > 20 && e < 235, `feathered edge ${e}`);
  const half = draw(graph([media('a', white, { masks: [{ ...m, opacity: 0.5 }] })]), provider({ a: white }));
  near(at(half, 64, 36)[0], code(bt709Oetf(0.5)), 1.01, 'mask opacity 50%');
  return `center ${at(rb, 64, 36)[0]}, corner ${at(rb, 2, 2)[0]}, feathered edge ${e}, 50% opacity ${at(half, 64, 36)[0]}`;
});

function centroid(rb: PixelReadback): [number, number, number] {
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (let y = 0; y < rb.height; y++)
    for (let x = 0; x < rb.width; x++) {
      const v = rb.data[(y * rb.width + x) * 4] / 255;
      sx += x * v;
      sy += y * v;
      n += v;
    }
  return [sx / n, sy / n, n];
}

test('transform: x/y move pixels proportionally at any output size; rotation, scale, anchor, flip', () => {
  const sq = canvas(W, H, (x) => {
    x.fillStyle = '#000';
    x.fillRect(0, 0, W, H);
    x.fillStyle = '#fff';
    x.fillRect(56, 28, 16, 16);
  });
  const p = provider({ a: sq });
  const c0 = centroid(draw(graph([media('a', sq)]), p));
  const c1 = centroid(draw(graph([media('a', sq, { transform: tf({ x: 20, y: -10 }) })]), p));
  near(c1[0] - c0[0], 20, 0.15, 'dx');
  near(c1[1] - c0[1], -10, 0.15, 'dy');
  // half playback resolution: 10 px
  const h0 = centroid(draw(graph([media('a', sq)]), p, {}, [64, 36]));
  const h1 = centroid(draw(graph([media('a', sq, { transform: tf({ x: 20 }) })]), p, {}, [64, 36]));
  near(h1[0] - h0[0], 10, 0.2, 'dx at half resolution');
  // scale 2 → area ×4
  const s2 = centroid(draw(graph([media('a', sq, { transform: tf({ scale: 2 }) })]), p));
  near(s2[2] / c0[2], 4, 0.2, 'scale area');
  // anchor: anchor (+20,0) with rotation 180 → square mirrored about anchor → moves −40 + ... check centroid
  const bar = canvas(W, H, (x) => {
    x.fillStyle = '#000';
    x.fillRect(0, 0, W, H);
    x.fillStyle = '#fff';
    x.fillRect(48, 34, 32, 4);
  });
  const rot = draw(graph([media('b', bar, { transform: tf({ rotation: 90 }) })]), provider({ b: bar }));
  const rc = centroid(rot);
  // a horizontal 32×4 bar rotated 90° is vertical: column x=64 lit at y=36±14, row y=36 lit only near x=64
  check(at(rot, 64, 24)[0] > 200 && at(rot, 76, 36)[0] < 30, `rotation: (64,24)=${at(rot, 64, 24)[0]} (76,36)=${at(rot, 76, 36)[0]}`);
  const anc = centroid(draw(graph([media('a', sq, { transform: tf({ anchorX: 20 }) })]), p));
  near(anc[0] - c0[0], -20, 0.2, 'anchor offset moves the layer');
  const halfLR = canvas(W, H, (x) => {
    x.fillStyle = '#f00';
    x.fillRect(0, 0, W / 2, H);
    x.fillStyle = '#00f';
    x.fillRect(W / 2, 0, W / 2, H);
  });
  const fl = draw(graph([media('c', halfLR, { transform: tf({ flipH: true }) })]), provider({ c: halfLR }));
  check(at(fl, 10, 36)[2] > 200 && at(fl, 118, 36)[0] > 200, 'flipH swaps left/right');
  return `dx=${(c1[0] - c0[0]).toFixed(3)} dy=${(c1[1] - c0[1]).toFixed(3)}; half-res dx=${(h1[0] - h0[0]).toFixed(3)}; scale² area ×${(s2[2] / c0[2]).toFixed(3)}; rotated centroid (${rc[0].toFixed(1)},${rc[1].toFixed(1)}); anchor dx=${(anc[0] - c0[0]).toFixed(2)}`;
});

test('fit modes and crop', () => {
  const sq = solid(64, 64, [255, 255, 255]);
  const p = provider({ a: sq });
  const fit = draw(graph([media('a', sq)]), p);
  nearRgb(at(fit, 64, 36), [255, 255, 255], 0, 'fit center');
  nearRgb(at(fit, 20, 36), [0, 0, 0], 0, 'fit pillarbox');
  const fill = draw(graph([media('a', sq, { transform: tf({ fit: 'fill' }) })]), p);
  nearRgb(at(fill, 2, 2), [255, 255, 255], 0, 'fill covers');
  const none = draw(graph([media('a', sq, { transform: tf({ fit: 'none' }) })]), p);
  nearRgb(at(none, 64, 6), [255, 255, 255], 0, 'none inside 64px');
  nearRgb(at(none, 64, 2), [0, 0, 0], 0, 'none outside 64px');
  const st = draw(graph([media('a', sq, { transform: tf({ fit: 'stretch' }) })]), p);
  nearRgb(at(st, 1, 1), [255, 255, 255], 0, 'stretch');
  const white = solid(W, H, [255, 255, 255]);
  const crop = draw(graph([media('w', white, { crop: { left: 0.5, top: 0, right: 0, bottom: 0.25, feather: 0 } })]), provider({ w: white }));
  nearRgb(at(crop, 30, 30), [0, 0, 0], 0, 'cropped left');
  nearRgb(at(crop, 100, 30), [255, 255, 255], 0, 'kept right');
  nearRgb(at(crop, 100, 66), [0, 0, 0], 0, 'cropped bottom');
});

test('input transforms: log/HLG/PQ curves and camera gamuts match the CPU reference', () => {
  const ids: InputTransform[] = ['slog3', 'logc3', 'vlog', 'clog3', 'flog', 'hlg', 'pq', 'srgb', 'linear'];
  const lins: Vec3[] = [
    [0.02, 0.02, 0.02],
    [0.18, 0.18, 0.18],
    [0.6, 0.6, 0.6],
    [0.3, 0.12, 0.05],
    [0.05, 0.1, 0.35],
  ];
  const lines: string[] = [];
  let maxErr = 0;
  for (const id of ids) {
    const codes = lins.map((l) => encodeInputRgb(id, l).map((v) => Math.round(Math.min(Math.max(v, 0), 1) * 255)));
    const src = patches(codes);
    const rb = draw(graph([media('a', src, { inputTransform: id })]), provider({ a: src }));
    codes.forEach((c, i) => {
      const exp = expectOut('rec709', decodeInputRgb(id, c.map((v) => v / 255) as Vec3));
      const got = at(rb, patchCenter(i, codes.length), 36);
      for (let k = 0; k < 3; k++) maxErr = Math.max(maxErr, Math.abs(got[k] - exp[k]));
      nearRgb(got, exp, 1.01, `${id} patch ${i}`);
    });
    const grey = at(rb, patchCenter(1, codes.length), 36)[0];
    lines.push(`${id}: 18%→${grey}`);
  }
  return `max error ${maxErr}; ${lines.join(', ')} (BT.709 OETF(0.18)=${code(bt709Oetf(0.18)).toFixed(1)})`;
});

test('output transforms: sRGB, Display P3, HLG and PQ (HDR → SDR tone map)', () => {
  const lins: Vec3[] = [
    [0.18, 0.18, 0.18],
    [0.9, 0.2, 0.1],
    [0.1, 0.6, 0.2],
    [1, 1, 1],
  ];
  const lines: string[] = [];
  for (const space of ['srgb', 'p3', 'rec2020-hlg', 'rec2020-pq'] as ColorSpace[]) {
    const codes = lins.map((l) => encodeInputRgb('linear', l).map((v) => Math.round(Math.min(Math.max(bt709Oetf(v), 0), 1) * 255)));
    const src = patches(codes);
    const rb = draw(graph([media('a', src)], { colorSpace: space }), provider({ a: src }));
    codes.forEach((c, i) => {
      const exp = expectOut(space as OutputSpace, lin709(c));
      nearRgb(at(rb, patchCenter(i, codes.length), 36), exp, 1.01, `${space} patch ${i}`);
    });
    lines.push(`${space}: white→${at(rb, patchCenter(3, 4), 36).slice(0, 3)}`);
  }
  // HDR source in an HDR sequence: PQ 1000 nits → near-white, 100 nits → below
  const pq = patches([
    [Math.round(0.7518 * 255), Math.round(0.7518 * 255), Math.round(0.7518 * 255)],
    [Math.round(0.5081 * 255), Math.round(0.5081 * 255), Math.round(0.5081 * 255)],
  ]);
  const rb = draw(graph([media('a', pq, { inputTransform: 'pq' })], { colorSpace: 'rec2020-pq' }), provider({ a: pq }));
  const hi = at(rb, patchCenter(0, 2), 36)[0];
  const mid = at(rb, patchCenter(1, 2), 36)[0];
  check(hi > 245 && mid < hi && mid > 200, `pq 1000 nits → ${hi}, 100 nits → ${mid}`);
  lines.push(`PQ in PQ seq: 1000 nits→${hi}, 100 nits→${mid}`);
  return lines.join('; ');
});

test('grade pass matches the CPU reference (WB, log stage, wheels, curves, qualifier, LUT)', () => {
  const g = grade({
    exposure: 0.3,
    temperature: 25,
    tint: -10,
    contrast: 1.25,
    pivot: 0.42,
    saturation: 1.2,
    vibrance: 0.3,
    highlights: -0.4,
    shadows: 0.3,
    lift: { r: 0.05, g: 0, b: -0.05, y: 0.04 },
    gamma: { r: 0, g: 0.05, b: 0, y: 0.1 },
    gain: { r: 0, g: 0, b: 0.1, y: -0.05 },
    offset: { r: 0.01, g: 0, b: 0, y: 0 },
    curves: { master: [{ x: 0.25, y: 0.22 }, { x: 0.75, y: 0.8 }], r: [], g: [{ x: 0.5, y: 0.52 }], b: [] },
    lut: { id: 'px-swap', intensity: 0.25 },
  });
  g.qualifier = { ...g.qualifier, enabled: true, hueCenter: 120, hueWidth: 60, softness: 0.3, satLow: 0.1, hueShift: 20, saturation: 0.7, exposure: 0.2 };
  const src = patches(PATCH_COLORS);
  const rb = draw(graph([media('a', src, { grade: g })]), provider({ a: src }));
  const lut = (() => {
    const l = identityLut('3d', 17);
    for (let i = 0; i < l.data.length; i += 3) {
      const r = l.data[i];
      l.data[i] = l.data[i + 2];
      l.data[i + 2] = r;
    }
    return l;
  })();
  let maxErr = 0;
  PATCH_COLORS.forEach((c, i) => {
    const exp = expectOut('rec709', gradePixel(g, lin709(c), lut));
    const got = at(rb, patchCenter(i, PATCH_COLORS.length), 36);
    for (let k = 0; k < 3; k++) maxErr = Math.max(maxErr, Math.abs(got[k] - exp[k]));
    nearRgb(got, exp, 2.01, `patch ${i} ${c}`);
  });
  return `max |GPU − CPU| = ${maxErr} code values over ${PATCH_COLORS.length} patches`;
});

test('curves: master 0.5 → 0.75 in the display domain', () => {
  const src = solid(W, H, [128, 128, 128]);
  const g = grade({ curves: { master: [{ x: 128 / 255, y: 0.75 }], r: [], g: [], b: [] } });
  const got = at(draw(graph([media('a', src, { grade: g })]), provider({ a: src })), 64, 36);
  nearRgb(got, [191.25, 191.25, 191.25], 1.01, 'curve');
  return `128 → ${got.slice(0, 3)}`;
});

test('qualifier matte (opts.matteClipId) and grade compare modes', () => {
  const src = patches([
    [220, 30, 30],
    [30, 30, 220],
  ]);
  const g = grade({ exposure: 1 });
  g.qualifier = { ...g.qualifier, enabled: true, hueCenter: 0, hueWidth: 40, softness: 0.05 };
  const p = provider({ a: src });
  const items = [media('a', src, { grade: g })];
  const matte = draw(graph(items), p, { matteClipId: 'a' });
  near(at(matte, 30, 36)[0], 255, 1, 'matte inside key');
  near(at(matte, 98, 36)[0], 0, 1, 'matte outside key');
  const blue = PATCH_COLORS[4];
  const s2 = solid(W, H, blue);
  const graded = grade({ exposure: 1 });
  const split = draw(graph([media('s', s2, { grade: graded })]), provider({ s: s2 }), { compare: { mode: 'split', position: 0.5 } });
  nearRgb(at(split, 20, 36), blue, 1, 'split: left ungraded');
  const exp = expectOut('rec709', lin709(blue).map((v) => v * 2) as Vec3);
  nearRgb(at(split, 108, 36), exp, 1.01, 'split: right graded');
  const byp = draw(graph([media('s', s2, { grade: graded })]), provider({ s: s2 }), { compare: { mode: 'bypass', position: 0 } });
  nearRgb(at(byp, 108, 36), blue, 1, 'bypass');
  return `matte in/out ${at(matte, 30, 36)[0]}/${at(matte, 98, 36)[0]}; split L ${at(split, 20, 36).slice(0, 3)} R ${at(split, 108, 36).slice(0, 3)}`;
});

test('adjustment layers grade/mask the image below', () => {
  const grey = [100, 100, 100];
  const src = solid(W, H, grey);
  const adj = layer('adj', null, { adjustment: true, inputTransform: 'linear', grade: grade({ exposure: 1 }) });
  const p = provider({ a: src });
  const full = at(draw(graph([media('a', src), adj]), p), 64, 36);
  const exp = expectOut('rec709', lin709(grey).map((v) => v * 2) as Vec3);
  nearRgb(full, exp, 1.01, 'adjusted');
  const m: Mask = { ...makeMask('ellipse'), width: 0.4, height: 0.4, feather: 0 };
  const masked = draw(graph([media('a', src), { ...adj, masks: [m] }]), p);
  nearRgb(at(masked, 64, 36), exp, 1.01, 'inside mask');
  nearRgb(at(masked, 4, 4), grey, 1, 'outside mask');
  const half = at(draw(graph([media('a', src), { ...adj, opacity: 0.5 }]), p), 64, 36);
  nearRgb(half, expectOut('rec709', lin709(grey).map((v) => v * 1.5) as Vec3), 1.01, 'opacity 50%');
  return `below ${grey[0]} → full ${full[0]}, 50% ${half[0]}`;
});

test('nested sequences render recursively as linear sources', () => {
  const c = [60, 160, 90];
  const src = solid(64, 64, c);
  const inner = graph([media('in', src, { transform: tf({ fit: 'stretch' }) })], { w: 64, h: 64, background: '#000000' });
  const outer = graph([layer('nest', { kind: 'sequence', graph: inner, width: 64, height: 64 }, { inputTransform: 'linear' })]);
  const rb = draw(outer, provider({ in: src }));
  nearRgb(at(rb, 64, 36), c, 1, 'nested center');
  nearRgb(at(rb, 10, 36), [0, 0, 0], 0, 'nested pillarbox');
  return `nested center ${at(rb, 64, 36).slice(0, 3)}`;
});

registerEffect({
  type: 'pixeltestInvert',
  name: 'Invert (test)',
  category: 'Utility',
  description: '',
  params: [{ key: 'amount', label: 'Amount', type: 'number', default: 1 }],
  passes: [{ glsl: 'vec4 effect(vec2 uv) { vec4 c = src(uv); vec4 inv = vec4(vec3(c.a) - c.rgb, c.a); return mix(c, inv, u_amount); }' }],
});
registerEffect({
  type: 'pixeltestTint',
  name: 'Tint (test)',
  category: 'Utility',
  description: '',
  params: [
    { key: 'color', label: 'Color', type: 'color', default: '#ff0000' },
    { key: 'where', label: 'Where', type: 'point', default: '0.5,0.5' },
    { key: 'on', label: 'On', type: 'bool', default: true },
    { key: 'which', label: 'Which', type: 'choice', default: 1, choices: [{ value: 0, label: 'a' }, { value: 1, label: 'b' }] },
  ],
  passes: [{ glsl: 'vec4 effect(vec2 uv) { vec4 c = src(uv); if (u_on > 0.5 && u_which == 1 && distance(uv, vec2(u_where.x, 1.0 - u_where.y)) < 2.0) return vec4(u_color.rgb * u_color.a, u_color.a) * c.a; return c; }' }],
});
registerEffect({
  type: 'pixeltestShift',
  name: 'Shift (test)',
  category: 'Distort',
  description: '',
  params: [{ key: 'dist', label: 'Distance', type: 'number', default: 10, unit: 'px' }],
  passes: [],
  expand: () => [{ glsl: 'vec4 effect(vec2 uv) { return src(uv); }', scale: 0.5 }, { glsl: 'vec4 effect(vec2 uv) { return texture(u_orig, uv - vec2(u_dist * u_texel.x, 0.0)); }' }],
});
registerEffect({
  type: 'pixeltestBroken',
  name: 'Broken (test)',
  category: 'Utility',
  description: '',
  params: [],
  passes: [{ glsl: 'vec4 effect(vec2 uv) { return this is not glsl; }' }],
});

test('effects: template/uniforms, color+point+bool+choice params, px scaling, scale/expand, errors skipped', () => {
  const c = [200, 100, 50];
  const src = solid(W, H, c);
  const p = provider({ a: src });
  const inv = at(draw(graph([media('a', src, { effects: [{ id: 'e1', type: 'pixeltestInvert', params: { amount: 1 } }] })]), p), 64, 36);
  nearRgb(inv, expectOut('rec709', lin709(c).map((v) => 1 - v) as Vec3), 1.01, 'invert in linear');
  const tint = at(draw(graph([media('a', src, { effects: [{ id: 'e2', type: 'pixeltestTint', params: { color: '#336699', where: '0.5,0.5', on: true, which: 1 } }] })]), p), 64, 36);
  nearRgb(tint, [0x33, 0x66, 0x99], 1, 'color param (hex → linear)');
  // broken + unknown effects are skipped; the layer still renders
  const broken = at(draw(graph([media('a', src, { effects: [{ id: 'e3', type: 'pixeltestBroken', params: {} }, { id: 'e4', type: 'noSuchEffect', params: {} }] })]), p), 64, 36);
  nearRgb(broken, c, 1, 'broken/unknown skipped');
  // px params follow playback resolution: a 20 px shift is 20 px at full size and 10 px at half size
  const bar = canvas(W, H, (x) => {
    x.fillStyle = '#000';
    x.fillRect(0, 0, W, H);
    x.fillStyle = '#fff';
    x.fillRect(40, 0, 8, H);
  });
  const pb = provider({ b: bar });
  const base = centroid(draw(graph([media('b', bar)]), pb));
  const shifted = centroid(draw(graph([media('b', bar, { effects: [{ id: 'e5', type: 'pixeltestShift', params: { dist: 20 } }] })]), pb));
  near(shifted[0] - base[0], 20, 0.6, 'px shift full res');
  const baseH = centroid(draw(graph([media('b', bar)]), pb, {}, [64, 36]));
  const shiftedH = centroid(draw(graph([media('b', bar, { effects: [{ id: 'e5', type: 'pixeltestShift', params: { dist: 20 } }] })]), pb, {}, [64, 36]));
  near(shiftedH[0] - baseH[0], 10, 0.6, 'px shift half res');
  const bad = R.validateShaders().filter((f) => !f.type.startsWith('pixeltest'));
  return `invert ${inv.slice(0, 3)}, tint ${tint.slice(0, 3)}, shift full ${(shifted[0] - base[0]).toFixed(2)} half ${(shiftedH[0] - baseH[0]).toFixed(2)}; library shaders failing: ${bad.length ? bad.map((b) => b.type).join(',') : 'none'}`;
});

test('readPixels: top row first, GPU downscale', () => {
  const tb = canvas(W, H, (x) => {
    x.fillStyle = '#f00';
    x.fillRect(0, 0, W, H / 2);
    x.fillStyle = '#00f';
    x.fillRect(0, H / 2, W, H / 2);
  });
  R.setSize(W, H);
  R.render(graph([media('a', tb)]), provider({ a: tb }));
  const full = R.readPixels(W);
  check(full.width === W && full.height === H, `size ${full.width}x${full.height}`);
  nearRgb(at(full, 64, 0), [255, 0, 0], 0, 'row 0 is the top (red)');
  nearRgb(at(full, 64, H - 1), [0, 0, 255], 0, 'last row is the bottom (blue)');
  const small = R.readPixels(32);
  check(small.width === 32 && small.height === 18, `small ${small.width}x${small.height}`);
  nearRgb(at(small, 16, 2), [255, 0, 0], 1, 'small top');
  nearRgb(at(small, 16, 15), [0, 0, 255], 1, 'small bottom');
  return `full ${full.width}x${full.height}, small ${small.width}x${small.height}`;
});

test('text/shape/solid/gradient sources are cached by content; captions overlay draws on top', () => {
  const text = defaultTextProps('Hello');
  text.size = 30;
  const node = layer('txt', { kind: 'text', text, local: 1, duration: 5, width: W, height: H }, { inputTransform: 'srgb' });
  const before = R.stats.rasterizations;
  draw(graph([node]), provider({}));
  draw(graph([{ ...node, local: 2, source: { kind: 'text', text, local: 2, duration: 5, width: W, height: H } }]), provider({}));
  draw(graph([node]), provider({}));
  const n = R.stats.rasterizations - before;
  check(n === 1, `rasterized ${n} times for a static text`);
  const changed = { ...text, content: 'World' };
  draw(graph([layer('txt', { kind: 'text', text: changed, local: 1, duration: 5, width: W, height: H })]), provider({}));
  check(R.stats.rasterizations - before === 2, 'content change re-rasterizes');
  const style = { ...defaultCaptionStyle(), size: 20, margin: 16, background: '' };
  const cap: CaptionNode = { cue: { id: 'c1', start: 0, end: 1, text: 'CAPTION' }, style, trackId: 'cap' };
  const rb = draw(graph([], { captions: [cap] }), provider({}));
  let lit = 0;
  for (let i = 0; i < rb.data.length; i += 4) if (rb.data[i] > 128) lit++;
  check(lit > 20, `caption pixels ${lit}`);
  return `static text rasterized ${n}×; caption lit pixels ${lit}`;
});

test('VideoFrame and ImageBitmap sources (renderer never closes provider frames)', async () => {
  const c = [30, 140, 210];
  const src = solid(W, H, c);
  const vf = new VideoFrame(src, { timestamp: 0 });
  const rb = draw(graph([media('v', { width: W, height: H })]), provider({ v: vf }));
  check(vf.format !== null, 'VideoFrame was closed by the renderer');
  nearRgb(at(rb, 64, 36), c, 2, 'VideoFrame');
  vf.close();
  const bmp = await createImageBitmap(src);
  const rb2 = draw(graph([media('i', bmp)]), provider({ i: bmp }));
  nearRgb(at(rb2, 64, 36), c, 1, 'ImageBitmap');
  // a closed frame must not crash the renderer
  const closed = new VideoFrame(src, { timestamp: 1 });
  closed.close();
  draw(graph([media('x', { width: W, height: H })]), provider({ x: closed }));
  return `VideoFrame ${at(rb, 64, 36).slice(0, 3)}, ImageBitmap ${at(rb2, 64, 36).slice(0, 3)}`;
});

test('dithering: smooth gradients average to the exact float value (no banding)', () => {
  const w = 512;
  const src = canvas(w, 16, (x) => {
    for (let i = 0; i < w; i++) {
      const v = Math.floor((i / w) * 64);
      x.fillStyle = rgbCss([v, v, v]);
      x.fillRect(i, 0, 1, 16);
    }
  });
  const g = grade({ exposure: 0.37 });
  const rb = draw(graph([media('a', src, { grade: g, transform: tf({ fit: 'stretch' }) })], { w, h: 16 }), provider({ a: src }));
  let maxMeanErr = 0;
  let maxStep = 0;
  let prev = -1;
  for (let i = 0; i < w; i += 8) {
    let s = 0;
    for (let y = 0; y < 16; y++) for (let dx = 0; dx < 8; dx++) s += rb.data[(y * w + i + dx) * 4];
    const mean = s / 128;
    const v = Math.floor((i / w) * 64);
    const exp = code(bt709Oetf(bt709InvOetf(v / 255) * Math.pow(2, 0.37)));
    maxMeanErr = Math.max(maxMeanErr, Math.abs(mean - exp));
    if (prev >= 0) maxStep = Math.max(maxStep, Math.abs(mean - prev));
    prev = mean;
  }
  check(maxMeanErr < 0.35, `mean error ${maxMeanErr.toFixed(3)} LSB`);
  return `max |mean − exact float| = ${maxMeanErr.toFixed(3)} LSB (rounding alone would allow 0.5)`;
});

test('context loss is survived and restore re-initializes', async () => {
  const c = document.createElement('canvas');
  document.body.appendChild(c);
  const r = new Renderer(c);
  const src = solid(W, H, [128, 128, 128]);
  const g = graph([media('a', src)]);
  draw(g, provider({ a: src }), {}, [W, H], r);
  const ext = (c.getContext('webgl2') as WebGL2RenderingContext).getExtension('WEBGL_lose_context');
  check(!!ext, 'WEBGL_lose_context');
  ext!.loseContext();
  await new Promise((res) => setTimeout(res, 50));
  r.render(g, provider({ a: src })); // must not throw
  const blank = r.readPixels(W);
  check(blank.width === W, 'readPixels while lost');
  ext!.restoreContext();
  for (let i = 0; i < 50 && r.info.contextLost; i++) await new Promise((res) => setTimeout(res, 20));
  check(!r.info.contextLost, 'context restored');
  const rb = draw(g, provider({ a: src }), {}, [W, H], r);
  nearRgb(at(rb, 64, 36), [128, 128, 128], 1, 'after restore');
  r.dispose();
  return 'lost → no-op → restored → correct pixels';
});

test('performance: 1920×1080 frame, 4 layers (media + text + masked solid + graded adjustment)', () => {
  const big = canvas(1920, 1080, (x) => {
    const gr = x.createLinearGradient(0, 0, 1920, 0);
    gr.addColorStop(0, '#203040');
    gr.addColorStop(1, '#e0c080');
    x.fillStyle = gr;
    x.fillRect(0, 0, 1920, 1080);
  });
  const text = defaultTextProps('Delta');
  const items: GraphItem[] = [
    media('a', big, { grade: grade({ contrast: 1.2, saturation: 1.1 }) }),
    layer('t', { kind: 'text', text, local: 0, duration: 5, width: 1920, height: 1080 }),
    layer('s', { kind: 'solid', color: '#ff004080', width: 1920, height: 1080 }, { masks: [{ ...makeMask('ellipse') }], blend: 'screen' }),
    layer('adj', null, { adjustment: true, inputTransform: 'linear', grade: grade({ exposure: 0.2 }) }),
  ];
  const g = graph(items, { w: 1920, h: 1080 });
  const p = provider({ a: big });
  draw(g, p, {}, [1920, 1080]);
  const times: number[] = [];
  for (let i = 0; i < 5; i++) {
    const t0 = performance.now();
    R.render(g, p);
    R.readPixels(1); // forces completion
    times.push(performance.now() - t0);
  }
  const half: number[] = [];
  R.setSize(960, 540);
  for (let i = 0; i < 5; i++) {
    const t0 = performance.now();
    R.render(g, p);
    R.readPixels(1);
    half.push(performance.now() - t0);
  }
  const med = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
  return `SwiftShader (CPU) median: full ${med(times).toFixed(1)} ms, half-res ${med(half).toFixed(1)} ms; pool ${JSON.stringify(R.stats.pool)}; programs ${R.stats.programs}`;
});

// sanity: srgbDecode import is used by tests that compare sRGB pipelines
void srgbDecode;

// ---------------------------------------------------------------------------

async function run() {
  for (const t of tests) {
    const t0 = performance.now();
    try {
      const details = (await t.fn()) ?? '';
      results.push({ name: t.name, ok: true, ms: performance.now() - t0, details });
    } catch (e) {
      results.push({ name: t.name, ok: false, ms: performance.now() - t0, details: e instanceof Error ? `${e.message}${e instanceof Fail ? '' : `\n${e.stack}`}` : String(e) });
    }
  }
  (window as unknown as { __results: Result[]; __done: boolean }).__results = results;
  (window as unknown as { __done: boolean }).__done = true;
}
void run();
