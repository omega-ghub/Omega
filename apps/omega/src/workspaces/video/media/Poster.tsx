// The picture of an asset in the grid: a poster frame, hover-scrub through
// cached thumbnails (mouse x → source time), or a waveform for audio.
import { memo, useCallback, useEffect, useRef } from 'react';
import { getPeaks, onPeaks, requestPeaks } from '../../../engine/audio/engine';
import { posterTime } from '../../../engine/media/mediaMath';
import { getPoster, getThumbnail, onThumbnails, requestPoster, requestThumbnails, THUMB_HEIGHT } from '../../../engine/media/thumbnails';
import { useEditor } from '../../../state/store';
import type { MediaAsset } from '../../../state/types';
import { I } from '../../../ui/Icons';

const SCRUB_STEPS_MAX = 64;

function drawContain(ctx: CanvasRenderingContext2D, img: CanvasImageSource & { width: number; height: number }, w: number, h: number) {
  const s = Math.min(w / img.width, h / img.height);
  const dw = img.width * s;
  const dh = img.height * s;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
}

function drawPeaks(ctx: CanvasRenderingContext2D, data: Float32Array, w: number, h: number, color: string) {
  const buckets = data.length / 2;
  if (!buckets) return;
  const mid = h / 2;
  ctx.fillStyle = color;
  for (let x = 0; x < w; x++) {
    const a = Math.floor((x / w) * buckets);
    const b = Math.max(a + 1, Math.floor(((x + 1) / w) * buckets));
    let lo = 0;
    let hi = 0;
    for (let i = a; i < b && i < buckets; i++) {
      lo = Math.min(lo, data[i * 2]);
      hi = Math.max(hi, data[i * 2 + 1]);
    }
    const y0 = mid - hi * mid * 0.9;
    const y1 = mid - lo * mid * 0.9;
    ctx.fillRect(x, y0, 1, Math.max(1, y1 - y0));
  }
}

export const Poster = memo(function Poster({ asset, onScrub }: { asset: MediaAsset; onScrub?: (t: number | null) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lineRef = useRef<HTMLDivElement>(null);
  const hoverRef = useRef<number | null>(null);
  const visibleRef = useRef(false);
  const drawnRef = useRef(false);
  const assetRef = useRef(asset);
  assetRef.current = asset;
  const scrubbable = asset.kind === 'video' && !asset.offline && asset.duration > 0;

  const draw = useCallback(() => {
    const c = canvasRef.current;
    if (!c) return;
    const a = assetRef.current;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(c.clientWidth * dpr));
    const h = Math.max(1, Math.round(c.clientHeight * dpr));
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, w, h);
    drawnRef.current = false;
    if (a.offline) return;
    if (a.kind === 'audio') {
      const peaks = getPeaks(a.id);
      if (peaks?.data?.length) {
        drawPeaks(ctx, peaks.data, w, h, getComputedStyle(c).color || '#888');
        drawnRef.current = true;
      }
    } else {
      const t = hoverRef.current ?? posterTime(a);
      let bmp: ImageBitmap | null = null;
      // large cards: a sharp poster frame (filmstrip thumbnails are ~96 px tall)
      if (hoverRef.current === null && h > (a.kind === 'image' ? THUMB_HEIGHT * 2 : THUMB_HEIGHT) * 1.15) {
        bmp = getPoster(a, t, h);
        if (!bmp && visibleRef.current) requestPoster(a, t, h);
      }
      bmp ??= getThumbnail(a.id, t);
      if (bmp) {
        try {
          drawContain(ctx, bmp, w, h);
          drawnRef.current = true;
        } catch {
          /* bitmap went away */
        }
      }
    }
    c.dataset.ready = drawnRef.current ? 'true' : 'false';
  }, []);

  // Lazy: only request pictures while the card is on screen.
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const a = asset;
    const request = () => {
      if (a.offline) return;
      if (a.kind === 'audio') {
        const p = useEditor.getState().project;
        if (p && !getPeaks(a.id)) void requestPeaks(p, a.id).then(() => draw(), () => undefined);
      } else requestThumbnails(a, [posterTime(a)]);
    };
    const io = new IntersectionObserver((entries) => {
      const vis = entries.some((e) => e.isIntersecting);
      visibleRef.current = vis;
      if (vis) {
        request();
        draw();
      }
    });
    io.observe(c);
    const ro = new ResizeObserver(() => visibleRef.current && draw());
    ro.observe(c);
    const offThumbs = onThumbnails((id) => {
      if (id === a.id && visibleRef.current) draw();
    });
    const offPeaks = a.kind === 'audio' ? onPeaks((id) => id === a.id && visibleRef.current && draw()) : () => undefined;
    draw();
    return () => {
      io.disconnect();
      ro.disconnect();
      offThumbs();
      offPeaks();
    };
  }, [asset, draw]);

  const stepsFor = (width: number) => Math.max(16, Math.min(SCRUB_STEPS_MAX, Math.round(width / 3)));

  const onEnter = (e: React.MouseEvent) => {
    if (!scrubbable) return;
    const n = stepsFor(e.currentTarget.clientWidth);
    const times = Array.from({ length: n }, (_, i) => (i / (n - 1)) * Math.max(0, asset.duration - 1e-3));
    requestThumbnails(asset, times);
  };

  const onMove = (e: React.MouseEvent) => {
    if (!scrubbable) return;
    const r = e.currentTarget.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (e.clientX - r.left) / Math.max(1, r.width)));
    const n = stepsFor(r.width);
    const q = Math.round(frac * (n - 1)) / (n - 1);
    const t = q * Math.max(0, asset.duration - 1e-3);
    hoverRef.current = t;
    requestThumbnails(asset, [t]);
    if (lineRef.current) {
      lineRef.current.style.transform = `translateX(${frac * r.width}px)`;
      lineRef.current.style.opacity = '1';
    }
    draw();
    onScrub?.(t);
  };

  const onLeave = () => {
    if (hoverRef.current === null) return;
    hoverRef.current = null;
    if (lineRef.current) lineRef.current.style.opacity = '0';
    draw();
    onScrub?.(null);
  };

  const Glyph = asset.kind === 'audio' ? I.Music : asset.kind === 'image' ? I.Image : I.Film;
  return (
    <div className={`md-poster md-poster--${asset.kind}`} onMouseEnter={onEnter} onMouseMove={onMove} onMouseLeave={onLeave}>
      <span className="md-poster__glyph" aria-hidden="true">
        <Glyph size={22} />
      </span>
      <canvas ref={canvasRef} className="md-poster__canvas" data-testid="md-poster" />
      {scrubbable && <div ref={lineRef} className="md-poster__line" />}
    </div>
  );
});
