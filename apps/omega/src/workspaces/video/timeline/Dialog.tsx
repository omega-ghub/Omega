// Small modal dialog shell used by the timeline's dialogs, plus form rows.
import { useEffect, useRef, type ReactNode } from 'react';

export function Dialog({
  title,
  children,
  onClose,
  onSubmit,
  submitLabel = 'OK',
  width = 440,
  testId,
  footerLeft,
  submitDisabled,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  onSubmit?: () => void;
  submitLabel?: string;
  width?: number;
  testId?: string;
  footerLeft?: ReactNode;
  submitDisabled?: boolean;
}) {
  const panel = useRef<HTMLDivElement>(null);
  // latest handlers (Enter blurs the focused field first so it commits, then submits)
  const latest = useRef({ onClose, onSubmit, submitDisabled });
  latest.current = { onClose, onSubmit, submitDisabled };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        e.preventDefault();
        latest.current.onClose();
      } else if (e.key === 'Enter' && latest.current.onSubmit && !(e.target instanceof HTMLTextAreaElement) && !(e.target instanceof HTMLButtonElement)) {
        e.stopPropagation();
        e.preventDefault();
        (document.activeElement as HTMLElement | null)?.blur?.();
        setTimeout(() => {
          const l = latest.current;
          if (l.onSubmit && !l.submitDisabled) l.onSubmit();
        }, 0);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
  useEffect(() => {
    const first = panel.current?.querySelector<HTMLElement>('input, select, textarea');
    first?.focus();
    if (first instanceof HTMLInputElement) first.select();
  }, []);
  return (
    <div className="tl-dlg__backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="tl-dlg" style={{ width }} role="dialog" aria-modal="true" aria-label={title} data-testid={testId} ref={panel} onKeyDown={(e) => e.stopPropagation()}>
        <div className="tl-dlg__head">
          <span className="tl-dlg__title">{title}</span>
          <button className="tl-dlg__x" onClick={onClose} aria-label="Close">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <path d="M7 7l10 10M17 7 7 17" />
            </svg>
          </button>
        </div>
        <div className="tl-dlg__body">{children}</div>
        <div className="tl-dlg__foot">
          <div className="tl-dlg__foot-left">{footerLeft}</div>
          <button className="tl-btn" onClick={onClose}>
            Cancel
          </button>
          {onSubmit && (
            <button className="tl-btn tl-btn--primary" onClick={onSubmit} disabled={submitDisabled} data-testid={testId ? `${testId}-ok` : undefined}>
              {submitLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function Row({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="tl-row">
      <span className="tl-row__label">{label}</span>
      <span className="tl-row__ctl">{children}</span>
      {hint && <span className="tl-row__hint">{hint}</span>}
    </label>
  );
}

export function Check({ checked, onChange, label, disabled, testId }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean; testId?: string }) {
  return (
    <label className={`tl-check ${disabled ? 'is-disabled' : ''}`}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} data-testid={testId} />
      <span className="tl-check__box" aria-hidden="true">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 12.5l4.5 4.5L19 7.5" />
        </svg>
      </span>
      <span>{label}</span>
    </label>
  );
}

export function Segmented<T extends string>({ value, options, onChange, testId }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; testId?: string }) {
  return (
    <div className="tl-seg" role="radiogroup" data-testid={testId}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={o.value === value} className={`tl-seg__btn ${o.value === value ? 'is-on' : ''}`} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
