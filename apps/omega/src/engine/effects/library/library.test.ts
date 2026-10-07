// Static checks of the effects library (the GLSL itself is compiled and
// rendered by `npm run test:effects` in headless Chromium).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EFFECTS, TRANSITIONS } from './index';
import { gaussChainSigma, gaussLevels } from './glsl';

const TRANSITION_TYPES = [
  'crossDissolve',
  'filmDissolve',
  'additiveDissolve',
  'dipToBlack',
  'dipToWhite',
  'wipe',
  'slide',
  'push',
  'zoom',
  'blurDissolve',
  'iris',
  'clockWipe',
  'whip',
  'glitch',
  'lightLeak',
  'audioCrossfade',
];

// GLSL ES 3.00 reserved words that are easy to use by accident as names.
const RESERVED = ['active', 'input', 'output', 'filter', 'sample', 'half', 'fixed', 'common', 'partition', 'patch', 'resource', 'interface', 'long', 'short', 'double', 'unsigned', 'superp', 'namespace', 'using', 'cast', 'goto', 'inline', 'static', 'extern', 'external', 'public', 'class', 'union', 'enum', 'typedef', 'template', 'this', 'volatile', 'coherent', 'restrict', 'readonly', 'writeonly', 'atomic_uint', 'noperspective', 'subroutine', 'asm', 'sizeof'];
const DECL = new RegExp(`\\b(?:float|int|bool|vec[234]|ivec[234]|mat[234])\\s+(${RESERVED.join('|')})\\b`);

test('library size and unique types', () => {
  assert.ok(EFFECTS.length >= 40, `expected at least 40 effects, got ${EFFECTS.length}`);
  assert.equal(new Set(EFFECTS.map((e) => e.type)).size, EFFECTS.length);
  assert.deepEqual(TRANSITIONS.map((t) => t.type).sort(), [...TRANSITION_TYPES].sort());
});

test('every param is well formed', () => {
  for (const def of [...EFFECTS, ...TRANSITIONS]) {
    const keys = new Set<string>();
    for (const p of def.params) {
      const where = `${def.type}.${p.key}`;
      assert.match(p.key, /^[a-zA-Z][a-zA-Z0-9]*$/, where);
      assert.ok(!keys.has(p.key), `duplicate ${where}`);
      keys.add(p.key);
      assert.ok(p.label.length > 0, where);
      if (p.type === 'number' || p.type === 'angle') {
        assert.equal(typeof p.default, 'number', where);
        const d = p.default as number;
        if (p.min !== undefined) assert.ok(d >= p.min, `${where} default < min`);
        if (p.max !== undefined) assert.ok(d <= p.max, `${where} default > max`);
        if (p.softMin !== undefined && p.min !== undefined) assert.ok(p.softMin >= p.min, where);
        if (p.softMax !== undefined && p.max !== undefined) assert.ok(p.softMax <= p.max, where);
      }
      if (p.type === 'choice') {
        assert.ok(p.choices && p.choices.length > 1, where);
        p.choices!.forEach((c, i) => assert.equal(c.value, i, `${where}: choice values must equal their index`));
        assert.ok(p.choices!.some((c) => c.value === p.default), `${where} default not a choice`);
      }
      if (p.type === 'color') assert.match(String(p.default), /^#[0-9a-f]{6}([0-9a-f]{2})?$/i, where);
      if (p.type === 'point') assert.match(String(p.default), /^-?[\d.]+,-?[\d.]+$/, where);
      if (p.type === 'bool') assert.equal(typeof p.default, 'boolean', where);
    }
  }
});

test('effects define effect(), passes are stable and expand works across ranges', () => {
  for (const def of EFFECTS) {
    assert.ok(def.description.length > 20, `${def.type} needs a description`);
    assert.ok(def.passes.length > 0, `${def.type} has no passes`);
    for (const p of def.passes) {
      assert.match(p.glsl, /vec4\s+effect\s*\(\s*vec2\s+uv\s*\)/, def.type);
      assert.doesNotMatch(p.glsl, DECL, `${def.type} uses a GLSL reserved word`);
    }
    if (!def.expand) continue;
    const base = Object.fromEntries(def.params.map((p) => [p.key, p.default]));
    const a = def.expand(base, { w: 1920, h: 1080 });
    const b = def.expand(base, { w: 1920, h: 1080 });
    assert.ok(a.length > 0, def.type);
    assert.ok(
      a.every((p, i) => p === b[i]),
      `${def.type}: expand must return cached pass objects`,
    );
    for (const p of def.params) {
      if (p.type !== 'number' && p.type !== 'angle') continue;
      for (const v of [p.min ?? 0, p.max ?? 1000, 0, -5]) {
        const passes = def.expand({ ...base, [p.key]: v }, { w: 3840, h: 2160 });
        assert.ok(passes.length > 0 && passes.length <= 40, `${def.type} ${p.key}=${v}: ${passes.length} passes`);
        for (const ps of passes) assert.doesNotMatch(ps.glsl, DECL, `${def.type} uses a GLSL reserved word`);
      }
    }
  }
});

test('transitions define transition() and never read u_src', () => {
  for (const def of TRANSITIONS) {
    assert.match(def.glsl, /vec4\s+transition\s*\(\s*vec2\s+uv\s*\)/, def.type);
    assert.doesNotMatch(def.glsl, /\bu_src\b|\bu_orig\b|\bu_time\b|\bu_seed\b/, `${def.type} uses an effect-only uniform`);
    assert.doesNotMatch(def.glsl, DECL, `${def.type} uses a GLSL reserved word`);
    for (const p of def.params) assert.notEqual(p.type, 'point', `${def.type}.${p.key}: transitions store numbers only`);
  }
});

test('multi-level Gaussian realizes the requested sigma', () => {
  let prev = 0;
  for (const s of [0.3, 1, 2.6, 2.7, 5, 11, 12, 40, 100, 333, 1000]) {
    const L = gaussLevels(s);
    assert.ok(L >= prev, 'levels grow with sigma');
    prev = L;
    const real = gaussChainSigma(s);
    assert.ok(Math.abs(real - s) / s < 0.01, `sigma ${s} → ${real}`);
  }
  assert.equal(gaussLevels(1), 1);
  assert.ok(gaussLevels(1000) <= 11);
});
