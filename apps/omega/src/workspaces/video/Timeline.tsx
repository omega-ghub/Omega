import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { formatTimecode, useStore } from '../../state/store';
import type { Clip, Track } from '../../state/types';
import { sequenceDuration } from '../../state/types';
import { I } from '../../ui/Icons';
import { playerHost } from './playerHost';

const HEADER_W = 150;
const RULER_H = 28;
const TRACK_H: Record<Track['kind'], number> = { video: 60, audio: 44 };
const SNAP_PX = 8;

interface DragState {
  kind: 'move' | 'trim-start' | 'trim-end';
  clipId: string;
  linkId?: string;
  originX: number;
  originStart: number;
  originEnd: number;
  trackId: string;
  trackKind: Track['kind'];
  // live values while dragging
  start: number;
  end: number;
  overTrackId: string;
}

export function Timeline() {
  const project = useStore((s) => s.project)!;
  const zoom = useStore((s) => s.zoom);
  const setZoom = useStore((s) => s.setZoom);
  const playhead = useStore((s) => s.playhead);
  const playing = useStore((s) => s.playing);
  const tool = useStore((s) => s.tool);
  const setTool = useStore((s) => s.setTool);
  const selected = useStore((s) => s.selectedClipIds);
  const selectClips = useStore((s) => s.selectClips);
  const inPoint = useStore((s) => s.inPoint);
  const outPoint = useStore((s) => s.outPoint);
  const splitAtPlayhead = useStore((s) => s.splitAtPlayhead);
  const deleteSelected = useStore((s) => s.deleteSelected);
  const addTrack = useStore((s) => s.addTrack);
  const toggleTrackMute = useStore((s) => s.toggleTrackMute);
  const toggleTrackLock = useStore((s) => s.toggleTrackLock);
  const moveClip = useStore((s) => s.moveClip);
  const trimClip = useStore((s) => s.trimClip);
  const splitClip = useStore((s) => s.splitClip);
  const addClip = useStore((s) => s.addClip);
  const [snap, setSnap] = useState(true);
  const [drag, setDrag] = useState<DragState | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const { tracks } = project.sequence;
  const duration = sequenceDuration(project.sequence);
  const { fps, dropFrame } = project.settings;
  const contentSeconds = Math.max(duration + 30, 60);
  const contentWidth = contentSeconds * zoom;

  const timeAt = useCallback(
    (clientX: number) => {
      const el = scrollRef.current;
      if (!el) return 0;
      const rect = el.getBoundingClientRect();
      return Math.max(0, (clientX - rect.left - HEADER_W + el.scrollLeft) / zoom);
    },
    [zoom],
  );

  const snapPoints = useMemo(() => {
    const pts = [0, playhead];
    for (const t of tracks) for (const c of t.clips) pts.push(c.start, c.start + c.duration);
    return pts;
  }, [tracks, playhead]);

  const applySnap = useCallback(
    (t: number, exclude?: { start: number; end: number }) => {
      if (!snap) return t;
      let best = t;
      let bestDist = SNAP_PX / zoom;
      for (const p of snapPoints) {
        if (exclude && (Math.abs(p - exclude.start) < 1e-6 || Math.abs(p - exclude.end) < 1e-6)) continue;
        const d = Math.abs(p - t);
        if (d < bestDist) {
          bestDist = d;
          best = p;
        }
      }
      return best;
    },
    [snap, snapPoints, zoom],
  );

  // Keep the playhead in view while playing.
  useEffect(() => {
    if (!playing) return;
    const el = scrollRef.current;
    if (!el) return;
    const x = playhead * zoom;
    const viewLeft = el.scrollLeft;
    const viewWidth = el.clientWidth - HEADER_W;
    if (x < viewLeft || x > viewLeft + viewWidth - 40) el.scrollLeft = Math.max(0, x - 40);
  }, [playhead, playing, zoom]);

  const scrub = (e: RPointerEvent<HTMLDivElement>) => {
    playerHost.current?.pause();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const update = (clientX: number) => {
      const t = Math.min(timeAt(clientX), duration);
      playerHost.current?.seek(t);
      useStore.getState().setPlayhead(t);
    };
    update(e.clientX);
    const move = (ev: PointerEvent) => update(ev.clientX);
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  };

  const trackAtY = (clientY: number): Track | null => {
    const el = scrollRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    let y = clientY - rect.top + el.scrollTop - RULER_H;
    for (const t of tracks) {
      const h = TRACK_H[t.kind];
      if (y >= 0 && y < h) return t;
      y -= h;
    }
    return null;
  };

  const onClipPointerDown = (e: RPointerEvent<HTMLDivElement>, clip: Clip, track: Track, kind: DragState['kind']) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    if (tool === 'razor') {
      splitClip(clip.id, applySnap(timeAt(e.clientX)));
      return;
    }
    if (!selected.includes(clip.id)) selectClips([clip.id], e.shiftKey);
    else if (e.shiftKey) selectClips([clip.id], true);
    if (track.locked) return;
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const origin: DragState = {
      kind,
      clipId: clip.id,
      linkId: clip.linkId,
      originX: e.clientX,
      originStart: clip.start,
      originEnd: clip.start + clip.duration,
      trackId: track.id,
      trackKind: track.kind,
      start: clip.start,
      end: clip.start + clip.duration,
      overTrackId: track.id,
    };
    let state = origin;
    let moved = false;
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - origin.originX) / zoom;
      if (Math.abs(ev.clientX - origin.originX) > 2) moved = true;
      const exclude = { start: origin.originStart, end: origin.originEnd };
      if (kind === 'move') {
        let start = Math.max(0, origin.originStart + dx);
        const len = origin.originEnd - origin.originStart;
        const snappedStart = applySnap(start, exclude);
        const snappedEnd = applySnap(start + len, exclude);
        if (snappedStart !== start) start = snappedStart;
        else if (snappedEnd !== start + len) start = snappedEnd - len;
        const over = trackAtY(ev.clientY);
        state = { ...origin, start, end: start + len, overTrackId: over && over.kind === origin.trackKind ? over.id : origin.trackId };
      } else if (kind === 'trim-start') {
        const start = applySnap(Math.min(origin.originStart + dx, origin.originEnd - 1 / fps), exclude);
        state = { ...origin, start: Math.max(0, start) };
      } else {
        const end = applySnap(Math.max(origin.originEnd + dx, origin.originStart + 1 / fps), exclude);
        state = { ...origin, end };
      }
      setDrag(state);
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      setDrag(null);
      if (!moved) return;
      if (kind === 'move') moveClip(clip.id, state.start, state.overTrackId);
      else if (kind === 'trim-start') trimClip(clip.id, 'start', state.start);
      else trimClip(clip.id, 'end', state.end);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  };

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const assetId = e.dataTransfer.getData('omega/asset');
    if (!assetId) return;
    const track = trackAtY(e.clientY);
    addClip(assetId, track?.id ?? null, applySnap(timeAt(e.clientX)));
  };

  const onWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (e.altKey || e.ctrlKey) {
      e.preventDefault();
      setZoom(zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15));
    } else if (!e.shiftKey && Math.abs(e.deltaY) > Math.abs(e.deltaX) && scrollRef.current) {
      // vertical wheel scrolls the timeline horizontally, like most editors
      scrollRef.current.scrollLeft += e.deltaY;
      e.preventDefault();
    }
  };

  const ticks = useMemo(() => {
    const candidates = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
    const step = candidates.find((c) => c * zoom >= 90) ?? 600;
    const out: { t: number; label: string }[] = [];
    for (let t = 0; t <= contentSeconds; t += step) out.push({ t, label: formatTimecode(t, fps, dropFrame).slice(3) });
    return { step, out };
  }, [zoom, contentSeconds, fps, dropFrame]);

  const liveClip = (clip: Clip, track: Track) => {
    if (!drag) return { start: clip.start, end: clip.start + clip.duration, trackId: track.id, ghost: false };
    const isTarget = drag.clipId === clip.id;
    const isLinked = !!drag.linkId && clip.linkId === drag.linkId && !isTarget;
    if (!isTarget && !isLinked) return { start: clip.start, end: clip.start + clip.duration, trackId: track.id, ghost: false };
    if (drag.kind === 'move') {
      const delta = drag.start - drag.originStart;
      return { start: clip.start + delta, end: clip.start + clip.duration + delta, trackId: isTarget ? drag.overTrackId : track.id, ghost: true };
    }
    if (drag.kind === 'trim-start') return { start: drag.start, end: clip.start + clip.duration, trackId: track.id, ghost: true };
    return { start: clip.start, end: drag.end, trackId: track.id, ghost: true };
  };

  const trackTop = (id: string) => {
    let y = RULER_H;
    for (const t of tracks) {
      if (t.id === id) return y;
      y += TRACK_H[t.kind];
    }
    return y;
  };
  const totalHeight = RULER_H + tracks.reduce((a, t) => a + TRACK_H[t.kind], 0);

  return (
    <section className="tl">
      <div className="tl__toolbar">
        <div className="tl__tools">
          <button className={`icon-btn ${tool === 'select' ? 'is-on' : ''}`} title="Selection tool (V)" onClick={() => setTool('select')}>
            <I.Cursor />
          </button>
          <button className={`icon-btn ${tool === 'razor' ? 'is-on' : ''}`} title="Razor tool (C)" onClick={() => setTool('razor')}>
            <I.Scissors />
          </button>
          <span className="tl__sep" />
          <button className="icon-btn" title="Add edit at playhead (Ctrl+K)" onClick={splitAtPlayhead}>
            <I.Scissors size={16} />
            <span className="icon-btn__label">Split</span>
          </button>
          <button className="icon-btn" title="Delete selected (Delete)" onClick={deleteSelected} disabled={selected.length === 0}>
            <I.Trash />
          </button>
          <span className="tl__sep" />
          <button className={`icon-btn ${snap ? 'is-on' : ''}`} title="Snap" onClick={() => setSnap((v) => !v)}>
            <I.Magnet />
          </button>
        </div>
        <div className="tl__center tc">{formatTimecode(playhead, fps, dropFrame)}</div>
        <div className="tl__tools">
          <button className="icon-btn" title="Add video track" onClick={() => addTrack('video')}>
            <I.Plus size={16} />
            <span className="icon-btn__label">V</span>
          </button>
          <button className="icon-btn" title="Add audio track" onClick={() => addTrack('audio')}>
            <I.Plus size={16} />
            <span className="icon-btn__label">A</span>
          </button>
          <span className="tl__sep" />
          <button className="icon-btn" title="Zoom out (-)" onClick={() => setZoom(zoom / 1.25)}>
            <I.ZoomOut />
          </button>
          <input type="range" className="tl__zoom" min={4} max={600} step={1} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} />
          <button className="icon-btn" title="Zoom in (=)" onClick={() => setZoom(zoom * 1.25)}>
            <I.ZoomIn />
          </button>
        </div>
      </div>

      <div className={`tl__scroll ${tool === 'razor' ? 'tool-razor' : ''}`} ref={scrollRef} onWheel={onWheel} onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
        <div className="tl__content" style={{ width: HEADER_W + contentWidth, height: totalHeight }}>
          {/* headers */}
          <div className="tl__headers" style={{ width: HEADER_W }}>
            <div className="tl__corner" style={{ height: RULER_H }} />
            {tracks.map((t) => (
              <div key={t.id} className={`tl__head tl__head--${t.kind}`} style={{ height: TRACK_H[t.kind] }}>
                <span className="tl__head-name">{t.name}</span>
                <span className="tl__head-btns">
                  <button className={`mini ${t.muted ? 'is-on' : ''}`} title={t.muted ? 'Unmute' : 'Mute'} onClick={() => toggleTrackMute(t.id)}>
                    {t.muted ? <I.Mute size={13} /> : <I.Speaker size={13} />}
                  </button>
                  <button className={`mini ${t.locked ? 'is-on' : ''}`} title={t.locked ? 'Unlock' : 'Lock'} onClick={() => toggleTrackLock(t.id)}>
                    {t.locked ? <I.Lock size={13} /> : <I.Unlock size={13} />}
                  </button>
                </span>
              </div>
            ))}
          </div>

          {/* ruler */}
          <div className="tl__ruler" style={{ left: HEADER_W, width: contentWidth, height: RULER_H }} onPointerDown={scrub}>
            {ticks.out.map((tick) => (
              <div key={tick.t} className="tl__tick" style={{ left: tick.t * zoom }}>
                <span>{tick.label}</span>
              </div>
            ))}
            {hasRange(inPoint, outPoint) && <div className="tl__range" style={{ left: inPoint! * zoom, width: (outPoint! - inPoint!) * zoom }} />}
          </div>

          {/* lanes */}
          <div className="tl__lanes" style={{ left: HEADER_W, top: RULER_H, width: contentWidth }} onPointerDown={(e) => e.target === e.currentTarget && selectClips([])}>
            {tracks.map((t) => (
              <div key={t.id} className={`tl__lane tl__lane--${t.kind} ${t.locked ? 'is-locked' : ''} ${t.muted ? 'is-muted' : ''}`} style={{ height: TRACK_H[t.kind] }} onPointerDown={(e) => e.target === e.currentTarget && selectClips([])} />
            ))}
          </div>

          {/* clips (absolutely positioned so they can move across lanes while dragging) */}
          {tracks.map((track) =>
            track.clips.map((clip) => {
              const live = liveClip(clip, track);
              const top = trackTop(live.trackId);
              const h = TRACK_H[track.kind];
              const isSel = selected.includes(clip.id);
              return (
                <div
                  key={clip.id}
                  className={`clip clip--${track.kind} ${isSel ? 'is-selected' : ''} ${live.ghost ? 'is-ghost' : ''} ${track.locked ? 'is-locked' : ''}`}
                  style={{ left: HEADER_W + live.start * zoom, top: top + 3, width: Math.max(2, (live.end - live.start) * zoom), height: h - 6 }}
                  onPointerDown={(e) => onClipPointerDown(e, clip, track, 'move')}
                  title={clip.name}
                >
                  <div className="clip__handle clip__handle--l" onPointerDown={(e) => onClipPointerDown(e, clip, track, 'trim-start')} />
                  <div className="clip__body">
                    <span className="clip__name">{clip.name}</span>
                    {track.kind === 'audio' && <span className="clip__wave" />}
                  </div>
                  <div className="clip__handle clip__handle--r" onPointerDown={(e) => onClipPointerDown(e, clip, track, 'trim-end')} />
                </div>
              );
            }),
          )}

          {/* playhead */}
          <div className="tl__playhead" style={{ left: HEADER_W + playhead * zoom, height: totalHeight }}>
            <div className="tl__playhead-head" />
          </div>
        </div>
      </div>
    </section>
  );
}

function hasRange(a: number | null, b: number | null): boolean {
  return a !== null && b !== null && b > a;
}
