// Frame graph: a pure description of what one frame of a sequence looks like
// at time t, with every animated value resolved. The GPU renderer draws it;
// preview and export build it the same way, so they always match.

import { getTransition } from '../effects/registry';
import { applyEase, paramAt } from '../keyframes';
import { EPS, sourceTimeAt } from '../time';
import type {
  BlendMode,
  CaptionCue,
  CaptionStyle,
  Clip,
  ColorGrade,
  Crop,
  GradientProps,
  InputTransform,
  Mask,
  Project,
  RGBY,
  Sequence,
  ShapeProps,
  TextProps,
  Track,
  Transform,
  TransitionType,
} from '../../state/types';

export type LayerSource =
  | { kind: 'media'; assetId: string; sourceTime: number; width: number; height: number; isStill: boolean }
  | { kind: 'text'; text: TextProps; local: number; duration: number; width: number; height: number }
  | { kind: 'shape'; shape: ShapeProps; width: number; height: number }
  | { kind: 'solid'; color: string; width: number; height: number }
  | { kind: 'gradient'; gradient: GradientProps; width: number; height: number }
  | { kind: 'sequence'; graph: FrameGraph; width: number; height: number };

export interface ResolvedEffect {
  id: string;
  type: string;
  params: Record<string, number | boolean | string>;
}

export interface LayerNode {
  type: 'layer';
  clipId: string;
  trackId: string;
  /** Adjustment layers have no source: they process everything below them. */
  adjustment: boolean;
  source: LayerSource | null;
  /** Clip-local time (seconds since clip start). */
  local: number;
  transform: Transform; // resolved numbers
  crop: Crop;
  masks: Mask[]; // resolved, enabled only
  /** Final opacity including fades. */
  opacity: number;
  blend: BlendMode;
  effects: ResolvedEffect[]; // enabled only, in order
  grade: ColorGrade | null; // null = identity (skip the grade pass)
  inputTransform: InputTransform; // resolved ('auto' replaced)
  seed: number; // stable per clip, 0..1
}

export interface TransitionNode {
  type: 'transition';
  transition: TransitionType;
  params: Record<string, number>;
  /** 0..1, already eased */
  progress: number;
  from: LayerNode | null; // null = transparent
  to: LayerNode | null;
  trackId: string;
}

export type GraphItem = LayerNode | TransitionNode;

export interface CaptionNode {
  cue: CaptionCue;
  style: CaptionStyle;
  trackId: string;
}

export interface FrameGraph {
  width: number;
  height: number;
  t: number;
  background: string;
  colorSpace: Sequence['colorSpace'];
  /** Bottom-most first. */
  items: GraphItem[];
  captions: CaptionNode[];
}

export interface BuildOptions {
  /** Render one of the sequence's alternate formats (multi-aspect). */
  formatId?: string | null;
  /** Skip caption tracks (e.g. when captions are exported as a sidecar). */
  captions?: boolean;
  /** Nested-sequence recursion guard. */
  depth?: number;
}

const MAX_DEPTH = 8;

function hashSeed(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return ((h >>> 0) % 100000) / 100000;
}

function rgbyAt(clip: Clip, base: string, local: number): RGBY {
  return {
    r: paramAt(clip, `${base}.r`, local),
    g: paramAt(clip, `${base}.g`, local),
    b: paramAt(clip, `${base}.b`, local),
    y: paramAt(clip, `${base}.y`, local),
  };
}

export function resolveGrade(clip: Clip, local: number): ColorGrade {
  const g = clip.grade;
  return {
    ...g,
    exposure: paramAt(clip, 'grade.exposure', local),
    temperature: paramAt(clip, 'grade.temperature', local),
    tint: paramAt(clip, 'grade.tint', local),
    contrast: paramAt(clip, 'grade.contrast', local),
    pivot: paramAt(clip, 'grade.pivot', local),
    saturation: paramAt(clip, 'grade.saturation', local),
    vibrance: paramAt(clip, 'grade.vibrance', local),
    highlights: paramAt(clip, 'grade.highlights', local),
    shadows: paramAt(clip, 'grade.shadows', local),
    lift: rgbyAt(clip, 'grade.lift', local),
    gamma: rgbyAt(clip, 'grade.gamma', local),
    gain: rgbyAt(clip, 'grade.gain', local),
    offset: rgbyAt(clip, 'grade.offset', local),
    lut: { id: g.lut.id, intensity: paramAt(clip, 'grade.lut.intensity', local) },
  };
}

function gradeIsIdentity(g: ColorGrade, input: InputTransform): boolean {
  const z = (c: RGBY) => c.r === 0 && c.g === 0 && c.b === 0 && c.y === 0;
  return (
    (input === 'rec709' || input === 'srgb') &&
    (!g.enabled ||
      (g.exposure === 0 &&
        g.temperature === 0 &&
        g.tint === 0 &&
        g.contrast === 1 &&
        g.saturation === 1 &&
        g.vibrance === 0 &&
        g.highlights === 0 &&
        g.shadows === 0 &&
        z(g.lift) &&
        z(g.gamma) &&
        z(g.gain) &&
        z(g.offset) &&
        !g.curves.master.length &&
        !g.curves.r.length &&
        !g.curves.g.length &&
        !g.curves.b.length &&
        !g.qualifier.enabled &&
        !(g.lut.id && g.lut.intensity > 0)))
  );
}

/** Builds a LayerNode for a clip at timeline time t (t may be outside the clip for transition handles). */
export function buildLayer(project: Project, seq: Sequence, track: Track, clip: Clip, t: number, opts: BuildOptions): LayerNode | null {
  const local = Math.max(0, Math.min(t - clip.start, clip.duration));
  const W = seq.width;
  const H = seq.height;
  let source: LayerSource | null = null;
  let inputTransform: InputTransform = 'rec709';

  switch (clip.kind) {
    case 'media': {
      const asset = project.assets.find((a) => a.id === clip.assetId);
      if (!asset || asset.offline || !asset.hasVideo) return null;
      const isStill = asset.kind === 'image';
      // Handles beyond the clip edges come from the source when it has them.
      const rawLocal = t - clip.start;
      let sourceTime = isStill ? 0 : sourceTimeAt(clip, local) + (rawLocal - local) * (clip.reverse ? -clip.speed : clip.speed);
      if (!isStill) sourceTime = Math.max(0, Math.min(sourceTime, Math.max(0, asset.duration - 1e-3)));
      source = { kind: 'media', assetId: asset.id, sourceTime, width: asset.width ?? W, height: asset.height ?? H, isStill };
      const it = clip.grade.inputTransform !== 'auto' ? clip.grade.inputTransform : asset.inputTransform;
      inputTransform = it === 'auto' ? (isStill ? 'srgb' : 'rec709') : it;
      break;
    }
    case 'text':
      source = { kind: 'text', text: resolveText(clip, local), local, duration: clip.duration, width: W, height: H };
      inputTransform = 'srgb';
      break;
    case 'shape':
      source = {
        kind: 'shape',
        shape: { ...clip.shape!, width: paramAt(clip, 'shape.width', local), height: paramAt(clip, 'shape.height', local), radius: paramAt(clip, 'shape.radius', local) },
        width: W,
        height: H,
      };
      inputTransform = 'srgb';
      break;
    case 'solid':
      source = { kind: 'solid', color: clip.solid!.color, width: W, height: H };
      inputTransform = 'srgb';
      break;
    case 'gradient':
      source = { kind: 'gradient', gradient: clip.gradient!, width: W, height: H };
      inputTransform = 'srgb';
      break;
    case 'sequence': {
      const nested = project.sequences.find((s) => s.id === clip.sequenceId);
      const depth = (opts.depth ?? 0) + 1;
      if (!nested || nested.id === seq.id || depth > MAX_DEPTH) return null;
      const graph = buildFrameGraph(project, nested.id, sourceTimeAt(clip, local), { ...opts, depth, formatId: null });
      source = { kind: 'sequence', graph, width: nested.width, height: nested.height };
      inputTransform = 'linear';
      break;
    }
    case 'adjustment':
      source = null;
      inputTransform = 'linear';
      break;
  }

  const transform: Transform = {
    ...clip.transform,
    x: paramAt(clip, 'transform.x', local),
    y: paramAt(clip, 'transform.y', local),
    scale: paramAt(clip, 'transform.scale', local),
    scaleX: paramAt(clip, 'transform.scaleX', local),
    scaleY: paramAt(clip, 'transform.scaleY', local),
    rotation: paramAt(clip, 'transform.rotation', local),
    anchorX: paramAt(clip, 'transform.anchorX', local),
    anchorY: paramAt(clip, 'transform.anchorY', local),
    opacity: paramAt(clip, 'transform.opacity', local),
  };
  const fmt = opts.formatId ? clip.formatOverrides?.[opts.formatId] : undefined;
  if (fmt) {
    if (fmt.x !== undefined) transform.x = fmt.x;
    if (fmt.y !== undefined) transform.y = fmt.y;
    if (fmt.scale !== undefined) transform.scale = fmt.scale;
  }

  let opacity = Math.max(0, Math.min(1, transform.opacity));
  if (clip.fadeIn > 0 && local < clip.fadeIn) opacity *= local / clip.fadeIn;
  if (clip.fadeOut > 0 && local > clip.duration - clip.fadeOut) opacity *= Math.max(0, (clip.duration - local) / clip.fadeOut);

  const crop: Crop = {
    left: paramAt(clip, 'crop.left', local),
    top: paramAt(clip, 'crop.top', local),
    right: paramAt(clip, 'crop.right', local),
    bottom: paramAt(clip, 'crop.bottom', local),
    feather: paramAt(clip, 'crop.feather', local),
  };

  const masks = clip.masks
    .filter((m) => m.enabled)
    .map((m) => ({
      ...m,
      x: paramAt(clip, `masks.${m.id}.x`, local),
      y: paramAt(clip, `masks.${m.id}.y`, local),
      width: paramAt(clip, `masks.${m.id}.width`, local),
      height: paramAt(clip, `masks.${m.id}.height`, local),
      rotation: paramAt(clip, `masks.${m.id}.rotation`, local),
      roundness: paramAt(clip, `masks.${m.id}.roundness`, local),
      feather: paramAt(clip, `masks.${m.id}.feather`, local),
      expansion: paramAt(clip, `masks.${m.id}.expansion`, local),
      opacity: paramAt(clip, `masks.${m.id}.opacity`, local),
    }));

  const effects: ResolvedEffect[] = clip.effects
    .filter((e) => e.enabled)
    .map((e) => {
      const params: Record<string, number | boolean | string> = {};
      for (const [k, v] of Object.entries(e.params)) params[k] = typeof v === 'number' ? paramAt(clip, `effects.${e.id}.${k}`, local) : v;
      return { id: e.id, type: e.type, params };
    });

  const grade = resolveGrade(clip, local);
  return {
    type: 'layer',
    clipId: clip.id,
    trackId: track.id,
    adjustment: clip.kind === 'adjustment',
    source,
    local,
    transform,
    crop,
    masks,
    opacity,
    blend: clip.blend,
    effects,
    grade: gradeIsIdentity(grade, inputTransform) ? null : grade,
    inputTransform,
    seed: hashSeed(clip.id),
  };
}

function resolveText(clip: Clip, local: number): TextProps {
  const t = clip.text!;
  return {
    ...t,
    size: paramAt(clip, 'text.size', local),
    letterSpacing: paramAt(clip, 'text.letterSpacing', local),
    lineHeight: paramAt(clip, 'text.lineHeight', local),
  };
}

/** Clips on a track sorted by start (tracks are not guaranteed sorted). */
function sorted(track: Track): Clip[] {
  return [...track.clips].sort((a, b) => a.start - b.start);
}

/**
 * The visible item for one video track at time t: a layer, a transition
 * between two layers, or nothing.
 */
export function trackItemAt(project: Project, seq: Sequence, track: Track, t: number, opts: BuildOptions = {}): GraphItem | null {
  const clips = sorted(track).filter((c) => c.enabled);
  for (let i = 0; i < clips.length; i++) {
    const clip = clips[i];
    const prev = i > 0 ? clips[i - 1] : null;
    const next = i < clips.length - 1 ? clips[i + 1] : null;
    // Transition at this clip's head, centered on the cut.
    const tin = clip.transitionIn;
    if (tin && tin.duration > 0) {
      const half = tin.duration / 2;
      const a = clip.start - half;
      const b = clip.start + half;
      if (t >= a - EPS && t < b - EPS) {
        const adjacent = prev && Math.abs(prev.start + prev.duration - clip.start) < 1e-3 ? prev : null;
        const def = getTransition(tin.type);
        const progress = applyEase(tin.ease, (t - a) / tin.duration);
        return {
          type: 'transition',
          transition: tin.type,
          params: { ...(def ? Object.fromEntries(def.params.map((p) => [p.key, Number(p.default)])) : {}), ...tin.params },
          progress,
          from: adjacent ? buildLayer(project, seq, track, adjacent, t, opts) : null,
          to: buildLayer(project, seq, track, clip, t, opts),
          trackId: track.id,
        };
      }
    }
    // Transition at the tail when nothing follows.
    const tout = clip.transitionOut;
    const followed = next && Math.abs(clip.start + clip.duration - next.start) < 1e-3;
    if (tout && tout.duration > 0 && !followed) {
      const end = clip.start + clip.duration;
      const a = end - tout.duration / 2;
      const b = end + tout.duration / 2;
      if (t >= a - EPS && t < b - EPS) {
        return {
          type: 'transition',
          transition: tout.type,
          params: { ...tout.params },
          progress: applyEase(tout.ease, (t - a) / tout.duration),
          from: buildLayer(project, seq, track, clip, t, opts),
          to: null,
          trackId: track.id,
        };
      }
    }
    if (t >= clip.start - EPS && t < clip.start + clip.duration - EPS) {
      // Skip if the next clip's head transition already covers this time.
      if (next?.transitionIn && followed && t >= next.start - next.transitionIn.duration / 2 - EPS) continue;
      return buildLayer(project, seq, track, clip, t, opts);
    }
  }
  return null;
}

export function buildFrameGraph(project: Project, sequenceId: string, t: number, opts: BuildOptions = {}): FrameGraph {
  const seq = project.sequences.find((s) => s.id === sequenceId);
  if (!seq) throw new Error(`Unknown sequence ${sequenceId}`);
  const format = opts.formatId ? seq.formats.find((f) => f.id === opts.formatId) : null;
  const width = format?.width ?? seq.width;
  const height = format?.height ?? seq.height;
  const items: GraphItem[] = [];
  const videoTracks = seq.tracks.filter((tr) => tr.kind === 'video' && !tr.muted);
  // Tracks are stored top-first; the graph is bottom-first.
  for (let i = videoTracks.length - 1; i >= 0; i--) {
    const item = trackItemAt(project, { ...seq, width, height }, videoTracks[i], t, opts);
    if (item) items.push(item);
  }
  const captions: CaptionNode[] = [];
  if (opts.captions !== false) {
    for (const tr of seq.tracks) {
      if (tr.kind !== 'caption' || tr.muted || !tr.captionStyle) continue;
      const cue = tr.cues.find((c) => t >= c.start - EPS && t < c.end - EPS);
      if (cue) captions.push({ cue, style: tr.captionStyle, trackId: tr.id });
    }
  }
  return { width, height, t, background: seq.background, colorSpace: seq.colorSpace, items, captions };
}

/** All media (assetId, sourceTime) pairs a graph needs — used to prefetch decoded frames. */
export function mediaRequests(graph: FrameGraph): { assetId: string; sourceTime: number; clipId: string }[] {
  const out: { assetId: string; sourceTime: number; clipId: string }[] = [];
  const visit = (n: LayerNode | null) => {
    if (!n?.source) return;
    if (n.source.kind === 'media') out.push({ assetId: n.source.assetId, sourceTime: n.source.sourceTime, clipId: n.clipId });
    if (n.source.kind === 'sequence') for (const r of mediaRequests(n.source.graph)) out.push(r);
  };
  for (const item of graph.items) {
    if (item.type === 'layer') visit(item);
    else {
      visit(item.from);
      visit(item.to);
    }
  }
  return out;
}
