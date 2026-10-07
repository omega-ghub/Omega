// The clip's effect stack (used by the Inspector): ordered cards with enable
// toggle, collapse, drag-to-reorder, a menu (duplicate, reset, delete, copy,
// paste) and param editors generated from each effect's ParamDefs, with
// keyframing (stopwatch, add/remove diamond, previous/next).

import { useRef, useState, type DragEvent, type PointerEvent as RPointerEvent } from 'react';
import { getEffect } from '../../../engine/effects/registry';
import type { ParamDef } from '../../../engine/effects/types';
import { setParam } from '../../../engine/keyframes';
import type { EffectInstance } from '../../../state/types';
import { ColorField, ParamRow, ScrubNumber, Section, Select, Slider, Toggle, editClip, localTime, useClip, useLocalTime, useParam } from '../inspector/controls';
import { FxI } from './icons';
import { dropIndex, formatPoint, isAnimatable, paramStep, parsePoint, sliderRange } from './logic';
import { MenuList, Popover, type MenuEntry } from './Menu';
import {
  copyClipEffects,
  deleteEffect,
  duplicateEffect,
  moveEffect,
  pasteClipEffects,
  resetEffectParams,
  setCardCollapsed,
  setEffectEnabled,
  useCollapsedCards,
  useEffectsClipboard,
} from './ops';
import { useEditor } from '../../../state/store';
import './effects.css';

// ---------------------------------------------------------------------------
// Param editors
// ---------------------------------------------------------------------------

function setStatic(clipId: string, fx: EffectInstance, def: ParamDef, value: number | boolean | string, label: string) {
  const name = `${getEffect(fx.type)?.name ?? fx.type}: ${def.label}`;
  const playhead = useEditor.getState().playhead;
  editClip(
    clipId,
    `${label} ${name}`,
    (c) => {
      const e = c.effects.find((x) => x.id === fx.id);
      if (!e) return;
      if (typeof value === 'number') setParam(c, `effects.${fx.id}.${def.key}`, localTime(c, playhead), value);
      else e.params[def.key] = value;
    },
    { coalesceKey: `fx:${clipId}:${fx.id}:${def.key}` },
  );
}

function PointPad({ value, onChange, testid }: { value: { x: number; y: number }; onChange: (p: { x: number; y: number }, final: boolean) => void; testid: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = (e: RPointerEvent<HTMLDivElement>, final: boolean) => {
    const r = ref.current!.getBoundingClientRect();
    onChange({ x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }, final);
  };
  return (
    <div
      ref={ref}
      className="fx-pad"
      data-testid={testid}
      title="Drag the crosshair to pick a point"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        drag(e, false);
      }}
      onPointerMove={(e) => e.currentTarget.hasPointerCapture(e.pointerId) && drag(e, false)}
      onPointerUp={(e) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
          e.currentTarget.releasePointerCapture(e.pointerId);
          drag(e, true);
        }
      }}
    >
      <span className="fx-pad__h" style={{ top: `${Math.max(0, Math.min(1, value.y)) * 100}%` }} />
      <span className="fx-pad__v" style={{ left: `${Math.max(0, Math.min(1, value.x)) * 100}%` }} />
      <span className="fx-pad__dot" style={{ left: `${Math.max(0, Math.min(1, value.x)) * 100}%`, top: `${Math.max(0, Math.min(1, value.y)) * 100}%` }} />
    </div>
  );
}

function ParamEditor({ clipId, fx, def }: { clipId: string; fx: EffectInstance; def: ParamDef }) {
  const path = `effects.${fx.id}.${def.key}`;
  const animatable = isAnimatable(def);
  const live = useParam(clipId, path);
  const tid = `fx-param-${fx.type}-${def.key}`;
  const raw = fx.params[def.key] ?? def.default;
  const reset = () => setStatic(clipId, fx, def, def.default, 'Reset');
  let control: React.ReactNode = null;

  if (def.type === 'number' || def.type === 'angle') {
    const v = animatable ? live : Number(raw);
    const { min, max } = sliderRange(def);
    const unit = def.type === 'angle' ? '°' : def.unit === 'x' ? '×' : def.unit;
    const set = (n: number) => setStatic(clipId, fx, def, n, 'Change');
    control = (
      <>
        <Slider value={v} min={min} max={max} step={paramStep(def)} defaultValue={Number(def.default)} aria-label={def.label} data-testid={`${tid}-slider`} onChange={(n) => set(Math.min(def.max ?? Infinity, Math.max(def.min ?? -Infinity, n)))} />
        <ScrubNumber value={v} min={def.min} max={def.max} step={paramStep(def)} unit={unit} defaultValue={Number(def.default)} width={64} aria-label={def.label} data-testid={tid} onChange={set} />
      </>
    );
  } else if (def.type === 'bool') {
    control = <Toggle checked={raw === true || raw === 1 || raw === 'true'} aria-label={def.label} data-testid={tid} onChange={(on) => setStatic(clipId, fx, def, on, 'Change')} />;
  } else if (def.type === 'choice') {
    control = (
      <Select
        value={Number(raw)}
        options={(def.choices ?? []).map((c) => ({ value: c.value, label: c.label }))}
        aria-label={def.label}
        data-testid={tid}
        onChange={(n) => setStatic(clipId, fx, def, n, 'Change')}
      />
    );
  } else if (def.type === 'color') {
    control = <ColorField value={String(raw)} alpha aria-label={def.label} data-testid={tid} onChange={(c) => setStatic(clipId, fx, def, c, 'Change')} />;
  } else if (def.type === 'point') {
    const p = parsePoint(raw, parsePoint(def.default));
    const set = (q: { x: number; y: number }) => setStatic(clipId, fx, def, formatPoint({ x: Math.round(q.x * 1000) / 1000, y: Math.round(q.y * 1000) / 1000 }), 'Move');
    control = (
      <div className="fx-point">
        <PointPad value={p} testid={`${tid}-pad`} onChange={(q) => set({ x: Math.max(0, Math.min(1, q.x)), y: Math.max(0, Math.min(1, q.y)) })} />
        <div className="fx-point__nums">
          <ScrubNumber value={p.x} step={0.005} precision={3} width={56} defaultValue={parsePoint(def.default).x} aria-label={`${def.label} X`} data-testid={`${tid}-x`} onChange={(x) => set({ x, y: p.y })} />
          <ScrubNumber value={p.y} step={0.005} precision={3} width={56} defaultValue={parsePoint(def.default).y} aria-label={`${def.label} Y`} data-testid={`${tid}-y`} onChange={(y) => set({ x: p.x, y })} />
        </div>
      </div>
    );
  }
  if (!control) return null;
  return (
    <ParamRow label={def.label} hint={def.hint ?? def.label} clipId={animatable ? clipId : undefined} path={animatable ? path : undefined} onReset={reset} reserveKeyframe={animatable} data-testid={`${tid}-row`} className={def.type === 'point' ? 'fx-row--point' : undefined}>
      {control}
    </ParamRow>
  );
}

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------

function EffectCard({
  clipId,
  fx,
  index,
  count,
  dragFrom,
  setDragFrom,
}: {
  clipId: string;
  fx: EffectInstance;
  index: number;
  count: number;
  dragFrom: number | null;
  setDragFrom: (i: number | null) => void;
}) {
  const def = getEffect(fx.type);
  const collapsedSet = useCollapsedCards();
  const clip = useClip(clipId);
  const clipboard = useEffectsClipboard();
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const [over, setOver] = useState<'before' | 'after' | null>(null);
  const collapsed = collapsedSet.has(fx.id);
  const name = def?.name ?? fx.type;
  const animated = !!clip && Object.keys(clip.keyframes).some((k) => k.startsWith(`effects.${fx.id}.`));

  const items: MenuEntry[] = [
    { label: 'Duplicate', icon: <FxI.Duplicate size={14} />, run: () => duplicateEffect(clipId, fx.id), 'data-testid': 'fx-menu-duplicate' },
    { label: 'Reset', icon: <FxI.Reset size={14} />, run: () => resetEffectParams(clipId, fx.id), disabled: !def, 'data-testid': 'fx-menu-reset' },
    'separator',
    { label: 'Copy', icon: <FxI.Copy size={14} />, run: () => copyClipEffects(clipId, [fx.id]), 'data-testid': 'fx-menu-copy' },
    { label: 'Paste after', icon: <FxI.Paste size={14} />, run: () => pasteClipEffects([clipId], index + 1), disabled: !clipboard, 'data-testid': 'fx-menu-paste' },
    'separator',
    { label: 'Move up', icon: <FxI.Up size={14} />, run: () => moveEffect(clipId, index, index - 1), disabled: index === 0, 'data-testid': 'fx-menu-up' },
    { label: 'Move down', icon: <FxI.Down size={14} />, run: () => moveEffect(clipId, index, index + 1), disabled: index === count - 1, 'data-testid': 'fx-menu-down' },
    'separator',
    { label: 'Delete', icon: <FxI.Trash size={14} />, run: () => deleteEffect(clipId, fx.id), danger: true, 'data-testid': 'fx-menu-delete' },
  ];

  const onDragOver = (e: DragEvent) => {
    if (dragFrom === null) return;
    e.preventDefault();
    const r = e.currentTarget.getBoundingClientRect();
    setOver(e.clientY > r.top + r.height / 2 ? 'after' : 'before');
  };
  const onDrop = (e: DragEvent) => {
    if (dragFrom === null) return;
    e.preventDefault();
    const to = dropIndex(dragFrom, index, over === 'after');
    setOver(null);
    setDragFrom(null);
    if (to !== dragFrom) moveEffect(clipId, dragFrom, to);
  };

  return (
    <div
      className={`fx-card${fx.enabled ? '' : ' is-off'}${over ? ` is-over-${over}` : ''}${dragFrom === index ? ' is-dragging' : ''}`}
      data-testid={`fx-card-${fx.type}`}
      data-fx-id={fx.id}
      onDragOver={onDragOver}
      onDragLeave={() => setOver(null)}
      onDrop={onDrop}
    >
      <div className="fx-card__head">
        <span
          className="fx-card__grip"
          draggable
          title="Drag to reorder"
          data-testid={`fx-grip-${fx.type}`}
          onDragStart={(e) => {
            e.dataTransfer.setData('omega/fx-reorder', fx.id);
            e.dataTransfer.effectAllowed = 'move';
            setDragFrom(index);
          }}
          onDragEnd={() => {
            setDragFrom(null);
            setOver(null);
          }}
        >
          <FxI.Grip size={14} />
        </span>
        <button type="button" className="fx-card__toggle" aria-expanded={!collapsed} aria-label={collapsed ? `Expand ${name}` : `Collapse ${name}`} data-testid={`fx-collapse-${fx.type}`} onClick={() => setCardCollapsed(fx.id, !collapsed)}>
          <FxI.Chevron size={12} className={collapsed ? '' : 'fx-rot'} />
          <span className="fx-card__name">{name}</span>
          {animated && <span className="fx-card__anim" title="Has keyframes" />}
        </button>
        <Toggle checked={fx.enabled} aria-label={`${name} enabled`} title={fx.enabled ? 'Disable effect' : 'Enable effect'} data-testid={`fx-enable-${fx.type}`} onChange={(on) => setEffectEnabled(clipId, fx.id, on)} />
        <button type="button" className="fx-iconbtn" aria-label={`${name} menu`} title="More" data-testid={`fx-menu-${fx.type}`} onClick={(e) => setMenu(menu ? null : e.currentTarget)}>
          <FxI.More size={15} />
        </button>
        {menu && (
          <Popover anchor={menu} onClose={() => setMenu(null)} width={176} data-testid="fx-menu">
            <MenuList items={items} onDone={() => setMenu(null)} />
          </Popover>
        )}
      </div>
      {!collapsed && (
        <div className="fx-card__body">
          {def ? def.params.map((p) => <ParamEditor key={p.key} clipId={clipId} fx={fx} def={p} />) : <p className="fx-note">This effect ({fx.type}) is not available.</p>}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stack
// ---------------------------------------------------------------------------

export function EffectStack({ clipId }: { clipId: string }) {
  const clip = useClip(clipId || null);
  const clipboard = useEffectsClipboard();
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  useLocalTime(clipId || null);
  if (!clip) return null;
  const n = clip.effects.length;
  return (
    <Section
      id="effects"
      title="Effects"
      badge={n || undefined}
      data-testid="fx-stack"
      actions={
        <>
          <button type="button" className="fx-iconbtn" title="Copy all effects" aria-label="Copy all effects" disabled={!n} data-testid="fx-copy-all" onClick={() => copyClipEffects(clipId)}>
            <FxI.Copy size={14} />
          </button>
          <button type="button" className="fx-iconbtn" title="Paste effects" aria-label="Paste effects" disabled={!clipboard} data-testid="fx-paste" onClick={() => pasteClipEffects([clipId])}>
            <FxI.Paste size={14} />
          </button>
        </>
      }
    >
      {n === 0 ? (
        <p className="fx-note" data-testid="fx-empty">
          No effects. Double-click one in the Effects browser, or drag it onto this clip.
        </p>
      ) : (
        clip.effects.map((fx, i) => <EffectCard key={fx.id} clipId={clipId} fx={fx} index={i} count={n} dragFrom={dragFrom} setDragFrom={setDragFrom} />)
      )}
    </Section>
  );
}
