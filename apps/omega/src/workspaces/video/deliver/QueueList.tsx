// Right column: the render queue. OWNED BY THE DELIVER PACKAGE.

import { useState } from 'react';
import { EmptyState } from '../../../ui/controls';
import { I } from '../../../ui/Icons';
import { formatEta, jobSizeText, useRenderQueue, type QueueJob } from '../../../engine/export';
import { Pill, Progress } from './controls';

const STATUS: Record<QueueJob['status'], { label: string; tone: 'neutral' | 'accent' | 'ok' | 'warn' | 'danger' }> = {
  queued: { label: 'Queued', tone: 'neutral' },
  rendering: { label: 'Rendering', tone: 'accent' },
  done: { label: 'Done', tone: 'ok' },
  failed: { label: 'Failed', tone: 'danger' },
  cancelled: { label: 'Cancelled', tone: 'warn' },
};

const PHASE: Record<string, string> = {
  preflight: 'Checking',
  analyzing: 'Measuring loudness',
  rendering: 'Rendering',
  audio: 'Encoding audio',
  finalizing: 'Finishing',
  sidecars: 'Writing sidecars',
  done: 'Done',
};

export function QueueList() {
  const jobs = useRenderQueue((s) => s.jobs);
  const running = useRenderQueue((s) => s.running);
  const queued = jobs.filter((j) => j.status === 'queued').length;
  const finished = jobs.filter((j) => j.status === 'done' || j.status === 'failed' || j.status === 'cancelled').length;
  const q = useRenderQueue.getState;

  return (
    <div className="dl-queue" data-testid="dl-queue">
      <div className="dl-queue__head">
        <div className="dl-queue__title">
          Render queue
          {jobs.length > 0 && <span className="dl-queue__count">{jobs.length}</span>}
        </div>
        <div className="dl-queue__actions">
          {finished > 0 && !running && (
            <button className="dl-link" onClick={() => q().clearFinished()} data-testid="dl-queue-clear">
              Clear finished
            </button>
          )}
          {running ? (
            <button className="btn btn--ghost btn--small" onClick={() => q().cancelCurrent()} data-testid="dl-queue-cancel">
              <I.Stop size={13} />
              Stop
            </button>
          ) : (
            <button className="btn btn--accent btn--small" disabled={!queued} onClick={() => void q().start()} data-testid="dl-queue-render-all">
              <I.Render size={13} />
              Render all
            </button>
          )}
        </div>
      </div>
      <div className="dl-queue__list">
        {jobs.length === 0 ? (
          <EmptyState icon={<I.Queue size={18} />} title="Nothing queued" sub="Pick a preset, then Add to queue to batch several exports, or Render now." testId="dl-queue-empty" />
        ) : (
          jobs.map((j, i) => <JobRow key={j.id} job={j} first={i === 0} last={i === jobs.length - 1} />)
        )}
      </div>
    </div>
  );
}

function JobRow({ job, first, last }: { job: QueueJob; first: boolean; last: boolean }) {
  const [open, setOpen] = useState(false);
  const q = useRenderQueue.getState;
  const st = STATUS[job.status];
  const rendering = job.status === 'rendering';
  const canReveal = job.status === 'done' && !!window.omega?.files?.showInFolder;
  const details = job.error || job.warnings.length > 0 || job.log.length > 0;
  return (
    <div className={`dl-job dl-job--${job.status}`} data-testid="dl-job" data-status={job.status} data-job-id={job.id}>
      <div className="dl-job__top">
        <div className="dl-job__name" title={job.outputPath}>
          {job.name}
        </div>
        <Pill tone={st.tone} testId="dl-job-status">
          {st.label}
        </Pill>
      </div>
      <div className="dl-job__meta">
        {job.presetName}
        {job.formatId ? ` · ${job.formatName}` : ''}
        {job.summary ? ` · ${job.summary}` : ''}
      </div>
      {(rendering || job.status === 'queued') && (
        <div className="dl-job__progress">
          <Progress value={rendering ? job.progress : 0} tone={rendering ? 'accent' : 'muted'} testId="dl-job-progress" />
          {rendering && (
            <div className="dl-job__stats dl-mono">
              <span>{Math.round(job.progress * 100)}%</span>
              <span>{job.phase ? PHASE[job.phase] : ''}</span>
              {job.fps ? <span>{job.fps.toFixed(job.fps < 10 ? 1 : 0)} fps</span> : null}
              {job.eta !== null && <span data-testid="dl-job-eta">{formatEta(job.eta)} left</span>}
            </div>
          )}
        </div>
      )}
      {job.status === 'done' && (
        <div className="dl-job__stats dl-mono">
          <span data-testid="dl-job-size">{jobSizeText(job)}</span>
          {job.startedAt && job.finishedAt && <span>{formatEta((job.finishedAt - job.startedAt) / 1000)}</span>}
          {job.fps ? <span>{job.fps.toFixed(1)} fps avg</span> : null}
          {job.warnings.length > 0 && (
            <span className="dl-job__warn">
              <I.Warning size={12} /> {job.warnings.length}
            </span>
          )}
        </div>
      )}
      {job.status === 'failed' && job.error && (
        <div className="dl-job__error" data-testid="dl-job-error">
          {job.error}
        </div>
      )}
      {open && details && (
        <div className="dl-job__log" data-testid="dl-job-log">
          {job.warnings.map((w, i) => (
            <div key={`w${i}`} className="dl-job__logline dl-job__logline--warn">
              {w}
            </div>
          ))}
          {job.log.map((l, i) => (
            <div key={`l${i}`} className="dl-job__logline">
              {l}
            </div>
          ))}
          <div className="dl-job__logline dl-muted">{job.outputPath}</div>
        </div>
      )}
      <div className="dl-job__actions">
        {rendering && (
          <button className="dl-act" onClick={() => q().cancelCurrent()} data-testid="dl-job-cancel" title="Cancel">
            <I.Close size={13} />
            Cancel
          </button>
        )}
        {canReveal && (
          <button className="dl-act" onClick={() => window.omega.files.showInFolder(job.files[0] ?? job.outputPath)} data-testid="dl-job-reveal" title="Show in folder">
            <I.Folder size={13} />
            Reveal
          </button>
        )}
        {(job.status === 'failed' || job.status === 'cancelled' || job.status === 'done') && (
          <button className="dl-act" onClick={() => q().retry(job.id)} data-testid="dl-job-retry" title={job.status === 'done' ? 'Render again' : 'Retry'}>
            <I.Refresh size={13} />
            {job.status === 'done' ? 'Again' : 'Retry'}
          </button>
        )}
        {details && (
          <button className="dl-act" onClick={() => setOpen(!open)} aria-expanded={open} data-testid="dl-job-details">
            <I.Info size={13} />
            {open ? 'Hide' : 'Details'}
          </button>
        )}
        <span className="dl-job__spacer" />
        {!rendering && (
          <>
            <button className="dl-icon-btn" disabled={first} onClick={() => q().move(job.id, -1)} title="Move up" aria-label="Move up" data-testid="dl-job-up">
              <I.ArrowUp size={13} />
            </button>
            <button className="dl-icon-btn" disabled={last} onClick={() => q().move(job.id, 1)} title="Move down" aria-label="Move down" data-testid="dl-job-down">
              <I.ArrowDown size={13} />
            </button>
          </>
        )}
        <button className="dl-icon-btn" onClick={() => q().duplicate(job.id)} title="Duplicate" aria-label="Duplicate" data-testid="dl-job-duplicate">
          <I.Duplicate size={13} />
        </button>
        <button className="dl-icon-btn" onClick={() => q().remove(job.id)} title={rendering ? 'Cancel and remove' : 'Remove'} aria-label="Remove" data-testid="dl-job-remove">
          <I.Trash size={13} />
        </button>
      </div>
    </div>
  );
}
