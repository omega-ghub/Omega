// Auto-ducking core (pure): detect dialogue from an RMS envelope, then build
// 'audio.gain' keyframes that dip music clips under it. computeDucking
// (analysis.ts) feeds it envelopes measured from the decoded dialogue audio.

import type { Clip, Keyframe } from '../../state/types';
import { evaluate } from '../keyframes';

export interface DuckingOptions {
  dialogueTrackIds: string[];
  musicTrackIds: string[];
  /** How far the music dips, dB (positive number = reduction). */
  reductionDb: number;
  /** Dialogue RMS above this (dBFS) counts as speech. */
  thresholdDb: number;
  /** Seconds the music takes to dip before speech starts. */
  attack: number;
  /** Seconds the music takes to recover after speech ends. */
  release: number;
  /** Pauses shorter than this stay ducked (s). Default 0.35. */
  hold?: number;
  /** Speech bursts shorter than this are ignored (s). Default 0.08. */
  minDuration?: number;
}

export interface DuckResult {
  clipId: string;
  trackId: string;
  keyframes: Keyframe[];
}

/** Speech regions [start, end] (seconds) from an envelope sampled every `hop` s starting at `origin`. */
export function detectRegions(envDb: ArrayLike<number>, hop: number, origin: number, thresholdDb: number, hold = 0.35, minDuration = 0.08): [number, number][] {
  const raw: [number, number][] = [];
  let open = -1;
  for (let i = 0; i <= envDb.length; i++) {
    const on = i < envDb.length && envDb[i] > thresholdDb;
    if (on && open < 0) open = i;
    else if (!on && open >= 0) {
      raw.push([origin + open * hop, origin + i * hop]);
      open = -1;
    }
  }
  // bridge short pauses, then drop blips
  const merged: [number, number][] = [];
  for (const r of raw) {
    const last = merged[merged.length - 1];
    if (last && r[0] - last[1] < hold) last[1] = r[1];
    else merged.push([r[0], r[1]]);
  }
  return merged.filter(([a, b]) => b - a >= minDuration);
}

/** Merges regions whose release and next attack would overlap (no pumping between phrases). */
export function mergeForRamps(regions: [number, number][], attack: number, release: number): [number, number][] {
  const out: [number, number][] = [];
  for (const r of regions) {
    const last = out[out.length - 1];
    if (last && r[0] - last[1] <= attack + release) last[1] = Math.max(last[1], r[1]);
    else out.push([r[0], r[1]]);
  }
  return out;
}

/** 0..1 amount of ducking at time t (linear ramps of `attack` before and `release` after each region). */
export function duckAmount(regions: [number, number][], t: number, attack: number, release: number): number {
  let d = 0;
  for (const [a, b] of regions) {
    let v = 0;
    if (t >= a && t <= b) v = 1;
    else if (t < a && t >= a - attack) v = attack > 0 ? 1 - (a - t) / attack : 1;
    else if (t > b && t <= b + release) v = release > 0 ? 1 - (t - b) / release : 1;
    if (v > d) d = v;
    if (d >= 1) break;
  }
  return d;
}

/**
 * New 'audio.gain' keyframes for a music clip: its current gain (static or
 * keyframed) minus `reductionDb` × duck amount. Null when no region touches it.
 */
export function duckKeyframes(clip: Clip, regions: [number, number][], reductionDb: number, attack: number, release: number): Keyframe[] | null {
  const cs = clip.start;
  const ce = clip.start + clip.duration;
  const touching = regions.filter(([a, b]) => b + release > cs && a - attack < ce);
  if (!touching.length || !(reductionDb > 0)) return null;
  const existing = clip.keyframes['audio.gain'];
  const base = (local: number) => (existing?.length ? evaluate(existing, local) : clip.audio.gain);
  const times = new Set<number>();
  const addT = (t: number) => {
    const l = t - cs;
    if (l >= -1e-9 && l <= clip.duration + 1e-9) times.add(Math.min(clip.duration, Math.max(0, l)));
  };
  for (const [a, b] of touching) {
    addT(a - attack);
    addT(a);
    addT(b);
    addT(b + release);
  }
  for (const k of existing ?? []) times.add(k.t);
  // pin the clip edges when they fall inside a ramp or a ducked stretch
  if (duckAmount(touching, cs, attack, release) > 0) times.add(0);
  if (duckAmount(touching, ce, attack, release) > 0) times.add(clip.duration);
  const sorted = [...times].sort((x, y) => x - y);
  const out: Keyframe[] = [];
  for (const l of sorted) {
    if (out.length && l - out[out.length - 1].t < 1e-3) continue;
    const v = base(l) - reductionDb * duckAmount(touching, cs + l, attack, release);
    out.push({ t: l, v: Math.round(v * 100) / 100, ease: 'linear' });
  }
  return out;
}
