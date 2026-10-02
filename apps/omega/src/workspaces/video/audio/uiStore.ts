// Transient UI state of the audio package (not part of the document):
// record-armed track, voiceover recording phase, last loudness analysis.

import { create } from 'zustand';
import type { LoudnessResult } from '../../../engine/audio/engine';
import type { Project } from '../../../state/types';

export type RecordPhase = 'idle' | 'countdown' | 'recording' | 'saving';

export interface LoudnessAnalysis {
  result: LoudnessResult;
  /** Document the analysis was made from (stale when it changes). */
  project: Project;
  sequenceId: string;
  start: number;
  end: number;
  range: 'sequence' | 'inout';
  at: number;
}

interface AudioUiState {
  armedTrackId: string | null;
  phase: RecordPhase;
  countdown: number;
  recordStart: number;
  recordStartedAt: number;
  /** Input level (dBFS peak) while recording. */
  inputDb: number;
  error: string | null;
  analysis: LoudnessAnalysis | null;
  presetId: string;
  set(patch: Partial<AudioUiState>): void;
}

function loadPreset(): string {
  try {
    return localStorage.getItem('delta.audio.loudnessPreset') ?? 'youtube';
  } catch {
    return 'youtube';
  }
}

export const useAudioUi = create<AudioUiState>((set) => ({
  armedTrackId: null,
  phase: 'idle',
  countdown: 0,
  recordStart: 0,
  recordStartedAt: 0,
  inputDb: -Infinity,
  error: null,
  analysis: null,
  presetId: loadPreset(),
  set: (patch) => {
    if (patch.presetId) {
      try {
        localStorage.setItem('delta.audio.loudnessPreset', patch.presetId);
      } catch {
        /* ignore */
      }
    }
    set(patch);
  },
}));

export interface LoudnessPreset {
  id: string;
  name: string;
  target: number; // LUFS
  tolerance: number; // ± LU
  truePeak: number; // dBTP max
  note?: string;
}

export const LOUDNESS_PRESETS: LoudnessPreset[] = [
  { id: 'youtube', name: 'YouTube / Spotify', target: -14, tolerance: 1, truePeak: -1, note: 'Platforms turn louder uploads down; quieter ones are not turned up.' },
  { id: 'apple', name: 'Apple Podcasts', target: -16, tolerance: 1, truePeak: -1 },
  { id: 'ebu', name: 'EBU R 128', target: -23, tolerance: 0.5, truePeak: -1 },
  { id: 'atsc', name: 'ATSC A/85', target: -24, tolerance: 2, truePeak: -2 },
  { id: 'netflix', name: 'Netflix (dialog)', target: -27, tolerance: 2, truePeak: -2, note: 'Netflix gates on dialog; this measures the full program, so treat it as a guide.' },
];

export function presetById(id: string): LoudnessPreset {
  return LOUDNESS_PRESETS.find((p) => p.id === id) ?? LOUDNESS_PRESETS[0];
}
