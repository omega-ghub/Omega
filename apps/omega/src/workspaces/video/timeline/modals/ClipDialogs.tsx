// Clip dialogs: speed/duration, audio gain, paste attributes, properties.
import { useMemo, useState } from 'react';
import { getPeaks } from '../../../../engine/audio/engine';
import * as ops from '../../../../engine/edit/ops';
import { exactRate, formatTimecode, sourceSpan } from '../../../../engine/time';
import { useEditor } from '../../../../state/store';
import type { Clip } from '../../../../state/types';
import { activeSequence, findClip } from '../../../../state/types';
import { applyAttributes, editSeq, type AttrOptions } from '../commands';
import { Check, Dialog, Row, Segmented } from '../Dialog';
import { TimecodeInput } from '../TimecodeInput';

function useClips(ids: unknown): { clips: Clip[]; seq: ReturnType<typeof activeSequence> } {
  const project = useEditor((s) => s.project!);
  const selection = useEditor((s) => s.selection.clipIds);
  const seq = activeSequence(project);
  const list = Array.isArray(ids) && ids.length ? (ids as string[]) : selection;
  const clips = list.map((id) => findClip(seq, id)?.clip).filter((c): c is Clip => !!c);
  return { clips, seq };
}

// ---------------------------------------------------------------------------
// Speed / duration
// ---------------------------------------------------------------------------

export function SpeedDialog({ props, onClose }: { props?: Record<string, unknown>; onClose: () => void }) {
  const { clips, seq } = useClips(props?.clipIds ?? (props?.clipId ? [props.clipId] : null));
  const timed = clips.filter((c) => c.kind === 'media' || c.kind === 'sequence');
  const first = timed[0];
  const [speed, setSpeed] = useState(first ? Math.round(first.speed * 10000) / 100 : 100);
  const [reverse, setReverse] = useState(first?.reverse ?? false);
  const [ripple, setRipple] = useState(true);
  const [keepDuration, setKeepDuration] = useState(false);
  const [frameBlend, setFrameBlend] = useState(first?.frameBlend ?? false);
  const span = first ? sourceSpan(first) : 0;
  const fr = 1 / exactRate(seq.fps);
  const duration = first ? (keepDuration ? first.duration : Math.max(fr, span / Math.max(0.0001, speed / 100))) : 0;
  const valid = speed >= 1 && speed <= 10000 && !!first;
  if (!first) {
    return (
      <Dialog title="Speed/Duration" onClose={onClose} testId="tl-speed-dialog">
        <p className="tl-muted">Select a video, audio or nested clip.</p>
      </Dialog>
    );
  }
  const apply = () => {
    if (!valid) return;
    const sp = speed / 100;
    editSeq(timed.length > 1 ? 'Speed/duration (clips)' : 'Speed/duration', (s, p) => {
      for (const c of timed) {
        const f = findClip(s, c.id);
        if (!f || f.track.locked) continue;
        ops.setSpeed(p, s, c.id, sp, { reverse, ripple, keepDuration });
        const g = findClip(s, c.id);
        if (g) g.clip.frameBlend = frameBlend;
      }
    });
    onClose();
  };
  return (
    <Dialog title="Speed/Duration" onClose={onClose} onSubmit={apply} width={420} testId="tl-speed-dialog" submitDisabled={!valid}>
      <Row label="Speed">
        <span className="tl-inline">
          <input
            className="tl-input tl-input--num"
            type="number"
            min={1}
            max={10000}
            step={1}
            value={speed}
            onChange={(e) => setSpeed(Number(e.target.value))}
            data-testid="tl-speed-percent"
          />
          <span className="tl-muted">%</span>
        </span>
      </Row>
      <Row label="Duration" hint={timed.length > 1 ? `Applies the same speed to ${timed.length} clips.` : undefined}>
        <TimecodeInput
          value={duration}
          fps={seq.fps}
          dropFrame={seq.dropFrame}
          testId="tl-speed-duration"
          onChange={(d) => {
            if (d < fr || keepDuration) return;
            setSpeed(Math.round((span / d) * 10000) / 100);
          }}
        />
      </Row>
      <div className="tl-checks">
        <Check checked={reverse} onChange={setReverse} label="Reverse speed" testId="tl-speed-reverse" />
        <Check checked={ripple} onChange={setRipple} label="Ripple edit, shifting trailing clips" testId="tl-speed-ripple" />
        <Check checked={keepDuration} onChange={setKeepDuration} label="Keep duration (change source range)" testId="tl-speed-keep" />
        <Check checked={frameBlend} onChange={setFrameBlend} label="Frame blending" testId="tl-speed-blend" />
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Audio gain
// ---------------------------------------------------------------------------

/** Max absolute sample (0..1) over a clip's source range, or null without peaks. */
export function clipPeak(clip: Clip): number | null {
  if (!clip.assetId) return null;
  const p = getPeaks(clip.assetId);
  if (!p) return null;
  const perSec = p.sampleRate / p.bucket;
  const a = Math.max(0, Math.floor(clip.inPoint * perSec));
  const b = Math.min(p.data.length / 2, Math.ceil((clip.inPoint + sourceSpan(clip)) * perSec));
  let m = 0;
  for (let i = a; i < b; i++) m = Math.max(m, Math.abs(p.data[i * 2]), Math.abs(p.data[i * 2 + 1]));
  return m;
}

export function AudioGainDialog({ props, onClose }: { props?: Record<string, unknown>; onClose: () => void }) {
  const { clips } = useClips(props?.clipIds ?? (props?.clipId ? [props.clipId] : null));
  const audioClips = clips.filter((c) => c.kind === 'media' || c.kind === 'sequence');
  const peaks = useMemo(() => audioClips.map((c) => clipPeak(c)), [audioClips]);
  const canNormalize = audioClips.length > 0 && peaks.every((p) => p !== null && p > 0);
  const [mode, setMode] = useState<'set' | 'adjust' | 'normalize'>('set');
  const [setDb, setSetDb] = useState(audioClips[0]?.audio.gain ?? 0);
  const [adjDb, setAdjDb] = useState(0);
  const [normDb, setNormDb] = useState(-1);
  const peakDb = canNormalize ? Math.max(...peaks.map((p, i) => 20 * Math.log10(p!) + audioClips[i].audio.gain)) : null;
  if (!audioClips.length) {
    return (
      <Dialog title="Audio Gain" onClose={onClose} testId="tl-gain-dialog">
        <p className="tl-muted">Select clips with audio.</p>
      </Dialog>
    );
  }
  const clamp = (v: number) => Math.round(Math.max(-96, Math.min(24, v)) * 10) / 10;
  const apply = () => {
    editSeq('Audio gain', (s) => {
      audioClips.forEach((c, i) => {
        const f = findClip(s, c.id);
        if (!f || f.track.locked) return;
        const cur = f.clip.audio.gain;
        let next = cur;
        if (mode === 'set') next = setDb;
        else if (mode === 'adjust') next = cur + adjDb;
        else if (peaks[i]) next = normDb - 20 * Math.log10(peaks[i]!);
        f.clip.audio.gain = clamp(next);
      });
    });
    onClose();
  };
  const options: { value: 'set' | 'adjust' | 'normalize'; label: string }[] = [
    { value: 'set', label: 'Set' },
    { value: 'adjust', label: 'Adjust' },
    ...(canNormalize ? [{ value: 'normalize' as const, label: 'Normalize' }] : []),
  ];
  return (
    <Dialog title="Audio Gain" onClose={onClose} onSubmit={apply} width={400} testId="tl-gain-dialog">
      <Segmented value={mode} options={options} onChange={setMode} testId="tl-gain-mode" />
      <div className="tl-gap" />
      {mode === 'set' && (
        <Row label="Set gain to">
          <span className="tl-inline">
            <input className="tl-input tl-input--num" type="number" step={0.5} min={-96} max={24} value={setDb} onChange={(e) => setSetDb(Number(e.target.value))} data-testid="tl-gain-set" />
            <span className="tl-muted">dB</span>
          </span>
        </Row>
      )}
      {mode === 'adjust' && (
        <Row label="Adjust gain by">
          <span className="tl-inline">
            <input className="tl-input tl-input--num" type="number" step={0.5} min={-48} max={48} value={adjDb} onChange={(e) => setAdjDb(Number(e.target.value))} data-testid="tl-gain-adjust" />
            <span className="tl-muted">dB</span>
          </span>
        </Row>
      )}
      {mode === 'normalize' && (
        <Row label="Normalize max peak to" hint={peakDb !== null ? `Current peak ${peakDb.toFixed(1)} dBFS` : undefined}>
          <span className="tl-inline">
            <input className="tl-input tl-input--num" type="number" step={0.5} min={-60} max={0} value={normDb} onChange={(e) => setNormDb(Number(e.target.value))} data-testid="tl-gain-normalize" />
            <span className="tl-muted">dBFS</span>
          </span>
        </Row>
      )}
      <p className="tl-muted tl-small">
        {audioClips.length} clip{audioClips.length > 1 ? 's' : ''} · current gain {audioClips.length === 1 ? `${audioClips[0].audio.gain.toFixed(1)} dB` : 'varies'}
      </p>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Paste attributes
// ---------------------------------------------------------------------------

const ATTRS: { key: keyof AttrOptions; label: string }[] = [
  { key: 'transform', label: 'Motion and opacity' },
  { key: 'crop', label: 'Crop' },
  { key: 'effects', label: 'Effects' },
  { key: 'grade', label: 'Color grade' },
  { key: 'audio', label: 'Audio (gain, pan, EQ, dynamics)' },
  { key: 'speed', label: 'Speed' },
];

export function PasteAttributesDialog({ props, onClose }: { props?: Record<string, unknown>; onClose: () => void }) {
  const { clips } = useClips(props?.clipIds);
  const clipboard = useEditor((s) => s.clipboard);
  const src = clipboard?.clips[0]?.clip;
  const [opts, setOpts] = useState<AttrOptions>({ transform: true, crop: true, effects: true, grade: true, audio: true, speed: false });
  const apply = () => {
    if (!src) return;
    const targets = clips.map((c) => c.id);
    editSeq('Paste attributes', (s, p) => {
      for (const id of targets) {
        const f = findClip(s, id);
        if (!f || f.track.locked || f.clip.id === src.id) continue;
        applyAttributes(src, f.clip, opts);
        if (opts.speed && (f.clip.kind === 'media' || f.clip.kind === 'sequence')) ops.setSpeed(p, s, id, src.speed, { reverse: src.reverse, ripple: false });
      }
    });
    onClose();
  };
  return (
    <Dialog title="Paste Attributes" onClose={onClose} onSubmit={src && clips.length ? apply : undefined} submitLabel="Paste" width={400} testId="tl-paste-attrs-dialog">
      {src ? (
        <p className="tl-muted tl-small">
          From <strong className="tl-strong">{src.name}</strong> to {clips.length} clip{clips.length === 1 ? '' : 's'}
        </p>
      ) : (
        <p className="tl-muted">Copy a clip first.</p>
      )}
      <div className="tl-checks">
        {ATTRS.map((a) => (
          <Check key={a.key} checked={opts[a.key]} onChange={(v) => setOpts({ ...opts, [a.key]: v })} label={a.label} testId={`tl-paste-${a.key}`} />
        ))}
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------

export function ClipPropertiesDialog({ props, onClose }: { props?: Record<string, unknown>; onClose: () => void }) {
  const project = useEditor((s) => s.project!);
  const seq = activeSequence(project);
  const f = typeof props?.clipId === 'string' ? findClip(seq, props.clipId) : null;
  const [name, setName] = useState(f?.clip.name ?? '');
  const [notes, setNotes] = useState(f?.clip.notes ?? '');
  if (!f) {
    return (
      <Dialog title="Clip Properties" onClose={onClose}>
        <p className="tl-muted">The clip no longer exists.</p>
      </Dialog>
    );
  }
  const c = f.clip;
  const asset = c.assetId ? project.assets.find((a) => a.id === c.assetId) : undefined;
  const nested = c.sequenceId ? project.sequences.find((s) => s.id === c.sequenceId) : undefined;
  const tc = (t: number, start = seq.startTimecode) => formatTimecode(t, seq.fps, seq.dropFrame, start);
  const save = () => {
    editSeq('Clip properties', (s) => {
      const g = findClip(s, c.id);
      if (!g) return;
      if (name.trim()) g.clip.name = name.trim();
      g.clip.notes = notes || undefined;
    });
    onClose();
  };
  const rows: [string, string][] = [
    ['Type', c.kind === 'media' ? (asset?.kind ?? 'media') : c.kind === 'sequence' ? 'Nested sequence' : c.kind],
    ['Track', f.track.name],
    ['Start', tc(c.start)],
    ['End', tc(c.start + c.duration)],
    ['Duration', tc(c.duration, 0)],
  ];
  if (c.kind === 'media' || c.kind === 'sequence') {
    rows.push(['Source in', tc(c.inPoint, 0)], ['Source out', tc(c.inPoint + sourceSpan(c), 0)], ['Speed', `${Math.round(c.speed * 1000) / 10}%${c.reverse ? ' reversed' : ''}${c.holdFrame !== null ? ' · freeze' : ''}`]);
  }
  if (asset) {
    rows.push(['Media', asset.name], ['Path', asset.path]);
    if (asset.width) rows.push(['Frame', `${asset.width} × ${asset.height}${asset.fps ? ` · ${Math.round(asset.fps * 1000) / 1000} fps` : ''}`]);
    if (asset.codec || asset.audioCodec) rows.push(['Codecs', [asset.codec, asset.audioCodec].filter(Boolean).join(' · ')]);
    if (asset.hasAudio) rows.push(['Audio', `${asset.channels ?? '?'} ch · ${asset.sampleRate ? `${asset.sampleRate / 1000} kHz` : ''}`]);
    if (asset.offline) rows.push(['Status', 'Offline']);
  }
  if (nested) rows.push(['Sequence', `${nested.name} · ${nested.width} × ${nested.height} · ${nested.fps} fps`]);
  rows.push(['Effects', c.effects.length ? c.effects.map((e) => e.type).join(', ') : 'None']);
  return (
    <Dialog title="Clip Properties" onClose={onClose} onSubmit={save} submitLabel="Save" width={480} testId="tl-props-dialog">
      <Row label="Name">
        <input className="tl-input" value={name} onChange={(e) => setName(e.target.value)} />
      </Row>
      <dl className="tl-props">
        {rows.map(([k, v]) => (
          <div key={k} className="tl-props__row">
            <dt>{k}</dt>
            <dd className={/Start|End|Duration|Source/.test(k) ? 'tl-mono' : ''}>{v}</dd>
          </div>
        ))}
      </dl>
      <Row label="Notes">
        <textarea className="tl-input tl-textarea" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Row>
    </Dialog>
  );
}
