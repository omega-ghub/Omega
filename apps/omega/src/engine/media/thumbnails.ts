// Filmstrip thumbnails for the timeline and media browser. OWNED BY THE MEDIA PACKAGE.
import type { MediaAsset } from '../../state/types';

/** A cached thumbnail near `time` (within the cache's granularity), or null. */
export function getThumbnail(_assetId: string, _time: number): ImageBitmap | null {
  return null;
}

/** Ensures thumbnails exist around these times (low priority, batched, cached). */
export function requestThumbnails(_asset: MediaAsset, _times: number[]): void {}

/** Notifies when new thumbnails for an asset are ready (redraw). */
export function onThumbnails(_cb: (assetId: string) => void): () => void {
  return () => {};
}
