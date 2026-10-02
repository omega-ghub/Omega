// Dialogs and floating notices of the media package. The shell mounts
// <Modals/> at all times; dialogs render only for their modal ids.
import { useEffect, useMemo } from 'react';
import { useStore } from 'zustand';
import { mediaJobs, suggestProxies } from '../../../engine/media/jobs';
import { buildProxies } from '../../../engine/media/proxies';
import { removeAssets } from '../../../engine/media/relink';
import { clipCountByAsset } from '../../../engine/media/usage';
import { useEditor } from '../../../state/store';
import { I } from '../../../ui/Icons';
import { Dialog } from '../../../ui/Modal';
import { useMediaUi } from './uiStore';

export const MEDIA_MODALS = ['media.removeInUse'] as const;

export function Modals() {
  const modal = useEditor((s) => s.modal);
  useEffect(() => {
    const ui = useMediaUi.getState();
    ui.set({ modalsMounted: ui.modalsMounted + 1 });
    return () => {
      const u = useMediaUi.getState();
      u.set({ modalsMounted: Math.max(0, u.modalsMounted - 1) });
    };
  }, []);
  return (
    <>
      {modal?.id === 'media.removeInUse' && <RemoveInUseDialog ids={(modal.props?.assetIds as string[]) ?? []} />}
      <ProxySuggestion floating />
    </>
  );
}

function RemoveInUseDialog({ ids }: { ids: string[] }) {
  const project = useEditor((s) => s.project);
  const close = () => useEditor.getState().closeModal();
  const info = useMemo(() => {
    if (!project) return { assets: [], clips: 0, used: 0 };
    const counts = clipCountByAsset(project);
    const assets = project.assets.filter((a) => ids.includes(a.id));
    return { assets, clips: assets.reduce((s, a) => s + (counts.get(a.id) ?? 0), 0), used: assets.filter((a) => counts.get(a.id)).length };
  }, [project, ids]);
  const n = info.assets.length;
  const name = n === 1 ? info.assets[0].name : `${n} items`;
  const removeUnusedOnly = () => {
    if (!project) return;
    const counts = clipCountByAsset(project);
    const free = info.assets.filter((a) => !counts.get(a.id)).map((a) => a.id);
    close();
    if (free.length) removeAssets(free, `Remove ${free.length} item${free.length === 1 ? '' : 's'}`);
  };
  return (
    <Dialog
      title={`Remove ${name}?`}
      icon={<I.Warning size={18} />}
      onClose={close}
      width={460}
      testId="md-remove-confirm"
      footer={
        <>
          <button className="btn btn--sm btn--ghost" onClick={close} data-testid="md-remove-cancel">
            Cancel
          </button>
          {info.used < n && (
            <button className="btn btn--sm btn--ghost" onClick={removeUnusedOnly} data-testid="md-remove-unused-only">
              Remove Unused Only
            </button>
          )}
          <button
            className="btn btn--sm btn--danger-solid"
            autoFocus
            data-testid="md-remove-with-clips"
            onClick={() => {
              close();
              removeAssets(
                info.assets.map((a) => a.id),
                `Remove ${name} and ${info.clips} clip${info.clips === 1 ? '' : 's'}`,
                true,
              );
            }}
          >
            Remove Media and Clips
          </button>
        </>
      }
    >
      <p className="md-dialog__text">
        {info.used === 1 && n === 1 ? 'This media is' : `${info.used} of these items are`} used by {info.clips} clip{info.clips === 1 ? '' : 's'} in your sequences. Removing it also removes
        those clips (leaving gaps). You can undo this.
      </p>
    </Dialog>
  );
}

/** One-click proxy suggestion after importing heavy (4K / HFR) media. */
export function ProxySuggestion({ floating = false }: { floating?: boolean }) {
  const ids = useStore(mediaJobs, (s) => s.proxySuggestion);
  const mounted = useMediaUi((s) => s.modalsMounted);
  const assets = useEditor((s) => s.project?.assets);
  // inline copy only when no Modals host is mounted
  const show = !!ids?.length && (floating || mounted === 0);
  useEffect(() => {
    if (!show) return;
    const t = setTimeout(() => suggestProxies(null), 30_000);
    return () => clearTimeout(t);
  }, [show, ids]);
  if (!show || !ids) return null;
  const list = assets?.filter((a) => ids.includes(a.id)) ?? [];
  if (!list.length) return null;
  const maxW = Math.max(...list.map((a) => Math.max(a.width ?? 0, a.height ?? 0)));
  const what = maxW >= 3840 ? (list.length === 1 ? 'This 4K clip' : `${list.length} 4K clips`) : list.length === 1 ? 'This high-frame-rate clip' : `${list.length} high-frame-rate clips`;
  return (
    <div className={`md-suggest ${floating ? 'md-suggest--floating' : ''}`} role="status" data-testid="md-suggest">
      <span className="md-suggest__icon">
        <I.Proxy size={16} />
      </span>
      <div className="md-suggest__text">
        <div className="md-suggest__title">{what} will play back smoother with proxies</div>
        <div className="md-suggest__sub">Lightweight copies for editing; export always uses the originals.</div>
      </div>
      <button
        className="btn btn--sm btn--primary"
        data-testid="md-suggest-build"
        onClick={() => {
          suggestProxies(null);
          buildProxies(list.map((a) => a.id));
        }}
      >
        Build Proxies
      </button>
      <button className="icon-btn icon-btn--xs" aria-label="Dismiss" data-testid="md-suggest-dismiss" onClick={() => suggestProxies(null)}>
        <I.Close size={14} />
      </button>
    </div>
  );
}
