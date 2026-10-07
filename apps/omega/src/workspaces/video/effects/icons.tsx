// Effects-package monoline icons (24-unit grid, stroke = currentColor), in the
// style of src/ui/Icons.tsx.
import type { SVGProps } from 'react';
import { IconBase } from '../../../ui/Icons';

type P = SVGProps<SVGSVGElement> & { size?: number };

export const FxI = {
  Star: ({ filled, ...p }: P & { filled?: boolean }) => (
    <IconBase {...p}>
      <path d="M12 4.2l2.35 4.76 5.25.77-3.8 3.7.9 5.23L12 16.2l-4.7 2.46.9-5.23-3.8-3.7 5.25-.77z" fill={filled ? 'currentColor' : 'none'} />
    </IconBase>
  ),
  Search: (p: P) => (
    <IconBase {...p}>
      <circle cx="10.5" cy="10.5" r="5.5" />
      <path d="M15 15l4.5 4.5" />
    </IconBase>
  ),
  Grip: (p: P) => (
    <IconBase {...p}>
      <circle cx="9" cy="7" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="15" cy="7" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="9" cy="12" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="15" cy="12" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="9" cy="17" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="15" cy="17" r="0.9" fill="currentColor" stroke="none" />
    </IconBase>
  ),
  More: (p: P) => (
    <IconBase {...p}>
      <circle cx="6" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="18" cy="12" r="1" fill="currentColor" stroke="none" />
    </IconBase>
  ),
  Plus: (p: P) => (
    <IconBase {...p}>
      <path d="M12 6v12M6 12h12" />
    </IconBase>
  ),
  Chevron: (p: P) => (
    <IconBase {...p}>
      <path d="M9.5 6.5l5.5 5.5-5.5 5.5" />
    </IconBase>
  ),
  Fx: (p: P) => (
    <IconBase {...p}>
      <path d="M12 4l1.6 4.4L18 10l-4.4 1.6L12 16l-1.6-4.4L6 10l4.4-1.6z" />
      <path d="M18.5 15.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z" />
    </IconBase>
  ),
  Transition: (p: P) => (
    <IconBase {...p}>
      <rect x="3.5" y="6" width="10" height="12" rx="1.5" />
      <path d="M10.5 6h8.5a1.5 1.5 0 0 1 1.5 1.5v9a1.5 1.5 0 0 1-1.5 1.5h-8.5" strokeDasharray="2 2" />
    </IconBase>
  ),
  Copy: (p: P) => (
    <IconBase {...p}>
      <rect x="8.5" y="8.5" width="11" height="11" rx="2" />
      <path d="M15.5 5.5v-.5a1.5 1.5 0 0 0-1.5-1.5H6a1.5 1.5 0 0 0-1.5 1.5v8A1.5 1.5 0 0 0 6 15.5h.5" />
    </IconBase>
  ),
  Paste: (p: P) => (
    <IconBase {...p}>
      <rect x="5" y="5.5" width="14" height="15" rx="2" />
      <path d="M9 5.5V4.5h6v1" />
      <path d="M9 11h6M9 15h4" />
    </IconBase>
  ),
  Duplicate: (p: P) => (
    <IconBase {...p}>
      <rect x="8.5" y="8.5" width="11" height="11" rx="2" />
      <path d="M14 11.5v5M11.5 14h5" />
      <path d="M15.5 5.5v-.5a1.5 1.5 0 0 0-1.5-1.5H6a1.5 1.5 0 0 0-1.5 1.5v8A1.5 1.5 0 0 0 6 15.5h.5" />
    </IconBase>
  ),
  Reset: (p: P) => (
    <IconBase {...p}>
      <path d="M5 12a7 7 0 1 0 2.05-4.95" />
      <path d="M5 5v4h4" />
    </IconBase>
  ),
  Trash: (p: P) => (
    <IconBase {...p}>
      <path d="M5 7h14" />
      <path d="M10 4h4" />
      <path d="M7 7l.8 11.2a1.5 1.5 0 0 0 1.5 1.3h5.4a1.5 1.5 0 0 0 1.5-1.3L17 7" />
    </IconBase>
  ),
  Up: (p: P) => (
    <IconBase {...p}>
      <path d="M12 18V6M7 11l5-5 5 5" />
    </IconBase>
  ),
  Down: (p: P) => (
    <IconBase {...p}>
      <path d="M12 6v12M7 13l5 5 5-5" />
    </IconBase>
  ),
  Crosshair: (p: P) => (
    <IconBase {...p}>
      <circle cx="12" cy="12" r="6.5" />
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4" />
    </IconBase>
  ),
  Close: (p: P) => (
    <IconBase {...p}>
      <path d="M7 7l10 10M17 7L7 17" />
    </IconBase>
  ),
};
