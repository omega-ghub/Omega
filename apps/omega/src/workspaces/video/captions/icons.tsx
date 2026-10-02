// Captions package glyphs, drawn on the shared 24-unit monoline grid.
import type { ReactNode, SVGProps } from 'react';
import { IconBase } from '../../../ui/Icons';

type P = SVGProps<SVGSVGElement> & { size?: number };

const make = (children: ReactNode) => {
  const Icon = (p: P) => <IconBase {...p}>{children}</IconBase>;
  return Icon;
};

export const CI = {
  Captions: make(
    <>
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <path d="M10.2 10.2a2 2 0 1 0 0 3.6" />
      <path d="M16.7 10.2a2 2 0 1 0 0 3.6" />
    </>,
  ),
  Plus: make(<path d="M12 5.5v13M5.5 12h13" />),
  Split: make(
    <>
      <path d="M12 3.5v17" strokeDasharray="2 2.4" />
      <rect x="3.5" y="8" width="6" height="8" rx="1.5" />
      <rect x="14.5" y="8" width="6" height="8" rx="1.5" />
    </>,
  ),
  Merge: make(
    <>
      <rect x="3.5" y="8" width="17" height="8" rx="1.5" />
      <path d="M9 12h6M13 10l2 2-2 2" />
    </>,
  ),
  Trash: make(
    <>
      <path d="M4.5 7h15" />
      <path d="M9.5 7V5.5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1V7" />
      <path d="M6.5 7l.8 11.2a1.5 1.5 0 0 0 1.5 1.3h6.4a1.5 1.5 0 0 0 1.5-1.3L17.5 7" />
    </>,
  ),
  SetIn: make(
    <>
      <path d="M9 5H6.5v14H9" />
      <path d="M12 12h7M16 9l3 3-3 3" />
    </>,
  ),
  SetOut: make(
    <>
      <path d="M15 5h2.5v14H15" />
      <path d="M5 12h7M9 9l3 3-3 3" />
    </>,
  ),
  NudgeBack: make(
    <>
      <path d="M14.5 7l-5 5 5 5" />
      <path d="M18.5 7v10" />
    </>,
  ),
  NudgeFwd: make(
    <>
      <path d="M9.5 7l5 5-5 5" />
      <path d="M5.5 7v10" />
    </>,
  ),
  Fix: make(
    <>
      <path d="M4.5 19.5l10-10" />
      <path d="M13 8l3 3" />
      <path d="M17.5 3.5v3M16 5h3M19.5 11v2M18.5 12h2M9.5 3.5v2M8.5 4.5h2" />
    </>,
  ),
  Wrap: make(
    <>
      <path d="M4 7h16" />
      <path d="M4 12h12.5a2.5 2.5 0 0 1 0 5H12" />
      <path d="M13.5 15l-2 2 2 2" />
      <path d="M4 17h4" />
    </>,
  ),
  Warn: make(
    <>
      <path d="M10.6 4.4a1.6 1.6 0 0 1 2.8 0l7.2 12.9a1.6 1.6 0 0 1-1.4 2.4H4.8a1.6 1.6 0 0 1-1.4-2.4z" />
      <path d="M12 9.5v4" />
      <circle cx="12" cy="16.6" r="0.4" fill="currentColor" />
    </>,
  ),
  Search: make(
    <>
      <circle cx="10.5" cy="10.5" r="6" />
      <path d="M19.5 19.5l-4.6-4.6" />
    </>,
  ),
  Import: make(
    <>
      <path d="M12 4v10.5M8 10.5l4 4 4-4" />
      <path d="M4.5 15v3a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-3" />
    </>,
  ),
  Export: make(
    <>
      <path d="M12 15V4.5M8 8.5l4-4 4 4" />
      <path d="M4.5 15v3a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-3" />
    </>,
  ),
  Chevron: make(<path d="M7 10l5 5 5-5" />),
  Up: make(<path d="M7 14l5-5 5 5" />),
  Down: make(<path d="M7 10l5 5 5-5" />),
  Close: make(<path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />),
  Copy: make(
    <>
      <rect x="8.5" y="8.5" width="11" height="11" rx="2" />
      <path d="M15.5 8.5V6.5a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2" />
    </>,
  ),
  Follow: make(
    <>
      <path d="M8.5 4h7l-3.5 3.5z" fill="currentColor" />
      <path d="M12 7.5V20" />
      <path d="M4.5 12h3M16.5 12h3" />
    </>,
  ),
};
