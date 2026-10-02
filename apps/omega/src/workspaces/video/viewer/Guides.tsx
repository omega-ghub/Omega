// Frame guides drawn over the program picture in sequence coordinates:
// safe areas (action 93 %, title 90 %), grids (thirds, center cross, golden
// ratio) and the draggable split-compare divider.
import { useRef } from 'react';
import { useEditor } from '../../../state/store';

interface Props {
  W: number;
  H: number;
  /** CSS pixels per sequence pixel (to size handles and text). */
  k: number;
}

export function Guides({ W, H, k }: Props) {
  const viewer = useEditor((s) => s.viewer);
  const setViewer = useEditor((s) => s.setViewer);
  const svg = useRef<SVGSVGElement>(null);
  const px = 1 / Math.max(1e-6, k); // one CSS pixel in sequence units
  const lines: { x1: number; y1: number; x2: number; y2: number }[] = [];
  if (viewer.grid === 'thirds' || viewer.grid === 'golden') {
    const fr = viewer.grid === 'thirds' ? [1 / 3, 2 / 3] : [0.382, 0.618];
    for (const f of fr) {
      lines.push({ x1: W * f, y1: 0, x2: W * f, y2: H });
      lines.push({ x1: 0, y1: H * f, x2: W, y2: H * f });
    }
  }
  const cross = viewer.grid === 'center' || viewer.safeAreas;
  const c = Math.min(W, H) * 0.035;
  const showCompare = viewer.compare === 'split';
  const cx = W * viewer.comparePosition;

  const dragDivider = (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const el = svg.current;
    if (!el) return;
    const target = e.currentTarget as Element;
    target.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const r = el.getBoundingClientRect();
      setViewer({ comparePosition: Math.max(0, Math.min(1, (ev.clientX - r.left) / Math.max(1, r.width))) });
    };
    const up = () => {
      target.removeEventListener('pointermove', move as EventListener);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
    };
    target.addEventListener('pointermove', move as EventListener);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
  };

  if (!lines.length && !cross && !viewer.safeAreas && !showCompare) return null;
  return (
    <svg ref={svg} className="vw-guides" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" data-testid="vw-guides">
      {viewer.safeAreas && (
        <g className="vw-guides__safe">
          <rect x={W * 0.035} y={H * 0.035} width={W * 0.93} height={H * 0.93} data-testid="vw-safe-action" />
          <rect x={W * 0.05} y={H * 0.05} width={W * 0.9} height={H * 0.9} data-testid="vw-safe-title" />
        </g>
      )}
      {lines.map((l, i) => (
        <line key={i} className="vw-guides__grid" {...l} />
      ))}
      {cross && (
        <g className="vw-guides__cross">
          <line x1={W / 2 - c} y1={H / 2} x2={W / 2 + c} y2={H / 2} />
          <line x1={W / 2} y1={H / 2 - c} x2={W / 2} y2={H / 2 + c} />
        </g>
      )}
      {showCompare && (
        <g className="vw-guides__compare">
          <line x1={cx} y1={0} x2={cx} y2={H} className="vw-guides__divider" />
          <text x={cx - 8 * px} y={16 * px} fontSize={10 * px} textAnchor="end" className="vw-guides__label">
            BEFORE
          </text>
          <text x={cx + 8 * px} y={16 * px} fontSize={10 * px} textAnchor="start" className="vw-guides__label">
            AFTER
          </text>
          <rect x={cx - 6 * px} y={0} width={12 * px} height={H} className="vw-guides__hit" onPointerDown={dragDivider} data-testid="vw-compare-divider" />
          <circle cx={cx} cy={H / 2} r={7 * px} className="vw-guides__knob" onPointerDown={dragDivider} />
        </g>
      )}
    </svg>
  );
}
