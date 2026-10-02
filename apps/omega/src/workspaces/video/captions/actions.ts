// Caption and interchange actions (keyboard, command palette, menus).
import { registerActions, type Action } from '../actions';
import { useEditor } from '../../../state/store';
import {
  addCaptionTrack,
  addCueAtPlayhead,
  currentTrack,
  deleteCues,
  exportCaptionFile,
  exportInterchange,
  fixTiming,
  gotoCue,
  importCaptionFile,
  importOtioFile,
  mergeWithNext,
  nudgeCues,
  openChapters,
  setEdgeToPlayhead,
  splitAtPlayhead,
  splitLong,
} from './commands';

const hasProject = () => !!useEditor.getState().project;
const hasCues = () => hasProject() && (currentTrack()?.cues.length ?? 0) > 0;
const editable = () => hasCues() && !currentTrack()?.locked;
const hasClips = () => {
  const p = useEditor.getState().project;
  if (!p) return false;
  const seq = p.sequences.find((s) => s.id === p.activeSequenceId) ?? p.sequences[0];
  return !!seq && seq.tracks.some((t) => t.clips.length > 0);
};

export const CAPTION_ACTIONS: Action[] = [
  { id: 'captions.addTrack', label: 'Add caption track', group: 'Captions', run: () => void addCaptionTrack(), enabled: hasProject, hint: 'Adds a caption track (C1, C2, …) after the audio tracks' },
  // Mod+Alt+C is Copy Grade (color); captions use Alt+Shift+C.
  { id: 'captions.addCue', label: 'Add caption at playhead', group: 'Captions', keys: ['Alt+Shift+C'], run: addCueAtPlayhead, enabled: hasProject, hint: 'Two seconds, or up to the next caption' },
  { id: 'captions.split', label: 'Split caption at playhead', group: 'Captions', run: splitAtPlayhead, enabled: editable },
  { id: 'captions.merge', label: 'Merge caption with next', group: 'Captions', run: mergeWithNext, enabled: editable, hint: 'Merges the selected captions, or the current one with the next' },
  { id: 'captions.delete', label: 'Delete caption', group: 'Captions', run: deleteCues, enabled: editable },
  { id: 'captions.setIn', label: 'Set caption in to playhead', group: 'Captions', run: () => setEdgeToPlayhead('in'), enabled: editable },
  { id: 'captions.setOut', label: 'Set caption out to playhead', group: 'Captions', run: () => setEdgeToPlayhead('out'), enabled: editable },
  { id: 'captions.nudgeBack', label: 'Nudge caption 1 frame earlier', group: 'Captions', run: () => nudgeCues(-1), enabled: editable },
  { id: 'captions.nudgeForward', label: 'Nudge caption 1 frame later', group: 'Captions', run: () => nudgeCues(1), enabled: editable },
  { id: 'captions.next', label: 'Next caption', group: 'Captions', keys: ['Alt+Shift+ArrowDown'], run: () => gotoCue(1), enabled: hasCues },
  { id: 'captions.prev', label: 'Previous caption', group: 'Captions', keys: ['Alt+Shift+ArrowUp'], run: () => gotoCue(-1), enabled: hasCues },
  { id: 'captions.fix', label: 'Fix caption overlaps and snap to frames', group: 'Captions', run: fixTiming, enabled: editable, hint: 'Removes overlaps and keeps a 2-frame gap' },
  { id: 'captions.splitLong', label: 'Split long captions', group: 'Captions', run: splitLong, enabled: editable, hint: 'Re-wraps to 2 lines of 42 characters and splits the rest' },
  { id: 'captions.import', label: 'Import captions (SRT / VTT)…', group: 'Captions', run: () => void importCaptionFile(), enabled: hasProject },
  { id: 'captions.exportSrt', label: 'Export captions as SRT…', group: 'Captions', run: () => void exportCaptionFile('srt'), enabled: hasCues },
  { id: 'captions.exportVtt', label: 'Export captions as WebVTT…', group: 'Captions', run: () => void exportCaptionFile('vtt'), enabled: hasCues },
  { id: 'captions.exportTtml', label: 'Export captions as TTML (SMPTE-TT)…', group: 'Captions', run: () => void exportCaptionFile('ttml'), enabled: hasCues },
  { id: 'interchange.exportEdl', label: 'Export EDL (CMX 3600)…', group: 'Export', run: () => void exportInterchange('edl'), enabled: hasClips, hint: 'Edit decision list for conform in Resolve, Avid or Premiere' },
  { id: 'interchange.exportOtio', label: 'Export OpenTimelineIO…', group: 'Export', run: () => void exportInterchange('otio'), enabled: hasClips },
  { id: 'interchange.exportFcpxml', label: 'Export Final Cut Pro XML…', group: 'Export', run: () => void exportInterchange('fcpxml'), enabled: hasClips, hint: 'FCPXML 1.11 for Final Cut Pro and DaVinci Resolve' },
  { id: 'interchange.exportChapters', label: 'Export YouTube chapters…', group: 'Export', run: openChapters, enabled: hasProject, hint: 'From chapter markers' },
  { id: 'interchange.importOtio', label: 'Import OpenTimelineIO…', group: 'Project', run: () => void importOtioFile(), enabled: hasProject, hint: 'Opens an .otio timeline as a new sequence' },
];

// Registered on import of the package index.
registerActions(CAPTION_ACTIONS);
