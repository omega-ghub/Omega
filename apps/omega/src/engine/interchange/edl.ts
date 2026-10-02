// CMX 3600 EDL writer. OWNED BY THE CAPTIONS/INTERCHANGE PACKAGE.
//
//   TITLE: Sequence 1
//   FCM: NON-DROP FRAME
//
//   001  A001C003 V     C        00:00:01:00 00:00:06:00 01:00:00:00 01:00:05:00
//   * FROM CLIP NAME: A001C003_220101.mov
//   * SOURCE FILE: /media/A001C003_220101.mov
//
// Video: CMX 3600 has one picture channel, so the sequence's video tracks are
// flattened top-down: wherever several clips overlap, the topmost opaque one
// (media, nested sequence, solid, gradient) becomes the V event. Text, shapes
// and adjustment layers are overlays and do not cut the picture underneath.
// Nested sequences at the same frame rate and normal speed are expanded into
// their source events; others become AX events.
// Audio: A1 → 'A', A2 → 'A2', a matching pair on A1+A2 → 'AA', A3/A4 →
// 'NONE' + an 'AUD' line. Further audio tracks are not representable.
// Transitions: centered on the cut like the frame graph; every transition is
// written as a dissolve 'D' (the effect name goes in a comment), dissolves
// from/to nothing use BL (black). Speed changes add M2 lines.

import type { Clip, Project, Sequence, Track, Transition } from '../../state/types';
import { fromFrames, toFrames } from '../time';
import {
  assetById,
  audioTracks,
  baseName,
  clipFrames,
  effectiveSpeed,
  hasSpeedRamp,
  isDropFrame,
  nominalRate,
  sameRate,
  sortedClips,
  sourceSecondsAt,
  startFrames,
  stripExt,
  tcOfFrames,
  TRANSITION_LABELS,
  videoTracks,
} from './common';

export interface EdlOptions {
  /** Export only this video track instead of the flattened stack (one EDL per track workflows). */
  videoTrackId?: string;
  /** Include audio events (default true). */
  audio?: boolean;
  /** Line ending (default '\n'). */
  eol?: '\n' | '\r\n';
}

/** One continuous piece of picture or sound on the record side. */
interface Seg {
  recIn: number; // record frames from sequence start (no start timecode)
  recOut: number;
  /** null = black (BL) */
  clip: Clip | null;
  track: Track | null;
  /** Container time (seconds) = fromFrames(rec - offset). Nested clips have offset ≠ 0. */
  offset: number;
  trans?: { dur: number; from: Seg | 'BL'; fromRec: number; label: string };
}

const OPAQUE = new Set<Clip['kind']>(['media', 'sequence', 'solid', 'gradient']);
const MAX_DEPTH = 8;

function canFlatten(clip: Clip, nested: Sequence | undefined, parent: Sequence, depth: number): nested is Sequence {
  return (
    !!nested &&
    nested.id !== parent.id &&
    depth < MAX_DEPTH &&
    sameRate(nested.fps, parent.fps) &&
    clip.speed === 1 &&
    !clip.reverse &&
    (clip.holdFrame === null || clip.holdFrame === undefined) &&
    !hasSpeedRamp(clip)
  );
}

/**
 * Topmost-visible picture segments of `seq` between container frames [from, to),
 * shifted by `offset` frames into record time.
 */
function flattenVideo(project: Project, seq: Sequence, from: number, to: number, offset: number, depth: number, out: Seg[], only?: Track): void {
  let free: [number, number][] = [[from, to]];
  const tracks = only ? [only] : videoTracks(seq).filter((t) => !t.muted);
  for (const track of tracks) {
    if (!free.length) break;
    for (const clip of sortedClips(track)) {
      if (!clip.enabled || !OPAQUE.has(clip.kind)) continue;
      if (clip.kind === 'media') {
        const a = assetById(project, clip.assetId);
        if (!a || !(a.hasVideo || a.kind === 'image')) continue;
      }
      const { s, e } = clipFrames(clip, seq.fps);
      if (e <= s) continue;
      const nextFree: [number, number][] = [];
      for (const [fa, fb] of free) {
        const a = Math.max(fa, s);
        const b = Math.min(fb, e);
        if (a >= b) {
          nextFree.push([fa, fb]);
          continue;
        }
        if (fa < a) nextFree.push([fa, a]);
        if (b < fb) nextFree.push([b, fb]);
        const nested = clip.kind === 'sequence' ? project.sequences.find((q) => q.id === clip.sequenceId) : undefined;
        if (clip.kind === 'sequence' && canFlatten(clip, nested, seq, depth)) {
          // container frame f ↔ nested frame f - s + inF
          const inF = toFrames(clip.inPoint, seq.fps);
          flattenVideo(project, nested, a - s + inF, b - s + inF, offset + s - inF, depth + 1, out);
        } else {
          out.push({ recIn: a + offset, recOut: b + offset, clip, track, offset });
        }
      }
      free = nextFree;
      if (!free.length) break;
    }
  }
}

function audioSegs(project: Project, track: Track, fps: number): Seg[] {
  const out: Seg[] = [];
  for (const clip of sortedClips(track)) {
    if (!clip.enabled) continue;
    if (clip.kind === 'media') {
      const a = assetById(project, clip.assetId);
      if (!a || !a.hasAudio) continue;
    } else if (clip.kind !== 'sequence') continue;
    const { s, e } = clipFrames(clip, fps);
    if (e <= s) continue;
    const prev = out[out.length - 1];
    const recIn = prev ? Math.max(s, prev.recOut) : s;
    if (e > recIn) out.push({ recIn, recOut: e, clip, track, offset: 0 });
  }
  return out;
}

/** Applies dissolves (centered on the cut) to a lane of sorted, non-overlapping segments. */
function applyTransitions(segs: Seg[], fps: number): Seg[] {
  const out: Seg[] = [];
  for (const seg0 of segs) {
    const seg = { ...seg0 };
    const clip = seg.clip;
    if (clip) {
      const { s, e } = clipFrames(clip, fps);
      const clipStart = s + seg.offset;
      const clipEnd = e + seg.offset;
      const tin = clip.transitionIn;
      const prev = out[out.length - 1];
      if (tin && tin.duration > 0 && seg.recIn === clipStart) {
        const d = toFrames(tin.duration, fps);
        const half = Math.floor(d / 2);
        // Source handles: the incoming clip can't start before source 0.
        const speed = Math.abs(effectiveSpeed(clip)) || 1;
        const headRoom = clip.reverse ? Infinity : Math.floor(toFrames(sourceSecondsAt(clip, clip.start), fps) / speed);
        const adjacent = prev && prev.clip && prev.track === seg.track && prev.recOut === seg.recIn && prev.offset === seg.offset && prevIsAdjacent(prev.clip, clip, fps);
        if (d >= 1 && adjacent) {
          const dStart = Math.max(prev.recIn, seg.recIn - Math.min(half, headRoom));
          const dEnd = Math.min(seg.recOut, dStart + d);
          if (dEnd > dStart && dStart < seg.recIn) {
            prev.recOut = dStart;
            seg.trans = { dur: dEnd - dStart, from: prev, fromRec: dStart, label: label(tin) };
            seg.recIn = dStart;
          } else if (dEnd > dStart) {
            seg.trans = { dur: dEnd - dStart, from: prev, fromRec: dStart, label: label(tin) };
          }
        } else if (d >= 1 && (!prev || prev.recOut < seg.recIn)) {
          const floor = prev ? prev.recOut : 0;
          const dStart = Math.max(floor, seg.recIn - Math.min(half, headRoom));
          const dEnd = Math.min(seg.recOut, dStart + d);
          if (dEnd > dStart) {
            seg.trans = { dur: dEnd - dStart, from: 'BL', fromRec: dStart, label: label(tin) };
            seg.recIn = dStart;
          }
        }
      }
      // Remove zero-length leftovers of the outgoing clip (kept as the 'from' line of the dissolve).
      if (prev && prev.recOut <= prev.recIn && !prev.trans) out.pop();
      out.push(seg);
      const tout = clip.transitionOut;
      if (tout && tout.duration > 0 && seg.recOut === clipEnd && !nextIsAdjacent(seg, segs, fps)) {
        const d = toFrames(tout.duration, fps);
        const half = Math.floor(d / 2);
        const nextSeg = segs[segs.indexOf(seg0) + 1];
        const dStart = Math.max(seg.recIn, seg.recOut - half);
        const dEnd = Math.min(dStart + d, nextSeg ? nextSeg.recIn : Infinity);
        if (d >= 1 && dEnd > dStart) {
          const blackFrom: Seg = { ...seg };
          seg.recOut = dStart;
          out.push({ recIn: dStart, recOut: dEnd, clip: null, track: seg.track, offset: seg.offset, trans: { dur: dEnd - dStart, from: blackFrom, fromRec: dStart, label: label(tout) } });
        }
      }
    } else out.push(seg);
  }
  return out.filter((s) => s.recOut > s.recIn || s.trans);
}

function label(t: Transition): string {
  return TRANSITION_LABELS[t.type] ?? t.type;
}

function prevIsAdjacent(prev: Clip, clip: Clip, fps: number): boolean {
  return clipFrames(prev, fps).e === clipFrames(clip, fps).s;
}

function nextIsAdjacent(seg: Seg, lane: Seg[], fps: number): boolean {
  const clip = seg.clip!;
  const end = clipFrames(clip, fps).e;
  const track = seg.track;
  if (!track) return false;
  return track.clips.some((c) => c !== clip && c.enabled && clipFrames(c, fps).s === end) || lane.some((s) => s.recIn === seg.recOut && s !== seg && s.clip !== null);
}

// ---------------------------------------------------------------------------
// Reels
// ---------------------------------------------------------------------------

class Reels {
  private byKey = new Map<string, string>();
  private used = new Set<string>(['BL', 'AX']);
  get(key: string, name: string): string {
    const have = this.byKey.get(key);
    if (have) return have;
    const base =
      stripExt(name)
        .toUpperCase()
        .replace(/[^A-Z0-9_]/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_|_$/g, '')
        .slice(0, 8) || 'AX';
    let reel = base;
    for (let n = 2; this.used.has(reel); n++) {
      const suffix = String(n);
      reel = base.slice(0, Math.max(1, 8 - suffix.length - 1)) + '_' + suffix;
    }
    this.used.add(reel);
    this.byKey.set(key, reel);
    return reel;
  }
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

interface SrcInfo {
  reel: string;
  name: string;
  file?: string;
  /** Source frame at a record frame. */
  srcAt: (rec: number) => number;
  speed: number; // 1 = normal; negative = reverse; 0 = freeze
  ramp: boolean;
  isAx: boolean;
}

function sourceInfo(project: Project, seg: Seg, seqFps: number, reels: Reels): SrcInfo {
  if (!seg.clip) return { reel: 'BL', name: 'BLACK', srcAt: () => 0, speed: 1, ramp: false, isAx: false };
  const clip = seg.clip;
  const asset = clip.kind === 'media' ? assetById(project, clip.assetId) : undefined;
  const containerT = (rec: number) => fromFrames(rec - seg.offset, seqFps);
  if (asset) {
    const reel = reels.get(asset.id, asset.name || baseName(asset.path));
    const speed = clip.reverse ? -effectiveSpeed(clip) : effectiveSpeed(clip);
    return {
      reel,
      name: clip.name && clip.name !== 'Clip' ? clip.name : asset.name,
      file: asset.path,
      srcAt: (rec) => Math.max(0, toFrames(sourceSecondsAt(clip, containerT(rec)), seqFps)),
      speed,
      ramp: hasSpeedRamp(clip),
      isAx: false,
    };
  }
  // Generated or non-flattenable nested clips: auxiliary source, timecode from the clip's own start.
  const nested = clip.kind === 'sequence' ? project.sequences.find((s) => s.id === clip.sequenceId) : undefined;
  const name = clip.kind === 'sequence' ? (nested?.name ?? clip.name) : clip.name;
  const speed = clip.kind === 'sequence' ? (clip.reverse ? -effectiveSpeed(clip) : effectiveSpeed(clip)) : 1;
  return {
    reel: 'AX',
    name,
    srcAt: (rec) =>
      clip.kind === 'sequence' ? Math.max(0, toFrames(sourceSecondsAt(clip, containerT(rec)), seqFps)) : Math.max(0, rec - (toFrames(clip.start, seqFps) + seg.offset)),
    speed,
    ramp: clip.kind === 'sequence' && hasSpeedRamp(clip),
    isAx: true,
  };
}

interface EventLine {
  reel: string;
  channel: string;
  trans: string; // 'C' | 'D'
  dur: number | null;
  srcIn: number;
  srcOut: number;
  recIn: number;
  recOut: number;
}

interface EdlEvent {
  recIn: number;
  order: number; // channel order for stable sorting
  lines: EventLine[];
  extra: string[]; // AUD / M2 lines, then comments
}

function m2Line(reel: string, speed: number, nominal: number, entryTc: string): string {
  const fpsVal = speed * nominal;
  const mag = Math.abs(fpsVal).toFixed(1).padStart(5, '0');
  const s = (fpsVal < 0 ? '-' : '') + mag;
  return `M2   ${reel.padEnd(8)} ${s.padStart(6)}${' '.repeat(16)}${entryTc}`;
}

function buildEvents(project: Project, seq: Sequence, lane: Seg[], channel: string, order: number, reels: Reels, audLine?: string): EdlEvent[] {
  const fps = seq.fps;
  const nominal = nominalRate(fps);
  const df = isDropFrame(seq);
  const st = startFrames(seq);
  const tc = (f: number) => tcOfFrames(f, fps, df);
  const events: EdlEvent[] = [];
  for (const seg of lane) {
    const info = sourceInfo(project, seg, fps, reels);
    const len = seg.recOut - seg.recIn;
    const { srcIn, srcOut } = srcRange(info, seg, len);
    const lines: EventLine[] = [];
    const extra: string[] = [];
    const comments: string[] = [];
    if (seg.trans) {
      const from = seg.trans.from;
      let fromReel = 'BL';
      let fromSrc = 0;
      let fromName = 'BLACK';
      let fromInfo: SrcInfo | null = null;
      if (from !== 'BL') {
        fromInfo = sourceInfo(project, from, fps, reels);
        fromReel = fromInfo.reel;
        fromSrc = fromInfo.srcAt(seg.trans.fromRec);
        fromName = fromInfo.name;
      }
      lines.push({ reel: fromReel, channel, trans: 'C', dur: null, srcIn: fromSrc, srcOut: fromSrc, recIn: seg.recIn + st, recOut: seg.recIn + st });
      lines.push({ reel: info.reel, channel, trans: 'D', dur: seg.trans.dur, srcIn, srcOut, recIn: seg.recIn + st, recOut: seg.recOut + st });
      if (fromInfo && fromInfo.speed !== 1) extra.push(m2Line(fromReel, fromInfo.speed, nominal, tc(fromSrc)));
      if (seg.clip && info.speed !== 1) extra.push(m2Line(info.reel, info.speed, nominal, tc(srcIn)));
      if (seg.trans.label !== 'Cross Dissolve' && seg.trans.label !== 'Audio Crossfade') comments.push(`* EFFECT NAME: ${seg.trans.label.toUpperCase()}`);
      comments.push(`* FROM CLIP NAME: ${fromName}`);
      if (seg.clip) comments.push(`* TO CLIP NAME: ${info.name}`);
      if (seg.clip && info.file) comments.push(`* SOURCE FILE: ${info.file}`);
      else if (!seg.clip && fromInfo?.file) comments.push(`* SOURCE FILE: ${fromInfo.file}`);
    } else {
      lines.push({ reel: info.reel, channel, trans: 'C', dur: null, srcIn, srcOut, recIn: seg.recIn + st, recOut: seg.recOut + st });
      if (info.speed !== 1) extra.push(m2Line(info.reel, info.speed, nominal, tc(srcIn)));
      comments.push(`* FROM CLIP NAME: ${info.name}`);
      if (info.file) comments.push(`* SOURCE FILE: ${info.file}`);
    }
    if (info.ramp) comments.push('* SPEED RAMP EXPORTED AS AVERAGE SPEED');
    if (audLine) extra.unshift(audLine);
    events.push({ recIn: seg.recIn, order, lines, extra: [...extra, ...comments] });
  }
  return events;
}

function srcRange(info: SrcInfo, seg: Seg, len: number): { srcIn: number; srcOut: number } {
  if (!seg.clip) return { srcIn: 0, srcOut: len };
  if (info.speed === 0) {
    const f = info.srcAt(seg.recIn);
    return { srcIn: f, srcOut: f + len };
  }
  if (info.speed === 1) {
    const a = info.srcAt(seg.recIn);
    return { srcIn: a, srcOut: a + len };
  }
  const a = info.srcAt(seg.recIn);
  const b = info.srcAt(seg.recOut);
  const lo = Math.min(a, b);
  const span = Math.max(1, Math.abs(b - a));
  return { srcIn: lo, srcOut: lo + span };
}

function formatLine(eventNo: number, l: EventLine, tc: (f: number) => string): string {
  const num = String(eventNo).padStart(3, '0');
  const dur = l.dur === null ? '   ' : String(Math.min(999, l.dur)).padStart(3, '0');
  return `${num}  ${l.reel.padEnd(8)} ${l.channel.padEnd(5)} ${l.trans.padEnd(4)} ${dur} ${tc(l.srcIn)} ${tc(l.srcOut)} ${tc(l.recIn)} ${tc(l.recOut)}`;
}

/** Merges matching A1 / A2 events (same source and timing) into 'AA' events. */
function pairAudio(a1: EdlEvent[], a2: EdlEvent[]): EdlEvent[] {
  const out: EdlEvent[] = [];
  const used = new Set<EdlEvent>();
  const key = (e: EdlEvent) => e.lines.map((l) => [l.reel, l.trans, l.dur, l.srcIn, l.srcOut, l.recIn, l.recOut].join('|')).join('#');
  const byKey = new Map<string, EdlEvent>();
  for (const e of a2) byKey.set(key(e), e);
  for (const e of a1) {
    const twin = byKey.get(key(e));
    if (twin && !used.has(twin)) {
      used.add(twin);
      out.push({ ...e, lines: e.lines.map((l) => ({ ...l, channel: 'AA' })) });
    } else out.push(e);
  }
  for (const e of a2) if (!used.has(e)) out.push(e);
  return out;
}

/** CMX 3600 EDL (one video track + up to 4 audio channels per event). */
export function exportEdl(project: Project, seq: Sequence, opts: EdlOptions = {}): string {
  const fps = seq.fps;
  const df = isDropFrame(seq);
  const eol = opts.eol ?? '\n';
  const reels = new Reels();
  const tc = (f: number) => tcOfFrames(f, fps, df);

  // Video
  const vSegs: Seg[] = [];
  const only = opts.videoTrackId ? seq.tracks.find((t) => t.id === opts.videoTrackId && t.kind === 'video') : undefined;
  const endF = Math.max(0, ...seq.tracks.flatMap((t) => t.clips.map((c) => clipFrames(c, fps).e)));
  flattenVideo(project, seq, 0, endF, 0, 0, vSegs, only);
  vSegs.sort((a, b) => a.recIn - b.recIn);
  // Merge pieces of the same clip that touch (split only by an overlay that was skipped).
  const vLane = applyTransitions(mergeTouching(vSegs), fps);
  let events = buildEvents(project, seq, vLane, 'V', 0, reels);

  // Audio
  if (opts.audio !== false) {
    const tracks = audioTracks(seq).filter((t) => !t.muted);
    const lanes = tracks.slice(0, 4).map((t) => applyTransitions(audioSegs(project, t, fps), fps));
    const a1 = lanes[0] ? buildEvents(project, seq, lanes[0], 'A', 1, reels) : [];
    const a2 = lanes[1] ? buildEvents(project, seq, lanes[1], 'A2', 2, reels) : [];
    events = events.concat(pairAudio(a1, a2));
    if (lanes[2]) events = events.concat(buildEvents(project, seq, lanes[2], 'NONE', 3, reels, 'AUD  3'));
    if (lanes[3]) events = events.concat(buildEvents(project, seq, lanes[3], 'NONE', 4, reels, 'AUD      4'));
  }

  events.sort((a, b) => a.recIn - b.recIn || a.order - b.order);
  const title = (seq.name || 'Untitled').replace(/[\r\n]+/g, ' ').slice(0, 70);
  const out: string[] = [`TITLE: ${title}`, `FCM: ${df ? 'DROP FRAME' : 'NON-DROP FRAME'}`, ''];
  events.forEach((ev, i) => {
    for (const l of ev.lines) out.push(formatLine(i + 1, l, tc));
    out.push(...ev.extra);
    out.push('');
  });
  return out.join(eol);
}

function mergeTouching(segs: Seg[]): Seg[] {
  const out: Seg[] = [];
  for (const s of segs) {
    const prev = out[out.length - 1];
    if (prev && prev.clip === s.clip && prev.offset === s.offset && prev.recOut === s.recIn) prev.recOut = s.recOut;
    else out.push({ ...s });
  }
  return out;
}
