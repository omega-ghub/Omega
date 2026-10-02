// Background-job state of the media engine (imports, proxies, proxy
// suggestions). A vanilla zustand store so engine code can update it and the
// UI can subscribe with `useStore(mediaJobs, selector)`.
import { createStore } from 'zustand/vanilla';

export interface ImportProgress {
  /** Files in the running import. */
  total: number;
  /** Files probed so far. */
  done: number;
  /** File currently being read. */
  current: string;
}

export interface ProxyJob {
  assetId: string;
  name: string;
  status: 'queued' | 'running' | 'paused';
  /** 0..1 */
  progress: number;
  codec?: string;
}

export interface MediaJobsState {
  importing: ImportProgress | null;
  /** Queued + running proxy builds, in queue order. */
  proxies: ProxyJob[];
  /** Assets just imported that would play better with proxies (one-click suggestion). */
  proxySuggestion: string[] | null;
}

export const mediaJobs = createStore<MediaJobsState>(() => ({
  importing: null,
  proxies: [],
  proxySuggestion: null,
}));

export function setImportProgress(p: ImportProgress | null): void {
  mediaJobs.setState({ importing: p });
}

export function patchProxyJob(assetId: string, patch: Partial<ProxyJob>): void {
  mediaJobs.setState((s) => ({ proxies: s.proxies.map((j) => (j.assetId === assetId ? { ...j, ...patch } : j)) }));
}

export function suggestProxies(assetIds: string[] | null): void {
  mediaJobs.setState({ proxySuggestion: assetIds && assetIds.length ? assetIds : null });
}
