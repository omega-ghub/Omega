import { useState } from 'react';
import { COLOR_SPACES, FRAME_RATES, isDropFrameRate } from '../../state/presets';
import { formatTimecode, useStore } from '../../state/store';
import type { Clip, Track } from '../../state/types';
import { formatDuration } from '../../ui/format';

export function Inspector() {
  const project = useStore((s) => s.project)!;
  const selectedIds = useStore((s) => s.selectedClipIds);
  const [tab, setTab] = useState<'clip' | 'project'>('clip');

  let selection: { clip: Clip; track: Track } | null = null;
  if (selectedIds.length === 1) {
    for (const t of project.sequence.tracks) {
      const c = t.clips.find((x) => x.id === selectedIds[0]);
      if (c) selection = { clip: c, track: t };
    }
  }

  return (
    <section className="panel inspector">
      <div className="panel__head panel__head--tabs">
        <button className={`panel__tab ${tab === 'clip' ? 'is-active' : ''}`} onClick={() => setTab('clip')}>
          Clip
        </button>
        <button className={`panel__tab ${tab === 'project' ? 'is-active' : ''}`} onClick={() => setTab('project')}>
          Sequence
        </button>
      </div>
      <div className="inspector__body">{tab === 'clip' ? <ClipPane selection={selection} count={selectedIds.length} /> : <ProjectPane />}</div>
    </section>
  );
}

function ClipPane({ selection, count }: { selection: { clip: Clip; track: Track } | null; count: number }) {
  const project = useStore((s) => s.project)!;
  const updateClip = useStore((s) => s.updateClip);
  if (!selection) {
    return <div className="inspector__empty">{count > 1 ? `${count} clips selected` : 'Select a clip on the timeline to see its properties.'}</div>;
  }
  const { clip, track } = selection;
  const asset = project.assets.find((a) => a.id === clip.assetId);
  const { fps, dropFrame } = project.settings;
  return (
    <div className="props">
      <div className="props__name">{clip.name}</div>
      <div className="props__sub">
        {track.name} · {asset?.kind ?? 'media'}
      </div>
      <Row label="Start" value={formatTimecode(clip.start, fps, dropFrame)} />
      <Row label="End" value={formatTimecode(clip.start + clip.duration, fps, dropFrame)} />
      <Row label="Duration" value={formatTimecode(clip.duration, fps, dropFrame)} />
      <Row label="Source in" value={formatTimecode(clip.inPoint, fps, dropFrame)} />
      {track.kind === 'video' && (
        <label className="field">
          <span>Opacity · {Math.round((clip.opacity ?? 1) * 100)}%</span>
          <input type="range" min={0} max={1} step={0.01} value={clip.opacity ?? 1} onChange={(e) => updateClip(clip.id, { opacity: Number(e.target.value) })} />
        </label>
      )}
      {track.kind === 'audio' && (
        <label className="field">
          <span>Gain · {(clip.gain ?? 0).toFixed(1)} dB</span>
          <input type="range" min={-48} max={12} step={0.5} value={clip.gain ?? 0} onChange={(e) => updateClip(clip.id, { gain: Number(e.target.value) })} />
        </label>
      )}
      {asset && (
        <div className="props__asset">
          <div className="props__title">Source</div>
          <Row label="File" value={asset.name} />
          {asset.width && <Row label="Size" value={`${asset.width}×${asset.height}`} />}
          {asset.fps && <Row label="Frame rate" value={`${asset.fps} fps`} />}
          <Row label="Length" value={formatDuration(asset.duration)} />
        </div>
      )}
    </div>
  );
}

function ProjectPane() {
  const project = useStore((s) => s.project)!;
  const handle = useStore((s) => s.handle);
  const s = project.settings;
  const update = (patch: Partial<typeof s>) =>
    useStore.setState((st) => ({
      project: st.project ? { ...st.project, settings: { ...st.project.settings, ...patch, dropFrame: isDropFrameRate(patch.fps ?? st.project.settings.fps) } } : st.project,
      dirty: true,
    }));
  return (
    <div className="props">
      <div className="props__name">{project.sequence.name}</div>
      <div className="props__sub">{project.name}</div>
      <div className="field-grid">
        <label className="field">
          <span>Width</span>
          <input type="number" value={s.width} min={16} step={2} onChange={(e) => update({ width: Number(e.target.value) || s.width })} />
        </label>
        <label className="field">
          <span>Height</span>
          <input type="number" value={s.height} min={16} step={2} onChange={(e) => update({ height: Number(e.target.value) || s.height })} />
        </label>
      </div>
      <label className="field">
        <span>Frame rate</span>
        <select value={s.fps} onChange={(e) => update({ fps: Number(e.target.value) })}>
          {FRAME_RATES.map((f) => (
            <option key={f} value={f}>
              {f} fps{isDropFrameRate(f) ? ' (drop-frame)' : ''}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Color space</span>
        <select value={s.colorSpace} onChange={(e) => update({ colorSpace: e.target.value as typeof s.colorSpace })}>
          {COLOR_SPACES.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <Row label="Audio" value={`${s.sampleRate / 1000} kHz stereo`} />
      {s.matchFirstClip && <div className="note">Waiting for the first clip to set size and frame rate.</div>}
      <div className="props__asset">
        <div className="props__title">File</div>
        <div className="props__path" title={handle?.filePath}>
          {handle?.filePath}
        </div>
        <div className="muted">Format {project.formatVersion}</div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="row">
      <span className="row__label">{label}</span>
      <span className="row__value">{value}</span>
    </div>
  );
}
