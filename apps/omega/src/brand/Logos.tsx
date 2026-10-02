// Omega logo family.
//
// * OmegaMark: the red Ω cutout on a transparent background (dashboard brand).
// * OmegaTile: the red square with the white Ω (window corner logo, OS icon).
// * AppMark:   each app built like the Omega tile: a flat square in the app's
//              color with its Greek-letter rune in white, matching the Ω's
//              footprint and weight. Straight strokes, no font dependency.
// * AppTitle:  the app name with one formal line saying what it is for.

import type { AppKind } from './themes';
import { THEMES } from './themes';

export interface MarkProps {
  size?: number;
  rounded?: boolean;
  className?: string;
  title?: string;
}

/**
 * The Omega cutout, traced from the founder's master artwork
 * (resources/omega-cutout.png, 1932 px).
 */
export const OMEGA_CUTOUT_PATH =
  'M173 1771 V1437 H330 A792 792 0 1 1 1601 1437 H1758 V1771 H1064 V1218 A272 272 0 1 0 864 1218 V1771 Z';

/**
 * The Ω inside the red tile, traced from resources/icon.png (1932 px):
 * outer radius 472, keyhole radius 178, slot 119 wide, feet 192 tall.
 */
export const OMEGA_TILE_PATH =
  'M494 1437 V1245 H586 A472 472 0 1 1 1344 1245 H1437 V1437 H1025 V1133 A178 178 0 1 0 906 1133 V1437 Z';

export function OmegaMark({ size = 32, className, title = 'Omega', color = '#FF0000' }: MarkProps & { color?: string }) {
  return (
    <svg width={size} height={size} viewBox="150 150 1632 1632" className={className} role="img" aria-label={title}>
      <path d={OMEGA_CUTOUT_PATH} fill={color} />
    </svg>
  );
}

/** The red square with the white Ω — the window corner logo. */
export function OmegaTile({ size = 32, rounded = false, className, title = 'Omega' }: MarkProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 1932 1932" className={className} role="img" aria-label={title}>
      <rect width="1932" height="1932" rx={rounded ? 320 : 0} fill="#FF0000" />
      <path d={OMEGA_TILE_PATH} fill="#FFFFFF" />
    </svg>
  );
}

/**
 * App marks, built exactly like the Omega tile: a flat square in the app's
 * color with its rune in white, the same footprint and stroke weight as the Ω.
 */
export function AppMark({ app, size = 32, rounded = false, className }: MarkProps & { app: AppKind }) {
  if (app === 'omega') return <OmegaTile size={size} rounded={rounded} className={className} />;
  const t = THEMES[app];
  return (
    <svg width={size} height={size} viewBox="0 0 1000 1000" className={className} role="img" aria-label={`${t.name} — ${t.category}`}>
      <rect width="1000" height="1000" rx={rounded ? 166 : 0} fill={t.accent} />
      <Rune app={app} color="#FFFFFF" />
    </svg>
  );
}

/** Just the rune, for places that draw their own background. */
export function AppRune({ app, size = 24, color, className }: { app: AppKind; size?: number; color?: string; className?: string }) {
  if (app === 'omega') return <OmegaMark size={size} className={className} color={color} />;
  const t = THEMES[app];
  return (
    <svg width={size} height={size} viewBox="150 150 700 700" className={className} role="img" aria-label={t.name}>
      <Rune app={app} color={color ?? t.accent} />
    </svg>
  );
}

/**
 * Rune weight and footprint match the Ω in the Omega tile: the Ω occupies
 * the middle 49% of its tile (25.6%–74.4%) and its strokes are 10–15% of the
 * tile wide, so runes sit in 256–744 with 120-unit strokes.
 */
const STROKE = 120;

/**
 * The app runes: each Greek letter rebuilt from straight, carved strokes —
 * no curves, heavy and square-cut like the Ω.
 */
function Rune({ app, color }: { app: AppKind; color: string }) {
  const common = { fill: 'none', stroke: color, strokeWidth: STROKE, strokeLinejoin: 'miter' as const, strokeLinecap: 'butt' as const, strokeMiterlimit: 2.2 };
  switch (app) {
    case 'video':
      // Δ Delta
      return <path {...common} d="M500 312 L704 700 L296 700 Z" />;
    case 'image':
      // Φ Phi — a full stave through a wide carved ring
      return (
        <g {...common}>
          <path d="M500 256 V744" />
          <path d="M420 362 H580 L684 446 V554 L580 638 H420 L316 554 V446 Z" />
        </g>
      );
    case 'photo':
      // Γ Gamma — a stave and a beam
      return <path {...common} d="M380 744 V316 H684" />;
    case 'vector':
      // Κ Kappa — a stave and two arms
      return (
        <g {...common}>
          <path d="M344 256 V744" />
          <path d="M692 268 L420 500 L692 732" />
        </g>
      );
    case 'audio':
      // λ Lambda — a hooked long stave and a short leg
      return (
        <g {...common}>
          <path d="M286 316 H388 L702 744" />
          <path d="M532 512 L322 744" />
        </g>
      );
    case 'motion':
      // τ Tau — a beam and a stave with a kicked foot
      return (
        <g {...common}>
          <path d="M256 330 H744" />
          <path d="M500 330 V614 L590 704 H668" />
        </g>
      );
    case 'three':
      // Θ Theta — a tall carved ring with a bar
      return (
        <g {...common}>
          <path d="M432 316 H568 L684 432 V568 L568 684 H432 L316 568 V432 Z" />
          <path d="M316 500 H684" />
        </g>
      );
    case 'web':
      // Ξ Xi — three beams, the middle one short (a layout grid)
      return (
        <g {...common}>
          <path d="M256 316 H744" />
          <path d="M356 500 H644" />
          <path d="M256 684 H744" />
        </g>
      );
    case 'publish':
      // Σ Sigma — a folded beam
      return <path {...common} d="M712 316 H312 L520 500 L312 684 H712" />;
    default:
      return null;
  }
}

/**
 * App name with one formal line saying what it is for. `size="sm"` shows the
 * name only (title bars, tight lists).
 */
export function AppTitle({ app, size = 'md', className = '', describe }: { app: AppKind; size?: 'sm' | 'md' | 'lg'; className?: string; describe?: boolean }) {
  const t = THEMES[app];
  const showDesc = describe ?? size !== 'sm';
  return (
    <span className={`app-title app-title--${size} ${className}`}>
      <span className="app-title__name">{t.name}</span>
      {showDesc && <span className="app-title__desc">{t.description}</span>}
    </span>
  );
}

/** Mark plus product name. */
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
