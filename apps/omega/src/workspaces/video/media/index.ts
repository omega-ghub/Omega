// Public surface of the media package: its panels, the import entry point,
// its dialogs, and (as a side effect of importing this module) registration
// of its actions. OWNED BY THE PACKAGE.
import { buildProxies, canBuildProxy } from '../../../engine/media/proxies';
import { relinkOffline, removeUnused, revealInFolder } from '../../../engine/media/relink';
import { useEditor } from '../../../state/store';
import { isMac, registerActions } from '../actions';
import { currentImportBin, focusSearch, importViaDialog, newBin } from './commands';

export { MediaPanel } from './MediaPanel';
export { Modals } from './Modals';
/** Import entry point: files land in the media browser's open bin. Never throws. */
export { importPaths } from './commands';

const ed = () => useEditor.getState();
const selectedAssets = () => {
  const s = ed();
  const ids = new Set(s.selection.assetIds ?? []);
  return s.project?.assets.filter((a) => ids.has(a.id)) ?? [];
};

registerActions([
  {
    id: 'media.import',
    label: 'Import Media…',
    group: 'Project',
    keys: ['Mod+I'],
    hint: 'Video, audio, images, .cube LUTs and .srt / .vtt captions',
    enabled: () => !!ed().project,
    run: () => void importViaDialog(),
  },
  {
    id: 'media.newBin',
    label: 'New Bin',
    group: 'Project',
    keys: ['Mod+B'],
    enabled: () => !!ed().project,
    run: () => {
      if (ed().workspace !== 'edit') ed().setWorkspace('edit');
      newBin(currentImportBin());
    },
  },
  {
    id: 'media.relink',
    label: 'Relink Offline Media…',
    group: 'Project',
    hint: 'Locate moved or renamed files; whole folders relink at once',
    enabled: () => !!ed().project?.assets.some((a) => a.offline),
    run: () => void relinkOffline(),
  },
  {
    id: 'media.buildProxies',
    label: 'Build Proxies for Selected Media',
    group: 'Project',
    hint: 'Lightweight copies for smooth playback; export always uses the originals',
    enabled: () => selectedAssets().some(canBuildProxy),
    run: () => {
      buildProxies(selectedAssets().filter(canBuildProxy).map((a) => a.id));
    },
  },
  {
    id: 'media.removeUnused',
    label: 'Remove Unused Media',
    group: 'Project',
    enabled: () => !!ed().project?.assets.length,
    run: () => {
      removeUnused();
    },
  },
  {
    id: 'media.revealInFinder',
    label: isMac ? 'Reveal in Finder' : 'Show in Folder',
    group: 'Project',
    enabled: () => selectedAssets().length === 1 && !selectedAssets()[0].offline,
    run: () => {
      const a = selectedAssets()[0];
      if (a) revealInFolder(a.id);
    },
  },
  {
    id: 'media.find',
    label: 'Find in Media',
    group: 'Project',
    keys: ['Mod+Shift+F'],
    enabled: () => !!ed().project,
    run: focusSearch,
  },
]);
