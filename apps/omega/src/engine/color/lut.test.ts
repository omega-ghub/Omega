import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CubeParseError, applyLut, identityLut, parseCube, writeCube } from './lut';

const close = (a: number, b: number, eps: number, msg = '') => assert.ok(Math.abs(a - b) <= eps, `${msg} expected ${b}, got ${a}`);

const CUBE_3D = `# Created by a test
TITLE "Warm # look"
LUT_3D_SIZE 2
DOMAIN_MIN 0 0 0
DOMAIN_MAX 1 1 1

0 0 0
1 0 0
0 1 0
1 1 0 # inline comment
0 0 1
1 0 1
0 1 1
1 1 1
`;

test('parses a 3D cube with title, comments, domain and blank lines', () => {
  const l = parseCube(CUBE_3D);
  assert.equal(l.kind, '3d');
  assert.equal(l.size, 2);
  assert.equal(l.title, 'Warm # look');
  assert.deepEqual(l.domainMin, [0, 0, 0]);
  assert.deepEqual(l.domainMax, [1, 1, 1]);
  assert.equal(l.data.length, 8 * 3);
  // r is fastest
  assert.deepEqual(Array.from(l.data.slice(3, 6)), [1, 0, 0]);
  assert.deepEqual(Array.from(l.data.slice(6, 9)), [0, 1, 0]);
});

test('parses a 1D cube with CRLF line endings, BOM, tabs and a custom domain', () => {
  const t = '﻿LUT_1D_SIZE 3\r\nDOMAIN_MIN -0.5 -0.5 -0.5\r\nDOMAIN_MAX 1.5 1.5 1.5\r\n0\t0\t0\r\n0.5 0.5 0.5\r\n1 1 1\r\n';
  const l = parseCube(t);
  assert.equal(l.kind, '1d');
  assert.equal(l.size, 3);
  assert.deepEqual(l.domainMin, [-0.5, -0.5, -0.5]);
  assert.deepEqual(l.domainMax, [1.5, 1.5, 1.5]);
  close(applyLut(l, [0.5, 0.5, 0.5])[0], 0.5, 1e-6);
});

test('Resolve combined 1D shaper + 3D', () => {
  const lines = ['LUT_1D_SIZE 2', 'LUT_1D_INPUT_RANGE 0 2', 'LUT_3D_SIZE 2', 'LUT_3D_INPUT_RANGE 0 1', '0 0 0', '1 1 1'];
  const id = identityLut('3d', 2);
  for (let i = 0; i < id.data.length; i += 3) lines.push(`${id.data[i]} ${id.data[i + 1]} ${id.data[i + 2]}`);
  const l = parseCube(lines.join('\n'));
  assert.equal(l.kind, '3d');
  assert.ok(l.shaper);
  assert.equal(l.shaper!.size, 2);
  assert.deepEqual(l.shaper!.domainMax, [2, 2, 2]);
  close(applyLut(l, [1, 1, 1])[0], 0.5, 1e-6);
});

test('validation errors carry line numbers', () => {
  const cases: [string, number, RegExp][] = [
    ['LUT_3D_SIZE 2\n0 0 0\n1 0\n', 3, /expected 3 numbers/],
    ['LUT_3D_SIZE 2\n0 0 0\n', 2, /expected 8 data rows, found 1/],
    ['0 0 0\n', 1, /before LUT_1D_SIZE/],
    ['LUT_3D_SIZE 1\n', 1, /out of range/],
    ['LUT_3D_SIZE 999\n', 1, /out of range/],
    ['LUT_3D_SIZE 2.5\n', 1, /whole number/],
    ['LUT_1D_SIZE 2\nLUT_1D_SIZE 2\n', 2, /twice/],
    ['LUT_1D_SIZE 2\n0 0 0\n1 1 x\n', 3, /not a number/],
    ['LUT_1D_SIZE 2\n0 0 0\n1 1 1\n2 2 2\n', 4, /too many/],
    ['LUT_1D_SIZE 2\nDOMAIN_MIN 1 1 1\nDOMAIN_MAX 0 0 0\n0 0 0\n1 1 1\n', 3, /DOMAIN_MAX must be greater/],
    ['LUT_1D_SIZE 2\n0 0 0\nTITLE "late"\n1 1 1\n', 3, /after the data/],
    ['LUT_1D_SIZE 2\n0 0 0\n1 1 Infinity\n', 3, /not a number/],
    ['LUT_1D_SIZE 2\n0 0 0\n1 1 1e999\n', 3, /out of range/],
    ['LUT_1D_SIZE 2\nDOMAIN_MIN 0 0\n', 2, /three values/],
    ['', 0, /missing LUT_1D_SIZE/],
  ];
  for (const [text, line, re] of cases) {
    assert.throws(
      () => parseCube(text),
      (e: unknown) => e instanceof CubeParseError && e.line === line && re.test(e.message),
      `case ${JSON.stringify(text)}`,
    );
  }
});

test('writeCube → parseCube round trip and identity application', () => {
  const id = identityLut('3d', 17);
  const back = parseCube(writeCube(id));
  assert.equal(back.size, 17);
  for (let i = 0; i < id.data.length; i++) close(back.data[i], id.data[i], 1e-6);
  for (const c of [
    [0, 0, 0],
    [0.3, 0.6, 0.9],
    [0.123, 0.987, 0.5],
    [1, 1, 1],
  ] as [number, number, number][]) {
    const o = applyLut(back, c);
    for (let i = 0; i < 3; i++) close(o[i], c[i], 1e-5, `${c}`);
  }
});

test('tetrahedral interpolation is exact for any LUT of a linear (affine) function', () => {
  const N = 5;
  const l = identityLut('3d', N);
  // f(r,g,b) = (0.2r+0.5g, b, 0.3+0.1r)
  for (let i = 0; i < l.data.length; i += 3) {
    const [r, g, b] = [l.data[i], l.data[i + 1], l.data[i + 2]];
    l.data[i] = 0.2 * r + 0.5 * g;
    l.data[i + 1] = b;
    l.data[i + 2] = 0.3 + 0.1 * r;
  }
  for (const c of [
    [0.11, 0.73, 0.42],
    [0.9, 0.1, 0.5],
    [0.5, 0.5, 0.95],
  ] as [number, number, number][]) {
    const o = applyLut(l, c);
    close(o[0], 0.2 * c[0] + 0.5 * c[1], 1e-6);
    close(o[1], c[2], 1e-6);
    close(o[2], 0.3 + 0.1 * c[0], 1e-6);
  }
});

test('fuzz: mutated cubes either parse to a consistent LUT or throw CubeParseError', () => {
  let seed = 12345;
  const rnd = () => {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    return seed / 2 ** 32;
  };
  const base = writeCube(identityLut('3d', 3)) + CUBE_3D;
  const alphabet = '0123456789 .-+eE#\n\r\tLUT_3DSIZEDOMAINMXTL"x';
  const t0 = Date.now();
  for (let iter = 0; iter < 3000; iter++) {
    const chars = base.split('');
    const edits = 1 + Math.floor(rnd() * 6);
    for (let k = 0; k < edits; k++) {
      const p = Math.floor(rnd() * chars.length);
      const op = rnd();
      if (op < 0.33) chars.splice(p, 1);
      else if (op < 0.66) chars.splice(p, 0, alphabet[Math.floor(rnd() * alphabet.length)]);
      else chars[p] = alphabet[Math.floor(rnd() * alphabet.length)];
    }
    const text = chars.join('');
    try {
      const l = parseCube(text);
      const n = l.kind === '3d' ? l.size ** 3 : l.size;
      assert.equal(l.data.length, n * 3);
      for (const v of l.data) assert.ok(Number.isFinite(v));
    } catch (e) {
      assert.ok(e instanceof CubeParseError, `unexpected ${String(e)}`);
    }
  }
  assert.ok(Date.now() - t0 < 10000);
});
