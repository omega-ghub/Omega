// Interchange with other editors. OWNED BY THE CAPTIONS/INTERCHANGE PACKAGE.
//
//   exportEdl(project, seq)      CMX 3600 EDL (see edl.ts for the mapping)
//   exportOtio(project, seq)     OpenTimelineIO JSON (otio.ts)
//   exportFcpxml(project, seq)   FCPXML 1.11 for Final Cut Pro / Resolve (fcpxml.ts)
//   exportChapters(seq)          YouTube chapters text (chapters.ts)
//   importOtio(project, json)    OTIO → new Sequence + assets (otioImport.ts)
//
// Every writer is pure (no I/O); the Captions workspace actions wrap them in
// save dialogs, and Deliver writes them into handoff folders.

export { exportEdl, type EdlOptions } from './edl';
export { exportOtio, buildOtio, stringifyOtio } from './otio';
export { exportFcpxml, exportFcpxmlDetailed, FCP_CROSS_DISSOLVE_UID, type FcpxmlResult } from './fcpxml';
export { exportChapters, exportChaptersDetailed, type Chapter, type ChaptersResult, type ChapterOptions } from './chapters';
export { importOtio, fpsFromRate, type OtioImportResult } from './otioImport';
export { fileUrl, pathFromUrl, rationalTime, frameRational } from './common';
