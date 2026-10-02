// Quick export dialog ('deliver.export', Mod+M): pick a preset, name,
// destination and range, then render with progress right here. It goes
// through the same render queue and engine as the Deliver panel.
// OWNED BY THE DELIVER PACKAGE.

import { useEffect, useMemo, useState } from 'react';
import { Dialog } from '../../../ui/Modal';
import { Segmented } from '../../../ui/controls';
import { I } from '../../../ui/Icons';
import { useEditor } from '../../../state/store';
import { activeSequence } from '../../../state/types';
import { formatTimecode } from '../../../engine/time';
import {
  PRESET_GROUPS,
  buildJobs,
  draftFromPreset,
  expandTemplate,
  findPreset,
  formatBytesShort,
  formatEta,
  sanitizeFileName,
  useRenderQueue,
  type ExportDraft,
} from '../../../engine/export';
import { Progress, Select, type Option } from './controls';
import { allPresets, defaultFormats, useDeliverDraft } from './draft';
import { useDeliverBinding } from './DeliverPanel';
import { useDraftPlan } from './usePlan';
import './deliver.css';

export const QUICK_EXPORT_MODAL = 'deliver.export';

export function QuickExport({ onClose }: { onClose: () => void }) {
  useDeliverBinding();
  const project = useEditor((s) => s.project)!;
  const seq = activeSequence(project);
  const custom = useDeliverDraft((s) => s.customPresets);
  const panelDraft = useDeliverDraft((s) => s.draft);
  const [presetId, setPresetId] = useState(panelDraft.settings.kind === 'handoff' ? 'yt-1080' : panelDraft.presetId);
  const preset = findPreset(presetId, custom) ?? findPreset('yt-1080')!;
  const [destination, setDestination] = useState(panelDraft.destination);
  const [rangeMode, setRangeMode] = useState<'entire' | 'inout'>(seq.inPoint !== null || seq.outPoint !== null ? 'inout' : 'entire');
  const autoName = sanitizeFileName(expandTemplate(panelDraft.nameTemplate, { project: project.name, sequence: seq.name, preset: preset.name, format: '', date: new Date() }));
  const [name, setName] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const job = useRenderQueue((s) => (jobId ? s.jobs.find((j) => j.id === jobId) : undefined));
  const ahead = useRenderQueue((s) => (jobId ? s.jobs.findIndex((j) => j.id === jobId) - s.jobs.filter((j) => j.status !== 'queued' && j.status !== 'rendering').length : 0));

  useEffect(() => {
    if (!destination && panelDraft.destination) setDestination(panelDraft.destination);
  }, [panelDraft.destination]); // eslint-disable-line react-hooks/exhaustive-deps

  const draft: ExportDraft = useMemo(() => {
    const base = draftFromPreset(preset, {
      nameTemplate: (name ?? autoName).replace(/[{}]/g, ''),
      destination,
      range: preset.settings.kind === 'still' ? { mode: 'frame', time: useEditor.getState().playhead } : { mode: rangeMode },
      formats: defaultFormats(preset, seq).slice(0, 1),
    });
    // the panel's edits apply when its preset is the one picked here
    if (preset.id === panelDraft.presetId) base.settings = panelDraft.settings;
    return base;
  }, [preset, name, autoName, destination, rangeMode, seq, panelDraft.presetId, panelDraft.settings]);
  const plan = useDraftPlan(draft);
  const errors = plan.plans.flatMap((p) => p.issues.filter((i) => i.level === 'error'));
  const warnings = plan.plans.flatMap((p) => p.issues.filter((i) => i.level === 'warning'));
  const blocked = !!plan.error || !plan.jobs.length || errors.length > 0;

  const options: Option<string>[] = allPresets(custom)
    .filter((p) => p.settings.kind !== 'handoff')
    .sort((a, b) => PRESET_GROUPS.indexOf(a.group) - PRESET_GROUPS.indexOf(b.group))
    .map((p) => ({ value: p.id, label: p.name, group: p.group }));

  const render = async () => {
    if (blocked) return;
    const jobs = buildJobs(draft, project, seq, { playhead: useEditor.getState().playhead });
    const q = useRenderQueue.getState();
    const ids = await q.add(jobs.slice(0, 1));
    setJobId(ids[0]);
    useDeliverDraft.getState().update({ destination });
    void q.start(ids);
  };

  const pick = async () => {
    const dir = await window.omega.dialogs.pickFolder(destination || undefined);
    if (dir) setDestination(dir);
  };

  const status = job?.status;
  const footer = (() => {
    if (!job)
      return (
        <>
          <button className="btn btn--ghost" onClick={onClose} data-testid="dl-quick-close">
            Cancel
          </button>
          <button className="btn btn--accent" onClick={render} disabled={blocked} data-testid="dl-quick-render">
            <I.Render size={15} />
            Render
          </button>
        </>
      );
    if (status === 'rendering' || status === 'queued')
      return (
        <>
          <button className="btn btn--ghost" onClick={onClose} data-testid="dl-quick-close">
            Hide
          </button>
          <button className="btn btn--ghost" onClick={() => (status === 'rendering' ? useRenderQueue.getState().cancelCurrent() : useRenderQueue.getState().remove(job.id))} data-testid="dl-quick-cancel">
            <I.Stop size={14} />
            Cancel
          </button>
        </>
      );
    return (
      <>
        {status === 'done' && (
          <button className="btn btn--ghost" onClick={() => window.omega.files.showInFolder(job.files[0] ?? job.outputPath)} data-testid="dl-quick-reveal">
            <I.Folder size={14} />
            Show in folder
          </button>
        )}
        {(status === 'failed' || status === 'cancelled') && (
          <button
            className="btn btn--ghost"
            onClick={() => {
              useRenderQueue.getState().retry(job.id);
              void useRenderQueue.getState().start([job.id]);
            }}
            data-testid="dl-quick-retry"
          >
            <I.Refresh size={14} />
            Try again
          </button>
        )}
        <button className="btn btn--accent" onClick={onClose} data-testid="dl-quick-close">
          Done
        </button>
      </>
    );
  })();

  return (
    <Dialog title="Export" subtitle={`${seq.name} · ${seq.width}×${seq.height}`} icon={<I.Export size={18} />} onClose={onClose} width={520} footer={footer} testId="dl-quick" className="dl-quick">
      {!job ? (
        <div className="dl-quick__form">
          <label className="dl-qfield">
            <span>Preset</span>
            <Select value={preset.id} options={options} onChange={setPresetId} testId="dl-quick-preset" ariaLabel="Preset" />
            <small className="dl-muted">{preset.hint}</small>
          </label>
          <label className="dl-qfield">
            <span>File name</span>
            <input className="dl-input" value={name ?? autoName} onChange={(e) => setName(e.target.value)} spellCheck={false} data-testid="dl-quick-name" />
          </label>
          <div className="dl-qfield">
            <span>Destination</span>
            <div className="dl-dest">
              <input className="dl-input dl-input--path" value={destination} placeholder="Choose a folder" onChange={(e) => setDestination(e.target.value)} spellCheck={false} data-testid="dl-quick-dest" aria-label="Destination folder" />
              <button className="btn btn--ghost btn--small" onClick={pick} data-testid="dl-quick-dest-pick">
                <I.Folder size={14} />
                Choose…
              </button>
            </div>
          </div>
          {preset.settings.kind !== 'still' && (
            <div className="dl-qfield">
              <span>Range</span>
              <Segmented
                size="sm"
                value={rangeMode}
                onChange={setRangeMode}
                testId="dl-quick-range"
                options={[
                  { value: 'entire', label: 'Entire sequence', testId: 'dl-quick-range-entire' },
                  { value: 'inout', label: 'In – Out', testId: 'dl-quick-range-inout' },
                ]}
              />
            </div>
          )}
          <div className="dl-quick__summary" data-testid="dl-quick-summary">
            {plan.jobs[0] && (
              <span className="dl-mono">
                {formatTimecode(plan.jobs[0].range.end - plan.jobs[0].range.start, seq.fps, seq.dropFrame)}
                {plan.plans[0] ? ` · ${plan.plans[0].size.width ? `${plan.plans[0].size.width}×${plan.plans[0].size.height} · ` : ''}≈ ${formatBytesShort(plan.plans[0].estimatedBytes)}` : ''}
              </span>
            )}
            {plan.error && <div className="dl-issue dl-issue--error">{plan.error}</div>}
            {errors.slice(0, 3).map((e) => (
              <div key={e.message} className="dl-issue dl-issue--error">
                <I.Warning size={13} />
                <span>{e.message}</span>
              </div>
            ))}
            {!errors.length &&
              warnings.slice(0, 2).map((w) => (
                <div key={w.message} className="dl-issue dl-issue--warning">
                  <I.Warning size={13} />
                  <span>{w.message}</span>
                </div>
              ))}
          </div>
        </div>
      ) : (
        <div className="dl-quick__run" data-testid="dl-quick-progress" data-status={status}>
          <div className="dl-quick__file">
            {status === 'done' ? <I.CheckCircle size={18} /> : status === 'failed' ? <I.Warning size={18} /> : <I.Render size={18} />}
            <div>
              <div className="dl-quick__name">{job.name}</div>
              <div className="dl-muted">{job.outputPath}</div>
            </div>
          </div>
          <Progress value={status === 'done' ? 1 : job.progress} tone={status === 'failed' ? 'danger' : status === 'done' ? 'ok' : 'accent'} />
          <div className="dl-job__stats dl-mono">
            {status === 'queued' && <span>Waiting for {Math.max(1, ahead)} job{ahead > 1 ? 's' : ''} ahead</span>}
            {status === 'rendering' && (
              <>
                <span>{Math.round(job.progress * 100)}%</span>
                {job.fps ? <span>{job.fps.toFixed(job.fps < 10 ? 1 : 0)} fps</span> : null}
                {job.eta !== null && <span>{formatEta(job.eta)} left</span>}
              </>
            )}
            {status === 'done' && (
              <span data-testid="dl-quick-done">
                {formatBytesShort(job.outputBytes ?? 0)}
                {job.summary ? ` · ${job.summary}` : ''}
              </span>
            )}
            {status === 'cancelled' && <span>Cancelled</span>}
          </div>
          {status === 'failed' && (
            <div className="dl-job__error" data-testid="dl-quick-error">
              {job.error}
            </div>
          )}
          {status === 'done' && job.warnings.length > 0 && (
            <ul className="dl-issues">
              {job.warnings.map((w) => (
                <li key={w} className="dl-issue dl-issue--warning">
                  <I.Warning size={13} />
                  <span>{w}</span>
                </li>
              ))}
            </ul>
          )}
          {(status === 'rendering' || status === 'queued') && <p className="dl-muted dl-quick__hint">Rendering continues in the Deliver queue if you close this window.</p>}
        </div>
      )}
    </Dialog>
  );
}
