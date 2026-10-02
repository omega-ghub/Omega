// Inspector field building blocks bound to the document: numeric params
// (animatable through param paths), point params, text inputs and helpers
// that run edit ops with friendly error handling.

import { useEffect, useState, type ReactNode } from 'react';
import { useEditor } from '../../../state/store';
import { LABEL_COLORS } from '../../../state/defaults';
import type { Clip, LabelColor, Project, Sequence } from '../../../state/types';
import { editParam, ParamRow, PointField, ScrubNumber, Slider, useParam } from './controls';

/** Runs an edit through mutateSequence; reports failures (e.g. an unimplemented op) as a toast. */
export function runEdit(label: string, recipe: (seq: Sequence, project: Project) => void, opts?: { coalesceKey?: string }): boolean {
  try {
    useEditor.getState().mutateSequence(label, recipe, opts);
    return true;
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    useEditor.getState().showToast(/not implemented/i.test(msg) ? `${label}: not available in this build` : `${label} failed: ${msg}`, 'error');
    return false;
  }
}

export interface NumParamProps {
  clip: Clip;
  path: string;
  label: ReactNode;
  min?: number;
  max?: number;
  step?: number;
  dragStep?: number;
  unit?: string;
  displayScale?: number;
  precision?: number;
  defaultValue?: number;
  /** Adds a slider before the number. */
  slider?: { min: number; max: number; scale?: 'linear' | 'log' };
  /** Show the keyframe button (default true). */
  kf?: boolean;
  hint?: string;
  indent?: boolean;
  testid?: string;
  disabled?: boolean;
}

/** One animatable numeric param of a clip: label · [slider] number · keyframes. */
export function NumParam(p: NumParamProps) {
  const v = useParam(p.clip.id, p.path);
  const onChange = (x: number) => editParam(p.clip.id, p.path, x);
  const tid = p.testid ?? `ins-p-${p.path}`;
  return (
    <ParamRow
      label={p.label}
      clipId={p.kf === false ? undefined : p.clip.id}
      path={p.kf === false ? undefined : p.path}
      hint={p.hint}
      indent={p.indent}
      onReset={p.defaultValue !== undefined ? () => onChange(p.defaultValue!) : undefined}
    >
      {p.slider && (
        <Slider
          value={v}
          min={p.slider.min}
          max={p.slider.max}
          scale={p.slider.scale}
          step={p.step}
          defaultValue={p.defaultValue}
          disabled={p.disabled}
          aria-label={typeof p.label === 'string' ? p.label : undefined}
          data-testid={`${tid}-slider`}
          onChange={onChange}
        />
      )}
      <ScrubNumber
        value={v}
        min={p.min}
        max={p.max}
        step={p.step}
        dragStep={p.dragStep}
        unit={p.unit}
        displayScale={p.displayScale}
        precision={p.precision}
        defaultValue={p.defaultValue}
        disabled={p.disabled}
        width={p.slider ? 68 : undefined}
        aria-label={typeof p.label === 'string' ? p.label : undefined}
        data-testid={tid}
        onChange={onChange}
      />
    </ParamRow>
  );
}

export interface PointParamProps {
  clip: Clip;
  paths: [string, string];
  label: ReactNode;
  step?: number;
  dragStep?: number;
  unit?: string;
  displayScale?: number;
  precision?: number;
  min?: number;
  max?: number;
  defaultValue?: { x: number; y: number };
  labels?: [string, string];
  testid?: string;
  indent?: boolean;
}

/** Two animatable params edited as a pair, keyframed together. */
export function PointParam(p: PointParamProps) {
  const x = useParam(p.clip.id, p.paths[0]);
  const y = useParam(p.clip.id, p.paths[1]);
  return (
    <ParamRow
      label={p.label}
      clipId={p.clip.id}
      path={p.paths}
      indent={p.indent}
      onReset={
        p.defaultValue
          ? () => {
              editParam(p.clip.id, p.paths[0], p.defaultValue!.x);
              editParam(p.clip.id, p.paths[1], p.defaultValue!.y);
            }
          : undefined
      }
    >
      <PointField
        value={{ x, y }}
        step={p.step}
        unit={p.unit}
        displayScale={p.displayScale}
        precision={p.precision}
        min={p.min}
        max={p.max}
        labels={p.labels}
        defaultValue={p.defaultValue}
        data-testid={p.testid ?? `ins-p-${p.paths[0]}`}
        onChange={() => undefined}
        onAxisChange={(axis, v) => editParam(p.clip.id, axis === 'x' ? p.paths[0] : p.paths[1], v)}
      />
    </ParamRow>
  );
}

/** Single-line text input that commits on Enter / blur (Escape reverts). */
export function TextInput(props: {
  value: string;
  onCommit: (v: string) => void;
  placeholder?: string;
  'data-testid'?: string;
  'aria-label'?: string;
  className?: string;
}) {
  const [text, setText] = useState(props.value);
  useEffect(() => setText(props.value), [props.value]);
  return (
    <input
      className={`ins-input ${props.className ?? ''}`}
      value={text}
      placeholder={props.placeholder}
      spellCheck={false}
      aria-label={props['aria-label']}
      data-testid={props['data-testid']}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => text !== props.value && props.onCommit(text)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') {
          setText(props.value);
          requestAnimationFrame(() => (e.target as HTMLInputElement).blur());
        }
      }}
    />
  );
}

/** Multi-line text area that writes every keystroke (coalesced by the caller's key). */
export function TextArea(props: { value: string; onChange: (v: string) => void; rows?: number; placeholder?: string; autoFocus?: boolean; 'data-testid'?: string; 'aria-label'?: string }) {
  return (
    <textarea
      autoFocus={props.autoFocus}
      className="ins-textarea"
      value={props.value}
      rows={props.rows ?? 3}
      placeholder={props.placeholder}
      spellCheck={false}
      aria-label={props['aria-label']}
      data-testid={props['data-testid']}
      onChange={(e) => props.onChange(e.target.value)}
      onKeyDown={(e) => e.stopPropagation()}
    />
  );
}

export const LABELS: LabelColor[] = ['none', 'red', 'orange', 'yellow', 'green', 'teal', 'blue', 'violet', 'pink', 'grey'];

/** Row of label color swatches. `value` null = mixed. */
export function LabelPicker(props: { value: LabelColor | null; onChange: (l: LabelColor) => void; testid?: string }) {
  return (
    <div className="ins-labels" role="radiogroup" aria-label="Label color" data-testid={props.testid ?? 'ins-label'}>
      {LABELS.map((l) => (
        <button
          key={l}
          type="button"
          role="radio"
          aria-checked={props.value === l}
          aria-label={l === 'none' ? 'No label' : l}
          title={l === 'none' ? 'No label' : l[0].toUpperCase() + l.slice(1)}
          data-testid={`${props.testid ?? 'ins-label'}-${l}`}
          className={`ins-labels__dot ${props.value === l ? 'ins-labels__dot--on' : ''} ${l === 'none' ? 'ins-labels__dot--none' : ''}`}
          style={{ ['--dot' as string]: LABEL_COLORS[l] }}
          onClick={() => props.onChange(l)}
        />
      ))}
    </div>
  );
}

/** A plain button in the inspector style. */
export function Btn(props: { children: ReactNode; onClick: () => void; title?: string; disabled?: boolean; primary?: boolean; 'data-testid'?: string; className?: string }) {
  return (
    <button
      type="button"
      className={`ins-btn ${props.primary ? 'ins-btn--primary' : ''} ${props.className ?? ''}`}
      title={props.title}
      disabled={props.disabled}
      data-testid={props['data-testid']}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  );
}

/** Read-only value row. */
export function InfoRow(props: { label: ReactNode; children: ReactNode; testid?: string }) {
  return (
    <div className="ins-row ins-row--nokf ins-row--info" data-testid={props.testid}>
      <span className="ins-row__label">{props.label}</span>
      <div className="ins-row__control ins-info">{props.children}</div>
    </div>
  );
}
