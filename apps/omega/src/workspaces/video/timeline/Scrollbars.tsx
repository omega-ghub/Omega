// Thin scrollbars for the canvas. The horizontal one is also a zoom bar:
// drag its ends to change the visible range (like Premiere's zoom scroll bar).
import { useRef, type PointerEvent as RPointerEvent } from 'react';
import { useEditor } from '../../../state/store';
import { activeSequence, sequenceDuration } from '../../../state/types';
import { contentDuration, layoutTracks } from './geometry';
import { useTLView } from './view';

export function HScroll() {
  const zoom = useEditor((s) => s.zoom);
  const dur = useEditor((s) => sequenceDuration(activeSequence(s.project!)));
  const playhead = useEditor((s) => s.playhead);
  const t0 = useTLView((s) => s.t0);
  const viewW = useTLView((s) => s.viewW);
  const ref = useRef<HTMLDivElement>(null);
  const span = viewW / zoom;
  const total = contentDuration(Math.max(dur, playhead), span);
  const left = Math.max(0, Math.min(1, t0 / total));
  const width = Math.max(0.02, Math.min(1 - left, span / total));

  const startDrag = (e: RPointerEvent<HTMLDivElement>, part: 'move' | 'l' | 'r') => {
    e.preventDefault();
    e.stopPropagation();
    const track = ref.current!.getBoundingClientRect();
    const x0 = e.clientX;
    const s0 = { t0, span, total };
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const dt = ((ev.clientX - x0) / track.width) * s0.total;
      const v = useTLView.getState();
      if (part === 'move') v.setT0(s0.t0 + dt);
      else if (part === 'l') {
        const a = Math.max(0, Math.min(s0.t0 + s0.span - 0.05, s0.t0 + dt));
        const b = s0.t0 + s0.span;
        useEditor.getState().setZoom(v.viewW / (b - a));
        v.setT0(a);
      } else {
        const a = s0.t0;
        const b = Math.max(a + 0.05, s0.t0 + s0.span + dt);
        useEditor.getState().setZoom(v.viewW / (b - a));
        v.setT0(a);
      }
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  };

  return (
    <div
      className="tl-hscroll"
      ref={ref}
      data-testid="tl-hscroll"
      onPointerDown={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        const f = (e.clientX - r.left) / r.width;
        useTLView.getState().setT0(f * total - span / 2);
      }}
    >
      <div className="tl-hscroll__thumb" style={{ left: `${left * 100}%`, width: `${width * 100}%` }} onPointerDown={(e) => startDrag(e, 'move')}>
        <div className="tl-hscroll__end tl-hscroll__end--l" onPointerDown={(e) => startDrag(e, 'l')} />
        <div className="tl-hscroll__end tl-hscroll__end--r" onPointerDown={(e) => startDrag(e, 'r')} />
      </div>
    </div>
  );
}

export function VScroll() {
  const tracks = useEditor((s) => activeSequence(s.project!).tracks);
  const scrollY = useTLView((s) => s.scrollY);
  const viewH = useTLView((s) => s.viewH);
  const ref = useRef<HTMLDivElement>(null);
  const content = layoutTracks(tracks).height + 40;
  if (content <= viewH + 1) return <div className="tl-vscroll" />;
  const top = scrollY / content;
  const h = Math.max(0.06, viewH / content);
  const maxY = Math.max(0, content - viewH);
  return (
    <div className="tl-vscroll" ref={ref} data-testid="tl-vscroll">
      <div
        className="tl-vscroll__thumb"
        style={{ top: `${top * 100}%`, height: `${h * 100}%` }}
        onPointerDown={(e) => {
          e.preventDefault();
          const r = ref.current!.getBoundingClientRect();
          const y0 = e.clientY;
          const s0 = scrollY;
          const el = e.currentTarget;
          el.setPointerCapture(e.pointerId);
          const move = (ev: PointerEvent) => useTLView.getState().setScrollY(Math.max(0, Math.min(maxY, s0 + ((ev.clientY - y0) / r.height) * content)));
          const up = () => {
            el.removeEventListener('pointermove', move);
            el.removeEventListener('pointerup', up);
          };
          el.addEventListener('pointermove', move);
          el.addEventListener('pointerup', up);
        }}
      />
    </div>
  );
}
