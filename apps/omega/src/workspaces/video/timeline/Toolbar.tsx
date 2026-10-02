// Timeline toolbar: sequence tabs, timecode field, tools, toggles, zoom,
// track-height presets and sequence settings.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { transport } from '../../../engine/playback/transport';
import { formatTimecode, parseTimecode } from '../../../engine/time';
import { useEditor, type Tool } from '../../../state/store';
import { activeSequence } from '../../../state/types';
import * as cmd from './commands';
import { HEIGHT_PRESETS } from './geometry';
import { TI } from './icons';
import { hint, tabMenu } from './menus';
import { TOOL_INFO } from './timelineActions';
import { tabsFor, useTLView, zoomAround, zoomToFit } from './view';

const TOOL_ICONS: Record<string, (p: { size?: number }) => ReactNode> = {
  select: TI.Select,
  trackForward: TI.TrackForward,
  ripple: TI.Ripple,
  roll: TI.Roll,
  rate: TI.Rate,
  slip: TI.Slip,
  slide: TI.Slide,
  razor: TI.Razor,
  pen: TI.Pen,
  hand: TI.Hand,
  zoom: TI.Zoom,
};

const ZMIN = Math.log(0.5);
const ZMAX = Math.log(4000);
const zoomToSlider = (z: number) => Math.round(((Math.log(z) - ZMIN) / (ZMAX - ZMIN)) * 1000);
const sliderToZoom = (v: number) => Math.exp(ZMIN + (v / 1000) * (ZMAX - ZMIN));

function withKey(label: string, actionId: string) {
  const k = hint(actionId);
  return k ? `${label} (${k})` : label;
}

// ---------------------------------------------------------------------------
// Sequence tabs
// ---------------------------------------------------------------------------

export function SequenceTabs() {
  const project = useEditor((s) => s.project!);
  const tabsState = useTLView((s) => s.tabs);
  const tabs = tabsFor(project, tabsState);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [listOpen, setListOpen] = useState(false);
  const startRename = (id: string) => {
    setRenaming(id);
    setText(project.sequences.find((s) => s.id === id)?.name ?? '');
  };
  const closed = project.sequences.filter((s) => !tabs.includes(s.id));
  return (
    <div className="tl-tabs" role="tablist" aria-label="Sequences">
      {tabs.map((id) => {
        const s = project.sequences.find((x) => x.id === id);
        if (!s) return null;
        const active = id === project.activeSequenceId;
        return (
          <div
            key={id}
            role="tab"
            aria-selected={active}
            className={`tl-tab ${active ? 'is-active' : ''}`}
            data-testid="tl-seq-tab"
            data-seq-id={id}
            title={`${s.name} · ${s.width}×${s.height} · ${s.fps} fps`}
            onMouseDown={(e) => {
              if (e.button === 1) {
                e.preventDefault();
                cmd.closeSequenceTab(id);
              }
            }}
            onClick={() => !active && cmd.switchSequence(id)}
            onDoubleClick={() => startRename(id)}
            onContextMenu={(e) => {
              e.preventDefault();
              useTLView.getState().openMenu({ x: e.clientX, y: e.clientY, items: tabMenu(id, () => startRename(id)), testId: 'tl-tab-menu' });
            }}
          >
            {renaming === id ? (
              <input
                className="tl-tab__input"
                autoFocus
                value={text}
                data-testid="tl-seq-tab-input"
                onChange={(e) => setText(e.target.value)}
                onFocus={(e) => e.currentTarget.select()}
                onBlur={() => {
                  cmd.renameSequence(id, text);
                  setRenaming(null);
                }}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                  if (e.key === 'Escape') setRenaming(null);
                }}
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <span className="tl-tab__name">{s.name}</span>
            )}
            {tabs.length > 1 && (
              <button
                className="tl-tab__close"
                aria-label={`Close ${s.name}`}
                data-testid="tl-seq-tab-close"
                onClick={(e) => {
                  e.stopPropagation();
                  cmd.closeSequenceTab(id);
                }}
              >
                <TI.Close size={11} />
              </button>
            )}
          </div>
        );
      })}
      <button className="tl-tabs__add" title="New sequence" aria-label="New sequence" data-testid="tl-seq-new" onClick={() => cmd.newSequence()}>
        <TI.Plus size={14} />
      </button>
      {closed.length > 0 && (
        <div className="tl-tabs__more">
          <button className="tl-tabs__add" title="Open a sequence" aria-label="Open a sequence" data-testid="tl-seq-list" onClick={() => setListOpen((v) => !v)}>
            <TI.Chevron size={14} />
          </button>
          {listOpen && (
            <div className="tl-pop tl-pop--list" onMouseLeave={() => setListOpen(false)}>
              {closed.map((s) => (
                <button
                  key={s.id}
                  className="tl-menu__item"
                  onClick={() => {
                    setListOpen(false);
                    cmd.switchSequence(s.id);
                  }}
                >
                  <span className="tl-menu__label">{s.name}</span>
                  <span className="tl-menu__hint">
                    {s.width}×{s.height}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Timecode field
// ---------------------------------------------------------------------------

export function TimecodeField() {
  const playhead = useEditor((s) => s.playhead);
  const seq = useEditor((s) => activeSequence(s.project!));
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const tc = formatTimecode(playhead, seq.fps, seq.dropFrame, seq.startTimecode);
  useEffect(() => {
    if (editing) input.current?.select();
  }, [editing]);
  const commit = () => {
    const t = parseTimecode(text, seq.fps, playhead, seq.startTimecode, seq.dropFrame);
    setEditing(false);
    if (t === null) return;
    transport.seek(Math.max(0, t));
  };
  if (editing) {
    return (
      <input
        ref={input}
        className="tl-tc tl-tc--edit"
        value={text}
        spellCheck={false}
        data-testid="tl-timecode-input"
        aria-label="Go to timecode"
        onChange={(e) => setText(e.target.value)}
        onBlur={() => setEditing(false)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') setEditing(false);
        }}
      />
    );
  }
  return (
    <button
      className="tl-tc"
      data-testid="tl-timecode"
      title="Click to type a timecode (+/− for relative)"
      onClick={() => {
        setText(tc);
        setEditing(true);
      }}
    >
      {tc}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Toolbar
// ---------------------------------------------------------------------------

function ToggleBtn({ on, onClick, title, testId, children }: { on: boolean; onClick: () => void; title: string; testId: string; children: ReactNode }) {
  return (
    <button className={`tl-tb-btn ${on ? 'is-on' : ''}`} aria-pressed={on} title={title} data-testid={testId} onClick={onClick}>
      {children}
    </button>
  );
}

export function Toolbar() {
  const tool = useEditor((s) => s.tool);
  const snapping = useEditor((s) => s.snapping);
  const magnetic = useEditor((s) => s.magnetic);
  const linked = useEditor((s) => s.linkedSelection);
  const zoom = useEditor((s) => s.zoom);
  const seq = useEditor((s) => activeSequence(s.project!));
  const preset = useTLView((s) => s.heightPreset);
  const st = useEditor.getState;
  const zoomBy = (f: number) => {
    const v = useTLView.getState();
    zoomAround(v.t0 + v.viewW / zoom / 2, zoom * f);
  };
  const fmt = seq.formats.find((f) => f.id === seq.activeFormatId);
  return (
    <div className="tl-toolbar">
      <TimecodeField />
      <div className="tl-sep" />
      <div className="tl-tools" role="toolbar" aria-label="Timeline tools">
        {TOOL_INFO.map((t) => {
          const Icon = TOOL_ICONS[t.tool];
          return (
            <button
              key={t.tool}
              className={`tl-tb-btn ${tool === t.tool ? 'is-on' : ''}`}
              aria-pressed={tool === t.tool}
              title={`${t.label} (${t.key})`}
              data-testid={`tl-tool-${t.tool}`}
              onClick={() => st().setTool(t.tool as Tool)}
            >
              <Icon size={16} />
            </button>
          );
        })}
      </div>
      <div className="tl-sep" />
      <ToggleBtn on={snapping} onClick={() => st().setSnapping(!snapping)} title={withKey(snapping ? 'Snapping on' : 'Snapping off', 'timeline.toggleSnapping')} testId="tl-snap">
        <TI.Magnet size={16} />
      </ToggleBtn>
      <ToggleBtn on={magnetic} onClick={() => st().setMagnetic(!magnetic)} title={withKey(magnetic ? 'Magnetic timeline on: deletes and moves close gaps' : 'Magnetic timeline off', 'timeline.toggleMagnetic')} testId="tl-magnetic">
        <TI.Magnetic size={16} />
      </ToggleBtn>
      <ToggleBtn on={linked} onClick={() => st().setLinkedSelection(!linked)} title={linked ? 'Linked selection on' : 'Linked selection off'} testId="tl-linked">
        <TI.Link size={16} />
      </ToggleBtn>
      <div className="tl-spacer" />
      <div className="tl-seg tl-seg--mini" role="radiogroup" aria-label="Track height">
        {(['S', 'M', 'L'] as const).map((p) => (
          <button
            key={p}
            className={`tl-seg__btn ${preset === p ? 'is-on' : ''}`}
            role="radio"
            aria-checked={preset === p}
            title={`Track height: ${p === 'S' ? 'small' : p === 'M' ? 'medium' : 'large'}`}
            data-testid={`tl-height-${p}`}
            onClick={() => {
              cmd.setAllTrackHeights(HEIGHT_PRESETS[p]);
              useTLView.getState().setHeightPreset(p);
            }}
          >
            {p}
          </button>
        ))}
      </div>
      <div className="tl-sep" />
      <button className="tl-tb-btn" title={withKey('Zoom out', 'timeline.zoomOut')} data-testid="tl-zoom-out" onClick={() => zoomBy(1 / 1.5)}>
        <TI.ZoomOut size={16} />
      </button>
      <input
        type="range"
        className="tl-zoom"
        min={0}
        max={1000}
        step={1}
        value={zoomToSlider(zoom)}
        aria-label="Zoom"
        data-testid="tl-zoom"
        onChange={(e) => {
          const v = useTLView.getState();
          const st2 = useEditor.getState();
          const span = v.viewW / st2.zoom;
          const anchor = st2.playhead >= v.t0 && st2.playhead <= v.t0 + span ? st2.playhead : v.t0 + span / 2;
          zoomAround(anchor, sliderToZoom(Number(e.target.value)));
        }}
      />
      <button className="tl-tb-btn" title={withKey('Zoom in', 'timeline.zoomIn')} data-testid="tl-zoom-in" onClick={() => zoomBy(1.5)}>
        <TI.ZoomIn size={16} />
      </button>
      <button className="tl-tb-btn" title={withKey('Zoom to fit', 'timeline.zoomFit')} data-testid="tl-zoom-fit" onClick={() => zoomToFit()}>
        <TI.Fit size={16} />
      </button>
      <div className="tl-sep" />
      <button className="tl-seqinfo" title="Sequence settings" data-testid="tl-seq-settings" onClick={() => st().openModal('timeline.sequenceSettings')}>
        <span className="tl-mono">
          {fmt ? `${fmt.width}×${fmt.height}` : `${seq.width}×${seq.height}`} · {seq.fps}
          {seq.dropFrame ? ' DF' : ''}
        </span>
        <TI.Settings size={15} />
      </button>
    </div>
  );
}
