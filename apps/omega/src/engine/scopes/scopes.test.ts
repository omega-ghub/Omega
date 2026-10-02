import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  analyze,
  code10ToIre,
  histogram,
  ireToCode10,
  legality,
  logDensity,
  paintPhosphor,
  rowToIre,
  skinToneLine,
  vectorPos,
  vectorscope,
  vectorTargets,
  waveformLuma,
  waveformParade,
  type RGBAFrame,
} from './scopes';

function solid(w: number, h: number, r: number, g: number, b: number): RGBAFrame {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
    data[i + 3] = 255;
  }
  return { width: w, height: h, data };
}

/** Row index holding all counts of a single column (asserts there is exactly one). */
function onlyRow(counts: Uint32Array, cols: number, rows: number, col: number): number {
  const hits: number[] = [];
  for (let r = 0; r < rows; r++) if (counts[r * cols + col]) hits.push(r);
  assert.equal(hits.length, 1, `expected one row in column ${col}, got ${hits.join(',')}`);
  return hits[0];
}

function argmax(a: Uint32Array): number {
  let best = 0;
  for (let i = 1; i < a.length; i++) if (a[i] > a[best]) best = i;
  return best;
}

test('waveform: a pure white frame sits at 100 IRE', () => {
  const wf = waveformLuma(solid(64, 36, 255, 255, 255), 64, 256);
  for (const col of [0, 31, 63]) {
    const row = onlyRow(wf.counts, wf.cols, wf.rows, col);
    assert.equal(row, 0);
    assert.equal(rowToIre(row, wf.rows), 100);
    assert.equal(wf.counts[row * wf.cols + col], 36);
  }
});

test('waveform: black sits at 0 IRE', () => {
  const wf = waveformLuma(solid(16, 9, 0, 0, 0), 16, 256);
  assert.equal(rowToIre(onlyRow(wf.counts, wf.cols, wf.rows, 5), wf.rows), 0);
});

test('waveform: mid-grey (code 128) sits at 50.2 IRE, 18 % grey (code 118) at 46.3 IRE', () => {
  const g = waveformLuma(solid(8, 8, 128, 128, 128), 8, 256);
  assert.ok(Math.abs(rowToIre(onlyRow(g.counts, g.cols, g.rows, 3), g.rows) - (128 / 255) * 100) < 0.01);
  const g18 = waveformLuma(solid(8, 8, 118, 118, 118), 8, 1024);
  assert.ok(Math.abs(rowToIre(onlyRow(g18.counts, g18.cols, g18.rows, 3), g18.rows) - 46.27) < 0.1);
});

test('waveform: pure red reads its Rec.709 luma (21.26 IRE), green 71.52 IRE', () => {
  const r = waveformLuma(solid(4, 4, 255, 0, 0), 4, 1001);
  assert.ok(Math.abs(rowToIre(onlyRow(r.counts, r.cols, r.rows, 0), r.rows) - 21.26) < 0.1);
  const g = waveformLuma(solid(4, 4, 0, 255, 0), 4, 1001);
  assert.ok(Math.abs(rowToIre(onlyRow(g.counts, g.cols, g.rows, 0), g.rows) - 71.52) < 0.1);
});

test('waveform: columns follow the horizontal position', () => {
  // left half black, right half white
  const f = solid(10, 4, 0, 0, 0);
  for (let y = 0; y < 4; y++) for (let x = 5; x < 10; x++) f.data.set([255, 255, 255, 255], (y * 10 + x) * 4);
  const wf = waveformLuma(f, 10, 256);
  assert.equal(onlyRow(wf.counts, 10, 256, 2), 255);
  assert.equal(onlyRow(wf.counts, 10, 256, 7), 0);
});

test('parade: a pure red frame has R at 100, G and B at 0', () => {
  const [r, g, b] = waveformParade(solid(8, 8, 255, 0, 0), 8, 256);
  assert.equal(rowToIre(onlyRow(r.counts, 8, 256, 4), 256), 100);
  assert.equal(rowToIre(onlyRow(g.counts, 8, 256, 4), 256), 0);
  assert.equal(rowToIre(onlyRow(b.counts, 8, 256, 4), 256), 0);
});

test('vectorscope: neutral pixels sit in the centre', () => {
  for (const v of [0, 64, 128, 255]) {
    const vs = vectorscope(solid(8, 8, v, v, v), 255, 1);
    assert.equal(argmax(vs.counts), 127 * 255 + 127);
  }
});

test('vectorscope: a pure red frame lands on the 100 % red target, 75 % red on the 75 % target', () => {
  for (const [code, amp] of [
    [255, 1],
    [191, 0.75],
  ] as const) {
    const size = 256;
    const vs = vectorscope(solid(8, 8, code, 0, 0), size, 1);
    const idx = argmax(vs.counts);
    const red = vectorTargets(amp).find((t) => t.name === 'R')!;
    const p = vectorPos(red.cb * (code / 255 / amp), red.cr * (code / 255 / amp), size, 1);
    assert.ok(Math.abs((idx % size) - p.x) <= 0.5, `x ${idx % size} vs ${p.x}`);
    assert.ok(Math.abs(Math.floor(idx / size) - p.y) <= 0.5, `y ${Math.floor(idx / size)} vs ${p.y}`);
  }
});

test('vectorscope targets: Rec.709 angles (R 103°, Yl 175°, G 230°, B 355°)', () => {
  const ang = (n: string) => {
    const t = vectorTargets(0.75).find((x) => x.name === n)!;
    return ((Math.atan2(t.cr, t.cb) * 180) / Math.PI + 360) % 360;
  };
  assert.ok(Math.abs(ang('R') - 102.9) < 1, `R ${ang('R')}`);
  assert.ok(Math.abs(ang('Yl') - 174.8) < 1, `Yl ${ang('Yl')}`);
  assert.ok(Math.abs(ang('B') - 354.8) < 1, `B ${ang('B')}`);
  assert.ok(Math.abs(ang('G') - 229.7) < 1, `G ${ang('G')}`);
  // the skin-tone line runs between red and yellow
  const s = skinToneLine();
  const sa = (Math.atan2(s.cr, s.cb) * 180) / Math.PI;
  assert.ok(sa > ang('R') && sa < ang('Yl'));
});

test('vectorscope: 2× zoom doubles the distance from the centre', () => {
  const size = 257;
  const c = (size - 1) / 2;
  const f = solid(4, 4, 160, 100, 90);
  const d = (z: number) => {
    const i = argmax(vectorscope(f, size, z).counts);
    return Math.hypot((i % size) - c, Math.floor(i / size) - c);
  };
  assert.ok(Math.abs(d(2) / d(1) - 2) < 0.1);
});

test('histogram: counts per channel and luma', () => {
  const h = histogram(solid(10, 10, 255, 0, 0));
  assert.equal(h.r[255], 100);
  assert.equal(h.g[0], 100);
  assert.equal(h.b[0], 100);
  assert.equal(h.y[54], 100); // round(0.2126·255) = 54
  assert.equal(h.total, 100);
});

test('legality: white is 100 % at/above 100 IRE, black 100 % at/below 0 IRE, grey is legal', () => {
  const w = legality(solid(8, 8, 255, 255, 255));
  assert.equal(w.highPct, 100);
  assert.equal(w.lowPct, 0);
  assert.equal(w.maxIre, 100);
  const b = legality(solid(8, 8, 0, 0, 0));
  assert.equal(b.lowPct, 100);
  assert.equal(b.highPct, 0);
  const g = legality(solid(8, 8, 128, 128, 128));
  assert.equal(g.lowPct + g.highPct, 0);
  assert.ok(Math.abs(g.meanIre - 50.2) < 0.1);
  // a fully saturated red is legal in luma but clips channels
  const r = legality(solid(8, 8, 255, 0, 0));
  assert.equal(r.highPct, 0);
  assert.equal(r.channelHighPct, 100);
  assert.equal(r.channelLowPct, 100);
});

test('legality: mixed frame percentages', () => {
  const f = solid(10, 10, 128, 128, 128);
  for (let i = 0; i < 25; i++) f.data.set([255, 255, 255, 255], i * 4); // 25 % white
  for (let i = 25; i < 35; i++) f.data.set([0, 0, 0, 255], i * 4); // 10 % black
  const s = legality(f);
  assert.equal(s.highPct, 25);
  assert.equal(s.lowPct, 10);
});

test('10-bit legal code values', () => {
  assert.equal(ireToCode10(0), 64);
  assert.equal(ireToCode10(100), 940);
  assert.equal(code10ToIre(502), 50);
});

test('density is log-scaled and normalized', () => {
  const d = logDensity(new Uint32Array([0, 1, 10, 100, 1000]));
  assert.equal(d[0], 0);
  assert.equal(d[4], 1);
  assert.ok(d[1] > 0 && d[1] < d[2] && d[2] < d[3] && d[3] < 1);
  // log: a tenth of the max is far brighter than a tenth of the brightness
  assert.ok(d[3] > 0.6);
});

test('phosphor painting: empty bins are black, dense bins bloom towards white', () => {
  const img = paintPhosphor(new Float32Array([0, 0.2, 1]), 3, 1);
  assert.deepEqual([...img.data.slice(0, 4)], [0, 0, 0, 255]);
  const faint = img.data.slice(4, 8);
  const dense = img.data.slice(8, 12);
  assert.ok(faint[1] > faint[0] && faint[1] > faint[2], 'faint trace is green-tinted');
  assert.ok(dense[0] > 200 && dense[1] > 240 && dense[2] > 200, 'dense trace is near white');
});

test('analyze produces every requested scope', () => {
  const r = analyze(solid(32, 18, 200, 120, 60), { waveform: true, parade: true, vectorscope: true, histogram: true, legality: true, rows: 128, vectorSize: 128 });
  assert.equal(r.waveform!.width, 32);
  assert.equal(r.waveform!.height, 128);
  assert.equal(r.parade!.width, 96);
  assert.equal(r.vectorscope!.width, 128);
  assert.equal(r.histogram!.r[200], 1);
  assert.equal(r.legality!.lowPct, 0);
  assert.equal(r.waveform!.data.length, 32 * 128 * 4);
});
