// Color quick section, the sequence summary (no selection) and batch editing
// of several clips.

import { useRef } from 'react';
import { useEditor, useSequence } from '../../../../state/store';
import { defaultGrade, isGradeIdentity } from '../../../../state/defaults';
import { sequenceDuration, type BlendMode, type Clip, type InputTransform, type LabelColor, type Track } from '../../../../state/types';
import { paramAt, setParam } from '../../../../engine/keyframes';
import { setSpeed } from '../../../../engine/edit/ops';
import { formatTimecode, fromFrames } from '../../../../engine/time';
import { editClip, editClips, editField, IconButton, ParamRow, ScrubNumber, Section, Select, Slider, Toggle, type SelectOption } from '../controls';
import { Btn, InfoRow, LabelPicker } from '../fields';
import { II } from '../icons';
import { BLEND_OPTIONS } from './TransformSections';

export const INPUT_TRANSFORMS: SelectOption<InputTransform>[] = [
  { value: 'auto', label: 'Auto (from media)' },
  { value: 'rec709', label: 'Rec.709', group: 'Display' },
  { value: 'srgb', label: 'sRGB', group: 'Display' },
  { value: 'linear', label: 'Linear', group: 'Display' },
  { value: 'slog3', label: 'Sony S-Log3', group: 'Camera log' },
  { value: 'logc3', label: 'ARRI LogC3', group: 'Camera log' },
  { value: 'vlog', label: 'Panasonic V-Log', group: 'Camera log' },
  { value: 'clog3', label: 'Canon Log 3', group: 'Camera log' },
  { value: 'flog', label: 'Fujifilm F-Log', group: 'Camera log' },
  { value: 'hlg', label: 'HLG (BT.2100)', group: 'HDR' },
  { value: 'pq', label: 'PQ (ST 2084)', group: 'HDR' },
];

export function ColorQuickSection({ clip }: { clip: Clip }) {
  const luts = useEditor((s) => s.project?.luts ?? []);
  const g = clip.grade;
  const adjusted = !isGradeIdentity({ ...g, enabled: true }) || Object.keys(clip.keyframes).some((k) => k.startsWith('grade.'));
  const lut = g.lut.id ? luts.find((l) => l.id === g.lut.id) : undefined;
  const mediaLike = clip.kind === 'media' || clip.kind === 'sequence';
  return (
    <Section
      id="colorQuick"
      title="Color"
      data-testid="ins-sec-color"
      enabled={g.enabled}
      onEnabledChange={(on) => editField(clip.id, 'grade.enabled', on ? 'Enable grade' : 'Bypass grade', (c) => void (c.grade.enabled = on))}
      actions={
        <IconButton
          title="Reset grade"
          data-testid="ins-grade-reset"
          disabled={!adjusted}
          onClick={() =>
            editClip(clip.id, 'Reset grade', (c) => {
              c.grade = { ...defaultGrade(), inputTransform: c.grade.inputTransform };
              for (const k of Object.keys(c.keyframes)) if (k.startsWith('grade.')) delete c.keyframes[k];
            })
          }
        >
          <II.Reset size={14} />
        </IconButton>
      }
    >
      <InfoRow label="Grade" testid="ins-grade-summary">
        <span>{!g.enabled ? 'Bypassed' : adjusted ? 'Adjusted' : 'No adjustments'}</span>
        {lut && <span className="ins-dim ins-ellipsis">LUT {lut.name}</span>}
      </InfoRow>
      {mediaLike && (
        <ParamRow label="Input">
          <Select
            value={g.inputTransform}
            options={INPUT_TRANSFORMS}
            aria-label="Input transform"
            data-testid="ins-input-transform"
            onChange={(it) => editField(clip.id, 'grade.inputTransform', 'Change input transform', (c) => void (c.grade.inputTransform = it))}
          />
        </ParamRow>
      )}
      <div className="ins-actions-row">
        <Btn primary data-testid="ins-open-color" onClick={() => useEditor.getState().setWorkspace('color')}>
          <II.Color size={13} /> Open in Color
        </Btn>
      </div>
    </Section>
  );
}

export function SequenceSummary() {
  const seq = useSequence();
  const videoClips = seq.tracks.filter((t) => t.kind === 'video').reduce((n, t) => n + t.clips.length, 0);
  const audioClips = seq.tracks.filter((t) => t.kind === 'audio').reduce((n, t) => n + t.clips.length, 0);
  const cues = seq.tracks.reduce((n, t) => n + t.cues.length, 0);
  const dur = sequenceDuration(seq);
  const fps = Math.round(seq.fps * 1000) / 1000;
  const df = Math.round(seq.fps) === 30 || Math.round(seq.fps) === 60 ? (seq.dropFrame ? ' DF' : ' NDF') : '';
  const space: Record<string, string> = { rec709: 'Rec.709', srgb: 'sRGB', p3: 'Display P3', 'rec2020-hlg': 'Rec.2020 HLG', 'rec2020-pq': 'Rec.2020 PQ' };
  return (
    <div className="ins-summary" data-testid="ins-summary">
      <Section id="sequence" title="Sequence" data-testid="ins-sec-sequence">
        <InfoRow label="Name">
          <span className="ins-ellipsis">{seq.name}</span>
        </InfoRow>
        <InfoRow label="Format" testid="ins-seq-format">
          <span className="ins-mono">
            {seq.width}×{seq.height}
          </span>
          <span className="ins-dim">
            {fps} fps{df}
          </span>
        </InfoRow>
        <InfoRow label="Color">
          <span>{space[seq.colorSpace] ?? seq.colorSpace}</span>
          <span className="ins-dim">{seq.sampleRate / 1000} kHz</span>
        </InfoRow>
        <InfoRow label="Duration" testid="ins-seq-duration">
          <span className="ins-mono">{formatTimecode(dur, seq.fps, seq.dropFrame, seq.startTimecode)}</span>
        </InfoRow>
        <InfoRow label="Clips" testid="ins-seq-clips">
          <span className="ins-mono">{videoClips + audioClips}</span>
          <span className="ins-dim">
            {videoClips} video · {audioClips} audio{cues ? ` · ${cues} captions` : ''}
          </span>
        </InfoRow>
        <InfoRow label="Tracks">
          <span className="ins-mono">{seq.tracks.length}</span>
          <span className="ins-dim">{seq.markers.length ? `${seq.markers.length} markers` : ''}</span>
        </InfoRow>
        {seq.formats.length > 0 && (
          <InfoRow label="Formats">
            <span className="ins-ellipsis">{seq.formats.map((f) => f.name).join(', ')}</span>
          </InfoRow>
        )}
        <div className="ins-actions-row">
          <Btn data-testid="ins-seq-settings" onClick={() => useEditor.getState().openModal('timeline.sequenceSettings')}>
            <II.Sliders size={13} /> Sequence settings
          </Btn>
        </div>
      </Section>
      <p className="ins-empty-hint">Select a clip to edit its properties.</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Batch editing
// ---------------------------------------------------------------------------

function common<T>(values: T[]): T | null {
  return values.length && values.every((v) => v === values[0]) ? values[0] : null;
}

function localOf(c: Clip) {
  const ph = useEditor.getState().playhead;
  return Math.max(0, Math.min(ph - c.start, c.duration));
}

function setSpeedAll(ids: string[], speed: number) {
  const s = useEditor.getState();
  try {
    s.mutateSequence('Change speed', (seq, project) => {
      for (const id of ids) setSpeed(project, seq, id, speed, { ripple: false });
    });
  } catch (e) {
    if (/not implemented/i.test((e as Error).message)) editClips(ids, 'Change speed', (c) => void (c.speed = speed));
    else s.showToast(`Change speed failed: ${(e as Error).message}`, 'error');
  }
}

/** One ScrubNumber that applies relative offsets to many clips (resets to 0 after each gesture). */
function OffsetField({ ids, path, label, testid }: { ids: string[]; path: string; label: string; testid: string }) {
  const applied = useRef(0);
  return (
    <ScrubNumber
      value={0}
      step={1}
      precision={0}
      unit="px"
      aria-label={label}
      data-testid={testid}
      onChange={(v, meta) => {
        const d = v - applied.current;
        applied.current = meta.final ? 0 : v;
        if (Math.abs(d) < 1e-9) return;
        editClips(ids, 'Offset position', (c) => setParam(c, path, localOf(c), paramAt(c, path, localOf(c)) + d), { coalesceKey: `ins:multi:${path}` });
      }}
    />
  );
}

export function MultiInspector({ items }: { items: { clip: Clip; track: Track }[] }) {
  const seq = useSequence();
  const frame = fromFrames(1, seq.fps);
  const ids = items.map((i) => i.clip.id);
  const video = items.filter((i) => i.track.kind === 'video');
  const audio = items.filter((i) => i.track.kind === 'audio');
  const vids = video.map((i) => i.clip.id);
  const aids = audio.map((i) => i.clip.id);
  const media = items.filter((i) => i.clip.kind === 'media' || i.clip.kind === 'sequence');
  const allMedia = media.length === items.length;
  const playhead = useEditor((s) => s.playhead);
  const at = (c: Clip, p: string) => paramAt(c, p, Math.max(0, Math.min(playhead - c.start, c.duration)));

  const label = common(items.map((i) => i.clip.label));
  const enabled = common(items.map((i) => i.clip.enabled));
  const opacity = common(video.map((i) => Math.round(at(i.clip, 'transform.opacity') * 1000) / 1000));
  const scale = common(video.map((i) => Math.round(at(i.clip, 'transform.scale') * 1000) / 1000));
  const blend = common(video.map((i) => i.clip.blend));
  const fadeIn = common(video.map((i) => i.clip.fadeIn));
  const fadeOut = common(video.map((i) => i.clip.fadeOut));
  const speed = common(media.map((i) => i.clip.speed));
  const gain = common(audio.map((i) => Math.round(at(i.clip, 'audio.gain') * 100) / 100));

  const setAll = (list: string[], path: string, l: string, v: number) => editClips(list, l, (c) => setParam(c, path, localOf(c), v), { coalesceKey: `ins:multi:${path}` });

  return (
    <div className="ins-multi" data-testid="ins-multi">
      <Section id="multiClip" title={`${items.length} clips`} data-testid="ins-sec-multi">
        <ParamRow label="Label" reserveKeyframe={false}>
          <LabelPicker value={label} testid="ins-multi-label" onChange={(l: LabelColor) => editClips(ids, 'Set label', (c) => void (c.label = l))} />
        </ParamRow>
        <ParamRow label="Enabled" reserveKeyframe={false}>
          <Toggle
            checked={enabled ?? true}
            mixed={enabled === null}
            aria-label="Enabled"
            data-testid="ins-multi-enabled"
            onChange={(on) => editClips(ids, on ? 'Enable clips' : 'Disable clips', (c) => void (c.enabled = on))}
          />
        </ParamRow>
        {allMedia && (
          <ParamRow label="Speed" reserveKeyframe={false}>
            <ScrubNumber
              value={speed ?? 1}
              mixed={speed === null}
              min={0.01}
              max={100}
              step={0.01}
              displayScale={100}
              precision={0}
              unit="%"
              defaultValue={1}
              aria-label="Speed"
              data-testid="ins-multi-speed"
              onChange={(v, meta) => meta.final && setSpeedAll(media.map((i) => i.clip.id), v)}
            />
          </ParamRow>
        )}
      </Section>
      {video.length > 0 && (
        <Section id="multiVideo" title={`Video · ${video.length}`} data-testid="ins-sec-multivideo">
          <ParamRow label="Opacity" reserveKeyframe={false}>
            <Slider value={opacity ?? 1} min={0} max={1} defaultValue={1} aria-label="Opacity" data-testid="ins-multi-opacity-slider" onChange={(v) => setAll(vids, 'transform.opacity', 'Change opacity', v)} />
            <ScrubNumber
              value={opacity ?? 1}
              mixed={opacity === null}
              min={0}
              max={1}
              step={0.01}
              displayScale={100}
              precision={0}
              unit="%"
              defaultValue={1}
              width={64}
              aria-label="Opacity"
              data-testid="ins-multi-opacity"
              onChange={(v) => setAll(vids, 'transform.opacity', 'Change opacity', v)}
            />
          </ParamRow>
          <ParamRow label="Scale" reserveKeyframe={false}>
            <ScrubNumber
              value={scale ?? 1}
              mixed={scale === null}
              min={0}
              max={100}
              step={0.01}
              dragStep={0.005}
              displayScale={100}
              precision={1}
              unit="%"
              defaultValue={1}
              aria-label="Scale"
              data-testid="ins-multi-scale"
              onChange={(v) => setAll(vids, 'transform.scale', 'Change scale', v)}
            />
          </ParamRow>
          <ParamRow label="Offset" reserveKeyframe={false} hint="Moves every selected clip by this amount">
            <span className="ins-point__axis">X</span>
            <OffsetField ids={vids} path="transform.x" label="Offset X" testid="ins-multi-offset-x" />
            <span className="ins-point__axis">Y</span>
            <OffsetField ids={vids} path="transform.y" label="Offset Y" testid="ins-multi-offset-y" />
          </ParamRow>
          <ParamRow label="Blend" reserveKeyframe={false}>
            <Select<BlendMode>
              value={blend ?? ('' as BlendMode)}
              placeholder="Mixed"
              options={BLEND_OPTIONS}
              aria-label="Blend mode"
              data-testid="ins-multi-blend"
              onChange={(b) => editClips(vids, 'Change blend mode', (c) => void (c.blend = b))}
            />
          </ParamRow>
          <ParamRow label="Fade in" reserveKeyframe={false}>
            <ScrubNumber
              value={fadeIn ?? 0}
              mixed={fadeIn === null}
              min={0}
              step={frame}
              dragStep={frame / 2}
              precision={2}
              unit="s"
              defaultValue={0}
              aria-label="Fade in"
              data-testid="ins-multi-fadein"
              onChange={(v) => editClips(vids, 'Change fade in', (c) => void (c.fadeIn = Math.max(0, Math.min(v, c.duration - c.fadeOut))), { coalesceKey: 'ins:multi:fadeIn' })}
            />
          </ParamRow>
          <ParamRow label="Fade out" reserveKeyframe={false}>
            <ScrubNumber
              value={fadeOut ?? 0}
              mixed={fadeOut === null}
              min={0}
              step={frame}
              dragStep={frame / 2}
              precision={2}
              unit="s"
              defaultValue={0}
              aria-label="Fade out"
              data-testid="ins-multi-fadeout"
              onChange={(v) => editClips(vids, 'Change fade out', (c) => void (c.fadeOut = Math.max(0, Math.min(v, c.duration - c.fadeIn))), { coalesceKey: 'ins:multi:fadeOut' })}
            />
          </ParamRow>
        </Section>
      )}
      {audio.length > 0 && (
        <Section id="multiAudio" title={`Audio · ${audio.length}`} data-testid="ins-sec-multiaudio">
          <ParamRow label="Volume" reserveKeyframe={false}>
            <Slider value={gain ?? 0} min={-60} max={24} step={0.1} defaultValue={0} aria-label="Volume" data-testid="ins-multi-volume-slider" onChange={(v) => setAll(aids, 'audio.gain', 'Change volume', v)} />
            <ScrubNumber
              value={gain ?? 0}
              mixed={gain === null}
              min={-96}
              max={24}
              step={0.1}
              precision={1}
              unit="dB"
              defaultValue={0}
              width={70}
              aria-label="Volume"
              data-testid="ins-multi-volume"
              onChange={(v) => setAll(aids, 'audio.gain', 'Change volume', v)}
            />
          </ParamRow>
          <ParamRow label="Mute" reserveKeyframe={false}>
            <Toggle
              checked={common(audio.map((i) => i.clip.audio.mute)) ?? false}
              mixed={common(audio.map((i) => i.clip.audio.mute)) === null}
              aria-label="Mute"
              data-testid="ins-multi-mute"
              onChange={(on) => editClips(aids, on ? 'Mute clips' : 'Unmute clips', (c) => void (c.audio.mute = on))}
            />
          </ParamRow>
        </Section>
      )}
    </div>
  );
}
