// Modal and dialog chrome. OWNED BY THE SHELL PACKAGE.
//
//   <Modal onClose width>…</Modal>              bare surface (keeps the v0 API)
//   <Dialog title subtitle icon footer onClose>  header + scrolling body + footer
//
// Escape closes only the top-most modal; clicking the backdrop closes it;
// focus moves into the dialog on open and returns to where it was on close.

import { useEffect, useRef, type ReactNode } from 'react';
import { I } from './Icons';

const stack: number[] = [];
let seq = 0;

export function Modal({
  children,
  onClose,
  width = 920,
  className = '',
  testId,
  label,
  dismissible = true,
}: {
  children: ReactNode;
  onClose: () => void;
  width?: number | string;
  className?: string;
  testId?: string;
  /** Accessible name when the dialog has no visible title. */
  label?: string;
  /** false = backdrop clicks and Escape do nothing (e.g. while busy). */
  dismissible?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const dismissRef = useRef(dismissible);
  dismissRef.current = dismissible;

  useEffect(() => {
    const id = ++seq;
    stack.push(id);
    const prev = document.activeElement as HTMLElement | null;
    // Focus the dialog itself unless something inside asked for autofocus.
    const t = requestAnimationFrame(() => {
      const el = ref.current;
      if (el && !el.contains(document.activeElement)) el.focus({ preventScroll: true });
    });
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || stack[stack.length - 1] !== id || e.defaultPrevented) return;
      e.preventDefault();
      e.stopPropagation();
      if (dismissRef.current) closeRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      cancelAnimationFrame(t);
      window.removeEventListener('keydown', onKey);
      const i = stack.indexOf(id);
      if (i >= 0) stack.splice(i, 1);
      if (prev && document.contains(prev)) prev.focus({ preventScroll: true });
    };
  }, []);

  return (
    <div className="modal__backdrop" onMouseDown={(e) => e.target === e.currentTarget && dismissRef.current && onClose()}>
      <div
        ref={ref}
        className={`modal ${className}`}
        style={{ width }}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        data-testid={testId}
      >
        {children}
      </div>
    </div>
  );
}

/** True while any Modal is open (the shell's keyboard handler checks this). */
export function isModalOpen(): boolean {
  return stack.length > 0;
}

export function Dialog({
  title,
  subtitle,
  icon,
  footer,
  footerLeft,
  onClose,
  width = 560,
  height,
  className = '',
  bodyClassName = '',
  flush = false,
  testId,
  dismissible,
  children,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  icon?: ReactNode;
  footer?: ReactNode;
  footerLeft?: ReactNode;
  onClose: () => void;
  width?: number | string;
  height?: number | string;
  className?: string;
  bodyClassName?: string;
  /** Body without padding (lists, split views). */
  flush?: boolean;
  testId?: string;
  dismissible?: boolean;
  children: ReactNode;
}) {
  return (
    <Modal onClose={onClose} width={width} className={`dialog ${className}`} testId={testId} label={typeof title === 'string' ? title : undefined} dismissible={dismissible}>
      <div className="dialog__head">
        {icon && <div className="dialog__icon">{icon}</div>}
        <div className="dialog__titles">
          <div className="dialog__title">{title}</div>
          {subtitle && <div className="dialog__sub">{subtitle}</div>}
        </div>
        <button className="icon-btn icon-btn--sm dialog__close" onClick={onClose} aria-label="Close" data-tip="Close" data-tip-keys="Escape">
          <I.Close size={16} />
        </button>
      </div>
      <div className={`dialog__body ${flush ? 'dialog__body--flush' : ''} ${bodyClassName}`} style={height !== undefined ? { height } : undefined}>
        {children}
      </div>
      {(footer || footerLeft) && (
        <div className="dialog__foot">
          {footerLeft && <div className="dialog__foot-left">{footerLeft}</div>}
          {footer}
        </div>
      )}
    </Modal>
  );
}
