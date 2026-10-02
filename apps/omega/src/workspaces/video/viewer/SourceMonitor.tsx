// Source monitor: plays one asset from the media browser with its own
// transport, marks (asset.markIn / markOut), Insert / Overwrite into the
// sequence, drag-to-timeline, and a large waveform for audio-only media.
// OWNED BY THE VIEWER PACKAGE.
import { useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react';
import { getPeaks, onPeaks, requestPeaks } from '../../../engine/audio/engine';
import { outFrame } from '../../../engine/playback/clock';
import { mediaUrl } from '../../../engine/playback/preview';
import { getSourcePlayer } from '../../../engine/playback/sourcePlayer';
import { formatTimecode } from '../../../engine/time';
import { useEditor } from '../../../state/store';
import type { MediaAsset } from '../../../state/types';
import { I } from '../../../ui/Icons';
import * as cmd from './commands';
import { VI } from './icons';
import { ScrubBar, TimecodeField } from './Transport';
import { useViewerUi } from './uiState';
import './viewer.css';

export function SourceMonitor(_props: Record<string, unknown> = {}) {
  const hasProject = useEditor((s) => !!s.project);
  if (!hasProject) return null;
  return <Source />;
}

/** Runs a monitor command against the source monitor regardless of keyboard focus. */
function onSource(fn: () => void): void {
  const ui = useViewerUi.getState();
  ui.setFocus('source');
  fn();
}

function Source() {
  const assetId = useEditor((s) => s.source.assetId);
  const storeTime = useEditor((s) => s.source.time);
  const asset = useEditor((s) => (s.source.assetId ? (s.project?.assets.find((a) => a.id === s.source.assetId) ?? null) : null));
  const useProxies = useEditor((s) => s.viewer.useProxies);
  const sp = getSourcePlayer();
  const [, tick] = useReducer((n: number) => n + 1, 0);
  const holder = useRef<HTMLDivElement>(null);
  const exactRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });

  useEffect(() => sp.onChange(tick), [sp]);

  // Load a new asset (and take keyboard focus, like Premiere).
  useEffect(() => {
    sp.load(asset, useEditor.getState().source.time);
    if (asset) useViewerUi.getState().setFocus('source');
  }, [assetId]); // only when the asset changes; the object itself is handled below

  // Same asset, new object (marks changed, proxy ready / toggled).
  useEffect(() => {
    if (asset && sp.asset?.id === asset.id) sp.load(asset);
  }, [asset, useProxies, sp]);

  // Someone else moved the source time (media browser, match frame).
  useEffect(() => {
    if (sp.asset && sp.rate === 0 && Math.abs(storeTime - sp.time) > 1e-3) sp.seek(storeTime);
  }, [storeTime, sp]);

  // Mount the shared video element; pause when the monitor goes away.
  useEffect(() => {
    const h = holder.current;
    if (!h) return;
    h.appendChild(sp.video);
    return () => {
      if (sp.video.parentElement === h) h.removeChild(sp.video);
      sp.pause(false);
    };
  }, [sp, asset?.kind]);

  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const measure = () => setBox({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Picture box: the asset's aspect fitted into the stage.
  const aw = asset?.width ?? 16;
  const ah = asset?.height ?? 9;
  const fit = box.w > 0 && box.h > 0 ? Math.min((box.w - 16) / aw, (box.h - 16) / ah) : 0;
  const pw = Math.max(0, aw * fit);
  const ph = Math.max(0, ah * fit);

  useEffect(() => {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(pw * dpr);
    if (Math.abs(w - sp.displayWidth) > 64) {
      sp.displayWidth = w;
      sp.refreshExact();
    }
  }, [pw, sp]);

  // Exact paused frame over the element.
  const fps = sp.fps;
  const exact = sp.exact;
  const showExact = !!exact && sp.rate === 0 && Math.abs(exact.time - sp.time) < 0.5 / fps;
  useEffect(() => {
    const c = exactRef.current;
    if (!c || !exact || !showExact) return;
    if (c.width !== exact.bmp.width || c.height !== exact.bmp.height) {
      c.width = exact.bmp.width;
      c.height = exact.bmp.height;
    }
    try {
      c.getContext('2d')?.drawImage(exact.bmp, 0, 0);
    } catch {
      /* bitmap gone */
    }
  }, [exact, showExact]);

  const duration = sp.duration;
  const time = sp.time;
  const playing = sp.rate !== 0;
  const isVideo = asset?.kind === 'video' && asset.hasVideo;
  const isAudio = !!asset && (asset.kind === 'audio' || (asset.kind === 'video' && !asset.hasVideo));
  const isImage = asset?.kind === 'image';
  const markIn = asset?.markIn ?? null;
  const markOut = asset?.markOut ?? null;
  const tc = (t: number) => formatTimecode(t, fps);
  const rangeDur = markIn !== null || markOut !== null ? Math.max(0, (markOut ?? duration) - (markIn ?? 0)) : duration;

  return (
    <div className="vw-monitor vw-source" data-testid="vw-source" data-vw-monitor="source" aria-label="Source monitor">
      <div ref={stageRef} className="vw-stage vw-source__stage">
        {!asset && (
          <div className="vw-empty" data-testid="vw-source-empty">
            <I.Film size={22} />
            <div className="vw-empty__title">No source</div>
            <div className="vw-empty__sub">Double-click a clip in the media browser to open it here.</div>
          </div>
        )}
        {asset && !isAudio && (
          <div
            className="vw-source__frame"
            style={{ width: pw, height: ph }}
            draggable
            data-testid="vw-source-frame"
            data-tip="Drag to the timeline"
            onDragStart={(e) => {
              e.dataTransfer.setData('omega/asset', asset.id);
              e.dataTransfer.setData('omega/assets', JSON.stringify([asset.id]));
              e.dataTransfer.setData('text/plain', asset.name);
              e.dataTransfer.effectAllowed = 'copy';
            }}
          >
            {isImage ? (
              <img className="vw-source__img" src={mediaUrl(asset.path)} alt={asset.name} draggable={false} crossOrigin="anonymous" />
            ) : (
              <>
                <div ref={holder} className="vw-source__holder" data-testid="vw-source-video" />
                <canvas ref={exactRef} className="vw-source__exact" style={{ visibility: showExact && isVideo ? 'visible' : 'hidden' }} />
              </>
            )}
          </div>
        )}
        {asset && isAudio && (
          <>
            <div ref={holder} className="vw-source__holder vw-source__holder--hidden" />
            <Waveform asset={asset} time={time} duration={duration} markIn={markIn} markOut={markOut} onSeek={(t) => sp.seek(t)} />
          </>
        )}
        {sp.error && asset && (
          <div className="vw-error vw-error--soft" data-testid="vw-source-error">
            <VI.Warning size={18} />
            <div className="vw-error__sub">{sp.error}</div>
          </div>
        )}
      </div>

      <footer className={`vw-transport ${asset ? '' : 'is-disabled'}`}>
        <ScrubBar time={time} duration={isImage ? 0 : duration} inPoint={markIn} outPoint={markOut} onScrub={(t) => sp.seek(t)} testId="vw-source-scrub" />
        <div className="vw-bar">
          <div className="vw-bar__left">
            <TimecodeField time={time} fps={fps} onCommit={(t) => sp.seek(t)} testId="vw-source-timecode" />
            <div className="vw-readouts">
              <span className="vw-readout">
                <span className="vw-readout__k">In</span>
                <span className="tc" data-testid="vw-source-in">
                  {markIn !== null ? tc(markIn) : '–'}
                </span>
              </span>
              <span className="vw-readout">
                <span className="vw-readout__k">Out</span>
                <span className="tc" data-testid="vw-source-out">
                  {markOut !== null ? tc(outFrame(markOut, fps)) : '–'}
                </span>
              </span>
              <span className="vw-readout">
                <span className="vw-readout__k">Dur</span>
                <span className="tc" data-testid="vw-source-duration">
                  {tc(rangeDur)}
                </span>
              </span>
            </div>
          </div>
          <div className="vw-bar__right">
            {asset && (
              <span className="vw-meta" data-testid="vw-source-meta">
                {[asset.width && asset.height ? `${asset.width}×${asset.height}` : '', asset.fps ? `${Math.round(asset.fps * 1000) / 1000} fps` : '', isAudio && asset.sampleRate ? `${asset.sampleRate / 1000} kHz` : '', isAudio && asset.channels ? `${asset.channels} ch` : '']
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            )}
          </div>
        </div>
        <div className="vw-row">
          <div className="vw-row__left vw-btns">
            <button type="button" className={`icon-btn icon-btn--sm ${markIn !== null ? 'is-mark' : ''}`} disabled={!asset || isImage} data-testid="vw-source-mark-in" data-tip="Mark in" data-tip-keys="I" onClick={() => onSource(() => cmd.markSource('in'))}>
              <VI.MarkIn size={16} />
            </button>
            <button type="button" className={`icon-btn icon-btn--sm ${markOut !== null ? 'is-mark' : ''}`} disabled={!asset || isImage} data-testid="vw-source-mark-out" data-tip="Mark out" data-tip-keys="O" onClick={() => onSource(() => cmd.markSource('out'))}>
              <VI.MarkOut size={16} />
            </button>
            <button type="button" className="icon-btn icon-btn--sm vw-opt" disabled={!asset || (markIn === null && markOut === null)} data-testid="vw-source-clear" data-tip="Clear in and out" data-tip-keys="Mod+Shift+X" onClick={() => onSource(() => cmd.clearSource('both'))}>
              <VI.ClearInOut size={16} />
            </button>
          </div>
          <div className="vw-row__center vw-btns">
            <button type="button" className="icon-btn icon-btn--sm vw-opt" disabled={!asset || isImage} data-testid="vw-source-goto-in" data-tip="Go to in" data-tip-keys="Shift+I" onClick={() => onSource(cmd.goToIn)}>
              <VI.GoIn size={16} />
            </button>
            <button type="button" className="icon-btn icon-btn--sm" disabled={!asset || isImage} data-testid="vw-source-step-back" data-tip="Step back" data-tip-keys="ArrowLeft" onClick={() => sp.step(-1)}>
              <I.StepBack size={16} />
            </button>
            <button type="button" className="icon-btn icon-btn--primary vw-play" disabled={!asset || isImage} data-testid="vw-source-play" aria-label={playing ? 'Pause' : 'Play'} data-tip="Play / pause" data-tip-keys="Space" onClick={() => onSource(() => sp.toggle())}>
              {playing ? <I.Pause size={15} /> : <I.Play size={15} />}
            </button>
            <button type="button" className="icon-btn icon-btn--sm" disabled={!asset || isImage} data-testid="vw-source-step-forward" data-tip="Step forward" data-tip-keys="ArrowRight" onClick={() => sp.step(1)}>
              <I.StepForward size={16} />
            </button>
            <button type="button" className="icon-btn icon-btn--sm vw-opt" disabled={!asset || isImage} data-testid="vw-source-goto-out" data-tip="Go to out" data-tip-keys="Shift+O" onClick={() => onSource(cmd.goToOut)}>
              <VI.GoOut size={16} />
            </button>
          </div>
          <div className="vw-row__right vw-btns">
            <button type="button" className="icon-btn icon-btn--sm" disabled={!asset} data-testid="vw-source-insert" data-tip="Insert" data-tip-keys="," onClick={() => cmd.editFromSource('insert')}>
              <VI.Insert size={16} />
            </button>
            <button type="button" className="icon-btn icon-btn--sm" disabled={!asset} data-testid="vw-source-overwrite" data-tip="Overwrite" data-tip-keys="." onClick={() => cmd.editFromSource('overwrite')}>
              <VI.Overwrite size={16} />
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Waveform (audio-only assets)
// ---------------------------------------------------------------------------

interface WaveProps {
  asset: MediaAsset;
  time: number;
  duration: number;
  markIn: number | null;
  markOut: number | null;
  onSeek: (t: number) => void;
}

function Waveform({ asset, time, duration, markIn, markOut, onSeek }: WaveProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const [version, bump] = useReducer((n: number) => n + 1, 0);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [loading, setLoading] = useState(false);
  const dragging = useRef(false);

  useEffect(() => {
    let live = true;
    const off = onPeaks((id) => {
      if (id === asset.id) bump();
    });
    const project = useEditor.getState().project;
    if (!getPeaks(asset.id) && project) {
      setLoading(true);
      void requestPeaks(project, asset.id)
        .catch(() => null)
        .then(() => {
          if (!live) return;
          setLoading(false);
          bump();
        });
    }
    return () => {
      live = false;
      off();
    };
  }, [asset.id]);

  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const peaks = getPeaks(asset.id);
  useEffect(() => {
    const c = canvas.current;
    if (!c || !size.w || !size.h) return;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(size.w * dpr);
    const h = Math.round(size.h * dpr);
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, w, h);
    const mid = h / 2;
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fillRect(0, Math.round(mid), w, Math.max(1, Math.round(dpr)));
    if (!peaks || !peaks.data.length) return;
    const buckets = peaks.data.length / 2;
    const dur = peaks.duration > 0 ? peaks.duration : duration;
    const perBucket = peaks.bucket / peaks.sampleRate;
    const styles = getComputedStyle(c);
    ctx.fillStyle = styles.getPropertyValue('--vw-wave').trim() || '#7c6cf2';
    for (let x = 0; x < w; x++) {
      const t0 = (x / w) * dur;
      const t1 = ((x + 1) / w) * dur;
      const b0 = Math.max(0, Math.floor(t0 / perBucket));
      const b1 = Math.min(buckets, Math.max(b0 + 1, Math.ceil(t1 / perBucket)));
      let lo = 0;
      let hi = 0;
      for (let b = b0; b < b1; b++) {
        lo = Math.min(lo, peaks.data[b * 2]);
        hi = Math.max(hi, peaks.data[b * 2 + 1]);
      }
      const y0 = mid - hi * mid * 0.92;
      const y1 = mid - lo * mid * 0.92;
      ctx.fillRect(x, y0, 1, Math.max(1, y1 - y0));
    }
  }, [peaks, version, size, duration]);

  const d = duration > 0 ? duration : 1;
  const pct = (t: number) => `${Math.max(0, Math.min(100, (t / d) * 100))}%`;
  const at = (clientX: number) => {
    const r = wrap.current!.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - r.left) / Math.max(1, r.width))) * duration;
  };
  return (
    <div
      ref={wrap}
      className="vw-wave"
      data-testid="vw-source-waveform"
      draggable={false}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        dragging.current = true;
        onSeek(at(e.clientX));
      }}
      onPointerMove={(e) => dragging.current && onSeek(at(e.clientX))}
      onPointerUp={() => (dragging.current = false)}
    >
      <canvas ref={canvas} className="vw-wave__canvas" />
      {!peaks && loading && <div className="vw-wave__loading">Reading audio…</div>}
      {(markIn !== null || markOut !== null) && <div className="vw-wave__range" style={{ left: pct(markIn ?? 0), width: `calc(${pct(markOut ?? duration)} - ${pct(markIn ?? 0)})` }} />}
      <div className="vw-wave__head" style={{ left: pct(time) }} />
      <div
        className="vw-wave__grip"
        draggable
        data-tip="Drag to the timeline"
        onPointerDown={(e) => e.stopPropagation()}
        onDragStart={(e) => {
          e.dataTransfer.setData('omega/asset', asset.id);
          e.dataTransfer.setData('omega/assets', JSON.stringify([asset.id]));
          e.dataTransfer.setData('text/plain', asset.name);
          e.dataTransfer.effectAllowed = 'copy';
        }}
      >
        <VI.Drag size={14} />
        <VI.Waveform size={14} />
      </div>
    </div>
  );
}
