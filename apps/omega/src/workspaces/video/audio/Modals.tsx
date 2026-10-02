// Dialogs of the audio package. The shell mounts <Modals/> at all times;
// each dialog renders only for its own modal id.

import { useEditor } from '../../../state/store';
import { I } from '../../../ui/Icons';
import { Dialog } from '../../../ui/Modal';
import { DuckingTool } from './DuckingTool';
import { LoudnessPanel } from './LoudnessPanel';

export const AUDIO_MODALS = ['audio.loudness', 'audio.duck'] as const;

export function Modals() {
  const modal = useEditor((s) => s.modal);
  const close = () => useEditor.getState().closeModal();
  if (modal?.id === 'audio.loudness')
    return (
      <Dialog title="Loudness" subtitle="ITU-R BS.1770-4 / EBU R 128" icon={<I.Loudness size={18} />} onClose={close} width={460} testId="au-loudness-dialog">
        <LoudnessPanel autoStart={!!modal.props?.autoStart} />
      </Dialog>
    );
  if (modal?.id === 'audio.duck')
    return (
      <Dialog title="Auto-duck music" subtitle="Dip music under dialogue with volume keyframes" icon={<I.Duck size={18} />} onClose={close} width={440} testId="au-duck-dialog">
        <DuckingTool onDone={close} />
      </Dialog>
    );
  return null;
}
