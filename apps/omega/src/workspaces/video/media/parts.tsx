// Small shared pieces of the media browser: badges, timecode, handlers.
import { useStore } from 'zustand';
import { mediaJobs } from '../../../engine/media/jobs';
import { INPUT_TRANSFORM_LABELS, is4k, isHdrTransform, isLogTransform } from '../../../engine/media/mediaMath';
import { effectiveProxyStatus } from '../../../engine/media/proxies';
import { formatTimecode } from '../../../engine/time';
import type { Bin, MediaAsset } from '../../../state/types';
import { I } from '../../../ui/Icons';
import { MdIcons } from './icons';

export interface ItemHandlers {
  down(id: string, e: React.MouseEvent): void;
  click(id: string, e: React.MouseEvent): void;
  dbl(id: string): void;
  menu(id: string, e: React.MouseEvent): void;
  drag(id: string, e: React.DragEvent): void;
  binOpen(id: string): void;
  binMenu(bin: Bin, e: React.MouseEvent): void;
}

/** Compact, unambiguous timecode: '0:00:06:12' (single-digit hours below 10 h). */
export function tcLabel(seconds: number, fps: number): string {
  const tc = formatTimecode(Math.max(0, seconds), fps > 0 ? fps : 30);
  return tc.startsWith('0') ? tc.slice(1) : tc;
}

/** Asset duration for badges ('Still' for images). */
export function durationTc(a: MediaAsset, fallbackFps: number): string {
  if (a.kind === 'image') return 'Still';
  return tcLabel(a.duration, a.fps && a.fps > 0 ? a.fps : fallbackFps);
}

export function fullTc(a: MediaAsset, fallbackFps: number): string {
  if (a.kind === 'image') return '—';
  return formatTimecode(a.duration, a.fps && a.fps > 0 ? a.fps : fallbackFps);
}

export function resolutionText(a: MediaAsset): string {
  return a.width && a.height ? `${a.width}×${a.height}` : '';
}

export function fpsText(a: MediaAsset): string {
  if (!a.fps) return '';
  return String(+a.fps.toFixed(3));
}

export function audioText(a: MediaAsset, label: (c?: string | null) => string): string {
  if (!a.hasAudio && !a.audioCodec) return '';
  const parts = [label(a.audioCodec)];
  if (a.channels) parts.push(a.channels === 1 ? 'Mono' : a.channels === 2 ? 'Stereo' : `${a.channels} ch`);
  if (a.sampleRate) parts.push(`${+(a.sampleRate / 1000).toFixed(1)} kHz`);
  return parts.filter(Boolean).join(' · ');
}

export function ProxyBadge({ asset }: { asset: MediaAsset }) {
  const job = useStore(mediaJobs, (s) => s.proxies.find((j) => j.assetId === asset.id));
  const status = effectiveProxyStatus(asset);
  if (job) {
    const pct = Math.round(job.progress * 100);
    return (
      <span className="md-badge md-badge--building" data-testid="md-badge-proxy-building" title={job.status === 'queued' ? 'Proxy queued' : job.status === 'paused' ? 'Proxy paused during playback' : `Building proxy (${pct}%)`}>
        <I.Proxy size={11} />
        {job.status === 'queued' ? '…' : `${pct}%`}
      </span>
    );
  }
  if (status === 'ready')
    return (
      <span className="md-badge md-badge--proxy" data-testid="md-badge-proxy" title="Proxy ready">
        <I.Proxy size={11} />
      </span>
    );
  if (status === 'failed')
    return (
      <span className="md-badge md-badge--danger" title="Proxy failed">
        <I.Proxy size={11} />!
      </span>
    );
  return null;
}

/** Proxy, offline, log/HDR and 4K badges. */
export function AssetBadges({ asset }: { asset: MediaAsset }) {
  const t = asset.inputTransform;
  return (
    <>
      {asset.offline && (
        <span className="md-badge md-badge--danger" data-testid="md-badge-offline" title="Media offline">
          <MdIcons.Offline size={11} />
          Offline
        </span>
      )}
      <ProxyBadge asset={asset} />
      {isLogTransform(t) && (
        <span className="md-badge md-badge--color" title={INPUT_TRANSFORM_LABELS[t]}>
          Log
        </span>
      )}
      {isHdrTransform(t) && (
        <span className="md-badge md-badge--color" title={INPUT_TRANSFORM_LABELS[t]}>
          HDR
        </span>
      )}
      {is4k(asset) && asset.kind !== 'audio' && <span className="md-badge">4K</span>}
    </>
  );
}
