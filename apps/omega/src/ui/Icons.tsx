// Monoline icon set, 24-unit grid, stroke-based so they inherit currentColor.
import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement> & { size?: number };

function Base({ size = 18, children, ...rest }: P) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const I = {
  Play: (p: P) => (
    <Base {...p}>
      <path d="M7 5v14l11-7z" fill="currentColor" stroke="none" />
    </Base>
  ),
  Pause: (p: P) => (
    <Base {...p}>
      <rect x="6" y="5" width="4" height="14" fill="currentColor" stroke="none" />
      <rect x="14" y="5" width="4" height="14" fill="currentColor" stroke="none" />
    </Base>
  ),
  SkipStart: (p: P) => (
    <Base {...p}>
      <path d="M6 5v14" />
      <path d="M18 5v14L8 12z" fill="currentColor" stroke="none" />
    </Base>
  ),
  SkipEnd: (p: P) => (
    <Base {...p}>
      <path d="M18 5v14" />
      <path d="M6 5v14l10-7z" fill="currentColor" stroke="none" />
    </Base>
  ),
  StepBack: (p: P) => (
    <Base {...p}>
      <path d="M15 6l-6 6 6 6" />
    </Base>
  ),
  StepForward: (p: P) => (
    <Base {...p}>
      <path d="M9 6l6 6-6 6" />
    </Base>
  ),
  Import: (p: P) => (
    <Base {...p}>
      <path d="M12 4v11" />
      <path d="M7 10l5 5 5-5" />
      <path d="M4 19h16" />
    </Base>
  ),
  Export: (p: P) => (
    <Base {...p}>
      <path d="M12 15V4" />
      <path d="M7 9l5-5 5 5" />
      <path d="M4 19h16" />
    </Base>
  ),
  Scissors: (p: P) => (
    <Base {...p}>
      <circle cx="6" cy="6" r="2.5" />
      <circle cx="6" cy="18" r="2.5" />
      <path d="M8.2 7.6L20 18" />
      <path d="M8.2 16.4L20 6" />
    </Base>
  ),
  Cursor: (p: P) => (
    <Base {...p}>
      <path d="M5 3l14 8.5-6.5 1.5-3 6z" fill="currentColor" stroke="none" />
    </Base>
  ),
  Trash: (p: P) => (
    <Base {...p}>
      <path d="M4 7h16" />
      <path d="M9 7V4h6v3" />
      <path d="M6 7l1 13h10l1-13" />
    </Base>
  ),
  Undo: (p: P) => (
    <Base {...p}>
      <path d="M9 14l-4-4 4-4" />
      <path d="M5 10h9a5 5 0 0 1 0 10h-3" />
    </Base>
  ),
  Redo: (p: P) => (
    <Base {...p}>
      <path d="M15 14l4-4-4-4" />
      <path d="M19 10h-9a5 5 0 0 0 0 10h3" />
    </Base>
  ),
  Save: (p: P) => (
    <Base {...p}>
      <path d="M5 4h11l3 3v13H5z" />
      <path d="M8 4v5h7V4" />
      <path d="M8 20v-6h8v6" />
    </Base>
  ),
  Plus: (p: P) => (
    <Base {...p}>
      <path d="M12 5v14M5 12h14" />
    </Base>
  ),
  Minus: (p: P) => (
    <Base {...p}>
      <path d="M5 12h14" />
    </Base>
  ),
  Close: (p: P) => (
    <Base {...p}>
      <path d="M6 6l12 12M18 6L6 18" />
    </Base>
  ),
  Check: (p: P) => (
    <Base {...p}>
      <path d="M5 12l5 5 9-10" />
    </Base>
  ),
  Home: (p: P) => (
    <Base {...p}>
      <path d="M4 11l8-7 8 7" />
      <path d="M6 10v10h5v-6h2v6h5V10" />
    </Base>
  ),
  Grid: (p: P) => (
    <Base {...p}>
      <rect x="4" y="4" width="6.5" height="6.5" rx="1.5" />
      <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5" />
      <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5" />
      <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5" />
    </Base>
  ),
  Folder: (p: P) => (
    <Base {...p}>
      <path d="M3 6h6l2 2h10v11H3z" />
    </Base>
  ),
  Book: (p: P) => (
    <Base {...p}>
      <path d="M4 5h7a2 2 0 0 1 2 2v12a2 2 0 0 0-2-2H4z" />
      <path d="M20 5h-7a2 2 0 0 0-2 2v12a2 2 0 0 1 2-2h7z" />
    </Base>
  ),
  Tag: (p: P) => (
    <Base {...p}>
      <path d="M3 12V4h8l9 9-8 8z" />
      <circle cx="7.5" cy="8.5" r="1.3" fill="currentColor" stroke="none" />
    </Base>
  ),
  Settings: (p: P) => (
    <Base {...p}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8" />
    </Base>
  ),
  Chevron: (p: P) => (
    <Base {...p}>
      <path d="M9 6l6 6-6 6" />
    </Base>
  ),
  ChevronDown: (p: P) => (
    <Base {...p}>
      <path d="M6 9l6 6 6-6" />
    </Base>
  ),
  Minimize: (p: P) => (
    <Base {...p}>
      <path d="M5 12h14" />
    </Base>
  ),
  Maximize: (p: P) => (
    <Base {...p}>
      <rect x="5" y="5" width="14" height="14" rx="1.5" />
    </Base>
  ),
  Restore: (p: P) => (
    <Base {...p}>
      <rect x="5" y="8" width="11" height="11" rx="1.5" />
      <path d="M8 8V5h11v11h-3" />
    </Base>
  ),
  Film: (p: P) => (
    <Base {...p}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M7 5v14M17 5v14M3 9h4M3 15h4M17 9h4M17 15h4" />
    </Base>
  ),
  Music: (p: P) => (
    <Base {...p}>
      <path d="M9 18V6l10-2v12" />
      <circle cx="6.5" cy="18" r="2.5" />
      <circle cx="16.5" cy="16" r="2.5" />
    </Base>
  ),
  Image: (p: P) => (
    <Base {...p}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <circle cx="9" cy="10" r="1.7" />
      <path d="M21 16l-5-5-7 8" />
    </Base>
  ),
  Mute: (p: P) => (
    <Base {...p}>
      <path d="M4 9v6h4l5 4V5L8 9z" />
      <path d="M16 9l5 6M21 9l-5 6" />
    </Base>
  ),
  Speaker: (p: P) => (
    <Base {...p}>
      <path d="M4 9v6h4l5 4V5L8 9z" />
      <path d="M16.5 8.5a5 5 0 0 1 0 7" />
    </Base>
  ),
  Lock: (p: P) => (
    <Base {...p}>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </Base>
  ),
  Unlock: (p: P) => (
    <Base {...p}>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 7.5-2" />
    </Base>
  ),
  ZoomIn: (p: P) => (
    <Base {...p}>
      <circle cx="11" cy="11" r="6" />
      <path d="M16 16l4 4M11 8v6M8 11h6" />
    </Base>
  ),
  ZoomOut: (p: P) => (
    <Base {...p}>
      <circle cx="11" cy="11" r="6" />
      <path d="M16 16l4 4M8 11h6" />
    </Base>
  ),
  Magnet: (p: P) => (
    <Base {...p}>
      <path d="M6 4v8a6 6 0 0 0 12 0V4" />
      <path d="M6 4h4v5H6M14 4h4v5h-4" />
    </Base>
  ),
  In: (p: P) => (
    <Base {...p}>
      <path d="M5 5v14" />
      <path d="M9 12h10M15 8l4 4-4 4" />
    </Base>
  ),
  Out: (p: P) => (
    <Base {...p}>
      <path d="M19 5v14" />
      <path d="M5 12h10M11 8l4 4-4 4" />
    </Base>
  ),
  Open: (p: P) => (
    <Base {...p}>
      <path d="M3 6h6l2 2h10v11H3z" />
      <path d="M12 11v5M9.5 13.5L12 11l2.5 2.5" />
    </Base>
  ),
  Shield: (p: P) => (
    <Base {...p}>
      <path d="M12 3l8 3v6c0 4.5-3.5 7.5-8 9-4.5-1.5-8-4.5-8-9V6z" />
      <path d="M9 12l2 2 4-4" />
    </Base>
  ),
  Dot: (p: P) => (
    <Base {...p}>
      <circle cx="12" cy="12" r="4" fill="currentColor" stroke="none" />
    </Base>
  ),
};
