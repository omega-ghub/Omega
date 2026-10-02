import type { Clip, Project, Track } from '../state/types';
import { sequenceDuration } from '../state/types';

// Real-time playback engine for the video workspace (preview quality).
//
// Each clip on the timeline owns one media element. On every animation frame
// the player keeps the active elements in sync with the master clock and
// composites the active video clips (bottom track first) onto the canvas.
// Audio comes only from audio-track clips; video elements are always muted,
// so deleting a clip's audio really silences it, the way editors expect.

type MediaEl = HTMLVideoElement | HTMLAudioElement | HTMLImageElement;

const DRIFT_TOLERANCE = 0.12; // seconds before we hard-resync a playing element

export class Player {
  private ctx: CanvasRenderingContext2D;
  private project: Project | null = null;
  private elements = new Map<string, MediaEl>();
  private raf = 0;
  private wallStart = 0;
  private timeStart = 0;
  time = 0;
  playing = false;
  onTime: ((t: number) => void) | null = null;
  onPlayState: ((playing: boolean) => void) | null = null;

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('2D canvas unavailable');
    this.ctx = ctx;
  }

  setProject(project: Project | null) {
    this.project = project;
    this.collectGarbage();
    this.sync(true);
    this.render();
  }

  seek(t: number) {
    const duration = this.project ? sequenceDuration(this.project.sequence) : 0;
    this.time = Math.max(0, Math.min(t, Math.max(duration, 0)));
    if (this.playing) {
      this.wallStart = performance.now();
      this.timeStart = this.time;
    }
    this.sync(true);
    this.render();
    this.onTime?.(this.time);
  }

  play() {
    if (this.playing || !this.project) return;
    const duration = sequenceDuration(this.project.sequence);
    if (duration <= 0) return;
    if (this.time >= duration) this.time = 0;
    this.playing = true;
    this.wallStart = performance.now();
    this.timeStart = this.time;
    this.onPlayState?.(true);
    this.raf = requestAnimationFrame(this.tick);
  }

  pause() {
    if (!this.playing) return;
    this.playing = false;
    cancelAnimationFrame(this.raf);
    for (const el of this.elements.values()) if (!(el instanceof HTMLImageElement)) el.pause();
    this.sync(true);
    this.render();
    this.onPlayState?.(false);
  }

  toggle() {
    if (this.playing) this.pause();
    else this.play();
  }

  dispose() {
    this.pause();
    for (const el of this.elements.values()) this.release(el);
    this.elements.clear();
  }

  /** Re-draw the current frame (e.g. after a canvas resize). */
  redraw() {
    this.render();
  }

  private tick = () => {
    if (!this.playing || !this.project) return;
    const duration = sequenceDuration(this.project.sequence);
    this.time = this.timeStart + (performance.now() - this.wallStart) / 1000;
    if (this.time >= duration) {
      this.time = duration;
      this.sync(false);
      this.render();
      this.onTime?.(this.time);
      this.pause();
      return;
    }
    this.sync(false);
    this.render();
    this.onTime?.(this.time);
    this.raf = requestAnimationFrame(this.tick);
  };

  private isActive(track: Track, clip: Clip, t: number) {
    return !track.muted && t >= clip.start && t < clip.start + clip.duration;
  }

  private sync(force: boolean) {
    if (!this.project) return;
    const t = this.time;
    for (const track of this.project.sequence.tracks) {
      for (const clip of track.clips) {
        const el = this.elementFor(clip, track);
        if (!el || el instanceof HTMLImageElement) continue;
        const active = this.isActive(track, clip, t);
        if (!active) {
          if (!el.paused) el.pause();
          continue;
        }
        const desired = clip.inPoint + (t - clip.start);
        if (track.kind === 'audio') {
          const gain = clip.gain ?? 0;
          el.volume = Math.max(0, Math.min(1, Math.pow(10, gain / 20)));
        }
        if (this.playing) {
          if (el.paused) {
            el.currentTime = desired;
            void el.play().catch(() => {});
          } else if (Math.abs(el.currentTime - desired) > DRIFT_TOLERANCE) {
            el.currentTime = desired;
          }
        } else {
          if (!el.paused) el.pause();
          if (force || Math.abs(el.currentTime - desired) > 0.02) el.currentTime = desired;
        }
      }
    }
  }

  private render() {
    const { canvas, ctx } = this;
    const w = canvas.width;
    const h = canvas.height;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
    if (!this.project) return;
    const t = this.time;
    const videoTracks = this.project.sequence.tracks.filter((tr) => tr.kind === 'video');
    // tracks are stored top-first; draw bottom-first so the top track wins
    for (let i = videoTracks.length - 1; i >= 0; i--) {
      const track = videoTracks[i];
      for (const clip of track.clips) {
        if (!this.isActive(track, clip, t)) continue;
        const el = this.elementFor(clip, track);
        if (!el || el instanceof HTMLAudioElement) continue;
        const sw = el instanceof HTMLVideoElement ? el.videoWidth : el.naturalWidth;
        const sh = el instanceof HTMLVideoElement ? el.videoHeight : el.naturalHeight;
        if (!sw || !sh) continue;
        const scale = Math.min(w / sw, h / sh);
        const dw = sw * scale;
        const dh = sh * scale;
        ctx.globalAlpha = clip.opacity ?? 1;
        try {
          ctx.drawImage(el, (w - dw) / 2, (h - dh) / 2, dw, dh);
        } catch {
          /* element not ready yet */
        }
        ctx.globalAlpha = 1;
      }
    }
  }

  private elementFor(clip: Clip, track: Track): MediaEl | null {
    const existing = this.elements.get(clip.id);
    if (existing) return existing;
    const asset = this.project?.assets.find((a) => a.id === clip.assetId);
    if (!asset || asset.offline) return null;
    const url = window.omega.media.urlFor(asset.path);
    let el: MediaEl;
    if (asset.kind === 'image') {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => this.render();
      img.src = url;
      el = img;
    } else if (track.kind === 'audio') {
      const audio = new Audio();
      audio.crossOrigin = 'anonymous';
      audio.preload = 'auto';
      audio.src = url;
      el = audio;
    } else {
      const video = document.createElement('video');
      video.crossOrigin = 'anonymous';
      video.preload = 'auto';
      video.muted = true;
      video.playsInline = true;
      video.src = url;
      video.addEventListener('seeked', () => {
        if (!this.playing) this.render();
      });
      video.addEventListener('loadeddata', () => {
        if (!this.playing) this.render();
      });
      el = video;
    }
    this.elements.set(clip.id, el);
    return el;
  }

  private collectGarbage() {
    const live = new Set<string>();
    if (this.project) for (const tr of this.project.sequence.tracks) for (const c of tr.clips) live.add(c.id);
    for (const [id, el] of this.elements) {
      if (!live.has(id)) {
        this.release(el);
        this.elements.delete(id);
      }
    }
  }

  private release(el: MediaEl) {
    if (el instanceof HTMLImageElement) {
      el.src = '';
      return;
    }
    el.pause();
    el.removeAttribute('src');
    el.load();
  }
}
