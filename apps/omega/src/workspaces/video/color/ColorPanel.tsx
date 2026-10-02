// Color tools for the selected clip (an adjustment layer counts too):
// primaries (wheels + sliders), curves, HSL qualifier, LUT, looks, the
// utility bar (copy/paste/reset/bypass/compare/auto balance/match/apply to
// source) and the stills gallery.
import { useState, type ReactNode } from 'react';
import { paramAt } from '../../../engine/keyframes';
import { useEditor } from '../../../state/store';
import type { Clip, InputTransform } from '../../../state/types';
import {
  applyToSource,
  autoBalance,
  copyGrade,
  matchToReference,
  pasteGrade,
  resetGrade,
  setClipInputTransform,
  setCompare,
  setInputTransformForSource,
  toggleBypass,
} from './colorActions';
import { Select, Slider, SliderRow, ToolButton } from './controls';
import { CurveEditor } from './CurveEditor';
import { Gallery } from './Gallery';
import { clipUnderPlayhead, setGradeParam, useGradeClip, useGradeLocal } from './grade';
import { effectiveInputTransform, WHEELS } from './gradeOps';
import { CI } from './icons';
import { LooksSection } from './LooksSection';
import { LutSection } from './Lut';
import { QualifierSection } from './Qualifier';
import { useReference } from './stills';
import { Wheel } from './Wheel';
import './color.css';

type Tab = 'primaries' | 'curves' | 'hsl' | 'lut' | 'looks';
const TABS: { id: Tab; label: string; icon: (p: { size?: number }) => ReactNode }[] = [
  { id: 'primaries', label: 'Primaries', icon: CI.Wheels },
  { id: 'curves', label: 'Curves', icon: CI.Curve },
  { id: 'hsl', label: 'HSL', icon: CI.Qualifier },
  { id: 'lut', label: 'LUT', icon: CI.Lut },
  { id: 'looks', label: 'Looks', icon: CI.Looks },
];

export const INPUT_TRANSFORMS: { value: InputTransform; label: string; group?: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'rec709', label: 'Rec.709', group: 'Display' },
  { value: 'srgb', label: 'sRGB', group: 'Display' },
  { value: 'linear', label: 'Linear', group: 'Display' },
  { value: 'slog3', label: 'Sony S-Log3', group: 'Camera log' },
  { value: 'logc3', label: 'ARRI LogC3', group: 'Camera log' },
  { value: 'vlog', label: 'Panasonic V-Log', group: 'Camera log' },
  { value: 'clog3', label: 'Canon C-Log3', group: 'Camera log' },
  { value: 'flog', label: 'Fujifilm F-Log', group: 'Camera log' },
  { value: 'hlg', label: 'HLG (BT.2100)', group: 'HDR' },
  { value: 'pq', label: 'PQ (ST 2084)', group: 'HDR' },
];
const IT_LABEL = Object.fromEntries(INPUT_TRANSFORMS.map((t) => [t.value, t.label])) as Record<InputTransform, string>;
const LOG_ITS = new Set<InputTransform>(['slog3', 'logc3', 'vlog', 'clog3', 'flog']);

function loadTab(): Tab {
  try {
    const t = localStorage.getItem('delta.color.tab') as Tab | null;
    return t && TABS.some((x) => x.id === t) ? t : 'primaries';
  } catch {
    return 'primaries';
  }
}

export function ColorPanel(_props: Record<string, unknown> = {}) {
  const clip = useGradeClip();
  const [tab, setTabState] = useState<Tab>(loadTab);
  const setTab = (t: Tab) => {
    setTabState(t);
    try {
      localStorage.setItem('delta.color.tab', t);
    } catch {
      /* ignore */
    }
  };

  return (
    <section className="cl-panel" data-testid="cl-panel" aria-label="Color">
      {clip ? <ClipGrade clip={clip} tab={tab} setTab={setTab} /> : <EmptyState />}
      <Gallery />
    </section>
  );
}

function EmptyState() {
  const under = useEditor((s) => clipUnderPlayhead(s));
  const hasProject = useEditor((s) => !!s.project);
  return (
    <div className="cl-empty" data-testid="cl-empty">
      <CI.Grade size={28} />
      <div className="cl-empty__title">No clip selected</div>
      <div className="cl-empty__text">Select a clip or adjustment layer in the timeline to grade it.</div>
      {hasProject && under && (
        <button type="button" className="cl-tool" data-testid="cl-grade-under-playhead" onClick={() => useEditor.getState().selectClips([under.id])}>
          Grade “{under.name}”
        </button>
      )}
    </div>
  );
}

function ClipGrade({ clip, tab, setTab }: { clip: Clip; tab: Tab; setTab: (t: Tab) => void }) {
  const local = useGradeLocal(clip);
  const viewer = useEditor((s) => s.viewer);
  const clipboard = useEditor((s) => s.gradeClipboard);
  const targets = useEditor((s) => s.selection.clipIds.length);
  const project = useEditor((s) => s.project!);
  const reference = useReference();
  const asset = clip.assetId ? project.assets.find((a) => a.id === clip.assetId) : undefined;
  const effective = effectiveInputTransform(clip, project);
  const isMedia = clip.kind === 'media';
  const bypassed = !clip.grade.enabled;

  return (
    <>
      <header className="cl-head">
        <span className="cl-head__title">Color</span>
        <span className="cl-head__clip" title={clip.name} data-testid="cl-clip-name">
          {clip.kind === 'adjustment' ? 'Adjustment · ' : ''}
          {clip.name}
        </span>
        {targets > 1 && <span className="cl-badge" title="Copy, paste, reset, bypass and looks apply to every selected clip">{targets} selected</span>}
      </header>

      <div className="cl-toolbar" role="toolbar" aria-label="Grade tools">
        <ToolButton icon={<CI.Bypass size={15} />} label="Bypass" iconOnly title={bypassed ? 'Grade bypassed: click to enable (Ctrl+Alt+B)' : 'Bypass the grade (Ctrl+Alt+B)'} active={bypassed} onClick={toggleBypass} testid="cl-bypass" />
        <ToolButton icon={<CI.Split size={15} />} label="Split" iconOnly title="Compare: split view, ungraded on the left" active={viewer.compare === 'split'} onClick={() => setCompare('split')} testid="cl-compare-split" />
        <ToolButton icon={<CI.CompareBypass size={15} />} label="Before" iconOnly title="Compare: show the ungraded image" active={viewer.compare === 'bypass'} onClick={() => setCompare('bypass')} testid="cl-compare-bypass" />
        <span className="cl-toolbar__sep" />
        <ToolButton icon={<CI.Copy size={15} />} label="Copy" iconOnly title="Copy grade (Ctrl+Alt+C)" onClick={copyGrade} testid="cl-copy" />
        <ToolButton icon={<CI.Paste size={15} />} label="Paste" iconOnly title="Paste grade to the selected clips (Ctrl+Alt+Shift+V)" disabled={!clipboard} onClick={pasteGrade} testid="cl-paste" />
        <ToolButton icon={<CI.Reset size={15} />} label="Reset" iconOnly title="Reset grade" onClick={resetGrade} testid="cl-reset" />
        <span className="cl-toolbar__sep" />
        <ToolButton icon={<CI.Balance size={15} />} label="Auto" title="Auto balance: neutralize the colour cast of the current frame" onClick={() => void autoBalance()} testid="cl-auto-balance" />
        <ToolButton icon={<CI.Match size={15} />} label="Match" title={reference ? 'Match this clip to the reference still' : 'Grab a still and pick it as reference to match'} disabled={!reference} onClick={() => void matchToReference()} testid="cl-match" />
        {isMedia && <ToolButton icon={<CI.Source size={15} />} label="Source" iconOnly title="Apply this grade to all clips from this source" onClick={applyToSource} testid="cl-apply-source" />}
      </div>

      {viewer.compare === 'split' && (
        <div className="cl-compare" data-testid="cl-compare-position">
          <span className="cl-dim">Split</span>
          <Slider value={viewer.comparePosition} min={0} max={1} step={0.01} defaultValue={0.5} origin={0} onChange={(v) => useEditor.getState().setViewer({ comparePosition: v })} aria-label="Split position" data-testid="cl-compare-slider" />
          <span className="cl-num cl-dim">{Math.round(viewer.comparePosition * 100)}%</span>
        </div>
      )}

      {isMedia && (
        <div className="cl-input" data-testid="cl-input">
          <span className="cl-input__label" title="How the source's code values are decoded to scene-linear light">
            Input
          </span>
          <Select<InputTransform>
            value={clip.grade.inputTransform}
            options={INPUT_TRANSFORMS.map((t) => (t.value === 'auto' ? { ...t, label: `Auto · ${IT_LABEL[asset?.inputTransform && asset.inputTransform !== 'auto' ? asset.inputTransform : effective]}` } : t))}
            onChange={(v) => setClipInputTransform(clip.id, v)}
            aria-label="Input transform"
            data-testid="cl-input-transform"
            className="cl-input__select"
          />
          <button type="button" className="cl-chip" title={`Use ${IT_LABEL[effective]} for every clip of “${asset?.name ?? 'this source'}” (sets the source, resets clip overrides to Auto)`} data-testid="cl-input-apply-source" onClick={setInputTransformForSource}>
            All from source
          </button>
        </div>
      )}

      <nav className="cl-tabs" role="tablist" aria-label="Color tools">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={`cl-tabs__tab ${tab === t.id ? 'is-on' : ''}`} data-testid={`cl-tab-${t.id}`} onClick={() => setTab(t.id)}>
            {t.icon({ size: 14 })}
            <span>{t.label}</span>
            {tabActive(clip, t.id) && <span className="cl-tabs__dot" aria-label="in use" />}
          </button>
        ))}
      </nav>

      <div className={`cl-body ${bypassed ? 'cl-body--bypassed' : ''}`}>
        {bypassed && (
          <div className="cl-banner" data-testid="cl-bypassed">
            Grade bypassed.{' '}
            <button type="button" className="cl-link" onClick={toggleBypass}>
              Enable
            </button>
          </div>
        )}
        {tab === 'primaries' && <Primaries clip={clip} local={local} effective={effective} />}
        {tab === 'curves' && <CurveEditor clip={clip} />}
        {tab === 'hsl' && <QualifierSection clip={clip} />}
        {tab === 'lut' && <LutSection clip={clip} local={local} />}
        {tab === 'looks' && <LooksSection disabled={false} />}
      </div>
    </>
  );
}

function tabActive(clip: Clip, tab: Tab): boolean {
  const g = clip.grade;
  if (tab === 'curves') return !!(g.curves.master.length || g.curves.r.length || g.curves.g.length || g.curves.b.length);
  if (tab === 'hsl') return g.qualifier.enabled;
  if (tab === 'lut') return !!g.lut.id;
  return false;
}

interface SliderDef {
  key: 'exposure' | 'temperature' | 'tint' | 'contrast' | 'pivot' | 'saturation' | 'vibrance' | 'highlights' | 'shadows';
  label: string;
  min: number;
  max: number;
  hardMin?: number;
  hardMax?: number;
  step: number;
  def: number;
  precision: number;
  unit?: string;
  signed?: boolean;
  track?: string;
  hint: string;
}

const SLIDERS: SliderDef[] = [
  { key: 'exposure', label: 'Exposure', min: -4, max: 4, hardMin: -6, hardMax: 6, step: 0.01, def: 0, precision: 2, unit: 'st', signed: true, hint: 'Stops of scene-linear light' },
  { key: 'temperature', label: 'Temperature', min: -100, max: 100, step: 1, def: 0, precision: 0, signed: true, track: 'linear-gradient(to right, rgba(80,130,235,.75), rgba(90,90,100,.35) 50%, rgba(240,170,70,.75))', hint: 'Cool ↔ warm white balance (scene-linear)' },
  { key: 'tint', label: 'Tint', min: -100, max: 100, step: 1, def: 0, precision: 0, signed: true, track: 'linear-gradient(to right, rgba(90,210,110,.7), rgba(90,90,100,.35) 50%, rgba(220,90,210,.7))', hint: 'Green ↔ magenta white balance (scene-linear)' },
  { key: 'contrast', label: 'Contrast', min: 0, max: 2, hardMax: 4, step: 0.01, def: 1, precision: 2, hint: 'Contrast around the pivot (log grading space)' },
  { key: 'pivot', label: 'Pivot', min: 0, max: 1, step: 0.005, def: 0.435, precision: 3, hint: 'Contrast pivot; 0.435 = 18 % grey' },
  { key: 'saturation', label: 'Saturation', min: 0, max: 2, hardMax: 4, step: 0.01, def: 1, precision: 2, hint: '1 = unchanged, 0 = monochrome' },
  { key: 'vibrance', label: 'Vibrance', min: -1, max: 1, step: 0.01, def: 0, precision: 2, signed: true, hint: 'Saturates muted colours more than vivid ones' },
  { key: 'highlights', label: 'Highlights', min: -1, max: 1, step: 0.01, def: 0, precision: 2, signed: true, hint: 'Recover (−) or lift (+) the brightest tones' },
  { key: 'shadows', label: 'Shadows', min: -1, max: 1, step: 0.01, def: 0, precision: 2, signed: true, hint: 'Deepen (−) or open up (+) the darkest tones' },
];

function Primaries({ clip, local, effective }: { clip: Clip; local: number; effective: InputTransform }) {
  const isLog = LOG_ITS.has(effective);
  return (
    <div className="cl-primaries" data-testid="cl-primaries">
      <div className="cl-wheels">
        {WHEELS.map((w) => (
          <Wheel key={w} clip={clip} wheel={w} />
        ))}
      </div>
      <p className="cl-note" data-testid="cl-mode-note">
        {clip.kind === 'adjustment'
          ? 'Adjustment layer: the grade applies to everything beneath it. '
          : `${IT_LABEL[effective] ?? effective} is decoded to scene-linear light first${isLog ? ' (log source)' : ''}. `}
        Exposure, temperature and tint act on linear light; wheels, contrast and curves act in the log grading space.
      </p>
      <div className="cl-rows">
        {SLIDERS.map((d) => (
          <SliderRow
            key={d.key}
            label={d.label}
            value={paramAt(clip, `grade.${d.key}`, local)}
            min={d.min}
            max={d.max}
            hardMin={d.hardMin}
            hardMax={d.hardMax}
            step={d.step}
            defaultValue={d.def}
            precision={d.precision}
            unit={d.unit}
            signed={d.signed}
            trackBackground={d.track}
            hint={`${d.hint} · Double-click to reset`}
            clipId={clip.id}
            path={`grade.${d.key}`}
            testid={`cl-slider-${d.key}`}
            onChange={(v) => setGradeParam(clip.id, `grade.${d.key}`, Math.round(v * 10000) / 10000, `Change ${d.label.toLowerCase()}`)}
          />
        ))}
      </div>
    </div>
  );
}
