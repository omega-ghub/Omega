import type { AppKind } from '../brand/themes';

// Project document model (v0, JSON). ADR-0002 describes the eventual zip
// container; this JSON body is what will live inside it as graph.json.

export const FORMAT_VERSION = '0.1.0-json';

export type ColorSpace = 'rec709' | 'srgb' | 'p3' | 'rec2020-hlg' | 'rec2020-pq';

export interface ProjectSettings {
  width: number;
  height: number;
  fps: number; // 23.976, 24, 25, 29.97, 30, 50, 59.94, 60, 120
  dropFrame: boolean;
  sampleRate: 44100 | 48000 | 96000;
  colorSpace: ColorSpace;
  /** 'auto' means the sequence adopts the settings of the first clip imported. */
  matchFirstClip: boolean;
}

export type AssetKind = 'video' | 'audio' | 'image';

export interface MediaAsset {
  id: string;
  name: string;
  path: string; // absolute path on disk
  kind: AssetKind;
  duration: number; // seconds; images use a default still duration
  width?: number;
  height?: number;
  fps?: number;
  hasAudio: boolean;
  hasVideo: boolean;
  offline?: boolean;
}

export interface Clip {
  id: string;
  assetId: string;
  name: string;
  start: number; // position on the timeline, seconds
  duration: number; // seconds
  inPoint: number; // offset into the source, seconds
  /** For video clips linked to an audio clip (and vice versa). */
  linkId?: string;
  gain?: number; // dB, audio clips
  opacity?: number; // 0..1, video clips
}

export type TrackKind = 'video' | 'audio';

export interface Track {
  id: string;
  kind: TrackKind;
  name: string;
  clips: Clip[];
  muted: boolean;
  locked: boolean;
}

export interface Marker {
  id: string;
  time: number;
  label: string;
  color: string;
}

export interface Sequence {
  id: string;
  name: string;
  tracks: Track[]; // video tracks first (top of the stack first), then audio
  markers: Marker[];
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
  sequence: Sequence;
}

export interface ProjectHandle {
  filePath: string;
  dir: string;
}

export function newId(prefix = ''): string {
  const rand = crypto.randomUUID().slice(0, 8);
  return prefix ? `${prefix}_${rand}` : rand;
}

export function sequenceDuration(seq: Sequence): number {
  let end = 0;
  for (const t of seq.tracks) for (const c of t.clips) end = Math.max(end, c.start + c.duration);
  return end;
}
