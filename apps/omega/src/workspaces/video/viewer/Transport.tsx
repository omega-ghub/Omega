// Transport pieces shared by the program and source monitors: the big
// click-to-type timecode, the mini scrub bar with in/out, the stereo meter
// and the dropped-frames badge.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AudioEngine } from '../../../engine/audio/engine';
import { getPlayer, type PlayerStats } from '../../../engine/playback/player';
import { formatTimecode, parseTimecode } from '../../../engine/time';

// ---- player subscriptions -------------------------------------------------------

/** Program time, updated every displayed frame. */
export function useProgramTime(): number {
  const player = getPlayer();
  return useSyncExternalStore(
    (cb) => player.onTime(cb),
    () => player.time,
  );
}

/** Playing state, errors and stats (stats refresh a few times a second while playing). */
export function useProgramState(): { playing: boolean; rate: number; error: string | null; stats: PlayerStats } {
  const player = getPlayer();
  const [state, setState] = useState(() => ({ playing: player.isPlaying(), rate: player.rate, error: player.error, stats: player.stats() }));
  useEffect(() => {
    const update = () => setState({ playing: player.isPlaying(), rate: player.rate, error: player.error, stats: player.stats() });
    update();
    return player.onState(update);
  }, [player]);
  return state;
}

// ---- timecode --------------------------------------------------------------------

interface TimecodeProps {
  time: number;
  fps: number;
  dropFrame?: boolean;
  startTimecode?: number;
  onCommit: (t: number) => void;
  testId?: string;
  title?: string;
}

/** Big tabular timecode; click to type an absolute or +/- relative time. */
export function TimecodeField({ time, fps, dropFrame = false, startTimecode = 0, onCommit, testId, title = 'Click to type a timecode (+/- for relative)' }: TimecodeProps) {
  const [editing, setEditing] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const text = formatTimecode(time, fps, dropFrame, startTimecode);
  const isEditing = editing !== null;

  useEffect(() => {
    if (isEditing) input.current?.select();
  }, [isEditing]);

  if (editing !== null) {
    const commit = () => {
      const t = parseTimecode(editing, fps, time, startTimecode, dropFrame);
      setEditing(null);
      if (t !== null) onCommit(t);
    };
    return (
      <input
        ref={input}
        className="vw-tc vw-tc--input"
        data-testid={testId ? `${testId}-input` : undefined}
        value={editing}
        spellCheck={false}
        aria-label="Timecode"
        onChange={(e) => setEditing(e.target.value)}
        onBlur={() => setEditing(null)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') commit();
          else if (e.key === 'Escape') setEditing(null);
        }}
      />
    );
  }
  return (
    <button type="button" className="vw-tc" data-testid={testId} data-tip={title} onClick={() => setEditing(text)}>
      {text}
    </button>
  );
}

// ---- scrub bar ----------------------------------------------------------------------

interface ScrubProps {
  time: number;
  duration: number;
  inPoint: number | null;
  outPoint: number | null;
  onScrub: (t: number) => void;
  onScrubEnd?: () => void;
  testId?: string;
}

/** A slim bar: the whole duration, the in/out range and the playhead. Drag to scrub. */
export function ScrubBar({ time, duration, inPoint, outPoint, onScrub, onScrubEnd, testId }: ScrubProps) {
  const ref = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const d = duration > 0 ? duration : 1;
  const pct = (t: number) => `${Math.max(0, Math.min(100, (t / d) * 100))}%`;
  const at = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - r.left) / Math.max(1, r.width))) * duration;
  };
  const hasRange = inPoint !== null || outPoint !== null;
  const a = inPoint ?? 0;
  const b = outPoint ?? duration;
  return (
    <div
      ref={ref}
      className={`vw-scrub ${duration > 0 ? '' : 'is-empty'}`}
      data-testid={testId}
      onPointerDown={(e) => {
        if (duration <= 0 || e.button !== 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        dragging.current = true;
        onScrub(at(e.clientX));
      }}
      onPointerMove={(e) => {
        if (dragging.current) onScrub(at(e.clientX));
      }}
      onPointerUp={() => {
        if (!dragging.current) return;
        dragging.current = false;
        onScrubEnd?.();
      }}
      onPointerCancel={() => (dragging.current = false)}
    >
      <div className="vw-scrub__track" />
      {hasRange && <div className="vw-scrub__range" style={{ left: pct(a), width: `calc(${pct(b)} - ${pct(a)})` }} />}
      {inPoint !== null && <div className="vw-scrub__mark vw-scrub__mark--in" style={{ left: pct(inPoint) }} />}
      {outPoint !== null && <div className="vw-scrub__mark vw-scrub__mark--out" style={{ left: pct(outPoint) }} />}
      <div className="vw-scrub__head" style={{ left: pct(time) }} />
    </div>
  );
}

// ---- meter -----------------------------------------------------------------------

const FLOOR = -60;
const pos = (db: number) => (Number.isFinite(db) ? Math.max(0, Math.min(1, (db - FLOOR) / -FLOOR)) : 0);

/** Slim stereo meter from the audio engine's master bus (peak + rms, with peak hold). */
export function StereoMeter({ testId }: { testId?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let raf = 0;
    const hold = [0, 0];
    const holdAt = [0, 0];
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const c = canvas.current;
      if (!c) return;
      const dpr = window.devicePixelRatio || 1;
      const w = Math.round(c.clientWidth * dpr);
      const h = Math.round(c.clientHeight * dpr);
      if (!w || !h) return;
      if (c.width !== w || c.height !== h) {
        c.width = w;
        c.height = h;
      }
      const ctx = c.getContext('2d');
      if (!ctx) return;
      let m = { peakL: -Infinity, peakR: -Infinity, rmsL: -Infinity, rmsR: -Infinity };
      try {
        m = AudioEngine.get().meters().master;
      } catch {
        /* engine not ready */
      }
      const now = performance.now();
      ctx.clearRect(0, 0, w, h);
      const gap = Math.max(1, Math.round(dpr));
      const bh = Math.floor((h - gap) / 2);
      const rows: [number, number, number][] = [
        [pos(m.peakL), pos(m.rmsL), 0],
        [pos(m.peakR), pos(m.rmsR), 1],
      ];
      for (const [peak, rms, i] of rows) {
        const y = i * (bh + gap);
        ctx.fillStyle = 'rgba(255,255,255,0.06)';
        ctx.fillRect(0, y, w, bh);
        if (peak >= hold[i] || now - holdAt[i] > 1200) {
          hold[i] = peak;
          holdAt[i] = now;
        }
        const g = ctx.createLinearGradient(0, 0, w, 0);
        g.addColorStop(0, '#3ecf8e');
        g.addColorStop(pos(-18), '#3ecf8e');
        g.addColorStop(pos(-6), '#f5a524');
        g.addColorStop(1, '#f0524f');
        ctx.globalAlpha = 0.45;
        ctx.fillStyle = g;
        ctx.fillRect(0, y, Math.round(peak * w), bh);
        ctx.globalAlpha = 1;
        ctx.fillRect(0, y, Math.round(rms * w), bh);
        if (hold[i] > 0) {
          ctx.fillStyle = hold[i] > pos(-1) ? '#f0524f' : 'rgba(255,255,255,0.7)';
          ctx.fillRect(Math.min(w - gap, Math.round(hold[i] * w)), y, gap, bh);
        }
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);
  return <canvas ref={canvas} className="vw-meter" data-testid={testId} data-tip="Master level (L / R)" />;
}
