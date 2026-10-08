// Motion: procedural animation layered over a clip's keyframes (ADR-0005).
//   • one-click presets for the things creators reach for first
//   • Wiggle / Loop / Follow modifiers on any animatable param, with plain controls
// Modifiers never replace keyframes: they sit on top, so every edit stays reversible.

import { useState } from 'react';
import { getEffect } from '../../../../engine/effects/registry';
import { defaultModifier } from '../../../../engine/motion';
import type { Clip, Keyframe, LoopModifier, Modifier, FollowModifier, WiggleModifier } from '../../../../state/types';
import { isAnimatable, sliderRange } from '../../effects/logic';
import { editClip, ParamRow, ScrubNumber, Section, Select, Toggle, type SelectOption } from '../controls';
import { paramInfo, paramLabel } from '../paths';
import { Btn } from '../fields';

// ---------------------------------------------------------------------------
// Targets
// ---------------------------------------------------------------------------

const TRANSFORM_TARGETS = ['transform.x', 'transform.y', 'transform.scale', 'transform.rotation', 'transform.opacity', 'transform.anchorX', 'transform.anchorY'];

/** Params a modifier can drive: the transform plus every animatable effect param. */
export function motionTargets(clip: Clip): SelectOption<string>[] {
  const out: SelectOption<string>[] = TRANSFORM_TARGETS.map((p) => ({ value: p, label: paramLabel(p, clip), group: 'Transform' }));
  for (const fx of clip.effects) {
    const def = getEffect(fx.type);
    if (!def) continue;
    for (const p of def.params) if (isAnimatable(p)) out.push({ value: `effects.${fx.id}.${p.key}`, label: `${def.name}: ${p.label}`, group: 'Effects' });
  }
  return out;
}

/** A visible default amount in the param's own units (px, degrees, a fraction…). */
export function defaultAmount(path: string, clip: Clip): number {
  switch (path) {
    case 'transform.x':
    case 'transform.y':
    case 'transform.anchorX':
    case 'transform.anchorY':
      return 12;
    case 'transform.scale':
      return 0.04;
    case 'transform.rotation':
      return 2;
    case 'transform.opacity':
      return 0.15;
  }
  const [kind, id, key] = path.split('.');
  if (kind === 'effects') {
    const fx = clip.effects.find((e) => e.id === id);
    const p = fx ? getEffect(fx.type)?.params.find((x) => x.key === key) : undefined;
    if (p) {
      const { min, max } = sliderRange(p);
      return (max - min) * 0.05;
    }
  }
  return 1;
}

// ---------------------------------------------------------------------------
// Edits
// ---------------------------------------------------------------------------

function addModifier(clip: Clip, path: string, type: Modifier['type']) {
  editClip(clip.id, `Add ${type} to ${paramLabel(path, clip)}`, (c) => {
    const m = defaultModifier(type);
    if (m.type === 'wiggle') m.amp = defaultAmount(path, c);
    if (m.type === 'follow') m.source = path === 'transform.x' ? 'transform.y' : 'transform.x';
    c.modifiers ??= {};
    c.modifiers[path] = [...(c.modifiers[path] ?? []), m];
  });
}

function editModifier<T extends Modifier>(clip: Clip, path: string, id: string, field: string, apply: (m: T) => void) {
  editClip(
    clip.id,
    `Change ${field}`,
    (c) => {
      const m = c.modifiers?.[path]?.find((x) => x.id === id) as T | undefined;
      if (m) apply(m);
    },
    { coalesceKey: `ins:${clip.id}:mod:${id}:${field}` },
  );
}

function removeModifier(clip: Clip, path: string, id: string) {
  editClip(clip.id, 'Remove modifier', (c) => {
    const list = c.modifiers?.[path];
    if (!list) return;
    c.modifiers![path] = list.filter((m) => m.id !== id);
    if (!c.modifiers![path].length) delete c.modifiers![path];
    if (!Object.keys(c.modifiers!).length) delete c.modifiers;
  });
}

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

export interface MotionPreset {
  id: string;
  label: string;
  hint: string;
  apply: (c: Clip) => void;
}

function setWiggle(c: Clip, path: string, init: Partial<WiggleModifier>) {
  const m = defaultModifier('wiggle') as WiggleModifier;
  Object.assign(m, init);
  c.modifiers ??= {};
  // A preset replaces earlier wiggles on that param but keeps other modifier types.
  c.modifiers[path] = [...(c.modifiers[path] ?? []).filter((x) => x.type !== 'wiggle'), m];
}

const key = (t: number, v: number, ease: Keyframe['ease'], ezp?: Keyframe['ezp']): Keyframe => (ezp ? { t, v, ease, ezp } : { t, v, ease });

export const MOTION_PRESETS: MotionPreset[] = [
  {
    id: 'shake',
    label: 'Camera shake',
    hint: 'Fast, tight jitter for impacts and explosions',
    apply: (c) => {
      setWiggle(c, 'transform.x', { freq: 9, amp: 9, octaves: 3, seed: 11 });
      setWiggle(c, 'transform.y', { freq: 9, amp: 9, octaves: 3, seed: 23 });
      setWiggle(c, 'transform.rotation', { freq: 7, amp: 0.6, octaves: 2, seed: 37 });
    },
  },
  {
    id: 'handheld',
    label: 'Hand-held',
    hint: 'Slow, organic drift like a camera on a shoulder',
    apply: (c) => {
      setWiggle(c, 'transform.x', { freq: 1.1, amp: 7, octaves: 3, seed: 5 });
      setWiggle(c, 'transform.y', { freq: 0.9, amp: 6, octaves: 3, seed: 17 });
      setWiggle(c, 'transform.rotation', { freq: 0.7, amp: 0.4, octaves: 2, seed: 29 });
    },
  },
  {
    id: 'float',
    label: 'Float',
    hint: 'Gentle bobbing, great for logos and titles',
    apply: (c) => {
      setWiggle(c, 'transform.y', { freq: 0.35, amp: 14, octaves: 1, seed: 3 });
      setWiggle(c, 'transform.x', { freq: 0.25, amp: 6, octaves: 1, seed: 8 });
    },
  },
  {
    id: 'pulse',
    label: 'Pulse',
    hint: 'A soft heartbeat in scale',
    apply: (c) => setWiggle(c, 'transform.scale', { freq: 1.5, amp: 0.03, octaves: 1, seed: 2 }),
  },
  {
    id: 'flicker',
    label: 'Flicker',
    hint: 'Neon or old-bulb flicker (sets opacity to 80%)',
    apply: (c) => {
      c.transform.opacity = 0.8;
      setWiggle(c, 'transform.opacity', { freq: 14, amp: 0.2, octaves: 2, seed: 7 });
    },
  },
  {
    id: 'pop',
    label: 'Pop in',
    hint: 'Scales up from nothing with a springy settle',
    apply: (c) => {
      const to = c.transform.scale || 1;
      c.keyframes['transform.scale'] = [key(0, 0, 'spring', { bounce: 0.55 }), key(Math.min(0.7, c.duration), to, 'linear')];
    },
  },
  {
    id: 'slide',
    label: 'Slide & settle',
    hint: 'Slides in from the left and overshoots slightly',
    apply: (c) => {
      const to = c.transform.x;
      c.keyframes['transform.x'] = [key(0, to - 400, 'back', { overshoot: 1.4 }), key(Math.min(0.6, c.duration), to, 'linear')];
    },
  },
  {
    id: 'spin',
    label: 'Spin',
    hint: 'Turns forever (keyframes plus a loop that keeps climbing)',
    apply: (c) => {
      const span = Math.min(4, c.duration);
      const from = c.transform.rotation;
      c.keyframes['transform.rotation'] = [key(0, from, 'linear'), key(span, from + 360, 'linear')];
      const loop = defaultModifier('loop') as LoopModifier;
      loop.mode = 'offset';
      c.modifiers ??= {};
      c.modifiers['transform.rotation'] = [...(c.modifiers['transform.rotation'] ?? []).filter((x) => x.type !== 'loop'), loop];
    },
  },
];

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------

const TYPE_OPTIONS: SelectOption<Modifier['type']>[] = [
  { value: 'wiggle', label: 'Wiggle (random motion)' },
  { value: 'loop', label: 'Loop (repeat keyframes)' },
  { value: 'follow', label: 'Follow (link to a value)' },
];

const LOOP_OPTIONS: SelectOption<LoopModifier['mode']>[] = [
  { value: 'cycle', label: 'Repeat' },
  { value: 'pingpong', label: 'Ping-pong' },
  { value: 'offset', label: 'Keep climbing' },
];

function WiggleFields({ clip, path, m }: { clip: Clip; path: string; m: WiggleModifier }) {
  const info = paramInfo(path, clip);
  const set = (field: string, apply: (m: WiggleModifier) => void) => editModifier<WiggleModifier>(clip, path, m.id, field, apply);
  return (
    <>
      <ParamRow label="Amount" indent reserveKeyframe={false} hint="How far the value swings, in its own units">
        <ScrubNumber
          value={m.amp}
          min={0}
          step={Math.max(0.01, 1 / info.scale / 10)}
          dragStep={0.05 / info.scale}
          displayScale={info.scale}
          precision={info.decimals}
          unit={info.unit}
          aria-label="Wiggle amount"
          data-testid={`ins-wiggle-amp-${m.id}`}
          onChange={(v) => set('Wiggle amount', (x) => void (x.amp = v))}
        />
      </ParamRow>
      <ParamRow label="Speed" indent reserveKeyframe={false} hint="How often it changes direction, in cycles per second">
        <ScrubNumber value={m.freq} min={0.05} max={40} step={0.1} dragStep={0.02} precision={2} unit="Hz" defaultValue={2} aria-label="Wiggle speed" data-testid={`ins-wiggle-freq-${m.id}`} onChange={(v) => set('Wiggle speed', (x) => void (x.freq = v))} />
      </ParamRow>
      <ParamRow label="Detail" indent reserveKeyframe={false} hint="1 = smooth drift, higher adds finer, more organic movement">
        <ScrubNumber value={m.octaves} min={1} max={6} step={1} dragStep={0.05} precision={0} defaultValue={2} aria-label="Wiggle detail" data-testid={`ins-wiggle-oct-${m.id}`} onChange={(v) => set('Wiggle detail', (x) => void (x.octaves = Math.round(v)))} />
      </ParamRow>
      <ParamRow label="Seed" indent reserveKeyframe={false} hint="A different number gives a different, repeatable pattern">
        <ScrubNumber value={m.seed} min={0} max={9999} step={1} dragStep={0.1} precision={0} defaultValue={1} aria-label="Wiggle seed" data-testid={`ins-wiggle-seed-${m.id}`} onChange={(v) => set('Wiggle seed', (x) => void (x.seed = Math.round(v)))} />
      </ParamRow>
      <ParamRow label="Fade in" indent reserveKeyframe={false} hint="Seconds for the wiggle to build up from nothing">
        <ScrubNumber value={m.fadeIn} min={0} max={60} step={0.1} dragStep={0.02} precision={2} unit="s" defaultValue={0} aria-label="Wiggle fade in" data-testid={`ins-wiggle-fade-${m.id}`} onChange={(v) => set('Wiggle fade in', (x) => void (x.fadeIn = v))} />
      </ParamRow>
    </>
  );
}

function LoopFields({ clip, path, m }: { clip: Clip; path: string; m: LoopModifier }) {
  const keys = clip.keyframes[path]?.length ?? 0;
  return (
    <>
      <ParamRow label="Mode" indent reserveKeyframe={false}>
        <Select
          value={m.mode}
          options={LOOP_OPTIONS}
          aria-label="Loop mode"
          data-testid={`ins-loop-mode-${m.id}`}
          onChange={(v) => editModifier<LoopModifier>(clip, path, m.id, 'Loop mode', (x) => void (x.mode = v))}
        />
      </ParamRow>
      {keys < 2 && <p className="ins-note ins-note--warn">Add at least two keyframes to {paramLabel(path, clip)} for the loop to repeat.</p>}
    </>
  );
}

function FollowFields({ clip, path, m }: { clip: Clip; path: string; m: FollowModifier }) {
  const info = paramInfo(path, clip);
  const options = motionTargets(clip).filter((o) => o.value !== path);
  const set = (field: string, apply: (m: FollowModifier) => void) => editModifier<FollowModifier>(clip, path, m.id, field, apply);
  return (
    <>
      <ParamRow label="Follow" indent reserveKeyframe={false} hint="The value this one is driven by">
        <Select value={m.source} options={options} placeholder="Choose…" aria-label="Follow source" data-testid={`ins-follow-source-${m.id}`} onChange={(v) => set('Follow source', (x) => void (x.source = v))} />
      </ParamRow>
      <ParamRow label="Strength" indent reserveKeyframe={false} hint="1 = copies the source, 0.5 = half as much, negative = opposite">
        <ScrubNumber value={m.scale} min={-100} max={100} step={0.1} dragStep={0.01} precision={2} defaultValue={1} aria-label="Follow strength" data-testid={`ins-follow-scale-${m.id}`} onChange={(v) => set('Follow strength', (x) => void (x.scale = v))} />
      </ParamRow>
      <ParamRow label="Offset" indent reserveKeyframe={false}>
        <ScrubNumber
          value={m.offset}
          step={Math.max(0.01, 1 / info.scale / 10)}
          dragStep={0.05 / info.scale}
          displayScale={info.scale}
          precision={info.decimals}
          unit={info.unit}
          defaultValue={0}
          aria-label="Follow offset"
          data-testid={`ins-follow-offset-${m.id}`}
          onChange={(v) => set('Follow offset', (x) => void (x.offset = v))}
        />
      </ParamRow>
      <ParamRow label="Delay" indent reserveKeyframe={false} hint="Seconds this value lags behind its source (a trailing effect)">
        <ScrubNumber value={m.delay} min={0} max={60} step={0.05} dragStep={0.01} precision={2} unit="s" defaultValue={0} aria-label="Follow delay" data-testid={`ins-follow-delay-${m.id}`} onChange={(v) => set('Follow delay', (x) => void (x.delay = v))} />
      </ParamRow>
    </>
  );
}

function ModifierCard({ clip, path, m }: { clip: Clip; path: string; m: Modifier }) {
  const title = m.type === 'wiggle' ? 'Wiggle' : m.type === 'loop' ? 'Loop' : 'Follow';
  return (
    <div className="ins-mod" data-testid={`ins-mod-${m.id}`}>
      <div className="ins-mod__head">
        <Toggle checked={m.enabled} aria-label={`${title} on or off`} data-testid={`ins-mod-on-${m.id}`} onChange={(on) => editModifier<Modifier>(clip, path, m.id, `${title} ${on ? 'on' : 'off'}`, (x) => void (x.enabled = on))} />
        <span className="ins-mod__title">
          {title} <span className="ins-dim">{paramLabel(path, clip)}</span>
        </span>
        <Btn title="Remove this modifier" data-testid={`ins-mod-del-${m.id}`} onClick={() => removeModifier(clip, path, m.id)}>
          Remove
        </Btn>
      </div>
      {m.type === 'wiggle' && <WiggleFields clip={clip} path={path} m={m} />}
      {m.type === 'loop' && <LoopFields clip={clip} path={path} m={m} />}
      {m.type === 'follow' && <FollowFields clip={clip} path={path} m={m} />}
    </div>
  );
}

export function MotionSection({ clip }: { clip: Clip }) {
  const targets = motionTargets(clip);
  const [path, setPath] = useState('transform.x');
  const [type, setType] = useState<Modifier['type']>('wiggle');
  const entries = Object.entries(clip.modifiers ?? {}).filter(([, list]) => list.length);
  const count = entries.reduce((n, [, list]) => n + list.length, 0);
  const target = targets.some((t) => t.value === path) ? path : 'transform.x';

  return (
    <Section id="motion" title="Motion" data-testid="ins-sec-motion" badge={count ? String(count) : undefined}>
      <div className="ins-presets" role="group" aria-label="Motion presets">
        {MOTION_PRESETS.map((p) => (
          <Btn key={p.id} title={p.hint} data-testid={`ins-motion-${p.id}`} onClick={() => editClip(clip.id, `Motion: ${p.label}`, p.apply)}>
            {p.label}
          </Btn>
        ))}
      </div>
      {entries.map(([p, list]) => list.map((m) => <ModifierCard key={m.id} clip={clip} path={p} m={m} />))}
      <ParamRow label="Add" reserveKeyframe={false}>
        <Select value={type} options={TYPE_OPTIONS} aria-label="Modifier type" data-testid="ins-motion-type" onChange={setType} />
      </ParamRow>
      <ParamRow label="To" reserveKeyframe={false}>
        <Select value={target} options={targets} aria-label="Modifier target" data-testid="ins-motion-target" onChange={setPath} />
        <Btn primary data-testid="ins-motion-add" onClick={() => addModifier(clip, target, type)}>
          Add
        </Btn>
      </ParamRow>
    </Section>
  );
}
