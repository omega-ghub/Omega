// Public surface of the shell package. OWNED BY THE SHELL PACKAGE.
// Importing it registers the shell's actions (palette, save, undo/redo,
// workspaces, panels, preferences, shortcuts, history, close).
import './actions';

export { VideoWorkspace } from './VideoWorkspace';
export { Panel, PanelBoundary } from './Panel';
export { useShell } from './state';
export type { PanelId } from './state';
