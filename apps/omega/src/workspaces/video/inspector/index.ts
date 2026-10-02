// Public surface of the inspector package: its panels, and (as a side effect of
// importing this module) registration of its actions. OWNED BY THE PACKAGE.
//
// The shared control kit lives in ./controls (import it from there).
import './actions';

export { Inspector } from './Inspector';
export { TitlesBrowser } from './TitlesBrowser';
/** Adds a title template at a time (default: the playhead); used for 'omega/title' drops. */
export { addTitle, TITLE_TEMPLATES, DEFAULT_TITLE_ID } from './titles';
