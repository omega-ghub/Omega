// Frame decoding (WebCodecs via Mediabunny). OWNED BY THE MEDIA PACKAGE.
// Used by the viewer (exact frames while paused), export (sequential reads),
// thumbnails and still-frame export. Stub until the media package lands.

import type { FrameImage } from '../render/frames';
import type { MediaAsset } from '../../state/types';

export interface DecodeOptions {
  /** Downscale on decode (thumbnails, proxies, scopes). */
  maxWidth?: number;
  maxHeight?: number;
  /** Read the proxy file instead of the original when one is ready. */
  useProxy?: boolean;
}

/** Sequential reader: fastest when times only increase (export, play-ahead). */
export class FrameReader {
  static async open(_asset: MediaAsset, _opts: DecodeOptions = {}): Promise<FrameReader | null> {
    return null;
  }
  /** The frame displayed at `sourceTime` (the latest frame with timestamp ≤ time). */
  async frameAt(_sourceTime: number): Promise<FrameImage | null> {
    return null;
  }
  dispose(): void {}
}

/** Random access: decode one exact frame (paused viewer, frame export). */
export async function decodeFrameAt(_asset: MediaAsset, _sourceTime: number, _opts: DecodeOptions = {}): Promise<ImageBitmap | null> {
  return null;
}
