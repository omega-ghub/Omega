import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  INPUT_TRANSFORMS,
  acescctDecode,
  acescctEncode,
  apply3,
  bt709InvOetf,
  bt709Oetf,
  clog3Decode,
  clog3Encode,
  decodeInputRgb,
  encodeInputRgb,
  flogDecode,
  flogEncode,
  gamutClip,
  gamutMatrix,
  glf,
  gradeLogDecode,
  gradeLogEncode,
  graphicsColorLinear,
  hlgDecodeRgb,
  hlgEncodeRgb,
  hlgInvOetf,
  hlgOetf,
  inv3,
  logc3Decode,
  logc3Encode,
  mul3,
  outputEncodeRgb,
  parseHexColor,
  pqDecode,
  pqEncode,
  pqEotfNits,
  pqInvEotfNits,
  slog3Decode,
  slog3Encode,
  srgbDecode,
  srgbEncode,
  tonemapScalar,
  vlogDecode,
  vlogEncode,
  type InputCurveId,
  type Vec3,
} from './transforms';

const close = (a: number, b: number, eps: number, msg = '') => assert.ok(Math.abs(a - b) <= eps, `${msg} expected ${b}, got ${a} (±${eps})`);

const SAMPLES = [-0.05, 0, 0.001, 0.005, 0.0125, 0.018, 0.05, 0.18, 0.5, 0.9, 1, 2, 8, 16];

function roundTrip(name: string, enc: (x: number) => number, dec: (x: number) => number, xs = SAMPLES, eps = 1e-9) {
  for (const x of xs) close(dec(enc(x)), x, eps * Math.max(1, Math.abs(x)), `${name}(${x})`);
}

test('BT.709 OETF round-trips and matches the published points', () => {
  roundTrip('bt709', bt709Oetf, bt709InvOetf);
  close(bt709Oetf(0.018), 0.081, 0.0003);
  close(bt709Oetf(1), 1, 1e-12);
  close(bt709Oetf(0.18), 0.409, 0.001);
  // 50% grey code value ↔ linear
  close(bt709Oetf(bt709InvOetf(128 / 255)), 128 / 255, 1e-12);
});

test('sRGB round-trips and hits the published constants', () => {
  roundTrip('srgb', srgbEncode, srgbDecode);
  close(srgbDecode(0.5), 0.214041, 1e-6);
  close(srgbEncode(0.0031308), 0.04045, 1e-6);
});

test('S-Log3: 18% grey at CV 420, black at CV 95, round trip', () => {
  close(slog3Encode(0.18) * 1023, 420, 1e-6);
  close(slog3Encode(0) * 1023, 95, 1e-6);
  close(slog3Decode(420 / 1023), 0.18, 1e-9);
  roundTrip('slog3', slog3Encode, slog3Decode);
});

test('ARRI LogC3 EI800: 18% grey ≈ 0.391 (CV 400), round trip', () => {
  close(logc3Encode(0.18), 0.391007, 2e-6);
  close(logc3Encode(0), 0.092809, 1e-9);
  roundTrip('logc3', logc3Encode, logc3Decode);
});

test('Panasonic V-Log: 18% grey ≈ 0.4233, black 0.125, round trip', () => {
  close(vlogEncode(0.18), 0.42331, 2e-5);
  close(vlogEncode(0), 0.125, 1e-12);
  close(vlogEncode(0.01), 0.181, 2e-5);
  roundTrip('vlog', vlogEncode, vlogDecode);
});

test('Canon Log 3: 18% grey = 34.3% IRE, black 12.5%, round trip incl. negatives', () => {
  close(clog3Encode(0.18), 0.3434, 2e-4);
  close(clog3Encode(0), 0.12512219, 1e-9);
  // Canon's published constants are rounded, so the segments meet to ~1e-7.
  roundTrip('clog3', clog3Encode, clog3Decode, [-0.05, -0.0126, -0.001, ...SAMPLES.slice(1)], 1e-6);
});

test('Fujifilm F-Log: 18% grey ≈ 0.4593 (46% IRE), round trip', () => {
  close(flogEncode(0.18), 0.45932, 5e-5);
  close(flogEncode(0), 0.092864, 1e-9);
  roundTrip('flog', flogEncode, flogDecode);
});

test('HLG: reference white (75%) → 203 nits after the 1000-nit OOTF; round trip', () => {
  const w = hlgDecodeRgb([0.75, 0.75, 0.75]);
  close(w[0] * 100, 203, 1);
  close(hlgDecodeRgb([1, 1, 1])[0], 10, 1e-6); // published a/b/c are rounded
  for (const e of [0, 0.01, 1 / 12, 0.3, 0.5, 0.9, 1]) close(hlgInvOetf(hlgOetf(e)), e, 1e-12, `hlg ${e}`);
  const c: Vec3 = [0.3, 0.6, 0.45];
  const back = hlgEncodeRgb(hlgDecodeRgb(c));
  for (let i = 0; i < 3; i++) close(back[i], c[i], 1e-9);
});

test('PQ: 100 nits ≈ 0.5081, 10000 nits = 1.0, round trip; 1.0 linear = 100 nits', () => {
  close(pqInvEotfNits(100), 0.508078, 1e-5);
  close(pqEotfNits(1), 10000, 1e-6);
  close(pqDecode(pqInvEotfNits(100)), 1, 1e-9);
  roundTrip('pq', pqEncode, pqDecode, [0, 0.001, 0.18, 1, 2.03, 10, 100], 1e-7);
});

test('ACEScct and the grading log space (18% grey at 0.435)', () => {
  close(acescctEncode(0.18), 0.4135884, 1e-6);
  close(acescctEncode(0), 0.0729055341958355, 1e-12);
  roundTrip('acescct', acescctEncode, acescctDecode, [-0.01, 0, 0.0078125, 0.18, 1, 100]);
  close(gradeLogEncode(0.18), 0.435, 1e-12);
  roundTrip('gradeLog', gradeLogEncode, gradeLogDecode, [0, 0.01, 0.18, 1, 10]);
});

test('gamut matrices: Rec.2020 → Rec.709 matches BT.2087, white is preserved', () => {
  const m = gamutMatrix('rec2020', 'rec709');
  const ref = [1.6605, -0.5876, -0.0728, -0.1246, 1.1329, -0.0083, -0.0182, -0.1006, 1.1187];
  for (let i = 0; i < 9; i++) close(m[i], ref[i], 2e-4, `m[${i}]`);
  for (const id of ['rec2020', 'p3d65', 'sgamut3cine', 'awg3', 'vgamut', 'cinemagamut', 'fgamut'] as const) {
    const w = apply3(gamutMatrix(id, 'rec709'), [1, 1, 1]);
    for (let i = 0; i < 3; i++) close(w[i], 1, 1e-9, `${id} white`);
    const rt = mul3(gamutMatrix('rec709', id), gamutMatrix(id, 'rec709'));
    for (let i = 0; i < 9; i++) close(rt[i], i % 4 === 0 ? 1 : 0, 1e-9, `${id} round trip`);
  }
  const inv = inv3(gamutMatrix('p3d65', 'rec709'));
  const p = gamutMatrix('rec709', 'p3d65');
  for (let i = 0; i < 9; i++) close(inv[i], p[i], 1e-9);
});

test('every input transform round-trips through decode/encode (RGB, with gamut)', () => {
  const colors: Vec3[] = [
    [0.18, 0.18, 0.18],
    [0.5, 0.2, 0.1],
    [0.05, 0.3, 0.6],
    [0.9, 0.9, 0.9],
  ];
  for (const id of Object.keys(INPUT_TRANSFORMS) as InputCurveId[]) {
    for (const lin of colors) {
      const enc = encodeInputRgb(id, lin);
      const back = decodeInputRgb(id, enc);
      for (let i = 0; i < 3; i++) close(back[i], lin[i], 1e-7, `${id} ${lin}`);
    }
  }
  // Log grey cards decode to 18% after the legal-range remap
  const greyCv: Record<string, number> = { slog3: 420, logc3: 400.0, vlog: 433 };
  for (const [id, cv] of Object.entries(greyCv)) {
    const v = (cv - 64) / 876;
    close(decodeInputRgb(id, [v, v, v])[0], 0.18, 0.004, id);
  }
});

test('output transforms: identity for in-gamut Rec.709 / sRGB code values', () => {
  for (const v of [0, 0.1, 0.25, 128 / 255, 0.75, 1]) {
    close(outputEncodeRgb('rec709', [bt709InvOetf(v), bt709InvOetf(v), bt709InvOetf(v)])[0], v, 1e-9);
    close(outputEncodeRgb('srgb', [srgbDecode(v), srgbDecode(v), srgbDecode(v)])[1], v, 1e-9);
  }
  // Pure primaries survive (no desaturation of in-gamut colors)
  assert.deepEqual(outputEncodeRgb('rec709', [1, 0, 0]), [1, 0, 0]);
  // P3: 709 white stays white; 709 red becomes a less saturated P3 red
  const pw = outputEncodeRgb('p3', [1, 1, 1]);
  for (const v of pw) close(v, 1, 1e-9);
  const pr = outputEncodeRgb('p3', [1, 0, 0]);
  assert.ok(pr[0] < 1 && pr[1] > 0.2, `p3 red ${pr}`);
});

test('gamut clip preserves hue order and keeps in-gamut colors', () => {
  assert.deepEqual(gamutClip([0.5, 0.25, 0.1]), [0.5, 0.25, 0.1]);
  const c = gamutClip([0.8, 0.4, -0.2]);
  close(Math.min(...c), 0, 1e-12);
  close(c[0], 0.8, 1e-12);
  assert.ok(c[1] > c[2]);
});

test('HDR → SDR tone curve: identity below knee, monotone, reaches 1 at peak', () => {
  close(tonemapScalar(0.5), 0.5, 0);
  let prev = 0;
  for (let x = 0; x <= 12; x += 0.01) {
    const y = tonemapScalar(x);
    assert.ok(y >= prev - 1e-12, `monotone at ${x}`);
    prev = y;
  }
  close(tonemapScalar(10), 1, 1e-9);
  // derivative continuous at the knee
  close((tonemapScalar(0.7501) - tonemapScalar(0.75)) / 0.0001, 1, 1e-3);
  // HDR reference white (203 nits) lands high but below peak
  const rw = tonemapScalar(2.03);
  assert.ok(rw > 0.9 && rw < 1, `${rw}`);
});

test('graphics colors decode with the sequence display transfer', () => {
  const c = graphicsColorLinear('rec709', '#808080');
  close(bt709Oetf(c[0]), 128 / 255, 1e-12);
  const s = graphicsColorLinear('srgb', '#80808080');
  close(srgbEncode(s[0]), 128 / 255, 1e-12);
  close(s[3], 128 / 255, 1e-12);
  assert.deepEqual(parseHexColor('#fff'), [1, 1, 1, 1]);
  assert.equal(parseHexColor('nope'), null);
});

test('glf prints GLSL float literals', () => {
  assert.equal(glf(1), '1.0');
  assert.equal(glf(0.5), '0.5');
  assert.equal(glf(-2), '-2.0');
  assert.ok(!glf(1 / 3).endsWith('.'));
});
