// Tool cursors: small monoline SVGs (white stroke over a dark halo so they
// read on any clip color), with a native fallback.

function svgCursor(paths: string, hotX: number, hotY: number, fallback: string): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke-linecap="round" stroke-linejoin="round">` +
    `<g stroke="rgba(0,0,0,0.85)" stroke-width="3.6">${paths}</g>` +
    `<g stroke="#fff" stroke-width="1.5">${paths}</g></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${hotX} ${hotY}, ${fallback}`;
}

const arrowsLR = 'M3 12h6M6 9l-3 3 3 3M21 12h-6M18 9l3 3-3 3';

export const CURSORS = {
  default: 'default',
  trimStart: svgCursor('M12 5v14M12 5h3M12 19h3' + ' M8 12H3M5.5 9.5 3 12l2.5 2.5', 12, 12, 'w-resize'),
  trimEnd: svgCursor('M12 5v14M12 5H9M12 19H9' + ' M16 12h5M18.5 9.5 21 12l-2.5 2.5', 12, 12, 'e-resize'),
  rippleStart: svgCursor('M12 5v14M12 5h4M12 19h4M10 12H3M5.5 9.5 3 12l2.5 2.5M13.5 9v6', 12, 12, 'w-resize'),
  rippleEnd: svgCursor('M12 5v14M12 5H8M12 19H8M14 12h7M18.5 9.5 21 12l-2.5 2.5M10.5 9v6', 12, 12, 'e-resize'),
  roll: svgCursor('M10 5v14M14 5v14' + ' ' + arrowsLR, 12, 12, 'col-resize'),
  rate: svgCursor('M12 4v16M8 8a5 5 0 0 1 8 0' + ' ' + arrowsLR, 12, 12, 'ew-resize'),
  slip: svgCursor('M5 6v12M19 6v12M8 12h8M10.5 9.5 8 12l2.5 2.5M13.5 9.5 16 12l-2.5 2.5', 12, 12, 'ew-resize'),
  slide: svgCursor('M9 7v10M15 7v10M9 7h6M9 17h6' + ' M2 12h4M4 10l-2 2 2 2M22 12h-4M20 10l2 2-2 2', 12, 12, 'ew-resize'),
  razor: svgCursor('M12 2v20M8 6l4-3 4 3-4 5z', 12, 12, 'crosshair'),
  pen: svgCursor('M4 20l3-1 11-11-2-2L5 17zM14 6l2 2', 4, 20, 'crosshair'),
  penAdd: svgCursor('M4 20l3-1 11-11-2-2L5 17zM14 6l2 2M18 15v6M15 18h6', 4, 20, 'crosshair'),
  penRemove: svgCursor('M4 20l3-1 11-11-2-2L5 17zM14 6l2 2M15 18h6', 4, 20, 'crosshair'),
  zoomIn: svgCursor('M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM15 15l6 6M7 10h6M10 7v6', 10, 10, 'zoom-in'),
  zoomOut: svgCursor('M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM15 15l6 6M7 10h6', 10, 10, 'zoom-out'),
  trackForward: svgCursor('M4 6v12M8 12h12M16 8l4 4-4 4M8 8v8', 6, 12, 'e-resize'),
  trackForwardAll: svgCursor('M4 4v16M8 9h12M16 6l4 3-4 3M8 15h12M16 12l4 3-4 3', 6, 12, 'e-resize'),
  hand: 'grab',
  grabbing: 'grabbing',
  move: 'move',
  ew: 'ew-resize',
  ns: 'ns-resize',
  notAllowed: 'not-allowed',
  copy: 'copy',
} as const;

export type CursorName = keyof typeof CURSORS;
