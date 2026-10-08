// OpenTimelineIO (.otio JSON) reader. OWNED BY THE CAPTIONS/INTERCHANGE PACKAGE.
//
// importOtio(project, json) is pure: it returns a new Sequence (plus nested
// sequences and new MediaAssets for file paths the project doesn't know yet)
// and leaves adding them to the project to the caller (inside mutate). New
// assets carry the duration from available_range and a kind guessed from the
// file extension; the media package can probe them later. Omega metadata
// written by exportOtio (grades, effects, transforms, text, caption tracks)
// is restored, so Omega → OTIO → Omega keeps the edit intact.

import { sanitizeModifiers } from '../motion';
import type { CaptionCue, CaptionStyle, Clip, LabelColor, MediaAsset, Project, Sequence, Track, TransitionType } from '../../state/types';
import { newId } from '../../state/types';
import { makeAsset, makeClip, makeMarker, makeSequence, makeTrack, makeTransition } from '../../state/defaults';
import { exactRate } from '../time';
import { baseName, pathFromUrl } from './common';

export interface OtioImportResult {
  /** The imported timeline. */
  sequence: Sequence;
  /** The timeline first, then nested sequences created for nested stacks. */
  sequences: Sequence[];
  /** Assets created for media paths the project doesn't have yet. */
  assets: MediaAsset[];
  warnings: string[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Obj = Record<string, any>;

const VIDEO_EXT = /\.(mp4|mov|m4v|mkv|webm|avi|mxf|mts|m2ts|ts|mpg|mpeg|3gp|wmv|flv|r3d|braw|ari)$/i;
const AUDIO_EXT = /\.(wav|mp3|aac|m4a|flac|ogg|oga|opus|aif|aiff|caf|wma)$/i;
const IMAGE_EXT = /\.(png|jpe?g|tiff?|webp|bmp|gif|exr|dpx|heic|avif|svg)$/i;

const COLOR_BACK: Record<string, LabelColor> = {
  RED: 'red',
  ORANGE: 'orange',
  YELLOW: 'yellow',
  GREEN: 'green',
  CYAN: 'teal',
  BLUE: 'blue',
  PURPLE: 'violet',
  MAGENTA: 'pink',
  PINK: 'pink',
  WHITE: 'grey',
  BLACK: 'grey',
};

const schemaOf = (o: Obj | null | undefined): string => (o && typeof o.OTIO_SCHEMA === 'string' ? o.OTIO_SCHEMA.split('.')[0] : '');

function seconds(rt: Obj | null | undefined): number {
  if (!rt || typeof rt !== 'object') return 0;
  const v = Number(rt.value);
  const r = Number(rt.rate);
  return Number.isFinite(v) && Number.isFinite(r) && r > 0 ? v / r : 0;
}

function range(tr: Obj | null | undefined): { start: number; duration: number } | null {
  if (!tr || typeof tr !== 'object') return null;
  return { start: seconds(tr.start_time), duration: seconds(tr.duration) };
}

/** Our fps value for an OTIO rate (23.976023976… → 23.976). */
export function fpsFromRate(rate: number): number {
  for (const f of [23.976, 29.97, 47.952, 59.94, 119.88]) if (Math.abs(exactRate(f) - rate) < 1e-3) return f;
  return Math.round(rate * 1000) / 1000;
}

function firstRate(o: unknown, depth = 0): number | null {
  if (!o || typeof o !== 'object' || depth > 12) return null;
  const obj = o as Obj;
  if (schemaOf(obj) === 'RationalTime' && Number(obj.rate) > 0) return Number(obj.rate);
  for (const v of Object.values(obj)) {
    const r = firstRate(v, depth + 1);
    if (r) return r;
  }
  return null;
}

function itemDuration(item: Obj): number {
  const sr = range(item.source_range);
  if (sr) return sr.duration;
  const s = schemaOf(item);
  if (s === 'Clip') {
    const ref = activeRef(item);
    const ar = range(ref?.available_range);
    return ar?.duration ?? 0;
  }
  if (s === 'Stack') return Math.max(0, ...((Array.isArray(item.children) ? item.children : []) as Obj[]).map(trackDuration));
  if (s === 'Track') return trackDuration(item);
  return 0;
}

function trackDuration(track: Obj): number {
  let d = 0;
  for (const c of Array.isArray(track?.children) ? track.children : []) if (c && typeof c === 'object' && schemaOf(c) !== 'Transition') d += itemDuration(c);
  return d;
}

function activeRef(clip: Obj): Obj | null {
  if (clip.media_references && typeof clip.media_references === 'object') {
    const key = clip.active_media_reference_key ?? 'DEFAULT_MEDIA';
    return clip.media_references[key] ?? Object.values(clip.media_references)[0] ?? null;
  }
  return clip.media_reference ?? null; // Clip.1
}

function guessKind(path: string, trackKind: 'video' | 'audio'): MediaAsset['kind'] {
  if (IMAGE_EXT.test(path)) return 'image';
  if (AUDIO_EXT.test(path)) return 'audio';
  if (VIDEO_EXT.test(path)) return 'video';
  return trackKind;
}

interface Ctx {
  project: Project;
  assets: MediaAsset[];
  sequences: Sequence[];
  warnings: Set<string>;
  settings: Parameters<typeof makeSequence>[0];
  depth: number;
}

function findAsset(ctx: Ctx, path: string): MediaAsset | undefined {
  const norm = (p: string) => p.replace(/\\/g, '/');
  const n = norm(path);
  return ctx.project.assets.find((a) => norm(a.path) === n) ?? ctx.assets.find((a) => norm(a.path) === n);
}

function restoreClip(clip: Clip, meta: Obj | undefined): void {
  if (!meta || typeof meta !== 'object') return;
  const saved = meta.clip;
  if (saved && typeof saved === 'object') {
    for (const key of ['transform', 'crop', 'masks', 'blend', 'effects', 'grade', 'audio', 'fadeIn', 'fadeOut', 'keyframes', 'modifiers', 'text', 'shape', 'solid', 'gradient'] as const) {
      if (saved[key] !== undefined && saved[key] !== null) (clip as unknown as Obj)[key] = saved[key];
    }
    if (clip.modifiers !== undefined) {
      const clean = sanitizeModifiers(clip.modifiers);
      if (clean) clip.modifiers = clean;
      else delete clip.modifiers;
    }
  }
  if (typeof meta.label === 'string') clip.label = meta.label as LabelColor;
  if (typeof meta.frameBlend === 'boolean') clip.frameBlend = meta.frameBlend;
  if (typeof meta.linkId === 'string') clip.linkId = meta.linkId;
  if (typeof meta.groupId === 'string') clip.groupId = meta.groupId;
  if (typeof meta.notes === 'string' && meta.notes) clip.notes = meta.notes;
  if (typeof meta.speed === 'number' && meta.speed > 0) clip.speed = meta.speed;
  if (typeof meta.reverse === 'boolean') clip.reverse = meta.reverse;
  if (typeof meta.holdFrame === 'number') clip.holdFrame = meta.holdFrame;
}

function buildTrack(ctx: Ctx, otioTrack: Obj, kind: 'video' | 'audio', name: string, markersOut: ReturnType<typeof makeMarker>[]): Track {
  const track = makeTrack(kind, name);
  track.muted = otioTrack.enabled === false;
  const tmeta = otioTrack.metadata?.omega;
  if (tmeta && typeof tmeta === 'object') {
    if (typeof tmeta.locked === 'boolean') track.locked = tmeta.locked;
    if (kind === 'audio') {
      if (typeof tmeta.volume === 'number') track.volume = tmeta.volume;
      if (typeof tmeta.pan === 'number') track.pan = tmeta.pan;
    }
  }
  const children: Obj[] = Array.isArray(otioTrack.children) ? otioTrack.children : [];
  let cursor = 0;
  let lastClip: Clip | null = null;
  let lastClipMeta: Obj | undefined;
  let pending: { duration: number; type: TransitionType } | null = null;
  let prevWasClip = false;
  for (const child of children) {
    if (!child || typeof child !== 'object') continue;
    const s = schemaOf(child);
    if (s === 'Transition') {
      const d = seconds(child.in_offset) + seconds(child.out_offset);
      const t = (child.metadata?.omega?.type as TransitionType | undefined) ?? 'crossDissolve';
      pending = d > 0 ? { duration: d, type: kind === 'audio' && t === 'crossDissolve' ? 'audioCrossfade' : t } : null;
      continue;
    }
    const dur = itemDuration(child);
    if (s === 'Gap') {
      if (pending && lastClip && prevWasClip) {
        const saved = (lastClipMeta?.clip?.transitionOut ?? null) as Clip['transitionOut'];
        lastClip.transitionOut = saved ? { ...saved, duration: pending.duration } : makeTransition(pending.type, pending.duration);
      }
      pending = null;
      cursor += dur;
      prevWasClip = false;
      continue;
    }
    if (s !== 'Clip' && s !== 'Stack') {
      cursor += dur;
      ctx.warnings.add(`Unsupported OTIO item ${child.OTIO_SCHEMA} was skipped.`);
      continue;
    }
    const sr = range(child.source_range);
    const meta = child.metadata?.omega as Obj | undefined;
    let clip: Clip | null = null;
    if (s === 'Stack') {
      if (ctx.depth >= 8) {
        ctx.warnings.add('Nested stacks deeper than 8 levels were skipped.');
      } else {
        ctx.depth++;
        const nested = buildSequence(ctx, child, child.name || 'Nested sequence', null);
        ctx.depth--;
        ctx.sequences.push(nested);
        clip = makeClip('sequence', { start: cursor, duration: dur, inPoint: sr?.start ?? 0, sequenceId: nested.id, name: child.name || nested.name });
      }
    } else {
      const ref = activeRef(child);
      const rs = schemaOf(ref);
      const savedKind = meta?.kind as Clip['kind'] | undefined;
      if (rs === 'ExternalReference' || rs === 'ImageSequenceReference') {
        const url: string = rs === 'ExternalReference' ? (ref!.target_url ?? '') : (ref!.target_url_base ?? '');
        const path = pathFromUrl(url);
        if (!path) {
          ctx.warnings.add('Clips with an empty media URL were skipped.');
        } else {
          let asset = findAsset(ctx, path);
          if (!asset) {
            const ar = range(ref!.available_range);
            const am = ref!.metadata?.omega ?? {};
            const assetKind = (am.kind as MediaAsset['kind']) ?? guessKind(path, kind);
            asset = makeAsset({
              name: baseName(path),
              path,
              kind: assetKind,
              duration: ar ? ar.start + ar.duration : (sr?.start ?? 0) + dur,
              hasVideo: typeof am.hasVideo === 'boolean' ? am.hasVideo : assetKind !== 'audio',
              hasAudio: typeof am.hasAudio === 'boolean' ? am.hasAudio : assetKind === 'audio' || (assetKind === 'video' && kind === 'audio'),
              width: typeof am.width === 'number' ? am.width : undefined,
              height: typeof am.height === 'number' ? am.height : undefined,
              fps: typeof am.fps === 'number' ? am.fps : undefined,
            });
            ctx.assets.push(asset);
          } else if (kind === 'audio' && !asset.hasAudio && ctx.assets.includes(asset)) {
            asset.hasAudio = true;
          }
          clip = makeClip('media', { start: cursor, duration: dur, inPoint: sr?.start ?? 0, assetId: asset.id, name: child.name || asset.name });
        }
      } else if (savedKind && savedKind !== 'media' && savedKind !== 'sequence' && kind === 'video') {
        clip = makeClip(savedKind, { start: cursor, duration: dur, inPoint: sr?.start ?? 0, name: child.name || savedKind });
      } else if (rs === 'GeneratorReference' && kind === 'video') {
        const gk = String(ref!.generator_kind ?? '');
        const color = ref!.parameters?.color;
        clip = makeClip('solid', { start: cursor, duration: dur, name: child.name || gk || 'Solid' });
        if (typeof color === 'string') clip.solid = { color };
        if (gk !== 'SolidColor') ctx.warnings.add(`Generator clips (${gk || 'unknown'}) were imported as solids.`);
      } else {
        ctx.warnings.add('Clips with missing media references were skipped.');
      }
    }
    if (clip) {
      if (child.enabled === false) clip.enabled = false;
      for (const fx of Array.isArray(child.effects) ? child.effects : []) {
        const fs = schemaOf(fx);
        if (fs === 'LinearTimeWarp') {
          const k = Number(fx.time_scalar);
          if (Number.isFinite(k) && k !== 0) {
            clip.speed = Math.abs(k);
            clip.reverse = k < 0;
          } else if (k === 0) clip.holdFrame = clip.inPoint;
        } else if (fs === 'FreezeFrame') clip.holdFrame = clip.inPoint;
      }
      restoreClip(clip, meta);
      if (pending) {
        const saved = (meta?.clip?.transitionIn ?? null) as Clip['transitionIn'];
        clip.transitionIn = saved ? { ...saved, duration: pending.duration } : makeTransition(pending.type, pending.duration);
        pending = null;
      }
      // Clip-level markers become sequence markers at their timeline position.
      for (const m of Array.isArray(child.markers) ? child.markers : []) {
        const mr = range(m.marked_range);
        if (!mr) continue;
        markersOut.push(markerFrom(m, clip.start + (mr.start - (sr?.start ?? 0)), mr.duration));
      }
      track.clips.push(clip);
      lastClip = clip;
      lastClipMeta = meta;
      prevWasClip = true;
    } else prevWasClip = false;
    cursor += dur;
  }
  return track;
}

function markerFrom(m: Obj, time: number, duration: number) {
  const om = m.metadata?.omega ?? {};
  const kind = om.kind === 'chapter' || om.kind === 'todo' ? om.kind : 'marker';
  const color = (typeof om.color === 'string' ? om.color : COLOR_BACK[String(m.color ?? '').toUpperCase()]) ?? 'teal';
  return makeMarker(Math.max(0, time), {
    duration: Math.max(0, duration),
    label: String(m.name ?? ''),
    note: String(m.comment ?? ''),
    color: color as LabelColor,
    kind,
    ...(kind === 'todo' ? { done: !!om.done } : {}),
  });
}

function buildSequence(ctx: Ctx, stack: Obj, name: string, timeline: Obj | null): Sequence {
  const seq = makeSequence(ctx.settings, name);
  seq.tracks = [];
  const markers: ReturnType<typeof makeMarker>[] = [];
  const video: Track[] = [];
  const audio: Track[] = [];
  for (const t of Array.isArray(stack.children) ? stack.children : []) {
    if (!t || typeof t !== 'object') continue;
    const s = schemaOf(t);
    if (s === 'Track') {
      const isAudio = String(t.kind ?? 'Video').toLowerCase() === 'audio';
      const list = isAudio ? audio : video;
      list.push(buildTrack(ctx, t, isAudio ? 'audio' : 'video', t.name || `${isAudio ? 'A' : 'V'}${list.length + 1}`, markers));
    } else if (s === 'Stack') {
      // A stack directly inside a stack: treat as a video track holding one nested clip.
      const wrapper = { OTIO_SCHEMA: 'Track.1', kind: 'Video', name: t.name, children: [t] };
      video.push(buildTrack(ctx, wrapper, 'video', `V${video.length + 1}`, markers));
    }
  }
  // OTIO stacks are bottom-up; Omega tracks are top-first.
  seq.tracks = [...video.reverse(), ...audio];
  if (!video.length) seq.tracks.unshift(makeTrack('video', 'V1'));
  if (!audio.length) seq.tracks.push(makeTrack('audio', 'A1'));
  for (const m of Array.isArray(stack.markers) ? stack.markers : []) {
    const r = range(m.marked_range);
    if (r) markers.push(markerFrom(m, r.start, r.duration));
  }
  if (timeline) {
    const om = timeline.metadata?.omega;
    const caps = om && Array.isArray(om.captions) ? om.captions : [];
    caps.forEach((c: Obj, i: number) => {
      const tr = makeTrack('caption', typeof c.name === 'string' ? c.name : `C${i + 1}`);
      if (c.style && typeof c.style === 'object') tr.captionStyle = { ...tr.captionStyle!, ...(c.style as CaptionStyle) };
      tr.muted = !!c.muted;
      tr.cues = (Array.isArray(c.cues) ? c.cues : [])
        .filter((q: Obj) => Number.isFinite(q.start) && Number.isFinite(q.end) && q.end > q.start)
        .map((q: Obj) => {
          const cue: CaptionCue = { id: newId('cue'), start: q.start, end: q.end, text: String(q.text ?? '') };
          if (typeof q.speaker === 'string' && q.speaker) cue.speaker = q.speaker;
          return cue;
        });
      seq.tracks.push(tr);
    });
  }
  seq.markers = markers.sort((a, b) => a.time - b.time);
  return seq;
}

/**
 * Creates a new Sequence from an OTIO file. Throws a readable Error when the
 * JSON isn't an OTIO timeline.
 */
export function importOtio(project: Project, json: string): OtioImportResult {
  let root: Obj;
  try {
    root = JSON.parse(json);
  } catch (e) {
    throw new Error(`Not a valid OTIO file: ${(e as Error).message}`);
  }
  let timeline: Obj | null = null;
  let stack: Obj | null = null;
  const s = schemaOf(root);
  if (s === 'Timeline') timeline = root;
  else if (s === 'SerializableCollection') timeline = (root.children ?? []).find((c: Obj) => schemaOf(c) === 'Timeline') ?? null;
  else if (s === 'Stack') stack = root;
  else if (s === 'Track') stack = { OTIO_SCHEMA: 'Stack.1', children: [root], name: root.name };
  if (timeline) stack = timeline.tracks;
  if (!stack || schemaOf(stack) !== 'Stack') throw new Error('Not an OpenTimelineIO timeline (no Timeline.1 / Stack.1 found).');

  const rate = Number(timeline?.global_start_time?.rate) || firstRate(stack) || project.settings.fps;
  const om = (timeline?.metadata?.omega ?? {}) as Obj;
  const fps = typeof om.fps === 'number' ? om.fps : fpsFromRate(rate);
  const settings = {
    width: typeof om.width === 'number' ? om.width : project.settings.width,
    height: typeof om.height === 'number' ? om.height : project.settings.height,
    fps,
    dropFrame: typeof om.dropFrame === 'boolean' ? om.dropFrame : Math.abs(fps - 29.97) < 0.01 || Math.abs(fps - 59.94) < 0.01 ? project.settings.dropFrame : false,
    sampleRate: om.sampleRate === 44100 || om.sampleRate === 96000 ? om.sampleRate : project.settings.sampleRate,
    colorSpace: typeof om.colorSpace === 'string' ? om.colorSpace : project.settings.colorSpace,
  } as Parameters<typeof makeSequence>[0];
  const ctx: Ctx = { project, assets: [], sequences: [], warnings: new Set(), settings, depth: 0 };
  const name = String(timeline?.name || stack.name || 'Imported timeline');
  const seq = buildSequence(ctx, stack, name, timeline);
  if (timeline?.global_start_time) seq.startTimecode = seconds(timeline.global_start_time);
  if (typeof om.background === 'string') seq.background = om.background;
  if (typeof om.inPoint === 'number') seq.inPoint = om.inPoint;
  if (typeof om.outPoint === 'number') seq.outPoint = om.outPoint;
  return { sequence: seq, sequences: [seq, ...ctx.sequences], assets: ctx.assets, warnings: [...ctx.warnings] };
}
