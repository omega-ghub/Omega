// Public surface of the timeline package: its panels, and (as a side effect of
// importing this module) registration of its actions. OWNED BY THE PACKAGE.
//
// Test hooks: the clip area is a canvas, so clip geometry is exposed two ways:
//  * a visually hidden list `[data-testid="tl-clip-list"] > [data-testid="tl-clip"]`
//    with data-clip-id / data-track-id / data-x / data-y / data-w / data-h
//    (client px) / data-start / data-end (seconds) / data-selected, and
//  * `window.__deltaTimeline` (see controller.ts installDebug): clipRects(),
//    clipRect(id), trackRect(idOrName), transitionRects(), cueRects(),
//    markerRects(), rulerRect(), timeToClientX(t), clientXToTime(x), view(),
//    stats(), redraw(), run(actionId).
import { registerTimelineActions } from './timelineActions';

registerTimelineActions();

export { Timeline } from './Timeline';
export { Modals } from './Modals';
