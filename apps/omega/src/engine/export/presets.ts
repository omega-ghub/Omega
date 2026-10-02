// Export presets, built from the platform spec table in
// docs/research/video-specs.md ("Recommended presets for Omega"). The table
// below is plain data (JSON-compatible) so it can be updated without touching
// the logic; `buildPreset` turns a row into ExportSettings.
//
// Differences from the research table, on purpose:
//  - HDR (YouTube 4K HDR) is omitted: a canvas can't produce 10-bit PQ/HLG.
//  - ProRes / DNxHR masters are replaced by high-bitrate HEVC / H.264 in MOV
//    with 24-bit PCM, since WebCodecs can't encode them.
//  - Social rows that say "30/1" export at the sequence's own rate (capped at
//    the platform maximum), as the platforms ask for the native frame rate;
//    converting 24 → 30 would add judder.

import type {
  AudioCodecId,
  CaptionMode,
  Container,
  ExportPreset,
  ExportSettings,
  FpsPolicy,
  HandoffFormat,
  OutputKind,
  PresetGroup,
  PresetLimits,
  ResolutionPolicy,
  VideoCodecId,
} from './types';

/** One row of the platform spec table. */
export interface PresetSpec {
  id: string;
  name: string;
  group: PresetGroup;
  hint: string;
  kind?: OutputKind; // default 'video'
  /** 'fixed' = exactly this size (letterbox when the aspect differs); 'max' = fit inside, never upscale. */
  size?: { width: number; height: number; policy: 'fixed' | 'max' } | 'sequence';
  /** 'source' = sequence rate; a number = fixed output rate. */
  fps?: 'source' | number;
  maxFps?: number;
  allowedFps?: number[];
  container: Container;
  codecs?: VideoCodecId[];
  rateControl?: 'vbr' | 'cbr';
  bitrateKbps?: number;
  bitrateKbpsHfr?: number;
  maxBitrateKbps?: number;
  /** Reference size the bitrate applies to (default: the preset size, else 1920×1080). */
  bitrateRef?: { width: number; height: number };
  keyframeIntervalSec?: number;
  audio?: { codecs: AudioCodecId[]; sampleRate?: 44100 | 48000 | 96000; channels?: 1 | 2; bitrateKbps?: number; loudnessLufs?: number; truePeakDbtp?: number; normalize?: boolean } | null;
  captions?: CaptionMode;
  chapters?: boolean;
  hardLimits?: PresetLimits;
  expectsCodec?: VideoCodecId;
  requiresAudioCodec?: AudioCodecId;
}

const AAC: AudioCodecId[] = ['aac', 'opus'];
const SOCIAL_AUDIO = { codecs: AAC, bitrateKbps: 192, loudnessLufs: -14, truePeakDbtp: -1 };
const YT_AUDIO = { codecs: AAC, bitrateKbps: 384, loudnessLufs: -14, truePeakDbtp: -1 };
const H264: VideoCodecId[] = ['avc', 'hevc', 'av1', 'vp9'];
const GB = 1024 ** 3;
const MB = 1024 ** 2;

export const PRESET_SPECS: PresetSpec[] = [
  // ---------------- Streaming ----------------
  { id: 'yt-1080', name: 'YouTube 1080p', group: 'Streaming', hint: 'H.264 · 16 Mbps (24 at 60 fps) · AAC 384k', size: { width: 1920, height: 1080, policy: 'max' }, fps: 'source', maxFps: 60, container: 'mp4', codecs: H264, rateControl: 'vbr', bitrateKbps: 16000, bitrateKbpsHfr: 24000, keyframeIntervalSec: 0.5, audio: YT_AUDIO, captions: 'srt', chapters: true, hardLimits: { maxDurationSec: 43200, maxBytes: 256 * GB, maxFps: 60 }, expectsCodec: 'avc' },
  { id: 'yt-1440', name: 'YouTube 1440p', group: 'Streaming', hint: 'H.264 · 32 Mbps (48 at 60 fps) · AAC 384k', size: { width: 2560, height: 1440, policy: 'max' }, fps: 'source', maxFps: 60, container: 'mp4', codecs: H264, rateControl: 'vbr', bitrateKbps: 32000, bitrateKbpsHfr: 48000, keyframeIntervalSec: 0.5, audio: YT_AUDIO, captions: 'srt', chapters: true, hardLimits: { maxDurationSec: 43200, maxBytes: 256 * GB, maxFps: 60 } },
  { id: 'yt-4k', name: 'YouTube 4K', group: 'Streaming', hint: 'H.264 60 Mbps or HEVC 45 Mbps · AAC 384k · SDR', size: { width: 3840, height: 2160, policy: 'max' }, fps: 'source', maxFps: 60, container: 'mp4', codecs: ['avc', 'hevc', 'av1', 'vp9'], rateControl: 'vbr', bitrateKbps: 60000, bitrateKbpsHfr: 85000, keyframeIntervalSec: 0.5, audio: YT_AUDIO, captions: 'srt', chapters: true, hardLimits: { maxDurationSec: 43200, maxBytes: 256 * GB, maxFps: 60 } },
  { id: 'vimeo-1080', name: 'Vimeo 1080p', group: 'Streaming', hint: 'H.264 · 20 Mbps · AAC 320k', size: { width: 1920, height: 1080, policy: 'max' }, fps: 'source', container: 'mp4', codecs: H264, rateControl: 'vbr', bitrateKbps: 20000, keyframeIntervalSec: 2, audio: { codecs: AAC, bitrateKbps: 320, loudnessLufs: -14, truePeakDbtp: -1 }, captions: 'vtt' },
  { id: 'vimeo-4k', name: 'Vimeo 4K', group: 'Streaming', hint: 'H.264 or HEVC · 60 Mbps · AAC 320k', size: { width: 3840, height: 2160, policy: 'max' }, fps: 'source', container: 'mp4', codecs: ['avc', 'hevc', 'av1', 'vp9'], rateControl: 'vbr', bitrateKbps: 60000, keyframeIntervalSec: 2, audio: { codecs: AAC, bitrateKbps: 320, loudnessLufs: -14, truePeakDbtp: -1 }, captions: 'vtt' },
  { id: 'spotify-video', name: 'Spotify Video Podcast', group: 'Streaming', hint: 'H.264 · 25 Mbps CBR · key frame every 1 s', size: { width: 1920, height: 1080, policy: 'max' }, fps: 'source', allowedFps: [24, 25, 30, 50, 60], container: 'mp4', codecs: H264, rateControl: 'cbr', bitrateKbps: 25000, keyframeIntervalSec: 1, audio: { codecs: AAC, bitrateKbps: 192, loudnessLufs: -14, truePeakDbtp: -1 }, hardLimits: { maxBytes: 60 * GB }, expectsCodec: 'avc' },
  { id: 'web-vp9', name: 'Web VP9 (WebM)', group: 'Streaming', hint: 'Royalty-free · VP9 8 Mbps · Opus 160k', size: { width: 1920, height: 1080, policy: 'max' }, fps: 'source', container: 'webm', codecs: ['vp9', 'av1', 'vp8'], rateControl: 'vbr', bitrateKbps: 8000, keyframeIntervalSec: 2, audio: { codecs: ['opus'], bitrateKbps: 160, loudnessLufs: -14, truePeakDbtp: -1 }, captions: 'vtt' },
  { id: 'web-av1', name: 'Web AV1 (WebM)', group: 'Streaming', hint: 'Royalty-free · AV1 6 Mbps · Opus 160k', size: { width: 1920, height: 1080, policy: 'max' }, fps: 'source', container: 'webm', codecs: ['av1', 'vp9'], rateControl: 'vbr', bitrateKbps: 6000, keyframeIntervalSec: 2, audio: { codecs: ['opus'], bitrateKbps: 160, loudnessLufs: -14, truePeakDbtp: -1 }, captions: 'vtt' },

  // ---------------- Social ----------------
  { id: 'yt-shorts', name: 'YouTube Shorts', group: 'Social', hint: '1080×1920 · H.264 16 Mbps · up to 3 min', size: { width: 1080, height: 1920, policy: 'fixed' }, fps: 'source', maxFps: 60, container: 'mp4', codecs: H264, rateControl: 'vbr', bitrateKbps: 16000, keyframeIntervalSec: 0.5, audio: YT_AUDIO, captions: 'burnIn', hardLimits: { maxDurationSec: 180, maxFps: 60 }, expectsCodec: 'avc' },
  { id: 'tiktok', name: 'TikTok', group: 'Social', hint: '1080×1920 · H.264 12 Mbps · AAC 192k', size: { width: 1080, height: 1920, policy: 'fixed' }, fps: 'source', maxFps: 60, container: 'mp4', codecs: H264, rateControl: 'vbr', bitrateKbps: 12000, keyframeIntervalSec: 2, audio: SOCIAL_AUDIO, captions: 'burnIn', hardLimits: { maxDurationSec: 600, maxBytes: 10 * GB, maxFps: 60, note: 'In-app uploads are capped much lower (about 287 MB on iOS, 72 MB on Android); the web uploader allows up to 60 min.' }, expectsCodec: 'avc' },
  { id: 'ig-reels', name: 'Instagram Reels', group: 'Social', hint: '1080×1920 · H.264 10 Mbps · up to 3 min', size: { width: 1080, height: 1920, policy: 'fixed' }, fps: 'source', maxFps: 60, container: 'mp4', codecs: H264, rateControl: 'vbr', bitrateKbps: 10000, keyframeIntervalSec: 2, audio: SOCIAL_AUDIO, captions: 'burnIn', hardLimits: { maxDurationSec: 180, maxBytes: 4 * GB, maxFps: 60 }, expectsCodec: 'avc' },
  { id: 'ig-feed-4x5', name: 'Instagram Feed 4:5', group: 'Social', hint: '1080×1350 · H.264 10 Mbps', size: { width: 1080, height: 1350, policy: 'fixed' }, fps: 'source', maxFps: 60, container: 'mp4', codecs: H264, rateControl: 'vbr', bitrateKbps: 10000, keyframeIntervalSec: 2, audio: SOCIAL_AUDIO, captions: 'burnIn', hardLimits: { maxDurationSec: 3600, maxBytes: 4 * GB, maxFps: 60 }, expectsCodec: 'avc' },
  { id: 'ig-story', name: 'Instagram Story', group: 'Social', hint: '1080×1920 · 60 s per card', size: { width: 1080, height: 1920, policy: 'fixed' }, fps: 'source', maxFps: 60, container: 'mp4', codecs: H264, rateControl: 'vbr', bitrateKbps: 10000, keyframeIntervalSec: 2, audio: SOCIAL_AUDIO, captions: 'burnIn', hardLimits: { maxDurationSec: 60, maxBytes: 4 * GB, maxFps: 60, note: 'Longer uploads are split into 60 s cards.' }, expectsCodec: 'avc' },
  { id: 'fb-landscape', name: 'Facebook 1080p', group: 'Social', hint: '1920×1080 · H.264 12 Mbps', size: { width: 1920, height: 1080, policy: 'max' }, fps: 'source', maxFps: 60, container: 'mp4', codecs: H264, rateControl: 'vbr', bitrateKbps: 12000, keyframeIntervalSec: 2, audio: SOCIAL_AUDIO, captions: 'srt', hardLimits: { maxDurationSec: 14400, maxBytes: 10 * GB, maxFps: 60 }, expectsCodec: 'avc' },
  { id: 'fb-feed-4x5', name: 'Facebook Feed 4:5', group: 'Social', hint: '1080×1350 · H.264 10 Mbps', size: { width: 1080, height: 1350, policy: 'fixed' }, fps: 'source', maxFps: 60, container: 'mp4', codecs: H264, rateControl: 'vbr', bitrateKbps: 10000, keyframeIntervalSec: 2, audio: SOCIAL_AUDIO, captions: 'burnIn', hardLimits: { maxDurationSec: 14400, maxBytes: 10 * GB, maxFps: 60 }, expectsCodec: 'avc' },
  { id: 'fb-reels', name: 'Facebook Reels', group: 'Social', hint: '1080×1920 · H.264 10 Mbps', size: { width: 1080, height: 1920, policy: 'fixed' }, fps: 'source', maxFps: 60, container: 'mp4', codecs: H264, rateControl: 'vbr', bitrateKbps: 10000, keyframeIntervalSec: 2, audio: SOCIAL_AUDIO, captions: 'burnIn', hardLimits: { maxBytes: 4 * GB, maxFps: 60 }, expectsCodec: 'avc' },
  { id: 'x-1080', name: 'X Landscape', group: 'Social', hint: '1920×1080 · 15 Mbps (≤25) · 2:20 on free accounts', size: { width: 1920, height: 1080, policy: 'max' }, fps: 'source', maxFps: 60, container: 'mp4', codecs: H264, rateControl: 'vbr', bitrateKbps: 15000, maxBitrateKbps: 25000, keyframeIntervalSec: 2, audio: SOCIAL_AUDIO, captions: 'srt', hardLimits: { maxDurationSec: 140, maxBytes: 512 * MB, maxFps: 60, note: 'Free-account limits; Premium allows hours and several GB.' }, expectsCodec: 'avc' },
  { id: 'x-vertical', name: 'X Vertical', group: 'Social', hint: '1080×1920 · 15 Mbps (≤25)', size: { width: 1080, height: 1920, policy: 'fixed' }, fps: 'source', maxFps: 60, container: 'mp4', codecs: H264, rateControl: 'vbr', bitrateKbps: 15000, maxBitrateKbps: 25000, keyframeIntervalSec: 2, audio: SOCIAL_AUDIO, captions: 'burnIn', hardLimits: { maxDurationSec: 140, maxBytes: 512 * MB, maxFps: 60, note: 'Free-account limits; Premium allows hours and several GB.' }, expectsCodec: 'avc' },
  { id: 'linkedin-1080', name: 'LinkedIn 1080p', group: 'Social', hint: '1920×1080 · 15 Mbps (≤30) · up to 10 min', size: { width: 1920, height: 1080, policy: 'max' }, fps: 'source', maxFps: 60, container: 'mp4', codecs: H264, rateControl: 'vbr', bitrateKbps: 15000, maxBitrateKbps: 30000, keyframeIntervalSec: 2, audio: SOCIAL_AUDIO, captions: 'srt', hardLimits: { maxDurationSec: 600, maxBytes: 5 * GB, maxFps: 60 }, expectsCodec: 'avc' },
  { id: 'linkedin-square', name: 'LinkedIn Square', group: 'Social', hint: '1080×1080 · 10 Mbps', size: { width: 1080, height: 1080, policy: 'fixed' }, fps: 'source', maxFps: 60, container: 'mp4', codecs: H264, rateControl: 'vbr', bitrateKbps: 10000, maxBitrateKbps: 30000, keyframeIntervalSec: 2, audio: SOCIAL_AUDIO, captions: 'burnIn', hardLimits: { maxDurationSec: 600, maxBytes: 5 * GB, maxFps: 60 }, expectsCodec: 'avc' },
  { id: 'snapchat', name: 'Snapchat Spotlight', group: 'Social', hint: '1080×1920 · 8 Mbps · up to 60 s', size: { width: 1080, height: 1920, policy: 'fixed' }, fps: 'source', maxFps: 60, container: 'mp4', codecs: H264, rateControl: 'vbr', bitrateKbps: 8000, keyframeIntervalSec: 2, audio: SOCIAL_AUDIO, captions: 'burnIn', hardLimits: { maxDurationSec: 60, maxBytes: 1 * GB }, expectsCodec: 'avc' },

  // ---------------- Master & broadcast ----------------
  { id: 'master-hevc', name: 'Master HEVC', group: 'Master', hint: 'Sequence size · HEVC ~45 Mbps per 1080p · 24-bit PCM · MOV', size: 'sequence', fps: 'source', container: 'mov', codecs: ['hevc', 'avc'], rateControl: 'vbr', bitrateKbps: 60000, bitrateKbpsHfr: 90000, maxBitrateKbps: 160000, keyframeIntervalSec: 1, audio: { codecs: ['pcm-s24'], loudnessLufs: -14, truePeakDbtp: -1 } },
  { id: 'master-avc', name: 'Master H.264', group: 'Master', hint: 'Sequence size · H.264 ~60 Mbps per 1080p · 24-bit PCM · MOV', size: 'sequence', fps: 'source', container: 'mov', codecs: ['avc', 'hevc'], rateControl: 'vbr', bitrateKbps: 60000, bitrateKbpsHfr: 90000, maxBitrateKbps: 160000, keyframeIntervalSec: 1, audio: { codecs: ['pcm-s24'], loudnessLufs: -14, truePeakDbtp: -1 } },
  { id: 'broadcast-ebu', name: 'Broadcast EBU R128', group: 'Master', hint: '1080p25 · H.264 50 Mbps · PCM 24-bit · −23 LUFS / −1 dBTP', size: { width: 1920, height: 1080, policy: 'fixed' }, fps: 25, container: 'mov', codecs: ['avc', 'hevc'], rateControl: 'cbr', bitrateKbps: 50000, keyframeIntervalSec: 0.48, audio: { codecs: ['pcm-s24'], loudnessLufs: -23, truePeakDbtp: -1, normalize: true } },
  { id: 'broadcast-atsc', name: 'Broadcast ATSC A/85', group: 'Master', hint: '1080p29.97 · H.264 50 Mbps · PCM 24-bit · −24 LKFS / −2 dBTP', size: { width: 1920, height: 1080, policy: 'fixed' }, fps: 29.97, container: 'mov', codecs: ['avc', 'hevc'], rateControl: 'cbr', bitrateKbps: 50000, keyframeIntervalSec: 0.5, audio: { codecs: ['pcm-s24'], loudnessLufs: -24, truePeakDbtp: -2, normalize: true } },

  // ---------------- Audio only ----------------
  { id: 'audio-wav', name: 'WAV 24-bit 48 kHz', group: 'Audio', hint: 'Uncompressed PCM · mix master', kind: 'audio', container: 'wav', audio: { codecs: ['pcm-s24'], sampleRate: 48000, loudnessLufs: -23, truePeakDbtp: -1 } },
  { id: 'podcast-aac', name: 'Podcast AAC', group: 'Audio', hint: 'AAC 192k · −16 LUFS / −1 dBTP (Apple, Spotify)', kind: 'audio', container: 'm4a', audio: { codecs: AAC, bitrateKbps: 192, loudnessLufs: -16, truePeakDbtp: -1, normalize: true } },
  { id: 'audio-flac', name: 'FLAC Lossless', group: 'Audio', hint: 'Lossless compressed audio', kind: 'audio', container: 'flac', audio: { codecs: ['flac'], loudnessLufs: -14, truePeakDbtp: -1 }, requiresAudioCodec: 'flac' },
  { id: 'audio-opus', name: 'Opus (Ogg)', group: 'Audio', hint: 'Opus 160k · small, high quality', kind: 'audio', container: 'ogg', audio: { codecs: ['opus'], bitrateKbps: 160, loudnessLufs: -14, truePeakDbtp: -1 } },

  // ---------------- Image ----------------
  { id: 'png-sequence', name: 'PNG Sequence', group: 'Image', hint: 'One PNG per frame, in a folder', kind: 'imageSequence', size: 'sequence', fps: 'source', container: 'png', audio: null },
  { id: 'png-still', name: 'Still Frame PNG', group: 'Image', hint: 'The frame at the playhead', kind: 'still', size: 'sequence', container: 'png', audio: null },

  // ---------------- Handoff ----------------
  { id: 'handoff-fcpxml', name: 'Final Cut Pro XML', group: 'Handoff', hint: 'FCPXML 1.11 for Final Cut Pro and Resolve', kind: 'handoff', container: 'fcpxml', audio: null },
  { id: 'handoff-otio', name: 'OpenTimelineIO', group: 'Handoff', hint: '.otio for Resolve, Premiere (via plug-ins), Nuke', kind: 'handoff', container: 'otio', audio: null },
  { id: 'handoff-edl', name: 'EDL (CMX 3600)', group: 'Handoff', hint: 'Edit decision list for conform and online', kind: 'handoff', container: 'edl', audio: null },
  { id: 'handoff-srt', name: 'Captions SRT', group: 'Handoff', hint: 'SubRip captions from the caption tracks', kind: 'handoff', container: 'srt', audio: null },
  { id: 'handoff-vtt', name: 'Captions WebVTT', group: 'Handoff', hint: 'WebVTT captions from the caption tracks', kind: 'handoff', container: 'vtt', audio: null },
  { id: 'handoff-chapters', name: 'YouTube Chapters', group: 'Handoff', hint: 'Chapter list from chapter markers ("00:00 Intro")', kind: 'handoff', container: 'chapters', audio: null },
];

const NO_VIDEO_BITRATE = { kbps: 8000, refWidth: 1920, refHeight: 1080, refCodec: 'avc' as VideoCodecId };

export function buildPreset(spec: PresetSpec): ExportPreset {
  const kind: OutputKind = spec.kind ?? 'video';
  const size = spec.size ?? 'sequence';
  const resolution: ResolutionPolicy = size === 'sequence' ? { mode: 'sequence' } : { mode: size.policy, width: size.width, height: size.height };
  const fps: FpsPolicy =
    typeof spec.fps === 'number' ? { mode: 'fixed', fps: spec.fps } : { mode: 'sequence', ...(spec.maxFps ? { max: spec.maxFps } : {}), ...(spec.allowedFps ? { allowed: spec.allowedFps } : {}) };
  const codecs = spec.codecs ?? ['avc', 'hevc', 'av1', 'vp9'];
  const ref = spec.bitrateRef ?? (size !== 'sequence' ? { width: size.width, height: size.height } : { width: 1920, height: 1080 });
  const audio = spec.audio;
  const settings: ExportSettings = {
    kind,
    container: spec.container,
    video: {
      codecs,
      resolution,
      fps,
      bitrateMode: spec.rateControl ?? 'vbr',
      bitrate: spec.bitrateKbps
        ? { kbps: spec.bitrateKbps, ...(spec.bitrateKbpsHfr ? { hfrKbps: spec.bitrateKbpsHfr } : {}), refWidth: ref.width, refHeight: ref.height, refCodec: codecs[0], ...(spec.maxBitrateKbps ? { maxKbps: spec.maxBitrateKbps } : {}) }
        : NO_VIDEO_BITRATE,
      bitrateKbps: null,
      keyframeInterval: spec.keyframeIntervalSec ?? 2,
    },
    audio: {
      enabled: !!audio,
      codecs: audio?.codecs ?? ['aac', 'opus'],
      bitrateKbps: audio?.bitrateKbps ?? 192,
      sampleRate: audio?.sampleRate ?? 48000,
      channels: audio?.channels ?? 2,
    },
    loudness: { normalize: audio?.normalize ?? false, targetLufs: audio?.loudnessLufs ?? -14, truePeakDbtp: audio?.truePeakDbtp ?? -1 },
    captions: spec.captions ?? 'none',
    chapters: spec.chapters ?? false,
  };
  return {
    id: spec.id,
    name: spec.name,
    group: spec.group,
    hint: spec.hint,
    settings,
    ...(spec.hardLimits ? { limits: spec.hardLimits } : {}),
    ...(spec.expectsCodec ? { expectsCodec: spec.expectsCodec } : {}),
    ...(spec.requiresAudioCodec ? { requiresAudioCodec: spec.requiresAudioCodec } : {}),
  };
}

export const BUILTIN_PRESETS: ExportPreset[] = PRESET_SPECS.map(buildPreset);

export const DEFAULT_PRESET_ID = 'yt-1080';

export const PRESET_GROUPS: PresetGroup[] = ['Social', 'Streaming', 'Master', 'Audio', 'Image', 'Handoff', 'Custom'];

export function findPreset(id: string, custom: ExportPreset[] = []): ExportPreset | undefined {
  return BUILTIN_PRESETS.find((p) => p.id === id) ?? custom.find((p) => p.id === id);
}

export function handoffFormat(settings: Pick<ExportSettings, 'kind' | 'container'>): HandoffFormat | null {
  return settings.kind === 'handoff' ? (settings.container as HandoffFormat) : null;
}

/** Deep copy of settings (presets are shared; edits must not leak into them). */
export function cloneSettings(s: ExportSettings): ExportSettings {
  return JSON.parse(JSON.stringify(s)) as ExportSettings;
}

/** Case-insensitive search over name, hint and group. */
export function searchPresets(presets: ExportPreset[], query: string): ExportPreset[] {
  const q = query.trim().toLowerCase();
  if (!q) return presets;
  const words = q.split(/\s+/);
  return presets.filter((p) => {
    const hay = `${p.name} ${p.hint} ${p.group} ${p.settings.container}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

// ---------------------------------------------------------------------------
// Container capabilities (used by the settings form and preflight)
// ---------------------------------------------------------------------------

export const VIDEO_CONTAINERS: { id: Container; label: string }[] = [
  { id: 'mp4', label: 'MP4' },
  { id: 'mov', label: 'QuickTime MOV' },
  { id: 'webm', label: 'WebM' },
  { id: 'mkv', label: 'Matroska MKV' },
];

export const AUDIO_CONTAINERS: { id: Container; label: string }[] = [
  { id: 'wav', label: 'WAV' },
  { id: 'flac', label: 'FLAC' },
  { id: 'm4a', label: 'M4A (AAC)' },
  { id: 'ogg', label: 'Ogg' },
];

/** Codecs each container can hold (a subset of what Mediabunny's muxers accept). */
export const CONTAINER_VIDEO_CODECS: Partial<Record<Container, VideoCodecId[]>> = {
  mp4: ['avc', 'hevc', 'av1', 'vp9'],
  mov: ['avc', 'hevc', 'av1', 'vp9'],
  webm: ['vp9', 'av1', 'vp8'],
  mkv: ['avc', 'hevc', 'vp9', 'av1', 'vp8'],
};

export const CONTAINER_AUDIO_CODECS: Partial<Record<Container, AudioCodecId[]>> = {
  mp4: ['aac', 'opus', 'flac'],
  mov: ['pcm-s24', 'pcm-s16', 'pcm-f32', 'aac', 'opus'],
  webm: ['opus', 'vorbis'],
  mkv: ['opus', 'aac', 'flac', 'pcm-s24', 'pcm-s16'],
  wav: ['pcm-s24', 'pcm-s16', 'pcm-f32'],
  flac: ['flac'],
  m4a: ['aac', 'opus'],
  ogg: ['opus', 'vorbis', 'flac'],
};

export const VIDEO_CODEC_LABEL: Record<VideoCodecId, string> = { avc: 'H.264 (AVC)', hevc: 'H.265 (HEVC)', vp9: 'VP9', av1: 'AV1', vp8: 'VP8' };
export const AUDIO_CODEC_LABEL: Record<AudioCodecId, string> = {
  aac: 'AAC',
  opus: 'Opus',
  flac: 'FLAC',
  vorbis: 'Vorbis',
  'pcm-s16': 'PCM 16-bit',
  'pcm-s24': 'PCM 24-bit',
  'pcm-f32': 'PCM 32-bit float',
};

/** Keeps the preference order but drops codecs the container can't hold; puts `first` in front. */
export function codecsForContainer<T extends string>(prefs: T[], allowed: T[] | undefined, first?: T | null): T[] {
  const ok = (allowed ?? prefs) as T[];
  const list = prefs.filter((c) => ok.includes(c));
  for (const c of ok) if (!list.includes(c)) list.push(c);
  if (first && list.includes(first)) return [first, ...list.filter((c) => c !== first)];
  return list;
}
