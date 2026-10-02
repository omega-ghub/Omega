// Viewer commands, shared by the registered actions (keyboard, palette,
// menus) and the monitors' buttons. Each acts on the focused monitor where
// that makes sense: the source monitor when it has focus and an asset loaded,
// otherwise the program (the active sequence).
import { placeMedia } from '../../../engine/edit/ops';
import { markOutAt, nextEditPoint, nextShuttleRate, outFrame, prevEditPoint, sequenceEditPoints } from '../../../engine/playback/clock';
import { exportCurrentFrame } from '../../../engine/playback/exportFrame';
import { getPlayer } from '../../../engine/playback/player';
import { getSourcePlayer } from '../../../engine/playback/sourcePlayer';
import { transport } from '../../../engine/playback/transport';
import { snapToFrame, sourceTimeAt } from '../../../engine/time';
import { useEditor } from '../../../state/store';
import type { Sequence } from '../../../state/types';
import { activeSequence, sequenceDuration } from '../../../state/types';
import { getAction, runAction } from '../actions';
import { useViewerUi } from './uiState';

const ed = () => useEditor.getState();

function seq(): Sequence | null {
  const p = ed().project;
  return p ? activeSequence(p) : null;
}

/** True when keyboard transport should drive the source monitor. */
export function sourceHasFocus(): boolean {
  const s = ed();
  if (useViewerUi.getState().focus !== 'source' || !s.source.assetId || !s.project) return false;
  const a = s.project.assets.find((x) => x.id === s.source.assetId);
  return !!a && a.kind !== 'image';
}

// ---- transport -----------------------------------------------------------------

let kHeld = false;
let kTracking = false;

/** Tracks the K key so K+J / K+L step single frames (Premiere). */
export function installShuttleKeys(): void {
  if (kTracking || typeof window === 'undefined') return;
  kTracking = true;
  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyK' && !e.ctrlKey && !e.metaKey && !e.altKey) kHeld = true;
  });
  window.addEventListener('keyup', (e) => {
    if (e.code === 'KeyK') kHeld = false;
  });
  window.addEventListener('blur', () => (kHeld = false));
}

export function togglePlay(): void {
  if (sourceHasFocus()) getSourcePlayer().toggle();
  else transport.toggle();
}

export function shuttle(dir: 1 | -1): void {
  if (kHeld) {
    step(dir);
    return;
  }
  if (sourceHasFocus()) {
    const sp = getSourcePlayer();
    sp.shuttle(nextShuttleRate(sp.rate, dir));
  } else transport.shuttle(nextShuttleRate(getPlayer().rate, dir));
}

export function stop(): void {
  if (sourceHasFocus()) getSourcePlayer().pause();
  else transport.pause();
}

export function step(frames: number): void {
  if (sourceHasFocus()) getSourcePlayer().step(frames);
  else transport.step(frames);
}

export function goToStart(): void {
  if (sourceHasFocus()) getSourcePlayer().seek(0);
  else transport.seek(0);
}

export function goToEnd(): void {
  if (sourceHasFocus()) {
    const sp = getSourcePlayer();
    sp.seek(sp.duration);
    return;
  }
  const s = seq();
  if (s) transport.seek(sequenceDuration(s));
}

export function goToIn(): void {
  if (sourceHasFocus()) {
    const sp = getSourcePlayer();
    sp.seek(sp.asset?.markIn ?? 0);
    return;
  }
  const s = seq();
  if (s) transport.seek(s.inPoint ?? 0);
}

export function goToOut(): void {
  if (sourceHasFocus()) {
    const sp = getSourcePlayer();
    const out = sp.asset?.markOut;
    sp.seek(out !== null && out !== undefined ? outFrame(out, sp.fps) : sp.duration);
    return;
  }
  const s = seq();
  if (s) transport.seek(s.outPoint !== null ? outFrame(s.outPoint, s.fps) : sequenceDuration(s));
}

/** Clip edges on every audio and video track (Premiere's up/down arrows), plus start and end. */
function editPointList(s: Sequence): number[] {
  return sequenceEditPoints(s);
}

export function prevEdit(): void {
  const s = seq();
  if (!s) return;
  const t = prevEditPoint(editPointList(s), getPlayer().time, s.fps);
  if (t !== null) transport.seek(t);
}

export function nextEdit(): void {
  const s = seq();
  if (!s) return;
  const t = nextEditPoint(editPointList(s), getPlayer().time, s.fps);
  if (t !== null) transport.seek(t);
}

export function playAround(): void {
  getPlayer().playAround();
}

export function playInToOut(): void {
  getPlayer().playInToOut();
}

// ---- marks ---------------------------------------------------------------------

export function markIn(): void {
  if (sourceHasFocus()) return markSource('in');
  const s = seq();
  if (!s) return;
  const t = snapToFrame(getPlayer().time, s.fps);
  ed().mutateSequence('Mark in', (q) => {
    q.inPoint = t;
    if (q.outPoint !== null && q.outPoint <= t) q.outPoint = null;
  });
}

export function markOut(): void {
  if (sourceHasFocus()) return markSource('out');
  const s = seq();
  if (!s) return;
  const t = markOutAt(getPlayer().time, s.fps, sequenceDuration(s));
  ed().mutateSequence('Mark out', (q) => {
    q.outPoint = t;
    if (q.inPoint !== null && q.inPoint >= t) q.inPoint = null;
  });
}

export function clearIn(): void {
  if (sourceHasFocus()) return clearSource('in');
  if (seq()?.inPoint === null) return;
  ed().mutateSequence('Clear in', (q) => {
    q.inPoint = null;
  });
}

export function clearOut(): void {
  if (sourceHasFocus()) return clearSource('out');
  if (seq()?.outPoint === null) return;
  ed().mutateSequence('Clear out', (q) => {
    q.outPoint = null;
  });
}

export function clearInOut(): void {
  if (sourceHasFocus()) return clearSource('both');
  const s = seq();
  if (!s || (s.inPoint === null && s.outPoint === null)) return;
  ed().mutateSequence('Clear in and out', (q) => {
    q.inPoint = null;
    q.outPoint = null;
  });
}

export function markSource(which: 'in' | 'out'): void {
  const sp = getSourcePlayer();
  const a = sp.asset;
  if (!a) return;
  const t = which === 'in' ? snapToFrame(sp.time, sp.fps) : markOutAt(sp.time, sp.fps, sp.duration);
  ed().mutate(which === 'in' ? 'Mark source in' : 'Mark source out', (d) => {
    const asset = d.assets.find((x) => x.id === a.id);
    if (!asset) return;
    if (which === 'in') {
      asset.markIn = t;
      if (asset.markOut !== null && asset.markOut !== undefined && asset.markOut <= t) asset.markOut = null;
    } else {
      asset.markOut = t;
      if (asset.markIn !== null && asset.markIn !== undefined && asset.markIn >= t) asset.markIn = null;
    }
  });
}

export function clearSource(which: 'in' | 'out' | 'both'): void {
  const id = getSourcePlayer().asset?.id;
  if (!id) return;
  ed().mutate(which === 'both' ? 'Clear source in and out' : which === 'in' ? 'Clear source in' : 'Clear source out', (d) => {
    const asset = d.assets.find((x) => x.id === id);
    if (!asset) return;
    if (which !== 'out') asset.markIn = null;
    if (which !== 'in') asset.markOut = null;
  });
}

// ---- source → timeline -----------------------------------------------------------

/** Insert (,) / Overwrite (.) the source monitor's asset at the playhead. */
export function editFromSource(mode: 'insert' | 'overwrite'): void {
  const s = ed();
  const assetId = s.source.assetId;
  if (!assetId || !s.project) return;
  // The timeline owns three-point editing (targets, sequence In); use it when it is there.
  if (runAction(mode === 'insert' ? 'timeline.insert' : 'timeline.overwrite')) return;
  const at = snapToFrame(getPlayer().time, activeSequence(s.project).fps);
  try {
    let placed: string[] = [];
    s.mutate(mode === 'insert' ? 'Insert from source' : 'Overwrite from source', (d) => {
      placed = placeMedia(d, activeSequence(d), assetId, { start: at, mode });
    });
    if (placed.length) s.selectClips(placed);
  } catch (e) {
    s.showToast(`Could not place the clip: ${e instanceof Error ? e.message : String(e)}`, 'error');
  }
}

/** Match frame (F): the clip under the playhead opens in the source monitor at the same source frame. */
export function matchFrame(): void {
  if (getAction('timeline.matchFrame') && runAction('timeline.matchFrame')) {
    useViewerUi.getState().setFocus('source');
    return;
  }
  const s = ed();
  const q = seq();
  if (!q || !s.project) return;
  const t = getPlayer().time;
  const pick = (kind: 'video' | 'audio') => {
    for (const tr of q.tracks) {
      if (tr.kind !== kind || tr.muted) continue;
      const c = tr.clips.find((x) => x.enabled && x.kind === 'media' && t >= x.start - 1e-6 && t < x.start + x.duration - 1e-6);
      if (c) return c;
    }
    return null;
  };
  const sel = s.selection.clipIds.map((id) => q.tracks.flatMap((tr) => tr.clips).find((c) => c.id === id)).find((c) => c && c.kind === 'media' && t >= c.start && t < c.start + c.duration);
  const clip = sel ?? pick('video') ?? pick('audio');
  if (!clip?.assetId) return;
  const srcT = sourceTimeAt(clip, t - clip.start);
  s.setSource({ assetId: clip.assetId, time: srcT });
  getSourcePlayer().load(s.project.assets.find((a) => a.id === clip.assetId) ?? null, srcT);
  getSourcePlayer().seek(srcT);
  useViewerUi.getState().setFocus('source');
}

// ---- view ------------------------------------------------------------------------

export const ZOOM_STEPS = [0.25, 0.5, 1, 2, 4];

function currentZoom(): number {
  const z = ed().viewer.zoom;
  return z === 'fit' ? useViewerUi.getState().fitZoom : z;
}

export function zoomFit(): void {
  ed().setViewer({ zoom: 'fit' });
  useViewerUi.getState().setPan({ x: 0, y: 0 });
}

export function zoomIn(): void {
  const z = currentZoom();
  const next = ZOOM_STEPS.find((s) => s > z * 1.01) ?? ZOOM_STEPS[ZOOM_STEPS.length - 1];
  ed().setViewer({ zoom: next });
}

export function zoomOut(): void {
  const z = currentZoom();
  const prev = [...ZOOM_STEPS].reverse().find((s) => s < z * 0.99);
  if (prev === undefined || prev < useViewerUi.getState().fitZoom * 0.99) zoomFit();
  else ed().setViewer({ zoom: prev });
}

export function setZoom(z: 'fit' | number): void {
  if (z === 'fit') zoomFit();
  else ed().setViewer({ zoom: z });
}

export function toggleLoop(): void {
  ed().setViewer({ loop: !ed().viewer.loop });
}

export function toggleFullscreen(): void {
  const ui = useViewerUi.getState();
  ui.setFullscreen(!ui.fullscreen);
}

export function exportFrame(): void {
  void exportCurrentFrame();
}

export function textTool(): void {
  ed().setTool('text');
}
