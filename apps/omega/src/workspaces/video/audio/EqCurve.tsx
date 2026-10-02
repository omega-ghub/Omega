// EQ response curve with draggable bands. The curve is computed in JS from
// the same biquad formulas the engine uses (dsp.ts), so what you see is what
// plays. Drag: low/high shelf and mid move in frequency and gain, high-pass
// and low-pass in frequency; wheel over the mid band changes its Q;
// double-click a band to reset it.

import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { clamp, eqResponseDb, logFrequencies } from '../../../engine/audio/dsp';
import type { ClipAudio } from '../../../state/types';

type Eq = ClipAudio['eq'];
type BandId = 'highpass' | 'low' | 'mid' | 'high' | 'lowpass';

const F_LO = 20;
const F_HI = 20000;
const DB_RANGE = 18;

const xOf = (f: number) => Math.log(f / F_LO) / Math.log(F_HI / F_LO);
const fOf = (x: number) => F_LO * Math.pow(F_HI / F_LO, clamp(x, 0, 1));

function handlePos(eq: Eq, id: BandId): { f: number; g: number; on: boolean } {
  switch (id) {
    case 'highpass':
      return { f: eq.highpass > 0 ? eq.highpass : 30, g: 0, on: eq.highpass > 0 };
    case 'low':
      return { f: eq.lowFreq, g: eq.lowGain, on: eq.lowGain !== 0 };
    case 'mid':
      return { f: eq.midFreq, g: eq.midGain, on: eq.midGain !== 0 };
    case 'high':
      return { f: eq.highFreq, g: eq.highGain, on: eq.highGain !== 0 };
    case 'lowpass':
      return { f: eq.lowpass > 0 ? eq.lowpass : 18000, g: 0, on: eq.lowpass > 0 };
  }
}

const LABELS: Record<BandId, string> = { highpass: 'HP', low: 'L', mid: 'M', high: 'H', lowpass: 'LP' };

export function applyBand(id: BandId, f: number, g: number): Partial<Eq> {
  const fr = Math.round(f);
  const gr = Math.round(g * 10) / 10;
  switch (id) {
    case 'highpass':
      return { highpass: clamp(fr, 20, 2000) };
    case 'low':
      return { lowFreq: clamp(fr, 20, 2000), lowGain: clamp(gr, -DB_RANGE, DB_RANGE) };
    case 'mid':
      return { midFreq: clamp(fr, 40, 18000), midGain: clamp(gr, -DB_RANGE, DB_RANGE) };
    case 'high':
      return { highFreq: clamp(fr, 1000, 20000), highGain: clamp(gr, -DB_RANGE, DB_RANGE) };
    case 'lowpass':
      return { lowpass: clamp(fr, 1000, 20000) };
  }
}

export function resetBand(id: BandId): Partial<Eq> {
  switch (id) {
    case 'highpass':
      return { highpass: 0 };
    case 'low':
      return { lowGain: 0, lowFreq: 120 };
    case 'mid':
      return { midGain: 0, midFreq: 1500, midQ: 1 };
    case 'high':
      return { highGain: 0, highFreq: 8000 };
    case 'lowpass':
      return { lowpass: 0 };
  }
}

export function EqCurve(props: { eq: Eq; sampleRate: number; onChange: (patch: Partial<Eq>, final: boolean, band: BandId) => void; disabled?: boolean }) {
  const { eq, sampleRate, onChange, disabled } = props;
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 260, h: 110 });
  const drag = useRef<{ id: BandId; pointer: number } | null>(null);
  const [active, setActive] = useState<BandId | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: Math.max(80, el.clientWidth), h: Math.max(60, el.clientHeight) }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    const W = (c.width = Math.round(size.w * dpr));
    const H = (c.height = Math.round(size.h * dpr));
    const g = c.getContext('2d')!;
    const css = getComputedStyle(c);
    const v = (n: string, f: string) => css.getPropertyValue(n).trim() || f;
    g.clearRect(0, 0, W, H);
    const yOf = (db: number) => H / 2 - (db / DB_RANGE) * (H / 2 - 4 * dpr);
    // grid
    g.strokeStyle = v('--border', 'rgba(255,255,255,0.07)');
    g.lineWidth = dpr;
    for (const f of [50, 100, 200, 500, 1000, 2000, 5000, 10000]) {
      const x = Math.round(xOf(f) * W) + 0.5;
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x, H);
      g.stroke();
    }
    for (const db of [-12, -6, 6, 12]) {
      const y = Math.round(yOf(db)) + 0.5;
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(W, y);
      g.stroke();
    }
    g.strokeStyle = v('--border-strong', 'rgba(255,255,255,0.1)');
    g.beginPath();
    g.moveTo(0, Math.round(yOf(0)) + 0.5);
    g.lineTo(W, Math.round(yOf(0)) + 0.5);
    g.stroke();
    // labels
    g.fillStyle = v('--text-4', '#4a4a51');
    g.font = `${10 * dpr}px ${v('--mono', 'monospace')}`;
    for (const [f, t] of [
      [100, '100'],
      [1000, '1k'],
      [10000, '10k'],
    ] as const)
      g.fillText(t, xOf(f) * W + 3 * dpr, H - 3 * dpr);
    // response
    const n = Math.max(64, Math.round(size.w));
    const freqs = logFrequencies(n, F_LO, F_HI);
    const resp = eqResponseDb({ ...eq, enabled: true }, freqs, sampleRate);
    const accent = v('--accent', '#8b5cf6');
    g.beginPath();
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * W;
      const y = yOf(clamp(resp[i], -DB_RANGE - 6, DB_RANGE + 6));
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.strokeStyle = disabled ? v('--text-3', '#6b6b73') : accent;
    g.lineWidth = 1.6 * dpr;
    g.stroke();
    g.lineTo(W, yOf(0));
    g.lineTo(0, yOf(0));
    g.closePath();
    g.globalAlpha = 0.12;
    g.fillStyle = disabled ? v('--text-3', '#6b6b73') : accent;
    g.fill();
    g.globalAlpha = 1;
  }, [eq, sampleRate, size, disabled]);

  const bandAt = (id: BandId) => {
    const p = handlePos(eq, id);
    const yOf = (db: number) => size.h / 2 - (db / DB_RANGE) * (size.h / 2 - 4);
    return { x: xOf(p.f) * size.w, y: yOf(p.g), on: p.on };
  };

  const onMove = (e: PointerEvent) => {
    const d = drag.current;
    if (!d || d.pointer !== e.pointerId || !wrapRef.current) return;
    const r = wrapRef.current.getBoundingClientRect();
    const f = fOf((e.clientX - r.left) / r.width);
    const g = ((r.height / 2 - (e.clientY - r.top)) / (r.height / 2 - 4)) * DB_RANGE;
    onChange(applyBand(d.id, f, g), false, d.id);
  };

  return (
    <div className={`au-eq ${disabled ? 'au-eq--off' : ''}`} ref={wrapRef} data-testid="au-eq-curve" onPointerMove={onMove}>
      <canvas ref={canvasRef} style={{ width: size.w, height: size.h }} />
      {(['highpass', 'low', 'mid', 'high', 'lowpass'] as BandId[]).map((id) => {
        const b = bandAt(id);
        return (
          <button
            key={id}
            type="button"
            className={`au-eq__handle ${b.on ? 'is-on' : ''} ${active === id ? 'is-active' : ''}`}
            style={{ left: b.x, top: b.y }}
            title={`${LABELS[id]}: drag to adjust${id === 'mid' ? ', wheel for Q' : ''}, double-click to reset`}
            aria-label={`${LABELS[id]} band`}
            data-testid={`au-eq-handle-${id}`}
            disabled={disabled}
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              e.preventDefault();
              (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
              drag.current = { id, pointer: e.pointerId };
              setActive(id);
            }}
            onPointerMove={onMove}
            onPointerUp={() => {
              if (!drag.current) return;
              onChange({}, true, drag.current.id);
              drag.current = null;
              setActive(null);
            }}
            onDoubleClick={() => onChange(resetBand(id), true, id)}
            onWheel={(e) => {
              if (id !== 'mid') return;
              onChange({ midQ: clamp(Math.round((eq.midQ * (e.deltaY < 0 ? 1.1 : 1 / 1.1)) * 100) / 100, 0.1, 16) }, true, id);
            }}
          >
            {LABELS[id]}
          </button>
        );
      })}
    </div>
  );
}
