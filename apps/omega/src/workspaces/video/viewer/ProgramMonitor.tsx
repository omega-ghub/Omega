// Program monitor: the sequence picture (WebGL2 renderer driven by the
// playback engine), zoom/pan, guides, compare, direct manipulation, the type
// tool, full-screen, and a compact transport. OWNED BY THE VIEWER PACKAGE.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { addGeneratedClip, placeMedia } from '../../../engine/edit/ops';
import { outFrame, scaleLabel } from '../../../engine/playback/clock';
import { boundsOf, quad, snapMove, type Vec } from '../../../engine/playback/geometry';
import { getPlayer } from '../../../engine/playback/player';
import { transport } from '../../../engine/playback/transport';
import { buildFrameGraph, type FrameGraph } from '../../../engine/render/graph';
import { formatTimecode, snapToFrame } from '../../../engine/time';
import { defaultTextProps, defaultTransform, makeClip, makeTrack } from '../../../state/defaults';
import { useEditor } from '../../../state/store';
import type { Clip, Sequence } from '../../../state/types';
import { activeSequence, sequenceDuration } from '../../../state/types';
import { I } from '../../../ui/Icons';
import { MenuButton, type MenuItem } from '../../../ui/Menu';
import * as cmd from './commands';
import { Gizmo, writeClipParams } from './Gizmo';
import { Guides } from './Guides';
import { VI } from './icons';
import { hitTest } from './layers';
import { commitTextEdit, TextEditor } from './TextEditor';
import { ScrubBar, StereoMeter, TimecodeField, useProgramState, useProgramTime } from './Transport';
import { useViewerUi } from './uiState';
import './viewer.css';

const ZOOMS: { label: string; z: 'fit' | number }[] = [
  { label: 'Fit', z: 'fit' },
  { label: '25%', z: 0.25 },
  { label: '50%', z: 0.5 },
  { label: '100%', z: 1 },
  { label: '200%', z: 2 },
  { label: '400%', z: 4 },
];

function isEditable(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  return !!el && (el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT');
}

/** Adds a title clip on the topmost free unlocked video track (used when the edit engine is unavailable). */
function addTitleFallback(seq: Sequence, start: number, init: Partial<Clip>): string {
  const dur = snapToFrame(5, seq.fps);
  const free = seq.tracks.find((tr) => tr.kind === 'video' && !tr.locked && tr.clips.every((c) => c.start >= start + dur - 1e-6 || c.start + c.duration <= start + 1e-6));
  const clip = makeClip('text', { start, duration: dur, ...init });
  if (free) free.clips.push(clip);
  else {
    const n = seq.tracks.filter((t) => t.kind === 'video').length + 1;
    const track = makeTrack('video', `V${n}`);
    track.clips.push(clip);
    seq.tracks.unshift(track);
  }
  return clip.id;
}

/** Type tool: a new title at the playhead, centered where the user clicked. */
function createTitleAt(p: Vec, W: number, H: number): void {
  const s = useEditor.getState();
  if (!s.project) return;
  const seq = activeSequence(s.project);
  const start = snapToFrame(getPlayer().time, seq.fps);
  const x = Math.round(p.x - W / 2);
  const y = Math.round(p.y - H / 2);
  const fid = seq.activeFormatId && seq.formats.some((f) => f.id === seq.activeFormatId) ? seq.activeFormatId : null;
  const init: Partial<Clip> = {
    name: 'Title',
    text: defaultTextProps(''),
    transform: { ...defaultTransform(), x: fid ? 0 : x, y: fid ? 0 : y },
    ...(fid ? { formatOverrides: { [fid]: { x, y } } } : {}),
  };
  const key = `vw-text-new-${Date.now()}`;
  const out = { id: null as string | null };
  s.mutate(
    'Add title',
    (d) => {
      const dseq = activeSequence(d);
      try {
        out.id = addGeneratedClip(d, dseq, 'text', { start, duration: 5, init });
      } catch {
        out.id = addTitleFallback(dseq, start, init);
      }
    },
    { coalesceKey: key },
  );
  if (!out.id) return;
  s.selectClips([out.id]);
  useViewerUi.getState().setTextEdit({ clipId: out.id, isNew: true, historyKey: key });
}

/** Asset ids from a media-panel drag. */
function draggedAssets(dt: DataTransfer): string[] {
  try {
    const many = dt.getData('omega/assets');
    if (many) {
      const ids = JSON.parse(many);
      if (Array.isArray(ids)) return ids.filter((x): x is string => typeof x === 'string');
    }
  } catch {
    /* fall through */
  }
  const one = dt.getData('omega/asset');
  return one ? [one] : [];
}

export function ProgramMonitor(_props: Record<string, unknown> = {}) {
  const hasProject = useEditor((s) => !!s.project);
  if (!hasProject) return null;
  return <Program />;
}

function Program() {
  const project = useEditor((s) => s.project)!;
  const seq = activeSequence(project);
  const viewer = useEditor((s) => s.viewer);
  const tool = useEditor((s) => s.tool);
  const playhead = useEditor((s) => s.playhead);
  const selection = useEditor((s) => s.selection.clipIds);
  const setViewer = useEditor((s) => s.setViewer);
  const ui = useViewerUi();
  const { playing, error, stats } = useProgramState();
  const time = useProgramTime();

  const rootRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hover = useRef(false);
  const spaceHeld = useRef(false);
  const spaceDragged = useRef(false);
  const [stage, setStage] = useState({ w: 0, h: 0 });
  const [panning, setPanning] = useState(false);
  const [dropping, setDropping] = useState(false);

  const fmt = seq.activeFormatId ? seq.formats.find((f) => f.id === seq.activeFormatId) : undefined;
  const W = fmt?.width ?? seq.width;
  const H = fmt?.height ?? seq.height;
  const duration = sequenceDuration(seq);
  const isEmpty = !seq.tracks.some((t) => t.clips.length > 0 || t.cues.length > 0);

  // ---- player hookup ----
  useEffect(() => {
    const canvas = canvasRef.current!;
    const player = getPlayer();
    player.attach(canvas);
    return () => player.detach(canvas);
  }, []);

  useLayoutEffect(() => {
    const el = stageRef.current!;
    const measure = () => setStage({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ---- viewport ----
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  const pad = ui.fullscreen ? 0 : 12;
  const fitK = stage.w > 0 && stage.h > 0 ? Math.max(0.005, Math.min((stage.w - 2 * pad) / W, (stage.h - 2 * pad) / H)) : 0;
  const k = viewer.zoom === 'fit' ? fitK : viewer.zoom / dpr;
  const fw = W * k;
  const fh = H * k;
  const pan = viewer.zoom === 'fit' ? { x: 0, y: 0 } : ui.pan;
  const left = (stage.w - fw) / 2 + pan.x;
  const top = (stage.h - fh) / 2 + pan.y;

  useEffect(() => {
    if (fitK > 0) useViewerUi.getState().setFitZoom(fitK * dpr);
  }, [fitK, dpr]);

  useEffect(() => {
    getPlayer().setDisplaySize(fw * dpr, fh * dpr);
  }, [fw, fh, dpr]);

  useEffect(() => {
    const p = getPlayer();
    p.transparentBackground = ui.checkerboard;
    p.invalidate();
  }, [ui.checkerboard]);

  // The paused frame's graph, for the overlays (gizmo, text editing, click-to-select).
  const graph: FrameGraph | null = useMemo(() => {
    if (playing) return null;
    try {
      return buildFrameGraph(project, seq.id, playhead, { formatId: seq.activeFormatId });
    } catch {
      return null;
    }
  }, [project, seq.id, seq.activeFormatId, playhead, playing]);

  const toSeq = (e: { clientX: number; clientY: number }): Vec => {
    const r = frameRef.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / Math.max(1, r.width)) * W, y: ((e.clientY - r.top) / Math.max(1, r.height)) * H };
  };

  // ---- space-drag panning (Space alone still plays / pauses) ----
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || !hover.current || useEditor.getState().viewer.zoom === 'fit' || isEditable(e.target) || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      e.preventDefault();
      e.stopPropagation();
      if (!spaceHeld.current) {
        spaceHeld.current = true;
        spaceDragged.current = false;
        setPanning(true);
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || !spaceHeld.current) return;
      e.preventDefault();
      e.stopPropagation();
      spaceHeld.current = false;
      setPanning(false);
      if (!spaceDragged.current) cmd.togglePlay();
    };
    window.addEventListener('keydown', down, true);
    window.addEventListener('keyup', up, true);
    return () => {
      window.removeEventListener('keydown', down, true);
      window.removeEventListener('keyup', up, true);
    };
  }, []);

  // ---- wheel: Ctrl/Cmd zooms around the cursor, plain wheel pans when zoomed ----
  const view = useRef({ k, left, top, stage, W, H, dpr });
  view.current = { k, left, top, stage, W, H, dpr };
  useEffect(() => {
    const el = stageRef.current!;
    const onWheel = (e: WheelEvent) => {
      const v = view.current;
      const s = useEditor.getState();
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const r = el.getBoundingClientRect();
        const cx = e.clientX - r.left;
        const cy = e.clientY - r.top;
        const z0 = v.k * v.dpr;
        const z1 = Math.max(0.05, Math.min(8, z0 * Math.exp(-e.deltaY * 0.0025)));
        const k1 = z1 / v.dpr;
        const sx = (cx - v.left) / v.k;
        const sy = (cy - v.top) / v.k;
        const pan1 = { x: cx - sx * k1 - (v.stage.w - v.W * k1) / 2, y: cy - sy * k1 - (v.stage.h - v.H * k1) / 2 };
        s.setViewer({ zoom: Math.round(z1 * 1000) / 1000 });
        useViewerUi.getState().setPan(pan1);
      } else if (s.viewer.zoom !== 'fit') {
        e.preventDefault();
        const p = useViewerUi.getState().pan;
        useViewerUi.getState().setPan({ x: p.x - e.deltaX, y: p.y - e.deltaY });
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // ---- full screen ----
  useEffect(() => {
    if (!ui.fullscreen) return;
    const root = rootRef.current;
    if (root && !document.fullscreenElement) root.requestFullscreen?.().catch(() => {});
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        useViewerUi.getState().setFullscreen(false);
      }
    };
    const onFs = () => {
      if (!document.fullscreenElement) useViewerUi.getState().setFullscreen(false);
    };
    window.addEventListener('keydown', onKey, true);
    document.addEventListener('fullscreenchange', onFs);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      document.removeEventListener('fullscreenchange', onFs);
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    };
  }, [ui.fullscreen]);

  // Leaving a selection or the text tool ends crop mode / mask editing that no longer applies.
  useEffect(() => {
    const u = useViewerUi.getState();
    if (u.activeMask && !selection.includes(u.activeMask.clipId)) u.setActiveMask(null);
  }, [selection]);

  // ---- pointer on the stage ----
  const startPan = (e: React.PointerEvent) => {
    e.preventDefault();
    const sx = e.clientX;
    const sy = e.clientY;
    const p0 = useViewerUi.getState().pan;
    setPanning(true);
    const move = (ev: PointerEvent) => {
      spaceDragged.current = true;
      useViewerUi.getState().setPan({ x: p0.x + ev.clientX - sx, y: p0.y + ev.clientY - sy });
    };
    const end = () => {
      if (!spaceHeld.current) setPanning(false);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
  };

  /** Click on a layer: select it, and drag to move it straight away. */
  const quickMove = (e: React.PointerEvent, clipId: string, start: Vec) => {
    const s = useEditor.getState();
    if (!graph) return;
    const hit = hitTest(graph, start);
    if (!hit) return;
    const tf0 = hit.node.transform;
    const bounds0 = boundsOf(quad(hit.m, hit.box));
    const key = `vw-move-${clipId}-${Date.now()}`;
    let moved = false;
    const move = (ev: PointerEvent) => {
      const p = toSeq(ev);
      let dx = p.x - start.x;
      let dy = p.y - start.y;
      if (!moved && Math.hypot(dx * k, dy * k) < 3) return;
      moved = true;
      if (ev.shiftKey) {
        if (Math.abs(dx) > Math.abs(dy)) dy = 0;
        else dx = 0;
      }
      if (s.snapping !== (ev.ctrlKey || ev.metaKey)) {
        const r = snapMove(bounds0, dx, dy, W, H, 8 / Math.max(1e-6, k));
        dx = r.dx;
        dy = r.dy;
      }
      writeClipParams(clipId, { 'transform.x': tf0.x + dx, 'transform.y': tf0.y + dy }, 'Move', key);
    };
    const end = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    e.preventDefault();
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button === 1 || (e.button === 0 && (tool === 'hand' || spaceHeld.current))) {
      if (viewer.zoom !== 'fit') startPan(e);
      return;
    }
    if (e.button !== 0 || !frameRef.current) return;
    const u = useViewerUi.getState();
    if (u.textEdit) return; // the editor's blur commits it
    const p = toSeq(e);
    const s = useEditor.getState();
    if (tool === 'text') {
      if (playing) transport.pause();
      e.preventDefault();
      const g = graph ?? buildFrameGraph(project, seq.id, getPlayer().time, { formatId: seq.activeFormatId });
      const textHit = hitTest(g, p, { textOnly: true });
      if (textHit) {
        s.selectClips([textHit.node.clipId]);
        u.setTextEdit({ clipId: textHit.node.clipId, isNew: false });
      } else if (p.x >= 0 && p.y >= 0 && p.x <= W && p.y <= H) createTitleAt(p, W, H);
      return;
    }
    if (u.activeMask) {
      u.setActiveMask(null);
      return;
    }
    if (!graph) return;
    const hit = hitTest(graph, p);
    if (hit) {
      if (!s.selection.clipIds.includes(hit.node.clipId)) s.selectClips([hit.node.clipId]);
      quickMove(e, hit.node.clipId, p);
    } else if (s.selection.clipIds.length) s.clearSelection();
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    if (!graph || !frameRef.current) return;
    const hit = hitTest(graph, toSeq(e), { textOnly: true });
    if (!hit) return;
    useEditor.getState().selectClips([hit.node.clipId]);
    useViewerUi.getState().setTextEdit({ clipId: hit.node.clipId, isNew: false });
  };

  // ---- drop media from the media panel: overwrite at the playhead ----
  const onDragOver = (e: React.DragEvent) => {
    const types = [...e.dataTransfer.types];
    if (!types.includes('omega/asset') && !types.includes('omega/assets')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setDropping(true);
  };
  const onDrop = (e: React.DragEvent) => {
    setDropping(false);
    const ids = draggedAssets(e.dataTransfer);
    if (!ids.length) return;
    e.preventDefault();
    e.stopPropagation();
    const s = useEditor.getState();
    let at = snapToFrame(getPlayer().time, seq.fps);
    try {
      s.mutate('Overwrite', (d) => {
        const dseq = activeSequence(d);
        for (const id of ids) {
          const placed = placeMedia(d, dseq, id, { start: at, mode: 'overwrite' });
          for (const cid of placed) for (const tr of dseq.tracks) for (const c of tr.clips) if (c.id === cid) at = Math.max(at, c.start + c.duration);
        }
      });
    } catch (err) {
      s.showToast(`Could not place the media: ${err instanceof Error ? err.message : String(err)}`, 'error');
    }
  };

  // ---- header menus ----
  const zoomLabel = viewer.zoom === 'fit' ? 'Fit' : `${Math.round(viewer.zoom * 100)}%`;
  const zoomItems = (): MenuItem[] => [
    ...ZOOMS.map((z) => ({ label: z.label, checked: viewer.zoom === z.z, onSelect: () => cmd.setZoom(z.z), testId: `vw-zoom-${z.label.replace('%', '')}` })),
    { type: 'separator' as const },
    { label: 'Zoom in', action: 'viewer.zoomIn' },
    { label: 'Zoom out', action: 'viewer.zoomOut' },
  ];
  const resLabel = viewer.playbackScale === 'auto' ? (playing ? `Auto · ${scaleLabel(stats.scale)}` : 'Auto') : scaleLabel(viewer.playbackScale);
  const resItems = (): MenuItem[] => [
    { type: 'header', label: 'Playback resolution' },
    { label: 'Auto', checked: viewer.playbackScale === 'auto', onSelect: () => setViewer({ playbackScale: 'auto' }), testId: 'vw-res-auto' },
    { label: 'Full', checked: viewer.playbackScale === 1, onSelect: () => setViewer({ playbackScale: 1 }), testId: 'vw-res-full' },
    { label: '1/2', checked: viewer.playbackScale === 0.5, onSelect: () => setViewer({ playbackScale: 0.5 }), testId: 'vw-res-half' },
    { label: '1/4', checked: viewer.playbackScale === 0.25, onSelect: () => setViewer({ playbackScale: 0.25 }), testId: 'vw-res-quarter' },
  ];
  const selectedVisual = selection.some((id) => seq.tracks.some((t) => t.kind === 'video' && t.clips.some((c) => c.id === id && c.kind !== 'adjustment')));
  const overlayItems = (): MenuItem[] => [
    { label: 'Safe areas', checked: viewer.safeAreas, onSelect: () => setViewer({ safeAreas: !viewer.safeAreas }), testId: 'vw-ov-safe' },
    { type: 'header', label: 'Grid' },
    { label: 'Off', checked: viewer.grid === 'off', onSelect: () => setViewer({ grid: 'off' }), testId: 'vw-ov-grid-off' },
    { label: 'Rule of thirds', checked: viewer.grid === 'thirds', onSelect: () => setViewer({ grid: 'thirds' }), testId: 'vw-ov-grid-thirds' },
    { label: 'Center cross', checked: viewer.grid === 'center', onSelect: () => setViewer({ grid: 'center' }), testId: 'vw-ov-grid-center' },
    { label: 'Golden ratio', checked: viewer.grid === 'golden', onSelect: () => setViewer({ grid: 'golden' }), testId: 'vw-ov-grid-golden' },
    { type: 'header', label: 'Compare grades' },
    { label: 'Off', checked: viewer.compare === 'off', onSelect: () => setViewer({ compare: 'off' }), testId: 'vw-ov-compare-off' },
    { label: 'Split wipe', checked: viewer.compare === 'split', onSelect: () => setViewer({ compare: 'split' }), testId: 'vw-ov-compare-split' },
    { label: 'Bypass grades', checked: viewer.compare === 'bypass', onSelect: () => setViewer({ compare: 'bypass' }), testId: 'vw-ov-compare-bypass' },
    { type: 'separator' },
    { label: 'Show qualifier matte', checked: viewer.showMatte, disabled: !selectedVisual && !viewer.showMatte, onSelect: () => setViewer({ showMatte: !viewer.showMatte }), testId: 'vw-ov-matte' },
    { label: 'Transparency checkerboard', checked: ui.checkerboard, onSelect: () => ui.setCheckerboard(!ui.checkerboard), testId: 'vw-ov-checker' },
    { label: 'Loop playback', checked: viewer.loop, onSelect: cmd.toggleLoop, shortcut: 'Alt+L', testId: 'vw-ov-loop' },
  ];
  const overlaysOn = viewer.safeAreas || viewer.grid !== 'off' || viewer.compare !== 'off' || viewer.showMatte || ui.checkerboard;
  const proxiesReady = project.assets.filter((a) => a.proxyStatus === 'ready' && a.proxyPath).length;

  const tc = (t: number) => formatTimecode(t, seq.fps, seq.dropFrame, seq.startTimecode);
  const rangeIn = seq.inPoint;
  const rangeOut = seq.outPoint;
  const rangeDur = rangeIn !== null || rangeOut !== null ? Math.max(0, (rangeOut ?? duration) - (rangeIn ?? 0)) : null;
  const cursor = panning ? 'grabbing' : tool === 'hand' && viewer.zoom !== 'fit' ? 'grab' : tool === 'text' ? 'text' : undefined;

  return (
    <div
      ref={rootRef}
      className={`vw-monitor vw-program ${ui.fullscreen ? 'vw-program--full' : ''}`}
      data-testid="vw-program"
      data-vw-monitor="program"
      aria-label="Program monitor"
    >
      <div
        ref={stageRef}
        className={`vw-stage ${dropping ? 'is-drop' : ''}`}
        style={{ cursor }}
        onPointerDown={onPointerDown}
        onDoubleClick={onDoubleClick}
        onPointerEnter={() => (hover.current = true)}
        onPointerLeave={() => (hover.current = false)}
        onDragOver={onDragOver}
        onDragLeave={() => setDropping(false)}
        onDrop={onDrop}
        onContextMenu={(e) => e.preventDefault()}
      >
        <div
          ref={frameRef}
          className={`vw-frame ${ui.checkerboard ? 'vw-frame--checker' : ''}`}
          style={{ left, top, width: fw, height: fh, visibility: fitK > 0 ? 'visible' : 'hidden' }}
        >
          <canvas ref={canvasRef} className={`vw-canvas ${k * dpr > 1.01 ? 'is-pixelated' : ''}`} data-testid="vw-canvas" />
          <Guides W={W} H={H} k={k} />
          {graph && !ui.textEdit && <Gizmo graph={graph} k={k} frame={frameRef} />}
          {graph && ui.textEdit && <TextEditor key={ui.textEdit.clipId} edit={ui.textEdit} graph={graph} k={k} />}
        </div>
        {isEmpty && !error && (
          <div className="vw-empty" data-testid="vw-empty">
            <I.Film size={22} />
            <div className="vw-empty__title">Nothing to play yet</div>
            <div className="vw-empty__sub">Import media, then drag it onto the timeline or here.</div>
          </div>
        )}
        {error && (
          <div className="vw-error" data-testid="vw-error" role="alert">
            <VI.Warning size={20} />
            <div className="vw-error__title">The picture can’t be shown</div>
            <div className="vw-error__sub">{error}</div>
          </div>
        )}
        {ui.textEdit && (
          <button
            type="button"
            className="vw-text-done"
            data-testid="vw-text-done"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => {
              const edit = useViewerUi.getState().textEdit;
              if (edit) commitTextEdit(edit, document.querySelector<HTMLElement>('[data-testid="vw-text-editor"]')?.innerText ?? '');
            }}
          >
            Done
          </button>
        )}
      </div>

      <footer className="vw-transport">
        <ScrubBar time={time} duration={duration} inPoint={rangeIn} outPoint={rangeOut} onScrub={(t) => getPlayer().scrub(t)} testId="vw-scrub" />
        <div className="vw-bar">
          <div className="vw-bar__left">
            <TimecodeField time={time} fps={seq.fps} dropFrame={seq.dropFrame} startTimecode={seq.startTimecode} onCommit={(t) => transport.seek(t)} testId="vw-timecode" />
            {playing && (
              <span className="vw-fps" data-testid="vw-fps">
                {stats.fps.toFixed(stats.fps >= 100 ? 0 : 1)} fps
              </span>
            )}
            {stats.dropped > 0 && (
              <button type="button" className="vw-dropped" data-testid="vw-dropped" data-tip="Dropped frames since playback started (click to reset)" onClick={() => getPlayer().resetDropped()}>
                {stats.dropped} dropped
              </button>
            )}
            <div className="vw-readouts" data-testid="vw-readouts">
              <span className="vw-readout">
                <span className="vw-readout__k">In</span>
                <span className="tc" data-testid="vw-in">
                  {rangeIn !== null ? tc(rangeIn) : '–'}
                </span>
              </span>
              <span className="vw-readout">
                <span className="vw-readout__k">Out</span>
                <span className="tc" data-testid="vw-out">
                  {rangeOut !== null ? tc(outFrame(rangeOut, seq.fps)) : '–'}
                </span>
              </span>
              <span className="vw-readout">
                <span className="vw-readout__k">Dur</span>
                <span className="tc" data-testid="vw-duration">
                  {formatTimecode(rangeDur ?? duration, seq.fps, seq.dropFrame)}
                </span>
              </span>
            </div>
          </div>
          <div className="vw-bar__right">
            {seq.formats.length > 0 && (
              <select
                className="vw-select"
                value={seq.activeFormatId ?? ''}
                data-testid="vw-format-select"
                data-tip="Format (multi-aspect)"
                onChange={(e) => {
                  const id = e.target.value || null;
                  useEditor.getState().mutateSequence('Switch format', (q) => {
                    q.activeFormatId = id;
                  });
                }}
              >
                <option value="">
                  Main · {seq.width}×{seq.height}
                </option>
                {seq.formats.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name} · {f.width}×{f.height}
                  </option>
                ))}
              </select>
            )}
            <MenuButton className="vw-chip" items={zoomItems} testId="vw-zoom-menu" tip="Zoom">
              {zoomLabel}
              <I.ChevronDown size={11} />
            </MenuButton>
            <MenuButton className="vw-chip" items={resItems} testId="vw-res-menu" tip="Playback resolution">
              {resLabel}
              <I.ChevronDown size={11} />
            </MenuButton>
            <button
              type="button"
              className={`icon-btn icon-btn--xs ${viewer.useProxies ? 'is-on' : ''}`}
              aria-pressed={viewer.useProxies}
              data-testid="vw-proxy-toggle"
              data-tip={`Use proxies for playback (${proxiesReady} ready)`}
              onClick={() => setViewer({ useProxies: !viewer.useProxies })}
            >
              <VI.Proxy size={15} />
            </button>
            <MenuButton className={`icon-btn icon-btn--xs ${overlaysOn ? 'is-on' : ''}`} items={overlayItems} testId="vw-overlays-menu" tip="Guides, compare and overlays">
              <VI.Overlays size={15} />
            </MenuButton>
            {selectedVisual && (
              <button
                type="button"
                className={`icon-btn icon-btn--xs ${ui.cropMode ? 'is-on' : ''}`}
                aria-pressed={ui.cropMode}
                data-testid="vw-crop-toggle"
                data-tip="Crop in the viewer"
                onClick={() => ui.setCropMode(!ui.cropMode)}
              >
                <VI.Crop size={15} />
              </button>
            )}
            <button type="button" className="icon-btn icon-btn--xs" data-testid="vw-export-frame" data-tip-action="viewer.exportFrame" onClick={cmd.exportFrame}>
              <VI.Camera size={15} />
            </button>
            <button type="button" className="icon-btn icon-btn--xs" data-testid="vw-fullscreen" data-tip-action="viewer.fullscreen" onClick={cmd.toggleFullscreen}>
              {ui.fullscreen ? <VI.ExitFullscreen size={15} /> : <VI.Fullscreen size={15} />}
            </button>
          </div>
        </div>
        <div className="vw-row">
          <div className="vw-row__left vw-btns">
            <button type="button" className={`icon-btn icon-btn--sm ${rangeIn !== null ? 'is-mark' : ''}`} data-testid="vw-mark-in" data-tip="Mark in" data-tip-keys="I" onClick={() => runOnProgram(cmd.markIn)}>
              <VI.MarkIn size={16} />
            </button>
            <button type="button" className={`icon-btn icon-btn--sm ${rangeOut !== null ? 'is-mark' : ''}`} data-testid="vw-mark-out" data-tip="Mark out" data-tip-keys="O" onClick={() => runOnProgram(cmd.markOut)}>
              <VI.MarkOut size={16} />
            </button>
            <button type="button" className="icon-btn icon-btn--sm vw-opt" data-testid="vw-clear-inout" data-tip-action="viewer.clearInOut" disabled={rangeIn === null && rangeOut === null} onClick={() => runOnProgram(cmd.clearInOut)}>
              <VI.ClearInOut size={16} />
            </button>
          </div>
          <div className="vw-row__center vw-btns">
            <button type="button" className="icon-btn icon-btn--sm vw-opt" data-testid="vw-goto-in" data-tip-action="viewer.goToIn" onClick={cmd.goToIn}>
              <VI.GoIn size={16} />
            </button>
            <button type="button" className="icon-btn icon-btn--sm vw-opt" data-testid="vw-prev-edit" data-tip="Previous edit point" data-tip-keys="ArrowUp" onClick={cmd.prevEdit}>
              <VI.PrevEdit size={16} />
            </button>
            <button type="button" className="icon-btn icon-btn--sm" data-testid="vw-step-back" data-tip-action="viewer.stepBack" onClick={() => transport.step(-1)}>
              <I.StepBack size={16} />
            </button>
            <button type="button" className="icon-btn icon-btn--primary vw-play" data-testid="vw-play" data-tip-action="viewer.playPause" aria-label={playing ? 'Pause' : 'Play'} onClick={() => transport.toggle()}>
              {playing ? <I.Pause size={15} /> : <I.Play size={15} />}
            </button>
            <button type="button" className="icon-btn icon-btn--sm" data-testid="vw-step-forward" data-tip-action="viewer.stepForward" onClick={() => transport.step(1)}>
              <I.StepForward size={16} />
            </button>
            <button type="button" className="icon-btn icon-btn--sm vw-opt" data-testid="vw-next-edit" data-tip="Next edit point" data-tip-keys="ArrowDown" onClick={cmd.nextEdit}>
              <VI.NextEdit size={16} />
            </button>
            <button type="button" className="icon-btn icon-btn--sm vw-opt" data-testid="vw-goto-out" data-tip-action="viewer.goToOut" onClick={cmd.goToOut}>
              <VI.GoOut size={16} />
            </button>
          </div>
          <div className="vw-row__right vw-btns">
            <button type="button" className={`icon-btn icon-btn--sm ${viewer.loop ? 'is-on' : ''}`} aria-pressed={viewer.loop} data-testid="vw-loop" data-tip-action="viewer.toggleLoop" onClick={cmd.toggleLoop}>
              <VI.Loop size={16} />
            </button>
            <StereoMeter testId="vw-meter" />
          </div>
        </div>
      </footer>
    </div>
  );
}

/** Program-monitor buttons always act on the sequence, whichever monitor has keyboard focus. */
function runOnProgram(fn: () => void): void {
  const ui = useViewerUi.getState();
  const prev = ui.focus;
  ui.setFocus('program');
  try {
    fn();
  } finally {
    if (prev !== 'program') ui.setFocus(prev);
  }
}
