// Web Audio graph builder shared by realtime playback (AudioContext) and the
// offline mixdown (OfflineAudioContext). Everything audible is scheduled from
// a MixPlan (plan.ts), so preview and export are the same graph:
//
//   clip:   BufferSource → upmix → [channel routing] → [EQ ×5] → [compressor + makeup]
//           → clip gain (dB + 'audio.gain' keys) → envelope (fades, crossfades)
//           → guard (micro fades for late joins/stops) → StereoPanner ('audio.pan')
//   track:  sum → volume (dB, mute/solo) → StereoPanner → [meter]
//   master: sum → gain (dB) → true-peak limiter (AudioWorklet; compressor fallback) → [meters] → out

import limiterUrl from './limiter.worklet.ts?worker&url';
import type { Sequence } from '../../state/types';
import { clamp, dbToGain, eqBands, gainToDb, webAudioCompressorMakeup } from './dsp';
import { limiterLatencyFrames } from './limiterCore';
import { automation, envAt, gainAt, knots, panAt, rateAt, sourceAt, type ClipPlan, type TrackPlan } from './plan';

export interface Meter {
  /** dBFS, -Infinity when silent */
  peakL: number;
  peakR: number;
  rmsL: number;
  rmsR: number;
}

export const SILENT_METER: Meter = { peakL: -Infinity, peakR: -Infinity, rmsL: -Infinity, rmsR: -Infinity };

// ---------------------------------------------------------------------------
// Limiter worklet loading
// ---------------------------------------------------------------------------

const worklets = new WeakMap<BaseAudioContext, Promise<boolean>>();

export function loadLimiter(ctx: BaseAudioContext): Promise<boolean> {
  let p = worklets.get(ctx);
  if (!p) {
    p = ctx.audioWorklet
      ? ctx.audioWorklet.addModule(limiterUrl).then(
          () => true,
          (err) => {
            console.warn('Limiter worklet unavailable, using the compressor fallback', err);
            return false;
          },
        )
      : Promise.resolve(false);
    worklets.set(ctx, p);
  }
  return p;
}

// ---------------------------------------------------------------------------
// Compressor makeup calibration (does this browser apply automatic makeup?)
// ---------------------------------------------------------------------------

let autoMakeup: boolean | null = null;
let autoMakeupProbe: Promise<boolean> | null = null;

export function detectCompressorMakeup(): Promise<boolean> {
  if (autoMakeup !== null) return Promise.resolve(autoMakeup);
  autoMakeupProbe ??= (async () => {
    try {
      const sr = 48000;
      const ctx = new OfflineAudioContext(1, sr / 4, sr);
      const osc = ctx.createOscillator();
      osc.frequency.value = 1000;
      const g = ctx.createGain();
      g.gain.value = 0.01; // −40 dBFS, far below the threshold
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -20;
      comp.knee.value = 0;
      comp.ratio.value = 4;
      osc.connect(g).connect(comp).connect(ctx.destination);
      osc.start();
      const out = (await ctx.startRendering()).getChannelData(0);
      let s = 0;
      for (let i = out.length / 2; i < out.length; i++) s += out[i] * out[i];
      const level = Math.sqrt(s / (out.length / 2)) * Math.SQRT2;
      autoMakeup = level > 0.01 * 1.25;
    } catch {
      autoMakeup = true;
    }
    return autoMakeup;
  })();
  return autoMakeupProbe;
}

function makeupFactor(threshold: number, knee: number, ratio: number): number {
  return autoMakeup === false ? 1 : webAudioCompressorMakeup(threshold, knee, ratio);
}

// ---------------------------------------------------------------------------
// Meters
// ---------------------------------------------------------------------------

export interface StereoMeter {
  read(): Meter;
  dispose(): void;
}

export function createMeter(ctx: BaseAudioContext, from: AudioNode): StereoMeter {
  const split = ctx.createChannelSplitter(2);
  const a = ctx.createAnalyser();
  const b = ctx.createAnalyser();
  a.fftSize = b.fftSize = 2048;
  from.connect(split);
  split.connect(a, 0);
  split.connect(b, 1);
  const buf = new Float32Array(2048);
  const measure = (an: AnalyserNode): [number, number] => {
    an.getFloatTimeDomainData(buf);
    let pk = 0;
    let s = 0;
    for (let i = 0; i < buf.length; i++) {
      const v = buf[i];
      const av = v < 0 ? -v : v;
      if (av > pk) pk = av;
      s += v * v;
    }
    return [gainToDb(pk), gainToDb(Math.sqrt(s / buf.length))];
  };
  return {
    read() {
      const [peakL, rmsL] = measure(a);
      const [peakR, rmsR] = measure(b);
      return { peakL, peakR, rmsL, rmsR };
    },
    dispose() {
      try {
        from.disconnect(split);
      } catch {
        /* already gone */
      }
      split.disconnect();
    },
  };
}

// ---------------------------------------------------------------------------
// Master bus
// ---------------------------------------------------------------------------

export interface MasterBus {
  input: GainNode;
  /** Seconds of delay the limiter adds (0 without the worklet). */
  latency: number;
  latencyFrames: number;
  limiterKind: 'worklet' | 'compressor' | 'none';
  meter: StereoMeter | null;
  /** Meter before the limiter (gain reduction = pre − post). */
  preMeter: StereoMeter | null;
  update(master: Sequence['master'], at: number): void;
  dispose(): void;
}

export async function createMaster(
  ctx: BaseAudioContext,
  master: Sequence['master'],
  opts: { meters: boolean; destination?: AudioNode; alwaysLimiter: boolean },
): Promise<MasterBus> {
  const input = ctx.createGain();
  input.channelCount = 2;
  input.channelCountMode = 'explicit';
  input.channelInterpretation = 'speakers';
  const gain = ctx.createGain();
  gain.gain.value = dbToGain(master.gain);
  input.connect(gain);
  let tail: AudioNode = gain;
  let limiterKind: MasterBus['limiterKind'] = 'none';
  let latencyFrames = 0;
  let worklet: AudioWorkletNode | null = null;
  let comp: DynamicsCompressorNode | null = null;
  let compTrim: GainNode | null = null;
  const preMeter = opts.meters ? createMeter(ctx, gain) : null;

  if (opts.alwaysLimiter || master.limiter) {
    if (await loadLimiter(ctx)) {
      worklet = new AudioWorkletNode(ctx, 'omega-limiter', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        channelCount: 2,
        channelCountMode: 'explicit',
        channelInterpretation: 'speakers',
        parameterData: { ceiling: clamp(master.ceiling, -60, 0), enabled: master.limiter ? 1 : 0 },
      });
      tail.connect(worklet);
      tail = worklet;
      limiterKind = 'worklet';
      latencyFrames = limiterLatencyFrames(ctx.sampleRate);
    } else {
      // Fallback: a hard-knee, fast compressor (not a true-peak brickwall).
      comp = ctx.createDynamicsCompressor();
      compTrim = ctx.createGain();
      tail.connect(comp).connect(compTrim);
      tail = compTrim;
      limiterKind = 'compressor';
    }
  }
  const applyComp = (m: Sequence['master']) => {
    if (!comp || !compTrim) return;
    const on = m.limiter;
    comp.threshold.value = on ? clamp(m.ceiling, -60, 0) : 0;
    comp.knee.value = 0;
    comp.ratio.value = on ? 20 : 1;
    comp.attack.value = 0;
    comp.release.value = 0.08;
    compTrim.gain.value = on ? 1 / makeupFactor(comp.threshold.value, 0, 20) : 1;
  };
  applyComp(master);

  const out = opts.destination ?? ctx.destination;
  tail.connect(out);
  const meter = opts.meters ? createMeter(ctx, tail) : null;

  return {
    input,
    latency: latencyFrames / ctx.sampleRate,
    latencyFrames,
    limiterKind,
    meter,
    preMeter,
    update(m, at) {
      gain.gain.setTargetAtTime(dbToGain(m.gain), at, 0.012);
      if (worklet) {
        worklet.parameters.get('ceiling')?.setValueAtTime(clamp(m.ceiling, -60, 0), at);
        worklet.parameters.get('enabled')?.setValueAtTime(m.limiter ? 1 : 0, at);
      }
      applyComp(m);
    },
    dispose() {
      meter?.dispose();
      preMeter?.dispose();
      for (const n of [input, gain, worklet, comp, compTrim]) n?.disconnect();
    },
  };
}

// ---------------------------------------------------------------------------
// Track buses
// ---------------------------------------------------------------------------

export interface TrackBus {
  id: string;
  input: GainNode;
  meter: StereoMeter | null;
  update(tp: TrackPlan, at: number): void;
  dispose(): void;
}

export function createTrackBus(ctx: BaseAudioContext, tp: TrackPlan, dest: AudioNode, meters: boolean): TrackBus {
  const input = ctx.createGain();
  input.channelCount = 2;
  input.channelCountMode = 'explicit';
  input.channelInterpretation = 'speakers';
  const volume = ctx.createGain();
  volume.gain.value = tp.audible ? dbToGain(tp.volumeDb) : 0;
  const pan = ctx.createStereoPanner();
  pan.pan.value = tp.pan;
  input.connect(volume).connect(pan).connect(dest);
  const meter = meters ? createMeter(ctx, pan) : null;
  return {
    id: tp.id,
    input,
    meter,
    update(next, at) {
      volume.gain.setTargetAtTime(next.audible ? dbToGain(next.volumeDb) : 0, at, 0.012);
      pan.pan.setTargetAtTime(next.pan, at, 0.012);
    },
    dispose() {
      meter?.dispose();
      input.disconnect();
      volume.disconnect();
      pan.disconnect();
    },
  };
}

// ---------------------------------------------------------------------------
// Clips
// ---------------------------------------------------------------------------

/** Timeline ↔ context time: ctxTime = ctx0 + (t − tl0). */
export interface TimeMap {
  tl0: number;
  ctx0: number;
}

export interface SourceBuffer {
  buffer: AudioBuffer;
  /** Source seconds at frame 0 (of the forward buffer). */
  start: number;
  /** Source seconds at the end of the forward buffer. */
  end: number;
  reversed: boolean;
}

export interface ScheduleOptions {
  /** Seconds of fade-in at the start of this scheduling (late joins, scrub). */
  guardIn?: number;
  /** Seconds of fade-out at the end (scrub snippets). */
  guardOut?: number;
}

export interface ScheduledClip {
  id: string;
  trackId: string;
  sig: string;
  /** Timeline time at which it stops. */
  end: number;
  update(cp: ClipPlan, at: number): void;
  /** Fades out quickly and stops at context time `at`. */
  stop(at: number): void;
  onEnded(cb: () => void): void;
}

function scheduleParam(param: AudioParam, pts: number[], map: TimeMap, lo = -Infinity, hi = Infinity) {
  if (pts.length < 2) return;
  const at = (t: number) => map.ctx0 + (t - map.tl0);
  param.setValueAtTime(clamp(pts[1], lo, hi), at(pts[0]));
  for (let i = 2; i < pts.length; i += 2) {
    const v = clamp(pts[i + 1], lo, hi);
    if (pts[i] === pts[i - 2]) param.setValueAtTime(v, at(pts[i]));
    else param.linearRampToValueAtTime(v, at(pts[i]));
  }
}

function stereoGain(ctx: BaseAudioContext, channels: 1 | 2): GainNode {
  const g = ctx.createGain();
  g.channelCount = channels;
  g.channelCountMode = 'explicit';
  g.channelInterpretation = 'speakers';
  return g;
}

/**
 * Schedules one clip for timeline times [from, to) (clamped to its sounding
 * region) into `dest`. Returns null when nothing would sound.
 */
export function scheduleClip(
  ctx: BaseAudioContext,
  cp: ClipPlan,
  src: SourceBuffer,
  dest: AudioNode,
  map: TimeMap,
  from: number,
  to: number,
  opts: ScheduleOptions = {},
): ScheduledClip | null {
  const a = Math.max(cp.t0, from);
  const b = Math.min(cp.t1, to);
  if (b - a < 1 / ctx.sampleRate) return null;
  const at = (t: number) => map.ctx0 + (t - map.tl0);
  const node = ctx.createBufferSource();
  node.buffer = src.buffer;
  const s = sourceAt(cp, a);
  let offset = src.reversed ? src.end - s : s - src.start;
  let startTime = at(a);
  const r0 = rateAt(cp, a);
  if (offset < 0) {
    if (r0 <= 0) return null;
    startTime += -offset / r0;
    offset = 0;
  }
  const stopTime = at(b);
  if (offset >= src.buffer.duration || startTime >= stopTime) return null;
  if (cp.ramp) scheduleParam(node.playbackRate, automation((t) => rateAt(cp, t), a, b, knots(cp, ['time.speed']), 0.01), map, 0, 100);
  else node.playbackRate.value = cp.speed;

  const nodes: AudioNode[] = [node];
  const pre = stereoGain(ctx, 2);
  nodes.push(pre);
  node.connect(pre);
  let tail: AudioNode = pre;

  // channel routing (stereo sources only)
  const audio = cp.clip.audio;
  if (src.buffer.numberOfChannels >= 2 && audio.channelMode !== 'stereo') {
    if (audio.channelMode === 'mono') {
      const down = stereoGain(ctx, 1);
      const up = stereoGain(ctx, 2);
      tail.connect(down).connect(up);
      nodes.push(down, up);
      tail = up;
    } else {
      const split = ctx.createChannelSplitter(2);
      const merge = ctx.createChannelMerger(2);
      tail.connect(split);
      const route: [number, number][] =
        audio.channelMode === 'left'
          ? [
              [0, 0],
              [0, 1],
            ]
          : audio.channelMode === 'right'
            ? [
                [1, 0],
                [1, 1],
              ]
            : [
                [0, 1],
                [1, 0],
              ];
      for (const [o, i] of route) split.connect(merge, o, i);
      nodes.push(split, merge);
      tail = merge;
    }
  }

  // EQ
  const eqNodes: BiquadFilterNode[] = [];
  if (audio.eq.enabled) {
    for (const band of eqBands(audio.eq)) {
      const f = ctx.createBiquadFilter();
      f.type = band.type;
      f.frequency.value = clamp(band.frequency, 10, ctx.sampleRate / 2);
      f.Q.value = band.Q;
      f.gain.value = band.gain;
      tail.connect(f);
      tail = f;
      eqNodes.push(f);
      nodes.push(f);
    }
  }

  // Compressor
  let comp: DynamicsCompressorNode | null = null;
  let makeup: GainNode | null = null;
  const applyComp = (c: typeof audio.comp) => {
    if (!comp || !makeup) return;
    comp.threshold.value = clamp(c.threshold, -100, 0);
    comp.knee.value = clamp(c.knee, 0, 40);
    comp.ratio.value = clamp(c.ratio, 1, 20);
    comp.attack.value = clamp(c.attack, 0, 1);
    comp.release.value = clamp(c.release, 0, 1);
    makeup.gain.value = dbToGain(c.makeup) / makeupFactor(comp.threshold.value, comp.knee.value, comp.ratio.value);
  };
  if (audio.comp.enabled) {
    comp = ctx.createDynamicsCompressor();
    makeup = ctx.createGain();
    tail.connect(comp).connect(makeup);
    tail = makeup;
    nodes.push(comp, makeup);
    applyComp(audio.comp);
  }

  const gain = ctx.createGain();
  const env = ctx.createGain();
  const guard = ctx.createGain();
  const pan = ctx.createStereoPanner();
  tail.connect(gain).connect(env).connect(guard).connect(pan).connect(dest);
  nodes.push(gain, env, guard, pan);

  const gainKeyed = !!cp.clip.keyframes['audio.gain']?.length;
  const panKeyed = !!cp.clip.keyframes['audio.pan']?.length;
  if (gainKeyed) scheduleParam(gain.gain, automation((t) => gainAt(cp, t), a, b, knots(cp, ['audio.gain']), 0.01), map, 0, 1000);
  else gain.gain.value = gainAt(cp, a);
  if (cp.fades.length) scheduleParam(env.gain, automation((t) => envAt(cp, t), a, b, knots(cp, []), 0.005), map, 0, 1);
  else env.gain.value = 1;
  if (panKeyed) scheduleParam(pan.pan, automation((t) => panAt(cp, t), a, b, knots(cp, ['audio.pan']), 0.01), map, -1, 1);
  else pan.pan.value = panAt(cp, a);

  const gi = Math.min(opts.guardIn ?? 0, (stopTime - startTime) / 2);
  const go = Math.min(opts.guardOut ?? 0, (stopTime - startTime) / 2);
  if (gi > 0) {
    guard.gain.setValueAtTime(0, startTime);
    guard.gain.linearRampToValueAtTime(1, startTime + gi);
  }
  if (go > 0) {
    guard.gain.setValueAtTime(1, stopTime - go);
    guard.gain.linearRampToValueAtTime(0, stopTime);
  }

  node.start(startTime, offset);
  node.stop(stopTime);
  const endedCbs: (() => void)[] = [];
  node.onended = () => {
    for (const n of nodes) {
      try {
        n.disconnect();
      } catch {
        /* ignore */
      }
    }
    for (const cb of endedCbs) cb();
  };

  let stopped = false;
  return {
    id: cp.id,
    trackId: cp.trackId,
    sig: cp.sig,
    end: b,
    onEnded(cb) {
      endedCbs.push(cb);
    },
    update(next, now) {
      if (!next.clip.keyframes['audio.gain']?.length) gain.gain.setTargetAtTime(gainAt(next, next.start), now, 0.015);
      if (!next.clip.keyframes['audio.pan']?.length) pan.pan.setTargetAtTime(panAt(next, next.start), now, 0.015);
      const a2 = next.clip.audio;
      if (eqNodes.length && a2.eq.enabled) {
        eqBands(a2.eq).forEach((band, i) => {
          const f = eqNodes[i];
          if (!f) return;
          if (f.type !== band.type) f.type = band.type;
          f.frequency.setTargetAtTime(clamp(band.frequency, 10, ctx.sampleRate / 2), now, 0.015);
          f.Q.setTargetAtTime(band.Q, now, 0.015);
          f.gain.setTargetAtTime(band.gain, now, 0.015);
        });
      }
      if (comp) applyComp(a2.comp);
    },
    stop(now) {
      if (stopped) return;
      stopped = true;
      const g = guard.gain;
      try {
        if (typeof g.cancelAndHoldAtTime === 'function') g.cancelAndHoldAtTime(now);
        else {
          g.cancelScheduledValues(now);
          g.setValueAtTime(g.value, now);
        }
        g.linearRampToValueAtTime(0, now + 0.008);
        node.stop(now + 0.012);
      } catch {
        try {
          node.stop();
        } catch {
          /* not started */
        }
      }
    },
  };
}
