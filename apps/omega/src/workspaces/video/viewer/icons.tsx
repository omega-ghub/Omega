// Viewer-specific monoline icons (24-unit grid, currentColor strokes).
import type { SVGProps } from 'react';
import { IconBase } from '../../../ui/Icons';

type P = SVGProps<SVGSVGElement> & { size?: number };

export const VI = {
  GoIn: (p: P) => (
    <IconBase {...p}>
      <path d="M6 5v14" />
      <path d="M19 12H9.5" />
      <path d="M13 8l-4 4 4 4" />
    </IconBase>
  ),
  GoOut: (p: P) => (
    <IconBase {...p}>
      <path d="M18 5v14" />
      <path d="M5 12h9.5" />
      <path d="M11 8l4 4-4 4" />
    </IconBase>
  ),
  PrevEdit: (p: P) => (
    <IconBase {...p}>
      <path d="M5 6v12" />
      <path d="M19 6v12" />
      <path d="M15 8l-6 4 6 4" />
    </IconBase>
  ),
  NextEdit: (p: P) => (
    <IconBase {...p}>
      <path d="M5 6v12" />
      <path d="M19 6v12" />
      <path d="M9 8l6 4-6 4" />
    </IconBase>
  ),
  MarkIn: (p: P) => (
    <IconBase {...p}>
      <path d="M9 4H7v16h2" />
      <path d="M13 12h5" opacity="0.5" />
    </IconBase>
  ),
  MarkOut: (p: P) => (
    <IconBase {...p}>
      <path d="M15 4h2v16h-2" />
      <path d="M6 12h5" opacity="0.5" />
    </IconBase>
  ),
  ClearInOut: (p: P) => (
    <IconBase {...p}>
      <path d="M7 5H5v14h2" />
      <path d="M17 5h2v14h-2" />
      <path d="M10 10l4 4M14 10l-4 4" />
    </IconBase>
  ),
  Loop: (p: P) => (
    <IconBase {...p}>
      <path d="M17 7H8a4 4 0 0 0-4 4v1" />
      <path d="M14 4l3 3-3 3" />
      <path d="M7 17h9a4 4 0 0 0 4-4v-1" />
      <path d="M10 20l-3-3 3-3" />
    </IconBase>
  ),
  Fullscreen: (p: P) => (
    <IconBase {...p}>
      <path d="M4 9V4h5" />
      <path d="M20 9V4h-5" />
      <path d="M4 15v5h5" />
      <path d="M20 15v5h-5" />
    </IconBase>
  ),
  ExitFullscreen: (p: P) => (
    <IconBase {...p}>
      <path d="M9 4v5H4" />
      <path d="M15 4v5h5" />
      <path d="M9 20v-5H4" />
      <path d="M15 20v-5h5" />
    </IconBase>
  ),
  Overlays: (p: P) => (
    <IconBase {...p}>
      <rect x="3.5" y="5.5" width="17" height="13" rx="1.5" />
      <rect x="6.5" y="8" width="11" height="8" rx="0.5" strokeDasharray="2 2" />
    </IconBase>
  ),
  Proxy: (p: P) => (
    <IconBase {...p}>
      <rect x="3.5" y="6" width="17" height="12" rx="2" />
      <path d="M8 15V9h2.5a1.75 1.75 0 0 1 0 3.5H8" />
      <path d="M14.5 9v6" opacity="0.6" />
    </IconBase>
  ),
  Crop: (p: P) => (
    <IconBase {...p}>
      <path d="M7 3v14h14" />
      <path d="M3 7h14v14" />
    </IconBase>
  ),
  Camera: (p: P) => (
    <IconBase {...p}>
      <path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2l1.5-2h6l1.5 2h2A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z" />
      <circle cx="12" cy="13" r="3.2" />
    </IconBase>
  ),
  Insert: (p: P) => (
    <IconBase {...p}>
      <rect x="3.5" y="13" width="17" height="6" rx="1" />
      <path d="M12 3v7" />
      <path d="M9 7l3 3 3-3" />
    </IconBase>
  ),
  Overwrite: (p: P) => (
    <IconBase {...p}>
      <rect x="3.5" y="13" width="17" height="6" rx="1" />
      <rect x="8" y="13" width="8" height="6" fill="currentColor" stroke="none" opacity="0.45" />
      <path d="M12 3v7" />
      <path d="M9 7l3 3 3-3" />
    </IconBase>
  ),
  Text: (p: P) => (
    <IconBase {...p}>
      <path d="M5 6V4.5h14V6" />
      <path d="M12 4.5v15" />
      <path d="M9.5 19.5h5" />
    </IconBase>
  ),
  Waveform: (p: P) => (
    <IconBase {...p}>
      <path d="M3 12h1.5M6.5 8v8M10 5v14M13.5 9v6M17 7v10M20.5 11v2" />
    </IconBase>
  ),
  Drag: (p: P) => (
    <IconBase {...p}>
      <circle cx="9" cy="7" r="0.9" fill="currentColor" />
      <circle cx="15" cy="7" r="0.9" fill="currentColor" />
      <circle cx="9" cy="12" r="0.9" fill="currentColor" />
      <circle cx="15" cy="12" r="0.9" fill="currentColor" />
      <circle cx="9" cy="17" r="0.9" fill="currentColor" />
      <circle cx="15" cy="17" r="0.9" fill="currentColor" />
    </IconBase>
  ),
  Warning: (p: P) => (
    <IconBase {...p}>
      <path d="M12 4l9 16H3z" />
      <path d="M12 10v4" />
      <circle cx="12" cy="17" r="0.6" fill="currentColor" />
    </IconBase>
  ),
};
