// Titles browser (a tab next to Media and Effects): template cards with a
// live preview drawn by the title rasterizer. Click adds the title at the
// playhead; drag carries 'omega/title' = template id to the timeline.

import { useEffect, useRef, useState } from 'react';
import { useEditor } from '../../../state/store';
import { activeSequence, type Clip } from '../../../state/types';
import { makeClip } from '../../../state/defaults';
import { paramAt } from '../../../engine/keyframes';
import { onFontsLoaded, rasterizeGradient, rasterizeShape, rasterizeSolid, rasterizeText } from '../../../engine/render/text';
import { addTitle, TITLE_TEMPLATES, type TitleTemplate } from './titles';
import './inspector.css';

/** Copy of text/shape props scaled by f (preview at a fraction of the sequence size). */
function scaledClip(c: Clip, f: number): Clip {
  const out: Clip = { ...c };
  if (c.text) {
    const t = c.text;
    out.text = {
      ...t,
      size: t.size * f,
      letterSpacing: t.letterSpacing * f,
      maxWidth: t.maxWidth * f,
      stroke: { ...t.stroke, width: t.stroke.width * f },
      shadow: { ...t.shadow, blur: t.shadow.blur * f, x: t.shadow.x * f, y: t.shadow.y * f },
      background: { ...t.background, paddingX: t.background.paddingX * f, paddingY: t.background.paddingY * f, radius: t.background.radius * f },
    };
  }
  if (c.shape) out.shape = { ...c.shape, width: c.shape.width * f, height: c.shape.height * f, radius: c.shape.radius * f, stroke: { ...c.shape.stroke, width: c.shape.stroke.width * f } };
  return out;
}

interface PreviewLayer {
  clip: Clip;
  offset: number;
}

function buildPreview(tpl: TitleTemplate, W: number, H: number): PreviewLayer[] {
  return tpl.layers(W, H).map((l) => {
    const offset = l.offset ?? 0;
    const duration = l.duration ?? tpl.duration - offset;
    return { clip: makeClip(l.kind, { start: offset, duration, ...structuredClone(l.init) }), offset };
  });
}

/** Draws a template at time t (seconds from its start) into a pw×ph canvas. */
function drawPreview(ctx: CanvasRenderingContext2D, layers: PreviewLayer[], W: number, pw: number, ph: number, t: number) {
  const f = pw / W;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, pw, ph);
  const bg = ctx.createLinearGradient(0, 0, pw, ph);
  bg.addColorStop(0, '#2a2f3a');
  bg.addColorStop(0.55, '#1a1d24');
  bg.addColorStop(1, '#101116');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, pw, ph);
  for (const { clip, offset } of layers) {
    const local = t - offset;
    if (local < 0 || local >= clip.duration) continue;
    const c = scaledClip(clip, f);
    let raster: OffscreenCanvas | null = null;
    if (c.kind === 'text' && c.text)
      raster = rasterizeText({
        kind: 'text',
        text: { ...c.text, size: paramAt(clip, 'text.size', local) * f, letterSpacing: paramAt(clip, 'text.letterSpacing', local) * f },
        local,
        duration: clip.duration,
        width: pw,
        height: ph,
      });
    else if (c.kind === 'shape' && c.shape) raster = rasterizeShape({ kind: 'shape', shape: c.shape, width: pw, height: ph });
    else if (c.kind === 'solid' && c.solid) raster = rasterizeSolid({ kind: 'solid', color: c.solid.color, width: pw, height: ph });
    else if (c.kind === 'gradient' && c.gradient) raster = rasterizeGradient({ kind: 'gradient', gradient: c.gradient, width: pw, height: ph });
    if (!raster) continue;
    let opacity = paramAt(clip, 'transform.opacity', local);
    if (clip.fadeIn > 0 && local < clip.fadeIn) opacity *= local / clip.fadeIn;
    if (clip.fadeOut > 0 && local > clip.duration - clip.fadeOut) opacity *= Math.max(0, (clip.duration - local) / clip.fadeOut);
    const s = paramAt(clip, 'transform.scale', local);
    const sx = s * paramAt(clip, 'transform.scaleX', local);
    const sy = s * paramAt(clip, 'transform.scaleY', local);
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, opacity));
    ctx.translate(pw / 2 + paramAt(clip, 'transform.x', local) * f, ph / 2 + paramAt(clip, 'transform.y', local) * f);
    ctx.rotate((paramAt(clip, 'transform.rotation', local) * Math.PI) / 180);
    ctx.scale(sx || 1e-4, sy || 1e-4);
    ctx.drawImage(raster, -pw / 2, -ph / 2);
    ctx.restore();
  }
}

function TitleCard({ tpl, W, H }: { tpl: TitleTemplate; W: number; H: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [hover, setHover] = useState(false);
  const [fontTick, setFontTick] = useState(0);
  const aspect = W / H;
  const pw = 232;
  const ph = Math.round(pw / aspect);
  const dpr = Math.min(2, window.devicePixelRatio || 1);

  useEffect(() => onFontsLoaded(() => setFontTick((n) => n + 1)), []);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const layers = buildPreview(tpl, W, H);
    const cw = Math.round(pw * dpr);
    const ch = Math.round(ph * dpr);
    const rest = Math.min(tpl.duration * 0.6, 2.4);
    if (!hover) {
      drawPreview(ctx, layers, W, cw, ch, rest);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const loop = (now: number) => {
      const t = ((now - t0) / 1000) % (tpl.duration + 0.4);
      drawPreview(ctx, layers, W, cw, ch, Math.min(t, tpl.duration - 1e-3));
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [tpl, W, H, pw, ph, dpr, hover, fontTick]);

  return (
    <button
      type="button"
      className="ins-title-card"
      draggable
      title={`${tpl.description}. Click to add at the playhead, or drag to the timeline.`}
      data-testid={`ins-title-${tpl.id}`}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
      onFocus={() => setHover(true)}
      onBlur={() => setHover(false)}
      onClick={() => addTitle(tpl.id)}
      onDragStart={(e) => {
        e.dataTransfer.setData('omega/title', tpl.id);
        e.dataTransfer.setData('text/plain', tpl.name);
        e.dataTransfer.effectAllowed = 'copy';
      }}
    >
      <canvas ref={ref} className="ins-title-card__canvas" width={Math.round(pw * dpr)} height={Math.round(ph * dpr)} style={{ aspectRatio: `${pw} / ${ph}` }} />
      <span className="ins-title-card__name">{tpl.name}</span>
      <span className="ins-title-card__desc">{tpl.description}</span>
    </button>
  );
}

export function TitlesBrowser(_props: Record<string, unknown> = {}) {
  const size = useEditor((s) => {
    if (!s.project) return '1920x1080';
    const seq = activeSequence(s.project);
    return `${seq.width}x${seq.height}`;
  });
  const hasProject = useEditor((s) => !!s.project);
  const [W, H] = size.split('x').map(Number);
  return (
    <div className="ins-titles" data-testid="ins-titles">
      <div className="ins-titles__head">
        <span className="ins-titles__title">Titles</span>
        <span className="ins-titles__hint">Click to add at the playhead · drag to place</span>
      </div>
      <div className="ins-titles__grid">
        {TITLE_TEMPLATES.map((t) => (
          <TitleCard key={t.id} tpl={t} W={W} H={H} />
        ))}
      </div>
      {!hasProject && <p className="ins-empty-hint">Open a project to add titles.</p>}
    </div>
  );
}
