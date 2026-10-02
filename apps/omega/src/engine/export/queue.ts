// Render queue: a zustand store of export jobs, rendered one at a time.
// Persisted in localStorage per project (running state is not persisted: a
// job that was rendering when the app closed comes back as queued). When a
// run finishes, a system notification and a toast report the result.

import { create } from 'zustand';
import { useEditor } from '../../state/store';
import { newId } from '../../state/types';
import { formatBytesShort } from './format';
import type { JobSpec } from './jobs';
import { baseName, extensionFor, uniquePath } from './naming';
import { resolveRange } from './plan';
import { exportJob, type ExportResult } from './pipeline';
import type { ExportPhase, ExportProgress } from './types';
import { errorMessage, isCancel } from './util';

export type JobStatus = 'queued' | 'rendering' | 'done' | 'failed' | 'cancelled';

export interface QueueJob extends JobSpec {
  id: string;
  status: JobStatus;
  progress: number;
  phase: ExportPhase | null;
  eta: number | null;
  fps: number | null;
  startedAt: number | null;
  finishedAt: number | null;
  outputBytes: number | null;
  error: string | null;
  warnings: string[];
  log: string[];
  files: string[];
  /** e.g. "H.264 · 1920×1080 · 29.97 fps" once rendered */
  summary: string | null;
  addedAt: number;
}

interface QueueState {
  projectId: string | null;
  jobs: QueueJob[];
  running: boolean;
  currentId: string | null;
  attach(projectId: string | null): void;
  add(specs: JobSpec[]): Promise<string[]>;
  remove(id: string): void;
  move(id: string, delta: number): void;
  duplicate(id: string): void;
  retry(id: string): void;
  clearFinished(): void;
  /** Renders queued jobs in order (only `ids` when given). */
  start(ids?: string[]): Promise<void>;
  /** Cancels the job being rendered and stops the run. */
  cancelCurrent(): void;
}

const KEY = (projectId: string) => `delta.renderQueue.${projectId}`;
let controller: AbortController | null = null;
let runFilter: Set<string> | null = null;
let stopRequested = false;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function load(projectId: string): QueueJob[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY(projectId)) ?? '[]') as QueueJob[];
    return Array.isArray(raw) ? raw.map((j) => (j.status === 'rendering' ? { ...j, status: 'queued', progress: 0, phase: null, eta: null, fps: null } : j)) : [];
  } catch {
    return [];
  }
}

function persist() {
  const { projectId, jobs } = useRenderQueue.getState();
  if (!projectId) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      const clean = jobs.map((j) => (j.status === 'rendering' ? { ...j, status: 'queued' as const, progress: 0, phase: null, eta: null, fps: null, startedAt: null } : j));
      localStorage.setItem(KEY(projectId), JSON.stringify(clean));
    } catch {
      /* storage full or unavailable: the queue still works for this session */
    }
  }, 250);
}

function patch(id: string, p: Partial<QueueJob>) {
  useRenderQueue.setState((s) => ({ jobs: s.jobs.map((j) => (j.id === id ? { ...j, ...p } : j)) }));
}

function fresh(spec: JobSpec): QueueJob {
  return {
    ...spec,
    id: newId('job'),
    status: 'queued',
    progress: 0,
    phase: null,
    eta: null,
    fps: null,
    startedAt: null,
    finishedAt: null,
    outputBytes: null,
    error: null,
    warnings: [],
    log: [],
    files: [],
    summary: null,
    addedAt: Date.now(),
  };
}

function summarize(r: ExportResult, job: QueueJob): string {
  const kind = job.settings.kind;
  const fps = r.fps ? `${Math.round(r.fps * 1000) / 1000} fps` : '';
  const codecs: Record<string, string> = { avc: 'H.264', hevc: 'HEVC', vp9: 'VP9', av1: 'AV1', vp8: 'VP8' };
  if (kind === 'video') return [r.videoCodec ? codecs[r.videoCodec] : '', `${r.width}×${r.height}`, fps].filter(Boolean).join(' · ');
  if (kind === 'audio') return [r.audioCodec?.toUpperCase().replace('PCM-', 'PCM '), r.loudness?.resultLufs !== undefined ? `${r.loudness.resultLufs.toFixed(1)} LUFS` : ''].filter(Boolean).join(' · ');
  if (kind === 'imageSequence') return `${r.frames} PNG · ${r.width}×${r.height}`;
  if (kind === 'still') return `PNG · ${r.width}×${r.height}`;
  return job.settings.container.toUpperCase();
}

async function notifyDone(done: number, failed: number, cancelled: number) {
  const total = done + failed;
  if (!total && !cancelled) return;
  const parts = [done ? `${done} rendered` : '', failed ? `${failed} failed` : '', cancelled ? `${cancelled} cancelled` : ''].filter(Boolean).join(', ');
  useEditor.getState().showToast(`Render queue finished: ${parts}`, failed ? 'error' : 'success');
  try {
    if (typeof Notification === 'undefined' || !total) return;
    if (Notification.permission === 'default') await Notification.requestPermission().catch(() => undefined);
    if (Notification.permission === 'granted') new Notification('Render queue finished', { body: parts, silent: false });
  } catch {
    /* notifications unavailable */
  }
}

async function runOne(job: QueueJob): Promise<JobStatus> {
  const project = useEditor.getState().project;
  if (!project) {
    patch(job.id, { status: 'failed', error: 'No project is open.', finishedAt: Date.now() });
    return 'failed';
  }
  const seq = project.sequences.find((s) => s.id === job.sequenceId);
  let range = job.range;
  // "Entire sequence" follows the edit as it is now.
  if (seq && job.rangeSpec.mode === 'entire') {
    try {
      range = resolveRange(job.rangeSpec, seq);
    } catch {
      /* keep the stored range; preflight reports an empty one */
    }
  }
  controller = new AbortController();
  const startedAt = Date.now();
  patch(job.id, { status: 'rendering', progress: 0, phase: 'preflight', eta: null, fps: null, startedAt, finishedAt: null, error: null, warnings: [], log: [], range });
  let last = 0;
  const onProgress = (p: ExportProgress) => {
    const now = performance.now();
    if (now - last < 100 && p.phase !== 'done') return;
    last = now;
    patch(job.id, { progress: p.fraction, phase: p.phase, eta: p.eta, fps: p.fps });
  };
  try {
    const r = await exportJob(
      { name: job.name, project, sequenceId: job.sequenceId, settings: job.settings, range, formatId: job.formatId, outputPath: job.outputPath, presetName: job.presetName, limits: job.limits, expectsCodec: job.expectsCodec },
      onProgress,
      controller.signal,
    );
    patch(job.id, {
      status: 'done',
      progress: 1,
      phase: 'done',
      eta: null,
      finishedAt: Date.now(),
      outputBytes: r.bytes,
      outputPath: r.outputPath,
      files: r.files,
      warnings: r.warnings,
      log: r.log,
      summary: summarize(r, job),
      fps: r.frames > 1 ? r.frames / Math.max(0.001, (Date.now() - startedAt) / 1000) : null,
    });
    return 'done';
  } catch (err) {
    if (isCancel(err)) {
      patch(job.id, { status: 'cancelled', phase: null, eta: null, finishedAt: Date.now(), error: null });
      return 'cancelled';
    }
    patch(job.id, { status: 'failed', phase: null, eta: null, finishedAt: Date.now(), error: errorMessage(err) });
    console.warn('[deliver] export failed', job.name, err);
    return 'failed';
  } finally {
    controller = null;
  }
}

export const useRenderQueue = create<QueueState>((set, get) => ({
  projectId: null,
  jobs: [],
  running: false,
  currentId: null,

  attach(projectId) {
    if (get().projectId === projectId) return;
    if (get().running) get().cancelCurrent();
    set({ projectId, jobs: projectId ? load(projectId) : [], running: false, currentId: null });
  },

  async add(specs) {
    const taken = new Set(get().jobs.filter((j) => j.status === 'queued' || j.status === 'rendering').map((j) => j.outputPath));
    const exists = (p: string) => (window.omega?.media?.exists ? window.omega.media.exists(p).catch(() => false) : false);
    const jobs: QueueJob[] = [];
    for (const spec of specs) {
      const path = await uniquePath(spec.outputPath, async (p) => taken.has(p) || (await exists(p)));
      taken.add(path);
      const ext = extensionFor(spec.settings);
      const file = baseName(path);
      const name = ext && file.endsWith(`.${ext}`) ? file.slice(0, -ext.length - 1) : file;
      jobs.push(fresh({ ...spec, outputPath: path, name }));
    }
    set((s) => ({ jobs: [...s.jobs, ...jobs] }));
    persist();
    if (get().running && runFilter) for (const j of jobs) runFilter.add(j.id);
    return jobs.map((j) => j.id);
  },

  remove(id) {
    if (get().currentId === id) get().cancelCurrent();
    set((s) => ({ jobs: s.jobs.filter((j) => j.id !== id) }));
    persist();
  },

  move(id, delta) {
    set((s) => {
      const i = s.jobs.findIndex((j) => j.id === id);
      const k = Math.max(0, Math.min(s.jobs.length - 1, i + delta));
      if (i < 0 || i === k) return s;
      const jobs = [...s.jobs];
      const [j] = jobs.splice(i, 1);
      jobs.splice(k, 0, j);
      return { jobs };
    });
    persist();
  },

  duplicate(id) {
    const j = get().jobs.find((x) => x.id === id);
    if (!j) return;
    const { id: _i, status: _s, ...spec } = j;
    void get().add([{ ...spec }]);
  },

  retry(id) {
    patch(id, { status: 'queued', progress: 0, phase: null, eta: null, fps: null, error: null, startedAt: null, finishedAt: null, outputBytes: null, warnings: [], log: [], files: [], summary: null });
    persist();
  },

  clearFinished() {
    set((s) => ({ jobs: s.jobs.filter((j) => j.status === 'queued' || j.status === 'rendering') }));
    persist();
  },

  async start(ids) {
    if (get().running) {
      // already rendering: the new jobs are picked up by this run
      if (runFilter && ids) for (const id of ids) runFilter.add(id);
      return;
    }
    runFilter = ids ? new Set(ids) : null;
    stopRequested = false;
    set({ running: true });
    let done = 0;
    let failed = 0;
    let cancelled = 0;
    try {
      for (;;) {
        if (stopRequested) break;
        const next = get().jobs.find((j) => j.status === 'queued' && (!runFilter || runFilter.has(j.id)));
        if (!next) break;
        set({ currentId: next.id });
        persist();
        const status = await runOne(next);
        if (status === 'done') done++;
        else if (status === 'failed') failed++;
        else if (status === 'cancelled') cancelled++;
        persist();
      }
    } finally {
      set({ running: false, currentId: null });
      runFilter = null;
      persist();
    }
    await notifyDone(done, failed, cancelled);
  },

  cancelCurrent() {
    stopRequested = true;
    controller?.abort();
  },
}));

/** Text for a finished job's size, e.g. "48.2 MB". */
export function jobSizeText(job: QueueJob): string {
  return job.outputBytes !== null ? formatBytesShort(job.outputBytes) : '';
}
