import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyEase, evaluate, hasModifiers, paramAt, shiftKeyframes } from './keyframes';
import {
  PHYSICAL_EASES,
  defaultModifier,
  dropModifiers,
  fbm,
  loopMap,
  noise1,
  physicalEase,
  scaleModifiers,
  shiftModifiers,
  wiggleOffset,
} from './motion';
import { makeClip } from '../state/defaults';
import type { Clip, FollowModifier, Keyframe, LoopModifier, WiggleModifier } from '../state/types';

const near = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} !≈ ${b}`);
const kf = (t: number, v: number, ease: Keyframe['ease'] = 'linear'): Keyframe => ({ t, v, ease });
const clipWith = (init: Partial<Clip> = {}): Clip => makeClip('solid', { start: 0, duration: 10, ...init });

// ---------------------------------------------------------------------------
// Physical eases
// ---------------------------------------------------------------------------

test('every physical ease starts at 0 and lands exactly on 1, in every direction', () => {
  for (const kind of PHYSICAL_EASES) {
    for (const dir of ['out', 'in', 'inOut'] as const) {
      near(physicalEase(kind, 0, { dir }), 0, 1e-9);
      near(physicalEase(kind, 1, { dir }), 1, 1e-9);
    }
  }
});

test('back overshoots, spring overshoots then settles, bounce never leaves [0,1]', () => {
  let peak = 0;
  for (let i = 0; i <= 200; i++) peak = Math.max(peak, physicalEase('back', i / 200));
  assert.ok(peak > 1.05 && peak < 1.2, `back peak ${peak}`);

  let springPeak = 0;
  for (let i = 0; i <= 200; i++) springPeak = Math.max(springPeak, physicalEase('spring', i / 200));
  assert.ok(springPeak > 1.02, `spring should overshoot at default bounce, got ${springPeak}`);
  near(physicalEase('spring', 0.999), 1, 0.01);

  for (let i = 0; i <= 200; i++) {
    const b = physicalEase('bounce', i / 200);
    assert.ok(b >= 0 && b <= 1 + 1e-12, `bounce ${b}`);
  }
});

test('spring with bounce 0 is critically damped: no overshoot at all', () => {
  for (let i = 0; i <= 200; i++) assert.ok(physicalEase('spring', i / 200, { bounce: 0 }) <= 1 + 1e-9);
});

test('more spring bounce means a bigger first overshoot', () => {
  const peak = (b: number) => Math.max(...Array.from({ length: 400 }, (_, i) => physicalEase('spring', i / 400, { bounce: b })));
  assert.ok(peak(0.2) < peak(0.5));
  assert.ok(peak(0.5) < peak(0.9));
});

test('back overshoot and elastic period parameters change the curve', () => {
  assert.ok(physicalEase('back', 0.6, { overshoot: 3 }) > physicalEase('back', 0.6, { overshoot: 0.5 }));
  assert.notEqual(physicalEase('elastic', 0.35, { period: 0.2 }), physicalEase('elastic', 0.35, { period: 0.6 }));
});

test('applyEase routes physical eases and ignores bez for them', () => {
  assert.equal(applyEase('spring', 0.4, undefined, { bounce: 0.7 }), physicalEase('spring', 0.4, { bounce: 0.7 }));
  assert.equal(applyEase('linear', 0.4), 0.4);
  near(applyEase('easeInOut', 0.5), 0.5, 1e-4);
});

test('evaluate uses the keyframe ease params and lets values pass the end mid-segment', () => {
  const kfs: Keyframe[] = [{ t: 0, v: 0, ease: 'back' }, kf(1, 100)];
  let max = 0;
  for (let i = 0; i <= 100; i++) max = Math.max(max, evaluate(kfs, i / 100));
  assert.ok(max > 105, `expected overshoot above 100, got ${max}`);
  near(evaluate(kfs, 1), 100);
  near(evaluate(kfs, 2), 100);
});

// ---------------------------------------------------------------------------
// Noise
// ---------------------------------------------------------------------------

test('noise is deterministic, seed-dependent and bounded', () => {
  assert.equal(noise1(3.7, 5), noise1(3.7, 5));
  assert.notEqual(noise1(3.7, 5), noise1(3.7, 6));
  for (let i = 0; i < 2000; i++) {
    const x = i * 0.137 - 100;
    const n = noise1(x, 9);
    assert.ok(n >= -1 && n <= 1, `noise1 ${n}`);
    const f = fbm(x, 9, 4);
    assert.ok(f >= -1 && f <= 1, `fbm ${f}`);
  }
});

test('noise is continuous (no jumps between neighbouring samples)', () => {
  let worst = 0;
  for (let i = 0; i < 4000; i++) {
    const x = i * 0.001;
    worst = Math.max(worst, Math.abs(noise1(x + 0.001, 3) - noise1(x, 3)));
  }
  assert.ok(worst < 0.02, `max step ${worst}`);
});

test('noise has real spread, so a wiggle actually moves', () => {
  const vals = Array.from({ length: 500 }, (_, i) => noise1(i * 0.31, 2));
  assert.ok(Math.max(...vals) > 0.5 && Math.min(...vals) < -0.5);
});

// ---------------------------------------------------------------------------
// Modifiers through paramAt
// ---------------------------------------------------------------------------

test('params without modifiers behave exactly as before', () => {
  const c = clipWith({ keyframes: { 'transform.x': [kf(0, 0), kf(2, 200)] } });
  near(paramAt(c, 'transform.x', 1), 100);
  near(paramAt(c, 'transform.y', 1), 0);
  assert.equal(hasModifiers(c, 'transform.x'), false);
});

test('wiggle adds bounded, repeatable motion on top of a static value', () => {
  const c = clipWith();
  const w = defaultModifier('wiggle', 'w1') as WiggleModifier;
  w.amp = 20;
  c.modifiers = { 'transform.x': [w] };
  const a = paramAt(c, 'transform.x', 1.234);
  assert.equal(a, paramAt(c, 'transform.x', 1.234), 'same time, same value');
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < 600; i++) {
    const v = paramAt(c, 'transform.x', i / 30);
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  assert.ok(lo >= -20 - 1e-9 && hi <= 20 + 1e-9, `range ${lo}..${hi}`);
  assert.ok(hi - lo > 15, 'should use most of its amplitude');
  assert.equal(hasModifiers(c, 'transform.x'), true);
});

test('wiggle rides on keyframes and respects fade-in', () => {
  const c = clipWith({ keyframes: { 'transform.x': [kf(0, 100), kf(4, 100)] } });
  const w = defaultModifier('wiggle', 'w1') as WiggleModifier;
  w.amp = 30;
  w.fadeIn = 2;
  c.modifiers = { 'transform.x': [w] };
  near(paramAt(c, 'transform.x', 0), 100); // fully faded at the origin
  let late = 0;
  for (let i = 0; i < 100; i++) late = Math.max(late, Math.abs(paramAt(c, 'transform.x', 2 + i / 50) - 100));
  assert.ok(late > 5, 'wiggle is fully present after the fade');
  assert.ok(Math.abs(paramAt(c, 'transform.x', 0.05) - 100) < Math.abs(30), 'still small near the start');
});

test('different seeds give different wiggles; the same seed repeats', () => {
  const a = defaultModifier('wiggle', 'a') as WiggleModifier;
  const b = { ...a, id: 'b', seed: a.seed + 1 } as WiggleModifier;
  assert.notEqual(wiggleOffset(a, 1.1), wiggleOffset(b, 1.1));
  assert.equal(wiggleOffset(a, 1.1), wiggleOffset({ ...a, id: 'c' }, 1.1));
});

test('disabled modifiers do nothing', () => {
  const c = clipWith();
  const w = defaultModifier('wiggle', 'w1') as WiggleModifier;
  w.enabled = false;
  c.modifiers = { 'transform.x': [w] };
  assert.equal(paramAt(c, 'transform.x', 1.5), 0);
  assert.equal(hasModifiers(c, 'transform.x'), false);
});

test('modifiers are ignored on speed-ramp paths', () => {
  const c = clipWith({ keyframes: { 'time.speed': [kf(0, 1), kf(2, 2)] } });
  c.modifiers = { 'time.speed': [defaultModifier('wiggle', 'w') as WiggleModifier] };
  near(paramAt(c, 'time.speed', 1), 1.5);
});

test('loop cycle repeats the keyframed animation after the last key', () => {
  const kfs = [kf(1, 0), kf(3, 100)];
  near(loopMap(kfs, 2, 'cycle').t, 2); // inside the span: unchanged
  near(loopMap(kfs, 4, 'cycle').t, 2); // 1 s into the second cycle
  near(loopMap(kfs, 5, 'cycle').t, 1); // start of the third
  const c = clipWith({ keyframes: { 'transform.x': kfs } });
  c.modifiers = { 'transform.x': [defaultModifier('loop', 'l') as LoopModifier] };
  near(paramAt(c, 'transform.x', 4), 50);
  near(paramAt(c, 'transform.x', 0), 0); // before the first key it holds, as always
});

test('loop pingpong goes back and forth', () => {
  const kfs = [kf(0, 0), kf(2, 100)];
  near(loopMap(kfs, 3, 'pingpong').t, 1); // coming back down
  near(loopMap(kfs, 4, 'pingpong').t, 0);
  near(loopMap(kfs, 5, 'pingpong').t, 1); // going up again
  const c = clipWith({ keyframes: { 'transform.x': kfs } });
  const l = defaultModifier('loop', 'l') as LoopModifier;
  l.mode = 'pingpong';
  c.modifiers = { 'transform.x': [l] };
  near(paramAt(c, 'transform.x', 3), 50);
});

test('loop offset keeps climbing by the keyframe delta each cycle', () => {
  const c = clipWith({ keyframes: { 'transform.rotation': [kf(0, 0), kf(1, 90)] } });
  const l = defaultModifier('loop', 'l') as LoopModifier;
  l.mode = 'offset';
  c.modifiers = { 'transform.rotation': [l] };
  near(paramAt(c, 'transform.rotation', 0.5), 45);
  near(paramAt(c, 'transform.rotation', 1.5), 135);
  near(paramAt(c, 'transform.rotation', 3.25), 3 * 90 + 22.5);
});

test('loop needs two keyframes and a real span', () => {
  assert.deepEqual(loopMap([kf(1, 5)], 9, 'cycle'), { t: 9, add: 0 });
  assert.deepEqual(loopMap([kf(1, 5), kf(1, 9)], 9, 'cycle'), { t: 9, add: 0 });
});

test('follow drives one param from another with scale, offset and delay', () => {
  const c = clipWith({ keyframes: { 'transform.x': [kf(0, 0), kf(10, 100)] } });
  const f = defaultModifier('follow', 'f') as FollowModifier;
  f.source = 'transform.x';
  c.modifiers = { 'transform.y': [{ ...f, source: 'transform.x', scale: 0.5, offset: 7, delay: 2 }] };
  near(paramAt(c, 'transform.y', 6), 0.5 * 40 + 7); // source sampled at t − delay = 4
  near(paramAt(c, 'transform.y', 1), 0.5 * 0 + 7); // before the delay: the source's first value
});

test('follow cycles and self-references cannot hang or blow up', () => {
  const c = clipWith();
  const a = { ...(defaultModifier('follow', 'a') as FollowModifier), source: 'transform.y' };
  const b = { ...(defaultModifier('follow', 'b') as FollowModifier), source: 'transform.x' };
  const self = { ...(defaultModifier('follow', 's') as FollowModifier), source: 'transform.scale' };
  c.modifiers = { 'transform.x': [a], 'transform.y': [b], 'transform.scale': [self] };
  assert.ok(Number.isFinite(paramAt(c, 'transform.x', 1)));
  assert.ok(Number.isFinite(paramAt(c, 'transform.scale', 1)));
});

test('modifier order is loop, then keyframes, then follow, then wiggle', () => {
  const c = clipWith({ keyframes: { 'transform.x': [kf(0, 0), kf(1, 10)] } });
  const loop = defaultModifier('loop', 'l') as LoopModifier;
  const fol = { ...(defaultModifier('follow', 'f') as FollowModifier), source: 'transform.y', offset: 100 };
  c.modifiers = { 'transform.x': [defaultModifier('wiggle', 'w'), fol, loop] };
  // Wiggle listed first still applies last; compare against the sum of the parts.
  const base = 5 + 100; // loop at t = 1.5 → keyframes at 0.5 = 5, plus the follow's offset
  const w = wiggleOffset(defaultModifier('wiggle', 'w') as WiggleModifier, 1.5);
  near(paramAt(c, 'transform.x', 1.5), base + w);
});

// ---------------------------------------------------------------------------
// Time edits
// ---------------------------------------------------------------------------

test('shifting keyframes also moves a wiggle origin so the motion stays on the picture', () => {
  const c = clipWith();
  const w = defaultModifier('wiggle', 'w') as WiggleModifier;
  w.origin = 1;
  c.modifiers = { 'transform.x': [w] };
  const before = paramAt(c, 'transform.x', 3);
  shiftKeyframes(c, -2); // a 2 s head trim: local time 3 becomes 1
  near(paramAt(c, 'transform.x', 1), before, 1e-12);
});

test('stretching time scales wiggle rate, origin, fade and follow delay', () => {
  const c = clipWith();
  const w = { ...(defaultModifier('wiggle', 'w') as WiggleModifier), freq: 4, origin: 1, fadeIn: 0.5 };
  const f = { ...(defaultModifier('follow', 'f') as FollowModifier), delay: 0.2 };
  c.modifiers = { 'transform.x': [w, f] };
  scaleModifiers(c, 2);
  near((c.modifiers['transform.x'][0] as WiggleModifier).freq, 2);
  near((c.modifiers['transform.x'][0] as WiggleModifier).origin, 2);
  near((c.modifiers['transform.x'][0] as WiggleModifier).fadeIn, 1);
  near((c.modifiers['transform.x'][1] as FollowModifier).delay, 0.4);
  scaleModifiers(c, 1);
  scaleModifiers(c, -3); // ignored
  near((c.modifiers['transform.x'][0] as WiggleModifier).freq, 2);
});

test('shiftModifiers and dropModifiers handle clips without modifiers', () => {
  const c = clipWith();
  shiftModifiers(c, 3);
  scaleModifiers(c, 2);
  dropModifiers(c, 'effects.');
  assert.equal(c.modifiers, undefined);
  c.modifiers = { 'effects.fx1.amount': [defaultModifier('wiggle', 'w')], 'transform.x': [defaultModifier('wiggle', 'v')] };
  dropModifiers(c, 'effects.fx1.');
  assert.deepEqual(Object.keys(c.modifiers ?? {}), ['transform.x']);
  dropModifiers(c, 'transform.');
  assert.equal(c.modifiers, undefined);
});

import { sanitizeModifiers as sanitize } from './motion';
import { test as t2 } from 'node:test';
import assert2 from 'node:assert/strict';

t2('sanitizeModifiers drops junk and clamps numbers', () => {
  const out = sanitize({
    'transform.x': [{ type: 'wiggle', amp: Infinity, freq: -5, octaves: 99 }, { type: 'bogus' }, null],
    'time.speed': [{ type: 'loop' }],
    'transform.y': 'nope',
  });
  assert2.deepEqual(Object.keys(out ?? {}), ['transform.x']);
  const w = out!['transform.x'][0];
  assert2.equal(w.type, 'wiggle');
  if (w.type === 'wiggle') {
    assert2.equal(w.amp, 10);
    assert2.equal(w.octaves, 6);
    assert2.ok(w.freq > 0);
  }
  assert2.equal(sanitize(undefined), undefined);
});
