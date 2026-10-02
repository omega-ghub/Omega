// Clip audio controls (used by the Inspector and the Audio workspace):
// volume and pan with keyframes, channel routing, fades, mute, peak
// normalization, a 5-band EQ with a live response curve, and a compressor.
// A video clip resolves to its linked audio clip.

import { useState } from 'react';
import { clipPeakDb } from '../../../engine/audio/engine';
import { compressorCurve, formatDb } from '../../../engine/audio/dsp';
import { useEditor } from '../../../state/store';
import type { Clip, ClipAudio, Project } from '../../../state/types';
import { activeSequence } from '../../../state/types';
import { I } from '../../../ui/Icons';
import { editClip, editField, editParam, ParamRow, ScrubNumber, Section, Select, Segmented, Slider, Toggle, useParam } from '../inspector/controls';
import { formatPan } from './controls';
import { EqCurve } from './EqCurve';
import './audio.css';

type Eq = ClipAudio['eq'];
type Comp = ClipAudio['comp'];

/** The audio clip for a clip id: itself on an audio track, else its linked audio partner. */
export function resolveAudioClipId(project: Project | null, clipId: string): string | null {
  if (!project || !clipId) return null;
  const seq = activeSequence(project);
  let found: { clip: Clip; kind: string } | null = null;
  for (const t of seq.tracks)
    for (const c of t.clips)
      if (c.id === clipId) found = { clip: c, kind: t.kind };
  if (!found) return null;
  if (found.kind === 'audio') return clipId;
  const linkId = found.clip.linkId;
  if (!linkId) return null;
  for (const t of seq.tracks) if (t.kind === 'audio') for (const c of t.clips) if (c.linkId === linkId) return c.id;
  return null;
}

/** Normalizes the clips' peak to `target` dBFS by changing clip gain (keyframes shift together). One undo step. */
export async function normalizeClipsPeak(clipIds: string[], target = -1): Promise<void> {
  const s = useEditor.getState();
  if (!s.project || !clipIds.length) return;
  const project = s.project;
  const seq = activeSequence(project);
  const plans: { id: string; delta: number }[] = [];
  for (const id of clipIds) {
    const clip = seq.tracks.flatMap((t) => t.clips).find((c) => c.id === id);
    if (!clip) continue;
    const peak = await clipPeakDb(project, clip);
    if (!Number.isFinite(peak)) continue;
    const kfs = clip.keyframes['audio.gain'];
    const loudest = kfs?.length ? Math.max(...kfs.map((k) => k.v)) : clip.audio.gain;
    plans.push({ id, delta: target - (peak + loudest) });
  }
  if (!plans.length) {
    useEditor.getState().showToast('Nothing to normalize: the clip is silent or still decoding.', 'info');
    return;
  }
  useEditor.getState().mutateSequence(plans.length === 1 ? `Normalize peak to ${target} dBFS` : `Normalize ${plans.length} clips to ${target} dBFS`, (draft) => {
    for (const p of plans) {
      const clip = draft.tracks.flatMap((t) => t.clips).find((c) => c.id === p.id);
      if (!clip) continue;
      const round = (v: number) => Math.round(v * 100) / 100;
      const kfs = clip.keyframes['audio.gain'];
      if (kfs?.length) for (const k of kfs) k.v = round(k.v + p.delta);
      clip.audio.gain = round(clip.audio.gain + p.delta);
    }
  });
  const d = plans[0].delta;
  useEditor.getState().showToast(plans.length === 1 ? `Clip gain ${d >= 0 ? '+' : '−'}${Math.abs(d).toFixed(1)} dB (peak at ${target} dBFS)` : `Normalized ${plans.length} clips`, 'success');
}

const CHANNEL_OPTIONS: { value: ClipAudio['channelMode']; label: string }[] = [
  { value: 'stereo', label: 'Stereo' },
  { value: 'mono', label: 'Mono (sum L+R)' },
  { value: 'left', label: 'Left channel to both' },
  { value: 'right', label: 'Right channel to both' },
  { value: 'swap', label: 'Swap left and right' },
];

export function AudioClipSection({ clipId }: { clipId: string }) {
  const audioId = useEditor((s) => resolveAudioClipId(s.project, clipId));
  const isLinkedVideo = audioId !== null && audioId !== clipId;
  if (!clipId) return null;
  if (!audioId) {
    return (
      <div className="au-clip au-clip--none" data-testid="au-clip-none">
        <I.Mute size={14} />
        <span>This clip has no audio on an audio track.</span>
      </div>
    );
  }
  return <ClipAudioBody clipId={audioId} linked={isLinkedVideo} />;
}

function ClipAudioBody({ clipId, linked }: { clipId: string; linked: boolean }) {
  const clip = useEditor((s) => (s.project ? activeSequence(s.project).tracks.flatMap((t) => t.clips).find((c) => c.id === clipId) ?? null : null));
  const sampleRate = useEditor((s) => (s.project ? activeSequence(s.project).sampleRate : 48000));
  const gain = useParam(clipId, 'audio.gain');
  const pan = useParam(clipId, 'audio.pan');
  const [normalizing, setNormalizing] = useState(false);
  if (!clip) return null;
  const a = clip.audio;
  const setEq = (patch: Partial<Eq>, key: string, label = 'Change EQ') =>
    editClip(clipId, label, (c) => Object.assign(c.audio.eq, patch), { coalesceKey: `au:${clipId}:eq:${key}` });
  const setComp = (patch: Partial<Comp>, key: string, label = 'Change compressor') =>
    editClip(clipId, label, (c) => Object.assign(c.audio.comp, patch), { coalesceKey: `au:${clipId}:comp:${key}` });

  return (
    <div className="au-clip" data-testid="au-clip">
      {linked && <div className="au-clip__linked">Linked audio: {clip.name}</div>}
      <Section id="au-volume" title="Volume" data-testid="au-sec-volume">
        <ParamRow label="Gain" clipId={clipId} path="audio.gain" onReset={() => editParam(clipId, 'audio.gain', 0)}>
          <Slider value={gain} min={-60} max={24} step={0.1} defaultValue={0} aria-label="Clip gain" data-testid="au-gain-slider" onChange={(v) => editParam(clipId, 'audio.gain', Math.round(v * 10) / 10)} />
          <ScrubNumber value={gain} min={-96} max={24} step={0.1} unit="dB" defaultValue={0} format={(v) => formatDb(v)} aria-label="Clip gain (dB)" data-testid="au-gain" onChange={(v) => editParam(clipId, 'audio.gain', v)} />
        </ParamRow>
        <ParamRow label="Pan" clipId={clipId} path="audio.pan" onReset={() => editParam(clipId, 'audio.pan', 0)}>
          <Slider value={pan} min={-1} max={1} step={0.01} origin={0} defaultValue={0} aria-label="Clip pan" data-testid="au-pan-slider" onChange={(v) => editParam(clipId, 'audio.pan', Math.round(v * 100) / 100)} />
          <ScrubNumber value={pan} min={-1} max={1} step={0.01} defaultValue={0} format={formatPan} aria-label="Clip pan" data-testid="au-pan" onChange={(v) => editParam(clipId, 'audio.pan', v)} />
        </ParamRow>
        <ParamRow label="Channels">
          <Select
            value={a.channelMode}
            options={CHANNEL_OPTIONS}
            aria-label="Channel routing"
            data-testid="au-channel-mode"
            onChange={(v) => editField(clipId, 'channelMode', 'Change channel routing', (c) => void (c.audio.channelMode = v))}
          />
        </ParamRow>
        <ParamRow label="Mute">
          <Toggle checked={a.mute} aria-label="Mute clip" data-testid="au-mute" onChange={(on) => editClip(clipId, on ? 'Mute clip' : 'Unmute clip', (c) => void (c.audio.mute = on))} />
        </ParamRow>
        <div className="au-clip__actions">
          <button
            type="button"
            className="btn btn--sm"
            disabled={normalizing}
            data-testid="au-normalize"
            onClick={async () => {
              setNormalizing(true);
              try {
                await normalizeClipsPeak([clipId], -1);
              } finally {
                setNormalizing(false);
              }
            }}
          >
            <I.Volume size={13} />
            {normalizing ? 'Measuring…' : 'Normalize peak to −1 dBFS'}
          </button>
        </div>
      </Section>

      <Section id="au-fades" title="Fades" data-testid="au-sec-fades">
        <ParamRow label="Fade in">
          <ScrubNumber value={a.fadeIn} min={0} max={clip.duration} step={0.01} unit="s" defaultValue={0} aria-label="Fade in (s)" data-testid="au-fade-in" onChange={(v) => editField(clipId, 'fadeIn', 'Change audio fade in', (c) => void (c.audio.fadeIn = v))} />
        </ParamRow>
        <ParamRow label="Fade out">
          <ScrubNumber value={a.fadeOut} min={0} max={clip.duration} step={0.01} unit="s" defaultValue={0} aria-label="Fade out (s)" data-testid="au-fade-out" onChange={(v) => editField(clipId, 'fadeOut', 'Change audio fade out', (c) => void (c.audio.fadeOut = v))} />
        </ParamRow>
        <ParamRow label="Curve">
          <Segmented
            value={a.fadeCurve ?? 'linear'}
            options={[
              { value: 'linear', label: 'Linear', title: 'Linear amplitude' },
              { value: 'equalPower', label: 'Equal power', title: 'Constant power (sin/cos), smoother for music' },
            ]}
            aria-label="Fade curve"
            data-testid="au-fade-curve"
            onChange={(v) => editClip(clipId, 'Change fade curve', (c) => void (c.audio.fadeCurve = v))}
          />
        </ParamRow>
      </Section>

      <Section
        id="au-eq"
        title="EQ"
        enabled={a.eq.enabled}
        onEnabledChange={(on) => editClip(clipId, on ? 'Enable EQ' : 'Bypass EQ', (c) => void (c.audio.eq.enabled = on))}
        data-testid="au-sec-eq"
      >
        <EqCurve eq={a.eq} sampleRate={sampleRate} disabled={!a.eq.enabled} onChange={(patch, _final, band) => setEq(patch, `drag-${band}`, 'Adjust EQ band')} />
        <EqRows eq={a.eq} setEq={setEq} />
      </Section>

      <Section
        id="au-comp"
        title="Compressor"
        enabled={a.comp.enabled}
        onEnabledChange={(on) => editClip(clipId, on ? 'Enable compressor' : 'Bypass compressor', (c) => void (c.audio.comp.enabled = on))}
        data-testid="au-sec-comp"
      >
        <div className="au-comp">
          <CompCurve comp={a.comp} />
          <div className="au-comp__params">
            <ParamRow label="Threshold" reserveKeyframe={false}>
              <ScrubNumber value={a.comp.threshold} min={-60} max={0} step={0.5} unit="dB" defaultValue={-18} aria-label="Threshold" data-testid="au-comp-threshold" onChange={(v) => setComp({ threshold: v }, 'threshold')} />
            </ParamRow>
            <ParamRow label="Ratio" reserveKeyframe={false}>
              <ScrubNumber value={a.comp.ratio} min={1} max={20} step={0.1} defaultValue={3} format={(v) => `${v.toFixed(1)}:1`} aria-label="Ratio" data-testid="au-comp-ratio" onChange={(v) => setComp({ ratio: v }, 'ratio')} />
            </ParamRow>
            <ParamRow label="Attack" reserveKeyframe={false}>
              <ScrubNumber value={a.comp.attack} min={0} max={1} step={0.001} displayScale={1000} precision={0} unit="ms" defaultValue={0.01} aria-label="Attack" data-testid="au-comp-attack" onChange={(v) => setComp({ attack: v }, 'attack')} />
            </ParamRow>
            <ParamRow label="Release" reserveKeyframe={false}>
              <ScrubNumber value={a.comp.release} min={0} max={1} step={0.005} displayScale={1000} precision={0} unit="ms" defaultValue={0.15} aria-label="Release" data-testid="au-comp-release" onChange={(v) => setComp({ release: v }, 'release')} />
            </ParamRow>
            <ParamRow label="Knee" reserveKeyframe={false}>
              <ScrubNumber value={a.comp.knee} min={0} max={40} step={0.5} unit="dB" defaultValue={6} aria-label="Knee" data-testid="au-comp-knee" onChange={(v) => setComp({ knee: v }, 'knee')} />
            </ParamRow>
            <ParamRow label="Makeup" reserveKeyframe={false}>
              <ScrubNumber value={a.comp.makeup} min={-12} max={24} step={0.1} unit="dB" defaultValue={0} aria-label="Makeup gain" data-testid="au-comp-makeup" onChange={(v) => setComp({ makeup: v }, 'makeup')} />
            </ParamRow>
          </div>
        </div>
      </Section>
    </div>
  );
}

function EqRows({ eq, setEq }: { eq: Eq; setEq: (patch: Partial<Eq>, key: string, label?: string) => void }) {
  const hz = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 1 : 2)}k` : `${Math.round(v)}`);
  return (
    <div className="au-eqrows">
      <ParamRow label="High-pass" reserveKeyframe={false}>
        <Toggle checked={eq.highpass > 0} aria-label="High-pass on" data-testid="au-eq-hp-on" onChange={(on) => setEq({ highpass: on ? 80 : 0 }, 'hp-on', on ? 'Enable high-pass' : 'Disable high-pass')} />
        <ScrubNumber value={eq.highpass > 0 ? eq.highpass : 80} min={20} max={2000} step={1} unit="Hz" disabled={eq.highpass <= 0} format={hz} aria-label="High-pass frequency" data-testid="au-eq-hp" onChange={(v) => setEq({ highpass: v }, 'hp')} />
      </ParamRow>
      <ParamRow label="Low shelf" reserveKeyframe={false}>
        <ScrubNumber value={eq.lowGain} min={-18} max={18} step={0.1} unit="dB" defaultValue={0} aria-label="Low shelf gain" data-testid="au-eq-low-gain" onChange={(v) => setEq({ lowGain: v }, 'low-gain')} />
        <ScrubNumber value={eq.lowFreq} min={20} max={2000} step={1} unit="Hz" defaultValue={120} format={hz} aria-label="Low shelf frequency" data-testid="au-eq-low-freq" onChange={(v) => setEq({ lowFreq: v }, 'low-freq')} />
      </ParamRow>
      <ParamRow label="Mid" reserveKeyframe={false}>
        <ScrubNumber value={eq.midGain} min={-18} max={18} step={0.1} unit="dB" defaultValue={0} aria-label="Mid gain" data-testid="au-eq-mid-gain" onChange={(v) => setEq({ midGain: v }, 'mid-gain')} />
        <ScrubNumber value={eq.midFreq} min={40} max={18000} step={1} unit="Hz" defaultValue={1500} format={hz} aria-label="Mid frequency" data-testid="au-eq-mid-freq" onChange={(v) => setEq({ midFreq: v }, 'mid-freq')} />
        <ScrubNumber value={eq.midQ} min={0.1} max={16} step={0.05} defaultValue={1} format={(v) => `Q ${v.toFixed(2)}`} aria-label="Mid Q" data-testid="au-eq-mid-q" onChange={(v) => setEq({ midQ: v }, 'mid-q')} />
      </ParamRow>
      <ParamRow label="High shelf" reserveKeyframe={false}>
        <ScrubNumber value={eq.highGain} min={-18} max={18} step={0.1} unit="dB" defaultValue={0} aria-label="High shelf gain" data-testid="au-eq-high-gain" onChange={(v) => setEq({ highGain: v }, 'high-gain')} />
        <ScrubNumber value={eq.highFreq} min={1000} max={20000} step={10} unit="Hz" defaultValue={8000} format={hz} aria-label="High shelf frequency" data-testid="au-eq-high-freq" onChange={(v) => setEq({ highFreq: v }, 'high-freq')} />
      </ParamRow>
      <ParamRow label="Low-pass" reserveKeyframe={false}>
        <Toggle checked={eq.lowpass > 0} aria-label="Low-pass on" data-testid="au-eq-lp-on" onChange={(on) => setEq({ lowpass: on ? 12000 : 0 }, 'lp-on', on ? 'Enable low-pass' : 'Disable low-pass')} />
        <ScrubNumber value={eq.lowpass > 0 ? eq.lowpass : 12000} min={1000} max={20000} step={10} unit="Hz" disabled={eq.lowpass <= 0} format={hz} aria-label="Low-pass frequency" data-testid="au-eq-lp" onChange={(v) => setEq({ lowpass: v }, 'lp')} />
      </ParamRow>
    </div>
  );
}

/** Static input→output curve of the compressor (−60…0 dB). */
function CompCurve({ comp }: { comp: Comp }) {
  const S = 84;
  const lo = -60;
  const p = (db: number) => ((db - lo) / -lo) * S;
  let d = '';
  for (let i = 0; i <= 60; i++) {
    const x = lo + i;
    const y = compressorCurve(x, comp.threshold, comp.ratio, comp.knee) + comp.makeup;
    d += `${i ? 'L' : 'M'}${p(x).toFixed(1)},${(S - p(Math.min(0, Math.max(lo, y)))).toFixed(1)}`;
  }
  return (
    <svg className={`au-compcurve ${comp.enabled ? '' : 'is-off'}`} width={S} height={S} viewBox={`0 0 ${S} ${S}`} aria-hidden="true" data-testid="au-comp-curve">
      <rect x="0.5" y="0.5" width={S - 1} height={S - 1} className="au-compcurve__frame" />
      <line x1="0" y1={S} x2={S} y2="0" className="au-compcurve__unity" />
      <line x1={p(comp.threshold)} y1="0" x2={p(comp.threshold)} y2={S} className="au-compcurve__thr" />
      <path d={d} className="au-compcurve__line" />
    </svg>
  );
}
