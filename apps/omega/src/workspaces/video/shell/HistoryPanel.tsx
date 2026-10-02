// History panel: every change with its label and age. Click a row to jump
// to that state; later changes stay available (greyed) until you edit again.
// OWNED BY THE SHELL PACKAGE.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useEditor } from '../../../state/store';
import { I } from '../../../ui/Icons';
import { EmptyState } from '../../../ui/controls';

export function relativeTime(ts: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 5) return 'now';
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function useNow(ms: number) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

export function HistoryPanel() {
  const past = useEditor((s) => s.past);
  const future = useEditor((s) => s.future);
  const jump = useEditor((s) => s.jumpToHistory);
  const readOnly = useEditor((s) => s.readOnly);
  const now = useNow(15_000);
  const listRef = useRef<HTMLDivElement>(null);

  // Keep the current state in view.
  useLayoutEffect(() => {
    listRef.current?.querySelector('.is-current')?.scrollIntoView({ block: 'nearest' });
  }, [past.length, future.length]);

  if (past.length === 0 && future.length === 0) {
    return <EmptyState icon={<I.History size={18} />} title="No changes yet" sub="Every edit appears here with a label. Click one to step back to it." testId="sh-history-empty" />;
  }

  // Row r = the document after r changes. Row 0 is the project as opened.
  const rows: { label: string; time: number | null; state: 'past' | 'current' | 'future' }[] = [
    { label: 'Project opened', time: null, state: past.length === 0 ? 'current' : 'past' },
    ...past.map((h, i) => ({ label: h.label, time: h.time, state: (i === past.length - 1 ? 'current' : 'past') as 'past' | 'current' })),
    ...future.map((h) => ({ label: h.label, time: h.time, state: 'future' as const })),
  ];

  return (
    <div className="sh-history" ref={listRef} role="listbox" aria-label="History" data-testid="sh-history">
      {rows.map((r, i) => (
        <button
          key={i}
          role="option"
          aria-selected={r.state === 'current'}
          className={`sh-history__row is-${r.state}`}
          disabled={readOnly}
          data-testid="sh-history-row"
          onClick={() => jump(i)}
        >
          <span className="sh-history__rail">
            <span className="sh-history__dot" />
          </span>
          <span className="sh-history__label truncate">{r.label}</span>
          {r.time !== null && <span className="sh-history__time">{relativeTime(r.time, now)}</span>}
        </button>
      ))}
    </div>
  );
}
