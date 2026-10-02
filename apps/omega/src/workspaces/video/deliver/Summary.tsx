// Summary card: what will be written (per format), estimated size and
// duration, preflight findings, and the Add to queue / Render now buttons.
// OWNED BY THE DELIVER PACKAGE.

import { useState } from 'react';
import { I } from '../../../ui/Icons';
import { useEditor } from '../../../state/store';
import { activeSequence } from '../../../state/types';
import { formatTimecode } from '../../../engine/time';
import { VIDEO_CODEC_LABEL, AUDIO_CODEC_LABEL, formatBytesShort, fpsLabel, useRenderQueue, type PreflightIssue } from '../../../engine/export';
import { useDeliverDraft } from './draft';
import type { DraftPlan } from './usePlan';

function dedupe(issues: PreflightIssue[]): PreflightIssue[] {
  const seen = new Set<string>();
  return issues.filter((i) => (seen.has(i.message) ? false : (seen.add(i.message), true)));
}

export function Summary({ plan }: { plan: DraftPlan }) {
  const project = useEditor((s) => s.project);
  const seq = project ? activeSequence(project) : null;
  const kind = useDeliverDraft((s) => s.draft.settings.kind);
  const [busy, setBusy] = useState(false);
  const ready = plan.plans.length === plan.jobs.length && !plan.loading;
  const issues = dedupe(plan.plans.flatMap((p) => p.issues));
  const errors = issues.filter((i) => i.level === 'error');
  const total = plan.plans.reduce((n, p) => n + p.estimatedBytes, 0);
  const duration = plan.jobs[0] ? plan.jobs[0].range.end - plan.jobs[0].range.start : 0;
  const blocked = !!plan.error || !plan.jobs.length || errors.length > 0;

  const enqueue = async (render: boolean) => {
    if (blocked || busy) return;
    setBusy(true);
    try {
      const q = useRenderQueue.getState();
      const ids = await q.add(plan.jobs);
      useEditor.getState().showToast(render ? `Rendering ${ids.length > 1 ? `${ids.length} files` : plan.jobs[0].name}` : `Added ${ids.length > 1 ? `${ids.length} jobs` : `"${plan.jobs[0].name}"`} to the render queue`, 'info');
      if (render) void q.start(ids);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="dl-summary" data-testid="dl-summary">
      <div className="dl-summary__facts">
        {kind !== 'handoff' && kind !== 'still' && seq && (
          <div className="dl-fact">
            <span className="dl-fact__label">Duration</span>
            <span className="dl-fact__value dl-mono">{formatTimecode(duration, seq.fps, seq.dropFrame)}</span>
          </div>
        )}
        <div className="dl-fact">
          <span className="dl-fact__label">Estimated size</span>
          <span className="dl-fact__value dl-mono" data-testid="dl-size-estimate">
            {ready && plan.plans.length ? `${kind === 'video' || kind === 'audio' ? '≈ ' : ''}${formatBytesShort(total)}` : '…'}
          </span>
        </div>
        {plan.plans[0]?.freeBytes != null && (
          <div className="dl-fact">
            <span className="dl-fact__label">Free space</span>
            <span className="dl-fact__value dl-mono">{formatBytesShort(plan.plans[0].freeBytes)}</span>
          </div>
        )}
      </div>

      {ready && plan.plans.length > 0 && kind !== 'handoff' && (
        <div className="dl-outputs">
          {plan.plans.map((p, i) => {
            const job = plan.jobs[i];
            const parts =
              kind === 'audio'
                ? [p.audioCodec ? AUDIO_CODEC_LABEL[p.audioCodec] : 'No encoder']
                : [
                    `${p.size.width}×${p.size.height}`,
                    kind === 'still' ? '' : `${fpsLabel(p.fps)} fps`,
                    kind === 'video' ? (p.videoCodec ? VIDEO_CODEC_LABEL[p.videoCodec].replace(/ \(.*\)/, '') : 'No encoder') : 'PNG',
                    kind === 'video' && p.videoKbps ? `${(p.videoKbps / 1000).toFixed(1)} Mbps` : '',
                    kind === 'video' && p.audio && p.audioCodec ? AUDIO_CODEC_LABEL[p.audioCodec] : '',
                    kind === 'imageSequence' ? `${p.frames} frames` : '',
                  ];
            return (
              <div className="dl-output" key={job?.outputPath ?? i} data-testid="dl-output-line">
                <span className="dl-output__fmt">{job?.formatName ?? 'Main'}</span>
                <span className="dl-output__spec">{parts.filter(Boolean).join(' · ')}</span>
                <span className="dl-output__size dl-mono">{formatBytesShort(p.estimatedBytes)}</span>
              </div>
            );
          })}
        </div>
      )}

      {(plan.error || issues.length > 0) && (
        <ul className="dl-issues" data-testid="dl-warnings">
          {plan.error && (
            <li className="dl-issue dl-issue--error">
              <I.Warning size={14} />
              <span>{plan.error}</span>
            </li>
          )}
          {issues.map((i) => (
            <li key={i.code + i.message} className={`dl-issue dl-issue--${i.level}`} data-testid={`dl-issue-${i.level}`}>
              {i.level === 'info' ? <I.Info size={14} /> : <I.Warning size={14} />}
              <span>{i.message}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="dl-summary__actions">
        <button className="btn btn--ghost" disabled={blocked || busy} onClick={() => enqueue(false)} data-testid="dl-add-to-queue">
          <I.Queue size={15} />
          Add to queue
        </button>
        <button className="btn btn--accent" disabled={blocked || busy} onClick={() => enqueue(true)} data-testid="dl-start-export">
          <I.Render size={15} />
          Render now
        </button>
      </div>
    </div>
  );
}
