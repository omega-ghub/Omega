// Preview FrameProvider for the program viewer. OWNED BY THE VIEWER PACKAGE.
//
// Playing: one muted HTMLVideoElement per clip (audio comes from the audio
// engine), created ahead of need and released after. Elements play at the
// clip's source velocity (playbackRate) with soft drift correction and a hard
// seek past ~1.5 frames; reverse, freezes and extreme speeds seek per frame.
// Paused: exact frames from decodeFrameAt (WebCodecs), with the element as a
// fallback while they decode or when exact decoding is unavailable.
// Stills come from an HTMLImageElement cache. Never throws on bad media.

import type { FrameImage, FrameProvider } from '../render/frames';
import type { MediaAsset, Project } from '../../state/types';
import { decodeFrameAt } from '../media/decode';

export interface MediaRequest {
  assetId: string;
  sourceTime: number;
  clipId: string;
}

export interface PrepareOptions {
  playing: boolean;
  /** Source seconds per wall second for each clip (playing only). */
  velocity?: Map<string, number>;
  /** Decode width for exact frames, per clip (paused only). */
  maxWidth?: Map<string, number>;
  now: number;
}

interface VideoEntry {
  clipId: string;
  assetId: string;
  url: string;
  el: HTMLVideoElement;
  fps: number;
  lastUsed: number;
  broken: boolean;
  /** Where the element should be (source seconds). */
  target: number;
  /** A seek requested while another was still running. */
  pendingSeek: number | null;
  seekStartedAt: number;
  /** Measured seek latency (s), used to lead hard seeks while playing. */
  seekLatency: number;
  timer: number | null;
}

interface ImageEntry {
  el: HTMLImageElement;
  ready: boolean;
  broken: boolean;
  lastUsed: number;
}

interface ExactReq {
  key: string;
  asset: MediaAsset;
  clipId: string;
  sourceTime: number;
  maxWidth: number;
}

const MAX_VIDEOS = 12;
const IDLE_RELEASE_MS = 3000;
const IMAGE_RELEASE_MS = 30_000;
const EXACT_CACHE = 36;
const MIN_RATE = 0.0625;
const MAX_RATE = 16;

export function mediaUrl(path: string): string {
  try {
    return window.omega.media.urlFor(path);
  } catch {
    return path;
  }
}

/** The file the preview should play for an asset: the proxy when allowed and ready. */
export function previewPath(asset: MediaAsset, useProxies: boolean): string {
  return useProxies && asset.proxyStatus === 'ready' && asset.proxyPath ? asset.proxyPath : asset.path;
}

function exactKey(asset: MediaAsset, t: number, maxWidth: number): string {
  const fps = asset.fps && asset.fps > 0 ? asset.fps : 30;
  const frame = Math.floor(t * fps + 1e-3);
  const bucket = maxWidth > 0 ? Math.ceil(maxWidth / 128) * 128 : 0;
  return `${asset.id}|${frame}|${bucket}`;
}

export class PreviewFrames implements FrameProvider {
  /** Media layers that had no picture during the last render. */
  missing = 0;
  private assets = new Map<string, MediaAsset>();
  private project: Project | null = null;
  private useProxies = true;
  private videos = new Map<string, VideoEntry>();
  private images = new Map<string, ImageEntry>();
  private exact = new Map<string, ImageBitmap>();
  private held = new Map<string, ImageBitmap>();
  private wanted = new Map<string, ExactReq>();
  private inflight = new Set<string>();
  private queued = new Map<string, ExactReq>();
  private decodeNulls = new Map<string, number>();
  private active = new Set<string>();
  private playing = false;

  constructor(private readonly onUpdate: () => void) {}

  setProject(project: Project, useProxies: boolean): void {
    if (project !== this.project) {
      this.project = project;
      this.assets = new Map(project.assets.map((a) => [a.id, a]));
    }
    this.useProxies = useProxies;
  }

  // ---- FrameProvider ------------------------------------------------------

  frame(assetId: string, sourceTime: number, clipId: string): FrameImage | null {
    const asset = this.assets.get(assetId);
    if (!asset) return this.miss();
    if (asset.kind === 'image') {
      const img = this.image(asset);
      img.lastUsed = performance.now();
      return img.ready ? img.el : this.miss();
    }
    const v = this.videos.get(clipId);
    const held = this.held.get(clipId);
    if (!this.playing) {
      const want = this.wanted.get(clipId);
      const bmp = want ? this.exact.get(want.key) : undefined;
      if (bmp) return bmp;
      if (v && !v.broken && v.el.readyState >= 2 && !v.el.seeking && Math.abs(v.el.currentTime - sourceTime) < 0.5 / v.fps) return v.el;
      if (held) return held;
      if (v && !v.broken && v.el.readyState >= 2) return v.el;
      return this.miss();
    }
    if (v && !v.broken && v.el.readyState >= 2) {
      // While an element is still catching up (first seek, cut), hold the last exact frame instead of flashing a wrong one.
      const off = v.el.seeking || Math.abs(v.el.currentTime - v.target) > 3 / v.fps;
      if (off && held) return held;
      return v.el;
    }
    if (held) return held;
    return this.miss();
  }

  private miss(): null {
    this.missing++;
    return null;
  }

  // ---- per-frame preparation ---------------------------------------------

  prepare(reqs: MediaRequest[], opts: PrepareOptions): void {
    this.playing = opts.playing;
    this.active.clear();
    if (!opts.playing) this.wanted.clear();
    for (const r of reqs) {
      const asset = this.assets.get(r.assetId);
      if (!asset || asset.offline) continue;
      if (asset.kind === 'image') {
        this.image(asset).lastUsed = opts.now;
        continue;
      }
      if (this.active.has(r.clipId)) continue;
      this.active.add(r.clipId);
      const v = this.video(r.clipId, asset);
      if (!v) continue;
      v.lastUsed = opts.now;
      if (opts.playing) this.syncPlaying(v, r.sourceTime, opts.velocity?.get(r.clipId));
      else this.preparePaused(v, asset, r, opts.maxWidth?.get(r.clipId) ?? 0);
    }
    if (opts.playing) {
      for (const v of this.videos.values()) if (!this.active.has(v.clipId) && !v.el.paused) v.el.pause();
    }
  }

  /** Creates elements for clips that will be needed soon and pre-rolls them to where they start. */
  prefetch(reqs: MediaRequest[], now: number): void {
    const seen = new Set<string>();
    for (const r of reqs) {
      if (seen.has(r.clipId) || this.active.has(r.clipId)) continue;
      seen.add(r.clipId);
      const asset = this.assets.get(r.assetId);
      if (!asset || asset.offline || asset.kind === 'image') {
        if (asset?.kind === 'image') this.image(asset).lastUsed = now;
        continue;
      }
      const v = this.video(r.clipId, asset);
      if (!v) continue;
      v.lastUsed = now;
      v.target = r.sourceTime;
      if (!v.el.paused) v.el.pause();
      if (v.el.readyState >= 1 && !v.el.seeking && Math.abs(v.el.currentTime - r.sourceTime) > 0.5 / v.fps) this.seekEl(v, r.sourceTime);
    }
  }

  /** Releases elements nobody needed for a while, and keeps the pool bounded. */
  sweep(now: number): void {
    for (const v of this.videos.values()) if (!this.active.has(v.clipId) && now - v.lastUsed > IDLE_RELEASE_MS) this.release(v);
    if (this.videos.size > MAX_VIDEOS) {
      const idle = [...this.videos.values()].filter((v) => !this.active.has(v.clipId)).sort((a, b) => a.lastUsed - b.lastUsed);
      for (const v of idle.slice(0, this.videos.size - MAX_VIDEOS)) this.release(v);
    }
    for (const [url, img] of this.images) {
      if (now - img.lastUsed > IMAGE_RELEASE_MS) {
        img.el.src = '';
        this.images.delete(url);
      }
    }
    const clips = new Set(this.videos.keys());
    for (const id of this.held.keys()) if (!clips.has(id) && !this.wanted.has(id)) this.held.delete(id);
  }

  pauseAll(): void {
    this.playing = false;
    for (const v of this.videos.values()) if (!v.el.paused) v.el.pause();
  }

  dispose(): void {
    for (const v of [...this.videos.values()]) this.release(v);
    for (const img of this.images.values()) img.el.src = '';
    this.images.clear();
    this.exact.clear();
    this.held.clear();
  }

  /** Number of live video elements (diagnostics). */
  get poolSize(): number {
    return this.videos.size;
  }

  // ---- playing ------------------------------------------------------------

  private syncPlaying(v: VideoEntry, target: number, velocity: number | undefined): void {
    v.target = target;
    const el = v.el;
    if (v.broken || el.readyState < 1) return;
    const vel = velocity ?? 1;
    const frame = 1 / v.fps;
    if (vel >= MIN_RATE && vel <= MAX_RATE) {
      if (el.seeking) return;
      const drift = el.currentTime - target;
      if (Math.abs(drift) > 1.5 * frame) {
        // Lead the seek by the measured latency so the element lands in sync.
        const lead = el.paused ? 0 : Math.min(0.5, v.seekLatency) * vel;
        this.seekEl(v, target + lead);
        this.setRate(el, vel);
      } else {
        // Soft correction: pull small drift back within about half a second.
        const corr = Math.max(-0.08 * vel, Math.min(0.08 * vel, -drift * 2));
        this.setRate(el, vel + corr);
      }
      if (el.paused) void el.play().catch(() => {});
    } else {
      if (!el.paused) el.pause();
      if (Math.abs(el.currentTime - target) > 0.5 * frame) this.seekEl(v, target);
    }
  }

  private setRate(el: HTMLVideoElement, rate: number): void {
    const r = Math.max(MIN_RATE, Math.min(MAX_RATE, rate));
    if (Math.abs(el.playbackRate - r) > r * 0.004) el.playbackRate = r;
  }

  // ---- paused --------------------------------------------------------------

  private preparePaused(v: VideoEntry, asset: MediaAsset, r: MediaRequest, maxWidth: number): void {
    if (!v.el.paused) v.el.pause();
    v.target = r.sourceTime;
    const req: ExactReq = { key: exactKey(asset, r.sourceTime, maxWidth), asset, clipId: r.clipId, sourceTime: r.sourceTime, maxWidth };
    this.wanted.set(r.clipId, req);
    const exactOk = (this.decodeNulls.get(asset.id) ?? 0) < 3;
    if (exactOk && !this.exact.has(req.key)) this.requestExact(req);
    else if (exactOk) this.held.set(r.clipId, this.exact.get(req.key)!);
    // Keep the element positioned too (fallback picture, and ready to play from here).
    this.scheduleElementSeek(v, r.sourceTime, exactOk ? 220 : 0);
  }

  private scheduleElementSeek(v: VideoEntry, t: number, delay: number): void {
    if (v.timer !== null) clearTimeout(v.timer);
    v.timer = null;
    if (delay <= 0) {
      this.seekEl(v, t);
      return;
    }
    v.timer = window.setTimeout(() => {
      v.timer = null;
      if (!this.playing && this.videos.get(v.clipId) === v) this.seekEl(v, v.target);
    }, delay);
  }

  private seekEl(v: VideoEntry, t: number): void {
    const el = v.el;
    if (v.broken) return;
    if (el.readyState < 1) {
      v.pendingSeek = t; // applied on loadedmetadata
      return;
    }
    if (el.seeking) {
      v.pendingSeek = t;
      return;
    }
    if (Math.abs(el.currentTime - t) < 0.25 / v.fps) return;
    v.pendingSeek = null;
    v.seekStartedAt = performance.now();
    try {
      el.currentTime = Math.max(0, t);
    } catch {
      /* not seekable yet */
    }
  }

  private requestExact(req: ExactReq): void {
    if (this.inflight.has(req.clipId)) {
      this.queued.set(req.clipId, req);
      return;
    }
    this.inflight.add(req.clipId);
    const done = (bmp: ImageBitmap | null) => {
      this.inflight.delete(req.clipId);
      if (bmp) {
        this.decodeNulls.set(req.asset.id, 0);
        this.cachePut(req.key, bmp);
        this.held.set(req.clipId, bmp);
        if (this.wanted.get(req.clipId)?.key === req.key) this.onUpdate();
      } else {
        this.decodeNulls.set(req.asset.id, (this.decodeNulls.get(req.asset.id) ?? 0) + 1);
        // Exact decoding is unavailable for this frame: fall back to the element right away.
        const v = this.videos.get(req.clipId);
        const want = this.wanted.get(req.clipId);
        if (v && want) this.scheduleElementSeek(v, want.sourceTime, 0);
      }
      const next = this.queued.get(req.clipId);
      this.queued.delete(req.clipId);
      if (next && next.key !== req.key && !this.exact.has(next.key) && this.wanted.get(req.clipId)?.key === next.key && !this.playing) this.requestExact(next);
    };
    let p: Promise<ImageBitmap | null>;
    try {
      p = decodeFrameAt(req.asset, req.sourceTime, { maxWidth: req.maxWidth > 0 ? req.maxWidth : undefined });
    } catch {
      p = Promise.resolve(null);
    }
    p.then(done, () => done(null));
  }

  private cachePut(key: string, bmp: ImageBitmap): void {
    this.exact.delete(key);
    this.exact.set(key, bmp);
    while (this.exact.size > EXACT_CACHE) {
      const oldest = this.exact.keys().next().value as string;
      this.exact.delete(oldest);
    }
  }

  // ---- elements --------------------------------------------------------------

  private video(clipId: string, asset: MediaAsset): VideoEntry | null {
    const url = mediaUrl(previewPath(asset, this.useProxies));
    let v = this.videos.get(clipId);
    if (v && v.assetId === asset.id && v.url === url) return v.broken ? null : v;
    if (v && v.assetId === asset.id && v.url !== url && !v.broken) {
      // proxy toggled: swap the source and return to the same place
      v.url = url;
      v.el.src = url;
      v.pendingSeek = v.target;
      return v;
    }
    if (v) this.release(v);
    const el = document.createElement('video');
    el.crossOrigin = 'anonymous';
    el.muted = true;
    el.playsInline = true;
    el.preload = 'auto';
    el.disableRemotePlayback = true;
    const entry: VideoEntry = {
      clipId,
      assetId: asset.id,
      url,
      el,
      fps: asset.fps && asset.fps > 0 ? asset.fps : 30,
      lastUsed: performance.now(),
      broken: false,
      target: 0,
      pendingSeek: null,
      seekStartedAt: 0,
      seekLatency: 0.08,
      timer: null,
    };
    el.addEventListener('loadedmetadata', () => {
      if (entry.pendingSeek !== null) {
        const t = entry.pendingSeek;
        entry.pendingSeek = null;
        this.seekEl(entry, t);
      }
    });
    el.addEventListener('seeked', () => {
      if (entry.seekStartedAt) {
        const lat = (performance.now() - entry.seekStartedAt) / 1000;
        entry.seekLatency = entry.seekLatency * 0.7 + Math.min(1, lat) * 0.3;
        entry.seekStartedAt = 0;
      }
      if (entry.pendingSeek !== null) {
        const t = entry.pendingSeek;
        entry.pendingSeek = null;
        this.seekEl(entry, t);
        return;
      }
      if (!this.playing) this.onUpdate();
    });
    el.addEventListener('loadeddata', () => {
      if (!this.playing) this.onUpdate();
    });
    el.addEventListener('error', () => {
      entry.broken = true;
      this.onUpdate();
    });
    el.src = url;
    this.videos.set(clipId, entry);
    return entry;
  }

  private image(asset: MediaAsset): ImageEntry {
    const url = mediaUrl(asset.path);
    let img = this.images.get(url);
    if (img) return img;
    const el = new Image();
    el.crossOrigin = 'anonymous';
    el.decoding = 'async';
    img = { el, ready: false, broken: false, lastUsed: performance.now() };
    const entry = img;
    el.onload = () => {
      entry.ready = true;
      this.onUpdate();
    };
    el.onerror = () => {
      entry.broken = true;
    };
    el.src = url;
    this.images.set(url, img);
    return img;
  }

  private release(v: VideoEntry): void {
    if (v.timer !== null) clearTimeout(v.timer);
    try {
      v.el.pause();
      v.el.removeAttribute('src');
      v.el.load();
    } catch {
      /* ignore */
    }
    this.videos.delete(v.clipId);
  }
}
