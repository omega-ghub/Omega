// Loudness panel: measures the sequence (or the in/out range) exactly as it
// exports — renderMix through the master bus, then ITU-R BS.1770-4 / EBU R128
// analysis — and checks it against delivery targets. Also hosts the
// auto-ducking tool.

import { useEffect, useRef, useState } from 'react';
import { analyzeLoudnessAsync, renderMix, type LoudnessResult } from '../../../engine/audio/engine';
import { useEditor, useSequence } from '../../../state/store';
import { sequenceDuration } from '../../../state/types';
import { I } from '../../../ui/Icons';
import { Section, Segmented, Select } from '../inspector/controls';
import { DuckingTool } from './DuckingTool';
import { LOUDNESS_PRESETS, presetById, useAudioUi, type LoudnessPreset } from './uiStore';
import './audio.css';

const fmt = (v: number, unit: string) => (Number.isFinite(v) ? `${v.toFixed(1)} ${unit}` : `−∞ ${unit}`);

// One analysis at a time across panel instances (panel + modal).
let running: AbortController | null = null;
const listeners = new Set<() => void>();
let progress = 0;
const notify = () => listeners.forEach((l) => l());

function useAnalysisProgress(): { busy: boolean; progress: number } {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);
  return { busy: !!running, progress };
}

/** Renders the mix and measures it; stores the result in the audio UI store. */
export async function runLoudnessAnalysis(range: 'sequence' | 'inout'): Promise<LoudnessResult | null> {
  const s = useEditor.getState();
  if (!s.project) return null;
  if (running) running.abort();
  const project = s.project;
  const seq = project.sequences.find((q) => q.id === project.activeSequenceId) ?? project.sequences[0];
  const dur = sequenceDuration(seq);
  let start = 0;
  let end = dur;
  if (range === 'inout' && seq.inPoint !== null && seq.outPoint !== null && seq.outPoint > seq.inPoint) {
    start = seq.inPoint;
    end = seq.outPoint;
  }
  if (!(end - start > 0.05)) {
    s.showToast('Nothing to analyze: the sequence is empty.', 'error');
    return null;
  }
  const ctl = new AbortController();
  running = ctl;
  progress = 0;
  notify();
  try {
    const buf = await renderMix(project, seq.id, start, end, seq.sampleRate, (f) => {
      progress = f * 0.8;
      notify();
    }, ctl.signal);
    if (ctl.signal.aborted) return null;
    const result = await analyzeLoudnessAsync(buf, (f) => {
      progress = 0.8 + f * 0.2;
      notify();
    }, ctl.signal);
    useAudioUi.getState().set({ analysis: { result, project, sequenceId: seq.id, start, end, range, at: Date.now() } });
    return result;
  } catch (err) {
    if ((err as DOMException)?.name !== 'AbortError') s.showToast(`Loudness analysis failed: ${(err as Error).message}`, 'error');
    return null;
  } finally {
    if (running === ctl) running = null;
    progress = 0;
    notify();
  }
}

export function cancelLoudnessAnalysis() {
  running?.abort();
}

function verdict(r: LoudnessResult, p: LoudnessPreset) {
  const dI = r.integrated - p.target;
  const loudOk = Number.isFinite(r.integrated) && Math.abs(dI) <= p.tolerance;
  const peakOk = !Number.isFinite(r.truePeak) || r.truePeak <= p.truePeak + 1e-9;
  return { loudOk, peakOk, dI };
}

function Badge({ ok, children, testId }: { ok: boolean; children: React.ReactNode; testId?: string }) {
  return (
    <span className={`au-badge ${ok ? 'au-badge--ok' : 'au-badge--bad'}`} data-testid={testId}>
      {ok ? <I.Check size={11} /> : <I.Warning size={11} />}
      {children}
    </span>
  );
}

/** Short-term loudness over time with the target line. */
function LoudnessGraph({ r, preset }: { r: LoudnessResult; preset: LoudnessPreset }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    const st = r.shortTerm;
    if (!c || !st || !st.length) return;
    const dpr = window.devicePixelRatio || 1;
    const w = (c.width = Math.max(1, Math.round(c.clientWidth * dpr)));
    const h = (c.height = Math.max(1, Math.round(c.clientHeight * dpr)));
    const g = c.getContext('2d')!;
    const css = getComputedStyle(c);
    const v = (n: string, f: string) => css.getPropertyValue(n).trim() || f;
    const lo = Math.min(-50, preset.target - 20);
    const hi = 0;
    const y = (l: number) => h - ((Math.max(lo, Math.min(hi, l)) - lo) / (hi - lo)) * h;
    g.clearRect(0, 0, w, h);
    g.strokeStyle = v('--border', 'rgba(255,255,255,0.07)');
    g.lineWidth = dpr;
    for (let l = -50; l <= 0; l += 10) {
      g.beginPath();
      g.moveTo(0, Math.round(y(l)) + 0.5);
      g.lineTo(w, Math.round(y(l)) + 0.5);
      g.stroke();
    }
    // target band
    g.fillStyle = v('--ok-soft', 'rgba(62,207,142,0.12)');
    g.fillRect(0, y(preset.target + preset.tolerance), w, y(preset.target - preset.tolerance) - y(preset.target + preset.tolerance));
    g.strokeStyle = v('--ok', '#3ecf8e');
    g.setLineDash([4 * dpr, 3 * dpr]);
    g.beginPath();
    g.moveTo(0, y(preset.target));
    g.lineTo(w, y(preset.target));
    g.stroke();
    g.setLineDash([]);
    // short-term curve
    g.strokeStyle = v('--accent', '#8b5cf6');
    g.lineWidth = 1.5 * dpr;
    g.beginPath();
    let pen = false;
    for (let x = 0; x < w; x++) {
      const i0 = Math.floor((x / w) * st.length);
      const i1 = Math.max(i0 + 1, Math.floor(((x + 1) / w) * st.length));
      let m = -Infinity;
      for (let i = i0; i < i1 && i < st.length; i++) if (st[i] > m) m = st[i];
      if (!Number.isFinite(m)) {
        pen = false;
        continue;
      }
      if (!pen) g.moveTo(x, y(m));
      else g.lineTo(x, y(m));
      pen = true;
    }
    g.stroke();
  }, [r, preset]);
  return <canvas ref={ref} className="au-lgraph" data-testid="au-loudness-graph" />;
}

export function LoudnessPanel(props: { autoStart?: boolean } & Record<string, unknown> = {}) {
  const hasProject = useEditor((s) => !!s.project);
  if (!hasProject) return null;
  return <LoudnessBody autoStart={!!props.autoStart} />;
}

function LoudnessBody({ autoStart }: { autoStart: boolean }) {
  const seq = useSequence();
  const project = useEditor((s) => s.project);
  const analysis = useAudioUi((s) => s.analysis);
  const presetId = useAudioUi((s) => s.presetId);
  const preset = presetById(presetId);
  const { busy, progress: pr } = useAnalysisProgress();
  const hasInOut = seq.inPoint !== null && seq.outPoint !== null && seq.outPoint > seq.inPoint;
  const [range, setRange] = useState<'sequence' | 'inout'>(hasInOut ? 'inout' : 'sequence');
  useEffect(() => {
    if (!hasInOut && range === 'inout') setRange('sequence');
  }, [hasInOut, range]);
  const started = useRef(false);
  useEffect(() => {
    if (autoStart && !started.current) {
      started.current = true;
      void runLoudnessAnalysis(hasInOut ? 'inout' : 'sequence');
    }
  }, [autoStart, hasInOut]);

  const r = analysis && analysis.sequenceId === seq.id ? analysis.result : null;
  const stale = !!analysis && analysis.project !== project;
  const v = r ? verdict(r, preset) : null;

  const setMasterForTarget = () => {
    if (!r || !Number.isFinite(r.integrated)) return;
    const delta = preset.target - r.integrated;
    const peakAfter = r.truePeak + delta;
    const needLimiter = peakAfter > preset.truePeak;
    useEditor.getState().mutateSequence(`Set master gain for ${preset.name}`, (s) => {
      s.master.gain = Math.round(Math.max(-60, Math.min(24, s.master.gain + delta)) * 10) / 10;
      if (needLimiter) {
        s.master.limiter = true;
        s.master.ceiling = Math.min(s.master.ceiling, preset.truePeak);
      }
    });
    useEditor
      .getState()
      .showToast(
        `Master gain ${delta >= 0 ? '+' : '−'}${Math.abs(delta).toFixed(1)} dB${needLimiter ? `, limiter at ${preset.truePeak} dBTP` : ''}. Re-analyze to confirm.`,
        'success',
      );
  };

  return (
    <div className="au-loud" data-testid="au-loudness">
      <div className="au-loud__bar">
        <Segmented
          value={range}
          options={[
            { value: 'sequence', label: 'Sequence', title: 'Measure the whole sequence' },
            { value: 'inout', label: 'In / Out', title: hasInOut ? 'Measure between the in and out points' : 'Set in and out points to measure a range' },
          ]}
          onChange={(x) => {
            if (x === 'inout' && !hasInOut) useEditor.getState().showToast('Set in and out points first (I / O).', 'info');
            else setRange(x);
          }}
          aria-label="Range to analyze"
          data-testid="au-loudness-range"
        />
        {busy ? (
          <button type="button" className="btn btn--sm" onClick={cancelLoudnessAnalysis} data-testid="au-loudness-cancel">
            Cancel
          </button>
        ) : (
          <button type="button" className="btn btn--sm btn--primary" onClick={() => void runLoudnessAnalysis(range)} data-testid="au-loudness-analyze">
            <I.Loudness size={13} />
            {r ? 'Re-analyze' : 'Analyze'}
          </button>
        )}
      </div>
      {busy && (
        <div className="au-progress" role="progressbar" aria-valuenow={Math.round(pr * 100)} data-testid="au-loudness-progress">
          <div className="au-progress__fill" style={{ width: `${Math.round(pr * 100)}%` }} />
        </div>
      )}

      <div className="au-loud__target">
        <span className="au-label">Target</span>
        <Select
          value={presetId}
          options={LOUDNESS_PRESETS.map((p) => ({ value: p.id, label: `${p.name}  ${p.target} LUFS / ${p.truePeak} dBTP` }))}
          onChange={(id) => useAudioUi.getState().set({ presetId: id })}
          aria-label="Loudness target"
          data-testid="au-loudness-preset"
        />
      </div>

      {r ? (
        <>
          <div className={`au-loud__hero ${stale ? 'au-loud__hero--stale' : ''}`}>
            <div className="au-loud__big" data-testid="au-loudness-integrated">
              {Number.isFinite(r.integrated) ? r.integrated.toFixed(1) : '−∞'}
              <span>LUFS</span>
            </div>
            <div className="au-loud__badges">
              <Badge ok={v!.loudOk} testId="au-loudness-badge-integrated">
                {v!.loudOk ? 'Loudness OK' : Number.isFinite(r.integrated) ? `${v!.dI > 0 ? '+' : '−'}${Math.abs(v!.dI).toFixed(1)} LU off target` : 'Silent'}
              </Badge>
              <Badge ok={v!.peakOk} testId="au-loudness-badge-peak">
                {v!.peakOk ? 'True peak OK' : `Peaks over ${preset.truePeak} dBTP`}
              </Badge>
            </div>
          </div>
          <dl className="au-loud__grid">
            <dt>Short-term max</dt>
            <dd data-testid="au-loudness-shortterm">{fmt(r.shortTermMax, 'LUFS')}</dd>
            <dt>Momentary max</dt>
            <dd data-testid="au-loudness-momentary">{fmt(r.momentaryMax, 'LUFS')}</dd>
            <dt>Loudness range</dt>
            <dd data-testid="au-loudness-lra">{r.range.toFixed(1)} LU</dd>
            <dt>True peak</dt>
            <dd data-testid="au-loudness-truepeak" className={v!.peakOk ? '' : 'au-bad'}>
              {fmt(r.truePeak, 'dBTP')}
            </dd>
          </dl>
          <LoudnessGraph r={r} preset={preset} />
          <div className="au-loud__foot">
            <span className="au-muted">
              {stale ? 'Edited since this measurement. ' : ''}
              {analysis!.range === 'inout' ? 'In/out range' : 'Whole sequence'}, {(analysis!.end - analysis!.start).toFixed(1)} s
            </span>
            <button type="button" className="btn btn--sm" disabled={!Number.isFinite(r.integrated) || busy} onClick={setMasterForTarget} data-testid="au-loudness-set-gain">
              Set master gain to hit target
            </button>
          </div>
          {preset.note && <p className="au-note">{preset.note}</p>}
        </>
      ) : (
        !busy && (
          <p className="au-note" data-testid="au-loudness-empty">
            Analyze to measure integrated loudness, loudness range and true peak exactly as the mix exports (ITU-R BS.1770-4, EBU R 128).
          </p>
        )
      )}

      <Section id="au-duck" title="Auto-duck music" defaultOpen={false} data-testid="au-duck-section">
        <DuckingTool />
      </Section>
    </div>
  );
}
