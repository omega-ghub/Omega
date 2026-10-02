// OpenTimelineIO (.otio JSON) writer. OWNED BY THE CAPTIONS/INTERCHANGE PACKAGE.
//
// Timeline.1 → Stack.1 → Track.1 (Video bottom-up, then Audio A1…An) with
// Clip.2 (ExternalReference.1 file:// media, available_range), Gap.1,
// Transition.1 (centered on the cut: in_offset / out_offset) and Marker.2 on
// the top-level stack. All times are RationalTime.1 at the sequence rate
// (23.976 → 23.976023976023978). Nested sequences become Stack.1 items inside
// the track. Speed changes are LinearTimeWarp.1 / FreezeFrame.1 effects; clip
// effects are Effect.1 entries; metadata.omega carries the Omega-specific
// state (grade, transform, effects params, text, caption tracks) so an Omega
// → OTIO → Omega round trip (importOtio) is lossless for the edit.

import type { Clip, Marker, Project, Sequence, Track } from '../../state/types';
import { isGradeIdentity } from '../../state/defaults';
import { exactRate } from '../time';
import { assetById, audioTracks, clipFrames, DISSOLVE_TYPES, effectiveSpeed, fileUrl, hasSpeedRamp, sortedClips, startFrames, TRANSITION_LABELS, videoTracks } from './common';

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

/** Keys whose numbers must be written as doubles (OTIO RationalTime). */
const DOUBLE_KEYS = new Set(['rate', 'value', 'time_scalar']);

/** JSON with integer RationalTime values written as 48.0 (what OTIO's own writer emits). */
export function stringifyOtio(v: Json, indent = 0, key = ''): string {
  const pad = '    '.repeat(indent);
  const padIn = '    '.repeat(indent + 1);
  if (v === null) return 'null';
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return '0.0';
    return DOUBLE_KEYS.has(key) && Number.isInteger(v) ? `${v}.0` : String(v);
  }
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'string') return JSON.stringify(v);
  if (Array.isArray(v)) {
    if (!v.length) return '[]';
    return `[\n${v.map((x) => padIn + stringifyOtio(x, indent + 1)).join(',\n')}\n${pad}]`;
  }
  const entries = Object.entries(v);
  if (!entries.length) return '{}';
  return `{\n${entries.map(([k, x]) => `${padIn}${JSON.stringify(k)}: ${stringifyOtio(x, indent + 1, k)}`).join(',\n')}\n${pad}}`;
}

const RT = (value: number, rate: number): Json => ({ OTIO_SCHEMA: 'RationalTime.1', rate, value });
const TR = (start: number, duration: number, rate: number): Json => ({ OTIO_SCHEMA: 'TimeRange.1', duration: RT(duration, rate), start_time: RT(start, rate) });

const MARKER_COLORS: Record<string, string> = {
  none: 'RED',
  red: 'RED',
  orange: 'ORANGE',
  yellow: 'YELLOW',
  green: 'GREEN',
  teal: 'CYAN',
  blue: 'BLUE',
  violet: 'PURPLE',
  pink: 'PINK',
  grey: 'WHITE',
};

function markerJson(m: Marker, rate: number, fps: number): Json {
  const t = Math.round(m.time * exactRate(fps));
  const d = Math.max(0, Math.round(m.duration * exactRate(fps)));
  return {
    OTIO_SCHEMA: 'Marker.2',
    metadata: { omega: { id: m.id, kind: m.kind, color: m.color, ...(m.kind === 'todo' ? { done: !!m.done } : {}) } },
    name: m.label,
    color: MARKER_COLORS[m.color] ?? 'RED',
    marked_range: TR(t, d, rate),
    comment: m.note ?? '',
  };
}

/** Omega clip state that OTIO has no schema for. */
function clipMeta(clip: Clip): Json {
  const {
    id,
    kind,
    label,
    transform,
    crop,
    masks,
    blend,
    effects,
    grade,
    audio,
    fadeIn,
    fadeOut,
    keyframes,
    text,
    shape,
    solid,
    gradient,
    frameBlend,
    linkId,
    groupId,
    notes,
    speed,
    reverse,
    holdFrame,
    transitionIn,
    transitionOut,
  } = clip;
  const summary: Record<string, Json> = {};
  if (effects.length) summary.effects = effects.filter((e) => e.enabled).map((e) => e.type);
  if (!isGradeIdentity(grade)) {
    const g: string[] = [];
    if (grade.exposure) g.push(`exposure ${grade.exposure > 0 ? '+' : ''}${grade.exposure}`);
    if (grade.contrast !== 1) g.push(`contrast ${grade.contrast}`);
    if (grade.saturation !== 1) g.push(`saturation ${grade.saturation}`);
    if (grade.temperature) g.push(`temperature ${grade.temperature}`);
    if (grade.tint) g.push(`tint ${grade.tint}`);
    if (grade.lut.id) g.push('LUT');
    if (grade.inputTransform !== 'auto') g.push(`input ${grade.inputTransform}`);
    if (grade.qualifier.enabled) g.push('qualifier');
    summary.grade = g.join(', ') || 'graded';
  }
  return JSON.parse(
    JSON.stringify({
      clipId: id,
      kind,
      label,
      speed,
      reverse,
      holdFrame,
      frameBlend,
      linkId: linkId ?? null,
      groupId: groupId ?? null,
      notes: notes ?? '',
      summary,
      clip: { transform, crop, masks, blend, effects, grade, audio, fadeIn, fadeOut, keyframes, text, shape, solid, gradient, transitionIn, transitionOut },
    }),
  ) as Json;
}

interface Ctx {
  project: Project;
  rate: number;
  fps: number;
  stack: string[]; // sequence ids being written (cycle guard)
}

function speedEffects(clip: Clip): Json[] {
  if (clip.holdFrame !== null && clip.holdFrame !== undefined) {
    return [{ OTIO_SCHEMA: 'FreezeFrame.1', metadata: {}, name: '', effect_name: 'FreezeFrame', time_scalar: 0 }];
  }
  const s = effectiveSpeed(clip) * (clip.reverse ? -1 : 1);
  if (s === 1) return [];
  return [{ OTIO_SCHEMA: 'LinearTimeWarp.1', metadata: hasSpeedRamp(clip) ? { omega: { ramp: true } } : {}, name: '', effect_name: 'LinearTimeWarp', time_scalar: s }];
}

function clipItem(ctx: Ctx, clip: Clip, durF: number, trimHeadF: number, trackKind: 'Video' | 'Audio'): Json {
  const { project, rate, fps } = ctx;
  const inF = Math.round(clip.inPoint * exactRate(fps)) + Math.round(trimHeadF * Math.abs(clip.speed || 1));
  const effects: Json[] = [
    ...speedEffects(clip),
    ...clip.effects.filter((e) => e.enabled && trackKind === 'Video').map((e) => ({ OTIO_SCHEMA: 'Effect.1', metadata: { omega: { id: e.id, params: e.params } }, name: e.type, effect_name: e.type }) as Json),
  ];
  const meta: Json = { omega: clipMeta(clip) };
  if (clip.kind === 'sequence') {
    const nested = project.sequences.find((s) => s.id === clip.sequenceId);
    if (nested && !ctx.stack.includes(nested.id) && ctx.stack.length < 8) {
      ctx.stack.push(nested.id);
      const stack = stackJson(ctx, nested, trackKind);
      ctx.stack.pop();
      return { ...(stack as Record<string, Json>), name: clip.name || nested.name, source_range: TR(inF, durF, rate), effects, metadata: { omega: { ...(clipMeta(clip) as Record<string, Json>), sequenceId: nested.id } }, enabled: clip.enabled };
    }
  }
  let ref: Json;
  if (clip.kind === 'media') {
    const asset = assetById(project, clip.assetId);
    if (asset) {
      const avail = asset.kind === 'image' ? null : TR(0, Math.max(0, Math.round(asset.duration * exactRate(fps))), rate);
      ref = {
        OTIO_SCHEMA: 'ExternalReference.1',
        metadata: { omega: { assetId: asset.id, kind: asset.kind, width: asset.width ?? null, height: asset.height ?? null, fps: asset.fps ?? null, hasAudio: asset.hasAudio, hasVideo: asset.hasVideo } },
        name: asset.name,
        available_range: avail,
        available_image_bounds: null,
        target_url: fileUrl(asset.path),
      };
    } else ref = { OTIO_SCHEMA: 'MissingReference.1', metadata: {}, name: clip.name, available_range: null, available_image_bounds: null };
  } else if (clip.kind === 'solid' || clip.kind === 'gradient' || clip.kind === 'text' || clip.kind === 'shape') {
    const kindName = { solid: 'SolidColor', gradient: 'Gradient', text: 'Text', shape: 'Shape' }[clip.kind];
    const params: Record<string, Json> = clip.kind === 'solid' ? { color: clip.solid?.color ?? '#000000' } : clip.kind === 'text' ? { text: clip.text?.content ?? '' } : {};
    ref = { OTIO_SCHEMA: 'GeneratorReference.1', metadata: {}, name: clip.name, available_range: null, available_image_bounds: null, generator_kind: kindName, parameters: params };
  } else {
    ref = { OTIO_SCHEMA: 'MissingReference.1', metadata: {}, name: clip.name, available_range: null, available_image_bounds: null };
  }
  return {
    OTIO_SCHEMA: 'Clip.2',
    metadata: meta,
    name: clip.name,
    source_range: TR(inF, durF, rate),
    effects,
    markers: [],
    enabled: clip.enabled,
    media_references: { DEFAULT_MEDIA: ref },
    active_media_reference_key: 'DEFAULT_MEDIA',
  };
}

function gapJson(durF: number, rate: number): Json {
  return { OTIO_SCHEMA: 'Gap.1', metadata: {}, name: '', source_range: TR(0, durF, rate), effects: [], markers: [], enabled: true };
}

function transitionJson(inOff: number, outOff: number, rate: number, type: string): Json {
  const dissolve = DISSOLVE_TYPES.has(type as never);
  return {
    OTIO_SCHEMA: 'Transition.1',
    metadata: { omega: { type } },
    name: TRANSITION_LABELS[type as keyof typeof TRANSITION_LABELS] ?? type,
    in_offset: RT(inOff, rate),
    out_offset: RT(outOff, rate),
    transition_type: dissolve ? 'SMPTE_Dissolve' : 'Custom_Transition',
  };
}

function trackJson(ctx: Ctx, track: Track, kind: 'Video' | 'Audio'): Json {
  const { rate, fps } = ctx;
  const children: Json[] = [];
  let cursor = 0;
  let prev: { clip: Clip; durF: number } | null = null;
  for (const clip of sortedClips(track)) {
    const { s, e } = clipFrames(clip, fps);
    if (e <= s) continue;
    const start = Math.max(s, cursor);
    if (e <= start) continue;
    const gapF = start - cursor;
    const tin = clip.transitionIn;
    if (gapF > 0) {
      children.push(gapJson(gapF, rate));
      // Tail transition of the previous clip into this gap (to nothing).
      if (prev && prev.clip.transitionOut && prev.clip.transitionOut.duration > 0) {
        const d = Math.round(prev.clip.transitionOut.duration * exactRate(fps));
        const inOff = Math.min(Math.floor(d / 2), prev.durF);
        const outOff = Math.min(d - Math.floor(d / 2), gapF);
        if (inOff + outOff > 0) children.splice(children.length - 1, 0, transitionJson(inOff, outOff, rate, prev.clip.transitionOut.type));
      }
    }
    const durF = e - start;
    // Head transition from the previous clip (adjacent) or from the gap (nothing).
    if (tin && tin.duration > 0 && start === s && children.length) {
      const d = Math.round(tin.duration * exactRate(fps));
      const half = Math.floor(d / 2);
      const prevDur = gapF > 0 ? gapF : (prev?.durF ?? 0);
      const inOff = Math.min(half, prevDur);
      const outOff = Math.min(d - half, durF);
      if (inOff + outOff > 0) children.push(transitionJson(inOff, outOff, rate, tin.type));
    }
    children.push(clipItem(ctx, clip, durF, start - s, kind));
    prev = { clip, durF };
    cursor = e;
  }
  // Fade to nothing after the last clip: add the gap the transition fades into.
  if (prev && prev.clip.transitionOut && prev.clip.transitionOut.duration > 0) {
    const d = Math.round(prev.clip.transitionOut.duration * exactRate(fps));
    const inOff = Math.min(Math.floor(d / 2), prev.durF);
    const outOff = d - Math.floor(d / 2);
    if (outOff > 0) {
      children.push(transitionJson(inOff, outOff, rate, prev.clip.transitionOut.type));
      children.push(gapJson(outOff, rate));
    }
  }
  return {
    OTIO_SCHEMA: 'Track.1',
    metadata: { omega: { trackId: track.id, locked: track.locked, ...(kind === 'Audio' ? { volume: track.volume, pan: track.pan, solo: track.solo } : {}) } },
    name: track.name,
    source_range: null,
    effects: [],
    markers: [],
    enabled: !track.muted,
    children,
    kind,
  };
}

function stackJson(ctx: Ctx, seq: Sequence, only?: 'Video' | 'Audio'): Json {
  const tracks: Json[] = [];
  if (only !== 'Audio') for (const t of videoTracks(seq).slice().reverse()) tracks.push(trackJson(ctx, t, 'Video'));
  if (only !== 'Video') for (const t of audioTracks(seq)) tracks.push(trackJson(ctx, t, 'Audio'));
  return {
    OTIO_SCHEMA: 'Stack.1',
    metadata: {},
    name: seq.name,
    source_range: null,
    effects: [],
    markers: [],
    enabled: true,
    children: tracks,
  };
}

/** Builds the OTIO document as a plain object (for tests and other writers). */
export function buildOtio(project: Project, seq: Sequence): Json {
  const rate = exactRate(seq.fps);
  const ctx: Ctx = { project, rate, fps: seq.fps, stack: [seq.id] };
  const stack = stackJson(ctx, seq) as Record<string, Json>;
  stack.name = 'tracks';
  stack.markers = seq.markers.slice().sort((a, b) => a.time - b.time).map((m) => markerJson(m, rate, seq.fps));
  const captions = seq.tracks
    .filter((t) => t.kind === 'caption')
    .map((t) => ({ name: t.name, muted: t.muted, style: t.captionStyle ?? null, cues: t.cues.map((c) => ({ id: c.id, start: c.start, end: c.end, text: c.text, speaker: c.speaker ?? null })) }));
  return {
    OTIO_SCHEMA: 'Timeline.1',
    metadata: {
      omega: JSON.parse(
        JSON.stringify({
          sequenceId: seq.id,
          width: seq.width,
          height: seq.height,
          fps: seq.fps,
          dropFrame: seq.dropFrame,
          sampleRate: seq.sampleRate,
          colorSpace: seq.colorSpace,
          background: seq.background,
          startTimecode: seq.startTimecode,
          inPoint: seq.inPoint,
          outPoint: seq.outPoint,
          captions,
        }),
      ) as Json,
    },
    name: seq.name,
    global_start_time: RT(startFrames(seq), rate),
    tracks: stack,
  };
}

/** OpenTimelineIO JSON (.otio). */
export function exportOtio(project: Project, seq: Sequence): string {
  return stringifyOtio(buildOtio(project, seq)) + '\n';
}
