// Tooltips. OWNED BY THE SHELL PACKAGE.
//
// Mount <TooltipLayer/> once (the shell and the hub do). Then any element can
// declare a tooltip with attributes, no wrapper components needed:
//
//   data-tip="Ripple delete"          the text
//   data-tip-action="timeline.split"  shows the action's current shortcut (and its
//                                     label when data-tip is empty)
//   data-tip-keys="Mod+Z"             explicit shortcut(s), comma separated
//   data-tip-side="top|bottom|left|right"   preferred side (default: bottom)
//
// The first tooltip appears after a short delay; moving to a neighbour while
// one is visible shows the next one instantly (like native toolbars).

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { displayKey, getAction, keysFor } from '../workspaces/video/actions';

interface TipState {
  text: string;
  keys: string[];
  rect: DOMRect;
  side: 'top' | 'bottom' | 'left' | 'right';
}

const DELAY = 480;
const WARM_MS = 700;

function read(el: HTMLElement): Omit<TipState, 'rect'> | null {
  const actionId = el.dataset.tipAction;
  let text = el.dataset.tip ?? '';
  let keys: string[] = [];
  if (actionId) {
    keys = keysFor(actionId).slice(0, 1);
    if (!text) text = getAction(actionId)?.label ?? '';
  }
  if (el.dataset.tipKeys)
    keys = el.dataset.tipKeys
      .split(',')
      .map((k) => k.trim())
      .filter(Boolean);
  if (!text && keys.length === 0) return null;
  const side = (el.dataset.tipSide as TipState['side']) || 'bottom';
  return { text, keys, side };
}

export function TooltipLayer() {
  const [tip, setTip] = useState<TipState | null>(null);
  const timer = useRef<number | null>(null);
  const current = useRef<HTMLElement | null>(null);
  const lastHide = useRef(0);

  useEffect(() => {
    const clear = () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = null;
    };
    const hide = () => {
      clear();
      if (current.current) lastHide.current = Date.now();
      current.current = null;
      setTip(null);
    };
    const show = (el: HTMLElement) => {
      if (!el.isConnected) return;
      const data = read(el);
      if (!data) return;
      setTip({ ...data, rect: el.getBoundingClientRect() });
    };
    const onOver = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      const el = (e.target as Element | null)?.closest?.('[data-tip], [data-tip-action]') as HTMLElement | null;
      if (el === current.current) return;
      if (!el || (el as HTMLButtonElement).disabled === true) {
        if (current.current) hide();
        return;
      }
      const warm = !!current.current || Date.now() - lastHide.current < WARM_MS;
      clear();
      current.current = el;
      setTip(null);
      if (warm) show(el);
      else timer.current = window.setTimeout(() => show(el), DELAY);
    };
    const onOut = (e: PointerEvent) => {
      const cur = current.current;
      if (!cur) return;
      const to = e.relatedTarget as Node | null;
      if (to && cur.contains(to)) return;
      hide();
    };
    const onDown = () => {
      clear();
      current.current = null;
      setTip(null);
    };
    document.addEventListener('pointerover', onOver, true);
    document.addEventListener('pointerout', onOut, true);
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onDown, true);
    window.addEventListener('wheel', onDown, { capture: true, passive: true });
    window.addEventListener('blur', hide);
    return () => {
      clear();
      document.removeEventListener('pointerover', onOver, true);
      document.removeEventListener('pointerout', onOut, true);
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onDown, true);
      window.removeEventListener('wheel', onDown, true);
      window.removeEventListener('blur', hide);
    };
  }, []);

  if (!tip) return null;
  return createPortal(<TipBubble tip={tip} />, document.body);
}

function TipBubble({ tip }: { tip: TipState }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; from: string } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const b = el.getBoundingClientRect();
    const r = tip.rect;
    const gap = 6;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let side = tip.side;
    if (side === 'bottom' && r.bottom + gap + b.height > vh - 4) side = 'top';
    else if (side === 'top' && r.top - gap - b.height < 4) side = 'bottom';
    else if (side === 'right' && r.right + gap + b.width > vw - 4) side = 'left';
    else if (side === 'left' && r.left - gap - b.width < 4) side = 'right';
    let left: number;
    let top: number;
    if (side === 'bottom' || side === 'top') {
      left = r.left + r.width / 2 - b.width / 2;
      top = side === 'bottom' ? r.bottom + gap : r.top - gap - b.height;
    } else {
      top = r.top + r.height / 2 - b.height / 2;
      left = side === 'right' ? r.right + gap : r.left - gap - b.width;
    }
    left = Math.max(6, Math.min(left, vw - b.width - 6));
    top = Math.max(6, Math.min(top, vh - b.height - 6));
    const from = side === 'bottom' ? '-2px' : side === 'top' ? '2px' : '0px';
    setPos({ left, top, from });
  }, [tip]);

  return (
    <div ref={ref} className="tooltip" role="tooltip" style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999, ['--tip-from' as string]: pos?.from ?? '0px' }}>
      {tip.text && <span>{tip.text}</span>}
      {tip.keys.length > 0 && (
        <span className="keys-inline">
          {tip.keys.map((k) => (
            <kbd key={k}>{displayKey(k)}</kbd>
          ))}
        </span>
      )}
    </div>
  );
}
