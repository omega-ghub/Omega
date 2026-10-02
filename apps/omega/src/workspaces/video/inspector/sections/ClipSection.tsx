// Clip: name, label, enabled, notes and the timing fields (start / end /
// duration / source in), which move and trim through the edit ops.

import { useEditor, useSequence } from '../../../../state/store';
import { assetOf, type Clip, type Track } from '../../../../state/types';
import { moveClips, slipClip, trimClip } from '../../../../engine/edit/ops';
import { fromFrames } from '../../../../engine/time';
import { ParamRow, Section, TimecodeField, Toggle, editField } from '../controls';
import { InfoRow, LabelPicker, runEdit, TextArea, TextInput } from '../fields';

export function ClipSection({ clip, track }: { clip: Clip; track: Track }) {
  const seq = useSequence();
  const asset = useEditor((s) => (s.project ? assetOf(s.project, clip) : undefined));
  const frame = fromFrames(1, seq.fps);
  const hasSource = clip.kind === 'media' || clip.kind === 'sequence';
  const locked = track.locked;

  const setStart = (t: number) => {
    const delta = t - clip.start;
    if (Math.abs(delta) < 1e-9) return;
    runEdit('Move clip', (s) => moveClips(s, [clip.id], delta, 0, 'overwrite'));
  };
  const setEnd = (t: number) => {
    if (t <= clip.start + frame / 2) return;
    runEdit('Trim clip end', (s, p) => trimClip(p, s, clip.id, 'end', t, 'normal'));
  };
  const setDuration = (d: number) => {
    if (d < frame / 2) return;
    runEdit('Change clip duration', (s, p) => trimClip(p, s, clip.id, 'end', clip.start + d, 'normal'));
  };
  const setSourceIn = (t: number) => {
    const delta = t - clip.inPoint;
    if (Math.abs(delta) < 1e-9) return;
    runEdit('Slip clip', (s, p) => slipClip(p, s, clip.id, delta));
  };

  return (
    <Section id="clip" title="Clip" data-testid="ins-sec-clip">
      <ParamRow label="Name" reserveKeyframe={false}>
        <TextInput
          value={clip.name}
          aria-label="Clip name"
          data-testid="ins-clip-name"
          onCommit={(v) => editField(clip.id, 'name', 'Rename clip', (c) => void (c.name = v.trim() || c.name))}
        />
      </ParamRow>
      <ParamRow label="Label" reserveKeyframe={false}>
        <LabelPicker value={clip.label} onChange={(l) => editField(clip.id, 'label', 'Set label', (c) => void (c.label = l))} />
      </ParamRow>
      <ParamRow label="Enabled" reserveKeyframe={false}>
        <Toggle
          checked={clip.enabled}
          aria-label="Clip enabled"
          data-testid="ins-clip-enabled"
          onChange={(on) => editField(clip.id, 'enabled', on ? 'Enable clip' : 'Disable clip', (c) => void (c.enabled = on))}
        />
      </ParamRow>
      <div className="ins-grid2">
        <div className="ins-cell">
          <span className="ins-cell__label">Start</span>
          <TimecodeField value={clip.start} startTimecode={seq.startTimecode} min={0} disabled={locked} aria-label="Clip start" data-testid="ins-clip-start" onCommit={setStart} />
        </div>
        <div className="ins-cell">
          <span className="ins-cell__label">End</span>
          <TimecodeField
            value={clip.start + clip.duration}
            startTimecode={seq.startTimecode}
            min={clip.start + frame}
            disabled={locked}
            aria-label="Clip end"
            data-testid="ins-clip-end"
            onCommit={setEnd}
          />
        </div>
        <div className="ins-cell">
          <span className="ins-cell__label">Duration</span>
          <TimecodeField value={clip.duration} min={frame} disabled={locked} aria-label="Clip duration" data-testid="ins-clip-duration" onCommit={setDuration} />
        </div>
        {hasSource && (
          <div className="ins-cell">
            <span className="ins-cell__label">Source in</span>
            <TimecodeField value={clip.inPoint} min={0} disabled={locked} aria-label="Source in" data-testid="ins-clip-sourcein" onCommit={setSourceIn} />
          </div>
        )}
      </div>
      {asset && (
        <InfoRow label="Source">
          <span className="ins-ellipsis" title={asset.path}>
            {asset.name}
          </span>
          {asset.width ? (
            <span className="ins-dim">
              {asset.width}×{asset.height}
              {asset.fps ? ` · ${Math.round(asset.fps * 1000) / 1000}` : ''}
            </span>
          ) : null}
          <button type="button" className="ins-link" data-testid="ins-clip-reveal" onClick={() => window.omega?.files?.showInFolder(asset.path)}>
            Reveal
          </button>
        </InfoRow>
      )}
      {locked && <p className="ins-note">The track is locked; timing can't be changed.</p>}
      <div className="ins-notes">
        <TextArea
          value={clip.notes ?? ''}
          rows={2}
          placeholder="Notes"
          aria-label="Clip notes"
          data-testid="ins-clip-notes"
          onChange={(v) => editField(clip.id, 'notes', 'Edit notes', (c) => void (c.notes = v))}
        />
      </div>
    </Section>
  );
}
