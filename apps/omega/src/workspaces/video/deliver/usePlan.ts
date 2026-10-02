// Live preflight for the Deliver settings: expands the draft into jobs and
// plans each one (size, codecs, estimate, issues), debounced.
// OWNED BY THE DELIVER PACKAGE.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useEditor } from '../../../state/store';
import { activeSequence } from '../../../state/types';
import { buildJobs, planExport, type ExportDraft, type ExportPlan, type JobSpec } from '../../../engine/export';

export interface DraftPlan {
  jobs: JobSpec[];
  plans: ExportPlan[];
  /** A problem that prevents building jobs at all (e.g. empty range). */
  error: string | null;
  loading: boolean;
}

export function useDraftPlan(draft: ExportDraft): DraftPlan {
  const project = useEditor((s) => s.project);
  // stills follow the playhead; other kinds don't need to re-plan on every frame step
  const playhead = useEditor((s) => (draft.settings.kind === 'still' ? s.playhead : 0));
  const seq = project ? activeSequence(project) : null;

  const built = useMemo((): { jobs: JobSpec[]; error: string | null } => {
    if (!project || !seq) return { jobs: [], error: 'No sequence is open.' };
    try {
      return { jobs: buildJobs(draft, project, seq, { playhead }), error: null };
    } catch (err) {
      return { jobs: [], error: (err as Error).message };
    }
  }, [draft, project, seq, playhead]);

  const [plans, setPlans] = useState<ExportPlan[]>([]);
  const [loading, setLoading] = useState(false);
  const req = useRef(0);

  useEffect(() => {
    const id = ++req.current;
    if (!project || !built.jobs.length) {
      setPlans([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const timer = setTimeout(() => {
      void Promise.all(
        built.jobs.map((j) =>
          planExport({ name: j.name, project, sequenceId: j.sequenceId, settings: j.settings, range: j.range, formatId: j.formatId, outputPath: j.outputPath, presetName: j.presetName, limits: j.limits, expectsCodec: j.expectsCodec }, { diskSpace: true }),
        ),
      )
        .then((p) => {
          if (id === req.current) setPlans(p);
        })
        .catch((err) => {
          console.warn('[deliver] preflight failed', err);
          if (id === req.current) setPlans([]);
        })
        .finally(() => {
          if (id === req.current) setLoading(false);
        });
    }, 220);
    return () => clearTimeout(timer);
  }, [built, project]);

  return { jobs: built.jobs, plans, error: built.error, loading };
}
