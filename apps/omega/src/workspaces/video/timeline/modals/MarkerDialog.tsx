// 'timeline.marker': label, note, color, kind, time and duration of a marker.
import { useState } from 'react';
import { LABEL_COLORS } from '../../../../state/defaults';
import { useEditor } from '../../../../state/store';
import type { LabelColor, Marker } from '../../../../state/types';
import { activeSequence } from '../../../../state/types';
import { LABEL_LIST } from '../colors';
import { editSeq } from '../commands';
import { Check, Dialog, Row, Segmented } from '../Dialog';
import { TimecodeInput } from '../TimecodeInput';

export function MarkerDialog({ props, onClose }: { props?: Record<string, unknown>; onClose: () => void }) {
  const seq = useEditor((s) => activeSequence(s.project!));
  const marker = seq.markers.find((m) => m.id === props?.markerId);
  const [label, setLabel] = useState(marker?.label ?? '');
  const [note, setNote] = useState(marker?.note ?? '');
  const [color, setColor] = useState<LabelColor>(marker?.color ?? 'teal');
  const [kind, setKind] = useState<Marker['kind']>(marker?.kind ?? 'marker');
  const [time, setTime] = useState(marker?.time ?? 0);
  const [duration, setDuration] = useState(marker?.duration ?? 0);
  const [done, setDone] = useState(!!marker?.done);
  if (!marker) {
    return (
      <Dialog title="Marker" onClose={onClose}>
        <p className="tl-muted">The marker no longer exists.</p>
      </Dialog>
    );
  }
  const save = () => {
    editSeq('Edit marker', (s) => {
      const m = s.markers.find((x) => x.id === marker.id);
      if (!m) return;
      m.label = label;
      m.note = note;
      m.color = color;
      m.kind = kind;
      m.time = Math.max(0, time);
      m.duration = Math.max(0, duration);
      if (kind === 'todo') m.done = done;
      else delete m.done;
    });
    onClose();
  };
  const remove = () => {
    editSeq('Delete marker', (s) => {
      s.markers = s.markers.filter((m) => m.id !== marker.id);
    });
    onClose();
  };
  return (
    <Dialog
      title="Marker"
      onClose={onClose}
      onSubmit={save}
      width={440}
      testId="tl-marker-dialog"
      footerLeft={
        <button className="tl-btn tl-btn--danger" onClick={remove} data-testid="tl-marker-delete">
          Delete
        </button>
      }
    >
      <Row label="Name">
        <input className="tl-input" value={label} placeholder="Marker" onChange={(e) => setLabel(e.target.value)} data-testid="tl-marker-label" />
      </Row>
      <Row label="Type">
        <Segmented
          value={kind}
          onChange={setKind}
          testId="tl-marker-kind"
          options={[
            { value: 'marker', label: 'Marker' },
            { value: 'chapter', label: 'Chapter' },
            { value: 'todo', label: 'To-do' },
          ]}
        />
      </Row>
      <Row label="Color">
        <span className="tl-swatches" role="radiogroup">
          {LABEL_LIST.filter((l) => l !== 'none').map((l) => (
            <button
              key={l}
              type="button"
              role="radio"
              aria-checked={color === l}
              aria-label={l}
              title={l}
              className={`tl-swatch ${color === l ? 'is-on' : ''}`}
              style={{ background: LABEL_COLORS[l] }}
              onClick={() => setColor(l)}
              data-testid={`tl-marker-color-${l}`}
            />
          ))}
        </span>
      </Row>
      <Row label="In">
        <TimecodeInput value={time} fps={seq.fps} dropFrame={seq.dropFrame} startTimecode={seq.startTimecode} onChange={setTime} testId="tl-marker-time" />
      </Row>
      <Row label="Duration">
        <TimecodeInput value={duration} fps={seq.fps} dropFrame={seq.dropFrame} onChange={setDuration} testId="tl-marker-duration" />
      </Row>
      {kind === 'todo' && (
        <Row label="">
          <Check checked={done} onChange={setDone} label="Done" />
        </Row>
      )}
      <Row label="Comment">
        <textarea className="tl-input tl-textarea" rows={3} value={note} onChange={(e) => setNote(e.target.value)} data-testid="tl-marker-note" />
      </Row>
    </Dialog>
  );
}
