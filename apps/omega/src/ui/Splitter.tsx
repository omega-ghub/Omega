// Splitter handle between docked panels. OWNED BY THE SHELL PACKAGE.
//
//   <Splitter dir="v" onDrag={(dx) => …} onReset={…} />   (vertical bar, drags horizontally)
//   <Splitter dir="h" onDrag={(dy) => …} />                 (horizontal bar, drags vertically)
//
// onDrag receives the total pointer offset since the drag started, so the
// owner computes `start + delta` and clamps. Double-click resets. Arrow keys
// nudge by 16px when the handle is focused.

import { useRef } from 'react';

export function Splitter({
  dir,
  onDragStart,
  onDrag,
  onDragEnd,
  onReset,
  testId,
  label,
}: {
  dir: 'v' | 'h';
  onDragStart?: () => void;
  onDrag: (delta: number) => void;
  onDragEnd?: () => void;
  onReset?: () => void;
  testId?: string;
  label?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ start: number; id: number } | null>(null);

  return (
    <div
      ref={ref}
      className={`splitter splitter--${dir}`}
      role="separator"
      aria-orientation={dir === 'v' ? 'vertical' : 'horizontal'}
      aria-label={label ?? 'Resize'}
      tabIndex={0}
      data-testid={testId}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        drag.current = { start: dir === 'v' ? e.clientX : e.clientY, id: e.pointerId };
        ref.current?.classList.add('is-dragging');
        document.body.classList.add(dir === 'v' ? 'is-resizing-v' : 'is-resizing-h');
        onDragStart?.();
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d || d.id !== e.pointerId) return;
        onDrag((dir === 'v' ? e.clientX : e.clientY) - d.start);
      }}
      onPointerUp={(e) => {
        if (!drag.current) return;
        drag.current = null;
        ref.current?.classList.remove('is-dragging');
        document.body.classList.remove('is-resizing-v', 'is-resizing-h');
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
        onDragEnd?.();
      }}
      onPointerCancel={() => {
        drag.current = null;
        ref.current?.classList.remove('is-dragging');
        document.body.classList.remove('is-resizing-v', 'is-resizing-h');
        onDragEnd?.();
      }}
      onDoubleClick={() => onReset?.()}
      onKeyDown={(e) => {
        const back = dir === 'v' ? 'ArrowLeft' : 'ArrowUp';
        const fwd = dir === 'v' ? 'ArrowRight' : 'ArrowDown';
        if (e.key !== back && e.key !== fwd) return;
        e.preventDefault();
        e.stopPropagation();
        onDragStart?.();
        onDrag(e.key === fwd ? 16 : -16);
        onDragEnd?.();
      }}
    />
  );
}
