// Export the current program frame as a PNG at the full sequence (or active
// format) resolution. OWNED BY THE VIEWER PACKAGE.

import { Renderer } from '../gpu/Renderer';
import { decodeFrameAt } from '../media/decode';
import type { FrameImage } from '../render/frames';
import { buildFrameGraph, mediaRequests } from '../render/graph';
import { formatTimecode } from '../time';
import { useEditor } from '../../state/store';
import { activeSequence } from '../../state/types';
import type { MediaAsset } from '../../state/types';
import { mediaUrl } from './preview';

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/** Fallback when exact decoding is unavailable: seek a throwaway element. */
function seekVideo(url: string, t: number): Promise<HTMLVideoElement | null> {
  return new Promise((resolve) => {
    const v = document.createElement('video');
    v.crossOrigin = 'anonymous';
    v.muted = true;
    v.preload = 'auto';
    const fail = () => resolve(null);
    const timer = window.setTimeout(fail, 8000);
    v.addEventListener('error', () => {
      clearTimeout(timer);
      fail();
    });
    v.addEventListener('loadedmetadata', () => {
      v.currentTime = Math.max(0, Math.min(t, (v.duration || t) - 1e-3));
    });
    v.addEventListener('seeked', () => {
      clearTimeout(timer);
      resolve(v);
    });
    v.src = url;
  });
}

async function frameFor(asset: MediaAsset, t: number): Promise<FrameImage | null> {
  if (asset.kind === 'image') return loadImage(mediaUrl(asset.path));
  const bmp = await decodeFrameAt(asset, t).catch(() => null);
  return bmp ?? (await seekVideo(mediaUrl(asset.path), t));
}

/** Renders the frame at `t` (default: the playhead) and returns it as a PNG blob. */
export async function renderFramePng(t?: number): Promise<{ blob: Blob; width: number; height: number }> {
  const s = useEditor.getState();
  const project = s.project;
  if (!project) throw new Error('No project is open.');
  const seq = activeSequence(project);
  const time = t ?? s.playhead;
  const graph = buildFrameGraph(project, seq.id, time, { formatId: seq.activeFormatId });
  const assets = new Map(project.assets.map((a) => [a.id, a]));
  const frames = new Map<string, FrameImage>();
  await Promise.all(
    mediaRequests(graph).map(async (r) => {
      const asset = assets.get(r.assetId);
      if (!asset) return;
      const img = await frameFor(asset, r.sourceTime);
      if (img) frames.set(`${r.clipId}@${r.sourceTime}`, img);
    }),
  );
  try {
    await document.fonts?.ready;
  } catch {
    /* ignore */
  }
  const canvas = new OffscreenCanvas(graph.width, graph.height);
  const renderer = new Renderer(canvas);
  try {
    renderer.setSize(graph.width, graph.height);
    renderer.render(graph, { frame: (_a, st, clipId) => frames.get(`${clipId}@${st}`) ?? null }, {});
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    return { blob, width: graph.width, height: graph.height };
  } finally {
    renderer.dispose();
    for (const f of frames.values()) {
      if (f instanceof HTMLVideoElement) {
        f.removeAttribute('src');
        f.load();
      }
    }
  }
}

let busy = false;

/** Mod+Shift+E: render the current frame, ask where to save it, write the PNG. */
export async function exportCurrentFrame(): Promise<void> {
  const s = useEditor.getState();
  const project = s.project;
  if (!project || busy) return;
  const seq = activeSequence(project);
  const t = s.playhead;
  const tc = formatTimecode(t, seq.fps, seq.dropFrame, seq.startTimecode).replace(/[:;]/g, '-');
  const fmt = seq.activeFormatId ? seq.formats.find((f) => f.id === seq.activeFormatId) : null;
  const name = `${seq.name}${fmt ? ` ${fmt.name}` : ''} ${tc}`.replace(/[\\/:*?"<>|]+/g, ' ').trim();
  busy = true;
  try {
    const path = await window.omega.dialogs.pickSavePath('Export frame', name, 'png');
    if (!path) return;
    const { blob } = await renderFramePng(t);
    await window.omega.files.writeBinary(path, await blob.arrayBuffer());
    useEditor.getState().showToast(`Frame exported to ${path}`, 'success');
  } catch (e) {
    useEditor.getState().showToast(`Could not export the frame: ${e instanceof Error ? e.message : String(e)}`, 'error');
  } finally {
    busy = false;
  }
}
