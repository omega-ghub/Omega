// Interchange with other editors. OWNED BY THE CAPTIONS/INTERCHANGE PACKAGE.
import type { Project, Sequence } from '../../state/types';

/** CMX 3600 EDL (one video track + up to 4 audio channels per event). */
export function exportEdl(_project: Project, _seq: Sequence): string {
  throw new Error('exportEdl is not implemented yet');
}
/** OpenTimelineIO JSON (.otio). */
export function exportOtio(_project: Project, _seq: Sequence): string {
  throw new Error('exportOtio is not implemented yet');
}
/** Final Cut Pro XML 1.11 (.fcpxml), readable by Final Cut and Resolve. */
export function exportFcpxml(_project: Project, _seq: Sequence): string {
  throw new Error('exportFcpxml is not implemented yet');
}
/** YouTube chapter list from chapter markers ("00:00 Intro"). */
export function exportChapters(_seq: Sequence): string {
  throw new Error('exportChapters is not implemented yet');
}
