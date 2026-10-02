import { useEffect, useRef, useState } from 'react';
import { getFirstEncodableAudioCodec, getFirstEncodableVideoCodec } from 'mediabunny';
import { ExportCancelled, exportSequence, type ExportProgress } from '../../engine/exporter';
import { EXPORT_PRESETS } from '../../state/presets';
import { useStore } from '../../state/store';
import { sequenceDuration } from '../../state/types';
import { I } from '../../ui/Icons';
import { Modal } from '../../ui/Modal';
import { formatBytes, formatDuration } from '../../ui/format';
import { playerHost } from './playerHost';

const CODEC_NAMES: Record<string, string> = { avc: 'H.264 / AVC', hevc: 'H.265 / HEVC', av1: 'AV1', vp9: 'VP9', aac: 'AAC', opus: 'Opus' };

export function ExportDialog() {
  const project = useStore((s) => s.project)!;
  const close = () => useStore.getState().setExportOpen(false);
  const inPoint = useStore((s) => s.inPoint);
  const outPoint = useStore((s) => s.outPoint);
  const showToast = useStore((s) => s.showToast);

  const [presetId, setPresetId] = useState('yt');
  const [range, setRange] = useState<'all' | 'inout'>('all');
  const [fileName, setFileName] = useState(project.name);
  const [codecs, setCodecs] = useState<{ video: string | null; audio: string | null } | null>(null);
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [result, setResult] = useState<{ path: string; bytes: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const preset = EXPORT_PRESETS.find((p) => p.id === presetId)!;
  const { width, height, fps, sampleRate } = project.settings;
  const duration = sequenceDuration(project.sequence);
  const hasInOut = inPoint !== null && outPoint !== null && outPoint > inPoint;
  const start = range === 'inout' && hasInOut ? inPoint! : 0;
  const end = range === 'inout' && hasInOut ? outPoint! : duration;
  const bitrate = preset.bitrateMbps(height, fps);
  const estimate = ((bitrate * 1e6 + preset.audioKbps * 1e3) * (end - start)) / 8;

  useEffect(() => {
    let live = true;
    setCodecs(null);
    void (async () => {
      const video = await getFirstEncodableVideoCodec(preset.videoCodecs, { width, height });
      const audio = await getFirstEncodableAudioCodec(preset.audioCodecs, { numberOfChannels: 2, sampleRate });
      if (live) setCodecs({ video, audio });
    })();
    return () => {
      live = false;
    };
  }, [preset, width, height, sampleRate]);

  const run = async () => {
    const path = await window.omega.dialogs.pickExportPath(fileName || project.name, preset.container);
    if (!path) return;
    playerHost.current?.pause();
    const controller = new AbortController();
    abortRef.current = controller;
    setError(null);
    setResult(null);
    setProgress({ phase: 'preparing', fraction: 0 });
    try {
      const out = await exportSequence(project, { preset, width, height, fps, start, end }, setProgress, controller.signal);
      await window.omega.files.writeBinary(path, out.buffer);
      setResult({ path, bytes: out.buffer.byteLength });
      showToast('Export finished');
    } catch (err) {
      if (err instanceof ExportCancelled) setError('Export cancelled.');
      else setError((err as Error).message);
      setProgress(null);
    } finally {
      abortRef.current = null;
    }
  };

  const busy = progress !== null && progress.phase !== 'done';

  return (
    <Modal onClose={() => !busy && close()} width={820} className="export">
      <div className="export__head">
        <div className="newproj__title">Export</div>
        <button className="icon-btn" onClick={close} disabled={busy} aria-label="Close">
          <I.Close />
        </button>
      </div>
      <div className="export__body">
        <div className="export__left">
          <div className="label">Destination</div>
          <div className="preset-list">
            {EXPORT_PRESETS.map((p) => (
              <button key={p.id} className={`preset ${presetId === p.id ? 'is-active' : ''}`} onClick={() => setPresetId(p.id)} disabled={busy}>
                <span className="preset__name">{p.name}</span>
                <span className="preset__hint">{p.hint}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="export__right">
          <label className="field">
            <span>File name</span>
            <input value={fileName} onChange={(e) => setFileName(e.target.value)} disabled={busy} />
          </label>
          <div className="field">
            <span>Range</span>
            <div className="seg">
              <button className={range === 'all' ? 'is-active' : ''} onClick={() => setRange('all')} disabled={busy}>
                Entire sequence
              </button>
              <button className={range === 'inout' ? 'is-active' : ''} onClick={() => setRange('inout')} disabled={busy || !hasInOut} title={hasInOut ? '' : 'Set in and out points with I and O'}>
                In to out
              </button>
            </div>
          </div>
          <div className="summary summary--export">
            <div className="row">
              <span className="row__label">Video</span>
              <span className="row__value">
                {width}×{height} · {fps} fps · {bitrate} Mbps
              </span>
            </div>
            <div className="row">
              <span className="row__label">Codec</span>
              <span className="row__value">{codecs === null ? 'Checking…' : codecs.video ? CODEC_NAMES[codecs.video] : 'None available'}</span>
            </div>
            <div className="row">
              <span className="row__label">Audio</span>
              <span className="row__value">{codecs === null ? '…' : codecs.audio ? `${CODEC_NAMES[codecs.audio]} · ${preset.audioKbps} kbps · ${sampleRate / 1000} kHz` : 'No audio encoder'}</span>
            </div>
            <div className="row">
              <span className="row__label">Length</span>
              <span className="row__value">{formatDuration(end - start)}</span>
            </div>
            <div className="row">
              <span className="row__label">Estimated size</span>
              <span className="row__value">{formatBytes(estimate)}</span>
            </div>
          </div>

          {progress && (
            <div className="progress">
              <div className="progress__bar">
                <div className="progress__fill" style={{ width: `${Math.round(progress.fraction * 100)}%` }} />
              </div>
              <div className="progress__text">
                {progress.phase === 'preparing' && 'Preparing encoders…'}
                {progress.phase === 'audio' && `Mixing audio… ${Math.round(progress.fraction * 100)}%`}
                {progress.phase === 'video' && `Rendering ${progress.detail ?? ''} · ${Math.round(progress.fraction * 100)}%`}
                {progress.phase === 'finalizing' && 'Writing file…'}
                {progress.phase === 'done' && 'Done'}
              </div>
            </div>
          )}
          {result && (
            <div className="note note--ok">
              Saved {formatBytes(result.bytes)} to <b>{result.path}</b>
              <button className="btn btn--small btn--ghost" onClick={() => window.omega.files.showInFolder(result.path)}>
                Show in folder
              </button>
            </div>
          )}
          {error && <div className="error">{error}</div>}

          <div className="newproj__actions">
            {busy ? (
              <button className="btn btn--ghost" onClick={() => abortRef.current?.abort()}>
                Cancel
              </button>
            ) : (
              <button className="btn btn--ghost" onClick={close}>
                Close
              </button>
            )}
            <button className="btn btn--accent btn--large" onClick={run} disabled={busy || duration === 0 || !codecs?.video}>
              <I.Export size={16} /> Export
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
