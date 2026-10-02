// How the renderer gets decoded pictures. Preview supplies frames from
// playing <video> elements (or exact decodes when paused); export supplies
// frames decoded with WebCodecs. The renderer never decodes by itself.

export type FrameImage = HTMLVideoElement | HTMLImageElement | HTMLCanvasElement | OffscreenCanvas | ImageBitmap | VideoFrame;

export interface FrameProvider {
  /**
   * The picture for a media layer at a source time, or null if it is not
   * available yet (the renderer then skips that layer for this frame).
   * `clipId` lets providers keep one decoder/element per clip.
   */
  frame(assetId: string, sourceTime: number, clipId: string): FrameImage | null;
}

export function frameSize(img: FrameImage): { w: number; h: number } {
  if (typeof HTMLVideoElement !== 'undefined' && img instanceof HTMLVideoElement) return { w: img.videoWidth, h: img.videoHeight };
  if (typeof HTMLImageElement !== 'undefined' && img instanceof HTMLImageElement) return { w: img.naturalWidth, h: img.naturalHeight };
  if (typeof VideoFrame !== 'undefined' && img instanceof VideoFrame) return { w: img.displayWidth, h: img.displayHeight };
  return { w: (img as { width: number }).width, h: (img as { height: number }).height };
}
