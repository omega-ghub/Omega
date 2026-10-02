// Inspector-specific monoline icons (24-unit grid, stroke = currentColor),
// drawn in the same style as src/ui/Icons.tsx.
import type { SVGProps } from 'react';
import { IconBase } from '../../../ui/Icons';

type P = SVGProps<SVGSVGElement> & { size?: number };

export const II = {
  Stopwatch: (p: P) => (
    <IconBase {...p}>
      <circle cx="12" cy="13.5" r="7" />
      <path d="M12 13.5V9.5" />
      <path d="M10 3h4" />
      <path d="M18.5 6.5l1.2-1.2" />
    </IconBase>
  ),
  Diamond: ({ filled, ...p }: P & { filled?: boolean }) => (
    <IconBase {...p}>
      <path d="M12 4.5l7.5 7.5-7.5 7.5L4.5 12z" fill={filled ? 'currentColor' : 'none'} />
    </IconBase>
  ),
  TriLeft: (p: P) => (
    <IconBase {...p}>
      <path d="M15 6.5L8.5 12l6.5 5.5z" fill="currentColor" stroke="none" />
    </IconBase>
  ),
  TriRight: (p: P) => (
    <IconBase {...p}>
      <path d="M9 6.5l6.5 5.5L9 17.5z" fill="currentColor" stroke="none" />
    </IconBase>
  ),
  Chevron: (p: P) => (
    <IconBase {...p}>
      <path d="M9.5 7l5 5-5 5" />
    </IconBase>
  ),
  Reset: (p: P) => (
    <IconBase {...p}>
      <path d="M5 12a7 7 0 1 0 2.05-4.95" />
      <path d="M5 4.5V8h3.5" />
    </IconBase>
  ),
  Link: (p: P) => (
    <IconBase {...p}>
      <path d="M10 14a3.5 3.5 0 0 0 5 0l3-3a3.5 3.5 0 0 0-5-5l-1 1" />
      <path d="M14 10a3.5 3.5 0 0 0-5 0l-3 3a3.5 3.5 0 0 0 5 5l1-1" />
    </IconBase>
  ),
  Unlink: (p: P) => (
    <IconBase {...p}>
      <path d="M13.5 6.5l.5-.5a3.5 3.5 0 0 1 5 5l-1.5 1.5" />
      <path d="M10.5 17.5l-.5.5a3.5 3.5 0 0 1-5-5l1.5-1.5" />
      <path d="M8 4v2M4 8h2M16 20v-2M20 16h-2" />
    </IconBase>
  ),
  FlipH: (p: P) => (
    <IconBase {...p}>
      <path d="M12 3v18" strokeDasharray="2 2.5" />
      <path d="M9 7L4 17h5z" />
      <path d="M15 7l5 10h-5z" />
    </IconBase>
  ),
  FlipV: (p: P) => (
    <IconBase {...p}>
      <path d="M3 12h18" strokeDasharray="2 2.5" />
      <path d="M7 9L17 4v5z" />
      <path d="M7 15l10 5v-5z" />
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
      <path d="M9.9 6A9.6 9.6 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a16 16 0 0 1-2.6 3.4" />
      <path d="M6.3 7.6A16 16 0 0 0 2.5 12S6 18.5 12 18.5a9 9 0 0 0 4-1" />
    </IconBase>
  ),
  AlignLeft: (p: P) => (
    <IconBase {...p}>
      <path d="M4 6h16M4 10h10M4 14h16M4 18h10" />
    </IconBase>
  ),
  AlignCenter: (p: P) => (
    <IconBase {...p}>
      <path d="M4 6h16M7 10h10M4 14h16M7 18h10" />
    </IconBase>
  ),
  AlignRight: (p: P) => (
    <IconBase {...p}>
      <path d="M4 6h16M10 10h10M4 14h16M10 18h10" />
    </IconBase>
  ),
  Rect: (p: P) => (
    <IconBase {...p}>
      <rect x="4.5" y="6.5" width="15" height="11" rx="1.5" />
    </IconBase>
  ),
  Ellipse: (p: P) => (
    <IconBase {...p}>
      <ellipse cx="12" cy="12" rx="8" ry="6" />
    </IconBase>
  ),
  Graph: (p: P) => (
    <IconBase {...p}>
      <path d="M4 19c5 0 5-14 8-14s3 14 8 14" />
    </IconBase>
  ),
  Lanes: (p: P) => (
    <IconBase {...p}>
      <path d="M4 7h16M4 12h16M4 17h16" />
      <path d="M9 5.5l1.5 1.5L9 8.5 7.5 7z" fill="currentColor" />
      <path d="M15 10.5l1.5 1.5-1.5 1.5-1.5-1.5z" fill="currentColor" />
    </IconBase>
  ),
  Copy: (p: P) => (
    <IconBase {...p}>
      <rect x="8.5" y="8.5" width="11" height="11" rx="1.5" />
      <path d="M15.5 8.5V5.5a1 1 0 0 0-1-1h-9a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h3" />
    </IconBase>
  ),
  Paste: (p: P) => (
    <IconBase {...p}>
      <path d="M9 4.5h6v3H9z" />
      <path d="M15 5.5h3v14H6v-14h3" />
    </IconBase>
  ),
  Text: (p: P) => (
    <IconBase {...p}>
      <path d="M5 6.5V5h14v1.5" />
      <path d="M12 5v14" />
      <path d="M9.5 19h5" />
    </IconBase>
  ),
  Sliders: (p: P) => (
    <IconBase {...p}>
      <path d="M5 7h9M18 7h1M5 17h3M12 17h7" />
      <circle cx="16" cy="7" r="2" />
      <circle cx="10" cy="17" r="2" />
    </IconBase>
  ),
  More: (p: P) => (
    <IconBase {...p}>
      <circle cx="6" cy="12" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="18" cy="12" r="1.2" fill="currentColor" stroke="none" />
    </IconBase>
  ),
  Fit: (p: P) => (
    <IconBase {...p}>
      <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
    </IconBase>
  ),
  Color: (p: P) => (
    <IconBase {...p}>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor" stroke="none" />
    </IconBase>
  ),
  Plus: (p: P) => (
    <IconBase {...p}>
      <path d="M12 5v14M5 12h14" />
    </IconBase>
  ),
  Trash: (p: P) => (
    <IconBase {...p}>
      <path d="M4.5 7h15" />
      <path d="M9.5 7V4.5h5V7" />
      <path d="M6.5 7l1 12.5h9l1-12.5" />
    </IconBase>
  ),
  Close: (p: P) => (
    <IconBase {...p}>
      <path d="M7 7l10 10M17 7L7 17" />
    </IconBase>
  ),
  Invert: (p: P) => (
    <IconBase {...p}>
      <rect x="4.5" y="4.5" width="15" height="15" rx="2" />
      <circle cx="12" cy="12" r="4" fill="currentColor" stroke="none" />
    </IconBase>
  ),
};
