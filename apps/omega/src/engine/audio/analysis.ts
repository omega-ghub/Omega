// Analyses that need decoded audio: auto-ducking and clip peak measurement.

import type { Clip, Project, Sequence } from '../../state/types';
import { findClip } from '../../state/types';
import { pin, PRIORITY_PLAYBACK, unpin } from './cache';
import { detectRegions, duckKeyframes, mergeForRamps, type DuckingOptions, type DuckResult } from './ducking';
import { resolveSource } from './mixer';
import { envAt, gainAt, planMix, rateAt, sourceAt, type ClipPlan } from './plan';

const HOP = 0.01; // envelope resolution (s)
const WINDOW_BLOCKS = 5; // 50 ms RMS window

/** Mean power of the (channel-averaged) source in 10 ms blocks. */
function blockPower(buffer: AudioBuffer, blockFrames: number): Float32Array {
  const n = Math.ceil(buffer.length / blockFrames);
  const out = new Float32Array(n);
  const C = buffer.numberOfChannels;
  for (let c = 0; c < C; c++) {
    const d = buffer.getChannelData(c);
    for (let b = 0; b < n; b++) {
      let s = 0;
      const e = Math.min(d.length, (b + 1) * blockFrames);
      for (let i = b * blockFrames; i < e; i++) s += d[i] * d[i];
      out[b] += s / blockFrames / C;
    }
  }
  return out;
}

const tick = () => new Promise((r) => setTimeout(r, 0));

/**
 * Measures the dialogue tracks' RMS envelope from the decoded audio and
 * returns 'audio.gain' keyframes that duck every music clip under speech.
 * Apply the result in one mutate (see the ducking UI).
 */
export async function computeDucking(project: Project, seq: Sequence, opts: DuckingOptions): Promise<DuckResult[]> {
  const plan = planMix(project, seq);
  const sr = plan.sampleRate;
  const dialogue = plan.clips.filter((c) => opts.dialogueTrackIds.includes(c.trackId));
  const music = plan.clips.filter((c) => opts.musicTrackIds.includes(c.trackId) && !opts.dialogueTrackIds.includes(c.trackId));
  if (!dialogue.length || !music.length) return [];
  const t0 = Math.max(0, Math.min(...dialogue.map((c) => c.t0)));
  const t1 = Math.max(...dialogue.map((c) => c.t1));
  const n = Math.max(1, Math.ceil((t1 - t0) / HOP));
  const power = new Float64Array(n);
  const blockFrames = Math.max(1, Math.round(HOP * sr));

  for (const cp of dialogue) {
    const res = await resolveSource(project, cp, sr, PRIORITY_PLAYBACK);
    if (!res) continue;
    pin(res.entry);
    try {
      const bp = blockPower(res.entry.buffer, blockFrames);
      const i0 = Math.max(0, Math.floor((cp.t0 - t0) / HOP));
      const i1 = Math.min(n, Math.ceil((cp.t1 - t0) / HOP));
      let s = sourceAt(cp, t0 + i0 * HOP);
      for (let i = i0; i < i1; i++) {
        const t = t0 + i * HOP;
        if (!cp.ramp) s = sourceAt(cp, t);
        const center = Math.floor((s - res.entry.start) / HOP);
        let acc = 0;
        let cnt = 0;
        for (let k = center - (WINDOW_BLOCKS >> 1); k <= center + (WINDOW_BLOCKS >> 1); k++) {
          if (k >= 0 && k < bp.length) acc += bp[k];
          cnt++;
        }
        const g = gainAt(cp, t) * envAt(cp, t);
        power[i] += (acc / cnt) * g * g;
        if (cp.ramp) s += (cp.reverse ? -1 : 1) * rateAt(cp, t) * HOP;
        if ((i & 4095) === 0) await tick();
      }
    } finally {
      unpin(res.entry);
    }
  }
  const envDb = new Float32Array(n);
  // RMS of a sine is −3 dB below its peak; report RMS in dBFS like a meter.
  for (let i = 0; i < n; i++) envDb[i] = power[i] > 0 ? 10 * Math.log10(power[i]) : -200;
  const regions = mergeForRamps(detectRegions(envDb, HOP, t0, opts.thresholdDb, opts.hold, opts.minDuration), opts.attack, opts.release);
  const out: DuckResult[] = [];
  for (const cp of music) {
    const kfs = duckKeyframes(cp.clip, regions, opts.reductionDb, opts.attack, opts.release);
    if (kfs) out.push({ clipId: cp.id, trackId: cp.trackId, keyframes: kfs });
  }
  return out;
}

/** Sample peak (dBFS) of the source audio a clip plays, before clip gain. −Infinity when silent. */
export async function clipPeakDb(project: Project, clip: Clip): Promise<number> {
  const seq = project.sequences.find((s) => findClip(s, clip.id)) ?? project.sequences.find((s) => s.id === project.activeSequenceId);
  if (!seq) return -Infinity;
  const plan = planMix(project, seq);
  let cp: ClipPlan | undefined = plan.clips.find((c) => c.id === clip.id);
  if (!cp) {
    // muted / not on an audible track: plan it unmuted so it can still be measured
    const unmuted = { ...clip, audio: { ...clip.audio, mute: false }, enabled: true };
    const p2 = planMix(project, { ...seq, tracks: seq.tracks.map((t) => ({ ...t, clips: t.clips.map((c) => (c.id === clip.id ? unmuted : c)) })) });
    cp = p2.clips.find((c) => c.id === clip.id);
  }
  if (!cp) return -Infinity;
  const res = await resolveSource(project, cp, plan.sampleRate, PRIORITY_PLAYBACK);
  if (!res) return -Infinity;
  const e = res.entry;
  // the clip's own region (crossfade handles are part of other clips' sound too, so measure only the clip body)
  const a = Math.min(sourceAt(cp, cp.start), sourceAt(cp, cp.end));
  const b = Math.max(sourceAt(cp, cp.start), sourceAt(cp, cp.end));
  const sr = e.buffer.sampleRate;
  const i0 = Math.max(0, Math.floor((a - e.start) * sr));
  const i1 = Math.min(e.buffer.length, Math.ceil((b - e.start) * sr));
  let pk = 0;
  for (let c = 0; c < e.buffer.numberOfChannels; c++) {
    const d = e.buffer.getChannelData(c);
    for (let i = i0; i < i1; i++) {
      const v = d[i] < 0 ? -d[i] : d[i];
      if (v > pk) pk = v;
    }
  }
  return pk > 0 ? 20 * Math.log10(pk) : -Infinity;
}
