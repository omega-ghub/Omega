// Frame decoding (WebCodecs via Mediabunny). OWNED BY THE MEDIA PACKAGE.
// Used by the viewer (exact frames while paused), export (sequential reads),
// thumbnails and still-frame export.
//
// FrameReader — sequential access (export, play-ahead):
//   const r = await FrameReader.open(asset, { maxWidth: 1920 });
//   const img = await r.frameAt(t);   // VideoFrame or HTMLCanvasElement
//   … r.dispose();
//   * Returns a VideoFrame when decoding at full size with no rotation, flip
//     or non-square pixels (zero copy); otherwise an HTMLCanvasElement with
//     the picture scaled to fit maxWidth × maxHeight and rotation applied.
//     Images return an HTMLImageElement (or a canvas when downscaled).
//   * The reader OWNS the returned image. It stays valid until the next
//     frameAt() / dispose() call on the same reader. Never close it yourself.
//   * Forward reads decode sequentially; backward seeks, and forward jumps past
//     a key frame, reopen the decoder at the nearest key frame.
//   * Calls are serialized, so concurrent frameAt() calls are safe (each one
//     invalidates the image returned by the previous one).
//
// decodeFrameAt — random access (paused viewer, stills, hover scrub):
//   Returns an ImageBitmap from a shared LRU cache (keyed by asset, source
//   file, frame index and size; memory-capped). Identical in-flight requests
//   are de-duplicated. The cache owns the bitmaps: never close them.

import { EncodedPacketSink, VideoSampleSink, type Input, type InputVideoTrack, type UrlSource, type VideoSample } from 'mediabunny';
import type { FrameImage } from '../render/frames';
import type { MediaAsset } from '../../state/types';
import { LruCache } from './lru';
import { fitWithin, frameIndex } from './mediaMath';
import { imageSize, loadImage, openInput, sourcePathFor } from './source';

export interface DecodeOptions {
  /** Downscale on decode (thumbnails, proxies, scopes). */
  maxWidth?: number;
  maxHeight?: number;
  /** Read the proxy file instead of the original when one is ready. */
  useProxy?: boolean;
}

const EPS = 1e-5;
/** Forward jumps longer than this check for a key frame in between (cheaper to reopen there). */
const JUMP_CHECK = 0.5;

interface Backend {
  readonly width: number;
  readonly height: number;
  frameAt(t: number): Promise<FrameImage | null>;
  dispose(): void;
}

/** Sequential reader: fastest when times only increase (export, play-ahead). */
export class FrameReader {
  private chain: Promise<unknown> = Promise.resolve();
  private disposed = false;

  private constructor(
    private backend: Backend,
    /** The file actually being read (the proxy when one was used). */
    readonly sourcePath: string,
    readonly usingProxy: boolean,
  ) {}

  static async open(asset: MediaAsset, opts: DecodeOptions = {}): Promise<FrameReader | null> {
    if (!asset || asset.offline) return null;
    try {
      if (asset.kind === 'image') {
        const backend = await ImageBackend.open(asset.path, opts);
        return new FrameReader(backend, asset.path, false);
      }
      if (!asset.hasVideo) return null;
      const src = sourcePathFor(asset, opts.useProxy);
      let backend = await VideoBackend.open(src.path, opts).catch((e) => {
        if (!src.proxy) throw e;
        return null;
      });
      if (backend) return new FrameReader(backend, src.path, src.proxy);
      // the proxy is missing or broken: fall back to the original
      backend = await VideoBackend.open(asset.path, opts);
      return backend ? new FrameReader(backend, asset.path, false) : null;
    } catch (err) {
      console.warn('[media] cannot open', asset.name, err);
      return null;
    }
  }

  /** Output size of the returned images. */
  get width(): number {
    return this.backend.width;
  }
  get height(): number {
    return this.backend.height;
  }

  /** The frame displayed at `sourceTime` (the latest frame with timestamp ≤ time). */
  async frameAt(sourceTime: number): Promise<FrameImage | null> {
    return this.serial(() => this.backend.frameAt(sourceTime));
  }

  /** frameAt + an ImageBitmap copy, atomically (the copy outlives the reader). */
  async bitmapAt(sourceTime: number): Promise<ImageBitmap | null> {
    return this.serial(async () => {
      const img = await this.backend.frameAt(sourceTime);
      return img ? createImageBitmap(img as ImageBitmapSource) : null;
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    // let an in-flight read finish before tearing the decoder down
    void this.chain.finally(() => this.backend.dispose());
  }

  private serial<T>(fn: () => Promise<T | null>): Promise<T | null> {
    const run = async () => (this.disposed ? null : fn());
    const p = this.chain.then(run, run);
    this.chain = p.catch(() => undefined);
    return p.catch((err) => {
      console.warn('[media] decode failed', this.sourcePath, err);
      return null;
    });
  }
}

class VideoBackend implements Backend {
  private iter: AsyncGenerator<VideoSample, void, unknown> | null = null;
  private iterDone = false;
  private lookahead: VideoSample | null = null;
  private currentTs = NaN;
  private image: VideoFrame | HTMLCanvasElement | OffscreenCanvas | null = null;
  private canvases: (HTMLCanvasElement | OffscreenCanvas)[] = [];
  private canvasIndex = 0;
  private disposed = false;

  private constructor(
    private input: Input<UrlSource>,
    private sink: VideoSampleSink,
    private packets: EncodedPacketSink,
    private firstTs: number,
    readonly width: number,
    readonly height: number,
    private mode: 'frame' | 'canvas',
    private alpha: boolean,
  ) {}

  static async open(path: string, opts: DecodeOptions): Promise<VideoBackend | null> {
    const input = openInput(path, 32);
    try {
      const track: InputVideoTrack | null = await input.getPrimaryVideoTrack();
      if (!track || !(await track.canDecode())) {
        input.dispose();
        return null;
      }
      const dw = await track.getDisplayWidth();
      const dh = await track.getDisplayHeight();
      const rotation = await track.getRotation();
      const flip = await track.getFlip().catch(() => false);
      const par = await track.getPixelAspectRatio().catch(() => ({ num: 1, den: 1 }));
      const out = fitWithin(dw, dh, opts.maxWidth, opts.maxHeight);
      const full = out.width === dw && out.height === dh;
      const mode = full && rotation === 0 && !flip && par.num === par.den && typeof VideoFrame !== 'undefined' ? 'frame' : 'canvas';
      const firstTs = await track.getFirstTimestamp().catch(() => 0);
      const alpha = await track.canBeTransparent().catch(() => false);
      return new VideoBackend(input, new VideoSampleSink(track), new EncodedPacketSink(track), firstTs, out.width, out.height, mode, alpha);
    } catch (err) {
      input.dispose();
      throw err;
    }
  }

  async frameAt(time: number): Promise<FrameImage | null> {
    if (this.disposed) return null;
    const t = Math.max(Number.isFinite(time) ? time : 0, this.firstTs);
    const cur = this.currentTs;
    let reopen = !this.iter || (!Number.isNaN(cur) && t < cur - EPS) || (Number.isNaN(cur) && !this.lookahead && this.iterDone);
    if (!reopen && !Number.isNaN(cur) && t > cur + JUMP_CHECK) {
      // Reopen only if a key frame lies between here and there; otherwise decoding forward is cheaper.
      const key = await this.packets.getKeyPacket(t, { metadataOnly: true }).catch(() => null);
      if (key && key.timestamp > cur + EPS) reopen = true;
    }
    if (reopen) await this.reopen(t);

    let shown: VideoSample | null = null;
    try {
      for (;;) {
        if (!this.lookahead) {
          if (this.iterDone || !this.iter) break;
          const r = await this.iter.next();
          if (r.done) {
            this.iterDone = true;
            break;
          }
          this.lookahead = r.value;
        }
        if (this.lookahead.timestamp <= t + EPS) {
          shown?.close();
          shown = this.lookahead;
          this.lookahead = null;
        } else break;
      }
    } catch (err) {
      shown?.close();
      shown = null;
      await this.closeIterator();
      if (this.disposed) return null;
      throw err;
    }
    // t before the first decodable frame: show the first one
    if (!shown && Number.isNaN(this.currentTs) && this.lookahead) {
      shown = this.lookahead;
      this.lookahead = null;
    }
    if (shown) {
      try {
        if (shown.timestamp !== this.currentTs || !this.image) this.present(shown);
      } finally {
        shown.close();
      }
    }
    return this.image;
  }

  private present(sample: VideoSample) {
    if (this.mode === 'frame') {
      (this.image as VideoFrame | null)?.close();
      this.image = sample.toVideoFrame();
    } else {
      // two canvases, alternating: the previous image stays intact while this one is drawn
      this.canvasIndex ^= 1;
      let canvas = this.canvases[this.canvasIndex];
      if (!canvas) {
        canvas = typeof document !== 'undefined' ? document.createElement('canvas') : new OffscreenCanvas(this.width, this.height);
        canvas.width = this.width;
        canvas.height = this.height;
        this.canvases[this.canvasIndex] = canvas;
      }
      const ctx = canvas.getContext('2d', { alpha: this.alpha }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
      ctx.imageSmoothingQuality = 'high';
      if (this.alpha) ctx.clearRect(0, 0, this.width, this.height);
      sample.drawWithFit(ctx, { fit: 'fill' });
      this.image = canvas;
    }
    this.currentTs = sample.timestamp;
  }

  private async reopen(t: number) {
    await this.closeIterator();
    this.iter = this.sink.samples(t);
    this.iterDone = false;
  }

  private async closeIterator() {
    this.lookahead?.close();
    this.lookahead = null;
    const it = this.iter;
    this.iter = null;
    this.iterDone = false;
    if (it) await it.return(undefined).catch(() => undefined);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    void this.closeIterator().finally(() => {
      if (this.mode === 'frame') (this.image as VideoFrame | null)?.close();
      this.image = null;
      this.canvases = [];
      this.input.dispose();
    });
  }
}

class ImageBackend implements Backend {
  private constructor(
    private image: HTMLImageElement | HTMLCanvasElement | null,
    readonly width: number,
    readonly height: number,
  ) {}

  static async open(path: string, opts: DecodeOptions): Promise<ImageBackend> {
    const img = await loadImage(path);
    await img.decode().catch(() => undefined);
    const nat = imageSize(img);
    const out = fitWithin(nat.width, nat.height, opts.maxWidth, opts.maxHeight);
    const intrinsic = img.naturalWidth > 0 && img.naturalHeight > 0;
    if (intrinsic && out.width === nat.width && out.height === nat.height) return new ImageBackend(img, out.width, out.height);
    const canvas = document.createElement('canvas');
    canvas.width = out.width;
    canvas.height = out.height;
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, out.width, out.height);
    img.src = '';
    return new ImageBackend(canvas, out.width, out.height);
  }

  async frameAt(): Promise<FrameImage | null> {
    return this.image;
  }

  dispose() {
    if (this.image instanceof HTMLImageElement) this.image.src = '';
    this.image = null;
  }
}

// ---------------------------------------------------------------------------
// Random access with a shared bitmap cache
// ---------------------------------------------------------------------------

const BITMAP_BUDGET = 384 * 1024 * 1024;
const MAX_READERS = 4;
const FAIL_RETRY_MS = 10_000;

// Evicted bitmaps are not closed: a consumer may still be drawing one; GC frees them.
const bitmaps = new LruCache<string, ImageBitmap>(BITMAP_BUDGET);
const inflight = new Map<string, Promise<ImageBitmap | null>>();
const readers = new Map<string, { reader: Promise<FrameReader | null>; assetId: string; used: number }>();
const failedOpen = new Map<string, number>();

function sizeKey(opts: DecodeOptions): string {
  return `${Math.round(opts.maxWidth ?? 0)}x${Math.round(opts.maxHeight ?? 0)}`;
}

function readerFor(asset: MediaAsset, path: string, opts: DecodeOptions): Promise<FrameReader | null> {
  const key = `${asset.id}|${path}|${sizeKey(opts)}`;
  const hit = readers.get(key);
  if (hit) {
    hit.used = performance.now();
    return hit.reader;
  }
  const failedAt = failedOpen.get(key);
  if (failedAt && performance.now() - failedAt < FAIL_RETRY_MS) return Promise.resolve(null);
  const reader = FrameReader.open(asset, opts).then((r) => {
    if (!r) {
      failedOpen.set(key, performance.now());
      readers.delete(key);
    }
    return r;
  });
  readers.set(key, { reader, assetId: asset.id, used: performance.now() });
  if (readers.size > MAX_READERS) {
    const oldest = [...readers.entries()].sort((a, b) => a[1].used - b[1].used)[0];
    readers.delete(oldest[0]);
    void oldest[1].reader.then((r) => r?.dispose());
  }
  return reader;
}

/** Random access: decode one exact frame (paused viewer, frame export). */
export async function decodeFrameAt(asset: MediaAsset, sourceTime: number, opts: DecodeOptions = {}): Promise<ImageBitmap | null> {
  if (!asset || asset.offline || (asset.kind !== 'image' && !asset.hasVideo)) return null;
  const src = sourcePathFor(asset, opts.useProxy);
  const fi = asset.kind === 'image' ? 0 : frameIndex(Math.max(0, sourceTime), asset.fps);
  const key = `${asset.id}|${src.path}|${fi}|${sizeKey(opts)}`;
  const hit = bitmaps.get(key);
  if (hit) return hit;
  const pending = inflight.get(key);
  if (pending) return pending;
  const p = (async () => {
    const reader = await readerFor(asset, src.path, opts);
    if (!reader) return null;
    const bmp = await reader.bitmapAt(Math.max(0, sourceTime));
    if (bmp) bitmaps.set(key, bmp, bmp.width * bmp.height * 4);
    return bmp;
  })()
    .catch((err) => {
      console.warn('[media] decodeFrameAt failed', asset.name, err);
      return null;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

/** A cached exact frame, if one is already decoded (no decoding). */
export function peekDecodedFrame(asset: MediaAsset, sourceTime: number, opts: DecodeOptions = {}): ImageBitmap | null {
  const src = sourcePathFor(asset, opts.useProxy);
  const fi = asset.kind === 'image' ? 0 : frameIndex(Math.max(0, sourceTime), asset.fps);
  return bitmaps.peek(`${asset.id}|${src.path}|${fi}|${sizeKey(opts)}`) ?? null;
}

/** Drops cached frames and open decoders of an asset (after relink, replace or proxy changes). */
export function invalidateDecodeCache(assetId: string): void {
  bitmaps.deleteWhere((k) => k.startsWith(`${assetId}|`));
  for (const [k, v] of [...readers.entries()]) {
    if (v.assetId !== assetId) continue;
    readers.delete(k);
    void v.reader.then((r) => r?.dispose());
  }
  for (const k of [...failedOpen.keys()]) if (k.startsWith(`${assetId}|`)) failedOpen.delete(k);
}

/** Memory currently held by decoded frames, in bytes (diagnostics). */
export function decodeCacheBytes(): number {
  return bitmaps.bytes;
}
