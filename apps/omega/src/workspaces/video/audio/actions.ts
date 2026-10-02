// Audio commands, registered with the action registry (keyboard, palette,
// menus). Keys follow Premiere where it has a default ([ ] clip volume).

import { registerActions } from '../actions';
import { useEditor } from '../../../state/store';
import type { Sequence, Track } from '../../../state/types';
import { activeSequence } from '../../../state/types';
import { normalizeClipsPeak, resolveAudioClipId } from './AudioClipSection';
import { isRecording, resolveArmedTrack, toggleVoiceover } from './recorder';
import { useAudioUi } from './uiStore';

/** Audio clips behind the selection (linked partners of selected video clips included). */
export function selectedAudioClipIds(): string[] {
  const s = useEditor.getState();
  if (!s.project) return [];
  const ids = new Set<string>();
  for (const id of s.selection.clipIds) {
    const a = resolveAudioClipId(s.project, id);
    if (a) ids.add(a);
  }
  return [...ids];
}

/** The audio track the user means: the focused track, else the track of the selected audio clip. */
export function selectedAudioTrack(seq: Sequence): Track | null {
  const s = useEditor.getState();
  const audio = seq.tracks.filter((t) => t.kind === 'audio');
  const focused = audio.find((t) => t.id === s.selection.trackId);
  if (focused) return focused;
  const clipIds = selectedAudioClipIds();
  for (const t of audio) if (t.clips.some((c) => clipIds.includes(c.id))) return t;
  return null;
}

function toggleTrackFlag(flag: 'muted' | 'solo') {
  const s = useEditor.getState();
  if (!s.project) return;
  const track = selectedAudioTrack(activeSequence(s.project));
  if (!track) {
    s.showToast('Select an audio track or clip first.', 'info');
    return;
  }
  const on = !track[flag];
  const verb = flag === 'muted' ? (on ? 'Mute' : 'Unmute') : on ? 'Solo' : 'Unsolo';
  s.mutateSequence(`${verb} ${track.name}`, (seq) => {
    const t = seq.tracks.find((x) => x.id === track.id);
    if (t) t[flag] = on;
  });
}

function nudgeGain(db: number) {
  const ids = selectedAudioClipIds();
  if (!ids.length) return;
  const s = useEditor.getState();
  s.mutateSequence(
    `${db > 0 ? 'Raise' : 'Lower'} clip volume ${Math.abs(db)} dB`,
    (seq) => {
      for (const t of seq.tracks)
        for (const c of t.clips) {
          if (!ids.includes(c.id)) continue;
          const kfs = c.keyframes['audio.gain'];
          if (kfs?.length) for (const k of kfs) k.v = Math.round((k.v + db) * 100) / 100;
          c.audio.gain = Math.round((c.audio.gain + db) * 100) / 100;
        }
    },
    { coalesceKey: `au-nudge-${ids.join(',')}` },
  );
}

const hasProject = () => !!useEditor.getState().project;
const hasAudioSelection = () => selectedAudioClipIds().length > 0;

registerActions([
  {
    id: 'audio.normalizePeak',
    label: 'Normalize peak to −1 dBFS',
    group: 'Audio',
    keys: ['Alt+Shift+N'],
    hint: 'Sets clip gain so the selected clips peak at −1 dBFS',
    enabled: hasAudioSelection,
    run: () => void normalizeClipsPeak(selectedAudioClipIds(), -1),
  },
  {
    id: 'audio.gainUp',
    label: 'Raise clip volume 1 dB',
    group: 'Audio',
    keys: [']'],
    enabled: hasAudioSelection,
    run: () => nudgeGain(1),
  },
  {
    id: 'audio.gainDown',
    label: 'Lower clip volume 1 dB',
    group: 'Audio',
    keys: ['['],
    enabled: hasAudioSelection,
    run: () => nudgeGain(-1),
  },
  {
    id: 'audio.gainUpMore',
    label: 'Raise clip volume 6 dB',
    group: 'Audio',
    keys: ['}'],
    enabled: hasAudioSelection,
    run: () => nudgeGain(6),
  },
  {
    id: 'audio.gainDownMore',
    label: 'Lower clip volume 6 dB',
    group: 'Audio',
    keys: ['{'],
    enabled: hasAudioSelection,
    run: () => nudgeGain(-6),
  },
  {
    id: 'audio.duck',
    label: 'Auto-duck music under dialogue…',
    group: 'Audio',
    hint: 'Writes volume keyframes on music clips wherever dialogue plays',
    enabled: hasProject,
    run: () => useEditor.getState().openModal('audio.duck'),
  },
  {
    id: 'audio.analyzeLoudness',
    label: 'Analyze loudness…',
    group: 'Audio',
    hint: 'Integrated loudness, LRA and true peak (BS.1770-4 / EBU R 128) of the sequence or in/out range',
    enabled: hasProject,
    run: () => useEditor.getState().openModal('audio.loudness', { autoStart: true }),
  },
  {
    id: 'audio.toggleMute',
    label: 'Mute / unmute selected track',
    group: 'Audio',
    keys: ['Alt+Shift+M'],
    enabled: hasProject,
    run: () => toggleTrackFlag('muted'),
  },
  {
    id: 'audio.toggleSolo',
    label: 'Solo / unsolo selected track',
    group: 'Audio',
    keys: ['Alt+Shift+S'],
    enabled: hasProject,
    run: () => toggleTrackFlag('solo'),
  },
  {
    id: 'audio.armTrack',
    label: 'Arm selected track for recording',
    group: 'Audio',
    enabled: () => hasProject() && !isRecording(),
    run: () => {
      const s = useEditor.getState();
      if (!s.project) return;
      const t = selectedAudioTrack(activeSequence(s.project));
      if (t) useAudioUi.getState().set({ armedTrackId: t.id });
      else resolveArmedTrack();
    },
  },
  {
    id: 'audio.recordVoiceover',
    label: 'Record voiceover (start / stop)',
    group: 'Audio',
    keys: ['Alt+Shift+R'],
    hint: 'Count-in, then records the microphone onto the armed audio track from the playhead',
    enabled: hasProject,
    run: () => toggleVoiceover(),
  },
]);
