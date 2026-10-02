// Workspace layouts: three resizable columns over a resizable timeline, per
// the architecture doc. Sizes persist per workspace; double-click a splitter
// to reset it. Program and Timeline keep the same tree position in every
// workspace, so switching workspaces never remounts them.
// OWNED BY THE SHELL PACKAGE.

import { useRef, type ReactNode } from 'react';
import { useEditor, type Workspace } from '../../../state/store';
import { activeSequence } from '../../../state/types';
import { I } from '../../../ui/Icons';
import { Splitter } from '../../../ui/Splitter';
import { EmptyState } from '../../../ui/controls';
import { HistoryPanel } from './HistoryPanel';
import {
  AudioClipSection,
  CaptionsPanel,
  ColorPanel,
  DeliverPanel,
  EffectsBrowser,
  Inspector,
  LoudnessPanel,
  MediaPanel,
  Mixer,
  ProgramMonitor,
  Scopes,
  SourceMonitor,
  Timeline,
  TitlesBrowser,
} from './packages';
import { Panel, type PanelTab } from './Panel';
import { MIN, useShell, type PanelId, type Sizes } from './state';

const LABEL: Record<PanelId, string> = {
  media: 'Media',
  effectsBrowser: 'Effects',
  titles: 'Titles',
  history: 'History',
  source: 'Source',
  program: 'Program',
  inspector: 'Inspector',
  timeline: 'Timeline',
  scopes: 'Scopes',
  color: 'Color',
  mixer: 'Mixer',
  loudness: 'Loudness',
  clipAudio: 'Clip audio',
  captions: 'Captions',
  deliver: 'Deliver',
};

/** The timeline draws its own sequence tabs; it never gets a shell header.
 *  Other single panels hide the shell header when they render their own
 *  (see [data-autohead] in shell.css). */
const SELF_HEADED = new Set<PanelId>(['timeline']);

type Column = { tabs: PanelId[] } | { stack: [PanelId, PanelId] };

interface WsDef {
  left: Column;
  right?: Column;
  /** Source monitor beside Program (Edit). */
  source?: boolean;
}

const EDIT_LEFT: PanelId[] = ['media', 'effectsBrowser', ...(TitlesBrowser ? (['titles'] as PanelId[]) : []), 'history'];

export const LAYOUTS: Record<Workspace, WsDef> = {
  edit: { left: { tabs: EDIT_LEFT }, right: { tabs: ['inspector'] }, source: true },
  color: { left: { tabs: ['scopes'] }, right: { tabs: ['color'] } },
  audio: { left: { tabs: ['mixer'] }, right: { stack: ['loudness', 'clipAudio'] } },
  effects: { left: { tabs: ['effectsBrowser'] }, right: { tabs: ['inspector'] } },
  captions: { left: { tabs: ['captions'] }, right: { tabs: ['inspector'] } },
  deliver: { left: { tabs: ['deliver'] } },
};

function ClipAudio() {
  const clipId = useEditor((s) => {
    if (!s.project) return null;
    const seq = activeSequence(s.project);
    for (const t of seq.tracks) for (const c of t.clips) if (s.selection.clipIds.includes(c.id) && t.kind === 'audio') return c.id;
    // fall back to a selected video clip that carries audio
    for (const t of seq.tracks) for (const c of t.clips) if (s.selection.clipIds.includes(c.id) && c.kind === 'media') return c.id;
    return null;
  });
  if (!clipId)
    return (
      <EmptyState
        icon={<I.Waveform size={18} />}
        title="No clip selected"
        sub="Select an audio clip in the timeline to adjust its gain, pan, EQ and dynamics."
        testId="sh-clip-audio-empty"
      />
    );
  return <AudioClipSection clipId={clipId} />;
}

function content(id: PanelId): ReactNode {
  switch (id) {
    case 'media':
      return <MediaPanel />;
    case 'effectsBrowser':
      return <EffectsBrowser />;
    case 'titles':
      return TitlesBrowser ? <TitlesBrowser /> : null;
    case 'history':
      return <HistoryPanel />;
    case 'source':
      return <SourceMonitor />;
    case 'program':
      return <ProgramMonitor />;
    case 'inspector':
      return <Inspector />;
    case 'timeline':
      return <Timeline />;
    case 'scopes':
      return <Scopes />;
    case 'color':
      return <ColorPanel />;
    case 'mixer':
      return <Mixer />;
    case 'loudness':
      return <LoudnessPanel />;
    case 'clipAudio':
      return <ClipAudio />;
    case 'captions':
      return <CaptionsPanel />;
    case 'deliver':
      return <DeliverPanel />;
  }
}

function useSubtitle(id: PanelId): string | undefined {
  return useEditor((s) => {
    if (!s.project) return undefined;
    if (id === 'program' || id === 'timeline') return activeSequence(s.project).name;
    if (id === 'source') return s.source.assetId ? s.project.assets.find((a) => a.id === s.source.assetId)?.name : undefined;
    return undefined;
  });
}

function SinglePanel({ id }: { id: PanelId }) {
  const subtitle = useSubtitle(id);
  return (
    <Panel id={id} title={LABEL[id]} subtitle={subtitle} chromeless={SELF_HEADED.has(id) ? true : 'auto'}>
      {content(id)}
    </Panel>
  );
}

function TabbedPanel({ slot, tabs }: { slot: string; tabs: PanelId[] }) {
  const stored = useShell((s) => s.tabs[slot]);
  const setTab = useShell((s) => s.setTab);
  const active = stored && tabs.includes(stored) ? stored : tabs[0];
  const subtitle = useSubtitle(active);
  if (tabs.length === 1) return <SinglePanel id={tabs[0]} />;
  const list: PanelTab[] = tabs.map((t) => ({ id: t, label: LABEL[t] }));
  return (
    <Panel id={active} tabs={list} activeTab={active} onTab={(t) => setTab(slot, t)} subtitle={subtitle}>
      {content(active)}
    </Panel>
  );
}

/** Drag helper: remembers the measured size at drag start. */
function useDrag(apply: (start: number, delta: number) => void, measure: () => number) {
  const start = useRef(0);
  return {
    onDragStart: () => {
      start.current = measure();
    },
    onDrag: (delta: number) => apply(start.current, delta),
  };
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

export function WorkspaceLayout() {
  const ws = useEditor((s) => s.workspace);
  const sizes = useShell((s) => s.sizes[ws]);
  const hidden = useShell((s) => s.hidden);
  const maximized = useShell((s) => s.maximized);
  const setSize = useShell((s) => s.setSize);
  const resetSize = useShell((s) => s.resetSize);
  const def = LAYOUTS[ws];

  const bodyRef = useRef<HTMLDivElement>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const centerRef = useRef<HTMLDivElement>(null);
  const sourceRef = useRef<HTMLDivElement>(null);
  const stackRef = useRef<HTMLDivElement>(null);
  const stackTopRef = useRef<HTMLDivElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);

  const showLeft = !hidden[`${ws}.left`];
  const showRight = !!def.right && !hidden[`${ws}.right`];
  const showTimeline = !hidden[`${ws}.timeline`];
  const gutter = 4;

  const set = (patch: Partial<Sizes>) => setSize(ws, patch);
  const w = (r: React.RefObject<HTMLDivElement | null>) => r.current?.getBoundingClientRect().width ?? 0;
  const h = (r: React.RefObject<HTMLDivElement | null>) => r.current?.getBoundingClientRect().height ?? 0;

  const leftDrag = useDrag(
    (start, d) => {
      const max = w(topRef) - (showRight ? w(rightRef) + gutter : 0) - MIN.center - gutter;
      set({ left: Math.round(clamp(start + d, MIN.side, Math.max(MIN.side, max))) });
    },
    () => w(leftRef),
  );
  const rightDrag = useDrag(
    (start, d) => {
      const max = w(topRef) - (showLeft ? w(leftRef) + gutter : 0) - MIN.center - gutter;
      set({ right: Math.round(clamp(start - d, MIN.side, Math.max(MIN.side, max))) });
    },
    () => w(rightRef),
  );
  const timelineDrag = useDrag(
    (start, d) => {
      const max = h(bodyRef) - MIN.top - gutter;
      set({ timeline: Math.round(clamp(start - d, MIN.timeline, Math.max(MIN.timeline, max))) });
    },
    () => h(timelineRef),
  );
  const sourceDrag = useDrag(
    (start, d) => {
      const total = w(centerRef) - gutter;
      if (total > 0) set({ split: clamp((start + d) / total, 0.2, 0.8) });
    },
    () => w(sourceRef),
  );
  const stackDrag = useDrag(
    (start, d) => {
      const total = h(stackRef) - gutter;
      if (total > 0) set({ split: clamp((start + d) / total, 0.2, 0.8) });
    },
    () => h(stackTopRef),
  );

  const column = (col: Column, slot: string) =>
    'tabs' in col ? (
      <TabbedPanel slot={slot} tabs={col.tabs} />
    ) : (
      <div className="sh-stack" ref={stackRef}>
        <div className="sh-stack__part" ref={stackTopRef} style={{ flex: `${sizes.split} 1 0` }}>
          <SinglePanel id={col.stack[0]} />
        </div>
        <Splitter dir="h" {...stackDrag} onReset={() => resetSize(ws, 'split')} testId="sh-split-stack" />
        <div className="sh-stack__part" style={{ flex: `${1 - sizes.split} 1 0` }}>
          <SinglePanel id={col.stack[1]} />
        </div>
      </div>
    );

  return (
    <div className={`sh-body ${maximized ? 'has-max' : ''}`} ref={bodyRef} data-workspace={ws} data-maximized={maximized ?? undefined} data-testid="sh-body">
      <div className="sh-top" ref={topRef}>
        {showLeft && (
          <div className="sh-col sh-col--left" ref={leftRef} style={{ flexBasis: sizes.left }} key={`left-${ws}`} data-testid="sh-col-left">
            {column(def.left, `${ws}.left`)}
          </div>
        )}
        {showLeft && <Splitter dir="v" {...leftDrag} onReset={() => resetSize(ws, 'left')} testId="sh-split-left" label="Resize left panel" />}
        <div className="sh-center" ref={centerRef}>
          {def.source && (
            <div className="sh-center__source" ref={sourceRef} style={{ flex: `${sizes.split} 1 0` }}>
              <SinglePanel id="source" />
            </div>
          )}
          {def.source && <Splitter dir="v" {...sourceDrag} onReset={() => resetSize(ws, 'split')} testId="sh-split-source" label="Resize source and program" />}
          <div className="sh-center__program" style={{ flex: def.source ? `${1 - sizes.split} 1 0` : '1 1 0' }}>
            <SinglePanel id="program" />
          </div>
        </div>
        {showRight && <Splitter dir="v" {...rightDrag} onReset={() => resetSize(ws, 'right')} testId="sh-split-right" label="Resize right panel" />}
        {showRight && def.right && (
          <div className="sh-col sh-col--right" ref={rightRef} style={{ flexBasis: sizes.right }} key={`right-${ws}`} data-testid="sh-col-right">
            {column(def.right, `${ws}.right`)}
          </div>
        )}
      </div>
      {showTimeline && <Splitter dir="h" {...timelineDrag} onReset={() => resetSize(ws, 'timeline')} testId="sh-split-timeline" label="Resize timeline" />}
      {showTimeline && (
        <div className="sh-bottom" ref={timelineRef} style={{ flexBasis: sizes.timeline }} data-testid="sh-timeline-region">
          <SinglePanel id="timeline" />
        </div>
      )}
    </div>
  );
}
