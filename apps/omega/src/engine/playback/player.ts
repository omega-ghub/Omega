// Program playback engine: the transport implementation behind
// engine/playback/transport.ts. OWNED BY THE VIEWER PACKAGE.
//
// * Master clock: the audio engine while sound plays at 1×, else wall time.
// * Every displayed frame: buildFrameGraph → Renderer.render with the preview
//   FrameProvider, then emitFrameRendered() for the scopes.
// * Playback resolution: Full / 1/2 / 1/4, or Auto (adapts to frame cost).
// * J/K/L shuttle up to 8× both ways; reverse steps frames on the clock.
// * Loop (in/out or whole sequence), play range, stop at the end.
// * The store's playhead follows at ~30 Hz; anyone may move it (timeline,
//   undo, sequence switch) and the player follows.

import { AudioEngine } from '../audio/engine';
import { Renderer, type RenderOptions } from '../gpu/Renderer';
import { buildFrameGraph, mediaRequests, type FrameGraph, type GraphItem, type LayerNode } from '../render/graph';
import { exactRate, fromFrames, snapToFrame, sourceTimeAt, toFrames } from '../time';
import { useEditor } from '../../state/store';
import type { Project, Sequence } from '../../state/types';
import { activeSequence, sequenceDuration } from '../../state/types';
import { applyRange, AutoScaler, droppedBetween, FpsMeter, lastFrameOf, loopRange, MasterClock, playStartTime, renderSize, type PlayRange } from './clock';
import { fitFactors } from './geometry';
import { PreviewFrames, type MediaRequest } from './preview';
import { setTransportImpl, type TransportImpl } from './transport';
import { emitFrameRendered, setProgramRenderer } from './viewerBus';

export interface PlayerStats {
  /** Measured displayed frames per second while playing. */
  fps: number;
  /** Frames dropped since playback started. */
  dropped: number;
  /** Effective playback scale (1, 0.5, 0.25). */
  scale: number;
  renderW: number;
  renderH: number;
  /** CPU cost of the last frame (ms). */
  renderMs: number;
  audioClock: boolean;
}

type Listener = () => void;
type ScrubbableAudio = AudioEngine & { scrub?: (t: number) => void };

/** The graph without some clips (e.g. the text layer being edited inline). */
export function withoutClips(graph: FrameGraph, hidden: ReadonlySet<string>): FrameGraph {
  if (!hidden.size) return graph;
  const keep = (n: LayerNode | null) => (n && hidden.has(n.clipId) ? null : n);
  const items: GraphItem[] = [];
  for (const it of graph.items) {
    if (it.type === 'layer') {
      if (!hidden.has(it.clipId)) items.push(it);
    } else items.push({ ...it, from: keep(it.from), to: keep(it.to) });
  }
  return { ...graph, items };
}

function hasAudio(seq: Sequence): boolean {
  return seq.tracks.some((tr) => (tr.kind === 'audio' && !tr.muted && tr.clips.some((c) => c.enabled)) || (tr.kind === 'video' && tr.clips.some((c) => c.kind === 'sequence' && c.enabled)));
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export class ProgramPlayer implements TransportImpl {
  /** Current timeline time (seconds). */
  time = 0;
  /** 0 = paused; otherwise the shuttle rate (negative = reverse). */
  rate = 0;
  /** Why the picture can't be shown (no WebGL2, renderer failure), or null. */
  error: string | null = null;
  /** Clips left out of the picture (the text layer being edited inline). */
  readonly hidden = new Set<string>();
  /** Render the background transparent (checkerboard behind the canvas). */
  transparentBackground = false;

  private readonly clock = new MasterClock(() => performance.now());
  private readonly frames = new PreviewFrames(() => this.invalidate());
  private readonly auto = new AutoScaler();
  private readonly fpsMeter = new FpsMeter();
  private canvas: HTMLCanvasElement | null = null;
  private renderer: Renderer | null = null;
  private disposeTimer: number | null = null;
  private raf = 0;
  private pausedRaf = 0;
  private dirty = false;
  private display = { w: 0, h: 0 };
  private size = { w: 0, h: 0 };
  private once: (PlayRange & { returnTo: number | null }) | null = null;
  private audioToken = 0;
  private lastFrameIdx: number | null = null;
  private dropped = 0;
  private renderMs = 0;
  private lastPlayheadWrite = 0;
  private writing = false;
  private lastLookahead = 0;
  private lastSeekAt = 0;
  private renderFailures = 0;
  private lastStatsEmit = 0;
  private warnedAudioClock = false;
  private readonly timeListeners = new Set<Listener>();
  private readonly stateListeners = new Set<Listener>();

  constructor() {
    const s = useEditor.getState();
    this.time = s.playhead;
    useEditor.subscribe((next, prev) => this.onStore(next, prev));
  }

  // ---- canvas ---------------------------------------------------------------

  /** Shows the program on this canvas (creates the WebGL2 renderer). */
  attach(canvas: HTMLCanvasElement): void {
    if (this.disposeTimer !== null && this.canvas === canvas) {
      clearTimeout(this.disposeTimer);
      this.disposeTimer = null;
      return;
    }
    if (this.canvas && this.canvas !== canvas) this.disposeRenderer();
    this.canvas = canvas;
    canvas.addEventListener('webglcontextlost', this.onContextLost);
    canvas.addEventListener('webglcontextrestored', this.onContextRestored);
    this.createRenderer();
  }

  detach(canvas: HTMLCanvasElement): void {
    if (this.canvas !== canvas) return;
    if (this.disposeTimer !== null) clearTimeout(this.disposeTimer);
    this.disposeTimer = window.setTimeout(() => {
      this.disposeTimer = null;
      if (this.canvas !== canvas) return;
      this.disposeRenderer();
    }, 0);
  }

  /** The visible size of the canvas in device pixels (caps the render size). */
  setDisplaySize(w: number, h: number): void {
    if (Math.abs(w - this.display.w) < 1 && Math.abs(h - this.display.h) < 1) return;
    this.display = { w, h };
    this.invalidate();
  }

  get hasCanvas(): boolean {
    return this.canvas !== null;
  }

  private createRenderer(): void {
    const canvas = this.canvas;
    if (!canvas) return;
    this.error = null;
    this.renderFailures = 0;
    this.size = { w: 0, h: 0 };
    try {
      if (!Renderer.isSupported()) throw new Error('WebGL2 is not available on this system.');
      this.renderer = new Renderer(canvas);
      setProgramRenderer(this.renderer);
    } catch (e) {
      this.renderer = null;
      setProgramRenderer(null);
      this.error = errorMessage(e);
    }
    this.emitState();
    this.invalidate();
  }

  private disposeRenderer(): void {
    const canvas = this.canvas;
    if (canvas) {
      canvas.removeEventListener('webglcontextlost', this.onContextLost);
      canvas.removeEventListener('webglcontextrestored', this.onContextRestored);
    }
    try {
      this.renderer?.dispose();
    } catch {
      /* ignore */
    }
    this.renderer = null;
    this.canvas = null;
    setProgramRenderer(null);
  }

  private onContextLost = (e: Event) => {
    e.preventDefault();
    this.renderer = null;
    setProgramRenderer(null);
    this.error = 'The GPU context was lost. Restoring…';
    this.emitState();
  };

  private onContextRestored = () => {
    this.createRenderer();
  };

  // ---- listeners ------------------------------------------------------------

  /** Called on every displayed frame (time changes). */
  onTime(cb: Listener): () => void {
    this.timeListeners.add(cb);
    return () => this.timeListeners.delete(cb);
  }

  /** Called when playing state, errors or stats change (stats at most ~4 Hz). */
  onState(cb: Listener): () => void {
    this.stateListeners.add(cb);
    return () => this.stateListeners.delete(cb);
  }

  stats(): PlayerStats {
    const s = useEditor.getState().viewer.playbackScale;
    return {
      fps: this.rate !== 0 ? this.fpsMeter.fps(performance.now()) : 0,
      dropped: this.dropped,
      scale: s === 'auto' ? (this.rate !== 0 ? this.auto.scale : 1) : s,
      renderW: this.size.w,
      renderH: this.size.h,
      renderMs: this.renderMs,
      audioClock: this.clock.usingAudio,
    };
  }

  resetDropped(): void {
    this.dropped = 0;
    this.emitState();
  }

  /** Diagnostics (tests, support): mean luma 0..255 and coverage of the last rendered frame. */
  probe(): { mean: number; nonBlack: number; width: number; height: number } | null {
    if (!this.renderer) return null;
    try {
      const px = this.renderer.readPixels(160);
      let sum = 0;
      let lit = 0;
      const n = px.width * px.height;
      for (let i = 0; i < n; i++) {
        const y = 0.2126 * px.data[i * 4] + 0.7152 * px.data[i * 4 + 1] + 0.0722 * px.data[i * 4 + 2];
        sum += y;
        if (y > 12) lit++;
      }
      return { mean: n ? sum / n : 0, nonBlack: n ? lit / n : 0, width: px.width, height: px.height };
    } catch {
      return null;
    }
  }

  private emitTime(): void {
    for (const l of this.timeListeners) l();
  }

  private emitState(): void {
    for (const l of this.stateListeners) l();
  }

  // ---- transport ------------------------------------------------------------

  play(): void {
    if (this.rate === 1) return;
    this.shuttle(1);
  }

  pause(): void {
    if (this.rate === 0) return;
    const seq = this.sequence();
    const t = this.clock.time();
    this.halt();
    if (seq) this.time = snapToFrame(Math.max(0, Math.min(t, sequenceDuration(seq))), seq.fps);
    this.lastFrameIdx = null;
    this.writePlayhead(this.time, true);
    this.invalidate();
    this.emitTime();
  }

  toggle(): void {
    if (this.rate !== 0) this.pause();
    else this.play();
  }

  isPlaying(): boolean {
    return this.rate !== 0;
  }

  seek(t: number): void {
    const seq = this.sequence();
    if (!seq) return;
    const dur = sequenceDuration(seq);
    t = snapToFrame(Math.max(0, Math.min(Number.isFinite(t) ? t : 0, dur)), seq.fps);
    const now = performance.now();
    const rapid = now - this.lastSeekAt < 160;
    this.lastSeekAt = now;
    this.time = t;
    this.lastFrameIdx = null;
    if (this.rate !== 0) {
      this.startClock(t, this.rate);
      this.dirty = true;
    } else {
      this.invalidate();
      if (rapid) this.scrubAudio(t);
    }
    this.writePlayhead(t, true);
    this.emitTime();
  }

  /** Seek that also plays a grain of audio (dragging a scrub bar). */
  scrub(t: number): void {
    this.seek(t);
    if (this.rate === 0) this.scrubAudio(this.time);
  }

  step(frames: number): void {
    const seq = this.sequence();
    if (!seq) return;
    if (this.rate !== 0) this.pause();
    this.seek(this.time + fromFrames(Math.round(frames), seq.fps));
    this.scrubAudio(this.time);
  }

  shuttle(rate: number): void {
    this.once = null;
    this.start(rate);
  }

  playRange(from: number, to: number, returnTo: number | null = null): void {
    const seq = this.sequence();
    if (!seq) return;
    const dur = sequenceDuration(seq);
    const start = snapToFrame(Math.max(0, Math.min(from, dur)), seq.fps);
    const end = Math.max(start, Math.min(to, dur));
    if (end - start < fromFrames(1, seq.fps)) return;
    if (this.rate !== 0) this.halt();
    this.time = start;
    this.writePlayhead(start, true);
    this.once = { start, end, returnTo };
    this.start(1);
  }

  /** Premiere's play-around: two seconds either side, then back to where you were. */
  playAround(preroll = 2, postroll = 2): void {
    const t = this.time;
    this.playRange(Math.max(0, t - preroll), t + postroll, t);
  }

  playInToOut(): void {
    const seq = this.sequence();
    if (!seq) return;
    const r = loopRange(seq, sequenceDuration(seq));
    this.playRange(r.start, r.end);
  }

  private start(rate: number): void {
    if (rate === 0 || !Number.isFinite(rate)) {
      this.pause();
      return;
    }
    const s = useEditor.getState();
    const seq = this.sequence();
    if (!s.project || !seq) return;
    const duration = sequenceDuration(seq);
    if (duration <= 0) return;
    rate = Math.max(-16, Math.min(16, rate));
    const wasPlaying = this.rate !== 0;
    let t = wasPlaying ? this.clock.time() : this.time;
    if (!wasPlaying) {
      t = playStartTime(t, this.range(seq, duration), seq.fps, rate);
      this.time = t;
      this.dropped = 0;
      this.fpsMeter.reset();
      this.auto.reset();
      this.lastFrameIdx = null;
    }
    this.rate = rate;
    this.startClock(t, rate);
    s.setPlaying(true);
    s.setShuttleRate(rate);
    this.dirty = true;
    if (this.pausedRaf) {
      cancelAnimationFrame(this.pausedRaf);
      this.pausedRaf = 0;
    }
    if (!this.raf) this.raf = requestAnimationFrame(this.tick);
    this.emitState();
  }

  /** Stops the clock, audio, elements and the loop; leaves `time` alone. */
  private halt(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.clock.stop();
    this.stopAudio();
    this.rate = 0;
    this.once = null;
    this.frames.pauseAll();
    const s = useEditor.getState();
    if (s.playing) s.setPlaying(false);
    if (s.shuttleRate !== 0) s.setShuttleRate(0);
    this.emitState();
  }

  private range(seq: Sequence, duration: number): PlayRange {
    if (this.once) return this.once;
    return useEditor.getState().viewer.loop ? loopRange(seq, duration) : { start: 0, end: duration };
  }

  // ---- clock & audio ------------------------------------------------------------

  private startClock(t: number, rate: number): void {
    const token = ++this.audioToken;
    const engine = AudioEngine.get();
    const project = useEditor.getState().project;
    const seq = this.sequence();
    if (rate === 1 && project && seq && hasAudio(seq)) {
      this.clock.startHeld(t);
      let settled = false;
      const fallback = window.setTimeout(() => {
        if (token === this.audioToken && !settled) this.clock.fallbackToWall();
      }, 600);
      void (async () => {
        try {
          if (engine.playing) engine.stop();
          engine.setProject(project, seq.id);
          await engine.play(t, 1);
          settled = true;
          clearTimeout(fallback);
          if (token === this.audioToken) this.clock.attachAudio(() => engine.currentTime());
          else if (this.rate === 0 && engine.playing) engine.stop(); // paused while the audio was starting
        } catch (e) {
          settled = true;
          clearTimeout(fallback);
          console.warn('[viewer] audio playback failed; using the wall clock', e);
          if (token === this.audioToken) this.clock.fallbackToWall();
        }
      })();
    } else {
      // Above 1× (and in reverse) the audio is muted.
      this.stopAudio(false);
      this.clock.startWall(t, rate);
    }
  }

  private stopAudio(bump = true): void {
    if (bump) this.audioToken++;
    try {
      const engine = AudioEngine.get();
      if (engine.playing) engine.stop();
    } catch {
      /* ignore */
    }
  }

  private scrubAudio(t: number): void {
    try {
      const engine = AudioEngine.get() as ScrubbableAudio;
      if (typeof engine.scrub === 'function') engine.scrub(t);
    } catch {
      /* optional */
    }
  }

  // ---- loop ---------------------------------------------------------------------

  private tick = () => {
    this.raf = 0;
    if (this.rate === 0) return;
    const s = useEditor.getState();
    const project = s.project;
    const seq = this.sequence();
    if (!project || !seq) {
      this.halt();
      return;
    }
    const duration = sequenceDuration(seq);
    const loop = !this.once && s.viewer.loop;
    const range = this.range(seq, duration);
    let t = this.clock.time();
    if (this.clock.rejectedAudio && !this.warnedAudioClock) {
      this.warnedAudioClock = true;
      console.warn(`[viewer] the audio clock disagrees with wall time (${this.clock.rejectedAudio}); video follows wall time`);
    }
    const res = applyRange(t, this.rate, range, loop, seq.fps);
    if (res.event === 'ended') {
      this.finish(seq, range);
      return;
    }
    if (res.event === 'wrapped') {
      t = res.t;
      this.startClock(t, this.rate);
      this.lastFrameIdx = null;
    }
    this.time = Math.max(0, Math.min(t, duration));
    const now = performance.now();
    const fi = toFrames(this.time, seq.fps);
    if (fi !== this.lastFrameIdx || this.dirty) {
      const skipped = droppedBetween(this.lastFrameIdx, fi, this.rate);
      const missing = this.renderFrame(this.time, true);
      const lost = skipped + (missing > 0 && !this.clock.isHolding ? 1 : 0);
      this.dropped += lost;
      if (fi !== this.lastFrameIdx) this.fpsMeter.tick(now);
      if (s.viewer.playbackScale === 'auto') {
        const budget = Math.max(16, 1000 / (exactRate(seq.fps) * Math.max(1, Math.abs(this.rate))));
        this.auto.sample(this.renderMs, lost > 0, budget, now);
      }
      this.lastFrameIdx = fi;
      this.dirty = false;
      this.emitTime();
    }
    if (now - this.lastLookahead > 250) {
      this.lastLookahead = now;
      this.lookahead(project, seq, this.time);
      this.frames.sweep(now);
    }
    this.writePlayhead(this.time, false);
    if (now - this.lastStatsEmit > 250) {
      this.lastStatsEmit = now;
      this.emitState();
    }
    this.raf = requestAnimationFrame(this.tick);
  };

  private finish(seq: Sequence, range: PlayRange): void {
    const once = this.once;
    const rate = this.rate;
    this.halt();
    let t = rate > 0 ? lastFrameOf(range, seq.fps) : range.start;
    if (once && once.returnTo !== null) t = once.returnTo;
    this.time = t;
    this.lastFrameIdx = null;
    this.writePlayhead(t, true);
    this.invalidate();
    this.emitTime();
  }

  /** Re-renders the current frame (paused), or marks the next tick dirty (playing). */
  invalidate(): void {
    if (this.rate !== 0) {
      this.dirty = true;
      return;
    }
    if (this.pausedRaf) return;
    this.pausedRaf = requestAnimationFrame(() => {
      this.pausedRaf = 0;
      if (this.rate !== 0) return;
      this.renderFrame(this.time, false);
      this.frames.sweep(performance.now());
    });
  }

  // ---- rendering ----------------------------------------------------------------

  /** Builds and renders one frame. Returns how many media layers had no picture. */
  private renderFrame(t: number, playing: boolean): number {
    const s = useEditor.getState();
    const project = s.project;
    if (!project) return 0;
    const seq = activeSequence(project);
    this.frames.setProject(project, s.viewer.useProxies);
    const opts = { formatId: seq.activeFormatId };
    let graph: FrameGraph;
    try {
      graph = buildFrameGraph(project, seq.id, t, opts);
    } catch (e) {
      console.error('[viewer] could not build the frame', e);
      return 0;
    }
    graph = withoutClips(graph, this.hidden);
    if (this.transparentBackground) graph = { ...graph, background: '#00000000' };
    const renderer = this.renderer;
    if (!renderer) return 0;
    const reqs = mediaRequests(graph);
    const playScale = s.viewer.playbackScale;
    const scale = playScale === 'auto' ? (playing ? this.auto.scale : 1) : playScale;
    const { w, h } = renderSize(graph.width, graph.height, this.display.w, this.display.h, scale);
    const now = performance.now();
    this.frames.prepare(reqs, {
      playing,
      velocity: playing ? this.velocities(project, seq, t, reqs, opts) : undefined,
      maxWidth: playing ? undefined : decodeWidths(graph, w),
      now,
    });
    if (w !== this.size.w || h !== this.size.h) {
      try {
        renderer.setSize(w, h);
      } catch (e) {
        console.error('[viewer] resize failed', e);
      }
      this.size = { w, h };
    }
    const selected = s.selection.clipIds.find((id) => seq.tracks.some((tr) => tr.kind === 'video' && tr.clips.some((c) => c.id === id)));
    const ropts: RenderOptions = {
      compare: { mode: s.viewer.compare, position: s.viewer.comparePosition },
      matteClipId: s.viewer.showMatte ? (selected ?? null) : null,
    };
    this.frames.missing = 0;
    const t0 = performance.now();
    try {
      renderer.render(graph, this.frames, ropts);
      if (this.renderFailures > 0 || this.error) {
        this.renderFailures = 0;
        if (this.error && this.renderer) {
          this.error = null;
          this.emitState();
        }
      }
    } catch (e) {
      this.renderFailures++;
      if (this.renderFailures === 1) console.error('[viewer] render failed', e);
      if (this.renderFailures >= 3 && !this.error) {
        this.error = `The renderer failed: ${errorMessage(e)}`;
        this.emitState();
      }
      return 0;
    }
    this.renderMs = performance.now() - t0;
    emitFrameRendered();
    return this.frames.missing;
  }

  /** Source velocity of each media layer (source seconds per wall second), from a second graph one frame later. */
  private velocities(project: Project, seq: Sequence, t: number, reqs: MediaRequest[], opts: { formatId: string | null }): Map<string, number> {
    const out = new Map<string, number>();
    if (!reqs.length) return out;
    const h = fromFrames(1, seq.fps) * (this.rate < 0 ? -1 : 1);
    let next: Map<string, number>;
    try {
      next = new Map(mediaRequests(buildFrameGraph(project, seq.id, t + h, opts)).map((r) => [r.clipId, r.sourceTime]));
    } catch {
      next = new Map();
    }
    for (const r of reqs) {
      const s2 = next.get(r.clipId);
      out.set(r.clipId, s2 === undefined ? this.rate : ((s2 - r.sourceTime) / h) * this.rate);
    }
    return out;
  }

  /** Creates elements ~2 s ahead and pre-rolls them to where their clips start. */
  private lookahead(project: Project, seq: Sequence, t: number): void {
    if (this.rate <= 0) return;
    const duration = sequenceDuration(seq);
    const opts = { formatId: seq.activeFormatId };
    const top = new Map(seq.tracks.flatMap((tr) => tr.clips.map((c) => [c.id, c] as const)));
    const reqs: MediaRequest[] = [];
    for (const dt of [0.5, 1, 2]) {
      const tt = t + dt * this.rate;
      if (tt > duration) break;
      try {
        for (const r of mediaRequests(buildFrameGraph(project, seq.id, tt, opts))) {
          const clip = top.get(r.clipId);
          reqs.push(clip && clip.start > t ? { ...r, sourceTime: sourceTimeAt(clip, 0) } : r);
        }
      } catch {
        /* ignore */
      }
    }
    if (reqs.length) this.frames.prefetch(reqs, performance.now());
  }

  // ---- store -----------------------------------------------------------------

  private sequence(): Sequence | null {
    const p = useEditor.getState().project;
    return p ? activeSequence(p) : null;
  }

  private writePlayhead(t: number, force: boolean): void {
    const now = performance.now();
    if (!force && now - this.lastPlayheadWrite < 33) return;
    this.lastPlayheadWrite = now;
    this.writing = true;
    try {
      useEditor.getState().setPlayhead(t);
    } finally {
      this.writing = false;
    }
  }

  private onStore(s: ReturnType<typeof useEditor.getState>, prev: ReturnType<typeof useEditor.getState>): void {
    if (this.writing) return;
    if (s.project !== prev.project) {
      if (!s.project) {
        if (this.rate !== 0) this.halt();
        this.frames.dispose();
        return;
      }
      if (s.project.activeSequenceId !== prev.project?.activeSequenceId) {
        if (this.rate !== 0) this.halt();
        this.time = s.playhead;
        this.lastFrameIdx = null;
      } else if (this.rate !== 0 && this.clock.usingAudio) {
        try {
          AudioEngine.get().setProject(s.project, s.project.activeSequenceId);
        } catch {
          /* ignore */
        }
      }
      this.invalidate();
    }
    if (s.playhead !== prev.playhead && Math.abs(s.playhead - this.time) > 1e-6) this.seek(s.playhead);
    if (s.viewer !== prev.viewer) this.invalidate();
    if (s.selection.clipIds !== prev.selection.clipIds && s.viewer.showMatte) this.invalidate();
  }
}

/** Decode width per clip for exact paused frames: as many pixels as the layer covers on screen. */
function decodeWidths(graph: FrameGraph, renderW: number): Map<string, number> {
  const out = new Map<string, number>();
  const visit = (n: LayerNode | null, k: number, W: number, H: number) => {
    if (!n?.source) return;
    const src = n.source;
    if (src.kind !== 'media' && src.kind !== 'sequence') return;
    const { fx } = fitFactors(n.transform.fit, src.width, src.height, W, H);
    const shown = src.width * fx * Math.abs(n.transform.scale * n.transform.scaleX) * k;
    if (src.kind === 'media') out.set(n.clipId, Math.max(16, Math.min(src.width, Math.ceil(shown))));
    else for (const it of src.graph.items) walk(it, shown / Math.max(1, src.graph.width), src.graph.width, src.graph.height);
  };
  const walk = (it: GraphItem, k: number, W: number, H: number) => {
    if (it.type === 'layer') visit(it, k, W, H);
    else {
      visit(it.from, k, W, H);
      visit(it.to, k, W, H);
    }
  };
  for (const it of graph.items) walk(it, renderW / Math.max(1, graph.width), graph.width, graph.height);
  return out;
}

// ---------------------------------------------------------------------------
// Singleton + transport installation
// ---------------------------------------------------------------------------

let instance: ProgramPlayer | null = null;

export function getPlayer(): ProgramPlayer {
  if (!instance) {
    instance = new ProgramPlayer();
    if (typeof window !== 'undefined') (window as unknown as { __deltaPlayer?: ProgramPlayer }).__deltaPlayer = instance;
  }
  return instance;
}

/** Makes the program player the implementation behind `transport`. */
export function installTransport(): void {
  setTransportImpl(getPlayer());
}
