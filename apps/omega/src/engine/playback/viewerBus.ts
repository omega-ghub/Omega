// Lets other panels reach the program viewer's renderer without importing
// the viewer: the scopes read pixels from it after every rendered frame.
import type { Renderer } from '../gpu/Renderer';

let program: Renderer | null = null;
const frameListeners = new Set<() => void>();

export function setProgramRenderer(r: Renderer | null) {
  program = r;
}
export function getProgramRenderer(): Renderer | null {
  return program;
}
/** Called by the viewer after each frame it draws. */
export function emitFrameRendered() {
  for (const l of frameListeners) l();
}
export function onFrameRendered(cb: () => void): () => void {
  frameListeners.add(cb);
  return () => frameListeners.delete(cb);
}
