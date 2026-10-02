// Inspector, keyframe and title actions (registered when the package index is imported).

import { useEditor } from '../../../state/store';
import { activeSequence, findClip } from '../../../state/types';
import { registerActions } from '../actions';
import {
  addKeysAtPlayhead,
  copySelectedKeys,
  deleteSelectedKeys,
  gotoKey,
  hasKeyClipboard,
  pasteKeysAtPlayhead,
  selectAllKeys,
  selectedKeys,
  setEase,
  targetKeys,
} from './keyframeActions';
import { primaryClipId } from './selection';
import { addMask, resetTransform } from './sections/TransformSections';
import { addTitle } from './titles';

function primaryVideoClipId(): string | null {
  const id = primaryClipId();
  const p = useEditor.getState().project;
  if (!id || !p) return null;
  const hit = findClip(activeSequence(p), id);
  return hit && hit.track.kind === 'video' ? id : null;
}

const hasProject = () => !!useEditor.getState().project;
const hasKeys = () => {
  const id = primaryClipId();
  const p = useEditor.getState().project;
  if (!id || !p) return false;
  const c = findClip(activeSequence(p), id)?.clip;
  return !!c && Object.values(c.keyframes).some((l) => l.length > 0);
};
const hasTarget = () => targetKeys() !== null;
const hasSelectedKeys = () => {
  const id = primaryClipId();
  return !!id && selectedKeys(id).length > 0;
};

registerActions([
  {
    id: 'titles.add',
    label: 'Add title at playhead',
    group: 'Clip',
    keys: ['Mod+T'],
    hint: 'Adds a centered title on a free track above the footage',
    enabled: hasProject,
    run: () => void addTitle(),
  },
  {
    id: 'inspector.resetTransform',
    label: 'Reset transform',
    group: 'Clip',
    hint: 'Resets position, scale, rotation, anchor, opacity and flips of the selected clip',
    enabled: () => primaryVideoClipId() !== null,
    run: () => {
      const id = primaryVideoClipId();
      if (id) resetTransform(id);
    },
  },
  {
    id: 'inspector.addMask',
    label: 'Add ellipse mask',
    group: 'Clip',
    enabled: () => primaryVideoClipId() !== null,
    run: () => {
      const id = primaryVideoClipId();
      if (id) addMask(id, 'ellipse');
    },
  },
  {
    id: 'inspector.addRectMask',
    label: 'Add rectangle mask',
    group: 'Clip',
    enabled: () => primaryVideoClipId() !== null,
    run: () => {
      const id = primaryVideoClipId();
      if (id) addMask(id, 'rect');
    },
  },
  {
    id: 'keyframes.add',
    label: 'Add keyframes at playhead',
    group: 'Clip',
    keys: ['Alt+P'],
    hint: 'Keys every animated parameter of the selected clip (starts animating Position when none is)',
    enabled: () => primaryClipId() !== null,
    run: () => void addKeysAtPlayhead(),
  },
  {
    id: 'keyframes.delete',
    label: 'Delete selected keyframes',
    group: 'Clip',
    enabled: hasSelectedKeys,
    run: () => void deleteSelectedKeys(),
  },
  {
    id: 'keyframes.easeInOut',
    label: 'Keyframe interpolation: ease in-out',
    group: 'Clip',
    keys: ['F9'],
    hint: 'Applies to the selected keyframes, or to the keyframes under the playhead',
    enabled: hasTarget,
    run: () => void setEase('easeInOut'),
  },
  {
    id: 'keyframes.easeIn',
    label: 'Keyframe interpolation: ease in',
    group: 'Clip',
    keys: ['Shift+F9'],
    enabled: hasTarget,
    run: () => void setEase('easeIn'),
  },
  {
    id: 'keyframes.easeOut',
    label: 'Keyframe interpolation: ease out',
    group: 'Clip',
    keys: ['Mod+Shift+F9'],
    enabled: hasTarget,
    run: () => void setEase('easeOut'),
  },
  {
    id: 'keyframes.linear',
    label: 'Keyframe interpolation: linear',
    group: 'Clip',
    enabled: hasTarget,
    run: () => void setEase('linear'),
  },
  {
    id: 'keyframes.hold',
    label: 'Keyframe interpolation: hold',
    group: 'Clip',
    keys: ['Mod+Alt+H'],
    enabled: hasTarget,
    run: () => void setEase('hold'),
  },
  {
    id: 'keyframes.next',
    label: 'Go to next keyframe',
    group: 'Playback',
    keys: ['Alt+]'],
    enabled: hasKeys,
    run: () => void gotoKey(1),
  },
  {
    id: 'keyframes.prev',
    label: 'Go to previous keyframe',
    group: 'Playback',
    keys: ['Alt+['],
    enabled: hasKeys,
    run: () => void gotoKey(-1),
  },
  {
    id: 'keyframes.selectAll',
    label: 'Select all keyframes of the clip',
    group: 'Clip',
    enabled: hasKeys,
    run: () => {
      const id = primaryClipId();
      if (id) selectAllKeys(id);
    },
  },
  {
    id: 'keyframes.copy',
    label: 'Copy selected keyframes',
    group: 'Clip',
    enabled: hasSelectedKeys,
    run: () => void copySelectedKeys(),
  },
  {
    id: 'keyframes.paste',
    label: 'Paste keyframes at playhead',
    group: 'Clip',
    enabled: () => primaryClipId() !== null && hasKeyClipboard(),
    run: () => void pasteKeysAtPlayhead(),
  },
]);
