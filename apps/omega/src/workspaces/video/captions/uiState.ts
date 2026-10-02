// Local UI state of the Captions panel (not part of the document).
import { create } from 'zustand';

export interface CaptionsUi {
  /** The caption track the panel and the caption actions work on. */
  trackId: string | null;
  tab: 'cues' | 'style';
  search: string;
  replace: string;
  caseSensitive: boolean;
  /** Scroll the list to follow the playhead during playback. */
  follow: boolean;
  /** Cue whose text area should take focus once rendered. */
  focusCueId: string | null;
  set(patch: Partial<Omit<CaptionsUi, 'set'>>): void;
}

export const useCaptionsUi = create<CaptionsUi>((set) => ({
  trackId: null,
  tab: 'cues',
  search: '',
  replace: '',
  caseSensitive: false,
  follow: true,
  focusCueId: null,
  set: (patch) => set(patch),
}));
