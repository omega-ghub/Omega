import type { ProjectSettings } from './types';

// New-project presets. Grouped the way creators think ("where is this going?")
// instead of the way tape decks thought ("DV NTSC Widescreen 48 kHz").

export interface ProjectPreset {
  id: string;
  group: 'Social' | 'Standard' | 'Cinema' | 'Custom';
  name: string;
  hint: string;
  width: number;
  height: number;
  fps: number;
  aspect: string;
}

export const PROJECT_PRESETS: ProjectPreset[] = [
  { id: 'yt-1080', group: 'Social', name: 'YouTube 1080p', hint: 'Landscape · 1920×1080 · 30 fps', width: 1920, height: 1080, fps: 30, aspect: '16:9' },
  { id: 'yt-4k', group: 'Social', name: 'YouTube 4K', hint: 'Landscape · 3840×2160 · 30 fps', width: 3840, height: 2160, fps: 30, aspect: '16:9' },
  { id: 'vertical', group: 'Social', name: 'Shorts · Reels · TikTok', hint: 'Vertical · 1080×1920 · 30 fps', width: 1080, height: 1920, fps: 30, aspect: '9:16' },
  { id: 'square', group: 'Social', name: 'Square', hint: 'Instagram feed · 1080×1080 · 30 fps', width: 1080, height: 1080, fps: 30, aspect: '1:1' },
  { id: 'portrait-45', group: 'Social', name: 'Portrait 4:5', hint: 'Instagram feed · 1080×1350 · 30 fps', width: 1080, height: 1350, fps: 30, aspect: '4:5' },
  { id: 'hd-2997', group: 'Standard', name: 'HD 1080p 29.97', hint: 'NTSC broadcast · 1920×1080 · 29.97 fps', width: 1920, height: 1080, fps: 29.97, aspect: '16:9' },
  { id: 'hd-25', group: 'Standard', name: 'HD 1080p 25', hint: 'PAL broadcast · 1920×1080 · 25 fps', width: 1920, height: 1080, fps: 25, aspect: '16:9' },
  { id: 'hd-60', group: 'Standard', name: 'HD 1080p 60', hint: 'Gaming & sports · 1920×1080 · 60 fps', width: 1920, height: 1080, fps: 60, aspect: '16:9' },
  { id: 'uhd-60', group: 'Standard', name: 'UHD 4K 60', hint: 'Gaming & sports · 3840×2160 · 60 fps', width: 3840, height: 2160, fps: 60, aspect: '16:9' },
  { id: 'hd-720', group: 'Standard', name: 'HD 720p', hint: 'Light & fast · 1280×720 · 30 fps', width: 1280, height: 720, fps: 30, aspect: '16:9' },
  { id: 'cine-24', group: 'Cinema', name: 'Cinema 1080p 24', hint: 'Film look · 1920×1080 · 23.976 fps', width: 1920, height: 1080, fps: 23.976, aspect: '16:9' },
  { id: 'dci-4k', group: 'Cinema', name: 'DCI 4K', hint: 'Digital cinema · 4096×2160 · 24 fps', width: 4096, height: 2160, fps: 24, aspect: '17:9' },
  { id: 'scope', group: 'Cinema', name: 'CinemaScope 2.39', hint: 'Widescreen · 2048×858 · 24 fps', width: 2048, height: 858, fps: 24, aspect: '2.39:1' },
  { id: 'uhd-24', group: 'Cinema', name: 'UHD 4K 24', hint: 'Film look · 3840×2160 · 23.976 fps', width: 3840, height: 2160, fps: 23.976, aspect: '16:9' },
];

export const FRAME_RATES = [23.976, 24, 25, 29.97, 30, 50, 59.94, 60, 120];

export const SAMPLE_RATES: ProjectSettings['sampleRate'][] = [44100, 48000, 96000];

export const COLOR_SPACES: { id: ProjectSettings['colorSpace']; name: string; hint: string }[] = [
  { id: 'rec709', name: 'Rec. 709 (SDR)', hint: 'Standard for web and broadcast video' },
  { id: 'srgb', name: 'sRGB', hint: 'Screen graphics and screen recordings' },
  { id: 'p3', name: 'Display P3', hint: 'Wide gamut, Apple displays' },
  { id: 'rec2020-hlg', name: 'Rec. 2020 HLG (HDR)', hint: 'HDR for YouTube and broadcast' },
  { id: 'rec2020-pq', name: 'Rec. 2020 PQ (HDR10)', hint: 'HDR for streaming delivery' },
];

export function isDropFrameRate(fps: number) {
  return fps === 29.97 || fps === 59.94;
}

export function aspectLabel(w: number, h: number): string {
  const g = gcd(w, h);
  const a = w / g;
  const b = h / g;
  if (a === 16 && b === 9) return '16:9';
  if (a === 9 && b === 16) return '9:16';
  if (a === 1 && b === 1) return '1:1';
  if (a === 4 && b === 5) return '4:5';
  if (a === 4 && b === 3) return '4:3';
  if (a === 256 && b === 135) return '17:9';
  return `${(w / h).toFixed(2)}:1`;
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

export const DEFAULT_SETTINGS: ProjectSettings = {
  width: 1920,
  height: 1080,
  fps: 30,
  dropFrame: false,
  sampleRate: 48000,
  colorSpace: 'rec709',
  matchFirstClip: false,
  stillDuration: 5,
  defaultTransitionDuration: 1,
};

// Export presets: platform-oriented. Bitrates follow the platforms' published
// recommendations for SDR uploads (see docs/research/video-specs.md).
export interface ExportPreset {
  id: string;
  name: string;
  hint: string;
  container: 'mp4' | 'webm';
  videoCodecs: ('avc' | 'hevc' | 'av1' | 'vp9')[]; // preference order
  audioCodecs: ('aac' | 'opus')[];
  /** Mbps lookup by vertical resolution and fps bucket. */
  bitrateMbps: (height: number, fps: number) => number;
  audioKbps: number;
  /** Optional fixed output size. Otherwise the sequence size is used. */
  width?: number;
  height?: number;
}

function youtubeBitrate(height: number, fps: number): number {
  const high = fps > 30;
  if (height >= 2160) return high ? 68 : 45;
  if (height >= 1440) return high ? 24 : 16;
  if (height >= 1080) return high ? 12 : 8;
  if (height >= 720) return high ? 7.5 : 5;
  return high ? 4 : 2.5;
}

export const EXPORT_PRESETS: ExportPreset[] = [
  { id: 'yt', name: 'YouTube', hint: 'H.264 MP4, YouTube recommended bitrate', container: 'mp4', videoCodecs: ['avc', 'hevc', 'av1', 'vp9'], audioCodecs: ['aac', 'opus'], bitrateMbps: youtubeBitrate, audioKbps: 384 },
  { id: 'shorts', name: 'Shorts · Reels · TikTok', hint: 'H.264 MP4, vertical, high bitrate', container: 'mp4', videoCodecs: ['avc', 'hevc', 'av1', 'vp9'], audioCodecs: ['aac', 'opus'], bitrateMbps: (h, f) => Math.max(10, youtubeBitrate(h, f)), audioKbps: 256 },
  { id: 'x', name: 'X · LinkedIn · Facebook', hint: 'H.264 MP4, moderate bitrate for size limits', container: 'mp4', videoCodecs: ['avc', 'hevc', 'av1', 'vp9'], audioCodecs: ['aac', 'opus'], bitrateMbps: (h) => (h >= 1080 ? 6 : 4), audioKbps: 192 },
  { id: 'master', name: 'High quality master', hint: 'Highest quality the encoder allows', container: 'mp4', videoCodecs: ['hevc', 'avc', 'av1', 'vp9'], audioCodecs: ['aac', 'opus'], bitrateMbps: (h, f) => youtubeBitrate(h, f) * 2.5, audioKbps: 384 },
  { id: 'web', name: 'Web (WebM / VP9)', hint: 'Royalty-free, great for websites', container: 'webm', videoCodecs: ['vp9', 'av1'], audioCodecs: ['opus'], bitrateMbps: (h, f) => youtubeBitrate(h, f) * 0.8, audioKbps: 160 },
];
