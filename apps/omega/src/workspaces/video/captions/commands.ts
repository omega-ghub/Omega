// Caption and interchange commands shared by the panel, the actions and the
// dialogs. Every document change goes through mutate / mutateSequence.
import type { CaptionCue, CaptionStyle, MediaAsset, Sequence, Track } from '../../../state/types';
import { activeSequence, sequenceDuration } from '../../../state/types';
import { makeTrack } from '../../../state/defaults';
import { useEditor } from '../../../state/store';
import { fromFrames, snapToFrame } from '../../../engine/time';
import { transport } from '../../../engine/playback/transport';
import {
  detectCaptionFormat,
  fitCuesToGaps,
  mergeCues,
  newCueAt,
  parseCaptionsDetailed,
  replaceInCues,
  shiftCues,
  sortCues,
  splitCueAt,
  splitLongCues,
  writeSrt,
  writeTtml,
  writeVtt,
} from '../../../engine/captions';
import { exportChaptersDetailed, exportEdl, exportFcpxmlDetailed, exportOtio, importOtio } from '../../../engine/interchange';
import { probeMedia } from '../../../engine/media/probe';
import { useCaptionsUi } from './uiState';

// ---------------------------------------------------------------------------
// Lookup
// ---------------------------------------------------------------------------

export function getSeq(): Sequence | null {
  const p = useEditor.getState().project;
  return p ? activeSequence(p) : null;
}

export function captionTracks(seq: Sequence): Track[] {
  return seq.tracks.filter((t) => t.kind === 'caption');
}

/** The caption track the panel works on (the chosen one, else the first). */
export function resolveTrack(seq: Sequence | null, trackId: string | null): Track | null {
  if (!seq) return null;
  const tracks = captionTracks(seq);
  return tracks.find((t) => t.id === trackId) ?? tracks[0] ?? null;
}

export function currentTrack(): Track | null {
  return resolveTrack(getSeq(), useCaptionsUi.getState().trackId);
}

function toast(message: string, kind: 'info' | 'success' | 'error' = 'info') {
  useEditor.getState().showToast(message, kind);
}

/** Selected cues of a track, else the cue under the playhead. */
export function targetCues(track: Track): CaptionCue[] {
  const ids = new Set(useEditor.getState().selection.cueIds);
  const sel = track.cues.filter((c) => ids.has(c.id));
  if (sel.length) return sortCues(sel);
  const t = useEditor.getState().playhead;
  const at = track.cues.find((c) => t >= c.start - 1e-6 && t < c.end - 1e-6);
  return at ? [at] : [];
}

/** Mutates one caption track of the active sequence and keeps its cues sorted. */
export function mutateTrack(label: string, trackId: string, fn: (track: Track, seq: Sequence) => void, coalesceKey?: string) {
  useEditor.getState().mutateSequence(
    label,
    (seq) => {
      const t = seq.tracks.find((x) => x.id === trackId);
      if (!t) return;
      fn(t, seq);
      t.cues.sort((a, b) => a.start - b.start || a.end - b.end);
    },
    coalesceKey ? { coalesceKey } : undefined,
  );
}

function selectCues(ids: string[]) {
  useEditor.getState().select({ cueIds: ids });
}

/** A caption track to work on, creating one when there is none. */
function ensureTrack(): Track | null {
  const t = currentTrack();
  if (t) return t;
  addCaptionTrack();
  return currentTrack();
}

// ---------------------------------------------------------------------------
// Tracks
// ---------------------------------------------------------------------------

function nextTrackName(seq: Sequence): string {
  const used = new Set(captionTracks(seq).map((t) => t.name));
  for (let i = 1; ; i++) if (!used.has(`C${i}`)) return `C${i}`;
}

/** Adds a caption track (C1, C2, …) after the audio tracks and makes it current. */
export function addCaptionTrack(): string | null {
  const seq = getSeq();
  if (!seq) return null;
  const track = makeTrack('caption', nextTrackName(seq));
  useEditor.getState().mutateSequence('Add caption track', (s) => {
    s.tracks.push(track);
  });
  useCaptionsUi.getState().set({ trackId: track.id });
  return track.id;
}

export function updateStyle(trackId: string, patch: Partial<CaptionStyle>, coalesceKey?: string, label = 'Caption style') {
  useEditor.getState().mutateSequence(
    label,
    (seq) => {
      const t = seq.tracks.find((x) => x.id === trackId);
      if (t && t.captionStyle) Object.assign(t.captionStyle, patch);
    },
    coalesceKey ? { coalesceKey } : undefined,
  );
}

// ---------------------------------------------------------------------------
// Cue editing
// ---------------------------------------------------------------------------

export function addCueAtPlayhead() {
  const seq = getSeq();
  const track = ensureTrack();
  if (!seq || !track) return;
  if (track.locked) return toast('The caption track is locked', 'error');
  const t = useEditor.getState().playhead;
  const cue = newCueAt(track.cues, t, seq.fps, 2, 2);
  if (!cue) return toast('There is already a caption at the playhead', 'info');
  mutateTrack('Add caption', track.id, (tr) => {
    tr.cues.push(cue);
  });
  selectCues([cue.id]);
  useCaptionsUi.getState().set({ focusCueId: cue.id, tab: 'cues' });
}

export function splitAtPlayhead() {
  const seq = getSeq();
  const track = currentTrack();
  if (!seq || !track) return;
  const t = useEditor.getState().playhead;
  const cue = track.cues.find((c) => t > c.start + 1e-6 && t < c.end - 1e-6);
  if (!cue) return toast('Move the playhead inside a caption to split it', 'info');
  const parts = splitCueAt(cue, t, seq.fps);
  if (!parts) return toast('The playhead is too close to the caption edge', 'info');
  mutateTrack('Split caption', track.id, (tr) => {
    const i = tr.cues.findIndex((c) => c.id === cue.id);
    if (i >= 0) tr.cues.splice(i, 1, parts[0], parts[1]);
  });
  selectCues([parts[1].id]);
}

export function mergeWithNext() {
  const track = currentTrack();
  if (!track) return;
  const sorted = sortCues(track.cues);
  const sel = targetCues(track);
  if (!sel.length) return toast('Select a caption to merge', 'info');
  let group = sel;
  if (sel.length === 1) {
    const i = sorted.findIndex((c) => c.id === sel[0].id);
    if (i < 0 || i >= sorted.length - 1) return toast('There is no next caption to merge with', 'info');
    group = [sorted[i], sorted[i + 1]];
  }
  const merged = mergeCues(group);
  if (!merged) return;
  const drop = new Set(group.map((c) => c.id));
  mutateTrack(group.length > 2 ? 'Merge captions' : 'Merge caption with next', track.id, (tr) => {
    tr.cues = tr.cues.filter((c) => !drop.has(c.id));
    tr.cues.push(merged);
  });
  selectCues([merged.id]);
}

export function deleteCues() {
  const track = currentTrack();
  if (!track) return;
  const sel = targetCues(track);
  if (!sel.length) return;
  const drop = new Set(sel.map((c) => c.id));
  mutateTrack(sel.length > 1 ? `Delete ${sel.length} captions` : 'Delete caption', track.id, (tr) => {
    tr.cues = tr.cues.filter((c) => !drop.has(c.id));
  });
  selectCues([]);
}

/** Sets the in or out point of the target cue to the playhead. */
export function setEdgeToPlayhead(edge: 'in' | 'out') {
  const seq = getSeq();
  const track = currentTrack();
  if (!seq || !track) return;
  const t = snapToFrame(useEditor.getState().playhead, seq.fps);
  const ids = new Set(useEditor.getState().selection.cueIds);
  let cue = track.cues.find((c) => ids.has(c.id));
  if (!cue) {
    // Without a selection: the cue under the playhead, else the nearest one on the relevant side.
    const sorted = sortCues(track.cues);
    cue =
      sorted.find((c) => t >= c.start && t < c.end) ??
      (edge === 'out' ? [...sorted].reverse().find((c) => c.start < t) : sorted.find((c) => c.end > t));
  }
  if (!cue) return toast('Select a caption first', 'info');
  const frame = fromFrames(1, seq.fps);
  if (edge === 'in' && t > cue.end - frame + 1e-9) return toast('In point must be before the out point', 'error');
  if (edge === 'out' && t < cue.start + frame - 1e-9) return toast('Out point must be after the in point', 'error');
  const id = cue.id;
  mutateTrack(edge === 'in' ? 'Set caption in' : 'Set caption out', track.id, (tr) => {
    const c = tr.cues.find((x) => x.id === id);
    if (!c) return;
    if (edge === 'in') c.start = t;
    else c.end = t;
  });
}

/** Moves the selected cues (or the one under the playhead) by whole frames. */
export function nudgeCues(frames: number) {
  const seq = getSeq();
  const track = currentTrack();
  if (!seq || !track) return;
  const sel = targetCues(track);
  if (!sel.length) return;
  const ids = new Set(sel.map((c) => c.id));
  const minStart = Math.min(...sel.map((c) => c.start));
  const delta = Math.max(-minStart, fromFrames(frames, seq.fps));
  if (Math.abs(delta) < 1e-9) return;
  mutateTrack(
    'Nudge captions',
    track.id,
    (tr) => {
      for (const c of tr.cues) {
        if (!ids.has(c.id)) continue;
        c.start = snapToFrame(c.start + delta, seq.fps);
        c.end = snapToFrame(c.end + delta, seq.fps);
      }
    },
    `cap-nudge-${track.id}`,
  );
  selectCues([...ids]);
}

/** Snaps every cue to frames and removes overlaps (2-frame minimum gap). */
export function fixTiming() {
  const seq = getSeq();
  const track = currentTrack();
  if (!seq || !track || !track.cues.length) return;
  const fixed = fitCuesToGaps(track.cues, seq.fps, 2);
  mutateTrack('Fix caption timing', track.id, (tr) => {
    tr.cues = fixed;
  });
  toast('Captions snapped to frames, overlaps removed', 'success');
}

export function splitLong() {
  const seq = getSeq();
  const track = currentTrack();
  if (!seq || !track || !track.cues.length) return;
  const out = splitLongCues(track.cues, 42, 2, 0.83, seq.fps);
  const changed = out.length !== track.cues.length || out.some((c, i) => c.text !== sortCues(track.cues)[i]?.text);
  if (!changed) return toast('All captions already fit 2 lines of 42 characters', 'info');
  const added = out.length - track.cues.length;
  mutateTrack('Split long captions', track.id, (tr) => {
    tr.cues = out;
  });
  toast(added > 0 ? `Re-wrapped long lines and added ${added} caption${added === 1 ? '' : 's'}` : 'Re-wrapped long lines', 'success');
}

/** Moves the playhead to the next / previous cue start and selects it. */
export function gotoCue(dir: 1 | -1) {
  const track = currentTrack();
  if (!track || !track.cues.length) return;
  const t = useEditor.getState().playhead;
  const sorted = sortCues(track.cues);
  const target = dir > 0 ? sorted.find((c) => c.start > t + 1e-6) : [...sorted].reverse().find((c) => c.start < t - 1e-6);
  if (!target) return;
  transport.seek(target.start);
  selectCues([target.id]);
}

export function replaceAll(find: string, replace: string, caseSensitive: boolean) {
  const track = currentTrack();
  if (!track || !find) return;
  const r = replaceInCues(track.cues, find, replace, { caseSensitive });
  if (!r.count) return toast(`No matches for “${find}”`, 'info');
  mutateTrack(`Replace ${r.count} match${r.count === 1 ? '' : 'es'}`, track.id, (tr) => {
    tr.cues = r.cues.map((c) => ({ ...c }));
  });
  toast(`Replaced ${r.count} match${r.count === 1 ? '' : 'es'}`, 'success');
}

// ---------------------------------------------------------------------------
// Import / export of caption files
// ---------------------------------------------------------------------------

export interface ImportProps {
  fileName: string;
  cues: CaptionCue[];
  warnings: string[];
}

/** Picks .srt / .vtt files, parses them and opens the import dialog. */
export async function importCaptionFile() {
  if (!useEditor.getState().project) return;
  let paths: string[] = [];
  try {
    paths = await window.omega.dialogs.pickFiles('Import captions', ['srt', 'vtt']);
  } catch (err) {
    return toast(`Could not open the file dialog: ${(err as Error).message}`, 'error');
  }
  if (!paths.length) return;
  const path = paths[0];
  try {
    const text = await window.omega.files.readText(path);
    const fileName = path.split(/[\\/]/).pop() ?? path;
    const { cues, warnings } = parseCaptionsDetailed(text, detectCaptionFormat(text, fileName));
    if (!cues.length) return toast(`No captions found in ${fileName}`, 'error');
    useEditor.getState().openModal('captions.import', { fileName, cues, warnings } satisfies ImportProps as unknown as Record<string, unknown>);
  } catch (err) {
    toast(`Could not read the caption file: ${(err as Error).message}`, 'error');
  }
}

/** Applies a parsed caption file to a track (or a new one). */
export function applyImport(props: ImportProps, target: string | 'new', offset: 'zero' | 'playhead', replaceExisting: boolean) {
  const seq = getSeq();
  if (!seq) return;
  const first = Math.min(...props.cues.map((c) => c.start));
  const delta = offset === 'playhead' ? useEditor.getState().playhead - first : 0;
  const cues = shiftCues(props.cues, delta).map((c) => ({ ...c, start: snapToFrame(c.start, seq.fps), end: Math.max(snapToFrame(c.end, seq.fps), snapToFrame(c.start, seq.fps) + fromFrames(1, seq.fps)) }));
  let trackId = target;
  let newTrack: Track | null = null;
  if (target === 'new' || !seq.tracks.some((t) => t.id === target && t.kind === 'caption')) {
    newTrack = makeTrack('caption', nextTrackName(seq));
    trackId = newTrack.id;
  }
  useEditor.getState().mutateSequence(`Import captions (${props.fileName})`, (s) => {
    let tr = s.tracks.find((t) => t.id === trackId);
    if (!tr && newTrack) {
      s.tracks.push(newTrack);
      tr = s.tracks[s.tracks.length - 1];
    }
    if (!tr) return;
    tr.cues = replaceExisting ? cues : [...tr.cues, ...cues];
    tr.cues.sort((a, b) => a.start - b.start || a.end - b.end);
  });
  useCaptionsUi.getState().set({ trackId, tab: 'cues' });
  toast(`Imported ${cues.length} caption${cues.length === 1 ? '' : 's'}`, 'success');
}

function safeName(s: string): string {
  return s.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'Untitled';
}

async function saveText(title: string, defaultName: string, ext: string, text: string): Promise<string | null> {
  const path = await window.omega.dialogs.pickSavePath(title, defaultName, ext);
  if (!path) return null;
  await window.omega.files.writeText(path, text);
  return path;
}

export async function exportCaptionFile(format: 'srt' | 'vtt' | 'ttml') {
  const seq = getSeq();
  const track = currentTrack();
  if (!seq || !track) return toast('There is no caption track to export', 'info');
  if (!track.cues.length) return toast(`${track.name} has no captions`, 'info');
  const text = format === 'srt' ? writeSrt(track.cues) : format === 'vtt' ? writeVtt(track.cues) : writeTtml(track.cues, { fps: seq.fps, title: `${seq.name} ${track.name}`, position: track.captionStyle?.position });
  const label = format === 'ttml' ? 'TTML' : format.toUpperCase();
  try {
    const path = await saveText(`Export captions as ${label}`, `${safeName(seq.name)} ${track.name}.${format}`, format, text);
    if (path) toast(`Exported ${track.cues.length} captions to ${path.split(/[\\/]/).pop()}`, 'success');
  } catch (err) {
    toast(`Export failed: ${(err as Error).message}`, 'error');
  }
}

// ---------------------------------------------------------------------------
// Interchange
// ---------------------------------------------------------------------------

export async function exportInterchange(kind: 'edl' | 'otio' | 'fcpxml') {
  const { project } = useEditor.getState();
  if (!project) return;
  const seq = activeSequence(project);
  if (!seq.tracks.some((t) => t.clips.length)) return toast('The sequence is empty', 'info');
  try {
    let text: string;
    let warnings: string[] = [];
    if (kind === 'edl') text = exportEdl(project, seq);
    else if (kind === 'otio') text = exportOtio(project, seq);
    else {
      const r = exportFcpxmlDetailed(project, seq);
      text = r.xml;
      warnings = r.warnings;
    }
    const titles = { edl: 'Export EDL (CMX 3600)', otio: 'Export OpenTimelineIO', fcpxml: 'Export Final Cut Pro XML' };
    const path = await saveText(titles[kind], `${safeName(seq.name)}.${kind}`, kind, text);
    if (!path) return;
    const file = path.split(/[\\/]/).pop();
    toast(warnings.length ? `Exported ${file}. ${warnings[0]}` : `Exported ${file}`, warnings.length ? 'info' : 'success');
  } catch (err) {
    toast(`Export failed: ${(err as Error).message}`, 'error');
  }
}

export function openChapters() {
  if (!useEditor.getState().project) return;
  useEditor.getState().openModal('captions.chapters');
}

export function chaptersFor(seq: Sequence) {
  return exportChaptersDetailed(seq, { duration: sequenceDuration(seq) });
}

export async function saveChapters(text: string) {
  const seq = getSeq();
  if (!seq || !text) return;
  try {
    const path = await saveText('Export YouTube chapters', `${safeName(seq.name)} chapters.txt`, 'txt', text + '\n');
    if (path) toast(`Saved chapters to ${path.split(/[\\/]/).pop()}`, 'success');
  } catch (err) {
    toast(`Save failed: ${(err as Error).message}`, 'error');
  }
}

/** Imports an .otio file as a new sequence (probing media it introduces). */
export async function importOtioFile() {
  const { project } = useEditor.getState();
  if (!project) return;
  const paths = await window.omega.dialogs.pickFiles('Import OpenTimelineIO', ['otio']);
  if (!paths.length) return;
  try {
    const json = await window.omega.files.readText(paths[0]);
    const r = importOtio(project, json);
    if (r.assets.length) toast(`Reading ${r.assets.length} media file${r.assets.length === 1 ? '' : 's'}…`, 'info');
    const assets: MediaAsset[] = [];
    for (const a of r.assets) {
      let merged: MediaAsset = a;
      try {
        const probed = await probeMedia(a.path, a.name);
        merged = { ...probed, id: a.id, name: a.name, binId: null };
      } catch {
        let exists = false;
        try {
          exists = await window.omega.media.exists(a.path);
        } catch {
          exists = false;
        }
        merged = { ...a, offline: !exists };
      }
      assets.push(merged);
    }
    useEditor.getState().mutate(`Import OTIO (${r.sequence.name})`, (draft) => {
      draft.assets.push(...assets);
      draft.sequences.push(...r.sequences);
      draft.activeSequenceId = r.sequence.id;
    });
    useEditor.getState().setPlayhead(0);
    const offline = assets.filter((a) => a.offline).length;
    const notes = [...r.warnings, offline ? `${offline} media file${offline === 1 ? ' is' : 's are'} offline` : ''].filter(Boolean);
    toast(notes.length ? `Imported “${r.sequence.name}”. ${notes[0]}` : `Imported “${r.sequence.name}”`, notes.length ? 'info' : 'success');
  } catch (err) {
    toast((err as Error).message || 'Could not import the OTIO file', 'error');
  }
}
