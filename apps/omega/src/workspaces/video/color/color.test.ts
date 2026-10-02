import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeAsset, makeClip, defaultGrade } from '../../../state/defaults';
import type { Clip, Project } from '../../../state/types';
import { paramAt, setKeyframe } from '../../../engine/keyframes';
import { channelStats, estimateIlluminant, solveMatch, solveWhiteBalance, type RGB } from '../../../engine/scopes/analysis';
import { gradePixel } from '../../../engine/color/grade';
import { bt709InvOetf, bt709Oetf, outputEncodeRgb } from '../../../engine/color/transforms';
import { compileCurve, evalCurve, isIdentityCurve, normalizeCurve, sampleCurve } from './curves';
import { compileGrade, linearTable, logDomainTable, offsetForMultiplier, renderSwatch, wbMatrix } from './gradeModel';
import { composeLook, LOOKS } from './looks';
import {
  applyGradeToSource,
  applyLookTo,
  applyMatchTo,
  applyWhiteBalanceTo,
  gradeSnapshot,
  pasteGradeInto,
  puckToRgb,
  resetGradeOf,
  rgbToPuck,
  setSourceInputTransform,
} from './gradeOps';

test('curves: identity, endpoints and monotone interpolation', () => {
  assert.equal(evalCurve([], 0.3), 0.3);
  assert.ok(isIdentityCurve([{ x: 0, y: 0 }, { x: 1, y: 1 }]));
  assert.deepEqual(normalizeCurve([{ x: 0, y: 0 }, { x: 1, y: 1 }]), []);
  assert.equal(normalizeCurve([{ x: 0.5, y: 0.5 }]).length, 3, 'an anchor on the diagonal is kept');
  const pts = [
    { x: 0, y: 0 },
    { x: 0.25, y: 0.15 },
    { x: 0.75, y: 0.85 },
    { x: 1, y: 1 },
  ];
  const f = compileCurve(pts);
  for (const p of pts) assert.ok(Math.abs(f(p.x) - p.y) < 1e-9, 'passes through its points');
  // monotone data → monotone curve, no overshoot
  const s = sampleCurve(pts, 512);
  for (let i = 1; i < s.length; i++) assert.ok(s[i] >= s[i - 1] - 1e-9);
  // a steep step does not ring below 0 or above 1
  const step = sampleCurve([{ x: 0.45, y: 0 }, { x: 0.55, y: 1 }], 256);
  for (const v of step) assert.ok(v >= 0 && v <= 1);
  // implied endpoints
  assert.equal(evalCurve([{ x: 0.5, y: 0.7 }], 0), 0);
  assert.equal(evalCurve([{ x: 0.5, y: 0.7 }], 1), 1);
  // lifted black point
  assert.ok(Math.abs(evalCurve([{ x: 0, y: 0.1 }], 0) - 0.1) < 1e-9);
});

test('grade model: the default grade is the identity', () => {
  const f = compileGrade(defaultGrade());
  for (const c of [
    [0, 0, 0],
    [0.18, 0.4, 0.9],
    [1, 1, 1],
    [0.5, 0.5, 0.5],
  ] as RGB[]) {
    const o = f(c);
    for (let k = 0; k < 3; k++) assert.ok(Math.abs(o[k] - c[k]) < 2e-3, `${c} → ${o}`);
  }
});

test('grade model: the precompiled pipeline equals the renderer\'s gradePixel', () => {
  const grades = [
    { ...defaultGrade(), exposure: 0.4, temperature: 35, tint: -12, contrast: 1.2, saturation: 0.8, vibrance: 0.3, highlights: -0.2, shadows: 0.15 },
    { ...defaultGrade(), lift: { r: 0.1, g: 0, b: -0.1, y: 0.05 }, gamma: { r: 0, g: 0.2, b: 0, y: -0.1 }, gain: { r: 0.2, g: -0.1, b: 0, y: 0.1 }, offset: { r: 0.05, g: 0, b: -0.05, y: 0 } },
    { ...defaultGrade(), curves: { master: [{ x: 0, y: 0.05 }, { x: 0.5, y: 0.55 }, { x: 1, y: 0.95 }], r: [{ x: 0.3, y: 0.35 }], g: [], b: [{ x: 0.6, y: 0.5 }] } },
    { ...defaultGrade(), qualifier: { ...defaultGrade().qualifier, enabled: true, hueCenter: 20, hueWidth: 60, hueShift: 25, saturation: 1.4, exposure: 0.5 } },
  ];
  let seed = 3;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (const g of grades) {
    const f = compileGrade(g);
    for (let i = 0; i < 200; i++) {
      const c: RGB = [rand(), rand(), rand()];
      const a = f(c);
      const b = outputEncodeRgb('rec709', gradePixel(g, c.map(bt709InvOetf) as RGB));
      for (let k = 0; k < 3; k++) assert.ok(Math.abs(a[k] - b[k]) < 1e-9, `${JSON.stringify(c)} → ${a} vs ${b}`);
    }
  }
});

test('grade model: exposure +1 doubles linear light; temperature warms', () => {
  const o = compileGrade({ ...defaultGrade(), exposure: 1 })([bt709Oetf(0.1), bt709Oetf(0.1), bt709Oetf(0.1)]);
  assert.ok(Math.abs(bt709Oetf(0.2) - o[0]) < 2e-3);
  const w = compileGrade({ ...defaultGrade(), temperature: 50 })([0.5, 0.5, 0.5]);
  assert.ok(w[0] > 0.5 && w[2] < 0.5);
});

test('offset wheel units: the computed offset is the requested linear multiplier', () => {
  const g = { ...defaultGrade(), offset: { r: offsetForMultiplier(1.5), g: 0, b: offsetForMultiplier(0.8), y: 0 } };
  const o = gradePixel(g, [0.18, 0.18, 0.18]);
  assert.ok(Math.abs(o[0] / 0.18 - 1.5) < 1e-3, `r ${o[0] / 0.18}`);
  assert.ok(Math.abs(o[1] / 0.18 - 1) < 1e-6);
  assert.ok(Math.abs(o[2] / 0.18 - 0.8) < 1e-3, `b ${o[2] / 0.18}`);
});

test('looks: twelve or more, every one changes the swatch, compose rules hold', () => {
  assert.ok(LOOKS.length >= 12);
  const base = renderSwatch(defaultGrade(), 24, 12);
  for (const look of LOOKS) {
    const sw = renderSwatch(composeLook(defaultGrade(), look), 24, 12);
    let diff = 0;
    for (let i = 0; i < sw.length; i++) diff += Math.abs(sw[i] - base[i]);
    assert.ok(diff > 24 * 12 * 3, `${look.name} changes the image`);
  }
  const bw = LOOKS.find((l) => l.id === 'hcBW')!;
  const g = composeLook({ ...defaultGrade(), saturation: 1.2, contrast: 1.1, temperature: 10 }, bw);
  assert.equal(g.saturation, 0);
  assert.ok(Math.abs(g.contrast - 1.1 * 1.42) < 1e-3);
  assert.equal(g.temperature, 10, 'balance is kept');
});

function clipWith(): Clip {
  return makeClip('media', { start: 10, duration: 5, assetId: 'a1' });
}

test('applyLookTo shifts animated params instead of hiding under keyframes', () => {
  const c = clipWith();
  setKeyframe(c, 'grade.temperature', 0, -10);
  setKeyframe(c, 'grade.temperature', 2, 10);
  applyLookTo(c, LOOKS.find((l) => l.id === 'goldenHour')!);
  assert.equal(paramAt(c, 'grade.temperature', 0), 18);
  assert.equal(paramAt(c, 'grade.temperature', 2), 38);
  assert.ok(c.grade.saturation > 1);
});

test('paste keeps the input transform; reset clears keyframes', () => {
  const src = { ...defaultGrade(), saturation: 0.5, inputTransform: 'slog3' as const };
  const c = clipWith();
  c.grade.inputTransform = 'logc3';
  setKeyframe(c, 'grade.exposure', 1, 1);
  pasteGradeInto(c, src);
  assert.equal(c.grade.saturation, 0.5);
  assert.equal(c.grade.inputTransform, 'logc3');
  assert.equal(c.keyframes['grade.exposure'], undefined);
  setKeyframe(c, 'grade.exposure', 1, 1);
  resetGradeOf(c);
  assert.equal(c.grade.saturation, 1);
  assert.equal(c.grade.inputTransform, 'logc3');
  assert.deepEqual(Object.keys(c.keyframes), []);
});

test('gradeSnapshot resolves animation at a time', () => {
  const c = clipWith();
  setKeyframe(c, 'grade.gain.r', 0, 0);
  setKeyframe(c, 'grade.gain.r', 2, 0.4);
  assert.ok(Math.abs(gradeSnapshot(c, 1).gain.r - 0.2) < 1e-9);
});

function project(clips: Clip[]): Project {
  const asset = makeAsset({ id: 'a1', name: 'A', path: '/a.mov', kind: 'video', duration: 10, hasAudio: false, hasVideo: true });
  return {
    assets: [asset],
    sequences: [{ tracks: [{ kind: 'video', clips }] }],
  } as unknown as Project;
}

test('source-wide input transform and grade', () => {
  const a = clipWith();
  const b = clipWith();
  b.grade.inputTransform = 'vlog';
  const p = project([a, b]);
  setSourceInputTransform(p, 'a1', 'slog3');
  assert.equal(p.assets[0].inputTransform, 'slog3');
  assert.equal(b.grade.inputTransform, 'auto');
  a.grade.saturation = 1.4;
  assert.equal(applyGradeToSource(p, 'a1', a.grade, a.id), 1);
  assert.equal(b.grade.saturation, 1.4);
});

test('wheel puck ↔ rgb round-trips and is luma-neutral', () => {
  for (const [x, y] of [
    [0, 0],
    [0.5, 0.2],
    [-0.3, -0.7],
  ]) {
    const c = puckToRgb(x, y);
    const p = rgbToPuck(c);
    assert.ok(Math.abs(p.x - x) < 1e-3 && Math.abs(p.y - y) < 1e-3);
    assert.ok(Math.abs(p.luma) < 1e-3);
  }
  // pushing towards the red target raises red
  const red = puckToRgb(Math.cos((103 * Math.PI) / 180), Math.sin((103 * Math.PI) / 180));
  assert.ok(red.r > 0 && red.g < 0 && red.b < 0);
});

function castFrame(w: number, h: number, light: RGB): { width: number; height: number; data: Uint8ClampedArray } {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const v = 0.03 + (((i * 7919) % 997) / 997) * 0.5;
    for (let c = 0; c < 3; c++) data[i * 4 + c] = Math.round(bt709Oetf(Math.min(1, v * light[c])) * 255);
    data[i * 4 + 3] = 255;
  }
  return { width: w, height: h, data };
}

test('auto balance end-to-end through the renderer math: grey under a warm light comes out neutral', () => {
  for (const light of [
    [1.25, 1, 0.75],
    [0.85, 1.08, 1.3],
    [1.1, 0.92, 1.05],
  ] as RGB[]) {
    const frame = castFrame(64, 36, light);
    const est = estimateIlluminant(frame, linearTable('rec709'))!;
    const sol = solveWhiteBalance(est.cast, wbMatrix);
    const c = clipWith();
    applyWhiteBalanceTo(c, 0, sol);
    const grey = gradePixel(c.grade, [0.18 * light[0], 0.18 * light[1], 0.18 * light[2]]);
    const err = Math.max(Math.abs(Math.log2(grey[0] / grey[1])), Math.abs(Math.log2(grey[2] / grey[1])));
    assert.ok(err < 0.03, `light ${light} → ${grey} (T ${c.grade.temperature}, N ${c.grade.tint})`);
  }
});

test('auto balance: a strong cast beyond the sliders is finished with offset', () => {
  const light: RGB = [2.4, 1, 0.35];
  const frame = castFrame(64, 36, light);
  const sol = solveWhiteBalance(estimateIlluminant(frame, linearTable('rec709'))!.cast, wbMatrix);
  const c = clipWith();
  applyWhiteBalanceTo(c, 0, sol);
  assert.equal(c.grade.temperature, -100);
  assert.ok(c.grade.offset.r !== 0 || c.grade.offset.b !== 0);
  const grey = gradePixel(c.grade, [0.18 * light[0], 0.18 * light[1], 0.18 * light[2]]);
  assert.ok(Math.abs(Math.log2(grey[0] / grey[1])) < 0.08 && Math.abs(Math.log2(grey[2] / grey[1])) < 0.08, `${grey}`);
});

function gradient(w: number, h: number, f: (x: number, y: number) => RGB) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const c = f(x / (w - 1), y / (h - 1));
      data.set([c[0] * 255, c[1] * 255, c[2] * 255, 255], (y * w + x) * 4);
    }
  return { width: w, height: h, data };
}

test('match end-to-end through the renderer math: the graded shot takes on the reference statistics', () => {
  const ref = gradient(48, 27, (x, y) => [0.25 + 0.5 * x, 0.2 + 0.45 * y, 0.15 + 0.35 * (1 - x) * y]);
  const cur = gradient(48, 27, (x, y) => [0.3 + 0.36 * x, 0.27 + 0.36 * y, 0.22 + 0.3 * (1 - x) * y]); // flatter, cooler, a little brighter
  const table = logDomainTable('rec709');
  const sol = solveMatch(cur, ref, table);
  const c = clipWith();
  applyMatchTo(c, 0, sol);
  // render the current shot through the clip's new grade
  const f = compileGrade(c.grade);
  const out = new Uint8ClampedArray(cur.data.length);
  for (let i = 0; i < cur.data.length; i += 4) {
    const o = f([cur.data[i] / 255, cur.data[i + 1] / 255, cur.data[i + 2] / 255]);
    out.set([o[0] * 255, o[1] * 255, o[2] * 255, 255], i);
  }
  const got = channelStats({ width: cur.width, height: cur.height, data: out }, undefined, table);
  const want = channelStats(ref, undefined, table);
  const before = channelStats(cur, undefined, table);
  for (let k = 0; k < 3; k++) {
    assert.ok(Math.abs(got.mean[k] - want.mean[k]) < 0.015, `mean ${k}: ${got.mean[k]} vs ${want.mean[k]} (was ${before.mean[k]})`);
    assert.ok(Math.abs(got.std[k] - want.std[k]) < 0.02, `std ${k}: ${got.std[k]} vs ${want.std[k]} (was ${before.std[k]})`);
  }
});

test('match: applying a solution twice composes (contrast takes the common scale, gain the rest)', () => {
  const c = clipWith();
  applyMatchTo(c, 0, { gain: [1.1, 1, 0.9], offset: [0, 0, 0], saturation: 1.5 });
  applyMatchTo(c, 0, { gain: [1.1, 1, 1], offset: [0.01, 0, 0], saturation: 0.5 });
  const k1 = Math.cbrt(1.1 * 0.9);
  const k2 = Math.cbrt(1.1);
  assert.ok(Math.abs(c.grade.contrast - k1 * k2) < 1e-3, `contrast ${c.grade.contrast}`);
  // per-channel balance: red total 1.21, blue 0.9, relative to the common scale
  const G = (v: number) => Math.pow(2, v * 0.5);
  assert.ok(Math.abs(G(c.grade.gain.r) / G(c.grade.gain.b) - 1.21 / 0.9) < 2e-3, `${c.grade.gain.r} ${c.grade.gain.b}`);
  assert.ok(Math.abs(c.grade.saturation - 0.75) < 1e-3);
  assert.equal(channelStats(castFrame(4, 4, [1, 1, 1])).count, 16);
});
