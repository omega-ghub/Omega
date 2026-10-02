// Lift / Gamma / Gain / Offset wheel: a thin hue ring oriented like the
// vectorscope, a puck for the r/g/b balance (drag; Shift = fine; arrows
// nudge; double-click resets), a master dial for `y`, and RGBY readouts.
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { clearKeyframes, isAnimated, KEY_TOLERANCE, paramAt, removeKeyframeAt, setKeyframe } from '../../../engine/keyframes';
import { useEditor } from '../../../state/store';
import type { Clip } from '../../../state/types';
import { ScrubNumber, Slider } from './controls';
import { clipLocal, editGradeClip, setGradeParams, useGradeLocal, WHEEL_LABEL } from './grade';
import { puckToRgb, rgbToPuck, type WheelName } from './gradeOps';

const CH = ['r', 'g', 'b', 'y'] as const;

/** Display colour for a direction on the wheel (math angle, radians, CCW from +x = +Cb). */
function hueColor(theta: number): string {
  const c = puckToRgb(Math.cos(theta), Math.sin(theta));
  const k = 0.95;
  const to = (v: number) => Math.round(255 * Math.max(0, Math.min(1, 0.5 + v * k)));
  return `rgb(${to(c.r)}, ${to(c.g)}, ${to(c.b)})`;
}

export function Wheel({ clip, wheel }: { clip: Clip; wheel: WheelName }) {
  const local = useGradeLocal(clip);
  const v = { r: 0, g: 0, b: 0, y: 0 };
  for (const c of CH) v[c] = paramAt(clip, `grade.${wheel}.${c}`, local);
  const puck = rgbToPuck(v);
  const paths = CH.map((c) => `grade.${wheel}.${c}`);
  const animated = paths.some((p) => isAnimated(clip, p));
  const keyAt = animated && paths.some((p) => clip.keyframes[p]?.some((k) => Math.abs(k.t - local) <= KEY_TOLERANCE));
  const label = WHEEL_LABEL[wheel];
  const key = `cl:${clip.id}:wheel:${wheel}`;

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [px, setPx] = useState(96);
  const drag = useRef<{ x: number; y: number; px: number; py: number; luma: number } | null>(null);
  const [active, setActive] = useState(false);

  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setPx(Math.max(60, Math.min(160, Math.round(el.clientWidth)))));
    ro.observe(el);
    setPx(Math.max(60, Math.min(160, Math.round(el.clientWidth))));
    return () => ro.disconnect();
  }, []);

  const setPuck = (x: number, y: number, luma: number) => {
    const m = Math.hypot(x, y);
    if (m > 1) {
      x /= m;
      y /= m;
    }
    const c = puckToRgb(x, y);
    const r4 = (n: number) => Math.round(n * 10000) / 10000;
    setGradeParams(
      clip.id,
      { [`grade.${wheel}.r`]: r4(c.r + luma), [`grade.${wheel}.g`]: r4(c.g + luma), [`grade.${wheel}.b`]: r4(c.b + luma) },
      `Adjust ${label}`,
      key,
    );
  };

  // draw
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const S = Math.round(px * dpr);
    if (cv.width !== S) cv.width = S;
    if (cv.height !== S) cv.height = S;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, S, S);
    const c = S / 2;
    const R = S / 2 - 2 * dpr;
    // disc
    const disc = ctx.createRadialGradient(c, c, 0, c, c, R);
    disc.addColorStop(0, '#202027');
    disc.addColorStop(1, '#15151a');
    ctx.fillStyle = disc;
    ctx.beginPath();
    ctx.arc(c, c, R, 0, Math.PI * 2);
    ctx.fill();
    // faint colour wash towards the edge
    const wash = ctx.createConicGradient(0, c, c);
    for (let i = 0; i <= 36; i++) wash.addColorStop(i / 36, hueColor((-i / 36) * Math.PI * 2));
    ctx.save();
    ctx.globalAlpha = 0.07;
    ctx.fillStyle = wash;
    ctx.beginPath();
    ctx.arc(c, c, R, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    // hue ring
    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.strokeStyle = wash;
    ctx.lineWidth = 2.2 * dpr;
    ctx.beginPath();
    ctx.arc(c, c, R - 1.2 * dpr, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    // crosshair
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = dpr;
    ctx.beginPath();
    ctx.moveTo(c - R * 0.86, c);
    ctx.lineTo(c + R * 0.86, c);
    ctx.moveTo(c, c - R * 0.86);
    ctx.lineTo(c, c + R * 0.86);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(c, c, R * 0.5, 0, Math.PI * 2);
    ctx.stroke();
    // puck
    const m = Math.min(1, Math.hypot(puck.x, puck.y));
    const ang = Math.atan2(puck.y, puck.x);
    const pr = R * 0.86 * m;
    const x = c + Math.cos(ang) * pr;
    const y = c - Math.sin(ang) * pr;
    if (m > 0.002) {
      ctx.strokeStyle = 'rgba(255,255,255,0.32)';
      ctx.beginPath();
      ctx.moveTo(c, c);
      ctx.lineTo(x, y);
      ctx.stroke();
    }
    ctx.fillStyle = m > 0.002 ? hueColor(ang) : '#d8d8de';
    ctx.strokeStyle = active ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.8)';
    ctx.lineWidth = 1.5 * dpr;
    ctx.beginPath();
    ctx.arc(x, y, (active ? 5 : 4.2) * dpr, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }, [px, puck.x, puck.y, active]);

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.focus();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, px: puck.x, py: puck.y, luma: puck.luma };
    setActive(true);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    if (!d) return;
    const R = (px / 2) * 0.86;
    const k = e.shiftKey ? 0.1 : 1;
    // relative drag: with Shift, movement since the last event is scaled down
    const nx = d.px + ((e.clientX - d.x) / R) * k;
    const ny = d.py - ((e.clientY - d.y) / R) * k;
    d.x = e.clientX;
    d.y = e.clientY;
    d.px = nx;
    d.py = ny;
    setPuck(nx, ny, d.luma);
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    drag.current = null;
    setActive(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };
  const resetBalance = () =>
    setGradeParams(clip.id, { [`grade.${wheel}.r`]: 0, [`grade.${wheel}.g`]: 0, [`grade.${wheel}.b`]: 0 }, `Reset ${label} balance`, `${key}:reset`);
  const onKeyDown = (e: ReactKeyboardEvent<HTMLCanvasElement>) => {
    const step = e.shiftKey ? 0.005 : 0.03;
    const dx = e.key === 'ArrowRight' ? step : e.key === 'ArrowLeft' ? -step : 0;
    const dy = e.key === 'ArrowUp' ? step : e.key === 'ArrowDown' ? -step : 0;
    if (dx || dy) {
      e.preventDefault();
      e.stopPropagation();
      setPuck(puck.x + dx, puck.y + dy, puck.luma);
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      e.stopPropagation();
      resetBalance();
    }
  };

  const toggleAnim = () =>
    editGradeClip(clip.id, animated ? `Stop animating ${label}` : `Animate ${label}`, (c) => {
      const t = clipLocal(c, useEditor.getState().playhead);
      for (const p of paths) {
        if (animated) clearKeyframes(c, p, t);
        else setKeyframe(c, p, t, paramAt(c, p, t));
      }
    });
  const toggleKey = () =>
    editGradeClip(clip.id, keyAt ? `Remove ${label} keyframe` : `Add ${label} keyframe`, (c) => {
      const t = clipLocal(c, useEditor.getState().playhead);
      for (const p of paths) {
        if (keyAt) {
          if ((c.keyframes[p]?.length ?? 0) <= 1) clearKeyframes(c, p, t);
          else removeKeyframeAt(c, p, t);
        } else setKeyframe(c, p, t, paramAt(c, p, t));
      }
    });

  const setChannel = (ch: (typeof CH)[number], value: number) =>
    setGradeParams(clip.id, { [`grade.${wheel}.${ch}`]: value }, `Adjust ${label} ${ch === 'y' ? 'master' : ch.toUpperCase()}`, `${key}:${ch}`);

  return (
    <div className={`cl-wheel ${animated ? 'cl-wheel--anim' : ''}`} data-testid={`cl-wheel-${wheel}`}>
      <div className="cl-wheel__head">
        <span className="cl-wheel__name" title="Double-click to reset the wheel" onDoubleClick={resetBalance}>
          {label}
        </span>
        <span className="cl-wheel__kf">
          <button
            type="button"
            className={`cl-kf ${animated ? 'is-on' : ''}`}
            title={animated ? `${label} is animated: click to remove its keyframes` : `Animate ${label}`}
            aria-pressed={animated}
            data-testid={`cl-wheel-${wheel}-animate`}
            onClick={toggleAnim}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="12" cy="13" r="7.5" />
              <path d="M12 13V9.5M10 3h4M12 3v2.5" />
            </svg>
          </button>
          {animated && (
            <button type="button" className={`cl-kf ${keyAt ? 'is-on' : ''}`} title={keyAt ? 'Remove keyframe at playhead' : 'Add keyframe at playhead'} data-testid={`cl-wheel-${wheel}-key`} onClick={toggleKey}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill={keyAt ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
                <path d="M12 3l9 9-9 9-9-9z" />
              </svg>
            </button>
          )}
        </span>
      </div>
      <div className="cl-wheel__disc" ref={boxRef}>
        <canvas
          ref={canvasRef}
          className="cl-wheel__canvas"
          style={{ width: px, height: px }}
          tabIndex={0}
          role="slider"
          aria-label={`${label} balance`}
          aria-valuetext={`R ${v.r.toFixed(2)}, G ${v.g.toFixed(2)}, B ${v.b.toFixed(2)}`}
          title="Drag to balance (Shift: fine) · Double-click to reset"
          data-testid={`cl-wheel-${wheel}-puck`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onDoubleClick={resetBalance}
          onKeyDown={onKeyDown}
        />
      </div>
      <div className="cl-wheel__master" title="Master (Y) · Double-click to reset">
        <Slider value={v.y} min={-1} max={1} step={0.005} defaultValue={0} origin={0} onChange={(y) => setChannel('y', y)} aria-label={`${label} master`} data-testid={`cl-wheel-${wheel}-master`} />
      </div>
      <div className="cl-wheel__nums">
        {CH.map((ch) => (
          <label key={ch} className={`cl-wheel__num cl-wheel__num--${ch}`}>
            <span>{ch.toUpperCase()}</span>
            <ScrubNumber
              value={v[ch]}
              min={-1}
              max={1}
              step={0.01}
              dragStep={0.002}
              precision={2}
              defaultValue={0}
              width="100%"
              onChange={(val) => setChannel(ch, val)}
              aria-label={`${label} ${ch.toUpperCase()}`}
              data-testid={`cl-wheel-${wheel}-${ch}`}
              className="cl-wheel__scrub"
            />
          </label>
        ))}
      </div>
    </div>
  );
}
