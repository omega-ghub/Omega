// Timeline-specific monoline icons (24-unit grid, currentColor stroke).
import type { SVGProps } from 'react';
import { IconBase } from '../../../ui/Icons';

type P = SVGProps<SVGSVGElement> & { size?: number };

export const TI = {
  Select: (p: P) => (
    <IconBase {...p}>
      <path d="M6 4l11 7.5-5 1.2L9.6 18z" />
    </IconBase>
  ),
  TrackForward: (p: P) => (
    <IconBase {...p}>
      <path d="M4 5v14" />
      <path d="M8 9h11M16 6l3 3-3 3" />
      <path d="M8 15h11M16 12l3 3-3 3" />
    </IconBase>
  ),
  Ripple: (p: P) => (
    <IconBase {...p}>
      <path d="M11 5H8v14h3" />
      <path d="M13 12h7M17 9l3 3-3 3" />
    </IconBase>
  ),
  Roll: (p: P) => (
    <IconBase {...p}>
      <path d="M10 5v14M14 5v14" />
      <path d="M7 12H3M5 10l-2 2 2 2M17 12h4M19 10l2 2-2 2" />
    </IconBase>
  ),
  Rate: (p: P) => (
    <IconBase {...p}>
      <path d="M4 6v12M20 6v12" />
      <path d="M7 12h10M9.5 9.5 7 12l2.5 2.5M14.5 9.5 17 12l-2.5 2.5" />
      <path d="M9 5.5a4.5 4.5 0 0 1 6 0" />
    </IconBase>
  ),
  Slip: (p: P) => (
    <IconBase {...p}>
      <path d="M4 6v12M20 6v12" />
      <path d="M8 12h8M10 10l-2 2 2 2M14 10l2 2-2 2" />
    </IconBase>
  ),
  Slide: (p: P) => (
    <IconBase {...p}>
      <rect x="8" y="7" width="8" height="10" rx="1" />
      <path d="M2 12h3M4 10.5 2.5 12 4 13.5M22 12h-3M20 10.5l1.5 1.5-1.5 1.5" />
    </IconBase>
  ),
  Razor: (p: P) => (
    <IconBase {...p}>
      <path d="M12 3v18" />
      <path d="M7.5 7.5 12 4l4.5 3.5L12 13z" />
    </IconBase>
  ),
  Pen: (p: P) => (
    <IconBase {...p}>
      <path d="M4 20l3.5-1L19 7.5 16.5 5 5 16.5z" />
      <path d="M14.5 7l2.5 2.5" />
    </IconBase>
  ),
  Hand: (p: P) => (
    <IconBase {...p}>
      <path d="M8 11V5.5a1.5 1.5 0 0 1 3 0V11M11 10V4.5a1.5 1.5 0 0 1 3 0V11M14 10.5V6a1.5 1.5 0 0 1 3 0v7c0 4-2.5 7-6 7-2.5 0-4-1.2-5.4-3.4L3.8 13.5a1.5 1.5 0 0 1 2.4-1.7L8 14" />
    </IconBase>
  ),
  Zoom: (p: P) => (
    <IconBase {...p}>
      <circle cx="10.5" cy="10.5" r="6" />
      <path d="M15 15l5 5M8 10.5h5M10.5 8v5" />
    </IconBase>
  ),
  Magnet: (p: P) => (
    <IconBase {...p}>
      <path d="M6 4v7a6 6 0 0 0 12 0V4" />
      <path d="M6 8h3M15 8h3M9 4v7a3 3 0 0 0 6 0V4" />
    </IconBase>
  ),
  Magnetic: (p: P) => (
    <IconBase {...p}>
      <rect x="3" y="9" width="6" height="6" rx="1" />
      <rect x="9" y="9" width="5" height="6" rx="1" />
      <rect x="14" y="9" width="7" height="6" rx="1" />
      <path d="M3 18.5h18" />
    </IconBase>
  ),
  Link: (p: P) => (
    <IconBase {...p}>
      <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
      <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
    </IconBase>
  ),
  Fit: (p: P) => (
    <IconBase {...p}>
      <path d="M4 8V5h3M20 8V5h-3M4 16v3h3M20 16v3h-3" />
      <path d="M8 12h8M10 10l-2 2 2 2M14 10l2 2-2 2" />
    </IconBase>
  ),
  Settings: (p: P) => (
    <IconBase {...p}>
      <path d="M4 7h10M18 7h2M4 17h2M10 17h10" />
      <circle cx="16" cy="7" r="2" />
      <circle cx="8" cy="17" r="2" />
    </IconBase>
  ),
  Eye: (p: P) => (
    <IconBase {...p}>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="2.6" />
    </IconBase>
  ),
  EyeOff: (p: P) => (
    <IconBase {...p}>
      <path d="M4 4l16 16" />
      <path d="M9.9 5.8A9.6 9.6 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-2.6 3.4M6.3 7.4A16.6 16.6 0 0 0 2.5 12S6 18.5 12 18.5a9 9 0 0 0 4-.9" />
    </IconBase>
  ),
  Lock: (p: P) => (
    <IconBase {...p}>
      <rect x="5.5" y="10.5" width="13" height="9" rx="2" />
      <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
    </IconBase>
  ),
  Unlock: (p: P) => (
    <IconBase {...p}>
      <rect x="5.5" y="10.5" width="13" height="9" rx="2" />
      <path d="M8.5 10.5V8a3.5 3.5 0 0 1 6.8-1.2" />
    </IconBase>
  ),
  Plus: (p: P) => (
    <IconBase {...p}>
      <path d="M12 5v14M5 12h14" />
    </IconBase>
  ),
  Close: (p: P) => (
    <IconBase {...p}>
      <path d="M7 7l10 10M17 7 7 17" />
    </IconBase>
  ),
  Chevron: (p: P) => (
    <IconBase {...p}>
      <path d="M7 10l5 5 5-5" />
    </IconBase>
  ),
  ChevronRight: (p: P) => (
    <IconBase {...p}>
      <path d="M10 7l5 5-5 5" />
    </IconBase>
  ),
  Check: (p: P) => (
    <IconBase {...p}>
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </IconBase>
  ),
  Sequence: (p: P) => (
    <IconBase {...p}>
      <rect x="3" y="6" width="18" height="12" rx="2" />
      <path d="M3 12h18M9 6v6M15 12v6" />
    </IconBase>
  ),
  Caption: (p: P) => (
    <IconBase {...p}>
      <rect x="3" y="5.5" width="18" height="13" rx="2" />
      <path d="M10.5 10.2a2.5 2.5 0 1 0 0 3.6M17 10.2a2.5 2.5 0 1 0 0 3.6" />
    </IconBase>
  ),
  ZoomIn: (p: P) => (
    <IconBase {...p}>
      <circle cx="10.5" cy="10.5" r="6" />
      <path d="M15 15l5 5M8 10.5h5M10.5 8v5" />
    </IconBase>
  ),
  ZoomOut: (p: P) => (
    <IconBase {...p}>
      <circle cx="10.5" cy="10.5" r="6" />
      <path d="M15 15l5 5M8 10.5h5" />
    </IconBase>
  ),
};
