// 'timeline.sequenceSettings': format, rate, audio, color, start timecode,
// background and multi-aspect formats of the active sequence.
import { useMemo, useState } from 'react';
import { formatTimecode, parseTimecode } from '../../../../engine/time';
import { useEditor } from '../../../../state/store';
import type { ColorSpace, Sequence, SequenceFormat } from '../../../../state/types';
import { activeSequence } from '../../../../state/types';
import { editProject } from '../commands';
import { Check, Dialog, Row } from '../Dialog';
import { even, formatFor, resnapSequence } from '../seqformat';

const SIZE_PRESETS: { label: string; w: number; h: number }[] = [
  { label: 'DCI 4K · 4096 × 2160', w: 4096, h: 2160 },
  { label: 'UHD 4K · 3840 × 2160', w: 3840, h: 2160 },
  { label: 'QHD · 2560 × 1440', w: 2560, h: 1440 },
  { label: 'Full HD · 1920 × 1080', w: 1920, h: 1080 },
  { label: 'HD · 1280 × 720', w: 1280, h: 720 },
  { label: 'DCI 2K · 2048 × 1080', w: 2048, h: 1080 },
  { label: 'Vertical 9:16 · 1080 × 1920', w: 1080, h: 1920 },
  { label: 'Square 1:1 · 1080 × 1080', w: 1080, h: 1080 },
  { label: 'Portrait 4:5 · 1080 × 1350', w: 1080, h: 1350 },
];

export const FPS_OPTIONS = [23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60, 120];

const COLOR_SPACES: { value: ColorSpace; label: string }[] = [
  { value: 'rec709', label: 'Rec. 709' },
  { value: 'srgb', label: 'sRGB' },
  { value: 'p3', label: 'Display P3' },
  { value: 'rec2020-hlg', label: 'Rec. 2020 HLG' },
  { value: 'rec2020-pq', label: 'Rec. 2020 PQ' },
];

const ASPECTS: { name: string; w: number; h: number }[] = [
  { name: 'Vertical 9:16', w: 9, h: 16 },
  { name: 'Square 1:1', w: 1, h: 1 },
  { name: 'Portrait 4:5', w: 4, h: 5 },
];

export function SequenceSettingsDialog({ onClose }: { onClose: () => void }) {
  const seq = useEditor((s) => activeSequence(s.project!));
  const [name, setName] = useState(seq.name);
  const [width, setWidth] = useState(seq.width);
  const [height, setHeight] = useState(seq.height);
  const [fps, setFps] = useState(seq.fps);
  const [dropFrame, setDropFrame] = useState(seq.dropFrame);
  const [sampleRate, setSampleRate] = useState(seq.sampleRate);
  const [colorSpace, setColorSpace] = useState(seq.colorSpace);
  const [startTc, setStartTc] = useState(formatTimecode(0, seq.fps, seq.dropFrame, seq.startTimecode));
  const [background, setBackground] = useState(seq.background.slice(0, 7));
  const [formats, setFormats] = useState<SequenceFormat[]>(seq.formats);
  const [active, setActive] = useState<string | null>(seq.activeFormatId);

  const dfAllowed = Math.abs(fps - 29.97) < 0.01 || Math.abs(fps - 59.94) < 0.01;
  const preset = SIZE_PRESETS.find((p) => p.w === width && p.h === height)?.label ?? 'custom';
  const startSeconds = useMemo(() => parseTimecode(startTc, fps, 0, 0, dfAllowed && dropFrame), [startTc, fps, dropFrame, dfAllowed]);
  const valid = name.trim() && width >= 16 && height >= 16 && width <= 8192 && height <= 8192 && startSeconds !== null;

  const save = () => {
    if (!valid) return;
    const fpsChanged = Math.abs(fps - seq.fps) > 1e-9;
    editProject('Sequence settings', (d) => {
      const s = d.sequences.find((x) => x.id === seq.id);
      if (!s) return;
      s.name = name.trim();
      s.width = even(width);
      s.height = even(height);
      s.fps = fps;
      s.dropFrame = dfAllowed && dropFrame;
      s.sampleRate = sampleRate;
      s.colorSpace = colorSpace;
      s.startTimecode = Math.max(0, startSeconds ?? 0);
      s.background = background;
      s.formats = formats;
      s.activeFormatId = active && formats.some((f) => f.id === active) ? active : null;
      if (fpsChanged) resnapSequence(s, fps);
    });
    onClose();
  };

  return (
    <Dialog title="Sequence Settings" onClose={onClose} onSubmit={save} submitLabel="Save" width={520} testId="tl-seq-settings-dialog" submitDisabled={!valid}>
      <Row label="Name">
        <input className="tl-input" value={name} onChange={(e) => setName(e.target.value)} data-testid="tl-seqset-name" />
      </Row>
      <Row label="Frame size">
        <select
          className="tl-input"
          value={preset}
          data-testid="tl-seqset-preset"
          onChange={(e) => {
            const p = SIZE_PRESETS.find((x) => x.label === e.target.value);
            if (p) {
              setWidth(p.w);
              setHeight(p.h);
            }
          }}
        >
          {SIZE_PRESETS.map((p) => (
            <option key={p.label} value={p.label}>
              {p.label}
            </option>
          ))}
          <option value="custom">Custom</option>
        </select>
      </Row>
      <Row label="">
        <span className="tl-inline">
          <input className="tl-input tl-input--num" type="number" min={16} max={8192} value={width} onChange={(e) => setWidth(Number(e.target.value) || 0)} data-testid="tl-seqset-width" />
          <span className="tl-muted">×</span>
          <input className="tl-input tl-input--num" type="number" min={16} max={8192} value={height} onChange={(e) => setHeight(Number(e.target.value) || 0)} data-testid="tl-seqset-height" />
          <button
            type="button"
            className="tl-btn tl-btn--ghost"
            title="Swap width and height"
            onClick={() => {
              setWidth(height);
              setHeight(width);
            }}
          >
            Swap
          </button>
        </span>
      </Row>
      <Row label="Frame rate" hint={Math.abs(fps - seq.fps) > 1e-9 ? 'Clips, markers and keyframes will snap to the new frame grid.' : undefined}>
        <span className="tl-inline">
          <select className="tl-input" style={{ width: 150 }} value={fps} onChange={(e) => setFps(Number(e.target.value))} data-testid="tl-seqset-fps">
            {FPS_OPTIONS.map((f) => (
              <option key={f} value={f}>
                {f} fps
              </option>
            ))}
          </select>
          <Check checked={dfAllowed && dropFrame} disabled={!dfAllowed} onChange={setDropFrame} label="Drop-frame" testId="tl-seqset-df" />
        </span>
      </Row>
      <Row label="Audio">
        <select className="tl-input" value={sampleRate} onChange={(e) => setSampleRate(Number(e.target.value) as Sequence['sampleRate'])} data-testid="tl-seqset-rate">
          <option value={44100}>44.1 kHz</option>
          <option value={48000}>48 kHz</option>
          <option value={96000}>96 kHz</option>
        </select>
      </Row>
      <Row label="Color space">
        <select className="tl-input" value={colorSpace} onChange={(e) => setColorSpace(e.target.value as ColorSpace)} data-testid="tl-seqset-colorspace">
          {COLOR_SPACES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      </Row>
      <Row label="Start timecode">
        <input className={`tl-input tl-input--tc ${startSeconds === null ? 'is-invalid' : ''}`} value={startTc} onChange={(e) => setStartTc(e.target.value)} spellCheck={false} data-testid="tl-seqset-start" />
      </Row>
      <Row label="Background">
        <span className="tl-inline">
          <input type="color" className="tl-color" value={background} onChange={(e) => setBackground(e.target.value)} data-testid="tl-seqset-bg" />
          <span className="tl-mono tl-muted">{background}</span>
        </span>
      </Row>
      <div className="tl-dlg__section">Formats</div>
      <div className="tl-formats" data-testid="tl-seqset-formats">
        <label className={`tl-format ${active === null ? 'is-active' : ''}`}>
          <input type="radio" name="tl-active-format" checked={active === null} onChange={() => setActive(null)} />
          <span className="tl-format__name">Main</span>
          <span className="tl-mono tl-muted">
            {width} × {height}
          </span>
        </label>
        {formats.map((f) => (
          <label key={f.id} className={`tl-format ${active === f.id ? 'is-active' : ''}`}>
            <input type="radio" name="tl-active-format" checked={active === f.id} onChange={() => setActive(f.id)} />
            <input className="tl-input tl-format__name" value={f.name} onChange={(e) => setFormats(formats.map((x) => (x.id === f.id ? { ...x, name: e.target.value } : x)))} />
            <span className="tl-mono tl-muted">
              {f.width} × {f.height}
            </span>
            <button
              type="button"
              className="tl-icon-btn"
              title="Remove format"
              onClick={() => {
                setFormats(formats.filter((x) => x.id !== f.id));
                if (active === f.id) setActive(null);
              }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M7 7l10 10M17 7 7 17" />
              </svg>
            </button>
          </label>
        ))}
        <div className="tl-inline tl-formats__add">
          {ASPECTS.map((a) => (
            <button
              key={a.name}
              type="button"
              className="tl-btn tl-btn--ghost"
              data-testid={`tl-seqset-add-${a.w}x${a.h}`}
              disabled={formats.some((f) => f.name === a.name)}
              onClick={() => setFormats([...formats, formatFor({ width, height }, a)])}
            >
              + {a.w}:{a.h}
            </button>
          ))}
        </div>
      </div>
    </Dialog>
  );
}
