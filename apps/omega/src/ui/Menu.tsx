// Menus and context menus. OWNED BY THE SHELL PACKAGE; exported for everyone.
//
//   const menu = useContextMenu();
//   <div onContextMenu={(e) => menu.open(e, [
//     { label: 'Split at playhead', action: 'timeline.split' },     // runs the action, shows its shortcut
//     { label: 'Rename…', icon: <I.Text size={15}/>, onSelect: rename },
//     { type: 'separator' },
//     { label: 'Label', submenu: [...] },
//     { label: 'Delete', danger: true, onSelect: del },
//   ])} />
//   {menu.element}
//
// Or render <ContextMenu x y items onClose/> yourself. Keyboard: ↑/↓, Home/End,
// Enter/Space, → opens a submenu, ← / Escape closes. Clicking outside, scrolling
// or blurring the window closes it.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { displayKey, getAction, keysFor, runAction } from '../workspaces/video/actions';
import { I } from './Icons';

export type MenuItem =
  | {
      type?: 'item';
      label: string;
      icon?: ReactNode;
      /** Action id: runs it and shows its current shortcut. */
      action?: string;
      onSelect?: () => void;
      /** Display shortcut in registry syntax ('Mod+K'); defaults to the action's. */
      shortcut?: string;
      disabled?: boolean;
      danger?: boolean;
      checked?: boolean;
      submenu?: MenuItem[];
      testId?: string;
    }
  | { type: 'separator' }
  | { type: 'header'; label: string };

type Item = Extract<MenuItem, { label: string; type?: 'item' }>;

function isItem(m: MenuItem): m is Item {
  return m.type === undefined || m.type === 'item';
}

function enabled(m: Item): boolean {
  if (m.disabled) return false;
  if (m.action) {
    const a = getAction(m.action);
    if (!a && !m.onSelect) return false;
    if (a?.enabled && !a.enabled()) return false;
  }
  return true;
}

export function ContextMenu({
  x,
  y,
  items,
  onClose,
  minWidth,
  testId,
  /** Anchor rect: flips/aligns against it instead of a point (dropdowns). */
  anchor,
  level = 0,
}: {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
  minWidth?: number;
  testId?: string;
  anchor?: DOMRect;
  level?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [active, setActive] = useState(-1);
  const [sub, setSub] = useState<{ index: number; rect: DOMRect } | null>(null);
  const hasChecks = useMemo(() => items.some((m) => isItem(m) && m.checked !== undefined), [items]);

  // Position inside the viewport (flip when it would overflow).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = x;
    let top = y;
    if (anchor) {
      if (level > 0) {
        left = anchor.right + 2;
        top = anchor.top - 5;
        if (left + r.width > vw - 8) left = anchor.left - r.width - 2;
      } else {
        left = anchor.left;
        top = anchor.bottom + 4;
        if (top + r.height > vh - 8) top = anchor.top - r.height - 4;
      }
    }
    if (left + r.width > vw - 8) left = Math.max(8, vw - r.width - 8);
    if (top + r.height > vh - 8) top = Math.max(8, vh - r.height - 8);
    setPos({ left, top });
  }, [x, y, anchor, level]);

  useEffect(() => {
    if (level > 0) return;
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus({ preventScroll: true });
    const onDown = (e: MouseEvent) => {
      const t = e.target as Element | null;
      if (t && t.closest('.menu')) return;
      onClose();
    };
    const onBlur = () => onClose();
    const onScroll = (e: Event) => {
      const t = e.target as Element | null;
      if (t && t instanceof Element && t.closest('.menu')) return;
      onClose();
    };
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('blur', onBlur);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onBlur);
    return () => {
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onBlur);
      if (prev && document.contains(prev)) prev.focus({ preventScroll: true });
    };
  }, [onClose, level]);

  const choose = (m: Item, el?: HTMLElement | null) => {
    if (!enabled(m)) return;
    if (m.submenu) {
      const idx = items.indexOf(m);
      if (el) setSub({ index: idx, rect: el.getBoundingClientRect() });
      return;
    }
    onClose();
    // Run after the menu unmounts so actions that open dialogs get focus.
    setTimeout(() => {
      if (m.onSelect) m.onSelect();
      else if (m.action) runAction(m.action);
    }, 0);
  };

  const move = (dir: 1 | -1) => {
    const n = items.length;
    for (let k = 1; k <= n; k++) {
      const i = (active + dir * k + n * 2) % n;
      const m = items[i];
      if (isItem(m) && enabled(m)) {
        setActive(i);
        return;
      }
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      move(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      move(-1);
    } else if (e.key === 'Home') {
      e.preventDefault();
      setActive(-1);
      move(1);
    } else if (e.key === 'End') {
      e.preventDefault();
      setActive(items.length);
      move(-1);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const m = items[active];
      if (m && isItem(m)) choose(m, ref.current?.querySelector<HTMLElement>(`[data-index="${active}"]`));
    } else if (e.key === 'ArrowRight') {
      const m = items[active];
      if (m && isItem(m) && m.submenu) {
        e.preventDefault();
        choose(m, ref.current?.querySelector<HTMLElement>(`[data-index="${active}"]`));
      }
    } else if (e.key === 'Escape' || (e.key === 'ArrowLeft' && level > 0)) {
      e.preventDefault();
      e.nativeEvent.stopImmediatePropagation();
      onClose();
    } else if (e.key === 'Tab') {
      e.preventDefault();
    }
  };

  const subItem = sub ? items[sub.index] : null;

  const menu = (
    <div
      ref={ref}
      className="menu"
      role="menu"
      tabIndex={-1}
      data-testid={testId}
      style={{ left: pos?.left ?? x, top: pos?.top ?? y, minWidth, visibility: pos ? 'visible' : 'hidden' }}
      onKeyDown={onKeyDown}
      onContextMenu={(e) => e.preventDefault()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {items.map((m, i) => {
        if (m.type === 'separator') return <div key={i} className="menu__sep" role="separator" />;
        if (m.type === 'header') return <div key={i} className="menu__header">{m.label}</div>;
        const on = enabled(m);
        const binding = m.shortcut ?? (m.action ? keysFor(m.action)[0] : undefined);
        return (
          <button
            key={i}
            data-index={i}
            data-testid={m.testId}
            role={m.checked !== undefined ? 'menuitemcheckbox' : 'menuitem'}
            aria-checked={m.checked}
            aria-disabled={!on}
            aria-haspopup={m.submenu ? 'menu' : undefined}
            className={`menu__item ${i === active ? 'is-active' : ''} ${m.danger ? 'menu__item--danger' : ''}`}
            onMouseEnter={(e) => {
              setActive(on ? i : -1);
              if (m.submenu && on) setSub({ index: i, rect: e.currentTarget.getBoundingClientRect() });
              else setSub(null);
            }}
            onClick={(e) => choose(m, e.currentTarget)}
            tabIndex={-1}
          >
            {hasChecks && <span className="menu__check">{m.checked ? <I.Check size={14} /> : null}</span>}
            {m.icon}
            <span className="menu__label">{m.label}</span>
            {binding && !m.submenu && <span className="menu__shortcut">{displayKey(binding)}</span>}
            {m.submenu && <I.ChevronRight size={14} className="menu__chev" />}
          </button>
        );
      })}
      {subItem && isItem(subItem) && subItem.submenu && sub && (
        <ContextMenu
          x={sub.rect.right}
          y={sub.rect.top}
          anchor={sub.rect}
          level={level + 1}
          items={subItem.submenu}
          onClose={() => {
            setSub(null);
            if (level === 0) onClose();
          }}
        />
      )}
    </div>
  );
  return level > 0 ? menu : createPortal(menu, document.body);
}

/** Hook: `open(event, items)` at the pointer, render `element` somewhere. */
export function useContextMenu() {
  const [state, setState] = useState<{ x: number; y: number; items: MenuItem[]; anchor?: DOMRect } | null>(null);
  const close = useCallback(() => setState(null), []);
  const open = useCallback((e: { clientX: number; clientY: number; preventDefault?: () => void; stopPropagation?: () => void }, items: MenuItem[]) => {
    e.preventDefault?.();
    e.stopPropagation?.();
    setState({ x: e.clientX, y: e.clientY, items });
  }, []);
  /** Opens below an element (dropdown). */
  const openAt = useCallback((el: Element, items: MenuItem[]) => {
    const r = el.getBoundingClientRect();
    setState({ x: r.left, y: r.bottom + 4, items, anchor: r });
  }, []);
  const element = state ? <ContextMenu x={state.x} y={state.y} items={state.items} anchor={state.anchor} onClose={close} /> : null;
  return { open, openAt, close, element, isOpen: !!state };
}

/** A button that opens a dropdown menu. */
export function MenuButton({
  items,
  children,
  className = 'btn btn--sm',
  testId,
  tip,
  ...rest
}: {
  items: MenuItem[] | (() => MenuItem[]);
  children: ReactNode;
  className?: string;
  testId?: string;
  tip?: string;
  disabled?: boolean;
}) {
  const menu = useContextMenu();
  return (
    <>
      <button
        className={`${className} ${menu.isOpen ? 'is-open' : ''}`}
        data-testid={testId}
        data-tip={tip}
        aria-haspopup="menu"
        aria-expanded={menu.isOpen}
        onMouseDown={(e) => {
          if (menu.isOpen) {
            e.preventDefault();
            menu.close();
          }
        }}
        onClick={(e) => {
          if (menu.isOpen) return;
          menu.openAt(e.currentTarget, typeof items === 'function' ? items() : items);
        }}
        {...rest}
      >
        {children}
      </button>
      {menu.element}
    </>
  );
}
