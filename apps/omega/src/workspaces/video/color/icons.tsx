// Color package icons: monoline, 24-unit grid, stroke = currentColor.
import { IconBase } from '../../../ui/Icons';
import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement> & { size?: number };

export const CI = {
  Wheels: (p: P) => (
    <IconBase {...p} strokeWidth={1.6}>
      <circle cx="12" cy="12" r="8" />
      <circle cx="14.5" cy="9.5" r="1.4" fill="currentColor" stroke="none" />
      <path d="M12 12l2.5-2.5" opacity="0.6" />
    </IconBase>
  ),
  Curve: (p: P) => (
    <IconBase {...p} strokeWidth={1.6}>
      <rect x="4" y="4" width="16" height="16" rx="2" opacity="0.5" />
      <path d="M5 19c5 0 4-7 7-7s2-7 7-7" />
    </IconBase>
  ),
  Qualifier: (p: P) => (
    <IconBase {...p} strokeWidth={1.6}>
      <path d="M14.5 4.5l5 5" />
      <path d="M17 7l-9.5 9.5L5 19l2.5-2.5" />
      <path d="M12 7.5l4.5 4.5" />
    </IconBase>
  ),
  Looks: (p: P) => (
    <IconBase {...p} strokeWidth={1.6}>
      <rect x="4" y="4" width="7" height="7" rx="1.5" />
      <rect x="13" y="4" width="7" height="7" rx="1.5" />
      <rect x="4" y="13" width="7" height="7" rx="1.5" />
      <rect x="13" y="13" width="7" height="7" rx="1.5" />
    </IconBase>
  ),
  Lut: (p: P) => (
    <IconBase {...p} strokeWidth={1.6}>
      <path d="M12 3.5l7.5 4.2v8.6L12 20.5l-7.5-4.2V7.7z" />
      <path d="M4.5 7.7L12 12l7.5-4.3" />
      <path d="M12 12v8.5" />
    </IconBase>
  ),
  Copy: (p: P) => (
    <IconBase {...p} strokeWidth={1.6}>
      <rect x="8" y="8" width="11" height="11" rx="2" />
      <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
    </IconBase>
  ),
  Paste: (p: P) => (
    <IconBase {...p} strokeWidth={1.6}>
      <path d="M9 5H7a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
      <rect x="9" y="3.5" width="6" height="3" rx="1" />
      <path d="M9 12h6M9 15.5h4" />
    </IconBase>
  ),
  Reset: (p: P) => (
    <IconBase {...p} strokeWidth={1.6}>
      <path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3" />
      <path d="M4.5 4.5v4h4" />
    </IconBase>
  ),
  Bypass: (p: P) => (
    <IconBase {...p} strokeWidth={1.6}>
      <path d="M12 4v7" />
      <path d="M7.5 6.8a7 7 0 1 0 9 0" />
    </IconBase>
  ),
  Split: (p: P) => (
    <IconBase {...p} strokeWidth={1.6}>
      <rect x="3.5" y="5" width="17" height="14" rx="2" />
      <path d="M12 3v18" />
    </IconBase>
  ),
  CompareBypass: (p: P) => (
    <IconBase {...p} strokeWidth={1.6}>
      <rect x="3.5" y="5" width="17" height="14" rx="2" />
      <path d="M8 15l3-3 2 2 3-4" />
    </IconBase>
  ),
  Balance: (p: P) => (
    <IconBase {...p} strokeWidth={1.6}>
      <circle cx="12" cy="12" r="7.5" />
      <path d="M12 4.5v15" />
      <path d="M12 4.5a7.5 7.5 0 0 1 0 15z" fill="currentColor" stroke="none" opacity="0.35" />
    </IconBase>
  ),
  Still: (p: P) => (
    <IconBase {...p} strokeWidth={1.6}>
      <path d="M4 8.5A2.5 2.5 0 0 1 6.5 6H8l1.5-2h5L16 6h1.5A2.5 2.5 0 0 1 20 8.5v8a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 16.5z" />
      <circle cx="12" cy="12.5" r="3.2" />
    </IconBase>
  ),
  Match: (p: P) => (
    <IconBase {...p} strokeWidth={1.6}>
      <rect x="3.5" y="6" width="7" height="12" rx="1.5" />
      <rect x="13.5" y="6" width="7" height="12" rx="1.5" />
      <path d="M10.5 12h3" />
    </IconBase>
  ),
  Source: (p: P) => (
    <IconBase {...p} strokeWidth={1.6}>
      <path d="M12 4l8 4-8 4-8-4z" />
      <path d="M4 12l8 4 8-4" />
      <path d="M4 16l8 4 8-4" />
    </IconBase>
  ),
  Matte: (p: P) => (
    <IconBase {...p} strokeWidth={1.6}>
      <circle cx="12" cy="12" r="7.5" />
      <path d="M12 4.5a7.5 7.5 0 0 0 0 15z" fill="currentColor" stroke="none" />
    </IconBase>
  ),
  Scope: (p: P) => (
    <IconBase {...p} strokeWidth={1.6}>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <path d="M6 15l3-5 3 3 3-6 3 7" />
    </IconBase>
  ),
  Layout1: (p: P) => (
    <IconBase {...p} strokeWidth={1.6}>
      <rect x="4.5" y="5.5" width="15" height="13" rx="1.5" />
    </IconBase>
  ),
  Layout2: (p: P) => (
    <IconBase {...p} strokeWidth={1.6}>
      <rect x="4.5" y="5.5" width="15" height="13" rx="1.5" />
      <path d="M12 5.5v13" />
    </IconBase>
  ),
  Layout4: (p: P) => (
    <IconBase {...p} strokeWidth={1.6}>
      <rect x="4.5" y="5.5" width="15" height="13" rx="1.5" />
      <path d="M12 5.5v13M4.5 12h15" />
    </IconBase>
  ),
  Close: (p: P) => (
    <IconBase {...p} strokeWidth={1.6}>
      <path d="M7 7l10 10M17 7L7 17" />
    </IconBase>
  ),
  Plus: (p: P) => (
    <IconBase {...p} strokeWidth={1.6}>
      <path d="M12 5v14M5 12h14" />
    </IconBase>
  ),
  Trash: (p: P) => (
    <IconBase {...p} strokeWidth={1.6}>
      <path d="M5 7h14" />
      <path d="M10 4h4" />
      <path d="M7 7l.8 11.2A2 2 0 0 0 9.8 20h4.4a2 2 0 0 0 2-1.8L17 7" />
    </IconBase>
  ),
  Grade: (p: P) => (
    <IconBase {...p} strokeWidth={1.6}>
      <circle cx="9" cy="10" r="5" />
      <circle cx="15" cy="10" r="5" opacity="0.7" />
      <circle cx="12" cy="15" r="5" opacity="0.5" />
    </IconBase>
  ),
};
