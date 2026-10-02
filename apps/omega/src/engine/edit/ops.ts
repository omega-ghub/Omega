// Editing operations: pure functions that change a DRAFT sequence/project
// (call them inside useEditor.getState().mutate/mutateSequence). OWNED BY THE
// EDITING-ENGINE PACKAGE, which implements every function below; the
// signatures are the contract used by the timeline, viewer, media browser,
// shortcuts and command palette.
//
// Conventions:
//  * Times are timeline seconds; implementations snap results to the
//    sequence frame grid (engine/time.ts snapToFrame).
//  * Locked tracks are never modified.
//  * Linked clips (same linkId) follow their partner unless `unlinked: true`.
//  * "Overwrite" replaces whatever is underneath; "insert" pushes later clips
//    on the targeted tracks to the right (ripple).
//  * Functions return the ids of created clips where relevant.

import type { Clip, ClipKind, Marker, Project, Sequence, Track, TrackKind, TransitionType } from '../../state/types';

export type EditMode = 'overwrite' | 'insert';
export type TrimMode = 'normal' | 'ripple' | 'roll';

function todo(name: string): never {
  throw new Error(`${name} is not implemented yet`);
}

// ---- placing ----------------------------------------------------------------

/** Places a media asset (video and/or audio, linked) at `start`. Uses asset.markIn/markOut when set. */
export function placeMedia(
  _project: Project,
  _seq: Sequence,
  _assetId: string,
  _opts: { start: number; mode?: EditMode; videoTrackId?: string | null; audioTrackId?: string | null; sourceIn?: number; sourceOut?: number },
): string[] {
  return todo('placeMedia');
}

/** Adds a generated clip (text, shape, solid, gradient, adjustment) on a video track. */
export function addGeneratedClip(_project: Project, _seq: Sequence, _kind: Exclude<ClipKind, 'media' | 'sequence'>, _opts: { start: number; duration?: number; trackId?: string | null; init?: Partial<Clip> }): string {
  return todo('addGeneratedClip');
}

// ---- moving & trimming --------------------------------------------------------

/** Moves clips by `delta` seconds and `trackDelta` tracks (same kind only). */
export function moveClips(_seq: Sequence, _clipIds: string[], _delta: number, _trackDelta: number, _mode: EditMode | 'free'): void {
  todo('moveClips');
}

/** Trims one edge. 'ripple' shifts everything after; 'roll' moves the shared edit point with the neighbour. */
export function trimClip(_project: Project, _seq: Sequence, _clipId: string, _edge: 'start' | 'end', _time: number, _mode: TrimMode): void {
  todo('trimClip');
}

/** Slip: change the source in/out without moving the clip. */
export function slipClip(_project: Project, _seq: Sequence, _clipId: string, _sourceDelta: number): void {
  todo('slipClip');
}

/** Slide: move the clip between its neighbours, trimming them to keep the gap closed. */
export function slideClip(_project: Project, _seq: Sequence, _clipId: string, _delta: number): void {
  todo('slideClip');
}

/** Rate stretch: drag an edge to change speed so the same source fills the new length. */
export function rateStretch(_project: Project, _seq: Sequence, _clipId: string, _edge: 'start' | 'end', _time: number): void {
  todo('rateStretch');
}

// ---- cutting & deleting ------------------------------------------------------

/** Splits clips at `time`. clipIds null = every clip under the time on targeted, unlocked tracks. */
export function splitAt(_seq: Sequence, _clipIds: string[] | null, _time: number): string[] {
  return todo('splitAt');
}

/** Deletes clips; ripple closes the gaps they leave. */
export function deleteClips(_seq: Sequence, _clipIds: string[], _ripple: boolean): void {
  todo('deleteClips');
}

/** Removes [inT,outT) from targeted tracks leaving a gap (lift) or closing it (extract). */
export function removeRange(_seq: Sequence, _inT: number, _outT: number, _ripple: boolean, _trackIds?: string[]): void {
  todo('removeRange');
}

/** Closes the gap at `time` on a track (or all gaps on the track when time is null). */
export function closeGap(_seq: Sequence, _trackId: string, _time: number | null): void {
  todo('closeGap');
}

// ---- time ----------------------------------------------------------------------

/** Constant speed change (0.01–100x), optional reverse; ripple pushes later clips. */
export function setSpeed(_project: Project, _seq: Sequence, _clipId: string, _speed: number, _opts: { reverse?: boolean; ripple?: boolean; keepDuration?: boolean }): void {
  todo('setSpeed');
}

/** Inserts a freeze frame of the frame under `time` lasting `duration`. */
export function freezeFrame(_project: Project, _seq: Sequence, _clipId: string, _time: number, _duration: number): string {
  return todo('freezeFrame');
}

// ---- structure -----------------------------------------------------------------

/** Moves the clips into a new sequence and replaces them with one nested clip. Returns the new sequence id. */
export function nestClips(_project: Project, _seq: Sequence, _clipIds: string[], _name?: string): string {
  return todo('nestClips');
}

export function duplicateClips(_seq: Sequence, _clipIds: string[], _offset: number): string[] {
  return todo('duplicateClips');
}

/** Pastes clipboard clips at `time` on the targeted tracks. */
export function pasteClips(_seq: Sequence, _clips: { clip: Clip; trackIndex: number; trackKind: TrackKind }[], _time: number, _mode: EditMode): string[] {
  return todo('pasteClips');
}

export function linkClips(_seq: Sequence, _clipIds: string[]): void {
  todo('linkClips');
}
export function unlinkClips(_seq: Sequence, _clipIds: string[]): void {
  todo('unlinkClips');
}
export function groupClips(_seq: Sequence, _clipIds: string[]): void {
  todo('groupClips');
}
export function ungroupClips(_seq: Sequence, _clipIds: string[]): void {
  todo('ungroupClips');
}

/** Adds a transition at a clip edge (head = with the previous clip, tail = to nothing). */
export function addTransition(_seq: Sequence, _clipId: string, _edge: 'start' | 'end', _type: TransitionType, _duration: number): void {
  todo('addTransition');
}

// ---- tracks & markers --------------------------------------------------------

export function addTrack(_seq: Sequence, _kind: TrackKind, _index?: number): Track {
  return todo('addTrack');
}
export function removeTrack(_seq: Sequence, _trackId: string): void {
  todo('removeTrack');
}
export function addMarker(_seq: Sequence, _time: number, _init?: Partial<Marker>): string {
  return todo('addMarker');
}

// ---- queries (no mutation) -----------------------------------------------------

/** Edit points for snapping / up-down navigation: clip edges, markers, in/out, playhead. */
export function editPoints(_seq: Sequence, _opts?: { includeMarkers?: boolean; excludeClipIds?: string[] }): number[] {
  return todo('editPoints');
}

/** The clip on a track at time t, if any. */
export function clipAt(_track: Track, _t: number): Clip | undefined {
  return todo('clipAt');
}
