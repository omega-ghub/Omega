// Mixer (Audio workspace): one channel strip per audio track (fader, pan,
// mute/solo/record-arm, live stereo meters) plus the master strip (gain,
// true-peak limiter, ceiling, meter), and the voiceover recorder bar.

import { useEffect, useState } from 'react';
import { AudioEngine } from '../../../engine/audio/engine';
import { formatDb, FADER_MAX_DB, FADER_MIN_DB } from '../../../engine/audio/dsp';
import { LABEL_COLORS } from '../../../state/defaults';
import { useEditor, useSequence } from '../../../state/store';
import type { Sequence, Track } from '../../../state/types';
import { I } from '../../../ui/Icons';
import { ScrubNumber } from '../inspector/controls';
import { Fader, formatPan, PanKnob } from './controls';
import { MeterView } from './Meter';
import { inputLevel, toggleVoiceover, cancelVoiceover } from './recorder';
import { useAudioUi } from './uiStore';
import './audio.css';

function editTrack(id: string, label: string, recipe: (t: Track) => void, coalesceKey?: string) {
  useEditor.getState().mutateSequence(
    label,
    (seq) => {
      const t = seq.tracks.find((x) => x.id === id);
      if (t) recipe(t);
    },
    coalesceKey ? { coalesceKey } : undefined,
  );
}

function editMaster(label: string, recipe: (m: Sequence['master']) => void, coalesceKey?: string) {
  useEditor.getState().mutateSequence(label, (seq) => recipe(seq.master), coalesceKey ? { coalesceKey } : undefined);
}

function dbText(db: number) {
  return formatDb(db);
}

function PeakReadout({ source, testId }: { source: 'master' | { trackId: string }; testId: string }) {
  const [state, setState] = useState<{ db: number; clip: boolean }>({ db: -Infinity, clip: false });
  return (
    <div className="au-strip__meterwrap">
      <MeterView
        source={source}
        data-testid={`${testId}-meter`}
        onPeak={(db, clip) => setState((s) => (Math.abs((s.db === -Infinity ? -999 : s.db) - (db === -Infinity ? -999 : db)) > 0.05 || s.clip !== clip ? { db, clip } : s))}
      />
      <span className={`au-strip__peak ${state.clip ? 'au-strip__peak--clip' : ''}`} data-testid={`${testId}-peak`} title="Peak hold (dBFS)">
        {Number.isFinite(state.db) && state.db > -70 ? state.db.toFixed(1) : '−∞'}
      </span>
    </div>
  );
}

function ChannelStrip({ track, anySolo }: { track: Track; anySolo: boolean }) {
  const armed = useAudioUi((s) => s.armedTrackId === track.id);
  const phase = useAudioUi((s) => s.phase);
  const color = LABEL_COLORS[track.color ?? 'none'] ?? LABEL_COLORS.none;
  const implicitMute = anySolo && !track.solo && !track.muted;
  const tid = `au-strip-${track.name}`;
  return (
    <div
      className={`au-strip ${track.muted || implicitMute ? 'au-strip--muted' : ''} ${armed ? 'au-strip--armed' : ''}`}
      data-testid="au-strip"
      data-track-id={track.id}
      onPointerDown={() => useEditor.getState().select({ trackId: track.id })}
    >
      <div className="au-strip__name" title={track.name}>
        <span className="au-strip__dot" style={{ background: color }} />
        <span className="au-strip__label">{track.name}</span>
      </div>
      <div className="au-strip__pan">
        <PanKnob
          value={track.pan}
          label={`${track.name} pan`}
          data-testid={`${tid}-pan`}
          onChange={(v) => editTrack(track.id, `Pan ${track.name}`, (t) => void (t.pan = v), `au-pan-${track.id}`)}
        />
        <span className="au-strip__panval">{formatPan(track.pan)}</span>
      </div>
      <div className="au-strip__buttons">
        <button
          type="button"
          className={`au-tbtn au-tbtn--mute ${track.muted ? 'is-on' : ''}`}
          aria-pressed={track.muted}
          title={`Mute ${track.name}`}
          data-testid={`${tid}-mute`}
          onClick={() => editTrack(track.id, track.muted ? `Unmute ${track.name}` : `Mute ${track.name}`, (t) => void (t.muted = !t.muted))}
        >
          M
        </button>
        <button
          type="button"
          className={`au-tbtn au-tbtn--solo ${track.solo ? 'is-on' : ''}`}
          aria-pressed={track.solo}
          title={`Solo ${track.name} (Alt-click: exclusive solo)`}
          data-testid={`${tid}-solo`}
          onClick={(e) => {
            if (e.altKey) {
              useEditor.getState().mutateSequence(`Solo ${track.name} only`, (seq) => {
                for (const t of seq.tracks) if (t.kind === 'audio') t.solo = t.id === track.id ? !track.solo || anySoloOthers(seq, track.id) : false;
              });
            } else editTrack(track.id, track.solo ? `Unsolo ${track.name}` : `Solo ${track.name}`, (t) => void (t.solo = !t.solo));
          }}
        >
          S
        </button>
        <button
          type="button"
          className={`au-tbtn au-tbtn--arm ${armed ? 'is-on' : ''}`}
          aria-pressed={armed}
          disabled={phase !== 'idle' || track.locked}
          title={track.locked ? `${track.name} is locked` : armed ? 'Disarm' : `Arm ${track.name} for voiceover recording`}
          data-testid={`${tid}-arm`}
          onClick={() => useAudioUi.getState().set({ armedTrackId: armed ? null : track.id })}
        >
          <I.Record size={10} />
        </button>
      </div>
      <div className="au-strip__body">
        <Fader
          value={track.volume}
          label={`${track.name} volume`}
          data-testid={`${tid}-fader`}
          onChange={(db) => editTrack(track.id, `Change ${track.name} volume`, (t) => void (t.volume = db), `au-vol-${track.id}`)}
        />
        <PeakReadout source={{ trackId: track.id }} testId={tid} />
      </div>
      <div className="au-strip__db">
        <ScrubNumber
          value={track.volume}
          min={FADER_MIN_DB}
          max={FADER_MAX_DB}
          step={0.1}
          precision={1}
          unit="dB"
          defaultValue={0}
          format={dbText}
          width="100%"
          aria-label={`${track.name} volume (dB)`}
          data-testid={`${tid}-db`}
          onChange={(v) => editTrack(track.id, `Change ${track.name} volume`, (t) => void (t.volume = v), `au-vol-${track.id}`)}
        />
      </div>
    </div>
  );
}

function anySoloOthers(seq: Sequence, id: string): boolean {
  return seq.tracks.some((t) => t.kind === 'audio' && t.id !== id && t.solo);
}

function MasterStrip({ seq }: { seq: Sequence }) {
  const m = seq.master;
  const [gr, setGr] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setGr(AudioEngine.get().limiterReduction()), 120);
    return () => window.clearInterval(id);
  }, []);
  return (
    <div className="au-strip au-strip--master" data-testid="au-master">
      <div className="au-strip__name">
        <I.Speaker size={13} />
        <span className="au-strip__label">Master</span>
      </div>
      <div className="au-strip__limiter">
        <button
          type="button"
          className={`au-tbtn au-tbtn--wide ${m.limiter ? 'is-on' : ''}`}
          aria-pressed={m.limiter}
          title="True-peak limiter on the master bus"
          data-testid="au-master-limiter"
          onClick={() => editMaster(m.limiter ? 'Turn off limiter' : 'Turn on limiter', (x) => void (x.limiter = !x.limiter))}
        >
          LIM
        </button>
        <span className={`au-strip__gr ${gr > 0.3 && m.limiter ? 'is-active' : ''}`} title="Limiter gain reduction" data-testid="au-master-gr">
          {m.limiter && gr > 0.05 ? `−${gr.toFixed(1)}` : '0.0'}
        </span>
      </div>
      <div className="au-strip__ceiling" title="Limiter ceiling (dBTP)">
        <span className="au-strip__small">Ceiling</span>
        <ScrubNumber
          value={m.ceiling}
          min={-12}
          max={0}
          step={0.1}
          precision={1}
          unit="dBTP"
          defaultValue={-1}
          disabled={!m.limiter}
          aria-label="Limiter ceiling"
          data-testid="au-master-ceiling"
          onChange={(v) => editMaster('Change limiter ceiling', (x) => void (x.ceiling = v), 'au-master-ceiling')}
        />
      </div>
      <div className="au-strip__body">
        <Fader value={m.gain} label="Master gain" data-testid="au-master-fader" onChange={(db) => editMaster('Change master gain', (x) => void (x.gain = db), 'au-master-gain')} />
        <PeakReadout source="master" testId="au-master" />
      </div>
      <div className="au-strip__db">
        <ScrubNumber
          value={m.gain}
          min={FADER_MIN_DB}
          max={FADER_MAX_DB}
          step={0.1}
          precision={1}
          unit="dB"
          defaultValue={0}
          format={dbText}
          width="100%"
          aria-label="Master gain (dB)"
          data-testid="au-master-db"
          onChange={(v) => editMaster('Change master gain', (x) => void (x.gain = v), 'au-master-gain')}
        />
      </div>
    </div>
  );
}

function elapsedText(ms: number) {
  const s = Math.max(0, ms / 1000);
  const m = Math.floor(s / 60);
  return `${m}:${(s % 60).toFixed(1).padStart(4, '0')}`;
}

function RecordBar({ seq }: { seq: Sequence }) {
  const ui = useAudioUi();
  const armed = seq.tracks.find((t) => t.id === ui.armedTrackId && t.kind === 'audio');
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (ui.phase !== 'recording') return;
    const id = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(id);
  }, [ui.phase]);
  const recording = ui.phase === 'recording';
  const busy = ui.phase !== 'idle';
  return (
    <div className={`au-recbar ${recording ? 'au-recbar--live' : ''}`} data-testid="au-recbar">
      <button
        type="button"
        className={`au-recbtn ${recording ? 'is-recording' : ''}`}
        disabled={(!armed && !busy) || ui.phase === 'saving'}
        onClick={() => toggleVoiceover()}
        title={recording ? 'Stop recording' : ui.phase === 'countdown' ? 'Cancel' : armed ? `Record a voiceover on ${armed.name} from the playhead` : 'Arm an audio track first'}
        data-testid="au-record"
      >
        {recording ? <span className="au-recbtn__stop" /> : <I.Record size={12} />}
        <span>{recording ? 'Stop' : ui.phase === 'countdown' ? 'Cancel' : ui.phase === 'saving' ? 'Saving' : 'Record'}</span>
      </button>
      <div className="au-recbar__status" data-testid="au-record-status">
        {ui.phase === 'idle' && (armed ? <>Armed: <b>{armed.name}</b></> : <span className="au-muted">Arm a track to record a voiceover</span>)}
        {ui.phase === 'countdown' && <span className="au-recbar__count">Recording in {ui.countdown}…</span>}
        {recording && (
          <>
            <span className="au-recbar__dot" />
            <span className="au-mono">{elapsedText(now - ui.recordStartedAt)}</span>
            <span className="au-muted">on {armed?.name ?? 'track'}</span>
          </>
        )}
        {ui.phase === 'saving' && <span className="au-muted">Saving take…</span>}
      </div>
      {busy && ui.phase !== 'saving' && (
        <div className="au-recbar__input" title="Microphone input level">
          <I.Mic size={12} />
          <MeterView source={{ read: inputLevel }} mono horizontal height={6} width={72} data-testid="au-input-meter" />
          {ui.phase === 'countdown' && (
            <button type="button" className="btn btn--ghost btn--xs" onClick={() => cancelVoiceover()} data-testid="au-record-cancel">
              Cancel
            </button>
          )}
        </div>
      )}
      {ui.phase === 'countdown' && (
        <div className="au-countdown" aria-live="assertive" data-testid="au-countdown">
          {ui.countdown}
        </div>
      )}
    </div>
  );
}

export function Mixer(_props: Record<string, unknown> = {}) {
  const hasProject = useEditor((s) => !!s.project);
  if (!hasProject) return null;
  return <MixerBody />;
}

function MixerBody() {
  const seq = useSequence();
  const tracks = seq.tracks.filter((t) => t.kind === 'audio');
  const anySolo = tracks.some((t) => t.solo);
  return (
    <div className="au-mixer" data-testid="au-mixer">
      <RecordBar seq={seq} />
      <div className="au-mixer__strips">
        {tracks.map((t) => (
          <ChannelStrip key={t.id} track={t} anySolo={anySolo} />
        ))}
        {!tracks.length && <div className="au-mixer__empty">No audio tracks</div>}
        <div className="au-mixer__spacer" />
        <MasterStrip seq={seq} />
      </div>
    </div>
  );
}
