// Shared helpers for the interchange writers (EDL, OTIO, FCPXML).
// OWNED BY THE CAPTIONS/INTERCHANGE PACKAGE.

import type { Clip, MediaAsset, Project, Sequence, Track, TransitionType } from '../../state/types';
import { exactRate, formatTimecode, fromFrames, sourceSpan, sourceTimeAt, toFrames } from '../time';

/** Exact frame duration as a rational (seconds = num / den). */
export function frameRational(fps: number): { num: number; den: number } {
  const r = exactRate(fps);
  const nominal = Math.round(r);
  if (Math.abs(r - (nominal * 1000) / 1001) < 1e-9 && Math.abs(r - nominal) > 1e-6) return { num: 1001, den: nominal * 1000 };
  const x100 = Math.round(r * 100);
  if (Math.abs(r * 100 - x100) < 1e-6) return { num: 100, den: x100 };
  return { num: 1000, den: Math.round(r * 1000) };
}

function gcd(a: number, b: number): number {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b) [a, b] = [b, a % b];
  return a || 1;
}

/** Rational seconds string for a whole number of frames: '1001/24000s', '5s', '0s'. */
export function rationalTime(frames: number, fps: number): string {
  if (frames === 0) return '0s';
  const { num, den } = frameRational(fps);
  const n = frames * num;
  const g = gcd(n, den);
  const rn = n / g;
  const rd = den / g;
  return rd === 1 ? `${rn}s` : `${rn}/${rd}s`;
}

/** Parses an FCPXML rational time ('1001/24000s', '5s', '2.5s') to seconds. */
export function parseRationalTime(s: string): number | null {
  const m = /^(-?\d+(?:\.\d+)?)(?:\/(\d+))?s$/.exec(s.trim());
  if (!m) return null;
  return m[2] ? Number(m[1]) / Number(m[2]) : Number(m[1]);
}

export function nominalRate(fps: number): number {
  return Math.round(exactRate(fps));
}

/** True when the sequence uses drop-frame timecode (only meaningful at 29.97 / 59.94). */
export function isDropFrame(seq: Sequence): boolean {
  const n = nominalRate(seq.fps);
  return !!seq.dropFrame && (n === 30 || n === 60) && Math.abs(exactRate(seq.fps) - n) > 1e-6;
}

/** Timecode string for an absolute frame count at the sequence rate. */
export function tcOfFrames(frames: number, fps: number, dropFrame: boolean): string {
  return formatTimecode(fromFrames(Math.max(0, frames), fps), fps, dropFrame);
}

export function startFrames(seq: Sequence): number {
  return Math.max(0, toFrames(seq.startTimecode || 0, seq.fps));
}

/** file:// URL for an absolute path (POSIX or Windows), percent-encoded per segment. */
export function fileUrl(path: string): string {
  let p = path.replace(/\\/g, '/');
  if (/^[a-zA-Z]:\//.test(p)) p = '/' + p;
  else if (p.startsWith('//')) {
    // UNC path: file://server/share/…
    return 'file:' + p.split('/').map((seg, i) => (i < 2 ? seg : encodeURIComponent(seg))).join('/');
  }
  return (
    'file://' +
    p
      .split('/')
      .map((seg, i) => (i === 1 && /^[a-zA-Z]:$/.test(seg) ? seg : encodeURIComponent(seg)))
      .join('/')
  );
}

/** Inverse of fileUrl (also accepts plain paths). */
export function pathFromUrl(url: string): string {
  if (!/^file:/i.test(url)) return url;
  let rest = url.replace(/^file:(\/\/localhost)?/i, '');
  if (rest.startsWith('//')) {
    // file://server/share → UNC
    return decodeURIComponent(rest).replace(/\//g, '\\');
  }
  rest = decodeURIComponent(rest);
  if (/^\/[a-zA-Z]:\//.test(rest)) return rest.slice(1);
  return rest;
}

export function xmlEscape(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/\n/g, '&#10;')
    .replace(/\r/g, '&#13;')
    .replace(/\t/g, '&#9;')
    // XML 1.0 forbids most control characters
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
}

export function baseName(path: string): string {
  const b = path.split(/[\\/]/).pop() ?? path;
  return b;
}

export function stripExt(name: string): string {
  return name.replace(/\.[^.]+$/, '');
}

/** Clips of a track sorted by start. */
export function sortedClips(track: Track): Clip[] {
  return [...track.clips].sort((a, b) => a.start - b.start);
}

export function videoTracks(seq: Sequence): Track[] {
  return seq.tracks.filter((t) => t.kind === 'video');
}

export function audioTracks(seq: Sequence): Track[] {
  return seq.tracks.filter((t) => t.kind === 'audio');
}

export function assetById(project: Project, id: string | undefined): MediaAsset | undefined {
  return id ? project.assets.find((a) => a.id === id) : undefined;
}

export const DISSOLVE_TYPES: ReadonlySet<TransitionType> = new Set<TransitionType>(['crossDissolve', 'filmDissolve', 'additiveDissolve', 'blurDissolve', 'audioCrossfade']);

export const TRANSITION_LABELS: Record<TransitionType, string> = {
  crossDissolve: 'Cross Dissolve',
  filmDissolve: 'Film Dissolve',
  additiveDissolve: 'Additive Dissolve',
  dipToBlack: 'Dip to Black',
  dipToWhite: 'Dip to White',
  wipe: 'Wipe',
  slide: 'Slide',
  push: 'Push',
  zoom: 'Zoom',
  blurDissolve: 'Blur Dissolve',
  iris: 'Iris',
  clockWipe: 'Clock Wipe',
  whip: 'Whip Pan',
  glitch: 'Glitch',
  lightLeak: 'Light Leak',
  audioCrossfade: 'Audio Crossfade',
};

/** Whether the clip's speed is keyframed (a ramp). */
export function hasSpeedRamp(clip: Clip): boolean {
  const k = clip.keyframes?.['time.speed'];
  return !!k && k.length > 0;
}

/** Effective constant speed (average for ramps, 0 for freeze frames). */
export function effectiveSpeed(clip: Clip): number {
  if (clip.holdFrame !== null && clip.holdFrame !== undefined) return 0;
  if (hasSpeedRamp(clip)) return clip.duration > 0 ? sourceSpan(clip) / clip.duration : 1;
  return clip.speed;
}

/**
 * Source seconds shown at timeline time t, extrapolated linearly beyond the
 * clip's edges (transition handles), matching the frame graph.
 */
export function sourceSecondsAt(clip: Clip, t: number): number {
  if (clip.holdFrame !== null && clip.holdFrame !== undefined) return clip.holdFrame;
  const local = t - clip.start;
  const l = Math.max(0, Math.min(local, clip.duration));
  const speed = hasSpeedRamp(clip) ? effectiveSpeed(clip) : clip.speed;
  return sourceTimeAt(clip, l) + (local - l) * (clip.reverse ? -speed : speed);
}

export function clipFrames(clip: Clip, fps: number): { s: number; e: number } {
  const s = toFrames(clip.start, fps);
  return { s, e: Math.max(s, toFrames(clip.start + clip.duration, fps)) };
}

/** Same exact frame rate (nested sequences can only be flattened frame-for-frame when equal). */
export function sameRate(a: number, b: number): boolean {
  return Math.abs(exactRate(a) - exactRate(b)) < 1e-6;
}
