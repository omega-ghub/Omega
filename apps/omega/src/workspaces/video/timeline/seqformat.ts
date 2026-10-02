// Pure helpers for sequence settings: multi-aspect format sizes and
// re-snapping a sequence to a new frame rate.
import { exactRate, snapToFrame } from '../../../engine/time';
import type { Sequence, SequenceFormat } from '../../../state/types';
import { newId } from '../../../state/types';

export const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

export function formatFor(base: { width: number; height: number }, a: { name: string; w: number; h: number }): SequenceFormat {
  const short = Math.min(base.width, base.height);
  // keep the short side of the master; the other follows the ratio
  const w = a.w <= a.h ? short : even((short * a.w) / a.h);
  const h = a.w <= a.h ? even((short * a.h) / a.w) : short;
  return { id: newId('fmt'), name: a.name, width: even(w), height: even(h) };
}

/** Re-snaps every time in a sequence to a new frame grid. */
export function resnapSequence(seq: Sequence, fps: number) {
  const sn = (t: number) => snapToFrame(t, fps);
  const one = 1 / exactRate(fps);
  for (const tr of seq.tracks) {
    for (const c of tr.clips) {
      const s = sn(c.start);
      const e = sn(c.start + c.duration);
      c.start = s;
      c.duration = Math.max(one, e - s);
      c.fadeIn = sn(c.fadeIn);
      c.fadeOut = sn(c.fadeOut);
      c.audio.fadeIn = sn(c.audio.fadeIn);
      c.audio.fadeOut = sn(c.audio.fadeOut);
      if (c.transitionIn) c.transitionIn.duration = Math.max(2 * one, sn(c.transitionIn.duration));
      if (c.transitionOut) c.transitionOut.duration = Math.max(2 * one, sn(c.transitionOut.duration));
      for (const list of Object.values(c.keyframes)) for (const k of list) k.t = sn(k.t);
    }
    for (const q of tr.cues) {
      q.start = sn(q.start);
      q.end = Math.max(q.start + one, sn(q.end));
    }
  }
  for (const m of seq.markers) {
    m.time = sn(m.time);
    m.duration = sn(m.duration);
  }
  if (seq.inPoint !== null) seq.inPoint = sn(seq.inPoint);
  if (seq.outPoint !== null) seq.outPoint = sn(seq.outPoint);
  seq.startTimecode = sn(seq.startTimecode);
}

