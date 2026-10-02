// Small design-system controls shared by the hub and every app. OWNED BY THE
// SHELL PACKAGE. (Delta's parameter controls — ScrubNumber, Slider, ColorField…
// — live in workspaces/video/inspector/controls.tsx.)

import type { ReactNode } from 'react';
import { displayKey, isMac } from '../workspaces/video/actions';

export function Switch({ checked, onChange, disabled, label, testId }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label?: string; testId?: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} className="switch" disabled={disabled} data-testid={testId} onClick={() => onChange(!checked)} />
  );
}

export function Checkbox({
  checked,
  onChange,
  children,
  disabled,
  testId,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  children?: ReactNode;
  disabled?: boolean;
  testId?: string;
}) {
  return (
    <label className="check">
      <input type="checkbox" className="checkbox" checked={checked} disabled={disabled} data-testid={testId} onChange={(e) => onChange(e.target.checked)} />
      {children && <span>{children}</span>}
    </label>
  );
}

export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  size,
  block,
  testId,
}: {
  value: T;
  options: { value: T; label: ReactNode; tip?: string; testId?: string }[];
  onChange: (v: T) => void;
  size?: 'sm';
  block?: boolean;
  testId?: string;
}) {
  return (
    <div className={`seg ${size === 'sm' ? 'seg--sm' : ''} ${block ? 'seg--block' : ''}`} role="radiogroup" data-testid={testId}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          className={o.value === value ? 'is-active' : ''}
          data-tip={o.tip}
          data-testid={o.testId}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Splits a binding into display chips: 'Mod+Shift+Z' → [Ctrl] [Shift] [Z] (or ⌘⇧Z on macOS). */
export function keyChips(binding: string): string[] {
  if (isMac) return [displayKey(binding)];
  return binding.split('+').map((p) => displayKey(p));
}

/** Renders a key binding (registry syntax) as keycaps. */
export function Keys({ binding, className = '' }: { binding: string; className?: string }) {
  return (
    <span className={`keys-inline ${className}`}>
      {keyChips(binding).map((k, i) => (
        <kbd key={i}>{k}</kbd>
      ))}
    </span>
  );
}

export function EmptyState({ icon, title, sub, children, testId }: { icon?: ReactNode; title: ReactNode; sub?: ReactNode; children?: ReactNode; testId?: string }) {
  return (
    <div className="empty-state" data-testid={testId}>
      {icon && <div className="empty-state__icon">{icon}</div>}
      <div className="empty-state__title">{title}</div>
      {sub && <div className="empty-state__sub">{sub}</div>}
      {children && <div className="empty-state__actions">{children}</div>}
    </div>
  );
}
