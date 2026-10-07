// Auto-ducking UI: pick dialogue and music tracks, how far to dip and how
// fast, then Apply writes 'audio.gain' keyframes on every music clip in ONE
// undoable change.

import { useMemo, useState } from 'react';
import { computeDucking } from '../../../engine/audio/engine';
import { useEditor, useSequence } from '../../../state/store';
import { activeSequence } from '../../../state/types';
import { ScrubNumber, Slider } from '../inspector/controls';

/** First guess at roles: tracks named like music are music; otherwise the first track with clips is dialogue and the last is music. */
function guessRoles(tracks: { id: string; name: string; clips: number }[]): { dialogue: string[]; music: string[] } {
  const isMusic = (n: string) => /music|score|song|bed|\bmx\b/i.test(n);
  const used = tracks.filter((t) => t.clips > 0);
  const named = used.filter((t) => isMusic(t.name)).map((t) => t.id);
  if (named.length) return { music: named, dialogue: used.filter((t) => !named.includes(t.id)).map((t) => t.id) };
  if (used.length >= 2) return { dialogue: [used[0].id], music: [used[used.length - 1].id] };
  if (tracks.length >= 2) return { dialogue: [tracks[0].id], music: [tracks[1].id] };
  return { dialogue: [], music: [] };
}

export function DuckingTool({ onDone }: { onDone?: () => void }) {
  const seq = useSequence();
  const tracks = seq.tracks.filter((t) => t.kind === 'audio');
  const guess = useMemo(() => guessRoles(tracks.map((t) => ({ id: t.id, name: t.name, clips: t.clips.length }))), [tracks]);
  const [dialogue, setDialogue] = useState<string[]>(guess.dialogue);
  const [music, setMusic] = useState<string[]>(guess.music);
  const [reduction, setReduction] = useState(12);
  const [threshold, setThreshold] = useState(-40);
  const [attack, setAttack] = useState(0.3);
  const [release, setRelease] = useState(0.8);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const toggle = (list: string[], set: (v: string[]) => void, id: string, other: string[], setOther: (v: string[]) => void) => {
    if (list.includes(id)) set(list.filter((x) => x !== id));
    else {
      set([...list, id]);
      if (other.includes(id)) setOther(other.filter((x) => x !== id));
    }
  };

  const apply = async () => {
    const s = useEditor.getState();
    if (!s.project) return;
    setBusy(true);
    setMessage(null);
    try {
      const results = await computeDucking(s.project, activeSequence(s.project), {
        dialogueTrackIds: dialogue,
        musicTrackIds: music,
        reductionDb: reduction,
        thresholdDb: threshold,
        attack,
        release,
      });
      if (!results.length) {
        const seq = activeSequence(s.project);
        const musicClips = seq.tracks.filter((t) => music.includes(t.id)).reduce((n, t) => n + t.clips.length, 0);
        setMessage(musicClips ? 'No dialogue above the threshold under the music clips.' : 'The music tracks have no clips.');
        return;
      }
      useEditor.getState().mutateSequence(`Auto-duck ${results.length} music clip${results.length === 1 ? '' : 's'}`, (draft) => {
        for (const r of results) {
          const t = draft.tracks.find((x) => x.id === r.trackId);
          const c = t?.clips.find((x) => x.id === r.clipId);
          if (c) c.keyframes['audio.gain'] = r.keyframes;
        }
      });
      const keys = results.reduce((n, r) => n + r.keyframes.length, 0);
      setMessage(`Ducked ${results.length} clip${results.length === 1 ? '' : 's'} (${keys} keyframes).`);
      useEditor.getState().showToast(`Music ducked under dialogue on ${results.length} clip${results.length === 1 ? '' : 's'}`, 'success');
      onDone?.();
    } catch (err) {
      setMessage(`Ducking failed: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  if (tracks.length < 2) return <p className="au-note">Ducking needs at least two audio tracks: one with dialogue, one with music.</p>;

  return (
    <div className="au-duck" data-testid="au-duck">
      <div className="au-duck__roles">
        <div>
          <div className="au-label">Dialogue</div>
          <div className="au-chips">
            {tracks.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`au-chip ${dialogue.includes(t.id) ? 'is-on' : ''}`}
                aria-pressed={dialogue.includes(t.id)}
                data-testid={`au-duck-dialogue-${t.name}`}
                onClick={() => toggle(dialogue, setDialogue, t.id, music, setMusic)}
              >
                {t.name}
              </button>
            ))}
          </div>
        </div>
        <div>
          <div className="au-label">Music</div>
          <div className="au-chips">
            {tracks.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`au-chip ${music.includes(t.id) ? 'is-on' : ''}`}
                aria-pressed={music.includes(t.id)}
                data-testid={`au-duck-music-${t.name}`}
                onClick={() => toggle(music, setMusic, t.id, dialogue, setDialogue)}
              >
                {t.name}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="au-duck__row">
        <span className="au-label">Reduce by</span>
        <Slider value={reduction} min={3} max={30} step={0.5} defaultValue={12} onChange={(v) => setReduction(v)} aria-label="Ducking amount" data-testid="au-duck-amount-slider" />
        <ScrubNumber value={reduction} min={1} max={40} step={0.5} unit="dB" onChange={(v) => setReduction(v)} aria-label="Ducking amount (dB)" data-testid="au-duck-amount" />
      </div>
      <div className="au-duck__row">
        <span className="au-label">Speech above</span>
        <Slider value={threshold} min={-60} max={-10} step={1} defaultValue={-40} onChange={(v) => setThreshold(v)} aria-label="Dialogue threshold" />
        <ScrubNumber value={threshold} min={-80} max={0} step={1} unit="dBFS" onChange={(v) => setThreshold(v)} aria-label="Dialogue threshold (dBFS)" data-testid="au-duck-threshold" />
      </div>
      <div className="au-duck__row au-duck__row--pair">
        <span className="au-label">Fade down</span>
        <ScrubNumber value={attack} min={0} max={3} step={0.05} unit="s" onChange={(v) => setAttack(v)} aria-label="Fade down (s)" data-testid="au-duck-attack" />
        <span className="au-label">Recover</span>
        <ScrubNumber value={release} min={0} max={5} step={0.05} unit="s" onChange={(v) => setRelease(v)} aria-label="Recover (s)" data-testid="au-duck-release" />
      </div>
      <div className="au-duck__foot">
        <span className="au-muted" data-testid="au-duck-message">
          {message ?? 'Writes volume keyframes on the music clips; undo removes them in one step.'}
        </span>
        <button type="button" className="btn btn--sm btn--primary" disabled={busy || !dialogue.length || !music.length} onClick={() => void apply()} data-testid="au-duck-apply">
          {busy ? 'Analyzing…' : 'Apply'}
        </button>
      </div>
    </div>
  );
}
