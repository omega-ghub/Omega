// Factories for every document object. Always create model objects through
// these so new fields get sane defaults everywhere.

import type {
  CaptionStyle,
  Clip,
  ClipAudio,
  ClipKind,
  ColorGrade,
  Crop,
  Marker,
  Mask,
  MediaAsset,
  ProjectSettings,
  Qualifier,
  RGBY,
  Sequence,
  ShapeProps,
  TextProps,
  Track,
  TrackKind,
  Transform,
  Transition,
  TransitionType,
} from './types';
import { newId } from './types';

export const rgby = (v = 0): RGBY => ({ r: v, g: v, b: v, y: v });

export function defaultTransform(): Transform {
  return { x: 0, y: 0, scale: 1, scaleX: 1, scaleY: 1, rotation: 0, anchorX: 0, anchorY: 0, opacity: 1, flipH: false, flipV: false, fit: 'fit' };
}

export function defaultCrop(): Crop {
  return { left: 0, top: 0, right: 0, bottom: 0, feather: 0 };
}

export function defaultQualifier(): Qualifier {
  return {
    enabled: false,
    hueCenter: 30,
    hueWidth: 40,
    satLow: 0.15,
    satHigh: 1,
    lumLow: 0.05,
    lumHigh: 0.95,
    softness: 0.2,
    invert: false,
    hueShift: 0,
    saturation: 1,
    exposure: 0,
    showMatte: false,
  };
}

export function defaultGrade(): ColorGrade {
  return {
    enabled: true,
    inputTransform: 'auto',
    exposure: 0,
    temperature: 0,
    tint: 0,
    contrast: 1,
    pivot: 0.435,
    saturation: 1,
    vibrance: 0,
    highlights: 0,
    shadows: 0,
    lift: rgby(),
    gamma: rgby(),
    gain: rgby(),
    offset: rgby(),
    curves: { master: [], r: [], g: [], b: [] },
    qualifier: defaultQualifier(),
    lut: { id: null, intensity: 1 },
  };
}

export function isGradeIdentity(g: ColorGrade): boolean {
  const zero = (c: RGBY) => c.r === 0 && c.g === 0 && c.b === 0 && c.y === 0;
  return (
    !g.enabled ||
    (g.exposure === 0 &&
      g.temperature === 0 &&
      g.tint === 0 &&
      g.contrast === 1 &&
      g.saturation === 1 &&
      g.vibrance === 0 &&
      g.highlights === 0 &&
      g.shadows === 0 &&
      zero(g.lift) &&
      zero(g.gamma) &&
      zero(g.gain) &&
      zero(g.offset) &&
      !g.curves.master.length &&
      !g.curves.r.length &&
      !g.curves.g.length &&
      !g.curves.b.length &&
      !g.qualifier.enabled &&
      !g.lut.id)
  );
}

export function defaultClipAudio(): ClipAudio {
  return {
    gain: 0,
    pan: 0,
    mute: false,
    fadeIn: 0,
    fadeOut: 0,
    channelMode: 'stereo',
    eq: { enabled: false, highpass: 0, lowGain: 0, lowFreq: 120, midGain: 0, midFreq: 1500, midQ: 1, highGain: 0, highFreq: 8000, lowpass: 0 },
    comp: { enabled: false, threshold: -18, ratio: 3, attack: 0.01, release: 0.15, knee: 6, makeup: 0 },
  };
}

export function defaultTextProps(content = 'Title'): TextProps {
  return {
    content,
    font: 'Inter Variable, Inter, system-ui, sans-serif',
    weight: 600,
    italic: false,
    size: 96,
    color: '#ffffff',
    align: 'center',
    lineHeight: 1.15,
    letterSpacing: 0,
    uppercase: false,
    maxWidth: 0,
    stroke: { enabled: false, color: '#000000', width: 4 },
    shadow: { enabled: false, color: '#000000', blur: 24, x: 0, y: 8, opacity: 0.5 },
    background: { enabled: false, color: '#000000', opacity: 0.6, paddingX: 32, paddingY: 16, radius: 12 },
    animation: { in: 'none', out: 'none', inDuration: 0.5, outDuration: 0.5 },
  };
}

export function defaultShapeProps(): ShapeProps {
  return { kind: 'rect', width: 600, height: 340, radius: 24, fill: { enabled: true, color: '#ffffff' }, stroke: { enabled: false, color: '#000000', width: 6 } };
}

export function defaultCaptionStyle(): CaptionStyle {
  return {
    font: 'Inter Variable, Inter, system-ui, sans-serif',
    size: 44,
    weight: 600,
    color: '#ffffff',
    background: '#000000a6',
    outline: 0,
    outlineColor: '#000000',
    position: 'bottom',
    margin: 64,
    maxWidth: 0.8,
    align: 'center',
  };
}

export function makeMask(shape: Mask['shape'] = 'ellipse'): Mask {
  return {
    id: newId('mask'),
    name: shape === 'ellipse' ? 'Ellipse mask' : 'Rectangle mask',
    shape,
    x: 0.5,
    y: 0.5,
    width: 0.5,
    height: 0.5,
    rotation: 0,
    roundness: 0,
    feather: 40,
    expansion: 0,
    opacity: 1,
    invert: false,
    mode: 'add',
    enabled: true,
  };
}

export function makeTransition(type: TransitionType = 'crossDissolve', duration = 1): Transition {
  return { type, duration, params: {}, ease: 'linear' };
}

export function makeClip(kind: ClipKind, init: Partial<Clip> & Pick<Clip, 'start' | 'duration'>): Clip {
  const base: Clip = {
    id: newId('clip'),
    kind,
    name: kind === 'media' ? 'Clip' : kind[0].toUpperCase() + kind.slice(1),
    start: 0,
    duration: 5,
    inPoint: 0,
    speed: 1,
    reverse: false,
    holdFrame: null,
    frameBlend: false,
    enabled: true,
    label: 'none',
    transform: defaultTransform(),
    crop: defaultCrop(),
    masks: [],
    blend: 'normal',
    effects: [],
    grade: defaultGrade(),
    audio: defaultClipAudio(),
    fadeIn: 0,
    fadeOut: 0,
    transitionIn: null,
    transitionOut: null,
    keyframes: {},
  };
  const clip = { ...base, ...init };
  if (kind === 'text' && !clip.text) clip.text = defaultTextProps();
  if (kind === 'shape' && !clip.shape) clip.shape = defaultShapeProps();
  if (kind === 'solid' && !clip.solid) clip.solid = { color: '#101014' };
  if (kind === 'gradient' && !clip.gradient)
    clip.gradient = { kind: 'linear', angle: 90, stops: [{ pos: 0, color: '#ff0040' }, { pos: 1, color: '#2a0010' }] };
  return clip;
}

export function makeTrack(kind: TrackKind, name: string): Track {
  return {
    id: newId(kind[0]),
    kind,
    name,
    clips: [],
    cues: [],
    captionStyle: kind === 'caption' ? defaultCaptionStyle() : undefined,
    muted: false,
    solo: false,
    locked: false,
    targeted: true,
    volume: 0,
    pan: 0,
    height: kind === 'video' ? 64 : kind === 'audio' ? 52 : 36,
  };
}

export function makeSequence(settings: Pick<ProjectSettings, 'width' | 'height' | 'fps' | 'dropFrame' | 'sampleRate' | 'colorSpace'>, name = 'Sequence 1'): Sequence {
  return {
    id: newId('seq'),
    name,
    width: settings.width,
    height: settings.height,
    fps: settings.fps,
    dropFrame: settings.dropFrame,
    sampleRate: settings.sampleRate,
    colorSpace: settings.colorSpace,
    background: '#000000',
    tracks: [makeTrack('video', 'V3'), makeTrack('video', 'V2'), makeTrack('video', 'V1'), makeTrack('audio', 'A1'), makeTrack('audio', 'A2'), makeTrack('audio', 'A3')],
    markers: [],
    inPoint: null,
    outPoint: null,
    startTimecode: 0,
    master: { gain: 0, limiter: true, ceiling: -1 },
    formats: [],
    activeFormatId: null,
  };
}

export function makeMarker(time: number, init: Partial<Marker> = {}): Marker {
  return { id: newId('mk'), time, duration: 0, label: '', note: '', color: 'teal', kind: 'marker', ...init };
}

export function makeAsset(init: Partial<MediaAsset> & Pick<MediaAsset, 'name' | 'path' | 'kind' | 'duration' | 'hasAudio' | 'hasVideo'>): MediaAsset {
  return { id: newId('asset'), binId: null, inputTransform: 'auto', proxyStatus: 'none', label: 'none', importedAt: Date.now(), ...init };
}

export const LABEL_COLORS: Record<string, string> = {
  none: '#5b6170',
  red: '#e5484d',
  orange: '#f76b15',
  yellow: '#ffc53d',
  green: '#30a46c',
  teal: '#12a594',
  blue: '#3e63dd',
  violet: '#8e4ec6',
  pink: '#d6409f',
  grey: '#8b8d98',
};
