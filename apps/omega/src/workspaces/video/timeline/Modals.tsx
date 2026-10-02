// The timeline package's dialogs. The shell mounts <Modals/> permanently; it
// renders only when the open modal id belongs to this package.
import { useCallback } from 'react';
import { useEditor } from '../../../state/store';
import { AudioGainDialog, ClipPropertiesDialog, PasteAttributesDialog, SpeedDialog } from './modals/ClipDialogs';
import { MarkerDialog } from './modals/MarkerDialog';
import { SequenceSettingsDialog } from './modals/SequenceSettings';
import './timeline.css';

export const TIMELINE_MODALS = ['timeline.sequenceSettings', 'timeline.speed', 'timeline.audioGain', 'timeline.marker', 'timeline.pasteAttributes', 'timeline.clipProperties'] as const;

export function Modals() {
  const modal = useEditor((s) => s.modal);
  const hasProject = useEditor((s) => !!s.project);
  const close = useCallback(() => useEditor.getState().closeModal(), []);
  if (!modal || !hasProject || !modal.id.startsWith('timeline.')) return null;
  const key = JSON.stringify(modal.props ?? {});
  switch (modal.id) {
    case 'timeline.sequenceSettings':
      return <SequenceSettingsDialog key={key} onClose={close} />;
    case 'timeline.speed':
      return <SpeedDialog key={key} props={modal.props} onClose={close} />;
    case 'timeline.audioGain':
      return <AudioGainDialog key={key} props={modal.props} onClose={close} />;
    case 'timeline.marker':
      return <MarkerDialog key={key} props={modal.props} onClose={close} />;
    case 'timeline.pasteAttributes':
      return <PasteAttributesDialog key={key} props={modal.props} onClose={close} />;
    case 'timeline.clipProperties':
      return <ClipPropertiesDialog key={key} props={modal.props} onClose={close} />;
    default:
      return null;
  }
}
