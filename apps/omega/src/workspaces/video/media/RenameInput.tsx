import { useLayoutEffect, useRef } from 'react';

/** Inline rename field: Enter or blur commits, Escape cancels. */
export function RenameInput({ initial, onCommit, onDone, className = '' }: { initial: string; onCommit: (value: string) => void; onDone: () => void; className?: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    // select the name without its extension, like Finder
    const dot = initial.lastIndexOf('.');
    el.setSelectionRange(0, dot > 0 ? dot : initial.length);
  }, [initial]);
  const finish = (commit: boolean) => {
    if (done.current) return;
    done.current = true;
    if (commit) onCommit(ref.current?.value ?? initial);
    onDone();
  };
  return (
    <input
      ref={ref}
      className={`input input--xs md-rename ${className}`}
      defaultValue={initial}
      data-testid="md-rename-input"
      spellCheck={false}
      aria-label="Name"
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') finish(true);
        else if (e.key === 'Escape') finish(false);
      }}
      onBlur={() => finish(true)}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      draggable={false}
      onDragStart={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    />
  );
}
