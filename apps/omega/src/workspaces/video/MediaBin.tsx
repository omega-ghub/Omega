import { useEffect, useState } from 'react';
import { useStore } from '../../state/store';
import type { MediaAsset } from '../../state/types';
import { I } from '../../ui/Icons';
import { formatDuration } from '../../ui/format';

const thumbCache = new Map<string, string>();

function useThumbnail(asset: MediaAsset): string | null {
  const [thumb, setThumb] = useState<string | null>(thumbCache.get(asset.id) ?? null);
  useEffect(() => {
    if (thumb || asset.offline) return;
    const url = window.omega.media.urlFor(asset.path);
    let cancelled = false;
    const finish = (dataUrl: string) => {
      thumbCache.set(asset.id, dataUrl);
      if (!cancelled) setThumb(dataUrl);
    };
    const draw = (src: CanvasImageSource, sw: number, sh: number) => {
      const c = document.createElement('canvas');
      c.width = 160;
      c.height = 90;
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, 160, 90);
      const scale = Math.min(160 / sw, 90 / sh);
      ctx.drawImage(src, (160 - sw * scale) / 2, (90 - sh * scale) / 2, sw * scale, sh * scale);
      finish(c.toDataURL('image/jpeg', 0.7));
    };
    if (asset.kind === 'image') {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => draw(img, img.naturalWidth, img.naturalHeight);
      img.src = url;
    } else if (asset.kind === 'video') {
      const v = document.createElement('video');
      v.crossOrigin = 'anonymous';
      v.muted = true;
      v.preload = 'auto';
      v.src = url;
      v.addEventListener('loadeddata', () => {
        v.currentTime = Math.min(1, asset.duration / 2);
      });
      v.addEventListener('seeked', () => {
        draw(v, v.videoWidth, v.videoHeight);
        v.removeAttribute('src');
        v.load();
      });
    }
    return () => {
      cancelled = true;
    };
  }, [asset, thumb]);
  return thumb;
}

export function MediaBin() {
  const assets = useStore((s) => s.project!.assets);
  const importing = useStore((s) => s.importing);
  const importMedia = useStore((s) => s.importMedia);
  const selected = useStore((s) => s.selectedAssetId);
  const selectAsset = useStore((s) => s.selectAsset);
  const addClip = useStore((s) => s.addClip);
  const removeAsset = useStore((s) => s.removeAsset);

  return (
    <section className="panel media">
      <div className="panel__head">
        <span className="panel__title">Media</span>
        <button className="btn btn--small btn--accent" onClick={() => importMedia()} disabled={importing}>
          <I.Import size={14} /> {importing ? 'Importing…' : 'Import'}
        </button>
      </div>
      <div className="media__list" onClick={() => selectAsset(null)}>
        {assets.length === 0 && (
          <div className="media__empty">
            <I.Import size={28} />
            <div>Import video, audio or images to start.</div>
            <div className="muted">Ctrl+I · Files stay where they are.</div>
          </div>
        )}
        {assets.map((a) => (
          <MediaItem key={a.id} asset={a} selected={selected === a.id} onSelect={() => selectAsset(a.id)} onAdd={() => addClip(a.id, null, null)} />
        ))}
      </div>
      {selected && (
        <div className="panel__foot">
          <button className="btn btn--small btn--ghost" onClick={() => addClip(selected, null, null)}>
            <I.Plus size={14} /> Add at playhead
          </button>
          <button className="btn btn--small btn--ghost" onClick={() => removeAsset(selected)}>
            <I.Trash size={14} />
          </button>
        </div>
      )}
    </section>
  );
}

function MediaItem({ asset, selected, onSelect, onAdd }: { asset: MediaAsset; selected: boolean; onSelect: () => void; onAdd: () => void }) {
  const thumb = useThumbnail(asset);
  const Icon = asset.kind === 'audio' ? I.Music : asset.kind === 'image' ? I.Image : I.Film;
  return (
    <div
      className={`media-item ${selected ? 'is-selected' : ''} ${asset.offline ? 'is-offline' : ''}`}
      draggable={!asset.offline}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
      onDoubleClick={onAdd}
      onDragStart={(e) => {
        e.dataTransfer.setData('omega/asset', asset.id);
        e.dataTransfer.effectAllowed = 'copy';
      }}
      title={asset.path}
    >
      <div className={`media-item__thumb media-item__thumb--${asset.kind}`}>{thumb ? <img src={thumb} alt="" /> : <Icon size={20} />}</div>
      <div className="media-item__text">
        <div className="media-item__name">{asset.name}</div>
        <div className="media-item__meta">
          {asset.offline ? 'Offline — file not found' : asset.kind === 'image' ? `${asset.width}×${asset.height}` : `${formatDuration(asset.duration)}${asset.width ? ` · ${asset.width}×${asset.height}` : ''}${asset.fps ? ` · ${asset.fps} fps` : ''}`}
        </div>
      </div>
    </div>
  );
}
