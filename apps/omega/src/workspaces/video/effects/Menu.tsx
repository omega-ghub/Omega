// Popover primitives for the effects UI: a fixed-position popover anchored to
// a button (rendered in a portal so scroll containers never clip it) and an
// accessible menu list with arrow-key navigation.

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export interface PopoverProps {
  anchor: HTMLElement | null;
  onClose: () => void;
  children: ReactNode;
  /** Preferred width in px. */
  width?: number;
  align?: 'start' | 'end';
  className?: string;
  'data-testid'?: string;
}

export function Popover(props: PopoverProps) {
  const { anchor, onClose, children, width, align = 'end', className } = props;
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; maxH: number } | null>(null);

  useLayoutEffect(() => {
    if (!anchor) return;
    const place = () => {
      const r = anchor.getBoundingClientRect();
      const el = ref.current;
      const w = el?.offsetWidth ?? width ?? 220;
      const h = el?.offsetHeight ?? 200;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      let left = align === 'end' ? r.right - w : r.left;
      left = Math.max(6, Math.min(left, vw - w - 6));
      const below = vh - r.bottom - 8;
      const above = r.top - 8;
      const openUp = below < Math.min(h, 240) && above > below;
      const maxH = Math.max(120, openUp ? above : below);
      const top = openUp ? Math.max(6, r.top - Math.min(h, maxH) - 4) : r.bottom + 4;
      setPos({ left, top, maxH });
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [anchor, width, align]);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchor?.contains(t)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        anchor?.focus();
      }
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [anchor, onClose]);

  return createPortal(
    <div
      ref={ref}
      className={`fx-pop ${className ?? ''}`}
      style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999, width, maxHeight: pos?.maxH }}
      data-testid={props['data-testid']}
      onKeyDown={(e) => e.stopPropagation()}
    >
      {children}
    </div>,
    document.body,
  );
}

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  hint?: string;
  run: () => void;
  disabled?: boolean;
  danger?: boolean;
  'data-testid'?: string;
}

export type MenuEntry = MenuItem | 'separator';

/** A vertical menu: ↑/↓ move, Enter/Space run, Escape closes (via Popover). */
export function MenuList({ items, onDone }: { items: MenuEntry[]; onDone: () => void }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  useEffect(() => {
    const first = refs.current.find((b) => b && !b.disabled);
    first?.focus();
  }, []);
  const move = (from: number, dir: 1 | -1) => {
    const n = refs.current.length;
    for (let k = 1; k <= n; k++) {
      const b = refs.current[(from + dir * k + n * 2) % n];
      if (b && !b.disabled) {
        b.focus();
        return;
      }
    }
  };
  let idx = -1;
  return (
    <div className="fx-menu" role="menu">
      {items.map((it, i) => {
        if (it === 'separator') return <div key={`s${i}`} className="fx-menu__sep" role="separator" />;
        const my = ++idx;
        return (
          <button
            key={it.label}
            ref={(el) => {
              refs.current[my] = el;
            }}
            type="button"
            role="menuitem"
            className={`fx-menu__item${it.danger ? ' fx-menu__item--danger' : ''}`}
            disabled={it.disabled}
            data-testid={it['data-testid']}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                move(my, 1);
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                move(my, -1);
              }
            }}
            onClick={() => {
              onDone();
              it.run();
            }}
          >
            <span className="fx-menu__icon">{it.icon}</span>
            <span className="fx-menu__label">{it.label}</span>
            {it.hint && <span className="fx-menu__hint">{it.hint}</span>}
          </button>
        );
      })}
    </div>
  );
}
