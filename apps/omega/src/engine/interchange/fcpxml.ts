// Final Cut Pro XML 1.11 writer. OWNED BY THE CAPTIONS/INTERCHANGE PACKAGE.
//
// resources: <format> per distinct size/rate (frameDuration as a rational,
// e.g. 1001/24000s), <asset> per media file with <media-rep src="file://…">,
// the Cross Dissolve <effect>, and <media> compound clips for nested
// sequences. library/event/project/sequence/spine: the lowest video track with
// clips is the primary storyline (asset-clips and gaps; generated clips such
// as titles become named gaps there). Higher video tracks are connected clips
// on lanes 1, 2, …; audio tracks are connected clips on lanes -1, -2, … with
// srcEnable="audio" (spine/lane video clips use srcEnable="video" so linked
// audio isn't doubled). Times are rational seconds at the sequence rate; spine
// offsets start at the sequence's tcStart. Sequence markers attach to the
// spine item under them (marker / chapter-marker / to-do marker).
//
// Transitions: every video transition between two spine items is written as a
// centered 'Cross Dissolve' (FxPlug uid 4731E73A-…), including fades from or to
// a gap. Transitions on connected clips and audio crossfades are omitted (FCP
// only allows them inside storylines). Speed: constant speed / reverse /
// freeze become <timeMap>; ramps are exported at their average speed.

import type { Clip, ColorSpace, MediaAsset, Project, Sequence, Track } from '../../state/types';
import { exactRate, toFrames } from '../time';
import { assetById, audioTracks, clipFrames, effectiveSpeed, fileUrl, frameRational, hasSpeedRamp, isDropFrame, rationalTime, sortedClips, startFrames, videoTracks } from './common';
import { el, writeXml, type XEl } from './xml';

/** Final Cut Pro's built-in Cross Dissolve (FxPlug). */
export const FCP_CROSS_DISSOLVE_UID = 'FxPlug:4731E73A-8DAC-4113-9A30-AE85B1761265';

export interface FcpxmlResult {
  xml: string;
  warnings: string[];
}

const COLOR_SPACES: Partial<Record<ColorSpace, string>> = {
  rec709: '1-1-1 (Rec. 709)',
  'rec2020-hlg': '9-18-9 (Rec. 2020 HLG)',
  'rec2020-pq': '9-16-9 (Rec. 2020 PQ)',
};

function fcpFormatName(w: number, h: number, fps: number | null): string | undefined {
  if (fps === null) return 'FFVideoFormatRateUndefined';
  const size: Record<string, string> = { '1920x1080': '1080p', '1280x720': '720p', '3840x2160': '3840x2160p', '4096x2160': '4096x2160p', '2048x1080': '2048x1080p' };
  const rates: Record<string, string> = { '23.976': '2398', '24': '24', '25': '25', '29.97': '2997', '30': '30', '50': '50', '59.94': '5994', '60': '60' };
  const r = exactRate(fps);
  const rk = Object.keys(rates).find((k) => Math.abs(exactRate(Number(k)) - r) < 1e-6);
  const sk = size[`${w}x${h}`];
  return sk && rk ? `FFVideoFormat${sk}${rates[rk]}` : undefined;
}

class Resources {
  private n = 0;
  formats = new Map<string, string>();
  assets = new Map<string, string>();
  media = new Map<string, string>();
  formatEls: XEl[] = [];
  effectEls: XEl[] = [];
  assetEls: XEl[] = [];
  mediaEls: XEl[] = [];
  dissolveId: string | null = null;
  id(): string {
    this.n += 1;
    return `r${this.n}`;
  }
  /** A format id; without a color space, any existing format of the same size and rate is reused. */
  format(w: number, h: number, fps: number | null, colorSpace?: ColorSpace): string {
    const fr = fps === null ? null : frameRational(fps);
    const base = `${w}x${h}@${fr ? `${fr.num}/${fr.den}` : 'still'}@`;
    const key = base + (colorSpace ?? '');
    const have = this.formats.get(key) ?? (colorSpace ? undefined : [...this.formats.entries()].find(([k]) => k.startsWith(base))?.[1]);
    if (have) return have;
    const id = this.id();
    this.formats.set(key, id);
    this.formatEls.push(
      el('format', {
        id,
        name: fcpFormatName(w, h, fps),
        frameDuration: fr ? `${fr.num}/${fr.den}s` : undefined,
        width: w,
        height: h,
        colorSpace: colorSpace ? COLOR_SPACES[colorSpace] : undefined,
      }),
    );
    return id;
  }
  dissolve(): string {
    if (!this.dissolveId) {
      this.dissolveId = this.id();
      this.effectEls.push(el('effect', { id: this.dissolveId, name: 'Cross Dissolve', uid: FCP_CROSS_DISSOLVE_UID }));
    }
    return this.dissolveId;
  }
  asset(a: MediaAsset, seq: Sequence): string {
    const have = this.assets.get(a.id);
    if (have) return have;
    const isStill = a.kind === 'image';
    const fps = a.fps && a.fps > 0 ? a.fps : seq.fps;
    let format: string | undefined;
    if (a.hasVideo || isStill) format = this.format(a.width ?? seq.width, a.height ?? seq.height, isStill ? null : fps);
    const id = this.id();
    this.assets.set(a.id, id);
    let duration = '0s';
    if (!isStill) {
      if (a.hasVideo) duration = rationalTime(Math.max(0, toFrames(a.duration, fps)), fps);
      else {
        const sr = a.sampleRate && a.sampleRate > 0 ? a.sampleRate : 48000;
        const samples = Math.max(0, Math.round(a.duration * sr));
        duration = samples ? reduce(samples, sr) : '0s';
      }
    }
    this.assetEls.push(
      el(
        'asset',
        {
          id,
          name: a.name,
          start: '0s',
          duration,
          hasVideo: a.hasVideo || isStill ? '1' : '0',
          format,
          hasAudio: a.hasAudio ? '1' : '0',
          videoSources: a.hasVideo || isStill ? '1' : undefined,
          audioSources: a.hasAudio ? '1' : undefined,
          audioChannels: a.hasAudio ? String(a.channels ?? 2) : undefined,
          audioRate: a.hasAudio ? String(a.sampleRate ?? 48000) : undefined,
        },
        [el('media-rep', { kind: 'original-media', src: fileUrl(a.path) })],
      ),
    );
    return id;
  }
}

function reduce(n: number, d: number): string {
  let a = n;
  let b = d;
  while (b) [a, b] = [b, a % b];
  const g = a || 1;
  return d / g === 1 ? `${n / g}s` : `${n / g}/${d / g}s`;
}

interface Ctx {
  project: Project;
  res: Resources;
  warnings: Set<string>;
  stack: string[];
}

interface SpineItem {
  kind: 'clip' | 'gap';
  clip?: Clip;
  name: string;
  offF: number; // sequence frames (without tcStart)
  durF: number;
  /** Local start in the item's own timeline (frames). */
  startF: number;
  anchors: XEl[];
  markers: XEl[];
}

/** Local start and optional timeMap for a (possibly retimed) clip. */
function retime(clip: Clip, fps: number, assetDuration: number | null): { startF: number; timeMap?: XEl } {
  const rate = exactRate(fps);
  const inF = Math.round(clip.inPoint * rate);
  const hold = clip.holdFrame !== null && clip.holdFrame !== undefined;
  const speed = effectiveSpeed(clip);
  if (!hold && speed === 1 && !clip.reverse) return { startF: inF };
  if (assetDuration === null || assetDuration <= 0) return { startF: inF };
  const assetF = Math.max(1, Math.round(assetDuration * rate));
  const durF = Math.max(1, Math.round(clip.duration * rate));
  const tp = (time: number, value: number) => el('timept', { time: rationalTime(time, fps), value: rationalTime(value, fps), interp: 'linear' });
  if (hold) {
    const h = Math.round(clip.holdFrame! * rate);
    return { startF: 0, timeMap: el('timeMap', {}, [tp(0, h), tp(durF, h)]) };
  }
  const s = Math.max(1e-6, Math.abs(speed));
  const mapLen = Math.max(1, Math.round(assetF / s));
  if (clip.reverse) {
    const spanF = Math.round(clip.duration * s * rate);
    return { startF: Math.max(0, Math.round((assetF - inF - spanF) / s)), timeMap: el('timeMap', {}, [tp(0, assetF), tp(mapLen, 0)]) };
  }
  return { startF: Math.round(inF / s), timeMap: el('timeMap', {}, [tp(0, 0), tp(mapLen, assetF)]) };
}

/** A clip element (asset-clip / ref-clip) or null when FCPXML can't express it. */
function clipEl(ctx: Ctx, seq: Sequence, clip: Clip, offset: string, durF: number, lane: number | undefined, role: 'video' | 'audio', muted: boolean): { el: XEl; startF: number } | null {
  const fps = seq.fps;
  const enabled = clip.enabled && !muted ? undefined : '0';
  if (hasSpeedRamp(clip)) ctx.warnings.add('Speed ramps were exported at their average speed.');
  if (clip.kind === 'media') {
    const asset = assetById(ctx.project, clip.assetId);
    if (!asset) return null;
    if (role === 'audio' && !asset.hasAudio) return null;
    if (role === 'video' && !(asset.hasVideo || asset.kind === 'image')) return null;
    const ref = ctx.res.asset(asset, seq);
    const { startF, timeMap } = retime(clip, fps, asset.kind === 'image' ? null : asset.duration);
    const srcEnable = role === 'video' && asset.hasAudio ? 'video' : role === 'audio' && (asset.hasVideo || asset.kind === 'image') ? 'audio' : undefined;
    const kids: XEl[] = [];
    if (timeMap) kids.push(timeMap);
    if (role === 'audio' && clip.audio && clip.audio.gain) kids.push(el('adjust-volume', { amount: `${Math.round(clip.audio.gain * 100) / 100}dB` }));
    return {
      startF,
      el: el(
        'asset-clip',
        { ref, lane, offset, name: clip.name || asset.name, start: rationalTime(startF, fps), duration: rationalTime(durF, fps), enabled, srcEnable },
        kids,
      ),
    };
  }
  if (clip.kind === 'sequence') {
    const nested = ctx.project.sequences.find((s) => s.id === clip.sequenceId);
    if (!nested || ctx.stack.includes(nested.id) || ctx.stack.length > 8) return null;
    const ref = compound(ctx, nested);
    const { startF, timeMap } = retime(clip, fps, nestedDuration(nested));
    return {
      startF,
      el: el(
        'ref-clip',
        { ref, lane, offset, name: clip.name || nested.name, start: rationalTime(startF, fps), duration: rationalTime(durF, fps), enabled, srcEnable: role === 'audio' ? 'audio' : nestedHasAudio(nested) ? 'video' : undefined },
        timeMap ? [timeMap] : [],
      ),
    };
  }
  return null;
}

function nestedHasAudio(seq: Sequence): boolean {
  return seq.tracks.some((t) => t.kind === 'audio' && t.clips.length > 0);
}

function nestedDuration(seq: Sequence): number {
  let end = 0;
  for (const t of seq.tracks) for (const c of t.clips) end = Math.max(end, c.start + c.duration);
  return end;
}

function compound(ctx: Ctx, nested: Sequence): string {
  const have = ctx.res.media.get(nested.id);
  if (have) return have;
  ctx.stack.push(nested.id);
  const id = ctx.res.id();
  ctx.res.media.set(nested.id, id);
  const seqEl = sequenceEl(ctx, nested, true);
  ctx.stack.pop();
  ctx.res.mediaEls.push(el('media', { id, name: nested.name }, [seqEl]));
  return id;
}

function sequenceEl(ctx: Ctx, seq: Sequence, isCompound: boolean): XEl {
  const fps = seq.fps;
  const rate = exactRate(fps);
  const tc0 = isCompound ? 0 : startFrames(seq);
  const formatId = ctx.res.format(seq.width, seq.height, fps, seq.colorSpace);
  const vids = videoTracks(seq);
  const auds = audioTracks(seq);
  const contentEnd = Math.max(0, ...seq.tracks.flatMap((t) => t.clips.map((c) => clipFrames(c, fps).e)));

  // Primary storyline: the lowest video track with clips.
  let spineIdx = -1;
  for (let i = vids.length - 1; i >= 0; i--) {
    if (vids[i].clips.length) {
      spineIdx = i;
      break;
    }
  }
  const items: SpineItem[] = [];
  const spineTrack = spineIdx >= 0 ? vids[spineIdx] : null;
  let cursor = 0;
  const addGap = (offF: number, durF: number, name = 'Gap') => items.push({ kind: 'gap', name, offF, durF, startF: offF + tc0, anchors: [], markers: [] });
  if (spineTrack) {
    for (const clip of sortedClips(spineTrack)) {
      const { s, e } = clipFrames(clip, fps);
      const start = Math.max(s, cursor);
      if (e <= start) continue;
      if (start > cursor) addGap(cursor, start - cursor);
      items.push({ kind: 'clip', clip, name: clip.name, offF: start, durF: e - start, startF: 0, anchors: [], markers: [] });
      cursor = e;
    }
  }
  if (contentEnd > cursor) addGap(cursor, contentEnd - cursor);

  const findItem = (f: number) => items.find((it) => f >= it.offF && f < it.offF + it.durF);
  const localOf = (it: SpineItem, f: number) => it.startF + (f - it.offF);

  // Resolve spine elements (need startF before anchoring).
  const spineEls = new Map<SpineItem, XEl>();
  for (const it of items) {
    if (it.kind !== 'clip' || !it.clip) continue;
    const clip = it.clip;
    const trimF = it.offF - clipFrames(clip, fps).s;
    const c = clipEl(ctx, seq, { ...clip, inPoint: clip.inPoint + (trimF / rate) * (clip.speed || 1) }, rationalTime(it.offF + tc0, fps), it.durF, undefined, 'video', !!spineTrack?.muted);
    if (c) {
      it.startF = c.startF;
      spineEls.set(it, c.el);
    } else {
      // Not expressible (title, shape, solid, adjustment…): keep the timing as a named gap.
      ctx.warnings.add('Titles, shapes, solids, gradients and adjustment layers have no FCPXML equivalent and were exported as gaps or omitted.');
      it.kind = 'gap';
      it.name = clip.name || 'Gap';
      it.startF = it.offF + tc0;
    }
  }

  // Connected clips.
  const anchor = (clip: Clip, lane: number, role: 'video' | 'audio', muted: boolean) => {
    const { s, e } = clipFrames(clip, fps);
    if (e <= s) return;
    const it = findItem(s);
    if (!it) return;
    const c = clipEl(ctx, seq, clip, rationalTime(localOf(it, s), fps), e - s, lane, role, muted);
    if (c) it.anchors.push(c.el);
    else if (role === 'video') ctx.warnings.add('Titles, shapes, solids, gradients and adjustment layers have no FCPXML equivalent and were exported as gaps or omitted.');
    if (clip.transitionIn || clip.transitionOut) ctx.warnings.add('Transitions on connected clips (upper video tracks and audio) are not exported.');
  };
  for (let i = spineIdx - 1; i >= 0; i--) for (const clip of sortedClips(vids[i])) anchor(clip, spineIdx - i, 'video', vids[i].muted);
  auds.forEach((t, i) => {
    for (const clip of sortedClips(t)) anchor(clip, -(i + 1), 'audio', t.muted);
  });

  // Markers (top-level sequences only).
  if (!isCompound) {
    for (const m of seq.markers) {
      const f = Math.round(m.time * rate);
      const it = findItem(f);
      if (!it) {
        ctx.warnings.add('Markers after the end of the sequence were skipped.');
        continue;
      }
      const attrs = { start: rationalTime(localOf(it, f), fps), duration: rationalTime(Math.max(1, Math.round(m.duration * rate)), fps), value: m.label || (m.kind === 'chapter' ? 'Chapter' : 'Marker') };
      if (m.kind === 'chapter') it.markers.push(el('chapter-marker', { ...attrs, posterOffset: '0s' }));
      else if (m.kind === 'todo') it.markers.push(el('marker', { ...attrs, completed: m.done ? '1' : '0', note: m.note || undefined }));
      else it.markers.push(el('marker', { ...attrs, note: m.note || undefined }));
    }
  }

  // Spine children with transitions.
  const kids: XEl[] = [];
  const dissolve = (offF: number, durF: number): XEl =>
    el('transition', { name: 'Cross Dissolve', offset: rationalTime(offF + tc0, fps), duration: rationalTime(durF, fps) }, [el('filter-video', { ref: ctx.res.dissolve(), name: 'Cross Dissolve' })]);
  let trailing: SpineItem | null = null;
  items.forEach((it, idx) => {
    const prev = items[idx - 1];
    const clip = it.kind === 'clip' ? it.clip : undefined;
    const tin = clip?.transitionIn;
    if (tin && tin.duration > 0 && prev && it.offF === clipFrames(clip!, fps).s) {
      const d = Math.round(tin.duration * rate);
      const inOff = Math.min(Math.floor(d / 2), prev.durF);
      const outOff = Math.min(d - Math.floor(d / 2), it.durF);
      if (inOff + outOff > 0) {
        kids.push(dissolve(it.offF - inOff, inOff + outOff));
        if (tin.type !== 'crossDissolve') ctx.warnings.add('Non-dissolve transitions were exported as Cross Dissolve.');
      }
    }
    const xmlEl = spineEls.get(it);
    if (xmlEl) {
      xmlEl.children = [...(xmlEl.children ?? []), ...it.anchors, ...it.markers];
      kids.push(xmlEl);
    } else {
      kids.push(el('gap', { name: it.name, offset: rationalTime(it.offF + tc0, fps), start: rationalTime(it.startF, fps), duration: rationalTime(it.durF, fps) }, [...it.anchors, ...it.markers]));
    }
    const tout = clip?.transitionOut;
    const next = items[idx + 1];
    if (tout && tout.duration > 0 && it.offF + it.durF === clipFrames(clip!, fps).e && (!next || next.kind === 'gap')) {
      const d = Math.round(tout.duration * rate);
      const inOff = Math.min(Math.floor(d / 2), it.durF);
      let outOff = d - Math.floor(d / 2);
      if (next) outOff = Math.min(outOff, next.durF);
      if (inOff + outOff > 0) {
        kids.push(dissolve(it.offF + it.durF - inOff, inOff + outOff));
        if (!next) trailing = { kind: 'gap', name: 'Gap', offF: it.offF + it.durF, durF: outOff, startF: it.offF + it.durF + tc0, anchors: [], markers: [] };
      }
    }
  });
  let totalF = items.length ? items[items.length - 1].offF + items[items.length - 1].durF : 0;
  if (trailing) {
    const t = trailing as SpineItem;
    kids.push(el('gap', { name: 'Gap', offset: rationalTime(t.offF + tc0, fps), start: rationalTime(t.startF, fps), duration: rationalTime(t.durF, fps) }));
    totalF += t.durF;
  }

  return el(
    'sequence',
    {
      format: formatId,
      duration: rationalTime(totalF, fps),
      tcStart: rationalTime(tc0, fps),
      tcFormat: isDropFrame(seq) ? 'DF' : 'NDF',
      audioLayout: 'stereo',
      audioRate: seq.sampleRate === 44100 ? '44.1k' : seq.sampleRate === 96000 ? '96k' : '48k',
    },
    [el('spine', {}, kids)],
  );
}

/** FCPXML with the warnings the conversion produced. */
export function exportFcpxmlDetailed(project: Project, seq: Sequence): FcpxmlResult {
  const ctx: Ctx = { project, res: new Resources(), warnings: new Set(), stack: [seq.id] };
  // Sequence format first so it is r1.
  ctx.res.format(seq.width, seq.height, seq.fps, seq.colorSpace);
  const seqEl = sequenceEl(ctx, seq, false);
  if (seq.tracks.some((t: Track) => t.kind === 'caption' && t.cues.length)) ctx.warnings.add('Captions are not included in FCPXML; export them as an SRT sidecar.');
  const doc = el('fcpxml', { version: '1.11' }, [
    el('resources', {}, [...ctx.res.formatEls, ...ctx.res.effectEls, ...ctx.res.assetEls, ...ctx.res.mediaEls]),
    el('library', {}, [el('event', { name: project.name || 'Omega' }, [el('project', { name: seq.name || 'Sequence' }, [seqEl])])]),
  ]);
  const xml = ['<?xml version="1.0" encoding="UTF-8"?>', '<!DOCTYPE fcpxml>', '', writeXml(doc), ''].join('\n');
  return { xml, warnings: [...ctx.warnings] };
}

/** Final Cut Pro XML 1.11 (.fcpxml), readable by Final Cut and Resolve. */
export function exportFcpxml(project: Project, seq: Sequence): string {
  return exportFcpxmlDetailed(project, seq).xml;
}
