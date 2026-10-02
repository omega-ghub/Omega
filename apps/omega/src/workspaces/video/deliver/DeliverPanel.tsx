// The Deliver workspace's main panel: presets | settings | render queue.
// Lays out in three columns when there is room, two (queue under the
// settings) in a medium pane, and switchable views in a narrow one.
// OWNED BY THE DELIVER PACKAGE.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Segmented } from '../../../ui/controls';
import { I } from '../../../ui/Icons';
import { useEditor } from '../../../state/store';
import { findPreset, useRenderQueue } from '../../../engine/export';
import { useDeliverDraft } from './draft';
import { PresetList } from './PresetList';
import { QueueList } from './QueueList';
import { SettingsForm } from './SettingsForm';
import { Summary } from './Summary';
import { useDraftPlan } from './usePlan';
import './deliver.css';

type Layout = 'wide' | 'medium' | 'narrow';
type View = 'presets' | 'settings' | 'queue';

/** Binds the queue and the draft to the open project. */
export function useDeliverBinding() {
  const project = useEditor((s) => s.project);
  const handle = useEditor((s) => s.handle);
  useEffect(() => {
    useRenderQueue.getState().attach(project?.id ?? null);
    useDeliverDraft.getState().attach(project, handle);
  }, [project?.id, handle]); // eslint-disable-line react-hooks/exhaustive-deps
}

function useLayout(ref: React.RefObject<HTMLDivElement | null>): Layout {
  const [layout, setLayout] = useState<Layout>('wide');
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = (w: number) => setLayout(w >= 1040 ? 'wide' : w >= 540 ? 'medium' : 'narrow');
    fit(el.getBoundingClientRect().width);
    const ro = new ResizeObserver((entries) => fit(entries[0].contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return layout;
}

export function DeliverPanel(_props: Record<string, unknown> = {}) {
  useDeliverBinding();
  const ref = useRef<HTMLDivElement>(null);
  const layout = useLayout(ref);
  const [view, setView] = useState<View>('settings');
  const draft = useDeliverDraft((s) => s.draft);
  const modified = useDeliverDraft((s) => s.modified);
  const plan = useDraftPlan(draft);
  const running = useRenderQueue((s) => s.running);
  const jobs = useRenderQueue((s) => s.jobs.length);
  const project = useEditor((s) => s.project);
  if (!project) return null;

  const settings = (
    <div className="dl-center">
      <SettingsHeader modified={modified} />
      <div className="dl-center__scroll">
        <SettingsForm plan={plan} />
      </div>
      <Summary plan={plan} />
    </div>
  );

  return (
    <div ref={ref} className={`dl dl--${layout}`} data-testid="dl-panel">
      {layout === 'narrow' && (
        <div className="dl-tabs">
          <Segmented
            block
            size="sm"
            value={view}
            onChange={setView}
            options={[
              { value: 'presets', label: 'Presets', testId: 'dl-view-presets' },
              { value: 'settings', label: 'Settings', testId: 'dl-view-settings' },
              { value: 'queue', label: `Queue${jobs ? ` · ${jobs}` : ''}${running ? ' ●' : ''}`, testId: 'dl-view-queue' },
            ]}
          />
        </div>
      )}
      {(layout !== 'narrow' || view === 'presets') && (
        <aside className="dl-col dl-col--presets">
          <PresetList />
        </aside>
      )}
      {(layout !== 'narrow' || view === 'settings') && <main className="dl-col dl-col--settings">{settings}</main>}
      {(layout !== 'narrow' || view === 'queue') && (
        <aside className="dl-col dl-col--queue">
          <QueueList />
        </aside>
      )}
    </div>
  );
}

function SettingsHeader({ modified }: { modified: boolean }) {
  const draft = useDeliverDraft((s) => s.draft);
  const custom = useDeliverDraft((s) => s.customPresets);
  const reset = useDeliverDraft((s) => s.resetToPreset);
  const saveCustom = useDeliverDraft((s) => s.saveCustom);
  const [naming, setNaming] = useState<string | null>(null);
  const preset = findPreset(draft.presetId, custom);
  const save = () => {
    if (naming === null) return;
    const p = saveCustom(naming);
    setNaming(null);
    useEditor.getState().showToast(`Saved preset "${p.name}"`, 'success');
  };
  return (
    <div className="dl-head">
      <div className="dl-head__titles">
        <div className="dl-head__title" data-testid="dl-preset-title">
          {draft.presetName}
          {modified && <span className="dl-preset__mod">edited</span>}
        </div>
        <div className="dl-head__sub">{preset?.hint ?? ''}</div>
      </div>
      <div className="dl-head__actions">
        {naming === null ? (
          <>
            {modified && (
              <button className="dl-link" onClick={reset} data-testid="dl-preset-reset">
                Reset
              </button>
            )}
            <button className="btn btn--ghost btn--small" onClick={() => setNaming(`${draft.presetName} (custom)`)} data-testid="dl-preset-save">
              <I.Star size={13} />
              Save preset
            </button>
          </>
        ) : (
          <div className="dl-inline">
            <input
              className="dl-input dl-input--sm"
              autoFocus
              value={naming}
              onChange={(e) => setNaming(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') save();
                if (e.key === 'Escape') {
                  e.stopPropagation();
                  setNaming(null);
                }
              }}
              aria-label="Preset name"
              data-testid="dl-preset-name"
            />
            <button className="btn btn--accent btn--small" onClick={save} data-testid="dl-preset-save-confirm">
              Save
            </button>
            <button className="dl-link" onClick={() => setNaming(null)}>
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
