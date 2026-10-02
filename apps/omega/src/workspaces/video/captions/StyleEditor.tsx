// Caption track style: presets, a scaled live preview and every CaptionStyle field.
import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { CaptionStyle, Sequence, Track } from '../../../state/types';
import { defaultCaptionStyle } from '../../../state/defaults';
import { useEditor } from '../../../state/store';
import { CAPTION_PRESETS, cueIndexAt, joinAlpha, sortCues, splitAlpha } from '../../../engine/captions';
import { updateStyle } from './commands';

const FONTS: { label: string; value: string }[] = [
  { label: 'Inter', value: 'Inter Variable, Inter, system-ui, sans-serif' },
  { label: 'System UI', value: 'system-ui, -apple-system, Segoe UI, sans-serif' },
  { label: 'Roboto', value: 'Roboto, Inter Variable, Inter, system-ui, sans-serif' },
  { label: 'Helvetica / Arial', value: 'Helvetica Neue, Helvetica, Arial, sans-serif' },
  { label: 'Georgia (serif)', value: 'Georgia, Times New Roman, serif' },
  { label: 'JetBrains Mono', value: 'JetBrains Mono Variable, JetBrains Mono, ui-monospace, monospace' },
];
const WEIGHTS = [300, 400, 500, 600, 700, 800, 900];

function sameStyle(a: CaptionStyle, b: CaptionStyle): boolean {
  return (Object.keys(b) as (keyof CaptionStyle)[]).every((k) => a[k] === b[k]);
}

export function StyleEditor({ track, seq }: { track: Track; seq: Sequence }) {
  const style = track.captionStyle;
  if (!style) {
    return (
      <div className="cap-empty">
        <div className="cap-empty__hint">This track has no caption style.</div>
        <button type="button" className="cap-btn cap-btn--ghost cap-btn--text" onClick={() => updateStyleFull(track.id, defaultCaptionStyle())}>
          Use the default style
        </button>
      </div>
    );
  }
  const set = <K extends keyof CaptionStyle>(key: K, value: CaptionStyle[K], live = false) => updateStyle(track.id, { [key]: value } as Partial<CaptionStyle>, live ? `cap-style-${track.id}-${key}` : undefined);
  const bg = splitAlpha(style.background);
  const fontKnown = FONTS.some((f) => f.value === style.font);

  return (
    <div className="cap-style" data-testid="cap-style">
      <Preview style={style} seq={seq} track={track} />

      <div className="cap-section-title">Presets</div>
      <div className="cap-presets">
        {CAPTION_PRESETS.map((p) => {
          const preset = p.style(seq.width, seq.height);
          return (
            <button
              type="button"
              key={p.id}
              className={`cap-preset${sameStyle(style, preset) ? ' is-active' : ''}`}
              title={p.hint}
              onClick={() => updateStyle(track.id, preset, undefined, `Caption style: ${p.name}`)}
              data-testid={`cap-preset-${p.id}`}
            >
              <span className="cap-preset__name">{p.name}</span>
              <span className="cap-preset__hint">{p.hint}</span>
            </button>
          );
        })}
      </div>

      <div className="cap-section-title">Text</div>
      <div className="cap-fields">
        <Field label="Font">
          <select className="cap-select" value={style.font} onChange={(e) => set('font', e.target.value)} data-testid="cap-style-font">
            {!fontKnown && <option value={style.font}>{style.font.split(',')[0]}</option>}
            {FONTS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Size">
          <NumberInput value={style.size} min={8} max={400} onChange={(v, live) => set('size', v, live)} testid="cap-style-size" />
          <span className="cap-unit">px</span>
          <input className="cap-range" type="range" min={8} max={Math.max(200, Math.round(Math.min(seq.width, seq.height) * 0.15))} value={style.size} onChange={(e) => set('size', Number(e.target.value), true)} aria-label="Size" />
        </Field>
        <Field label="Weight">
          <select className="cap-select" value={style.weight} onChange={(e) => set('weight', Number(e.target.value))} data-testid="cap-style-weight">
            {!WEIGHTS.includes(style.weight) && <option value={style.weight}>{style.weight}</option>}
            {WEIGHTS.map((w) => (
              <option key={w} value={w}>
                {w}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Color">
          <input className="cap-color" type="color" value={toHex6(style.color)} onChange={(e) => set('color', e.target.value, true)} aria-label="Text color" data-testid="cap-style-color" />
          <span className="cap-unit cap-mono">{toHex6(style.color)}</span>
        </Field>
        <Field label="Background">
          <input className="cap-color" type="color" value={bg.color} onChange={(e) => set('background', joinAlpha(e.target.value, bg.alpha || 0.75), true)} aria-label="Background color" data-testid="cap-style-bg" />
          <input
            className="cap-range"
            type="range"
            min={0}
            max={100}
            value={Math.round(bg.alpha * 100)}
            onChange={(e) => set('background', joinAlpha(bg.color, Number(e.target.value) / 100), true)}
            aria-label="Background opacity"
            data-testid="cap-style-bg-opacity"
          />
          <span className="cap-unit cap-mono" style={{ width: 34, textAlign: 'right' }}>
            {Math.round(bg.alpha * 100)}%
          </span>
        </Field>
        <Field label="Outline">
          <NumberInput value={style.outline} min={0} max={60} onChange={(v, live) => set('outline', v, live)} testid="cap-style-outline" />
          <span className="cap-unit">px</span>
          <input className="cap-color" type="color" value={toHex6(style.outlineColor)} onChange={(e) => set('outlineColor', e.target.value, true)} aria-label="Outline color" data-testid="cap-style-outline-color" />
        </Field>
      </div>

      <div className="cap-section-title">Layout</div>
      <div className="cap-fields">
        <Field label="Position">
          <Segmented
            value={style.position}
            options={[
              ['top', 'Top'],
              ['middle', 'Middle'],
              ['bottom', 'Bottom'],
            ]}
            onChange={(v) => set('position', v as CaptionStyle['position'])}
            testid="cap-style-position"
          />
        </Field>
        <Field label="Align">
          <Segmented
            value={style.align}
            options={[
              ['left', 'Left'],
              ['center', 'Center'],
              ['right', 'Right'],
            ]}
            onChange={(v) => set('align', v as CaptionStyle['align'])}
            testid="cap-style-align"
          />
        </Field>
        <Field label="Margin">
          <NumberInput value={style.margin} min={0} max={Math.round(seq.height / 2)} onChange={(v, live) => set('margin', v, live)} testid="cap-style-margin" />
          <span className="cap-unit">px from the edge</span>
        </Field>
        <Field label="Max width">
          <input className="cap-range" type="range" min={20} max={100} value={Math.round(style.maxWidth * 100)} onChange={(e) => set('maxWidth', Number(e.target.value) / 100, true)} aria-label="Max width" data-testid="cap-style-maxwidth" />
          <span className="cap-unit cap-mono" style={{ width: 34, textAlign: 'right' }}>
            {Math.round(style.maxWidth * 100)}%
          </span>
        </Field>
      </div>
    </div>
  );
}

function updateStyleFull(trackId: string, style: CaptionStyle) {
  useEditor.getState().mutateSequence('Caption style', (seq) => {
    const t = seq.tracks.find((x) => x.id === trackId);
    if (t) t.captionStyle = style;
  });
}

function toHex6(c: string): string {
  const m = /^#([0-9a-f]{6})/i.exec(c);
  if (m) return `#${m[1].toLowerCase()}`;
  const s = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(c);
  return s ? `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`.toLowerCase() : '#ffffff';
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="cap-field">
      <span>{label}</span>
      <div className="cap-field__ctl">{children}</div>
    </div>
  );
}

function NumberInput({ value, min, max, onChange, testid }: { value: number; min: number; max: number; onChange(v: number, live: boolean): void; testid: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = (raw: string, live: boolean) => {
    const n = Number(raw);
    if (!Number.isFinite(n)) return;
    const v = Math.max(min, Math.min(max, Math.round(n * 10) / 10));
    if (v !== value) onChange(v, live);
  };
  return (
    <input
      className="cap-num"
      type="number"
      min={min}
      max={max}
      value={draft ?? String(value)}
      onChange={(e) => {
        setDraft(e.target.value);
        if (e.target.value !== '') commit(e.target.value, true);
      }}
      onBlur={() => setDraft(null)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (!e.ctrlKey && !e.metaKey) e.stopPropagation();
      }}
      data-testid={testid}
    />
  );
}

function Segmented({ value, options, onChange, testid }: { value: string; options: [string, string][]; onChange(v: string): void; testid: string }) {
  return (
    <div className="cap-seg" role="radiogroup" data-testid={testid}>
      {options.map(([v, label]) => (
        <button type="button" key={v} role="radio" aria-checked={value === v} className={value === v ? 'is-on' : ''} onClick={() => value !== v && onChange(v)} data-testid={`${testid}-${v}`}>
          {label}
        </button>
      ))}
    </div>
  );
}

/** Scaled approximation of the burned-in caption over a neutral frame. */
function Preview({ style, seq, track }: { style: CaptionStyle; seq: Sequence; track: Track }) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(280);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.clientWidth || 280);
    const ro = new ResizeObserver(() => setW(el.clientWidth || 280));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const sorted = useMemo(() => sortCues(track.cues), [track.cues]);
  const at = useEditor((s) => cueIndexAt(sorted, s.playhead));
  const sample = (at >= 0 ? sorted[at].text : sorted[0]?.text) || 'The quick brown fox\njumps over the lazy dog.';
  const aspect = seq.width / Math.max(1, seq.height);
  const maxH = 200;
  const width = Math.min(w, maxH * aspect);
  const k = width / seq.width;
  const capW = style.maxWidth * 100;
  const pos: CSSProperties =
    style.position === 'top' ? { top: style.margin * k } : style.position === 'middle' ? { top: '50%', transform: 'translateY(-50%)' } : { bottom: style.margin * k };
  const horiz: CSSProperties =
    style.align === 'left' ? { left: `${(100 - capW) / 2}%` } : style.align === 'right' ? { right: `${(100 - capW) / 2}%` } : { left: `${(100 - capW) / 2}%` };
  const textStyle: CSSProperties = {
    fontFamily: style.font,
    fontSize: Math.max(4, style.size * k),
    fontWeight: style.weight,
    color: style.color,
    WebkitTextStroke: style.outline > 0 ? `${Math.max(0.5, style.outline * 2 * k)}px ${style.outlineColor}` : undefined,
    background: style.background || undefined,
    padding: style.background ? `${0.12 * style.size * k}px ${0.35 * style.size * k}px` : undefined,
    borderRadius: style.background ? 0.12 * style.size * k : undefined,
  };
  return (
    <div ref={ref} style={{ width: '100%' }}>
      <div className="cap-preview" style={{ width, height: width / aspect, margin: '0 auto' }} data-testid="cap-style-preview">
        <div className="cap-preview__cap" style={{ ...pos, ...horiz, width: `${capW}%`, textAlign: style.align }}>
          <span style={textStyle}>{sample}</span>
        </div>
      </div>
    </div>
  );
}
