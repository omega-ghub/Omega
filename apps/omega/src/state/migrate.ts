// Upgrades older project documents to the current model. Each step is pure
// and idempotent; unknown future versions are opened read-only by callers.

import { defaultCaptionStyle, defaultClipAudio, defaultCrop, defaultGrade, defaultTransform, makeClip, makeSequence, makeTrack } from './defaults';
import type { Clip, MediaAsset, Project, Sequence, Track } from './types';
import { FORMAT_VERSION } from './types';

// v1 shapes (0.1.0-json)
interface V1Clip {
  id: string;
  assetId: string;
  name: string;
  start: number;
  duration: number;
  inPoint: number;
  linkId?: string;
  gain?: number;
  opacity?: number;
}
interface V1Track {
  id: string;
  kind: 'video' | 'audio';
  name: string;
  clips: V1Clip[];
  muted: boolean;
  locked: boolean;
}
interface V1Project {
  formatVersion: string;
  id: string;
  name: string;
  app: Project['app'];
  createdAt: number;
  modifiedAt: number;
  settings: { width: number; height: number; fps: number; dropFrame: boolean; sampleRate: 44100 | 48000 | 96000; colorSpace: Project['settings']['colorSpace']; matchFirstClip: boolean };
  assets: Omit<MediaAsset, 'binId' | 'inputTransform'>[];
  sequence: { id: string; name: string; tracks: V1Track[]; markers: { id: string; time: number; label: string; color: string }[] };
}

export function isV1(doc: unknown): doc is V1Project {
  return !!doc && typeof doc === 'object' && 'sequence' in doc && !('sequences' in doc);
}

export function migrateProject(doc: unknown): Project {
  if (isV1(doc)) return fromV1(doc);
  const p = doc as Project;
  if (!p || !Array.isArray(p.sequences)) throw new Error('This file is not an Omega project.');
  return normalize(p);
}

function fromV1(v1: V1Project): Project {
  const settings = {
    width: v1.settings.width,
    height: v1.settings.height,
    fps: v1.settings.fps,
    dropFrame: v1.settings.dropFrame,
    sampleRate: v1.settings.sampleRate,
    colorSpace: v1.settings.colorSpace,
    matchFirstClip: v1.settings.matchFirstClip,
    stillDuration: 5,
    defaultTransitionDuration: 1,
  };
  const seq = makeSequence(settings, v1.sequence.name);
  seq.id = v1.sequence.id;
  seq.tracks = v1.sequence.tracks.map((t) => {
    const track = makeTrack(t.kind, t.name);
    track.id = t.id;
    track.muted = t.muted;
    track.locked = t.locked;
    track.clips = t.clips.map((c) =>
      makeClip('media', {
        id: c.id,
        name: c.name,
        assetId: c.assetId,
        start: c.start,
        duration: c.duration,
        inPoint: c.inPoint,
        linkId: c.linkId,
        transform: { ...defaultTransform(), opacity: c.opacity ?? 1 },
        audio: { ...defaultClipAudio(), gain: c.gain ?? 0 },
      }),
    );
    return track;
  });
  seq.markers = v1.sequence.markers.map((m) => ({ id: m.id, time: m.time, duration: 0, label: m.label, note: '', color: 'teal', kind: 'marker' }));
  return normalize({
    formatVersion: FORMAT_VERSION,
    id: v1.id,
    name: v1.name,
    app: v1.app,
    createdAt: v1.createdAt,
    modifiedAt: v1.modifiedAt,
    settings,
    assets: v1.assets.map((a) => ({ ...a, binId: null, inputTransform: 'auto' })) as MediaAsset[],
    bins: [],
    luts: [],
    sequences: [seq],
    activeSequenceId: seq.id,
  });
}

/** Fill any missing fields (documents written by older 0.2 builds). */
function normalize(p: Project): Project {
  p.formatVersion = FORMAT_VERSION;
  p.bins ??= [];
  p.luts ??= [];
  p.settings.stillDuration ??= 5;
  p.settings.defaultTransitionDuration ??= 1;
  for (const a of p.assets) {
    a.binId ??= null;
    a.inputTransform ??= 'auto';
  }
  for (const s of p.sequences) normalizeSequence(s);
  if (!p.sequences.some((s) => s.id === p.activeSequenceId)) p.activeSequenceId = p.sequences[0]?.id;
  return p;
}

function normalizeSequence(s: Sequence) {
  s.markers ??= [];
  s.formats ??= [];
  s.activeFormatId ??= null;
  s.inPoint ??= null;
  s.outPoint ??= null;
  s.startTimecode ??= 0;
  s.background ??= '#000000';
  s.master ??= { gain: 0, limiter: true, ceiling: -1 };
  for (const t of s.tracks) normalizeTrack(t);
}

function normalizeTrack(t: Track) {
  t.cues ??= [];
  t.clips ??= [];
  t.solo ??= false;
  t.targeted ??= true;
  t.volume ??= 0;
  t.pan ??= 0;
  t.height ??= t.kind === 'video' ? 64 : t.kind === 'audio' ? 52 : 36;
  if (t.kind === 'caption') t.captionStyle ??= defaultCaptionStyle();
  for (const c of t.clips) normalizeClip(c);
}

function normalizeClip(c: Clip) {
  c.kind ??= 'media';
  c.speed ??= 1;
  c.reverse ??= false;
  c.holdFrame ??= null;
  c.frameBlend ??= false;
  c.enabled ??= true;
  c.label ??= 'none';
  c.transform = { ...defaultTransform(), ...(c.transform ?? {}) };
  c.crop = { ...defaultCrop(), ...(c.crop ?? {}) };
  c.masks ??= [];
  c.blend ??= 'normal';
  c.effects ??= [];
  const g = defaultGrade();
  c.grade = { ...g, ...(c.grade ?? {}), qualifier: { ...g.qualifier, ...(c.grade?.qualifier ?? {}) }, curves: { ...g.curves, ...(c.grade?.curves ?? {}) } };
  const a = defaultClipAudio();
  c.audio = { ...a, ...(c.audio ?? {}), eq: { ...a.eq, ...(c.audio?.eq ?? {}) }, comp: { ...a.comp, ...(c.audio?.comp ?? {}) } };
  c.fadeIn ??= 0;
  c.fadeOut ??= 0;
  c.transitionIn ??= null;
  c.transitionOut ??= null;
  c.keyframes ??= {};
}
