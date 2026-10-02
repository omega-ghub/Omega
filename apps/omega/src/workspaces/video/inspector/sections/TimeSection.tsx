// Time: speed (constant or ramped), reverse, freeze frame, frame blending,
// duration readouts and speed-ramp presets (writes 'time.speed' keyframes).

import { useEditor, useSequence } from '../../../../state/store';
import { assetOf, type Clip, type Keyframe } from '../../../../state/types';
import { setSpeed } from '../../../../engine/edit/ops';
import { isAnimated } from '../../../../engine/keyframes';
import { formatTimecode, fromFrames, sourceSpan, sourceTimeAt, toFrames } from '../../../../engine/time';
import { editClip, editField, editParam, ParamRow, ScrubNumber, Section, Toggle, useLocalTime, useParam } from '../controls';
import { Btn, InfoRow } from '../fields';

export type RampPreset = 'up' | 'down' | 'bump' | 'bullet';

export const RAMP_PRESETS: { id: RampPreset; label: string; hint: string }[] = [
  { id: 'up', label: 'Ramp up', hint: 'Accelerates from normal speed to 300%' },
  { id: 'down', label: 'Ramp down', hint: 'Decelerates from 300% to normal speed' },
  { id: 'bump', label: 'Speed bump', hint: 'Normal → 300% → normal' },
  { id: 'bullet', label: 'Bullet time', hint: '100% → 20% → 100%' },
];

/** Speed keyframes for a preset, relative to the clip's base speed (frame-aligned). */
export function rampKeys(preset: RampPreset, duration: number, base: number, fps: number): Keyframe[] {
  const b = base > 0 ? base : 1;
  const at = (f: number) => fromFrames(toFrames(duration * f, fps), fps);
  switch (preset) {
    case 'up':
      return [
        { t: 0, v: b, ease: 'easeInOut' },
        { t: at(1), v: b * 3, ease: 'linear' },
      ];
    case 'down':
      return [
        { t: 0, v: b * 3, ease: 'easeInOut' },
        { t: at(1), v: b, ease: 'linear' },
      ];
    case 'bump':
      return [
        { t: at(0.25), v: b, ease: 'easeInOut' },
        { t: at(0.5), v: b * 3, ease: 'easeInOut' },
        { t: at(0.75), v: b, ease: 'linear' },
      ];
    case 'bullet':
      return [
        { t: at(0.2), v: b, ease: 'easeInOut' },
        { t: at(0.4), v: b * 0.2, ease: 'linear' },
        { t: at(0.6), v: b * 0.2, ease: 'easeInOut' },
        { t: at(0.8), v: b, ease: 'linear' },
      ];
  }
}

function applySpeed(clip: Clip, speed: number, reverse: boolean) {
  const s = useEditor.getState();
  const label = reverse !== clip.reverse ? (reverse ? 'Reverse clip' : 'Play clip forward') : 'Change speed';
  try {
    s.mutateSequence(label, (seq, project) => setSpeed(project, seq, clip.id, speed, { reverse, ripple: false }), { coalesceKey: `ins:${clip.id}:time.speed` });
  } catch (e) {
    if (/not implemented/i.test((e as Error).message)) {
      // Editing engine unavailable: change the rate in place, keeping the clip's length.
      editClip(clip.id, label, (c) => {
        c.speed = speed;
        c.reverse = reverse;
      });
    } else s.showToast(`${label} failed: ${(e as Error).message}`, 'error');
  }
}

export function TimeSection({ clip }: { clip: Clip }) {
  const seq = useSequence();
  const asset = useEditor((s) => (s.project ? assetOf(s.project, clip) : undefined));
  const ramped = isAnimated(clip, 'time.speed');
  const speedNow = useParam(clip.id, 'time.speed');
  const local = useLocalTime(clip.id);
  const frozen = clip.holdFrame !== null && clip.holdFrame !== undefined;
  const span = sourceSpan(clip);
  const available = asset && asset.kind !== 'image' ? (clip.reverse ? clip.inPoint + span : asset.duration - clip.inPoint) : Infinity;
  const short = !frozen && asset && asset.kind !== 'image' && span > available + 1 / seq.fps;

  return (
    <Section id="time" title="Time" data-testid="ins-sec-time" badge={clip.speed !== 1 || ramped || clip.reverse || frozen ? '•' : undefined}>
      <ParamRow label="Speed" clipId={clip.id} path="time.speed" hint={ramped ? 'Ramped: edits set a keyframe at the playhead' : undefined}>
        <ScrubNumber
          value={ramped ? speedNow : clip.speed}
          min={0.01}
          max={100}
          step={0.01}
          dragStep={0.005}
          displayScale={100}
          precision={0}
          unit="%"
          defaultValue={1}
          disabled={frozen}
          aria-label="Speed"
          data-testid="ins-speed"
          onChange={(v, meta) => {
            if (ramped) editParam(clip.id, 'time.speed', v);
            else if (meta.final) applySpeed(clip, v, clip.reverse);
          }}
        />
        <Toggle
          checked={clip.reverse}
          label="Reverse"
          disabled={frozen}
          data-testid="ins-reverse"
          onChange={(on) => applySpeed(clip, clip.speed, on)}
        />
      </ParamRow>
      <ParamRow label="Freeze frame">
        <Toggle
          checked={frozen}
          data-testid="ins-freeze"
          aria-label="Freeze frame"
          onChange={(on) =>
            editField(clip.id, 'holdFrame', on ? 'Freeze frame' : 'Unfreeze', (c) => {
              c.holdFrame = on ? sourceTimeAt({ ...c, holdFrame: null }, local) : null;
            })
          }
        />
        {frozen && <span className="ins-dim ins-mono">{formatTimecode(clip.holdFrame!, asset?.fps ?? seq.fps)}</span>}
      </ParamRow>
      <ParamRow label="Frame blend">
        <Toggle checked={clip.frameBlend} aria-label="Frame blending" data-testid="ins-frameblend" onChange={(on) => editField(clip.id, 'frameBlend', on ? 'Frame blending on' : 'Frame blending off', (c) => void (c.frameBlend = on))} />
      </ParamRow>
      <InfoRow label="Duration" testid="ins-time-duration">
        <span className="ins-mono">{formatTimecode(clip.duration, seq.fps, seq.dropFrame)}</span>
        <span className="ins-dim">source {formatTimecode(span, seq.fps, seq.dropFrame)}</span>
      </InfoRow>
      <div className="ins-presets" role="group" aria-label="Speed ramp presets">
        {RAMP_PRESETS.map((r) => (
          <Btn
            key={r.id}
            title={r.hint}
            disabled={frozen}
            data-testid={`ins-ramp-${r.id}`}
            onClick={() =>
              editClip(clip.id, `Speed ramp: ${r.label}`, (c) => {
                c.keyframes['time.speed'] = rampKeys(r.id, c.duration, c.speed, seq.fps);
              })
            }
          >
            {r.label}
          </Btn>
        ))}
        <Btn
          title="Remove the speed ramp (constant speed)"
          disabled={!ramped}
          data-testid="ins-ramp-clear"
          onClick={() =>
            editClip(clip.id, 'Clear speed ramp', (c) => {
              delete c.keyframes['time.speed'];
            })
          }
        >
          Clear ramp
        </Btn>
      </div>
      {short && <p className="ins-note ins-note--warn">This speed needs more source than the media has; the last frame holds at the end.</p>}
    </Section>
  );
}
