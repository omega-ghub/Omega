// Omega logo family.
//
// The master mark is the Ω "keyhole": a white disc with a round cut-out and a
// slot running down to the feet. Every workspace mark keeps the same disc and
// feet, but the cut-out carries a glyph for that workspace. Together they read
// as one family at a glance, and each one stands alone in a dock or taskbar.

import type { AppKind } from './themes';
import { THEMES } from './themes';

export interface MarkProps {
  size?: number;
  rounded?: boolean;
  className?: string;
  title?: string;
}

/** The master Omega mark, reproduced from the brand logo (red square, white Ω keyhole). */
export function OmegaMark({ size = 32, rounded = true, className, title = 'Omega' }: MarkProps) {
  const r = rounded ? 180 : 0;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 1000 1000"
      className={className}
      role="img"
      aria-label={title}
    >
      <rect width="1000" height="1000" rx={r} fill="#FF0000" />
      <OmegaGlyph fill="#fff" cut="#FF0000" />
    </svg>
  );
}

/**
 * The bare Ω keyhole shape (disc + feet with the cut-out), used by every mark.
 * `cut` is the background color that shows through the keyhole.
 */
function OmegaGlyph({ fill, cut, children }: { fill: string; cut: string; children?: React.ReactNode }) {
  return (
    <g>
      {/* disc */}
      <circle cx="500" cy="500" r="244" fill={fill} />
      {/* feet */}
      <rect x="256" y="648" width="488" height="100" fill={fill} />
      {/* keyhole cut-out: round opening + slot down through the feet */}
      {children ?? (
        <>
          <circle cx="500" cy="508" r="92" fill={cut} />
          <rect x="469" y="508" width="62" height="240" fill={cut} />
        </>
      )}
    </g>
  );
}

/** Workspace marks: same construction, with a glyph in the keyhole. */
export function AppMark({ app, size = 32, rounded = true, className }: MarkProps & { app: AppKind }) {
  if (app === 'omega') return <OmegaMark size={size} rounded={rounded} className={className} />;
  const t = THEMES[app];
  const r = rounded ? 180 : 0;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 1000 1000"
      className={className}
      role="img"
      aria-label={t.name}
    >
      <defs>
        <linearGradient id={`mark-${app}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={t.accent} />
          <stop offset="1" stopColor={t.accentDeep} />
        </linearGradient>
      </defs>
      <rect width="1000" height="1000" rx={r} fill={`url(#mark-${app})`} />
      <OmegaGlyph fill="#fff" cut={t.accent}>
        <rect x="469" y="560" width="62" height="188" fill={t.accentDeep} opacity="0.9" />
        <AppGlyph app={app} color={t.accentDeep} />
      </OmegaGlyph>
    </svg>
  );
}

/** The glyph that sits inside the disc for each workspace. Centered on (500, 500). */
function AppGlyph({ app, color }: { app: AppKind; color: string }) {
  switch (app) {
    case 'video':
      // play triangle
      return <path d="M430 400 L612 500 L430 600 Z" fill={color} />;
    case 'audio':
      // waveform bars
      return (
        <g fill={color}>
          <rect x="392" y="470" width="34" height="60" rx="17" />
          <rect x="446" y="420" width="34" height="160" rx="17" />
          <rect x="500" y="380" width="34" height="240" rx="17" />
          <rect x="554" y="440" width="34" height="120" rx="17" />
        </g>
      );
    case 'image':
      // aperture ring
      return (
        <g fill="none" stroke={color} strokeWidth="46" strokeLinecap="round">
          <circle cx="500" cy="500" r="92" />
          <path d="M500 350 V300 M500 650 V700 M350 500 H300 M650 500 H700" />
        </g>
      );
    case 'three':
      // isometric cube
      return (
        <g fill={color}>
          <path d="M500 380 L612 445 L500 510 L388 445 Z" />
          <path d="M388 445 L500 510 L500 640 L388 575 Z" opacity="0.75" />
          <path d="M612 445 L500 510 L500 640 L612 575 Z" opacity="0.55" />
        </g>
      );
    case 'motion':
      // keyframe diamond with a motion path
      return (
        <g fill={color}>
          <path d="M500 390 L600 500 L500 610 L400 500 Z" />
          <circle cx="360" cy="420" r="26" opacity="0.6" />
          <circle cx="640" cy="580" r="26" opacity="0.6" />
        </g>
      );
    default:
      return null;
  }
}

/** Wordmark: the mark plus "Omega" in the brand type. */
export function OmegaWordmark({ size = 28, app = 'omega' }: { size?: number; app?: AppKind }) {
  const t = THEMES[app];
  return (
    <span className="wordmark" style={{ gap: size * 0.4 }}>
      <AppMark app={app} size={size} />
      <span className="wordmark__text" style={{ fontSize: size * 0.72 }}>
        {t.name}
      </span>
    </span>
  );
}
