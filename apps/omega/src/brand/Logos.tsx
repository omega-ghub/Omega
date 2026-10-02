// Omega logo family.
//
// * OmegaMark: the red Ω cutout on a transparent background (dashboard brand).
// * OmegaTile: the red square with the white Ω (window corner logo, OS icon).
// * AppMark:   each app's flat tile in its own color, with its Greek-letter
//              rune drawn in a darker shade of that color. Straight, carved
//              strokes, no font dependency, identical on every OS.
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

/** App marks: a flat tile in the app color with the rune in a darker shade. */
export function AppMark({ app, size = 32, rounded = true, className }: MarkProps & { app: AppKind }) {
  if (app === 'omega') return <OmegaTile size={size} className={className} />;
  const t = THEMES[app];
  return (
    <svg width={size} height={size} viewBox="0 0 1000 1000" className={className} role="img" aria-label={`${t.name} — ${t.category}`}>
      <rect width="1000" height="1000" rx={rounded ? 220 : 0} fill={t.accent} />
      <Rune app={app} color={t.rune} />
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

const STROKE = 88;

/**
 * The app runes: each Greek letter rebuilt from straight, carved strokes —
 * no curves; crossing strokes overshoot slightly like chiselled staves.
 */
function Rune({ app, color }: { app: AppKind; color: string }) {
  const common = { fill: 'none', stroke: color, strokeWidth: STROKE, strokeLinejoin: 'miter' as const, strokeLinecap: 'butt' as const, strokeMiterlimit: 12 };
  switch (app) {
    case 'video':
      // Δ Delta — two staves meeting at a point, cut by an overshooting base
      return (
        <g {...common}>
          <path d="M262 742 L500 262 L738 742" />
          <path d="M214 742 H786" />
        </g>
      );
    case 'image':
      // Φ Phi — a full stave through a diamond
      return (
        <g {...common}>
          <path d="M500 214 V786" />
          <path d="M500 330 L676 500 L500 670 L324 500 Z" />
        </g>
      );
    case 'photo':
      // Γ Gamma — a stave and a beam
      return (
        <g {...common}>
          <path d="M352 786 V262 H712" />
          <path d="M712 216 V352" />
        </g>
      );
    case 'vector':
      // Κ Kappa — a stave with two arms meeting it at one point
      return (
        <g {...common}>
          <path d="M318 226 V774" />
          <path d="M700 238 L360 516 L716 776" />
        </g>
      );
    case 'audio':
      // λ Lambda — a hooked long stave and a short leg
      return (
        <g {...common}>
          <path d="M292 256 H376 L708 760" />
          <path d="M540 506 L320 760" />
        </g>
      );
    case 'motion':
      // τ Tau — a bar and a stave with a kicked foot
      return (
        <g {...common}>
          <path d="M248 332 H752" />
          <path d="M500 332 V640 L604 744 H690" />
        </g>
      );
    case 'three':
      // Θ Theta — a tall six-sided ring with a bar
      return (
        <g {...common}>
          <path d="M500 234 L686 352 V648 L500 766 L314 648 V352 Z" />
          <path d="M314 500 H686" />
        </g>
      );
    case 'web':
      // Ξ Xi — three beams, the middle one short (a layout grid)
      return (
        <g {...common}>
          <path d="M246 282 H754" />
          <path d="M352 500 H648" />
          <path d="M246 718 H754" />
        </g>
      );
    case 'publish':
      // Σ Sigma — a folded beam
      return (
        <g {...common}>
          <path d="M724 274 H300 L540 500 L300 726 H724" />
        </g>
      );
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
