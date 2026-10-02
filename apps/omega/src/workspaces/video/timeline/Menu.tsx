// Context menu (with submenus and keyboard navigation) rendered from the
// timeline view store.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { TI } from './icons';
import { useTLView, type MenuItem } from './view';

function MenuList({ items, x, y, onDone, testId, level = 0 }: { items: MenuItem[]; x: number; y: number; onDone: () => void; testId?: string; level?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });
  const [open, setOpen] = useState<number | null>(null);
  const [active, setActive] = useState<number>(-1);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    let nx = x;
    let ny = y;
    if (nx + r.width > window.innerWidth - 6) nx = level > 0 ? x - r.width - 180 : window.innerWidth - r.width - 6;
    if (ny + r.height > window.innerHeight - 6) ny = Math.max(6, window.innerHeight - r.height - 6);
    setPos({ x: Math.max(6, nx), y: ny });
  }, [x, y, level]);
  useEffect(() => {
    if (level > 0) return;
    const onKey = (e: KeyboardEvent) => {
      const enabled = items.map((it, i) => (!it.separator && !it.disabled ? i : -1)).filter((i) => i >= 0);
      if (e.key === 'Escape') onDone();
      else if (e.key === 'ArrowDown') setActive((a) => enabled[(enabled.indexOf(a) + 1) % enabled.length] ?? -1);
      else if (e.key === 'ArrowUp') setActive((a) => enabled[(enabled.indexOf(a) - 1 + enabled.length) % enabled.length] ?? -1);
      else if (e.key === 'ArrowRight' && active >= 0 && items[active].submenu) setOpen(active);
      else if (e.key === 'ArrowLeft') setOpen(null);
      else if (e.key === 'Enter' && active >= 0) {
        const it = items[active];
        if (it.submenu) setOpen(active);
        else if (it.run) {
          onDone();
          it.run();
        }
      } else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [items, active, onDone, level]);
  return (
    <div ref={ref} className="tl-menu" role="menu" style={{ left: pos.x, top: pos.y }} data-testid={testId} onContextMenu={(e) => e.preventDefault()}>
      {items.map((it, i) =>
        it.separator ? (
          <div key={i} className="tl-menu__sep" role="separator" />
        ) : (
          <div key={i} className="tl-menu__wrap" onMouseEnter={() => (setOpen(it.submenu ? i : null), setActive(i))}>
            <button
              className={`tl-menu__item ${it.danger ? 'is-danger' : ''} ${active === i ? 'is-active' : ''}`}
              role="menuitem"
              disabled={it.disabled}
              data-testid={it.testId}
              aria-haspopup={it.submenu ? 'menu' : undefined}
              onClick={() => {
                if (it.submenu) return setOpen(i);
                onDone();
                it.run?.();
              }}
            >
              <span className="tl-menu__check">{it.checked ? <TI.Check size={12} /> : it.swatch ? <span className="tl-menu__swatch" style={{ background: it.swatch }} /> : null}</span>
              <span className="tl-menu__label">{it.label}</span>
              {it.hint && <span className="tl-menu__hint">{it.hint}</span>}
              {it.submenu && <TI.ChevronRight size={12} />}
            </button>
            {it.submenu && open === i && <SubMenu items={it.submenu} parent={ref} index={i} onDone={onDone} level={level + 1} />}
          </div>
        ),
      )}
    </div>
  );
}

function SubMenu({ items, parent, index, onDone, level }: { items: MenuItem[]; parent: React.RefObject<HTMLDivElement | null>; index: number; onDone: () => void; level: number }) {
  const row = parent.current?.children[index] as HTMLElement | undefined;
  const r = row?.getBoundingClientRect();
  if (!r) return null;
  return <MenuList items={items} x={r.right - 2} y={r.top - 4} onDone={onDone} level={level} />;
}

export function ContextMenu() {
  const menu = useTLView((s) => s.menu);
  useEffect(() => {
    if (!menu) return;
    const close = (e: Event) => {
      if (e.target instanceof Node && (e.target as Element).closest?.('.tl-menu')) return;
      useTLView.getState().openMenu(null);
    };
    const blur = () => useTLView.getState().openMenu(null);
    window.addEventListener('pointerdown', close, true);
    window.addEventListener('blur', blur);
    window.addEventListener('resize', blur);
    return () => {
      window.removeEventListener('pointerdown', close, true);
      window.removeEventListener('blur', blur);
      window.removeEventListener('resize', blur);
    };
  }, [menu]);
  if (!menu) return null;
  return <MenuList key={`${menu.x},${menu.y}`} items={menu.items} x={menu.x} y={menu.y} testId={menu.testId ?? 'tl-menu'} onDone={() => useTLView.getState().openMenu(null)} />;
}
