// Public surface of the color package: its panels, and (as a side effect of
// importing this module) registration of its actions and project-LUT
// preloading. OWNED BY THE PACKAGE.
import { ensureLutsLoaded } from '../../../engine/color/lut';
import { useEditor } from '../../../state/store';
import { registerActions } from '../actions';
import {
  applyToSource,
  autoBalance,
  copyGrade,
  grabStill,
  hasTarget,
  importLuts,
  matchToReference,
  pasteGrade,
  resetGrade,
  setCompare,
  setInputTransformForSource,
  toggleBypass,
  toggleMatte,
} from './colorActions';
import { getReference } from './stills';

export { ColorPanel } from './ColorPanel';
export { Scopes } from './Scopes';

const hasProject = () => !!useEditor.getState().project;

registerActions([
  { id: 'color.copyGrade', label: 'Copy grade', group: 'Color', keys: ['Mod+Alt+C'], run: copyGrade, enabled: hasTarget, hint: 'Copies the selected clip’s grade' },
  {
    id: 'color.pasteGrade',
    label: 'Paste grade',
    group: 'Color',
    keys: ['Mod+Alt+Shift+V'],
    run: pasteGrade,
    enabled: () => hasTarget() && !!useEditor.getState().gradeClipboard,
    hint: 'Pastes the copied grade to every selected clip (keeps each clip’s input transform)',
  },
  { id: 'color.resetGrade', label: 'Reset grade', group: 'Color', run: resetGrade, enabled: hasTarget, hint: 'Resets the selected clips’ grades to neutral' },
  { id: 'color.toggleBypass', label: 'Bypass grade', group: 'Color', keys: ['Mod+Alt+B'], run: toggleBypass, enabled: hasTarget, hint: 'Turns the selected clips’ grades off or on' },
  { id: 'color.autoBalance', label: 'Auto balance', group: 'Color', run: () => void autoBalance(), enabled: hasTarget, hint: 'Neutralizes the colour cast of the current frame (temperature and tint)' },
  {
    id: 'color.matchReference',
    label: 'Match to reference still',
    group: 'Color',
    run: () => void matchToReference(),
    enabled: () => hasTarget() && !!getReference(),
    hint: 'Matches the selected clip’s levels, balance and saturation to the reference still',
  },
  { id: 'color.grabStill', label: 'Grab still', group: 'Color', keys: ['Mod+Alt+G'], run: () => void grabStill(), enabled: hasProject, hint: 'Adds the program frame to the stills gallery' },
  { id: 'color.compareSplit', label: 'Compare: split view', group: 'Color', keys: ['Mod+Alt+W'], run: () => setCompare('split'), enabled: hasProject, hint: 'Ungraded on the left, graded on the right' },
  { id: 'color.compareBypass', label: 'Compare: show ungraded', group: 'Color', run: () => setCompare('bypass'), enabled: hasProject },
  { id: 'color.toggleMatte', label: 'Show qualifier matte', group: 'Color', run: toggleMatte, enabled: hasProject, hint: 'Shows the selected clip’s HSL key as a matte in the viewer' },
  { id: 'color.importLut', label: 'Import LUT…', group: 'Color', run: () => void importLuts(), enabled: hasProject, hint: 'Imports .cube LUT files into the project' },
  { id: 'color.applyToSource', label: 'Apply grade to all clips from this source', group: 'Color', run: applyToSource, enabled: hasTarget },
  { id: 'color.inputForSource', label: 'Set input transform for all clips of this source', group: 'Color', run: setInputTransformForSource, enabled: hasTarget },
]);

// Keep project LUTs loaded for the renderer (it reads them with getLoadedLut).
// Failures are recorded per LUT (lutError) and shown in the LUT list.
let lastLuts: unknown = null;
useEditor.subscribe((s) => {
  const luts = s.project?.luts ?? null;
  if (luts === lastLuts) return;
  lastLuts = luts;
  if (luts?.length) void ensureLutsLoaded(luts).catch(() => {});
});
