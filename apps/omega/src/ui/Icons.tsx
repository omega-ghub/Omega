// Omega icon set. OWNED BY THE SHELL PACKAGE.
//
// One monoline family on a 24-unit grid: stroke 1.6, round caps and joins,
// 2px keyline (live area 3..21), 2–2.5 unit corner radii on frames, and
// currentColor everywhere so icons inherit text color. Fills are used only
// for transport glyphs and tiny dots.
//
// Usage: <I.Razor size={16} />. Packages that need a new glyph build it with
// <IconBase> in their own icons.tsx, in the same style.

import type { ReactElement, ReactNode, SVGProps } from 'react';

type P = SVGProps<SVGSVGElement> & { size?: number };
export type IconProps = P;
export type IconComponent = (p: P) => ReactElement;

export function IconBase({ size = 18, children, ...rest }: P) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

/** Builds an icon component from static children (elements are immutable and safely shared). */
function icon(children: ReactNode, defaults?: Partial<P>): (p: P) => ReactElement {
  const Icon = (p: P) => (
    <IconBase {...defaults} {...p}>
      {children}
    </IconBase>
  );
  return Icon;
}

const FILL = { fill: 'currentColor' } as const;
const SOLID = { fill: 'currentColor', stroke: 'none' } as const;
const DOTS = { strokeWidth: 2.4 } as const;

/** A gear outline generated once: 8 trapezoid teeth on a round body. */
const GEAR_PATH = (() => {
  const teeth = 8;
  const ro = 9.4;
  const ri = 7.2;
  const step = (Math.PI * 2) / teeth;
  const hw = step * 0.16;
  const hb = step * 0.27;
  const pt = (r: number, a: number) => `${(12 + r * Math.cos(a)).toFixed(2)} ${(12 + r * Math.sin(a)).toFixed(2)}`;
  let d = '';
  for (let i = 0; i < teeth; i++) {
    const a = i * step - Math.PI / 2;
    if (i === 0) d += `M${pt(ri, a - hb)}`;
    d += `L${pt(ro, a - hw)}L${pt(ro, a + hw)}L${pt(ri, a + hb)}`;
    const next = (i + 1) * step - Math.PI / 2;
    d += `A${ri} ${ri} 0 0 1 ${pt(ri, next - hb)}`;
  }
  return `${d}Z`;
})();

// ---------------------------------------------------------------------------
// Shared building blocks
// ---------------------------------------------------------------------------

const frame = <rect x="3" y="4.5" width="18" height="15" rx="2.5" />;
const squareFrame = <rect x="3.5" y="3.5" width="17" height="17" rx="2.5" />;
const speakerBody = <path d="M4 9.6v4.8a.6.6 0 0 0 .6.6h2.9l4.1 3.6a.6.6 0 0 0 1-.45V5.85a.6.6 0 0 0-1-.45L7.5 9H4.6a.6.6 0 0 0-.6.6z" />;
const magnifier = (
  <>
    <circle cx="10.5" cy="10.5" r="6.5" />
    <path d="M20 20l-4.6-4.6" />
  </>
);
const folderShape = <path d="M3.5 7.5a2 2 0 0 1 2-2h3.7a1.5 1.5 0 0 1 1.1.5l1.6 1.8h6.6a2 2 0 0 1 2 2v7.7a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" />;
const copyShape = (
  <>
    <rect x="8.5" y="8.5" width="12" height="12" rx="2.5" />
    <path d="M15.5 8.5V6a2.5 2.5 0 0 0-2.5-2.5H6A2.5 2.5 0 0 0 3.5 6v7A2.5 2.5 0 0 0 6 15.5h2.5" />
  </>
);
const chain = (
  <>
    <path d="M10.2 13.8a3.9 3.9 0 0 0 5.5 0l3-3a3.9 3.9 0 0 0-5.5-5.5l-1 1" />
    <path d="M13.8 10.2a3.9 3.9 0 0 0-5.5 0l-3 3a3.9 3.9 0 0 0 5.5 5.5l1-1" />
  </>
);
const eye = (
  <>
    <path d="M2.8 12c2.1-4 5.2-6.2 9.2-6.2s7.1 2.2 9.2 6.2c-2.1 4-5.2 6.2-9.2 6.2S4.9 16 2.8 12z" />
    <circle cx="12" cy="12" r="2.8" />
  </>
);

export const I = {
  // ---- transport -----------------------------------------------------------
  Play: icon(<path d="M8 5.6v12.8L18.5 12z" {...FILL} />),
  PlayReverse: icon(<path d="M16 5.6v12.8L5.5 12z" {...FILL} />),
  Pause: icon(
    <>
      <rect x="6.5" y="5.5" width="3.6" height="13" rx="1" {...SOLID} />
      <rect x="13.9" y="5.5" width="3.6" height="13" rx="1" {...SOLID} />
    </>,
  ),
  Stop: icon(<rect x="6" y="6" width="12" height="12" rx="2" {...SOLID} />),
  SkipStart: icon(
    <>
      <path d="M6 5.8v12.4" />
      <path d="M18 6.6v10.8L9.5 12z" {...FILL} />
    </>,
  ),
  SkipEnd: icon(
    <>
      <path d="M18 5.8v12.4" />
      <path d="M6 6.6v10.8l8.5-5.4z" {...FILL} />
    </>,
  ),
  StepBack: icon(
    <>
      <path d="M7 6.5v11" />
      <path d="M16.5 6.5L11 12l5.5 5.5" />
    </>,
  ),
  StepForward: icon(
    <>
      <path d="M17 6.5v11" />
      <path d="M7.5 6.5L13 12l-5.5 5.5" />
    </>,
  ),
  Loop: icon(
    <>
      <path d="M16.5 4.5L19 7l-2.5 2.5" />
      <path d="M19 7H8.5A3.5 3.5 0 0 0 5 10.5v.5" />
      <path d="M7.5 19.5L5 17l2.5-2.5" />
      <path d="M5 17h10.5a3.5 3.5 0 0 0 3.5-3.5V13" />
    </>,
  ),
  MarkIn: icon(
    <>
      <path d="M9.5 5H6.5v14h3" />
      <path d="M13 8.5l4 3.5-4 3.5" />
    </>,
  ),
  MarkOut: icon(
    <>
      <path d="M14.5 5h3v14h-3" />
      <path d="M11 8.5L7 12l4 3.5" />
    </>,
  ),
  ClearInOut: icon(
    <>
      <path d="M8 5H5v14h3" />
      <path d="M16 5h3v14h-3" />
      <path d="M10 10l4 4M14 10l-4 4" />
    </>,
  ),
  GoToIn: icon(
    <>
      <path d="M8.5 5H6v14h2.5" />
      <path d="M19 12h-8.5" />
      <path d="M13.5 9l-3 3 3 3" />
    </>,
  ),
  GoToOut: icon(
    <>
      <path d="M15.5 5H18v14h-2.5" />
      <path d="M5 12h8.5" />
      <path d="M10.5 9l3 3-3 3" />
    </>,
  ),
  PrevEdit: icon(
    <>
      <path d="M5.5 5.5v13" />
      <path d="M13.5 7.5L9 12l4.5 4.5" />
      <path d="M18.5 7.5L14 12l4.5 4.5" />
    </>,
  ),
  NextEdit: icon(
    <>
      <path d="M18.5 5.5v13" />
      <path d="M10.5 7.5L15 12l-4.5 4.5" />
      <path d="M5.5 7.5L10 12l-4.5 4.5" />
    </>,
  ),
  /** Back-compat: In / Out are the mark-in / mark-out glyphs. */
  In: icon(
    <>
      <path d="M9.5 5H6.5v14h3" />
      <path d="M13 8.5l4 3.5-4 3.5" />
    </>,
  ),
  Out: icon(
    <>
      <path d="M14.5 5h3v14h-3" />
      <path d="M11 8.5L7 12l4 3.5" />
    </>,
  ),

  // ---- tools ---------------------------------------------------------------
  Select: icon(<path d="M6 3.8l12.2 7.1a.4.4 0 0 1-.1.73l-5.3 1.5-2.6 5a.4.4 0 0 1-.74-.06L5.4 4.3a.4.4 0 0 1 .6-.5z" />),
  Cursor: icon(<path d="M6 3.8l12.2 7.1a.4.4 0 0 1-.1.73l-5.3 1.5-2.6 5a.4.4 0 0 1-.74-.06L5.4 4.3a.4.4 0 0 1 .6-.5z" />),
  TrackForward: icon(
    <>
      <path d="M5 5v14" />
      <path d="M9 8.5h10M16 5.5l3 3-3 3" />
      <path d="M9 15.5h10M16 12.5l3 3-3 3" />
    </>,
  ),
  Ripple: icon(
    <>
      <path d="M9.5 5H12v14H9.5" />
      <path d="M15.5 12h5" />
      <path d="M18 9.5l2.5 2.5-2.5 2.5" />
      <path d="M3.5 12h3" />
    </>,
  ),
  Roll: icon(
    <>
      <path d="M10 5v14M14 5v14" />
      <path d="M3.5 12H7M5.5 10L3.5 12l2 2" />
      <path d="M20.5 12H17M18.5 10l2 2-2 2" />
    </>,
  ),
  RateStretch: icon(
    <>
      <path d="M8 5.5v13M16 5.5v13" />
      <path d="M8 12H3.5M5.5 10l-2 2 2 2" />
      <path d="M16 12h4.5M18.5 10l2 2-2 2" />
      <path d="M11 10l1 2 1-2" />
    </>,
  ),
  Slip: icon(
    <>
      <rect x="3" y="6.5" width="18" height="11" rx="2" />
      <path d="M8 12h8M10 10l-2 2 2 2M14 10l2 2-2 2" />
    </>,
  ),
  Slide: icon(
    <>
      <rect x="8" y="7" width="8" height="10" rx="1.6" />
      <path d="M2.5 12h3M4 10.5L2.5 12 4 13.5" />
      <path d="M21.5 12h-3M20 10.5l1.5 1.5-1.5 1.5" />
    </>,
  ),
  Razor: icon(
    <>
      <path d="M3.8 20.2l5.4-5.4" />
      <path d="M9.2 14.8L19.6 4.4a.4.4 0 0 1 .68.3l-.6 8.4a1.2 1.2 0 0 1-.35.77l-3.6 3.6a1.2 1.2 0 0 1-1.7 0z" />
    </>,
  ),
  Scissors: icon(
    <>
      <circle cx="6.5" cy="6.5" r="2.5" />
      <circle cx="6.5" cy="17.5" r="2.5" />
      <path d="M8.6 7.9L19.5 17.5" />
      <path d="M8.6 16.1L19.5 6.5" />
    </>,
  ),
  Pen: icon(
    <>
      <path d="M8.8 4h6.4a.8.8 0 0 1 .77.58l1.8 6.3a1 1 0 0 1-.13.83L12 20.5l-5.64-8.79a1 1 0 0 1-.13-.83l1.8-6.3A.8.8 0 0 1 8.8 4z" />
      <path d="M12 20.5v-7" />
      <circle cx="12" cy="12" r="1.5" />
    </>,
  ),
  Hand: icon(
    <>
      <path d="M8 13.5V7a1.5 1.5 0 0 1 3 0v4.5" />
      <path d="M11 11V5.5a1.5 1.5 0 0 1 3 0V11" />
      <path d="M14 11V7a1.5 1.5 0 0 1 3 0v6.5a7 7 0 0 1-7 7h-.4a5.6 5.6 0 0 1-4.4-2.1l-2.4-3a1.5 1.5 0 0 1 2.3-1.9L8 15.5v-2" />
    </>,
  ),
  ZoomTool: icon(
    <>
      {magnifier}
      <path d="M10.5 7.8v5.4M7.8 10.5h5.4" />
    </>,
  ),
  ZoomIn: icon(
    <>
      {magnifier}
      <path d="M10.5 7.8v5.4M7.8 10.5h5.4" />
    </>,
  ),
  ZoomOut: icon(
    <>
      {magnifier}
      <path d="M7.8 10.5h5.4" />
    </>,
  ),
  Text: icon(
    <>
      <path d="M5.5 7.5V5h13v2.5" />
      <path d="M12 5v14" />
      <path d="M9.5 19h5" />
    </>,
  ),
  Type: icon(
    <>
      <path d="M3.5 7V5.5h10V7" />
      <path d="M8.5 5.5v13" />
      <path d="M14.5 10.5h6" />
      <path d="M17 8v8.5a2 2 0 0 0 2 2h1" />
    </>,
  ),

  // ---- markers, keyframes ---------------------------------------------------
  Marker: icon(<path d="M7 4h10a.5.5 0 0 1 .5.5v10.3a.5.5 0 0 1-.17.38l-5 4.4a.5.5 0 0 1-.66 0l-5-4.4a.5.5 0 0 1-.17-.38V4.5A.5.5 0 0 1 7 4z" />),
  Chapter: icon(
    <>
      <path d="M6.5 4.5A1 1 0 0 1 7.5 3.5h9a1 1 0 0 1 1 1v15.2a.5.5 0 0 1-.8.4L12 16.5l-4.7 3.6a.5.5 0 0 1-.8-.4z" />
      <path d="M9.5 8h5" />
    </>,
  ),
  Keyframe: icon(<path d="M12 4.2l7.8 7.8-7.8 7.8L4.2 12z" />),
  KeyframeFilled: icon(<path d="M12 4.2l7.8 7.8-7.8 7.8L4.2 12z" {...FILL} />),
  Stopwatch: icon(
    <>
      <circle cx="12" cy="13.5" r="7" />
      <path d="M12 13.5V10" />
      <path d="M10 3h4" />
      <path d="M12 3v3.5" />
      <path d="M17.8 7.7l1.4-1.4" />
    </>,
  ),

  // ---- track / clip state ---------------------------------------------------
  Eye: icon(eye),
  EyeOff: icon(
    <>
      <path d="M9.9 6.1A9 9 0 0 1 12 5.8c4 0 7.1 2.2 9.2 6.2a14 14 0 0 1-2.2 3.1" />
      <path d="M14.1 14.3a2.8 2.8 0 0 1-4.2-3.8" />
      <path d="M17 17a9.6 9.6 0 0 1-5 1.2c-4 0-7.1-2.2-9.2-6.2A13.2 13.2 0 0 1 7 7" />
      <path d="M4 4l16 16" />
    </>,
  ),
  Solo: icon(
    <>
      <rect x="4" y="4" width="16" height="16" rx="3" />
      <path d="M14.6 9.3c-.4-1-1.4-1.7-2.6-1.7-1.5 0-2.6.9-2.6 2.1 0 2.9 5.4 1.7 5.4 4.6 0 1.3-1.2 2.2-2.8 2.2-1.3 0-2.4-.7-2.8-1.8" />
    </>,
  ),
  Lock: icon(
    <>
      <rect x="5" y="10.5" width="14" height="10" rx="2.5" />
      <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
    </>,
  ),
  Unlock: icon(
    <>
      <rect x="5" y="10.5" width="14" height="10" rx="2.5" />
      <path d="M8 10.5V7.5a4 4 0 0 1 7.75-1.4" />
    </>,
  ),
  Link: icon(chain),
  Unlink: icon(
    <>
      <path d="M15.5 13l3.2-3.2a3.9 3.9 0 0 0-5.5-5.5L10 7.5" />
      <path d="M8.5 11l-3.2 3.2a3.9 3.9 0 0 0 5.5 5.5L14 16.5" />
      <path d="M16 3v2M21 8h-2M8 21v-2M3 16h2" />
    </>,
  ),
  Snap: icon(
    <>
      <path d="M5.5 4.5h4v7a2.5 2.5 0 0 0 5 0v-7h4v7a6.5 6.5 0 0 1-13 0z" />
      <path d="M5.5 8.5h4M14.5 8.5h4" />
    </>,
  ),
  Magnet: icon(
    <>
      <path d="M5.5 4.5h4v7a2.5 2.5 0 0 0 5 0v-7h4v7a6.5 6.5 0 0 1-13 0z" />
      <path d="M5.5 8.5h4M14.5 8.5h4" />
    </>,
  ),
  Magnetic: icon(
    <>
      <rect x="3" y="8.5" width="8.5" height="7" rx="1.5" />
      <rect x="12.5" y="8.5" width="8.5" height="7" rx="1.5" />
      <path d="M12 3.5v2.5M12 18v2.5" />
    </>,
  ),
  Target: icon(
    <>
      <circle cx="12" cy="12" r="7" />
      <path d="M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4" />
      <circle cx="12" cy="12" r="1.1" {...SOLID} />
    </>,
  ),
  Mute: icon(
    <>
      {speakerBody}
      <path d="M16 9.5l5 5M21 9.5l-5 5" />
    </>,
  ),
  Speaker: icon(
    <>
      {speakerBody}
      <path d="M15.5 9a4.2 4.2 0 0 1 0 6" />
      <path d="M18.2 6.5a7.8 7.8 0 0 1 0 11" />
    </>,
  ),
  Volume: icon(
    <>
      {speakerBody}
      <path d="M15.5 9a4.2 4.2 0 0 1 0 6" />
      <path d="M18.2 6.5a7.8 7.8 0 0 1 0 11" />
    </>,
  ),

  // ---- clip operations ------------------------------------------------------
  Nest: icon(
    <>
      <rect x="3.5" y="3.5" width="17" height="17" rx="2.5" />
      <rect x="8" y="8" width="8" height="8" rx="1.5" />
    </>,
  ),
  Speed: icon(
    <>
      <path d="M4.3 17a8.5 8.5 0 1 1 15.4 0" />
      <path d="M12 14l4-4.5" />
      <circle cx="12" cy="14" r="1.2" {...SOLID} />
    </>,
  ),
  Reverse: icon(
    <>
      <path d="M11.5 6.8v10.4L4 12z" />
      <path d="M20 6.8v10.4L12.5 12z" />
    </>,
  ),
  Freeze: icon(
    <>
      <path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9" />
      <path d="M9.6 4.4L12 6.3l2.4-1.9M9.6 19.6l2.4-1.9 2.4 1.9" />
    </>,
  ),
  Transition: icon(
    <>
      <path d="M4 6.3v11.4a.5.5 0 0 0 .8.4L12 12 4.8 5.9a.5.5 0 0 0-.8.4z" />
      <path d="M20 6.3v11.4a.5.5 0 0 1-.8.4L12 12l7.2-6.1a.5.5 0 0 1 .8.4z" />
    </>,
  ),
  Effect: icon(
    <>
      <path d="M4 20l10-10" />
      <path d="M13 9l2 2" />
      <path d="M17.5 3v3M16 4.5h3" />
      <path d="M20 9.5v2M19 10.5h2" />
      <path d="M10 3.5v2M9 4.5h2" />
    </>,
  ),
  Fx: icon(
    <>
      <path d="M11 5.6a2.4 2.4 0 0 0-2.2-.5C7.6 5.4 7 6.3 7 7.6V19" />
      <path d="M4.5 10.5h5.5" />
      <path d="M13 10.5l6 8.5M19 10.5l-6 8.5" />
    </>,
  ),
  Mask: icon(
    <>
      {frame}
      <circle cx="12" cy="12" r="4.2" />
    </>,
  ),
  Crop: icon(
    <>
      <path d="M6.5 2.5v13.5A1.5 1.5 0 0 0 8 17.5h13.5" />
      <path d="M2.5 6.5H16A1.5 1.5 0 0 1 17.5 8v13.5" />
    </>,
  ),
  Transform: icon(
    <>
      <path d="M7.5 5.5h9M7.5 18.5h9M5.5 7.5v9M18.5 7.5v9" />
      <rect x="3.5" y="3.5" width="4" height="4" rx="1" />
      <rect x="16.5" y="3.5" width="4" height="4" rx="1" />
      <rect x="3.5" y="16.5" width="4" height="4" rx="1" />
      <rect x="16.5" y="16.5" width="4" height="4" rx="1" />
    </>,
  ),
  Rotate: icon(
    <>
      <path d="M20 12a8 8 0 1 1-2.35-5.65" />
      <path d="M20 4.5V9h-4.5" />
    </>,
  ),
  Blend: icon(
    <>
      <circle cx="9" cy="12" r="5.5" />
      <circle cx="15" cy="12" r="5.5" />
    </>,
  ),
  Split: icon(
    <>
      <path d="M9.5 7H5a1.5 1.5 0 0 0-1.5 1.5v7A1.5 1.5 0 0 0 5 17h4.5" />
      <path d="M14.5 7H19a1.5 1.5 0 0 1 1.5 1.5v7A1.5 1.5 0 0 1 19 17h-4.5" />
      <path d="M12 3.5v17" />
    </>,
  ),
  RippleDelete: icon(
    <>
      <rect x="3" y="7.5" width="5.5" height="9" rx="1.5" />
      <rect x="15.5" y="7.5" width="5.5" height="9" rx="1.5" />
      <path d="M13.5 12h-3M12 10.3L10.3 12l1.7 1.7" />
    </>,
  ),
  Lift: icon(
    <>
      <path d="M3 19.5h5.5M15.5 19.5H21" />
      <path d="M12 16.5V5" />
      <path d="M8.5 8.5L12 5l3.5 3.5" />
    </>,
  ),
  Extract: icon(
    <>
      <path d="M3 19.5h18" />
      <path d="M12 16.5V5" />
      <path d="M8.5 8.5L12 5l3.5 3.5" />
    </>,
  ),
  Insert: icon(
    <>
      <rect x="2.5" y="14.5" width="7" height="6" rx="1.2" />
      <rect x="14.5" y="14.5" width="7" height="6" rx="1.2" />
      <path d="M12 3.5v13" />
      <path d="M9 13.5l3 3 3-3" />
    </>,
  ),
  Overwrite: icon(
    <>
      <rect x="2.5" y="14.5" width="19" height="6" rx="1.2" />
      <path d="M12 3.5v8" />
      <path d="M9 8.5l3 3 3-3" />
    </>,
  ),
  Gap: icon(
    <>
      <rect x="2.5" y="7.5" width="6" height="9" rx="1.5" />
      <rect x="15.5" y="7.5" width="6" height="9" rx="1.5" />
      <path d="M10.5 18.5v1.5h3v-1.5" />
      <path d="M10.5 5.5V4h3v1.5" />
    </>,
  ),
  Trash: icon(
    <>
      <path d="M4.5 6.5h15" />
      <path d="M9.5 6.5V5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1.5" />
      <path d="M6.5 6.5l.85 12.1A1.5 1.5 0 0 0 8.85 20h6.3a1.5 1.5 0 0 0 1.5-1.4l.85-12.1" />
      <path d="M10 10.5v5.5M14 10.5v5.5" />
    </>,
  ),
  Duplicate: icon(
    <>
      {copyShape}
      <path d="M14.5 11.5v6M11.5 14.5h6" />
    </>,
  ),
  Copy: icon(copyShape),
  Paste: icon(
    <>
      <path d="M8.5 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-1.5" />
      <rect x="8.5" y="3" width="7" height="4" rx="1.2" />
    </>,
  ),
  Undo: icon(
    <>
      <path d="M9 14.5L4.5 10 9 5.5" />
      <path d="M4.5 10H15a4.5 4.5 0 0 1 0 9h-3" />
    </>,
  ),
  Redo: icon(
    <>
      <path d="M15 14.5l4.5-4.5L15 5.5" />
      <path d="M19.5 10H9a4.5 4.5 0 0 0 0 9h3" />
    </>,
  ),

  // ---- color ----------------------------------------------------------------
  Wheel: icon(
    <>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="14.6" cy="9.6" r="1.9" />
      <circle cx="12" cy="12" r="0.6" {...SOLID} />
    </>,
  ),
  Curves: icon(
    <>
      {squareFrame}
      <path d="M6.5 17.5c4.5 0 4-11 11-11" />
      <circle cx="11.2" cy="11.8" r="1.2" {...SOLID} />
    </>,
  ),
  Scopes: icon(
    <>
      <rect x="3" y="4" width="18" height="13" rx="2.5" />
      <path d="M6.5 13l2.8-3.3 2.6 2.1 4.6-5.3" />
      <path d="M9 20.5h6" />
    </>,
  ),
  Waveform: icon(<path d="M4 10v4M7.5 7v10M11 4.5v15M14.5 8v8M18 6v12M21 10.5v3" />),
  Vectorscope: icon(
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 12L7.4 6.8" />
      <path d="M12 3.5v2M20.5 12h-2M12 20.5v-2M3.5 12h2" />
      <circle cx="12" cy="12" r="0.9" {...SOLID} />
    </>,
  ),
  Histogram: icon(
    <>
      <path d="M3.5 20.5h17" />
      <path d="M5.5 20.5v-4.5M9 20.5V10M12.5 20.5V5.5M16 20.5v-8M19.5 20.5V16" />
    </>,
  ),
  Lut: icon(
    <>
      <path d="M12 3.3l7.6 4.3v8.8L12 20.7l-7.6-4.3V7.6z" />
      <path d="M4.4 7.6L12 12l7.6-4.4M12 12v8.7" />
    </>,
  ),
  Qualifier: icon(
    <>
      <path d="M14.2 5.8l4 4" />
      <path d="M15.6 4.4a2.3 2.3 0 0 1 3.3 3.3l-1.8 1.8-3.3-3.3z" />
      <path d="M13.1 7.3L6.3 14.1a1.6 1.6 0 0 0-.45 1L5.3 18.7l3.6-.55a1.6 1.6 0 0 0 1-.45l6.8-6.8" />
    </>,
  ),
  Compare: icon(
    <>
      {frame}
      <path d="M12 2.5v19" />
      <path d="M7 10l-1.8 2L7 14M17 10l1.8 2L17 14" />
    </>,
  ),
  Sparkle: icon(
    <>
      <path d="M10.5 4.5c.6 4.3 2.2 5.9 6.5 6.5-4.3.6-5.9 2.2-6.5 6.5-.6-4.3-2.2-5.9-6.5-6.5 4.3-.6 5.9-2.2 6.5-6.5z" />
      <path d="M18.5 3v3.5M16.75 4.75h3.5" />
      <path d="M18.5 16.5v3M17 18h3" />
    </>,
  ),
  Adjustment: icon(
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 3.5a8.5 8.5 0 0 1 0 17z" {...SOLID} />
    </>,
  ),
  Gradient: icon(
    <>
      {squareFrame}
      <path d="M3.8 15.2L15.2 3.8M8 20.3L20.3 8M13.5 20.3l6.8-6.8" />
    </>,
  ),

  // ---- captions, deliver ------------------------------------------------------
  Captions: icon(
    <>
      {frame}
      <path d="M10.6 10a2.4 2.4 0 1 0 0 4" />
      <path d="M16.6 10a2.4 2.4 0 1 0 0 4" />
    </>,
  ),
  Subtitles: icon(
    <>
      {frame}
      <path d="M7 12.5h3.5M13 12.5h4M7 15.5h6.5M16.5 15.5h.5" />
    </>,
  ),
  Import: icon(
    <>
      <path d="M12 4v11" />
      <path d="M7.5 10.5L12 15l4.5-4.5" />
      <path d="M4.5 15v2.5A2.5 2.5 0 0 0 7 20h10a2.5 2.5 0 0 0 2.5-2.5V15" />
    </>,
  ),
  Export: icon(
    <>
      <path d="M12 15V4" />
      <path d="M7.5 8.5L12 4l4.5 4.5" />
      <path d="M4.5 15v2.5A2.5 2.5 0 0 0 7 20h10a2.5 2.5 0 0 0 2.5-2.5V15" />
    </>,
  ),
  Download: icon(
    <>
      <path d="M12 4v11" />
      <path d="M7.5 10.5L12 15l4.5-4.5" />
      <path d="M5 20h14" />
    </>,
  ),
  Upload: icon(
    <>
      <path d="M12 15V4" />
      <path d="M7.5 8.5L12 4l4.5 4.5" />
      <path d="M5 20h14" />
    </>,
  ),
  Queue: icon(
    <>
      <path d="M4 6.5h13M4 11.5h13M4 16.5h7" />
      <path d="M15 14.2v5.6a.4.4 0 0 0 .6.35l4.6-2.8a.4.4 0 0 0 0-.7l-4.6-2.8a.4.4 0 0 0-.6.35z" {...FILL} />
    </>,
  ),
  Render: icon(<path d="M13.2 3L5.6 13.2a.5.5 0 0 0 .4.8H12l-1.2 7 7.6-10.2a.5.5 0 0 0-.4-.8H12z" />),

  // ---- app / shell ------------------------------------------------------------
  History: icon(
    <>
      <path d="M3.6 12a8.4 8.4 0 1 0 2.5-6" />
      <path d="M3.6 4.5V8.5h4" />
      <path d="M12 7.8V12l3 2" />
    </>,
  ),
  Clock: icon(
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>,
  ),
  Command: icon(
    <path d="M9 9V6.5A2.5 2.5 0 1 0 6.5 9H9zm0 0h6m-6 0v6m6-6V6.5A2.5 2.5 0 1 1 17.5 9H15zm0 0v6m0 0H9m6 0v2.5a2.5 2.5 0 1 0 2.5-2.5H15zm-6 0v2.5A2.5 2.5 0 1 1 6.5 15H9z" />,
  ),
  Keyboard: icon(
    <>
      <rect x="2.5" y="6" width="19" height="12" rx="2.5" />
      <path d="M6.5 9.75h.01M9.5 9.75h.01M12.5 9.75h.01M15.5 9.75h.01M18 9.75h.01M7 12.75h.01M10 12.75h.01M13 12.75h.01M16.5 12.75h.01" {...DOTS} />
      <path d="M8.5 15.5h7" />
    </>,
  ),
  Layout: icon(
    <>
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <path d="M3 13.5h18M9.5 4v9.5" />
    </>,
  ),
  PanelLeft: icon(
    <>
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <path d="M9 4v16" />
    </>,
  ),
  PanelRight: icon(
    <>
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <path d="M15 4v16" />
    </>,
  ),
  PanelBottom: icon(
    <>
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <path d="M3 14h18" />
    </>,
  ),
  Fullscreen: icon(
    <>
      <path d="M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9" />
      <path d="M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9" />
      <path d="M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15" />
      <path d="M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15" />
    </>,
  ),
  Expand: icon(
    <>
      <path d="M14.5 4H20v5.5M20 4l-6.5 6.5" />
      <path d="M9.5 20H4v-5.5M4 20l6.5-6.5" />
    </>,
  ),
  Collapse: icon(
    <>
      <path d="M19.5 10H14V4.5M14 10l6.5-6.5" />
      <path d="M4.5 14H10v5.5M10 14l-6.5 6.5" />
    </>,
  ),
  SafeArea: icon(
    <>
      <rect x="2.5" y="4.5" width="19" height="15" rx="2.5" />
      <path d="M6.5 10V8.5H8M16 8.5h1.5V10M17.5 14v1.5H16M8 15.5H6.5V14" />
    </>,
  ),
  Grid: icon(
    <>
      {squareFrame}
      <path d="M9.2 3.5v17M14.8 3.5v17M3.5 9.2h17M3.5 14.8h17" />
    </>,
  ),
  Proxy: icon(
    <>
      {squareFrame}
      <path d="M10 16.5v-9h3a2.5 2.5 0 0 1 0 5h-3" />
    </>,
  ),
  Monitor: icon(
    <>
      <rect x="3" y="4" width="18" height="12.5" rx="2" />
      <path d="M9 20h6M12 16.5V20" />
    </>,
  ),
  Settings: icon(
    <>
      <path d={GEAR_PATH} />
      <circle cx="12" cy="12" r="2.6" />
    </>,
  ),
  Sliders: icon(
    <>
      <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
      <circle cx="15" cy="7" r="2" />
      <circle cx="9" cy="17" r="2" />
    </>,
  ),
  Info: icon(
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5" />
      <path d="M12 7.9h.01" {...DOTS} />
    </>,
  ),
  Help: icon(
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M9.6 9.6a2.5 2.5 0 1 1 3.4 2.3c-.6.25-1 .8-1 1.45v.4" />
      <path d="M12 16.6h.01" {...DOTS} />
    </>,
  ),
  Warning: icon(
    <>
      <path d="M10.7 4.6a1.5 1.5 0 0 1 2.6 0l7.3 12.8a1.5 1.5 0 0 1-1.3 2.25H4.7a1.5 1.5 0 0 1-1.3-2.25z" />
      <path d="M12 9.5v4" />
      <path d="M12 16.6h.01" {...DOTS} />
    </>,
  ),
  Check: icon(<path d="M5 12.5l4.5 4.5L19 7.5" />),
  CheckCircle: icon(
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M8.2 12.2l2.6 2.6 5-5.2" />
    </>,
  ),
  Plus: icon(<path d="M12 5v14M5 12h14" />),
  Minus: icon(<path d="M5 12h14" />),
  Close: icon(<path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />),
  ChevronLeft: icon(<path d="M14.5 6l-6 6 6 6" />),
  ChevronRight: icon(<path d="M9.5 6l6 6-6 6" />),
  ChevronUp: icon(<path d="M6 14.5l6-6 6 6" />),
  ChevronDown: icon(<path d="M6 9.5l6 6 6-6" />),
  /** Back-compat alias of ChevronRight. */
  Chevron: icon(<path d="M9.5 6l6 6-6 6" />),
  ChevronUpDown: icon(<path d="M8 9.5l4-4 4 4M8 14.5l4 4 4-4" />),
  ArrowLeft: icon(<path d="M19 12H5M11 6l-6 6 6 6" />),
  ArrowRight: icon(<path d="M5 12h14M13 6l6 6-6 6" />),
  ArrowUp: icon(<path d="M12 19V5M6 11l6-6 6 6" />),
  ArrowDown: icon(<path d="M12 5v14M6 13l6 6 6-6" />),
  Return: icon(
    <>
      <path d="M19 5.5v6a3 3 0 0 1-3 3H5.5" />
      <path d="M9 11l-3.5 3.5L9 18" />
    </>,
  ),
  More: icon(<path d="M6 12h.01M12 12h.01M18 12h.01" {...DOTS} />),
  MoreVertical: icon(<path d="M12 6h.01M12 12h.01M12 18h.01" {...DOTS} />),
  Grip: icon(<path d="M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01" {...DOTS} />),
  Pin: icon(
    <>
      <path d="M9 3.5h6l-.8 5.2 3.3 3.3v1.5h-11V12l3.3-3.3z" />
      <path d="M12 13.5v7" />
    </>,
  ),
  Refresh: icon(
    <>
      <path d="M19.8 11a8 8 0 0 0-14.6-3.5" />
      <path d="M4.2 13a8 8 0 0 0 14.6 3.5" />
      <path d="M4.5 3.5v4h4M19.5 20.5v-4h-4" />
    </>,
  ),
  ExternalLink: icon(
    <>
      <path d="M14 4h6v6M20 4l-8.5 8.5" />
      <path d="M18 13.5V18a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4.5" />
    </>,
  ),
  Sun: icon(
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M4.6 4.6L6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4L6 18M18 6l1.4-1.4" />
    </>,
  ),
  Moon: icon(<path d="M19.5 14.6A8 8 0 1 1 9.4 4.5a6.5 6.5 0 0 0 10.1 10.1z" />),
  Home: icon(<path d="M4 10.4L11.4 4.3a1 1 0 0 1 1.2 0L20 10.4V19a1.5 1.5 0 0 1-1.5 1.5H15v-5.5a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v5.5H5.5A1.5 1.5 0 0 1 4 19z" />),
  Apps: icon(
    <>
      <rect x="4" y="4" width="6.5" height="6.5" rx="1.6" />
      <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.6" />
      <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.6" />
      <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.6" />
    </>,
  ),
  // hub navigation (refined set)
  NavHome: icon(
    <>
      <path d="M3.8 10.6L12 4l8.2 6.6" />
      <path d="M6 9v9.5A1.5 1.5 0 0 0 7.5 20h9a1.5 1.5 0 0 0 1.5-1.5V9" />
      <path d="M10 20v-4.5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1V20" />
    </>,
  ),
  NavApps: icon(
    <>
      <rect x="4" y="4" width="6.5" height="6.5" rx="1.8" />
      <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.8" />
      <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.8" />
      <path d="M16.75 4v6.5M13.5 7.25H20" />
    </>,
  ),
  NavProjects: icon(
    <>
      <path d="M3.5 7.5a2 2 0 0 1 2-2h3.6a1.5 1.5 0 0 1 1.1.5l1.5 1.7h6.8a2 2 0 0 1 2 2v7.8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" />
      <path d="M3.5 10.5h17" />
    </>,
  ),
  NavLearn: icon(
    <>
      <path d="M2.8 9.4L12 5l9.2 4.4L12 13.8z" />
      <path d="M6.5 11.4v4.3c0 1.5 2.5 2.8 5.5 2.8s5.5-1.3 5.5-2.8v-4.3" />
      <path d="M21.2 9.4v4.6" />
    </>,
  ),
  NavPlans: icon(
    <>
      <path d="M7.2 4.5h9.6a1 1 0 0 1 .8.4l2.9 3.9a.6.6 0 0 1-.03.75L12.4 19a.5.5 0 0 1-.8 0L3.53 9.55a.6.6 0 0 1-.03-.75l2.9-3.9a1 1 0 0 1 .8-.4z" />
      <path d="M3.6 9h16.8" />
      <path d="M9.4 4.6L8.3 9l3.7 10 3.7-10-1.1-4.4" />
    </>,
  ),
  NavSettings: icon(
    <>
      <path d={GEAR_PATH} />
      <circle cx="12" cy="12" r="2.6" />
    </>,
  ),
  SidebarToggle: icon(
    <>
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <path d="M9 4v16" />
      <path d="M13.5 10l2 2-2 2" />
    </>,
  ),
  Book: icon(
    <>
      <path d="M12 6.5C10.2 5 7.6 4.5 4 4.5v13c3.6 0 6.2.5 8 2 1.8-1.5 4.4-2 8-2v-13c-3.6 0-6.2.5-8 2z" />
      <path d="M12 6.5v13" />
    </>,
  ),
  Shield: icon(
    <>
      <path d="M12 3.2l7.5 2.8v5.7c0 4.4-3.2 7.6-7.5 9.1-4.3-1.5-7.5-4.7-7.5-9.1V6z" />
      <path d="M9 12l2.1 2.1L15.2 10" />
    </>,
  ),
  Dot: icon(<circle cx="12" cy="12" r="3.5" {...SOLID} />),
  Save: icon(
    <>
      <path d="M5.5 3.5h10.3a1.5 1.5 0 0 1 1.06.44l2.7 2.7a1.5 1.5 0 0 1 .44 1.06V18.5a2 2 0 0 1-2 2h-12.5a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2z" />
      <path d="M8 3.5V8h7V3.5" />
      <path d="M7.5 20.5V14h9v6.5" />
    </>,
  ),
  Open: icon(
    <>
      {folderShape}
      <path d="M12 16v-5M9.5 13.5L12 11l2.5 2.5" />
    </>,
  ),

  // ---- media & bins -----------------------------------------------------------
  Bin: icon(
    <>
      <rect x="2.5" y="4" width="19" height="4.5" rx="1.2" />
      <path d="M4 8.5V18a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8.5" />
      <path d="M10 12h4" />
    </>,
  ),
  Folder: icon(folderShape),
  Search: icon(magnifier),
  Filter: icon(<path d="M4 5h16a.5.5 0 0 1 .4.8L14 13.5v5.2a.5.5 0 0 1-.72.45l-3-1.5a.5.5 0 0 1-.28-.45V13.5L3.6 5.8A.5.5 0 0 1 4 5z" />),
  Sort: icon(
    <>
      <path d="M7 4.5v15M3.5 16L7 19.5l3.5-3.5" />
      <path d="M13.5 6h7M13.5 11h5M13.5 16h3" />
    </>,
  ),
  ListView: icon(
    <>
      <path d="M9 6.5h11M9 12h11M9 17.5h11" />
      <path d="M4.5 6.5h.01M4.5 12h.01M4.5 17.5h.01" {...DOTS} />
    </>,
  ),
  GridView: icon(
    <>
      <rect x="4" y="4" width="6.5" height="6.5" rx="1.6" />
      <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.6" />
      <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.6" />
      <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.6" />
    </>,
  ),
  Star: icon(<path d="M12 3.8l2.45 5.1 5.6.75-4.1 3.9 1.03 5.55L12 16.4l-4.98 2.7 1.03-5.55-4.1-3.9 5.6-.75z" />),
  StarFilled: icon(<path d="M12 3.8l2.45 5.1 5.6.75-4.1 3.9 1.03 5.55L12 16.4l-4.98 2.7 1.03-5.55-4.1-3.9 5.6-.75z" {...FILL} />),
  Label: icon(
    <>
      <path d="M3.5 7.5a2 2 0 0 1 2-2h9.8a1 1 0 0 1 .78.37l4.8 6.13-4.8 6.13a1 1 0 0 1-.78.37H5.5a2 2 0 0 1-2-2z" />
      <circle cx="8" cy="12" r="1.2" {...SOLID} />
    </>,
  ),
  Tag: icon(
    <>
      <path d="M3.5 12.4V5a1.5 1.5 0 0 1 1.5-1.5h7.4a1.5 1.5 0 0 1 1.06.44l7.1 7.1a1.5 1.5 0 0 1 0 2.12l-7.4 7.4a1.5 1.5 0 0 1-2.12 0l-7.1-7.1a1.5 1.5 0 0 1-.44-1.06z" />
      <circle cx="8" cy="8" r="1.3" {...SOLID} />
    </>,
  ),
  Film: icon(
    <>
      {squareFrame}
      <path d="M7.5 3.5v17M16.5 3.5v17M3.5 8.5h4M3.5 15.5h4M16.5 8.5h4M16.5 15.5h4M7.5 12h9" />
    </>,
  ),
  Image: icon(
    <>
      {frame}
      <circle cx="8.5" cy="9.5" r="1.6" />
      <path d="M21 15.5l-4.6-4.6a1 1 0 0 0-1.4 0L6 19.5" />
    </>,
  ),
  Music: icon(
    <>
      <path d="M9 17.5V6.2a1 1 0 0 1 .8-1l8.5-1.6a1 1 0 0 1 1.2 1V15.5" />
      <circle cx="6.5" cy="17.5" r="2.5" />
      <circle cx="17" cy="15.5" r="2.5" />
    </>,
  ),
  Shape: icon(
    <>
      <circle cx="9" cy="9" r="5.5" />
      <rect x="11" y="11" width="9.5" height="9.5" rx="1.5" />
    </>,
  ),
  Square: icon(<rect x="4.5" y="4.5" width="15" height="15" rx="2.5" />),
  Circle: icon(<circle cx="12" cy="12" r="8" />),
  Sequence: icon(
    <>
      <path d="M3.5 7h9M15.5 7h5M3.5 12h5M11.5 12h9M3.5 17h12" />
    </>,
  ),

  // ---- audio ------------------------------------------------------------------
  Mixer: icon(
    <>
      <path d="M6 4.5v6M6 14.5v5M12 4.5v2M12 10.5v9M18 4.5v9M18 17.5v2" />
      <path d="M4 12.5h4M10 8.5h4M16 15.5h4" />
    </>,
  ),
  Fader: icon(
    <>
      <path d="M12 3.5V10M12 15v5.5" />
      <rect x="8.5" y="10" width="7" height="5" rx="1.3" />
      <path d="M4.5 6h2M4.5 10h2M4.5 14h2M4.5 18h2" />
    </>,
  ),
  Mic: icon(
    <>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0" />
      <path d="M12 17.5V21M9 21h6" />
    </>,
  ),
  Record: icon(
    <>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="4.5" {...SOLID} />
    </>,
  ),
  Headphones: icon(
    <>
      <path d="M4 16v-3.5a8 8 0 0 1 16 0V16" />
      <path d="M4 14.5h1.5A1.5 1.5 0 0 1 7 16v3a1.5 1.5 0 0 1-1.5 1.5h0A1.5 1.5 0 0 1 4 19z" />
      <path d="M20 14.5h-1.5A1.5 1.5 0 0 0 17 16v3a1.5 1.5 0 0 0 1.5 1.5h0A1.5 1.5 0 0 0 20 19z" />
    </>,
  ),
  Loudness: icon(
    <>
      <path d="M3 9.8v4.4a.5.5 0 0 0 .5.5h2.3l3.4 3a.5.5 0 0 0 .8-.37V6.67a.5.5 0 0 0-.8-.37l-3.4 3H3.5a.5.5 0 0 0-.5.5z" />
      <path d="M14 10v4M17.5 8v8M21 5.5v13" />
    </>,
  ),
  Duck: icon(
    <>
      <path d="M3 7.5h5.2a1 1 0 0 1 .92.6l2.1 4.8a1 1 0 0 0 .92.6h-.28a1 1 0 0 0 .92-.6l2.1-4.8a1 1 0 0 1 .92-.6H21" />
      <path d="M3 18h18" />
    </>,
  ),

  // ---- window controls (use strokeWidth 1.2 at 14px) ----------------------------
  Minimize: icon(<path d="M6 12h12" />),
  Maximize: icon(<rect x="6" y="6" width="12" height="12" rx="1.5" />),
  Restore: icon(
    <>
      <rect x="6" y="8.5" width="9.5" height="9.5" rx="1.5" />
      <path d="M8.5 8.5V7.5A1.5 1.5 0 0 1 10 6h6.5A1.5 1.5 0 0 1 18 7.5V14a1.5 1.5 0 0 1-1.5 1.5h-1" />
    </>,
  ),
};

export type IconName = keyof typeof I;
