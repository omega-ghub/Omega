// PLACEHOLDER — replaced by the shell package.
import { AudioClipSection, Mixer, LoudnessPanel } from '../audio';
import { CaptionsPanel } from '../captions';
import { ColorPanel, Scopes } from '../color';
import { DeliverPanel } from '../deliver';
import { EffectsBrowser, EffectStack } from '../effects';
import { Inspector } from '../inspector';
import { MediaPanel } from '../media';
import { Timeline } from '../timeline';
import { ProgramMonitor, SourceMonitor } from '../viewer';

export function VideoWorkspace() {
  return (
    <div className="ws">
      <MediaPanel />
      <SourceMonitor />
      <ProgramMonitor />
      <Inspector />
      <EffectsBrowser />
      <EffectStack clipId="" />
      <ColorPanel />
      <Scopes />
      <Mixer />
      <LoudnessPanel />
      <AudioClipSection clipId="" />
      <CaptionsPanel />
      <DeliverPanel />
      <Timeline />
    </div>
  );
}
