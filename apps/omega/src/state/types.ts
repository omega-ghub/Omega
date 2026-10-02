import type { AppKind } from '../brand/themes';

// ============================================================================
// Omega project document model, v2.
//
// One JSON document per project (ADR-0002 will wrap it in a zip container).
// Every package in the Video app reads and writes this model; it is the
// contract between them. Times are in SECONDS (floats) unless noted; editing
// code snaps them to the sequence frame grid with engine/time.ts.
//
// Rule: if it can be animated, it is a number (or a color string) addressed by
// a param path (see engine/keyframes.ts), and its static value lives here.
// ============================================================================

export const FORMAT_VERSION = '0.2.0-json';

// ---------------------------------------------------------------------------
// Color
// ---------------------------------------------------------------------------

/** Display / delivery color space of a sequence. */
export type ColorSpace = 'rec709' | 'srgb' | 'p3' | 'rec2020-hlg' | 'rec2020-pq';

/**
 * How a source's code values are decoded to scene-linear light before
 * grading. 'auto' = use the asset's setting (which itself defaults to rec709).
 */
export type InputTransform =
  | 'auto'
  | 'rec709'
  | 'srgb'
  | 'linear'
  | 'slog3' // Sony S-Log3
  | 'logc3' // ARRI LogC3 (EI 800)
  | 'vlog' // Panasonic V-Log
  | 'clog3' // Canon Log 3
  | 'flog' // Fujifilm F-Log
  | 'hlg' // ITU-R BT.2100 HLG
  | 'pq'; // SMPTE ST 2084 PQ

export interface RGBY {
  r: number;
  g: number;
  b: number;
  /** master (luminance) component */
  y: number;
}

export interface CurvePoint {
  x: number; // 0..1 input
  y: number; // 0..1 output
}

export interface Curves {
  /** Empty array = identity. Points sorted by x; endpoints implied at (0,0),(1,1) if absent. */
  master: CurvePoint[];
  r: CurvePoint[];
  g: CurvePoint[];
  b: CurvePoint[];
}

/** HSL qualifier (secondary correction): isolate a color range, then adjust it. */
export interface Qualifier {
  enabled: boolean;
  hueCenter: number; // degrees 0..360
  hueWidth: number; // degrees
  satLow: number; // 0..1
  satHigh: number;
  lumLow: number; // 0..1
  lumHigh: number;
  softness: number; // 0..1
  invert: boolean;
  /** Adjustments applied inside the key */
  hueShift: number; // degrees
  saturation: number; // multiplier
  exposure: number; // stops
  /** Show the matte instead of the image (in the viewer only). */
  showMatte: boolean;
}

export interface ColorGrade {
  enabled: boolean;
  inputTransform: InputTransform;
  // --- primaries (scene-linear) ---
  exposure: number; // stops, 0 = none
  temperature: number; // -100..100
  tint: number; // -100..100
  // --- primaries (log grading space) ---
  contrast: number; // 1 = none
  pivot: number; // 0..1 in grading space, default 0.435 (18% grey)
  saturation: number; // 1 = none
  vibrance: number; // -1..1
  highlights: number; // -1..1
  shadows: number; // -1..1
  lift: RGBY; // each -1..1 (0 = none)
  gamma: RGBY;
  gain: RGBY;
  offset: RGBY;
  curves: Curves;
  qualifier: Qualifier;
  lut: { id: string | null; intensity: number };
}

// ---------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------

export type AssetKind = 'video' | 'audio' | 'image';

export interface MediaAsset {
  id: string;
  name: string;
  path: string; // absolute path on disk
  kind: AssetKind;
  binId: string | null;
  duration: number; // seconds; images use settings.stillDuration when placed
  width?: number;
  height?: number;
  fps?: number;
  codec?: string; // e.g. 'avc', 'hevc', 'vp9', 'av1', 'prores', 'pcm-s16'
  audioCodec?: string;
  channels?: number;
  sampleRate?: number;
  size?: number; // bytes
  hasAudio: boolean;
  hasVideo: boolean;
  offline?: boolean;
  /** Decoding of the source's code values; 'auto' → rec709. */
  inputTransform: InputTransform;
  /** Proxy file (lower resolution) for smooth playback; originals are always used for export. */
  proxyPath?: string | null;
  proxyStatus?: 'none' | 'building' | 'ready' | 'failed';
  /** Source-monitor marks */
  markIn?: number | null;
  markOut?: number | null;
  label?: LabelColor;
  rating?: number; // 0..5
  notes?: string;
  importedAt?: number;
}

export interface Bin {
  id: string;
  name: string;
  parentId: string | null;
}

export interface LutRef {
  id: string;
  name: string;
  path: string; // .cube file on disk
}

// ---------------------------------------------------------------------------
// Keyframes
// ---------------------------------------------------------------------------

export type Ease = 'linear' | 'hold' | 'easeIn' | 'easeOut' | 'easeInOut' | 'bezier';

export interface Keyframe {
  /** Seconds from the clip's start (timeline time − clip.start). */
  t: number;
  v: number;
  /** Interpolation from this keyframe to the next one. */
  ease: Ease;
  /** Cubic-bezier control points (x1,y1,x2,y2) when ease === 'bezier'. */
  bez?: [number, number, number, number];
}

/** param path → keyframes sorted by t. See engine/keyframes.ts for paths. */
export type KeyframeMap = Record<string, Keyframe[]>;

// ---------------------------------------------------------------------------
// Clips
// ---------------------------------------------------------------------------

export type LabelColor = 'none' | 'red' | 'orange' | 'yellow' | 'green' | 'teal' | 'blue' | 'violet' | 'pink' | 'grey';

export type BlendMode =
  | 'normal'
  | 'add'
  | 'subtract'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'softLight'
  | 'hardLight'
  | 'darken'
  | 'lighten'
  | 'difference'
  | 'exclusion'
  | 'colorDodge'
  | 'colorBurn';

export type FitMode = 'fit' | 'fill' | 'stretch' | 'none';

export interface Transform {
  /** Offset of the layer center from the frame center, in sequence pixels. */
  x: number;
  y: number;
  /** Uniform scale (1 = as fitted by `fit`). */
  scale: number;
  /** Non-uniform multipliers on top of `scale`. */
  scaleX: number;
  scaleY: number;
  rotation: number; // degrees, clockwise
  /** Anchor point offset from the layer center, in layer pixels. */
  anchorX: number;
  anchorY: number;
  opacity: number; // 0..1
  flipH: boolean;
  flipV: boolean;
  fit: FitMode;
}

export interface Crop {
  /** Fractions of the source size, 0..1 each. */
  left: number;
  top: number;
  right: number;
  bottom: number;
  /** Soft edge, in layer pixels */
  feather: number;
}

export interface Mask {
  id: string;
  name: string;
  shape: 'rect' | 'ellipse';
  /** Center, in layer-normalized coordinates (0..1, 0.5 = middle). */
  x: number;
  y: number;
  /** Size, as a fraction of the layer (0..1+). */
  width: number;
  height: number;
  rotation: number; // degrees
  roundness: number; // 0..1, rect corner radius as fraction of the short side
  feather: number; // layer pixels
  expansion: number; // layer pixels (+ grows, − shrinks)
  opacity: number; // 0..1
  invert: boolean;
  mode: 'add' | 'subtract' | 'intersect';
  enabled: boolean;
}

export interface EffectInstance {
  id: string;
  /** Key into the effect registry (engine/effects/registry.ts). */
  type: string;
  enabled: boolean;
  /** Static param values; numbers are animatable via keyframes `effects.<id>.<key>`. */
  params: Record<string, number | boolean | string>;
}

export interface ClipAudio {
  gain: number; // dB (clip gain)
  pan: number; // -1..1
  mute: boolean;
  fadeIn: number; // seconds
  fadeOut: number;
  /** Which source channels feed the clip. */
  channelMode: 'stereo' | 'left' | 'right' | 'mono' | 'swap';
  eq: {
    enabled: boolean;
    highpass: number; // Hz, 0 = off
    lowGain: number; // dB, low shelf @ lowFreq
    lowFreq: number;
    midGain: number; // dB, peaking @ midFreq
    midFreq: number;
    midQ: number;
    highGain: number; // dB, high shelf @ highFreq
    highFreq: number;
    lowpass: number; // Hz, 0 = off
  };
  comp: {
    enabled: boolean;
    threshold: number; // dBFS
    ratio: number;
    attack: number; // seconds
    release: number;
    knee: number; // dB
    makeup: number; // dB
  };
}

export type TransitionType =
  | 'crossDissolve'
  | 'filmDissolve'
  | 'additiveDissolve'
  | 'dipToBlack'
  | 'dipToWhite'
  | 'wipe'
  | 'slide'
  | 'push'
  | 'zoom'
  | 'blurDissolve'
  | 'iris'
  | 'clockWipe'
  | 'whip'
  | 'glitch'
  | 'lightLeak'
  | 'audioCrossfade'; // audio tracks

export interface Transition {
  type: TransitionType;
  duration: number; // seconds, centered on the cut
  /** Type-specific params, e.g. { angle: 0 } for wipes. */
  params: Record<string, number>;
  ease: Ease;
}

export interface TextAnimation {
  in: 'none' | 'fade' | 'slideUp' | 'slideDown' | 'slideLeft' | 'slideRight' | 'typewriter' | 'pop' | 'blur' | 'wordByWord' | 'tracking';
  out: 'none' | 'fade' | 'slideUp' | 'slideDown' | 'slideLeft' | 'slideRight' | 'pop' | 'blur' | 'tracking';
  inDuration: number; // seconds
  outDuration: number;
}

export interface TextProps {
  content: string;
  font: string; // CSS font family
  weight: number; // 100..900
  italic: boolean;
  size: number; // px at sequence resolution
  color: string; // #rrggbb or #rrggbbaa
  align: 'left' | 'center' | 'right';
  lineHeight: number; // multiplier
  letterSpacing: number; // px
  uppercase: boolean;
  /** Wrap width in px; 0 = no wrapping */
  maxWidth: number;
  stroke: { enabled: boolean; color: string; width: number };
  shadow: { enabled: boolean; color: string; blur: number; x: number; y: number; opacity: number };
  background: { enabled: boolean; color: string; opacity: number; paddingX: number; paddingY: number; radius: number };
  animation: TextAnimation;
}

export interface ShapeProps {
  kind: 'rect' | 'ellipse' | 'line' | 'triangle';
  width: number; // px
  height: number;
  radius: number; // corner radius px (rect)
  fill: { enabled: boolean; color: string };
  stroke: { enabled: boolean; color: string; width: number };
}

export interface GradientProps {
  kind: 'linear' | 'radial';
  angle: number; // degrees (linear)
  stops: { pos: number; color: string }[];
}

export type ClipKind = 'media' | 'text' | 'shape' | 'solid' | 'gradient' | 'adjustment' | 'sequence';

export interface Clip {
  id: string;
  kind: ClipKind;
  name: string;
  /** Position on the timeline (seconds). */
  start: number;
  /** Length on the timeline (seconds). */
  duration: number;
  /** Source time at the clip's first frame (media / nested sequence). */
  inPoint: number;
  assetId?: string; // kind 'media'
  sequenceId?: string; // kind 'sequence' (nested)
  /** Constant speed multiplier (1 = normal). Speed keyframes (path 'time.speed') override it. */
  speed: number;
  reverse: boolean;
  /** Freeze frame: if set, always show this source time. */
  holdFrame: number | null;
  /** Frame blending when the speed is not 1 (preview + export). */
  frameBlend: boolean;
  enabled: boolean;
  /** Clips sharing a linkId move/trim together (A/V from one source). */
  linkId?: string;
  /** Clips sharing a groupId select together. */
  groupId?: string;
  label: LabelColor;
  transform: Transform;
  crop: Crop;
  masks: Mask[];
  blend: BlendMode;
  effects: EffectInstance[];
  grade: ColorGrade;
  audio: ClipAudio;
  /** Video opacity fades (seconds). Audio fades live in `audio`. */
  fadeIn: number;
  fadeOut: number;
  /** Transition at this clip's head (from the previous adjacent clip, or from nothing). */
  transitionIn: Transition | null;
  /** Transition at this clip's tail only when no clip follows (to nothing). */
  transitionOut: Transition | null;
  keyframes: KeyframeMap;
  text?: TextProps; // kind 'text'
  shape?: ShapeProps; // kind 'shape'
  solid?: { color: string }; // kind 'solid'
  gradient?: GradientProps; // kind 'gradient'
  /** Per-format transform overrides for multi-aspect editing (formatId → overrides). */
  formatOverrides?: Record<string, Partial<Pick<Transform, 'x' | 'y' | 'scale'>>>;
  /** Free-form notes / comments. */
  notes?: string;
}

// ---------------------------------------------------------------------------
// Tracks, captions, markers, sequences
// ---------------------------------------------------------------------------

export type TrackKind = 'video' | 'audio' | 'caption';

export interface CaptionCue {
  id: string;
  start: number;
  end: number;
  text: string;
  speaker?: string;
}

export interface CaptionStyle {
  font: string;
  size: number; // px at sequence resolution
  weight: number;
  color: string;
  background: string; // rgba hex, '' = none
  outline: number; // px
  outlineColor: string;
  position: 'bottom' | 'top' | 'middle';
  margin: number; // px from the edge
  maxWidth: number; // fraction of frame width (0..1)
  align: 'left' | 'center' | 'right';
}

export interface Track {
  id: string;
  kind: TrackKind;
  name: string;
  clips: Clip[]; // empty for caption tracks
  cues: CaptionCue[]; // caption tracks only
  captionStyle?: CaptionStyle; // caption tracks only
  /** Video: hidden (eye off). Audio: muted. Caption: not rendered. */
  muted: boolean;
  solo: boolean; // audio
  locked: boolean;
  /** Track targeting for insert/overwrite/paste. */
  targeted: boolean;
  volume: number; // dB, audio track fader
  pan: number; // -1..1
  height: number; // px in the timeline
  color?: LabelColor;
}

export interface Marker {
  id: string;
  time: number;
  duration: number; // 0 = point marker
  label: string;
  note: string;
  color: LabelColor;
  kind: 'marker' | 'chapter' | 'todo';
  done?: boolean; // todo markers
}

export interface SequenceFormat {
  id: string;
  name: string;
  width: number;
  height: number;
}

export interface Sequence {
  id: string;
  name: string;
  width: number;
  height: number;
  fps: number;
  dropFrame: boolean;
  sampleRate: 44100 | 48000 | 96000;
  colorSpace: ColorSpace;
  /** Background behind all layers. */
  background: string;
  /** Video tracks first (top of the stack first), then audio, then caption tracks. */
  tracks: Track[];
  markers: Marker[];
  inPoint: number | null;
  outPoint: number | null;
  /** Timecode at time 0, in seconds (e.g. 3600 for 01:00:00:00). */
  startTimecode: number;
  master: { gain: number; limiter: boolean; ceiling: number /* dBTP */ };
  /** Alternate aspect ratios rendered from the same edit (multi-aspect). */
  formats: SequenceFormat[];
  activeFormatId: string | null;
}

// ---------------------------------------------------------------------------
// Project
// ---------------------------------------------------------------------------

export interface ProjectSettings {
  /** Defaults for new sequences */
  width: number;
  height: number;
  fps: number;
  dropFrame: boolean;
  sampleRate: 44100 | 48000 | 96000;
  colorSpace: ColorSpace;
  /** The first sequence adopts the first imported video's size and rate. */
  matchFirstClip: boolean;
  stillDuration: number; // seconds
  defaultTransitionDuration: number; // seconds
}

export interface Project {
  formatVersion: string;
  id: string;
  name: string;
  app: AppKind;
  createdAt: number;
  modifiedAt: number;
  settings: ProjectSettings;
  assets: MediaAsset[];
  bins: Bin[];
  luts: LutRef[];
  sequences: Sequence[];
  activeSequenceId: string;
}

export interface ProjectHandle {
  filePath: string;
  dir: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function newId(prefix = ''): string {
  const rand = crypto.randomUUID().replace(/-/g, '').slice(0, 10);
  return prefix ? `${prefix}_${rand}` : rand;
}

export function sequenceDuration(seq: Sequence): number {
  let end = 0;
  for (const t of seq.tracks) {
    for (const c of t.clips) end = Math.max(end, c.start + c.duration);
    for (const q of t.cues) end = Math.max(end, q.end);
  }
  return end;
}

export function activeSequence(p: Project): Sequence {
  return p.sequences.find((s) => s.id === p.activeSequenceId) ?? p.sequences[0];
}

export function findClip(seq: Sequence, id: string): { clip: Clip; track: Track } | null {
  for (const track of seq.tracks) {
    const clip = track.clips.find((c) => c.id === id);
    if (clip) return { clip, track };
  }
  return null;
}

export function assetOf(p: Project, clip: Clip): MediaAsset | undefined {
  return clip.assetId ? p.assets.find((a) => a.id === clip.assetId) : undefined;
}
