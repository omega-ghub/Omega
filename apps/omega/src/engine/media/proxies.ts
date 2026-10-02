// Proxy media: small, short-GOP copies of heavy sources for smooth playback.
// Export always reads the originals. OWNED BY THE MEDIA PACKAGE.
//
// buildProxy(assetId) queues a background Mediabunny Conversion to a
// 1280-wide (or 960-wide, see setProxyLongSide) file in the first encodable
// codec (H.264 in MP4, else VP9 / AV1 in WebM) with 1 s key frames, writes it
// to <project dir>/Proxies/<name>.proxy.mp4|webm, and records it on the asset
// (proxyStatus 'building' → 'ready' | 'failed', proxyPath). Jobs run one at a
// time, pause while the editor plays back, and can be cancelled.

import {
  BufferTarget,
  Conversion,
  ConversionCanceledError,
  Mp4OutputFormat,
  Output,
  Quality,
  WebMOutputFormat,
  getFirstEncodableAudioCodec,
  getFirstEncodableVideoCodec,
  type AudioCodec,
  type VideoCodec,
} from 'mediabunny';
import { useEditor } from '../../state/store';
import type { MediaAsset, Project } from '../../state/types';
import { invalidateDecodeCache } from './decode';
import { mediaJobs, patchProxyJob, suggestProxies, type ProxyJob } from './jobs';
import { joinPath, proxyBitrate, proxyDims, stem, wantsProxy } from './mediaMath';
import { openInput } from './source';

let longSide: 1280 | 960 = 1280;

/** Proxy resolution (long side in pixels). */
export function setProxyLongSide(px: 1280 | 960): void {
  longSide = px;
}
export function getProxyLongSide(): 1280 | 960 {
  return longSide;
}

interface Running {
  assetId: string;
  conversion: Conversion | null;
  canceled: boolean;
}

let running: Running | null = null;
let pumping = false;
const waiters = new Map<string, ((ok: boolean) => void)[]>();

function project(): Project | null {
  return useEditor.getState().project;
}

function assetById(id: string): MediaAsset | undefined {
  return project()?.assets.find((a) => a.id === id);
}

/** True while a proxy for this asset is queued or being built in this session. */
export function isProxyJobActive(assetId: string): boolean {
  return mediaJobs.getState().proxies.some((j) => j.assetId === assetId);
}

/** The status to show: a 'building' status left over from a previous session counts as none. */
export function effectiveProxyStatus(a: MediaAsset): NonNullable<MediaAsset['proxyStatus']> {
  const s = a.proxyStatus ?? 'none';
  if (s === 'building' && !isProxyJobActive(a.id)) return a.proxyPath ? 'ready' : 'none';
  return s;
}

export function canBuildProxy(a: MediaAsset): boolean {
  return a.kind === 'video' && a.hasVideo && !a.offline && !!a.width && !!a.height;
}

/** Queues proxy builds for several assets (one undo step). Returns how many were queued. */
export function buildProxies(assetIds: string[]): number {
  const p = project();
  if (!p) return 0;
  if (!useEditor.getState().handle) {
    useEditor.getState().showToast('Save the project before building proxies', 'error');
    return 0;
  }
  const ids = assetIds.filter((id) => {
    const a = p.assets.find((x) => x.id === id);
    return a && canBuildProxy(a) && !isProxyJobActive(id);
  });
  if (!ids.length) return 0;
  const set = new Set(ids);
  useEditor.getState().mutate(ids.length === 1 ? 'Build proxy' : `Build ${ids.length} proxies`, (d) => {
    for (const a of d.assets) if (set.has(a.id)) a.proxyStatus = 'building';
  });
  const jobs: ProxyJob[] = ids.map((id) => ({ assetId: id, name: assetById(id)?.name ?? id, status: 'queued', progress: 0 }));
  mediaJobs.setState((s) => ({ proxies: [...s.proxies, ...jobs] }));
  const sug = mediaJobs.getState().proxySuggestion;
  if (sug) suggestProxies(sug.filter((id) => !set.has(id)));
  void pump();
  return ids.length;
}

/** Builds one proxy; resolves true when it is ready. */
export function buildProxy(assetId: string): Promise<boolean> {
  const promise = new Promise<boolean>((resolve) => {
    const list = waiters.get(assetId) ?? [];
    list.push(resolve);
    waiters.set(assetId, list);
  });
  if (!isProxyJobActive(assetId) && buildProxies([assetId]) === 0) settle(assetId, false);
  return promise;
}

/** Cancels a queued or running build. */
export function cancelProxy(assetId: string): void {
  const queued = mediaJobs.getState().proxies.find((j) => j.assetId === assetId);
  if (!queued) return;
  if (running?.assetId === assetId) {
    running.canceled = true;
    void running.conversion?.cancel().catch(() => undefined);
    return; // the runner reverts the status
  }
  mediaJobs.setState((s) => ({ proxies: s.proxies.filter((j) => j.assetId !== assetId) }));
  revertStatus([assetId], 'Cancel proxy');
  settle(assetId, false);
}

/** Cancels every queued and running build. */
export function cancelAllProxies(): void {
  for (const j of [...mediaJobs.getState().proxies]) cancelProxy(j.assetId);
}

/**
 * Detaches the proxy from the asset (playback goes back to the original).
 * The file stays in the project's Proxies folder: the app has no delete API.
 */
export function deleteProxy(assetId: string | string[]): void {
  const ids = Array.isArray(assetId) ? assetId : [assetId];
  for (const id of ids) if (isProxyJobActive(id)) cancelProxy(id);
  const set = new Set(ids.filter((id) => {
    const a = assetById(id);
    return a && (a.proxyPath || (a.proxyStatus && a.proxyStatus !== 'none'));
  }));
  if (!set.size) return;
  useEditor.getState().mutate(set.size === 1 ? 'Delete proxy' : `Delete ${set.size} proxies`, (d) => {
    for (const a of d.assets) {
      if (!set.has(a.id)) continue;
      a.proxyPath = null;
      a.proxyStatus = 'none';
    }
  });
  for (const id of set) invalidateDecodeCache(id);
}

/** Assets of `ids` that would benefit from proxies and have none. */
export function proxyCandidates(assets: MediaAsset[]): string[] {
  return assets.filter((a) => wantsProxy(a) && canBuildProxy(a) && effectiveProxyStatus(a) === 'none').map((a) => a.id);
}

// ---------------------------------------------------------------------------

function settle(assetId: string, ok: boolean) {
  const list = waiters.get(assetId);
  waiters.delete(assetId);
  for (const r of list ?? []) r(ok);
}

function revertStatus(ids: string[], label: string, status: 'none' | 'failed' = 'none') {
  const set = new Set(ids);
  useEditor.getState().mutate(label, (d) => {
    for (const a of d.assets) {
      if (!set.has(a.id) || a.proxyStatus !== 'building') continue;
      a.proxyStatus = a.proxyPath && status === 'none' ? 'ready' : status;
    }
  });
}

async function pump() {
  if (pumping) return;
  pumping = true;
  try {
    for (;;) {
      const job = mediaJobs.getState().proxies.find((j) => j.status === 'queued');
      if (!job) break;
      running = { assetId: job.assetId, conversion: null, canceled: false };
      patchProxyJob(job.assetId, { status: 'running', progress: 0 });
      let outcome: 'ready' | 'failed' | 'canceled' = 'failed';
      let error = '';
      let path = '';
      try {
        path = await runJob(running);
        outcome = 'ready';
      } catch (err) {
        if (running.canceled || err instanceof ConversionCanceledError) outcome = 'canceled';
        else {
          error = err instanceof Error ? err.message : String(err);
          console.warn('[media] proxy failed', job.name, err);
        }
      }
      const assetId = job.assetId;
      running = null;
      mediaJobs.setState((s) => ({ proxies: s.proxies.filter((j) => j.assetId !== assetId) }));
      if (outcome === 'ready') {
        useEditor.getState().mutate('Proxy ready', (d) => {
          const a = d.assets.find((x) => x.id === assetId);
          if (!a) return;
          a.proxyPath = path;
          a.proxyStatus = 'ready';
        });
        invalidateDecodeCache(assetId);
        if (!mediaJobs.getState().proxies.length) useEditor.getState().showToast(`Proxy ready: ${job.name}`, 'success');
      } else if (outcome === 'canceled') {
        revertStatus([assetId], 'Cancel proxy');
      } else {
        revertStatus([assetId], 'Proxy failed', 'failed');
        useEditor.getState().showToast(`Proxy failed for ${job.name}: ${error || 'unknown error'}`, 'error');
      }
      settle(assetId, outcome === 'ready');
    }
  } finally {
    pumping = false;
  }
}

async function waitWhilePlaying(job: Running) {
  if (!useEditor.getState().playing) return;
  patchProxyJob(job.assetId, { status: 'paused' });
  await new Promise<void>((resolve) => {
    const unsub = useEditor.subscribe((s) => {
      if (!s.playing || job.canceled) {
        unsub();
        resolve();
      }
    });
  });
  patchProxyJob(job.assetId, { status: 'running' });
}

async function runJob(job: Running): Promise<string> {
  const state = useEditor.getState();
  const asset = assetById(job.assetId);
  if (!asset) throw new Error('The clip was removed');
  if (!state.handle) throw new Error('Save the project first');
  if (!asset.width || !asset.height) throw new Error('Unknown frame size');
  const dims = proxyDims(asset.width, asset.height, longSide);
  const bitrate = proxyBitrate(dims.width, dims.height, asset.fps ?? 30);

  const videoCodec: VideoCodec | null = await getFirstEncodableVideoCodec(['avc', 'vp9', 'av1'], { width: dims.width, height: dims.height, bitrate });
  if (!videoCodec) throw new Error('No video encoder is available on this system');
  const mp4 = videoCodec === 'avc';
  const channels = Math.min(2, Math.max(1, asset.channels ?? 2));
  const audioCodec: AudioCodec | null = asset.hasAudio
    ? await getFirstEncodableAudioCodec(mp4 ? ['aac', 'opus'] : ['opus', 'vorbis'], { numberOfChannels: channels, sampleRate: 48000 }).catch(() => null)
    : null;
  patchProxyJob(job.assetId, { codec: videoCodec });

  const input = openInput(asset.path, 32);
  try {
    const target = new BufferTarget();
    const output = new Output({ format: mp4 ? new Mp4OutputFormat({ fastStart: 'in-memory' }) : new WebMOutputFormat(), target });
    const conversion = await Conversion.init({
      input,
      output,
      tracks: 'primary',
      video: {
        width: dims.width,
        height: dims.height,
        fit: 'fill',
        codec: videoCodec,
        quality: new Quality({ bitrate }),
        keyFrameInterval: 1,
        forceTranscode: true,
      },
      audio: audioCodec
        ? { codec: audioCodec, quality: new Quality({ bitrate: 128_000 }), ...(asset.channels && asset.channels > 2 ? { numberOfChannels: 2 } : {}) }
        : { discard: true },
      showWarnings: false,
    });
    if (!conversion.isValid || !conversion.utilizedTracks.some((t) => t.type === 'video')) {
      const reasons = conversion.discardedTracks.map((d) => `${d.track.type}: ${d.reason}`).join(', ');
      throw new Error(`Cannot convert this file (${reasons || 'no usable tracks'})`);
    }
    job.conversion = conversion;
    if (job.canceled) throw new ConversionCanceledError();
    let lastReport = 0;
    conversion.onProgress = (p) => {
      const now = performance.now();
      if (now - lastReport < 150 && p < 1) return;
      lastReport = now;
      patchProxyJob(job.assetId, { progress: Math.max(0, Math.min(1, p)) });
    };
    for (;;) {
      await waitWhilePlaying(job);
      if (job.canceled) throw new ConversionCanceledError();
      const pause = new AbortController();
      const unsub = useEditor.subscribe((s) => {
        if (s.playing) pause.abort();
      });
      try {
        await conversion.execute({ pauseSignal: pause.signal });
      } finally {
        unsub();
      }
      if (conversion.state === 'done') break;
      if (conversion.state === 'canceled' || job.canceled) throw new ConversionCanceledError();
    }
    const buffer = target.buffer;
    if (!buffer || buffer.byteLength < 64) throw new Error('The encoder produced no data');
    const dir = useEditor.getState().handle?.dir ?? state.handle.dir;
    const path = joinPath(dir, 'Proxies', proxyFileName(project(), asset, mp4 ? 'mp4' : 'webm'));
    await window.omega.files.writeBinary(path, buffer);
    return path;
  } finally {
    input.dispose();
  }
}

function proxyFileName(p: Project | null, asset: MediaAsset, ext: string): string {
  const base = stem(asset.path).replace(/[\\/:*?"<>|]+/g, '_') || 'clip';
  const name = `${base}.proxy.${ext}`;
  const clash = p?.assets.some((a) => a.id !== asset.id && a.proxyPath && a.proxyPath.endsWith(name));
  return clash ? `${base}-${asset.id.slice(-4)}.proxy.${ext}` : name;
}
