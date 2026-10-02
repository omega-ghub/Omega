// What an export range actually uses: media (with offline status), LUTs,
// audio, captions and chapters, following nested sequences. Pure; drives
// preflight and the Deliver summary.

import { sourceTimeAt } from '../time';
import type { Clip, LutRef, MediaAsset, Project, Sequence } from '../../state/types';
import type { TimeRange } from './types';

export interface RangeUsage {
  /** Assets whose pictures are needed (visible video tracks). */
  videoAssets: MediaAsset[];
  /** Assets whose sound is needed (unmuted audio tracks). */
  audioAssets: MediaAsset[];
  /** Used assets that are offline. */
  offline: MediaAsset[];
  /** Clips pointing at an asset that no longer exists in the project. */
  missingAssetClips: string[];
  /** LUT ids referenced by enabled grades. */
  luts: { id: string; ref: LutRef | null; clipName: string }[];
  hasAudio: boolean;
  /** Caption cues overlapping the range (non-muted caption tracks of the top sequence). */
  captionCues: number;
  captionTracks: number;
  chapterMarkers: number;
}

const MAX_DEPTH = 8;

function overlaps(clip: Clip, a: number, b: number): boolean {
  return clip.enabled && clip.start < b && clip.start + clip.duration > a;
}

export function rangeUsage(project: Project, sequenceId: string, range: TimeRange): RangeUsage {
  const video = new Map<string, MediaAsset>();
  const audio = new Map<string, MediaAsset>();
  const missing: string[] = [];
  const luts = new Map<string, { id: string; ref: LutRef | null; clipName: string }>();
  let hasAudio = false;

  const visit = (seq: Sequence, a: number, b: number, depth: number, audible: boolean, visible: boolean) => {
    if (depth > MAX_DEPTH) return;
    for (const track of seq.tracks) {
      if (track.kind === 'caption') continue;
      const isVideo = track.kind === 'video';
      const trackVisible = visible && isVideo && !track.muted;
      const trackAudible = audible && !isVideo && !track.muted;
      if (!trackVisible && !trackAudible) continue;
      for (const clip of track.clips) {
        if (!overlaps(clip, a, b)) continue;
        if (trackVisible && clip.grade.enabled && clip.grade.lut.id && clip.grade.lut.intensity > 0 && !luts.has(clip.grade.lut.id)) {
          luts.set(clip.grade.lut.id, { id: clip.grade.lut.id, ref: project.luts.find((l) => l.id === clip.grade.lut.id) ?? null, clipName: clip.name });
        }
        if (clip.kind === 'media') {
          const asset = project.assets.find((x) => x.id === clip.assetId);
          if (!asset) {
            missing.push(clip.name);
            continue;
          }
          if (trackVisible && asset.hasVideo) video.set(asset.id, asset);
          if (trackAudible && asset.hasAudio && !clip.audio.mute) {
            audio.set(asset.id, asset);
            hasAudio = true;
          }
        } else if (clip.kind === 'sequence') {
          const nested = project.sequences.find((s) => s.id === clip.sequenceId);
          if (!nested || nested.id === seq.id) continue;
          // map the overlapping part of the clip into nested time
          const la = Math.max(a, clip.start) - clip.start;
          const lb = Math.min(b, clip.start + clip.duration) - clip.start;
          const s1 = sourceTimeAt(clip, la);
          const s2 = sourceTimeAt(clip, lb);
          visit(nested, Math.min(s1, s2), Math.max(s1, s2) + 1e-6, depth + 1, trackAudible, trackVisible);
        }
      }
    }
  };

  const seq = project.sequences.find((s) => s.id === sequenceId);
  if (!seq) throw new Error('The sequence to export no longer exists.');
  visit(seq, range.start, range.end, 0, true, true);

  let captionCues = 0;
  let captionTracks = 0;
  for (const t of seq.tracks) {
    if (t.kind !== 'caption' || t.muted) continue;
    const n = t.cues.filter((c) => c.end > range.start && c.start < range.end).length;
    if (n) captionTracks++;
    captionCues += n;
  }
  const chapterMarkers = seq.markers.filter((m) => m.kind === 'chapter' && m.time >= range.start - 1e-6 && m.time < range.end).length;
  const all = new Map([...video, ...audio]);
  return {
    videoAssets: [...video.values()],
    audioAssets: [...audio.values()],
    offline: [...all.values()].filter((x) => x.offline),
    missingAssetClips: missing,
    luts: [...luts.values()],
    hasAudio,
    captionCues,
    captionTracks,
    chapterMarkers,
  };
}

/**
 * The sequence as seen from a range: cues and chapter markers shifted so the
 * range starts at 0 and clipped to it (for caption and chapter sidecars).
 */
export function shiftedSequence(seq: Sequence, range: TimeRange): Sequence {
  const d = range.end - range.start;
  return {
    ...seq,
    tracks: seq.tracks.map((t) =>
      t.kind !== 'caption'
        ? t
        : {
            ...t,
            cues: t.cues
              .filter((c) => c.end > range.start && c.start < range.end)
              .map((c) => ({ ...c, start: Math.max(0, c.start - range.start), end: Math.min(d, c.end - range.start) })),
          },
    ),
    markers: seq.markers.filter((m) => m.time >= range.start - 1e-6 && m.time < range.end).map((m) => ({ ...m, time: Math.max(0, m.time - range.start) })),
    inPoint: null,
    outPoint: null,
  };
}
