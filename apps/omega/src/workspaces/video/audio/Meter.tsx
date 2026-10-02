// Stereo level meters drawn on canvas from one shared requestAnimationFrame
// loop that polls AudioEngine.meters() once per frame. Peak bars fall at
// 26 dB/s, peak-hold lines hold for 1.5 s, RMS is shown as the solid inner
// bar, and a clip latch lights above −0.1 dBFS until clicked.

import { useEffect, useRef } from 'react';
import { AudioEngine, type Meter } from '../../../engine/audio/engine';
import { meterDeflection } from '../../../engine/audio/dsp';

type MeterFrame = { master: Meter; tracks: Record<string, Meter> };
type Listener = (m: MeterFrame, now: number) => void;

const listeners = new Set<Listener>();
let raf = 0;

function loop() {
  raf = 0;
  if (!listeners.size) return;
  let frame: MeterFrame;
  try {
    frame = AudioEngine.get().meters();
  } catch {
    frame = { master: { peakL: -Infinity, peakR: -Infinity, rmsL: -Infinity, rmsR: -Infinity }, tracks: {} };
  }
  const now = performance.now();
  for (const l of listeners) l(frame, now);
  raf = requestAnimationFrame(loop);
}

/** Subscribe to per-frame meter readings (one rAF for every meter on screen). */
export function subscribeMeters(cb: Listener): () => void {
  listeners.add(cb);
  if (!raf) raf = requestAnimationFrame(loop);
  return () => {
    listeners.delete(cb);
    if (!listeners.size && raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  };
}

const FALL_DB_PER_S = 26;
const HOLD_MS = 1500;
const CLIP_DB = -0.1;

interface Ballistics {
  peak: number;
  rms: number;
  hold: number;
  holdAt: number;
  clip: boolean;
}

const fresh = (): Ballistics => ({ peak: -Infinity, rms: -Infinity, hold: -Infinity, holdAt: 0, clip: false });

function step(b: Ballistics, peakDb: number, rmsDb: number, dt: number, now: number) {
  const fallen = b.peak - FALL_DB_PER_S * dt;
  b.peak = peakDb > fallen ? peakDb : fallen;
  // RMS: smooth both ways (~300 ms)
  const k = Math.min(1, dt / 0.3);
  if (!Number.isFinite(b.rms)) b.rms = rmsDb;
  else if (!Number.isFinite(rmsDb)) b.rms = b.rms - FALL_DB_PER_S * dt;
  else b.rms = b.rms + (rmsDb - b.rms) * k;
  if (peakDb >= b.hold) {
    b.hold = peakDb;
    b.holdAt = now;
  } else if (now - b.holdAt > HOLD_MS) b.hold -= FALL_DB_PER_S * 2 * dt;
  if (peakDb >= CLIP_DB) b.clip = true;
}

export interface MeterViewProps {
  /** 'master', a track id, or a custom source. */
  source: 'master' | { trackId: string } | { read: () => { peak: number; rms: number } };
  height?: number | string;
  width?: number;
  /** Mono (one bar) for input meters. */
  mono?: boolean;
  /** Level grows left to right (input meters in toolbars). */
  horizontal?: boolean;
  className?: string;
  'data-testid'?: string;
  /** Called with the held peak (dBFS) a few times per second, for readouts. */
  onPeak?: (db: number, clipped: boolean) => void;
}

function cssVar(el: Element, name: string, fallback: string): string {
  return getComputedStyle(el).getPropertyValue(name).trim() || fallback;
}

/** Vertical stereo meter (L | R). Click to reset the clip latch and peak hold. */
export function MeterView(props: MeterViewProps) {
  const { source, mono, horizontal, className, onPeak } = props;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const state = useRef<Ballistics[]>([fresh(), fresh()]);
  const onPeakRef = useRef(onPeak);
  onPeakRef.current = onPeak;
  const sourceKey = typeof source === 'string' ? source : 'trackId' in source ? source.trackId : 'custom';
  const sourceRef = useRef(source);
  sourceRef.current = source;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const colors = {
      bg: cssVar(canvas, '--well', '#09090a'),
      ok: cssVar(canvas, '--ok', '#3ecf8e'),
      warn: cssVar(canvas, '--warn', '#f5a524'),
      danger: cssVar(canvas, '--danger', '#f0524f'),
      tick: cssVar(canvas, '--border-strong', 'rgba(255,255,255,0.1)'),
    };
    let last = performance.now();
    let lastReport = 0;
    const draw = (frame: MeterFrame, now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const src = sourceRef.current;
      let vals: [number, number][];
      if (typeof src === 'string') vals = [[frame.master.peakL, frame.master.rmsL], [frame.master.peakR, frame.master.rmsR]];
      else if ('trackId' in src) {
        const m = frame.tracks[src.trackId];
        vals = m ? [[m.peakL, m.rmsL], [m.peakR, m.rmsR]] : [[-Infinity, -Infinity], [-Infinity, -Infinity]];
      } else {
        const r = src.read();
        vals = [[r.peak, r.rms], [r.peak, r.rms]];
      }
      const bars = mono ? 1 : 2;
      for (let i = 0; i < bars; i++) step(state.current[i], vals[i][0], vals[i][1], dt, now);

      const dpr = window.devicePixelRatio || 1;
      const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
      const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      ctx.clearRect(0, 0, w, h);
      // Draw in a "level axis" space: L = length along the level, T = thickness.
      const L = horizontal ? w : h;
      const T = horizontal ? h : w;
      const rect = (lv0: number, lv1: number, t0: number, t1: number) => {
        // lv measured from the top (vertical) or from the right (horizontal)
        if (horizontal) ctx.fillRect(L - lv1, t0, lv1 - lv0, t1 - t0);
        else ctx.fillRect(t0, lv0, t1 - t0, lv1 - lv0);
      };
      const gap = Math.max(1, Math.round(dpr));
      const clipH = Math.round(3 * dpr);
      const barW = (T - gap * (bars - 1)) / bars;
      const top = clipH + gap;
      const H = L - top;
      const y = (db: number) => top + H * (1 - meterDeflection(db));
      const yWarn = y(-18);
      const yDanger = y(-6);
      for (let i = 0; i < bars; i++) {
        const b = state.current[i];
        const x = i * (barW + gap);
        ctx.fillStyle = colors.bg;
        rect(top, L, x, x + barW);
        // peak (translucent) then rms (solid), coloured by zone
        const paint = (from: number, alpha: number) => {
          if (from >= L) return;
          ctx.globalAlpha = alpha;
          const seg = (y0: number, y1: number, c: string) => {
            const a = Math.max(from, y0);
            if (y1 > a) {
              ctx.fillStyle = c;
              rect(a, y1, x, x + barW);
            }
          };
          seg(top, yDanger, colors.danger);
          seg(yDanger, yWarn, colors.warn);
          seg(yWarn, L, colors.ok);
          ctx.globalAlpha = 1;
        };
        paint(y(b.peak), 0.35);
        paint(y(b.rms), 0.95);
        if (Number.isFinite(b.hold) && b.hold > -70) {
          ctx.fillStyle = b.hold >= -6 ? colors.danger : b.hold >= -18 ? colors.warn : colors.ok;
          const yy = Math.round(y(b.hold));
          rect(yy, yy + Math.max(1, Math.round(dpr)), x, x + barW);
        }
        ctx.fillStyle = b.clip ? colors.danger : colors.tick;
        rect(0, clipH, x, x + barW);
      }
      if (onPeakRef.current && now - lastReport > 150) {
        lastReport = now;
        const held = Math.max(state.current[0].hold, mono ? -Infinity : state.current[1].hold);
        onPeakRef.current(held, state.current[0].clip || state.current[1].clip);
      }
    };
    return subscribeMeters(draw);
  }, [sourceKey, mono, horizontal]);

  const reset = () => {
    state.current = [fresh(), fresh()];
  };

  return (
    <canvas
      ref={canvasRef}
      className={`au-meter ${className ?? ''}`}
      style={horizontal ? { width: props.width ?? 64, height: props.height ?? 6 } : { height: props.height ?? '100%', width: props.width ?? (mono ? 6 : 13) }}
      title="Peak and RMS (dBFS). Click to reset the peak hold and clip light."
      data-testid={props['data-testid']}
      onClick={reset}
    />
  );
}

/** dBFS scale labels next to a meter (same deflection law). */
export const METER_MARKS = [0, -6, -12, -18, -24, -30, -40, -50, -60];
