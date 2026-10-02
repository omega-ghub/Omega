// Center column: every setting of the selected preset, editable.
// OWNED BY THE DELIVER PACKAGE.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Checkbox, Segmented, Switch } from '../../../ui/controls';
import { I } from '../../../ui/Icons';
import { useEditor } from '../../../state/store';
import { activeSequence, type Sequence } from '../../../state/types';
import { exactRate, formatTimecode } from '../../../engine/time';
import {
  AUDIO_CODEC_LABEL,
  AUDIO_CONTAINERS,
  CONTAINER_AUDIO_CODECS,
  CONTAINER_VIDEO_CODECS,
  MAIN_FORMAT,
  NAME_TOKENS,
  VIDEO_CODEC_LABEL,
  VIDEO_CONTAINERS,
  codecsForContainer,
  findPreset,
  fpsLabel,
  probeAudioCodecs,
  probeVideoCodecs,
  resolveFps,
  resolveOutputSize,
  type AudioCodecId,
  type CaptionMode,
  type Container,
  type ExportSettings,
  type RangeSpec,
  type ResolutionPolicy,
  type VideoCodecId,
  type VideoCodecSupport,
} from '../../../engine/export';
import { NumberInput, Pill, Row, Section, Select, TimecodeInput, type Option } from './controls';
import { useDeliverDraft } from './draft';
import type { DraftPlan } from './usePlan';

const FPS_CHOICES = [23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60];
const AUDIO_KBPS = [96, 128, 160, 192, 256, 320, 384];
const LOUDNESS_PRESETS: { label: string; lufs: number; tp: number; tip: string }[] = [
  { label: '−14', lufs: -14, tp: -1, tip: 'Web and streaming (YouTube, Spotify, social)' },
  { label: '−16', lufs: -16, tp: -1, tip: 'Podcasts (Apple Podcasts)' },
  { label: '−23', lufs: -23, tp: -1, tip: 'EBU R128 broadcast' },
  { label: '−24', lufs: -24, tp: -2, tip: 'ATSC A/85 broadcast (US)' },
];

function useSeq(): Sequence | null {
  return useEditor((s) => (s.project ? activeSequence(s.project) : null));
}

// ---------------------------------------------------------------------------

export function SettingsForm({ plan }: { plan: DraftPlan }) {
  const draft = useDeliverDraft((s) => s.draft);
  const kind = draft.settings.kind;
  const seq = useSeq();
  if (!seq) return null;
  return (
    <div className="dl-form" data-testid="dl-settings">
      <OutputSection plan={plan} />
      {kind !== 'handoff' && <RangeSection seq={seq} />}
      {(kind === 'video' || kind === 'imageSequence' || kind === 'still') && seq.formats.length > 0 && <FormatsSection seq={seq} />}
      {(kind === 'video' || kind === 'imageSequence' || kind === 'still') && <VideoSection seq={seq} plan={plan} />}
      {(kind === 'video' || kind === 'audio') && <AudioSection />}
      {(kind === 'video' || kind === 'audio') && <CaptionsSection />}
      {kind === 'handoff' && (
        <Section title="Handoff">
          <p className="dl-note">
            {draft.settings.container === 'srt' || draft.settings.container === 'vtt'
              ? 'Writes every caption track of the sequence (one file per track).'
              : draft.settings.container === 'chapters'
                ? 'Writes the chapter markers as a YouTube chapter list ("00:00 Intro").'
                : 'Describes the whole sequence for conform or finishing in another application. Media stays where it is; the file references it by path.'}
          </p>
        </Section>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Output: name + destination
// ---------------------------------------------------------------------------

function OutputSection({ plan }: { plan: DraftPlan }) {
  const draft = useDeliverDraft((s) => s.draft);
  const update = useDeliverDraft((s) => s.update);
  const inputRef = useRef<HTMLInputElement>(null);
  const insertToken = (tok: string) => {
    const el = inputRef.current;
    const t = draft.nameTemplate;
    const at = el?.selectionStart ?? t.length;
    const next = `${t.slice(0, at)}{${tok}}${t.slice(el?.selectionEnd ?? at)}`;
    update({ nameTemplate: next });
    requestAnimationFrame(() => {
      el?.focus();
      const pos = at + tok.length + 2;
      el?.setSelectionRange(pos, pos);
    });
  };
  const pick = async () => {
    const dir = await window.omega.dialogs.pickFolder(draft.destination || undefined);
    if (dir) update({ destination: dir });
  };
  return (
    <Section title="Output">
      <Row label="File name" wide>
        <input ref={inputRef} className="dl-input" value={draft.nameTemplate} spellCheck={false} onChange={(e) => update({ nameTemplate: e.target.value })} data-testid="dl-name" aria-label="File name template" />
        <div className="dl-tokens">
          {NAME_TOKENS.map((t) => (
            <button key={t} className="dl-token" onClick={() => insertToken(t)} data-testid={`dl-token-${t}`} title={`Insert {${t}}`}>
              {t}
            </button>
          ))}
        </div>
        <div className="dl-preview" data-testid="dl-name-preview">
          {plan.jobs.length ? plan.jobs.map((j) => <div key={j.outputPath} className="dl-preview__line">{j.outputPath.split(/[\\/]/).pop()}</div>) : <span className="dl-muted">—</span>}
        </div>
      </Row>
      <Row label="Destination" wide>
        <div className="dl-dest">
          <input className="dl-input dl-input--path" value={draft.destination} placeholder="Choose a folder" spellCheck={false} onChange={(e) => update({ destination: e.target.value })} data-testid="dl-dest" aria-label="Destination folder" />
          <button className="btn btn--ghost btn--small" onClick={pick} data-testid="dl-dest-pick">
            <I.Folder size={14} />
            Choose…
          </button>
        </div>
      </Row>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Range
// ---------------------------------------------------------------------------

function RangeSection({ seq }: { seq: Sequence }) {
  const draft = useDeliverDraft((s) => s.draft);
  const update = useDeliverDraft((s) => s.update);
  const playhead = useEditor((s) => s.playhead);
  const still = draft.settings.kind === 'still';
  const r = draft.range;
  const tc = (t: number) => formatTimecode(t, seq.fps, seq.dropFrame, seq.startTimecode);
  const hasMarks = seq.inPoint !== null || seq.outPoint !== null;
  const tcProps = { fps: seq.fps, dropFrame: seq.dropFrame, startTimecode: seq.startTimecode };

  if (still) {
    const mode = r.mode === 'frame' ? 'frame' : r.mode === 'inout' ? 'in' : 'playhead';
    const time = r.mode === 'frame' ? r.time : r.mode === 'inout' ? (seq.inPoint ?? 0) : playhead;
    return (
      <Section title="Frame">
        <Row label="Frame at">
          <Segmented
            size="sm"
            value={mode}
            onChange={(m) => update({ range: m === 'playhead' ? { mode: 'entire' } : m === 'in' ? { mode: 'frame', time: seq.inPoint ?? 0 } : { mode: 'frame', time: playhead } })}
            options={[
              { value: 'playhead', label: 'Playhead', testId: 'dl-frame-playhead' },
              { value: 'in', label: 'In point', testId: 'dl-frame-in' },
              { value: 'frame', label: 'Timecode', testId: 'dl-frame-custom' },
            ]}
          />
        </Row>
        <Row label="Timecode">
          {mode === 'frame' ? <TimecodeInput value={time} onChange={(t) => update({ range: { mode: 'frame', time: t } })} {...tcProps} testId="dl-frame-tc" ariaLabel="Frame timecode" /> : <span className="dl-tc">{tc(time)}</span>}
        </Row>
      </Section>
    );
  }

  const setMode = (m: RangeSpec['mode']) => {
    if (m === 'custom') {
      const start = r.mode === 'custom' ? r.start : (seq.inPoint ?? 0);
      const end = r.mode === 'custom' ? r.end : (seq.outPoint ?? Math.max(start + 1, durationOf(seq)));
      update({ range: { mode: 'custom', start, end } });
    } else update({ range: m === 'inout' ? { mode: 'inout' } : { mode: 'entire' } });
  };
  return (
    <Section title="Range">
      <Row label="Render">
        <Segmented
          size="sm"
          value={r.mode === 'frame' ? 'entire' : r.mode}
          onChange={setMode}
          options={[
            { value: 'entire', label: 'Entire sequence', testId: 'dl-range-entire' },
            { value: 'inout', label: 'In – Out', testId: 'dl-range-inout', tip: hasMarks ? undefined : 'Mark in (I) and out (O) first' },
            { value: 'custom', label: 'Custom', testId: 'dl-range-custom' },
          ]}
        />
      </Row>
      {r.mode === 'custom' && (
        <Row label="From – to">
          <div className="dl-inline">
            <TimecodeInput value={r.start} onChange={(t) => update({ range: { mode: 'custom', start: t, end: Math.max(r.end, t + 1 / exactRate(seq.fps)) } })} {...tcProps} testId="dl-range-start" ariaLabel="Range start" />
            <span className="dl-muted">–</span>
            <TimecodeInput value={r.end} onChange={(t) => update({ range: { mode: 'custom', start: r.start, end: t } })} {...tcProps} testId="dl-range-end" ariaLabel="Range end" />
          </div>
        </Row>
      )}
      {r.mode === 'inout' && (
        <Row label="Marks">
          <span className="dl-tc">{hasMarks ? `${tc(seq.inPoint ?? 0)} – ${tc(seq.outPoint ?? durationOf(seq))}` : 'No marks set'}</span>
        </Row>
      )}
    </Section>
  );
}

function durationOf(seq: Sequence): number {
  let end = 0;
  for (const t of seq.tracks) {
    for (const c of t.clips) end = Math.max(end, c.start + c.duration);
    for (const q of t.cues) end = Math.max(end, q.end);
  }
  return end;
}

// ---------------------------------------------------------------------------
// Formats (multi-aspect)
// ---------------------------------------------------------------------------

function FormatsSection({ seq }: { seq: Sequence }) {
  const formats = useDeliverDraft((s) => s.draft.formats);
  const update = useDeliverDraft((s) => s.update);
  const toggle = (id: string, on: boolean) => {
    const next = on ? [...new Set([...formats, id])] : formats.filter((f) => f !== id);
    update({ formats: next.length ? next : [MAIN_FORMAT] });
  };
  const all = [{ id: MAIN_FORMAT, name: 'Main', width: seq.width, height: seq.height }, ...seq.formats];
  return (
    <Section title="Formats" aside={<span className="dl-muted">{formats.length > 1 ? `${formats.length} files` : 'One file per format'}</span>}>
      <div className="dl-formats">
        {all.map((f) => (
          <Checkbox key={f.id} checked={formats.includes(f.id)} onChange={(v) => toggle(f.id, v)} testId={`dl-format-${f.id}`}>
            <span className="dl-format">
              {f.name}
              <span className="dl-format__size">
                {f.width}×{f.height}
              </span>
            </span>
          </Checkbox>
        ))}
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Video
// ---------------------------------------------------------------------------

function useVideoSupport(container: Container, width: number, height: number, fps: number, enabled: boolean): VideoCodecSupport[] | null {
  const [list, setList] = useState<VideoCodecSupport[] | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    const codecs = CONTAINER_VIDEO_CODECS[container] ?? [];
    void probeVideoCodecs(codecs, { width, height, fps }).then((r) => live && setList(r));
    return () => {
      live = false;
    };
  }, [container, width, height, Math.round(fps), enabled]);
  return list;
}

type ResMode = 'sequence' | 'preset' | 'scale' | 'custom';

function sameRes(a: ResolutionPolicy | undefined, b: ResolutionPolicy): boolean {
  return !!a && JSON.stringify(a) === JSON.stringify(b);
}

function VideoSection({ seq, plan }: { seq: Sequence; plan: DraftPlan }) {
  const s = useDeliverDraft((st) => st.draft.settings);
  const presetId = useDeliverDraft((st) => st.draft.presetId);
  const formats = useDeliverDraft((st) => st.draft.formats);
  const custom = useDeliverDraft((st) => st.customPresets);
  const set = useDeliverDraft((st) => st.updateSettings);
  const preset = findPreset(presetId, custom);
  const v = s.video;
  const isVideo = s.kind === 'video';
  const firstFormat = formats[0] && formats[0] !== MAIN_FORMAT ? seq.formats.find((f) => f.id === formats[0]) : null;
  const src = { width: firstFormat?.width ?? seq.width, height: firstFormat?.height ?? seq.height };
  const out = resolveOutputSize(v.resolution, src);
  const fps = resolveFps(v.fps, seq.fps);
  const support = useVideoSupport(s.container, out.width, out.height, fps, isVideo);
  const [lock, setLock] = useState(true);

  const presetRes = preset?.settings.video.resolution;
  const resMode: ResMode = v.resolution.mode === 'sequence' ? (v.resolution.scale && v.resolution.scale !== 100 ? 'scale' : 'sequence') : sameRes(presetRes, v.resolution) ? 'preset' : 'custom';
  const resOptions: Option<ResMode>[] = [
    { value: 'sequence', label: `Match sequence · ${src.width}×${src.height}` },
    ...(presetRes && presetRes.mode !== 'sequence' ? [{ value: 'preset' as const, label: `${presetRes.mode === 'max' ? 'Up to' : 'Exactly'} ${presetRes.width}×${presetRes.height}` }] : []),
    { value: 'scale', label: 'Scale…' },
    { value: 'custom', label: 'Custom size…' },
  ];
  const setRes = (m: ResMode) =>
    set((x) => {
      if (m === 'sequence') x.video.resolution = { mode: 'sequence' };
      else if (m === 'preset' && presetRes) x.video.resolution = JSON.parse(JSON.stringify(presetRes)) as ResolutionPolicy;
      else if (m === 'scale') x.video.resolution = { mode: 'sequence', scale: 50 };
      else x.video.resolution = { mode: 'fixed', width: out.width, height: out.height };
    });

  const presetFps = preset?.settings.video.fps;
  const fpsValue = v.fps.mode === 'sequence' ? 'seq' : String(v.fps.fps);
  const fpsOptions: Option<string>[] = [
    { value: 'seq', label: `Match sequence · ${fpsLabel(resolveFps(presetFps?.mode === 'sequence' ? presetFps : { mode: 'sequence' }, seq.fps))} fps` },
    ...FPS_CHOICES.map((f) => ({ value: String(f), label: `${fpsLabel(f)} fps` })),
  ];

  const videoCodec = v.codecs[0];
  const codecOptions: Option<VideoCodecId>[] = (support ?? (CONTAINER_VIDEO_CODECS[s.container] ?? []).map((codec) => ({ codec, available: true, hardware: null })))
    .filter((c) => c.available || c.codec === videoCodec)
    .map((c) => ({
      value: c.codec,
      label: `${VIDEO_CODEC_LABEL[c.codec]}${!c.available ? ' · not available' : c.hardware === true ? ' · hardware' : c.hardware === false ? ' · software' : ''}`,
      disabled: !c.available,
    }));
  const plannedKbps = plan.plans[0]?.videoKbps ?? 0;

  const setContainer = (c: Container) =>
    set((x) => {
      x.container = c;
      x.video.codecs = codecsForContainer(x.video.codecs, CONTAINER_VIDEO_CODECS[c]);
      x.audio.codecs = codecsForContainer(x.audio.codecs, CONTAINER_AUDIO_CODECS[c]);
    });

  return (
    <Section title={s.kind === 'video' ? 'Video' : 'Image'}>
      {isVideo && (
        <Row label="Container">
          <Select value={s.container} options={VIDEO_CONTAINERS.map((c) => ({ value: c.id, label: c.label }))} onChange={setContainer} testId="dl-container" ariaLabel="Container" />
        </Row>
      )}
      {isVideo && (
        <Row label="Codec" hint={support === null ? 'Checking encoders…' : undefined}>
          <Select
            value={videoCodec}
            options={codecOptions.length ? codecOptions : [{ value: videoCodec, label: 'No encoder available', disabled: true }]}
            onChange={(c) => set((x) => (x.video.codecs = codecsForContainer(x.video.codecs, CONTAINER_VIDEO_CODECS[x.container], c)))}
            testId="dl-vcodec"
            ariaLabel="Video codec"
          />
        </Row>
      )}
      <Row label="Resolution">
        <div className="dl-stack">
          <Select value={resMode} options={resOptions} onChange={setRes} testId="dl-res-mode" ariaLabel="Resolution" />
          {resMode === 'scale' && v.resolution.mode === 'sequence' && (
            <div className="dl-inline">
              <NumberInput value={v.resolution.scale ?? 100} min={5} max={400} step={5} unit="%" onChange={(n) => set((x) => (x.video.resolution = { mode: 'sequence', scale: n ?? 100 }))} testId="dl-res-scale" ariaLabel="Scale percent" width={96} />
              <span className="dl-muted">
                → {out.width}×{out.height}
              </span>
            </div>
          )}
          {resMode === 'custom' && v.resolution.mode !== 'sequence' && (
            <div className="dl-inline">
              <NumberInput
                value={v.resolution.width}
                min={16}
                max={8192}
                step={2}
                onChange={(w) =>
                  set((x) => {
                    const r = x.video.resolution as { mode: 'fixed'; width: number; height: number };
                    const nw = w ?? r.width;
                    x.video.resolution = { mode: 'fixed', width: nw, height: lock ? Math.max(2, Math.round((nw * r.height) / r.width / 2) * 2) : r.height };
                  })
                }
                testId="dl-res-w"
                ariaLabel="Width"
                width={84}
              />
              <span className="dl-muted">×</span>
              <NumberInput
                value={v.resolution.height}
                min={16}
                max={8192}
                step={2}
                onChange={(h) =>
                  set((x) => {
                    const r = x.video.resolution as { mode: 'fixed'; width: number; height: number };
                    const nh = h ?? r.height;
                    x.video.resolution = { mode: 'fixed', width: lock ? Math.max(2, Math.round((nh * r.width) / r.height / 2) * 2) : r.width, height: nh };
                  })
                }
                testId="dl-res-h"
                ariaLabel="Height"
                width={84}
              />
              <button className={`dl-icon-toggle ${lock ? 'is-on' : ''}`} onClick={() => setLock(!lock)} aria-pressed={lock} title={lock ? 'Aspect ratio locked' : 'Aspect ratio unlocked'} data-testid="dl-res-lock">
                {lock ? <I.Link size={14} /> : <I.Unlink size={14} />}
              </button>
            </div>
          )}
          {out.padded && <span className="dl-muted">Letterboxed: picture {out.innerWidth}×{out.innerHeight}</span>}
        </div>
      </Row>
      {s.kind !== 'still' && (
        <Row label="Frame rate">
          <Select
            value={fpsValue}
            options={fpsOptions}
            onChange={(val) =>
              set((x) => {
                x.video.fps = val === 'seq' ? (presetFps?.mode === 'sequence' ? JSON.parse(JSON.stringify(presetFps)) : { mode: 'sequence' }) : { mode: 'fixed', fps: Number(val) };
              })
            }
            testId="dl-fps"
            ariaLabel="Frame rate"
          />
        </Row>
      )}
      {isVideo && (
        <>
          <Row label="Bitrate">
            <div className="dl-inline">
              <Segmented
                size="sm"
                value={v.bitrateMode}
                onChange={(m) => set((x) => (x.video.bitrateMode = m))}
                options={[
                  { value: 'vbr', label: 'VBR', testId: 'dl-bitrate-vbr', tip: 'Variable bitrate: better quality per byte' },
                  { value: 'cbr', label: 'CBR', testId: 'dl-bitrate-cbr', tip: 'Constant bitrate: predictable size' },
                ]}
              />
              <NumberInput
                value={v.bitrateKbps === null ? null : Math.round(v.bitrateKbps / 100) / 10}
                placeholder={plannedKbps ? (plannedKbps / 1000).toFixed(1) : 'Auto'}
                allowEmpty
                min={0.2}
                max={400}
                step={1}
                unit="Mbps"
                onChange={(n) => set((x) => (x.video.bitrateKbps = n === null ? null : Math.round(n * 1000)))}
                testId="dl-bitrate"
                ariaLabel="Video bitrate in Mbps"
                width={110}
              />
              {v.bitrateKbps === null ? (
                <Pill tone="neutral" title="Computed from the platform's recommendation for this size, frame rate and codec">
                  Auto
                </Pill>
              ) : (
                <button className="dl-link" onClick={() => set((x) => (x.video.bitrateKbps = null))} data-testid="dl-bitrate-auto">
                  Use automatic
                </button>
              )}
            </div>
          </Row>
          <Row label="Key frame every">
            <NumberInput value={v.keyframeInterval} min={0.1} max={20} step={0.5} unit="s" onChange={(n) => set((x) => (x.video.keyframeInterval = n ?? 2))} testId="dl-keyint" ariaLabel="Key frame interval in seconds" width={96} />
          </Row>
        </>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Audio
// ---------------------------------------------------------------------------

function useAudioSupport(container: Container, sampleRate: number, channels: number): { codec: AudioCodecId; available: boolean }[] | null {
  const [list, setList] = useState<{ codec: AudioCodecId; available: boolean }[] | null>(null);
  useEffect(() => {
    let live = true;
    void probeAudioCodecs(CONTAINER_AUDIO_CODECS[container] ?? [], { sampleRate, channels }).then((r) => live && setList(r));
    return () => {
      live = false;
    };
  }, [container, sampleRate, channels]);
  return list;
}

function AudioSection() {
  const s = useDeliverDraft((st) => st.draft.settings);
  const set = useDeliverDraft((st) => st.updateSettings);
  const a = s.audio;
  const L = s.loudness;
  const support = useAudioSupport(s.container, a.sampleRate, a.channels);
  const codec = a.codecs[0];
  const lossless = codec.startsWith('pcm-') || codec === 'flac';
  const isVideo = s.kind === 'video';
  const on = !isVideo || a.enabled;
  const codecOptions: Option<AudioCodecId>[] = (support ?? (CONTAINER_AUDIO_CODECS[s.container] ?? []).map((c) => ({ codec: c, available: true })))
    .filter((c) => c.available || c.codec === codec)
    .map((c) => ({ value: c.codec, label: `${AUDIO_CODEC_LABEL[c.codec]}${c.available ? '' : ' · not available'}`, disabled: !c.available }));

  const setContainer = (c: Container) =>
    set((x) => {
      x.container = c;
      x.audio.codecs = codecsForContainer(x.audio.codecs, CONTAINER_AUDIO_CODECS[c]);
    });

  return (
    <Section title="Audio" aside={isVideo ? <Switch checked={a.enabled} onChange={(v) => set((x) => (x.audio.enabled = v))} label="Include audio" testId="dl-audio-enabled" /> : undefined}>
      {on && (
        <>
          {!isVideo && (
            <Row label="Format">
              <Select value={s.container} options={AUDIO_CONTAINERS.map((c) => ({ value: c.id, label: c.label }))} onChange={setContainer} testId="dl-container" ariaLabel="Audio format" />
            </Row>
          )}
          <Row label="Codec">
            <Select value={codec} options={codecOptions} onChange={(c) => set((x) => (x.audio.codecs = codecsForContainer(x.audio.codecs, CONTAINER_AUDIO_CODECS[x.container], c)))} testId="dl-acodec" ariaLabel="Audio codec" />
          </Row>
          {!lossless && (
            <Row label="Bitrate">
              <Select value={String(a.bitrateKbps)} options={[...new Set([...AUDIO_KBPS, a.bitrateKbps])].sort((x, y) => x - y).map((k) => ({ value: String(k), label: `${k} kbps` }))} onChange={(k) => set((x) => (x.audio.bitrateKbps = Number(k)))} testId="dl-abitrate" ariaLabel="Audio bitrate" />
            </Row>
          )}
          <Row label="Sample rate">
            <Segmented
              size="sm"
              value={a.sampleRate}
              onChange={(r) => set((x) => (x.audio.sampleRate = r))}
              options={[
                { value: 44100, label: '44.1 kHz', testId: 'dl-sr-44100' },
                { value: 48000, label: '48 kHz', testId: 'dl-sr-48000' },
                { value: 96000, label: '96 kHz', testId: 'dl-sr-96000' },
              ]}
            />
          </Row>
          <Row label="Channels">
            <Segmented
              size="sm"
              value={a.channels}
              onChange={(c) => set((x) => (x.audio.channels = c))}
              options={[
                { value: 1, label: 'Mono', testId: 'dl-ch-1' },
                { value: 2, label: 'Stereo', testId: 'dl-ch-2' },
              ]}
            />
          </Row>
          <Row label="Normalize loudness" hint="ITU-R BS.1770">
            <div className="dl-stack">
              <div className="dl-inline">
                <Switch checked={L.normalize} onChange={(v) => set((x) => (x.loudness.normalize = v))} label="Normalize loudness" testId="dl-loudness" />
                {L.normalize && (
                  <div className="dl-chips">
                    {LOUDNESS_PRESETS.map((p) => (
                      <button key={p.lufs} className={`dl-chip ${L.targetLufs === p.lufs && L.truePeakDbtp === p.tp ? 'is-active' : ''}`} title={p.tip} onClick={() => set((x) => ((x.loudness.targetLufs = p.lufs), (x.loudness.truePeakDbtp = p.tp)))}>
                        {p.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {L.normalize && (
                <div className="dl-inline">
                  <NumberInput value={L.targetLufs} min={-40} max={-5} step={0.5} unit="LUFS" onChange={(n) => set((x) => (x.loudness.targetLufs = n ?? -14))} testId="dl-lufs" ariaLabel="Target loudness" width={104} />
                  <NumberInput value={L.truePeakDbtp} min={-9} max={0} step={0.1} unit="dBTP" onChange={(n) => set((x) => (x.loudness.truePeakDbtp = n ?? -1))} testId="dl-truepeak" ariaLabel="True-peak ceiling" width={104} />
                </div>
              )}
            </div>
          </Row>
        </>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Captions & chapters
// ---------------------------------------------------------------------------

function CaptionsSection() {
  const s = useDeliverDraft((st) => st.draft.settings);
  const set = useDeliverDraft((st) => st.updateSettings);
  const opts: Option<CaptionMode>[] = useMemo(
    () => [
      { value: 'none', label: 'None' },
      { value: 'burnIn', label: 'Burn into picture' },
      { value: 'srt', label: 'Sidecar SRT' },
      { value: 'vtt', label: 'Sidecar WebVTT' },
    ],
    [],
  );
  return (
    <Section title={s.kind === 'video' ? 'Captions & chapters' : 'Chapters'}>
      {s.kind === 'video' && (
        <Row label="Captions">
          <Select value={s.captions} options={opts} onChange={(c) => set((x) => (x.captions = c))} testId="dl-captions" ariaLabel="Captions" />
        </Row>
      )}
      <Row label="Chapter list" hint="from chapter markers">
        <Switch checked={s.chapters} onChange={(v) => set((x) => (x.chapters = v))} label="Write chapter list" testId="dl-chapters" />
      </Row>
    </Section>
  );
}

export type { ExportSettings };
