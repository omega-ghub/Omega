// Types shared by the export engine (presets, pipeline, queue) and the
// Deliver workspace. OWNED BY THE DELIVER PACKAGE. Pure: no DOM, no Mediabunny.

/** Mediabunny's codec ids (kept as string unions so this file stays dependency-free). */
export type VideoCodecId = 'avc' | 'hevc' | 'vp9' | 'av1' | 'vp8';
export type AudioCodecId = 'aac' | 'opus' | 'flac' | 'vorbis' | 'pcm-s16' | 'pcm-s24' | 'pcm-f32';

export type OutputKind = 'video' | 'audio' | 'imageSequence' | 'still' | 'handoff';

export type VideoContainer = 'mp4' | 'mov' | 'webm' | 'mkv';
export type AudioContainer = 'wav' | 'flac' | 'm4a' | 'ogg';
export type HandoffFormat = 'edl' | 'otio' | 'fcpxml' | 'srt' | 'vtt' | 'chapters';
export type Container = VideoContainer | AudioContainer | 'png' | HandoffFormat;

export type PresetGroup = 'Social' | 'Streaming' | 'Master' | 'Audio' | 'Image' | 'Handoff' | 'Custom';

/**
 * How the output frame size is derived from the sequence (or the chosen
 * multi-aspect format):
 *  - sequence: same size, optionally scaled by `scale` percent.
 *  - fixed:    exactly width×height; a different aspect is letterboxed.
 *  - max:      the sequence size, scaled down (never up) to fit inside width×height.
 */
export type ResolutionPolicy =
  | { mode: 'sequence'; scale?: number }
  | { mode: 'fixed'; width: number; height: number }
  | { mode: 'max'; width: number; height: number };

/**
 * Output frame rate: the sequence's rate (optionally capped at `max`, or
 * snapped to one of `allowed` when it is far from all of them), or a fixed
 * override (the timeline is sampled at the output frame times).
 */
export type FpsPolicy = { mode: 'sequence'; max?: number; allowed?: number[] } | { mode: 'fixed'; fps: number };

/**
 * Video bitrate rule. `kbps` is the target at the reference size and codec at
 * up to 30 fps; `hfrKbps` above 30 fps (default kbps × 1.5). Other sizes scale
 * by pixel count and other codecs by their relative efficiency.
 */
export interface BitrateRule {
  kbps: number;
  hfrKbps?: number;
  refWidth: number;
  refHeight: number;
  refCodec: VideoCodecId;
  minKbps?: number;
  maxKbps?: number;
}

export type CaptionMode = 'none' | 'burnIn' | 'srt' | 'vtt';

export interface VideoSettings {
  /** Preference order; the first one this machine can encode at the output size wins. */
  codecs: VideoCodecId[];
  resolution: ResolutionPolicy;
  fps: FpsPolicy;
  bitrateMode: 'vbr' | 'cbr';
  bitrate: BitrateRule;
  /** Manual override of the computed bitrate (null = automatic). */
  bitrateKbps: number | null;
  /** Seconds between key frames. */
  keyframeInterval: number;
}

export interface AudioSettings {
  enabled: boolean;
  codecs: AudioCodecId[];
  bitrateKbps: number;
  sampleRate: 44100 | 48000 | 96000;
  channels: 1 | 2;
}

export interface LoudnessSettings {
  normalize: boolean;
  targetLufs: number;
  truePeakDbtp: number;
}

export interface ExportSettings {
  kind: OutputKind;
  container: Container;
  video: VideoSettings;
  audio: AudioSettings;
  loudness: LoudnessSettings;
  captions: CaptionMode;
  chapters: boolean;
}

/** Platform hard limits; exceeding them is a preflight warning. */
export interface PresetLimits {
  maxDurationSec?: number;
  maxBytes?: number;
  maxFps?: number;
  note?: string;
}

export interface ExportPreset {
  id: string;
  name: string;
  group: PresetGroup;
  /** One-line description shown under the name. */
  hint: string;
  settings: ExportSettings;
  limits?: PresetLimits;
  /** Codec the platform expects; a fallback codec is a preflight warning. */
  expectsCodec?: VideoCodecId;
  /** Hidden unless this audio codec can be encoded here (e.g. FLAC). */
  requiresAudioCodec?: AudioCodecId;
  custom?: boolean;
}

/** Which part of the sequence to render. */
export type RangeSpec =
  | { mode: 'entire' }
  | { mode: 'inout' }
  | { mode: 'custom'; start: number; end: number }
  /** A single frame (still export). */
  | { mode: 'frame'; time: number };

export interface TimeRange {
  start: number;
  end: number;
}

export type ExportPhase = 'preflight' | 'analyzing' | 'rendering' | 'audio' | 'finalizing' | 'sidecars' | 'done';

export interface ExportProgress {
  phase: ExportPhase;
  /** Overall 0..1 */
  fraction: number;
  /** Frames rendered per second (rolling), when rendering video. */
  fps: number | null;
  /** Seconds remaining, when known. */
  eta: number | null;
  frame?: number;
  totalFrames?: number;
  message?: string;
}

export interface PreflightIssue {
  level: 'error' | 'warning' | 'info';
  code: string;
  message: string;
}
