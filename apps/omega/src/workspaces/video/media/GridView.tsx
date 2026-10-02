// Grid (icon) view: 16:9 cards with hover-scrub posters and badges.
import { memo, useRef } from 'react';
import { LABEL_COLORS } from '../../../state/defaults';
import type { Bin, MediaAsset } from '../../../state/types';
import { renameAsset, renameBin } from './commands';
import { MdIcons } from './icons';
import { AssetBadges, durationTc, fpsText, resolutionText, tcLabel, type ItemHandlers } from './parts';
import { Poster } from './Poster';
import { RenameInput } from './RenameInput';
import { useMediaUi } from './uiStore';

export function GridView({
  bins,
  assets,
  selected,
  handlers,
  seqFps,
  binCounts,
}: {
  bins: Bin[];
  assets: MediaAsset[];
  selected: Set<string>;
  handlers: ItemHandlers;
  seqFps: number;
  binCounts: Map<string, number>;
}) {
  const thumbWidth = useMediaUi((s) => s.thumbWidth);
  const renaming = useMediaUi((s) => s.renaming);
  const dropBin = useMediaUi((s) => s.dropBin);
  return (
    <div className="md-grid" data-testid="md-grid" style={{ '--md-card': `${thumbWidth}px` } as React.CSSProperties} role="listbox" aria-multiselectable="true">
      {bins.map((b) => (
        <BinCard key={b.id} bin={b} count={binCounts.get(b.id) ?? 0} handlers={handlers} renaming={renaming?.kind === 'bin' && renaming.id === b.id && renaming.where !== 'tree'} dropping={dropBin === b.id} />
      ))}
      {assets.map((a) => (
        <AssetCard
          key={a.id}
          asset={a}
          selected={selected.has(a.id)}
          renaming={renaming?.kind === 'asset' && renaming.id === a.id}
          handlers={handlers}
          seqFps={seqFps}
          showMeta={thumbWidth >= 128}
        />
      ))}
    </div>
  );
}

const BinCard = memo(function BinCard({ bin, count, handlers, renaming, dropping }: { bin: Bin; count: number; handlers: ItemHandlers; renaming: boolean; dropping: boolean }) {
  return (
    <div
      className={`md-card md-card--bin ${dropping ? 'is-drop' : ''}`}
      data-testid="md-bin-card"
      data-bin-id={bin.id}
      data-drop-bin={bin.id}
      draggable={!renaming}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('omega/bin', bin.id);
      }}
      onDoubleClick={() => handlers.binOpen(bin.id)}
      onContextMenu={(e) => handlers.binMenu(bin, e)}
      title={bin.name}
    >
      <div className="md-card__thumb md-card__thumb--bin">
        <MdIcons.FolderOpen size={30} />
        <span className="md-card__count">{count === 1 ? '1 item' : `${count} items`}</span>
      </div>
      <div className="md-card__name">
        {renaming ? (
          <RenameInput initial={bin.name} onCommit={(v) => renameBin(bin.id, v)} onDone={() => useMediaUi.getState().set({ renaming: null })} />
        ) : (
          <span className="md-card__title">{bin.name}</span>
        )}
      </div>
    </div>
  );
});

const AssetCard = memo(function AssetCard({
  asset,
  selected,
  renaming,
  handlers,
  seqFps,
  showMeta,
}: {
  asset: MediaAsset;
  selected: boolean;
  renaming: boolean;
  handlers: ItemHandlers;
  seqFps: number;
  showMeta: boolean;
}) {
  const durRef = useRef<HTMLSpanElement>(null);
  const duration = durationTc(asset, seqFps);
  const onScrub = (t: number | null) => {
    if (!durRef.current) return;
    durRef.current.textContent = t === null ? duration : tcLabel(t, asset.fps || seqFps);
    durRef.current.classList.toggle('is-scrub', t !== null);
  };
  const meta = [resolutionText(asset), fpsText(asset) && `${fpsText(asset)} fps`].filter(Boolean).join(' · ') || (asset.kind === 'audio' ? audioMeta(asset) : '');
  return (
    <div
      className={`md-card ${selected ? 'is-selected' : ''} ${asset.offline ? 'is-offline' : ''}`}
      data-testid="md-item"
      data-asset-id={asset.id}
      data-kind={asset.kind}
      role="option"
      aria-selected={selected}
      draggable={!renaming}
      onMouseDown={(e) => handlers.down(asset.id, e)}
      onClick={(e) => handlers.click(asset.id, e)}
      onDoubleClick={() => handlers.dbl(asset.id)}
      onContextMenu={(e) => handlers.menu(asset.id, e)}
      onDragStart={(e) => handlers.drag(asset.id, e)}
      title={asset.path}
    >
      <div className="md-card__thumb">
        <Poster asset={asset} onScrub={onScrub} />
        <div className="md-card__badges">
          <AssetBadges asset={asset} />
        </div>
        <span ref={durRef} className="md-card__dur">
          {duration}
        </span>
      </div>
      <div className="md-card__name">
        {asset.label && asset.label !== 'none' && <span className="md-dot" style={{ background: LABEL_COLORS[asset.label] }} />}
        {renaming ? (
          <RenameInput initial={asset.name} onCommit={(v) => renameAsset(asset.id, v)} onDone={() => useMediaUi.getState().set({ renaming: null })} />
        ) : (
          <span className="md-card__title" data-testid="md-item-name">
            {asset.name}
          </span>
        )}
      </div>
      {showMeta && <div className="md-card__meta">{meta || ' '}</div>}
    </div>
  );
});

function audioMeta(a: MediaAsset): string {
  const ch = a.channels ? (a.channels === 1 ? 'Mono' : a.channels === 2 ? 'Stereo' : `${a.channels} ch`) : '';
  const sr = a.sampleRate ? `${+(a.sampleRate / 1000).toFixed(1)} kHz` : '';
  return [ch, sr].filter(Boolean).join(' · ');
}
