// Mix plan: a pure description of how a sequence sounds. For every audible
// clip it resolves the sounding region on the timeline (including crossfade
// handles), the source-time mapping (speed, reverse, ramps), fades and
// crossfade envelopes, clip gain/pan automation, and the bus state of each
// track (volume, pan, mute/solo). The realtime graph and the offline mixdown
// are both built from this, so playback and export can never disagree.

import type { Clip, Ease, Project, Sequence, Track } from '../../state/types';
import { sequenceDuration } from '../../state/types';
import { applyEase, paramAt } from '../keyframes';
import { sourceTimeAt, speedAt } from '../time';
import { clamp, dbToGain, fadeInGain, fadeOutGain, type FadeCurve } from './dsp';

export interface Fade {
  /** Timeline seconds. */
  a: number;
  b: number;
  dir: 'in' | 'out';
  curve: FadeCurve;
  ease: Ease;
}

export interface TrackPlan {
  id: string;
  name: string;
  /** Not muted, and soloed when any audio track is soloed. */
  audible: boolean;
  muted: boolean;
  solo: boolean;
  volumeDb: number;
  pan: number;
}

export type SourceRef = { kind: 'asset'; id: string; duration: number } | { kind: 'sequence'; id: string; duration: number };

export interface ClipPlan {
  id: string;
  trackId: string;
  clip: Clip;
  source: SourceRef;
  /** Clip edges on the timeline. */
  start: number;
  end: number;
  /** Sounding region (extends past the edges into crossfade handles). */
  t0: number;
  t1: number;
  fades: Fade[];
  reverse: boolean;
  /** Speed keyframes ('time.speed') drive playbackRate automation. */
  ramp: boolean;
  speed: number;
  /** Source seconds needed (sorted). */
  src0: number;
  src1: number;
  /** Changes when anything that needs a node rebuild changes; gain/pan/EQ/comp values are live. */
  sig: string;
}

export interface MixPlan {
  sequenceId: string;
  sampleRate: number;
  tracks: TrackPlan[];
  /** Sorted by t0. */
  clips: ClipPlan[];
  master: Sequence['master'];
  anySolo: boolean;
  /** Last sounding time. */
  end: number;
}

const ADJ = 1e-3; // clips closer than this are adjacent (as in render/graph.ts)

export function fadeCurveOf(clip: Clip): FadeCurve {
  return clip.audio.fadeCurve === 'equalPower' ? 'equalPower' : 'linear';
}

/** Which audio tracks are audible given mute and solo. */
export function trackPlans(seq: Sequence): TrackPlan[] {
  const audio = seq.tracks.filter((t) => t.kind === 'audio');
  const anySolo = audio.some((t) => t.solo);
  return audio.map((t) => ({
    id: t.id,
    name: t.name,
    muted: t.muted,
    solo: t.solo,
    audible: !t.muted && (!anySolo || t.solo),
    volumeDb: typeof t.volume === 'number' ? t.volume : 0,
    pan: typeof t.pan === 'number' ? clamp(t.pan, -1, 1) : 0,
  }));
}

function sourceOf(project: Project, seq: Sequence, clip: Clip): SourceRef | null {
  if (clip.kind === 'media') {
    const asset = project.assets.find((a) => a.id === clip.assetId);
    if (!asset || asset.offline || !asset.hasAudio) return null;
    return { kind: 'asset', id: asset.id, duration: asset.duration };
  }
  if (clip.kind === 'sequence') {
    const nested = project.sequences.find((s) => s.id === clip.sequenceId);
    if (!nested || nested.id === seq.id) return null;
    return { kind: 'sequence', id: nested.id, duration: sequenceDuration(nested) };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Per-clip functions of timeline time
// ---------------------------------------------------------------------------

/** Source seconds heard at timeline time t; extrapolates past the clip edges (handles). */
export function sourceAt(cp: ClipPlan, t: number): number {
  const c = cp.clip;
  const local = t - c.start;
  if (!cp.ramp) return c.reverse ? c.inPoint + c.duration * c.speed - local * c.speed : c.inPoint + local * c.speed;
  const lc = clamp(local, 0, c.duration);
  const s = sourceTimeAt(c, lc);
  return s + (local - lc) * (c.reverse ? -1 : 1) * Math.max(0, speedAt(c, lc));
}

/** Playback rate at timeline time t (≥ 0). */
export function rateAt(cp: ClipPlan, t: number): number {
  if (!cp.ramp) return cp.speed;
  return Math.max(0, speedAt(cp.clip, clamp(t - cp.clip.start, 0, cp.clip.duration)));
}

export function gainDbAt(cp: ClipPlan, t: number): number {
  return paramAt(cp.clip, 'audio.gain', clamp(t - cp.clip.start, 0, cp.clip.duration));
}

export function panAt(cp: ClipPlan, t: number): number {
  return clamp(paramAt(cp.clip, 'audio.pan', clamp(t - cp.clip.start, 0, cp.clip.duration)), -1, 1);
}

function fadeValue(f: Fade, t: number): number {
  const span = f.b - f.a;
  if (span <= 0) return 1;
  if (t <= f.a) return f.dir === 'in' ? 0 : 1;
  if (t >= f.b) return f.dir === 'in' ? 1 : 0;
  const p = applyEase(f.ease, (t - f.a) / span);
  return f.dir === 'in' ? fadeInGain(p, f.curve) : fadeOutGain(p, f.curve);
}

/** Fades × crossfades at timeline time t (0 outside the sounding region). */
export function envAt(cp: ClipPlan, t: number): number {
  if (t < cp.t0 || t > cp.t1) return 0;
  let g = 1;
  for (const f of cp.fades) g *= fadeValue(f, t);
  return g;
}

/** Linear clip gain (keyframed dB → amplitude). */
export function gainAt(cp: ClipPlan, t: number): number {
  return dbToGain(gainDbAt(cp, t));
}

/** Times where automation may change character (keyframes, fade edges). */
export function knots(cp: ClipPlan, paths: string[]): number[] {
  const out = [cp.t0, cp.t1, cp.start, cp.end];
  for (const f of cp.fades) out.push(f.a, f.b);
  for (const p of paths) for (const k of cp.clip.keyframes[p] ?? []) out.push(cp.clip.start + k.t);
  return out;
}

/** Timeline seconds of source available before the clip head / after its tail. */
export function handles(cp: ClipPlan): { head: number; tail: number } {
  const dur = cp.source.duration;
  const r0 = rateAt(cp, cp.start);
  const r1 = rateAt(cp, cp.end);
  const sh = sourceAt(cp, cp.start);
  const st = sourceAt(cp, cp.end);
  const head = r0 > 0 ? (cp.reverse ? dur - sh : sh) / r0 : 0;
  const tail = r1 > 0 ? (cp.reverse ? st : dur - st) / r1 : 0;
  return { head: Math.max(0, head), tail: Math.max(0, tail) };
}

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------

function baseClipPlan(project: Project, seq: Sequence, track: Track, clip: Clip): ClipPlan | null {
  if (!clip.enabled || clip.audio.mute) return null;
  if (clip.holdFrame !== null && clip.holdFrame !== undefined) return null; // freeze frames are silent
  if (!(clip.duration > 0)) return null;
  const source = sourceOf(project, seq, clip);
  if (!source) return null;
  const ramp = !!clip.keyframes['time.speed']?.length;
  const speed = Math.max(0, Number.isFinite(clip.speed) ? clip.speed : 1);
  if (!ramp && speed <= 0) return null;
  const start = clip.start;
  const end = clip.start + clip.duration;
  const cp: ClipPlan = {
    id: clip.id,
    trackId: track.id,
    clip,
    source,
    start,
    end,
    t0: start,
    t1: end,
    fades: [],
    reverse: clip.reverse,
    ramp,
    speed,
    src0: 0,
    src1: 0,
    sig: '',
  };
  const curve = fadeCurveOf(clip);
  const fi = Math.min(Math.max(0, clip.audio.fadeIn || 0), clip.duration);
  const fo = Math.min(Math.max(0, clip.audio.fadeOut || 0), clip.duration);
  if (fi > 0) cp.fades.push({ a: start, b: start + fi, dir: 'in', curve, ease: 'linear' });
  if (fo > 0) cp.fades.push({ a: end - fo, b: end, dir: 'out', curve, ease: 'linear' });
  return cp;
}

function transitionCurve(params: Record<string, number> | undefined): FadeCurve {
  // params.curve: 0 = constant power (default), 1 = constant gain
  return params?.curve === 1 ? 'linear' : 'equalPower';
}

/** Splits a crossfade of `d` seconds around a cut, given the source handles on each side. */
export function crossfadeSplit(d: number, headIn: number, tailOut: number): { pre: number; post: number } {
  const half = d / 2;
  let pre = Math.min(half, headIn);
  let post = Math.min(half, tailOut);
  let rem = d - pre - post;
  if (rem > 1e-9) {
    const ex = Math.min(Math.max(0, tailOut - post), rem);
    post += ex;
    rem -= ex;
  }
  if (rem > 1e-9) {
    const ex = Math.min(Math.max(0, headIn - pre), rem);
    pre += ex;
  }
  return { pre, post };
}

function planTrack(project: Project, seq: Sequence, track: Track): ClipPlan[] {
  const clips = track.clips.filter((c) => c.enabled).sort((a, b) => a.start - b.start);
  const plans = clips.map((c) => baseClipPlan(project, seq, track, c));
  for (let i = 0; i < clips.length; i++) {
    const clip = clips[i];
    const cp = plans[i];
    const prevClip = i > 0 ? clips[i - 1] : null;
    const prevAdj = prevClip && Math.abs(prevClip.start + prevClip.duration - clip.start) < ADJ ? prevClip : null;
    const prev = prevAdj ? plans[i - 1] : null;
    const nextClip = i < clips.length - 1 ? clips[i + 1] : null;
    const followed = !!nextClip && Math.abs(clip.start + clip.duration - nextClip.start) < ADJ;

    const tin = clip.transitionIn;
    if (tin && tin.duration > 0) {
      const d = tin.duration;
      const curve = transitionCurve(tin.params);
      const ease: Ease = tin.ease ?? 'linear';
      if (prevAdj) {
        // Crossfade centered on the cut, shifted when a side lacks source handles.
        const cut = clip.start;
        const headIn = cp ? handles(cp).head : Infinity;
        const tailOut = prev ? handles(prev).tail : Infinity;
        const { pre, post } = crossfadeSplit(d, headIn, tailOut);
        if (pre + post > 1e-4) {
          const a = cut - pre;
          const b = cut + post;
          if (cp) {
            cp.fades.push({ a, b, dir: 'in', curve, ease });
            cp.t0 = Math.min(cp.t0, a);
          }
          if (prev) {
            prev.fades.push({ a, b, dir: 'out', curve, ease });
            prev.t1 = Math.max(prev.t1, b);
          }
        } else {
          // No media on either side: fade out to the cut, then fade in from it.
          if (prev) prev.fades.push({ a: cut - d / 2, b: cut, dir: 'out', curve, ease });
          if (cp) cp.fades.push({ a: cut, b: cut + d / 2, dir: 'in', curve, ease });
        }
      } else if (cp) {
        // Fade in from nothing, centered on the head when the source has handles.
        const pre = Math.max(0, Math.min(d / 2, handles(cp).head, cp.start));
        const a = cp.start - pre;
        cp.fades.push({ a, b: a + d, dir: 'in', curve, ease });
        cp.t0 = Math.min(cp.t0, a);
      }
    }
    const tout = clip.transitionOut;
    if (cp && tout && tout.duration > 0 && !followed) {
      const d = tout.duration;
      const post = Math.min(d / 2, handles(cp).tail);
      const b = cp.end + post;
      cp.fades.push({ a: b - d, b, dir: 'out', curve: transitionCurve(tout.params), ease: tout.ease ?? 'linear' });
      cp.t1 = Math.max(cp.t1, b);
    }
  }
  const out: ClipPlan[] = [];
  for (const cp of plans) {
    if (!cp) continue;
    const a = sourceAt(cp, cp.t0);
    const b = sourceAt(cp, cp.t1);
    cp.src0 = clamp(Math.min(a, b), 0, cp.source.duration || Infinity);
    cp.src1 = clamp(Math.max(a, b), 0, cp.source.duration || Infinity);
    cp.sig = signature(cp);
    out.push(cp);
  }
  return out;
}

function signature(cp: ClipPlan): string {
  const c = cp.clip;
  const kf = (p: string) => c.keyframes[p] ?? null;
  return JSON.stringify([
    cp.source.kind,
    cp.source.id,
    c.start,
    c.duration,
    c.inPoint,
    c.speed,
    c.reverse,
    kf('time.speed'),
    kf('audio.gain'),
    kf('audio.pan'),
    c.audio.channelMode,
    c.audio.fadeCurve ?? 'linear',
    c.audio.eq.enabled,
    c.audio.comp.enabled,
    cp.t0,
    cp.t1,
    cp.fades,
  ]);
}

export function planMix(project: Project, seq: Sequence): MixPlan {
  const tracks = trackPlans(seq);
  const clips: ClipPlan[] = [];
  for (const track of seq.tracks) if (track.kind === 'audio') clips.push(...planTrack(project, seq, track));
  clips.sort((a, b) => a.t0 - b.t0);
  let end = 0;
  for (const c of clips) end = Math.max(end, c.t1);
  return {
    sequenceId: seq.id,
    sampleRate: seq.sampleRate || project.settings.sampleRate || 48000,
    tracks,
    clips,
    master: seq.master,
    anySolo: tracks.some((t) => t.solo),
    end,
  };
}

/** Clips sounding anywhere in [a, b). */
export function clipsInRange(plan: MixPlan, a: number, b: number, audibleOnly = true): ClipPlan[] {
  const audible = new Set(plan.tracks.filter((t) => t.audible).map((t) => t.id));
  return plan.clips.filter((c) => c.t1 > a && c.t0 < b && (!audibleOnly || audible.has(c.trackId)));
}

// ---------------------------------------------------------------------------
// Automation
// ---------------------------------------------------------------------------

/**
 * Approximates fn over [a, b] with breakpoints for AudioParam automation:
 * flat or linear segments between knots become two points, curved ones are
 * sampled every `step` seconds, and jumps at knots become duplicate times
 * (applied with setValueAtTime). Returns [t0, v0, t1, v1, ...].
 */
export function automation(fn: (t: number) => number, a: number, b: number, knotTimes: number[], step = 0.01): number[] {
  const ks = [a, ...knotTimes.filter((k) => k > a + 1e-9 && k < b - 1e-9), b].sort((x, y) => x - y).filter((k, i, arr) => i === 0 || k - arr[i - 1] > 1e-9);
  const pts: number[] = [];
  const push = (t: number, v: number) => {
    const n = pts.length;
    if (n >= 2 && pts[n - 2] === t && pts[n - 1] === v) return;
    pts.push(t, v);
  };
  const D = 1e-7;
  const jumpAt = (k: number): [number, number] | null => {
    const vL = fn(k - D);
    const vR = fn(k + D);
    return Math.abs(vL - vR) > 1e-5 ? [vL, vR] : null;
  };
  let v0 = fn(ks[0]);
  push(ks[0], v0);
  for (let i = 0; i < ks.length - 1; i++) {
    const k0 = ks[i];
    const k1 = ks[i + 1];
    const last = i === ks.length - 2;
    const jump = last ? null : jumpAt(k1);
    const v1 = jump ? jump[0] : fn(k1);
    const span = k1 - k0;
    if (span > 1e-9) {
      // linear (incl. flat) when quarter points sit on the chord
      let linear = true;
      for (const q of [0.25, 0.5, 0.75]) {
        const v = fn(k0 + span * q);
        if (Math.abs(v - (v0 + (v1 - v0) * q)) > 1e-4 * Math.max(1, Math.abs(v))) {
          linear = false;
          break;
        }
      }
      if (!linear) {
        const n = Math.max(2, Math.ceil(span / step));
        for (let j = 1; j < n; j++) push(k0 + (span * j) / n, fn(k0 + (span * j) / n));
      }
    }
    push(k1, v1);
    if (jump) {
      push(k1, jump[1]);
      v0 = jump[1];
    } else v0 = v1;
  }
  return pts;
}
