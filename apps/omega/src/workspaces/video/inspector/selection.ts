// What the inspector edits: no clip, one clip (a linked A/V pair counts as
// one: the video half is primary, the audio half feeds the Audio section),
// or several clips.

import { useEditor } from '../../../state/store';
import { activeSequence, type Clip, type Sequence, type Track } from '../../../state/types';

export type InspectorTarget =
  | { mode: 'none' }
  | { mode: 'single'; clip: Clip; track: Track; audio: { clip: Clip; track: Track } | null }
  | { mode: 'multi'; items: { clip: Clip; track: Track }[] };

export function resolveSelection(seq: Sequence, ids: string[]): InspectorTarget {
  if (!ids.length) return { mode: 'none' };
  const idSet = new Set(ids);
  const items: { clip: Clip; track: Track }[] = [];
  for (const track of seq.tracks) for (const clip of track.clips) if (idSet.has(clip.id)) items.push({ clip, track });
  if (!items.length) return { mode: 'none' };
  // Units: clips sharing a linkId are one unit.
  const units = new Set(items.map((i) => i.clip.linkId ?? `#${i.clip.id}`));
  if (units.size > 1) return { mode: 'multi', items };
  const primary = items.find((i) => i.track.kind === 'video') ?? items[0];
  let audio: { clip: Clip; track: Track } | null = null;
  if (primary.track.kind === 'audio') audio = primary;
  else if (primary.clip.linkId) {
    // The linked audio half, even when linked selection is off.
    for (const track of seq.tracks) {
      if (track.kind !== 'audio') continue;
      const c = track.clips.find((x) => x.linkId === primary.clip.linkId);
      if (c) {
        audio = { clip: c, track };
        break;
      }
    }
  }
  return { mode: 'single', clip: primary.clip, track: primary.track, audio };
}

/** Id of the clip the inspector shows (non-reactive), or null. */
export function primaryClipId(): string | null {
  const s = useEditor.getState();
  if (!s.project) return null;
  const r = resolveSelection(activeSequence(s.project), s.selection.clipIds);
  return r.mode === 'single' ? r.clip.id : null;
}
