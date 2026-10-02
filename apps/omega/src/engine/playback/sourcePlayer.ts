// Source monitor player: one asset, its own clock (the media element), audio
// from the element, exact paused frames from decodeFrameAt. OWNED BY THE
// VIEWER PACKAGE.

import { decodeFrameAt } from '../media/decode';
import { fromFrames, snapToFrame } from '../time';
import { useEditor } from '../../state/store';
import type { MediaAsset } from '../../state/types';
import { mediaUrl, previewPath } from './preview';

type Listener = () => void;

export class SourcePlayer {
  readonly video: HTMLVideoElement;
  asset: MediaAsset | null = null;
  time = 0;
  rate = 0;
  /** Exact decoded frame for the paused time (drawn over the element). */
  exact: { bmp: ImageBitmap; time: number } | null = null;
  error: string | null = null;
  /** Width in device pixels the picture is shown at (decode size). */
  displayWidth = 0;

  private raf = 0;
  private reverse: { wall: number; from: number } | null = null;
  private exactToken = 0;
  private lastStoreWrite = 0;
  private readonly listeners = new Set<Listener>();
  private pendingSeek: number | null = null;

  constructor() {
    const v = document.createElement('video');
    v.crossOrigin = 'anonymous';
    v.preload = 'auto';
    v.playsInline = true;
    v.disableRemotePlayback = true;
    v.className = 'vw-source-video';
    v.addEventListener('loadedmetadata', () => {
      this.error = null;
      this.applySeek(this.time);
      this.emit();
    });
    v.addEventListener('seeked', () => {
      if (this.pendingSeek !== null) {
        const t = this.pendingSeek;
        this.pendingSeek = null;
        this.applySeek(t);
      }
      this.emit();
    });
    v.addEventListener('ended', () => {
      if (this.rate > 0) this.pause();
    });
    v.addEventListener('error', () => {
      this.error = 'This file could not be played.';
      this.rate = 0;
      this.emit();
    });
    this.video = v;
  }

  get duration(): number {
    const d = this.asset?.duration ?? 0;
    return d > 0 ? d : Number.isFinite(this.video.duration) ? this.video.duration : 0;
  }

  get fps(): number {
    return this.asset?.fps && this.asset.fps > 0 ? this.asset.fps : useEditor.getState().project ? activeFps() : 30;
  }

  get playing(): boolean {
    return this.rate !== 0;
  }

  onChange(cb: Listener): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private emit(): void {
    for (const l of this.listeners) l();
  }

  /** Loads an asset (or clears with null). Keeps the position when the same asset is passed again. */
  load(asset: MediaAsset | null, t = 0): void {
    const same = asset && this.asset && asset.id === this.asset.id && asset.path === this.asset.path;
    if (same) {
      const proxyChanged = previewPath(asset, useProxies()) !== previewPath(this.asset!, useProxies());
      this.asset = asset;
      if (proxyChanged) this.setSrc(asset);
      return;
    }
    this.pause(false);
    this.asset = asset;
    this.exact = null;
    this.error = null;
    this.time = 0;
    if (!asset || asset.kind === 'image' || asset.offline) {
      this.video.removeAttribute('src');
      this.video.load();
      if (asset?.offline) this.error = 'Media offline.';
      this.emit();
      return;
    }
    this.time = Math.max(0, Math.min(t, this.duration));
    this.setSrc(asset);
    this.requestExact();
    this.emit();
  }

  private setSrc(asset: MediaAsset): void {
    this.video.src = mediaUrl(previewPath(asset, useProxies()));
  }

  // ---- transport -------------------------------------------------------------

  play(): void {
    this.shuttle(1);
  }

  toggle(): void {
    if (this.rate !== 0) this.pause();
    else this.play();
  }

  shuttle(rate: number): void {
    const a = this.asset;
    if (!a || a.kind === 'image' || this.error) return;
    if (rate === 0) {
      this.pause();
      return;
    }
    const v = this.video;
    if (this.rate === 0) {
      const frame = fromFrames(1, this.fps);
      if (rate > 0 && this.time >= this.duration - frame) this.applySeek(0);
      if (rate < 0 && this.time <= frame) this.applySeek(Math.max(0, this.duration - frame));
    }
    this.rate = Math.max(-16, Math.min(16, rate));
    this.exact = null;
    if (this.rate > 0) {
      this.reverse = null;
      v.playbackRate = this.rate;
      v.muted = this.rate !== 1;
      void v.play().catch(() => {});
    } else {
      v.pause();
      v.muted = true;
      this.reverse = { wall: performance.now(), from: this.time };
    }
    if (!this.raf) this.raf = requestAnimationFrame(this.tick);
    this.emit();
  }

  pause(exact = true): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    const was = this.rate;
    this.rate = 0;
    this.reverse = null;
    const v = this.video;
    if (!v.paused) v.pause();
    v.muted = false;
    v.playbackRate = 1;
    if (was !== 0 && this.asset) {
      const t = snapToFrame(Math.max(0, Math.min(was > 0 ? v.currentTime : this.time, this.duration)), this.fps);
      this.time = t;
      this.applySeek(t);
      this.writeStore(true);
    }
    if (exact) this.requestExact();
    this.emit();
  }

  seek(t: number): void {
    if (!this.asset) return;
    t = snapToFrame(Math.max(0, Math.min(Number.isFinite(t) ? t : 0, this.duration)), this.fps);
    this.time = t;
    if (this.rate < 0 && this.reverse) this.reverse = { wall: performance.now(), from: t };
    this.applySeek(t);
    if (this.rate === 0) this.requestExact();
    this.writeStore(true);
    this.emit();
  }

  step(frames: number): void {
    if (this.rate !== 0) this.pause(false);
    this.seek(this.time + fromFrames(Math.round(frames), this.fps));
  }

  private applySeek(t: number): void {
    const v = this.video;
    if (v.readyState < 1) return;
    if (v.seeking) {
      this.pendingSeek = t;
      return;
    }
    if (Math.abs(v.currentTime - t) > 0.25 / this.fps) {
      try {
        v.currentTime = t;
      } catch {
        /* not seekable yet */
      }
    }
  }

  private tick = () => {
    this.raf = 0;
    if (this.rate === 0) return;
    const v = this.video;
    if (this.rate > 0) {
      this.time = Math.min(v.currentTime, this.duration);
    } else if (this.reverse) {
      const t = this.reverse.from + ((performance.now() - this.reverse.wall) / 1000) * this.rate;
      if (t <= 0) {
        this.time = 0;
        this.applySeek(0);
        this.pause();
        return;
      }
      this.time = t;
      if (!v.seeking) this.applySeek(snapToFrame(t, this.fps));
    }
    this.writeStore(false);
    this.emit();
    this.raf = requestAnimationFrame(this.tick);
  };

  private writeStore(force: boolean): void {
    const now = performance.now();
    if (!force && now - this.lastStoreWrite < 100) return;
    this.lastStoreWrite = now;
    const s = useEditor.getState();
    if (s.source.assetId === this.asset?.id && Math.abs(s.source.time - this.time) > 1e-6) s.setSource({ time: this.time });
  }

  private requestExact(): void {
    const a = this.asset;
    if (!a || a.kind !== 'video' || !a.hasVideo || this.rate !== 0) return;
    const t = this.time;
    const token = ++this.exactToken;
    const maxWidth = this.displayWidth > 0 ? Math.min(a.width ?? Infinity, Math.ceil(this.displayWidth / 128) * 128) : undefined;
    decodeFrameAt(a, t, { maxWidth })
      .then((bmp) => {
        if (token !== this.exactToken || this.rate !== 0 || this.asset !== a) return;
        if (bmp) {
          this.exact = { bmp, time: t };
          this.emit();
        }
      })
      .catch(() => {});
  }

  /** Re-decode the paused frame at a new display size. */
  refreshExact(): void {
    if (this.rate === 0) this.requestExact();
  }
}

function useProxies(): boolean {
  return useEditor.getState().viewer.useProxies;
}

function activeFps(): number {
  const p = useEditor.getState().project!;
  const seq = p.sequences.find((s) => s.id === p.activeSequenceId) ?? p.sequences[0];
  return seq?.fps ?? 30;
}

let instance: SourcePlayer | null = null;

export function getSourcePlayer(): SourcePlayer {
  return (instance ??= new SourcePlayer());
}
