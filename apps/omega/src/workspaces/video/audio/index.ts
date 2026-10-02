// Public surface of the audio package: its panels, and (as a side effect of
// importing this module) registration of its actions. OWNED BY THE PACKAGE.
import './actions';

export { AudioClipSection, normalizeClipsPeak, resolveAudioClipId } from './AudioClipSection';
export { LoudnessPanel, runLoudnessAnalysis } from './LoudnessPanel';
export { Mixer } from './Mixer';
export { Modals } from './Modals';
export { DuckingTool } from './DuckingTool';
export { MeterView } from './Meter';
export { toggleVoiceover } from './recorder';
