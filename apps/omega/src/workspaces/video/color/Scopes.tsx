// Scopes panel: one, two or four scopes (waveform, RGB parade, vectorscope,
// histogram) fed live from the program viewer, a legality readout, and the
// reference still from the gallery with an optional trace overlay.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { analyze, type ScopeRequest, type ScopeResult, type Tint } from '../../../engine/scopes/scopes';
import { subscribeScopes, updateScopeRequest, type ScopeFeedFrame } from '../../../engine/scopes/feed';
import { CI } from './icons';
import { clear, drawHistogram, drawNoSignal, drawParade, drawVectorscope, drawWaveform, SCOPE_LABEL, type DrawOpts, type ScopeKind, type ScopeScale } from './scopeDraw';
import { setReference, setReferenceOverlay, useReference, useReferenceOverlay, type Still } from './stills';
import './color.css';

type Layout = 1 | 2 | 4;

interface ScopePrefs {
  layout: Layout;
  slots: ScopeKind[];
  scale: ScopeScale;
  zoom: 1 | 2;
}

const PREFS_KEY = 'delta.color.scopes';
const DEFAULT_PREFS: ScopePrefs = { layout: 2, slots: ['waveform', 'vectorscope', 'parade', 'histogram'], scale: 'ire', zoom: 1 };
const KINDS: ScopeKind[] = ['waveform', 'parade', 'vectorscope', 'histogram'];
const REF_TINT: Tint = [1, 0.6, 0.22];

function loadPrefs(): ScopePrefs {
  try {
    const p = { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') } as ScopePrefs;
    if (![1, 2, 4].includes(p.layout)) p.layout = 2;
    if (!Array.isArray(p.slots) || p.slots.length !== 4 || !p.slots.every((s) => KINDS.includes(s))) p.slots = DEFAULT_PREFS.slots;
    if (p.zoom !== 1 && p.zoom !== 2) p.zoom = 1;
    if (p.scale !== 'ire' && p.scale !== 'code10') p.scale = 'ire';
    return p;
  } catch {
    return DEFAULT_PREFS;
  }
}

function savePrefs(p: ScopePrefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    /* per-viewer convenience only */
  }
}

function monoFont(): string {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue('--mono').trim();
    return v || "'JetBrains Mono', ui-monospace, monospace";
  } catch {
    return 'ui-monospace, monospace';
  }
}

function requestFor(kinds: ScopeKind[], zoom: number): ScopeRequest {
  return {
    waveform: kinds.includes('waveform'),
    parade: kinds.includes('parade'),
    vectorscope: kinds.includes('vectorscope'),
    histogram: kinds.includes('histogram'),
    legality: true,
    rows: 256,
    vectorSize: 256,
    vectorZoom: zoom,
  };
}

export function Scopes(_props: Record<string, unknown> = {}) {
  const [prefs, setPrefsState] = useState<ScopePrefs>(loadPrefs);
  const [frame, setFrame] = useState<ScopeFeedFrame | null>(null);
  const reference = useReference();
  const overlay = useReferenceOverlay();
  const visible = prefs.slots.slice(0, prefs.layout);
  const req = useMemo(() => requestFor(visible, prefs.zoom), [visible.join(','), prefs.zoom]); // eslint-disable-line react-hooks/exhaustive-deps
  const cbRef = useRef<((f: ScopeFeedFrame) => void) | null>(null);
  const reqRef = useRef(req);
  reqRef.current = req;

  useEffect(() => {
    const cb = (f: ScopeFeedFrame) => setFrame(f);
    cbRef.current = cb;
    const off = subscribeScopes(reqRef.current, cb);
    return () => {
      cbRef.current = null;
      off();
    };
  }, []);
  useEffect(() => {
    if (cbRef.current) updateScopeRequest(cbRef.current, req);
  }, [req]);

  const setPrefs = (patch: Partial<ScopePrefs>) =>
    setPrefsState((p) => {
      const next = { ...p, ...patch };
      savePrefs(next);
      return next;
    });

  // Reference traces (computed once per reference / zoom), drawn in amber under the live trace.
  const refResult = useMemo<ScopeResult | null>(() => {
    if (!reference || !overlay) return null;
    return analyze(reference, { ...requestFor(KINDS, prefs.zoom), legality: false, tint: REF_TINT });
  }, [reference, overlay, prefs.zoom]);

  const result = frame?.result ?? null;
  const leg = result?.legality;
  const showZoom = visible.includes('vectorscope');

  return (
    <section className="cl-scopes" data-testid="cl-scopes" aria-label="Scopes">
      <header className="cl-head">
        <span className="cl-head__title">Scopes</span>
        <div className="cl-head__tools">
          <Seg
            value={prefs.layout}
            onChange={(layout) => setPrefs({ layout })}
            options={[
              { value: 1, icon: <CI.Layout1 size={14} />, title: 'One scope', testid: 'cl-scope-layout-1' },
              { value: 2, icon: <CI.Layout2 size={14} />, title: 'Two scopes', testid: 'cl-scope-layout-2' },
              { value: 4, icon: <CI.Layout4 size={14} />, title: 'Four scopes', testid: 'cl-scope-layout-4' },
            ]}
          />
          <Seg
            value={prefs.scale}
            onChange={(scale) => setPrefs({ scale })}
            options={[
              { value: 'ire', label: 'IRE', title: 'Graticule in IRE (0–100)', testid: 'cl-scope-scale-ire' },
              { value: 'code10', label: '10-bit', title: 'Graticule in 10-bit code values (0–1023; dashed: legal 64–940)', testid: 'cl-scope-scale-code10' },
            ]}
          />
          {showZoom && (
            <Seg
              value={prefs.zoom}
              onChange={(zoom) => setPrefs({ zoom })}
              options={[
                { value: 1, label: '1×', title: 'Vectorscope 1×', testid: 'cl-scope-zoom-1' },
                { value: 2, label: '2×', title: 'Vectorscope 2× (low-saturation detail)', testid: 'cl-scope-zoom-2' },
              ]}
            />
          )}
        </div>
      </header>

      {reference && <ReferencePane still={reference} overlay={overlay} />}

      <div className={`cl-scopes__grid cl-scopes__grid--${prefs.layout}`}>
        {visible.map((kind, i) => (
          <ScopeSlot
            key={i}
            index={i}
            kind={kind}
            prefs={prefs}
            result={result}
            hasFrame={!!frame}
            refResult={refResult}
            onKind={(k) => {
              const slots = [...prefs.slots];
              slots[i] = k;
              setPrefs({ slots });
            }}
          />
        ))}
      </div>

      <footer className="cl-scopes__foot" data-testid="cl-scope-legality">
        {leg ? (
          <>
            <span className={`cl-stat ${leg.lowPct > 1 ? 'cl-stat--warn' : ''}`} title="Pixels at or below 0 IRE (crushed blacks)">
              <span className="cl-stat__k">&lt;0</span>
              <span className="cl-num" data-testid="cl-scope-low">
                {leg.lowPct.toFixed(1)}%
              </span>
            </span>
            <span className={`cl-stat ${leg.highPct > 1 ? 'cl-stat--warn' : ''}`} title="Pixels at or above 100 IRE (clipped whites)">
              <span className="cl-stat__k">&gt;100</span>
              <span className="cl-num" data-testid="cl-scope-high">
                {leg.highPct.toFixed(1)}%
              </span>
            </span>
            <span className="cl-stat" title="Luma range of the frame, in IRE">
              <span className="cl-stat__k">Y</span>
              <span className="cl-num">
                {leg.minIre.toFixed(0)}–{leg.maxIre.toFixed(0)}
              </span>
            </span>
            <span className="cl-stat cl-stat--right" title="Scope updates per second">
              <span className="cl-num">{frame?.fps ?? 0}</span>
              <span className="cl-stat__k">fps</span>
            </span>
          </>
        ) : (
          <span className="cl-stat">
            <span className="cl-stat__k">{frame ? 'No picture' : 'Waiting for the viewer'}</span>
          </span>
        )}
      </footer>
    </section>
  );
}

function ScopeSlot(props: {
  index: number;
  kind: ScopeKind;
  prefs: ScopePrefs;
  result: ScopeResult | null;
  hasFrame: boolean;
  refResult: ScopeResult | null;
  onKind: (k: ScopeKind) => void;
}) {
  const { index, kind, prefs, result, hasFrame, refResult } = props;
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0, dpr: 1 });

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      setSize((s) => (Math.round(r.width) === s.w && Math.round(r.height) === s.h && dpr === s.dpr ? s : { w: Math.round(r.width), h: Math.round(r.height), dpr }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useLayoutEffect(() => {
    const c = canvasRef.current;
    if (!c || !size.w || !size.h) return;
    const W = Math.max(1, Math.round(size.w * size.dpr));
    const H = Math.max(1, Math.round(size.h * size.dpr));
    if (c.width !== W) c.width = W;
    if (c.height !== H) c.height = H;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const o: DrawOpts = { scale: prefs.scale, zoom: prefs.zoom, dpr: size.dpr, mono: monoFont() };
    if (!result) {
      if (hasFrame) drawNoSignal(ctx, W, H, o, 'No picture');
      else drawNoSignal(ctx, W, H, o, 'No signal');
      return;
    }
    if (kind === 'waveform') drawWaveform(ctx, W, H, o, result.waveform, refResult?.waveform);
    else if (kind === 'parade') drawParade(ctx, W, H, o, result.parade, refResult?.parade);
    else if (kind === 'vectorscope') drawVectorscope(ctx, W, H, o, result.vectorscope, refResult?.vectorscope);
    else if (kind === 'histogram') drawHistogram(ctx, W, H, o, result.histogram, refResult?.histogram);
    else clear(ctx, W, H);
  }, [kind, prefs.scale, prefs.zoom, result, refResult, size, hasFrame]);

  return (
    <div className="cl-scope" ref={wrapRef} data-testid={`cl-scope-${index}`} data-kind={kind}>
      <canvas ref={canvasRef} className="cl-scope__canvas" data-testid="cl-scope-canvas" style={{ width: size.w, height: size.h }} />
      <select
        className="cl-scope__select"
        value={kind}
        aria-label={`Scope ${index + 1}`}
        data-testid={`cl-scope-select-${index}`}
        onChange={(e) => props.onKind(e.target.value as ScopeKind)}
      >
        {KINDS.map((k) => (
          <option key={k} value={k}>
            {SCOPE_LABEL[k]}
          </option>
        ))}
      </select>
    </div>
  );
}

function ReferencePane({ still, overlay }: { still: Still; overlay: boolean }) {
  return (
    <div className="cl-ref" data-testid="cl-scope-reference">
      <StillCanvas still={still} className="cl-ref__img" />
      <div className="cl-ref__meta">
        <span className="cl-ref__tag">Reference</span>
        <span className="cl-num cl-ref__tc">{still.timecode}</span>
        {still.clipName && <span className="cl-ref__name">{still.clipName}</span>}
        <div className="cl-ref__actions">
          <button
            type="button"
            className={`cl-chip ${overlay ? 'is-on' : ''}`}
            aria-pressed={overlay}
            title="Draw the reference's traces (amber) under the live traces"
            data-testid="cl-scope-ref-overlay"
            onClick={() => setReferenceOverlay(!overlay)}
          >
            Overlay
          </button>
          <button type="button" className="cl-icon-btn" title="Hide reference" aria-label="Hide reference" data-testid="cl-scope-ref-close" onClick={() => setReference(null)}>
            <CI.Close size={13} />
          </button>
        </div>
      </div>
    </div>
  );
}

/** Draws a still's pixels into a canvas (aspect preserved by CSS). */
export function StillCanvas({ still, className }: { still: Still; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    const c = ref.current;
    if (!c) return;
    c.width = still.width;
    c.height = still.height;
    c.getContext('2d')?.putImageData(new ImageData(still.data as Uint8ClampedArray<ArrayBuffer>, still.width, still.height), 0, 0);
  }, [still]);
  return <canvas ref={ref} className={className} style={{ aspectRatio: `${still.width} / ${still.height}` }} />;
}

function Seg<T extends string | number>(props: { value: T; onChange: (v: T) => void; options: { value: T; label?: string; icon?: ReactNode; title: string; testid: string }[] }) {
  return (
    <div className="cl-seg" role="radiogroup">
      {props.options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={props.value === o.value}
          className={`cl-seg__btn ${props.value === o.value ? 'is-on' : ''}`}
          title={o.title}
          aria-label={o.title}
          data-testid={o.testid}
          onClick={() => props.onChange(o.value)}
        >
          {o.icon ?? o.label}
        </button>
      ))}
    </div>
  );
}
