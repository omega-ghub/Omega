// Public surface of the viewer package: its panels, and (as a side effect of
// importing this module) the playback engine behind `transport`, the viewer
// actions and keyboard-focus tracking. OWNED BY THE PACKAGE.
import { getPlayer, installTransport } from '../../../engine/playback/player';
import { onFontsLoaded } from '../../../engine/render/text';
import { installShuttleKeys } from './commands';
import { installFocusTracking } from './uiState';
import { registerViewerActions } from './viewerActions';

export { ProgramMonitor } from './ProgramMonitor';
export { SourceMonitor } from './SourceMonitor';
export { Modals } from './Modals';
/** Lets the inspector pick the mask the program monitor shows handles for. */
export { selectViewerMask } from './uiState';

installTransport();
registerViewerActions();
installFocusTracking();
installShuttleKeys();
// Titles re-rasterize when their web font arrives: redraw the paused frame.
onFontsLoaded(() => getPlayer().invalidate());
