// FrameProvider for export: one sequential FrameReader per clip (opened
// lazily on originals, never proxies; closed once the clip has been idle for
// a while), with decodeFrameAt as the per-frame fallback. All pictures a
// frame graph needs (including nested sequences, via mediaRequests) are
// decoded before the synchronous render() call.
//
// Ownership (media package contract): images returned by FrameReader belong
// to the reader and stay valid until its next frameAt(); bitmaps from
// decodeFrameAt belong to the decode cache. We never close either.

import { decodeFrameAt, FrameReader } from '../media/decode';
import { mediaRequests, type FrameGraph } from '../render/graph';
import type { FrameImage, FrameProvider } from '../render/frames';
import type { MediaAsset, Project } from '../../state/types';
import { ExportFailed, withTimeout } from './util';

/** Readers unused for this many frames are closed (their clip has ended). */
const IDLE_FRAMES = 12;
const DECODE_TIMEOUT_MS = 60_000;

interface Slot {
  reader: FrameReader | null;
  lastUsed: number;
}

export type DecodeMode = 'reader' | 'random';

export class ExportFrameProvider implements FrameProvider {
  private readonly assets: Map<string, MediaAsset>;
  private readonly slots = new Map<string, Slot>();
  private readonly current = new Map<string, FrameImage>();
  /** Assets whose FrameReader failed at least once: use random access only. */
  private readonly random = new Set<string>();

  constructor(
    project: Project,
    modes: Map<string, DecodeMode> = new Map(),
    private readonly describeTime: (t: number) => string = (t) => `${t.toFixed(3)} s`,
  ) {
    this.assets = new Map(project.assets.map((a) => [a.id, a]));
    for (const [id, m] of modes) if (m === 'random') this.random.add(id);
  }

  /** Decodes every picture `graph` needs. Throws a readable error when one can't be read. */
  async prepare(graph: FrameGraph, frameIndex: number, signal?: AbortSignal): Promise<void> {
    this.current.clear();
    const seen = new Map<string, number>();
    for (const req of mediaRequests(graph)) {
      const key = `${req.clipId}|${req.assetId}|${req.sourceTime}`;
      if (this.current.has(key)) continue;
      const asset = this.assets.get(req.assetId);
      if (!asset) continue;
      // The same clip twice in one frame (a nested sequence used twice) gets its own reader.
      const n = (seen.get(req.clipId) ?? 0) + 1;
      seen.set(req.clipId, n);
      const slotKey = n > 1 ? `${req.clipId}#${n}` : req.clipId;
      const img = await withTimeout(this.read(asset, req.sourceTime, slotKey, frameIndex), DECODE_TIMEOUT_MS, `Decoding "${asset.name}" stopped responding at source time ${this.describeTime(req.sourceTime)}.`, signal);
      if (!img) throw new ExportFailed(`Couldn't decode the frame at ${this.describeTime(req.sourceTime)} of "${asset.name}". The file may be damaged or use a codec this system can't decode.`);
      this.current.set(key, img);
    }
  }

  private async read(asset: MediaAsset, t: number, slotKey: string, frameIndex: number): Promise<FrameImage | null> {
    if (!this.random.has(asset.id)) {
      let slot = this.slots.get(slotKey);
      if (!slot) {
        slot = { reader: await FrameReader.open(asset, { useProxy: false }), lastUsed: frameIndex };
        this.slots.set(slotKey, slot);
      }
      slot.lastUsed = frameIndex;
      const img = slot.reader ? await slot.reader.frameAt(t) : null;
      if (img) return img;
      // fall through: a reader that can't deliver is replaced by random access for this asset
      if (!slot.reader) this.random.add(asset.id);
    }
    return decodeFrameAt(asset, t, { useProxy: false });
  }

  frame(assetId: string, sourceTime: number, clipId: string): FrameImage | null {
    return this.current.get(`${clipId}|${assetId}|${sourceTime}`) ?? null;
  }

  /** Closes readers whose clips have ended. */
  endFrame(frameIndex: number): void {
    for (const [key, slot] of this.slots) {
      if (frameIndex - slot.lastUsed > IDLE_FRAMES) {
        slot.reader?.dispose();
        this.slots.delete(key);
      }
    }
  }

  get openReaders(): number {
    return this.slots.size;
  }

  dispose(): void {
    this.current.clear();
    for (const slot of this.slots.values()) slot.reader?.dispose();
    this.slots.clear();
  }
}

/**
 * Probes how an asset can be decoded for export: a sequential reader, random
 * access, or not at all (null) — e.g. while the media engine is still a stub.
 */
export async function probeDecode(asset: MediaAsset, at = 0): Promise<DecodeMode | null> {
  const reader = await FrameReader.open(asset, { useProxy: false }).catch(() => null);
  if (reader) {
    try {
      const img = await withTimeout(reader.frameAt(at), DECODE_TIMEOUT_MS, `Opening "${asset.name}" stopped responding.`);
      if (img) return 'reader';
    } finally {
      reader.dispose();
    }
  }
  const bmp = await withTimeout(decodeFrameAt(asset, at, { useProxy: false }), DECODE_TIMEOUT_MS, `Opening "${asset.name}" stopped responding.`).catch(() => null);
  return bmp ? 'random' : null;
}
