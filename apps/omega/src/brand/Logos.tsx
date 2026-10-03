// Omega logo family.
//
// * OmegaMark: the red Ω cutout on a transparent background (dashboard brand).
// * OmegaTile: the red square with the white Ω (window corner logo, OS icon).
// * AppMark:   each app built like the Omega tile: a flat, square-cornered
//              tile in the app's color with its uppercase Greek-letter rune in
//              white, matching the Ω's footprint and stroke weights.
// * AppTitle:  the app name with one formal line saying what it is for.

import { useId } from 'react';
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
      <rect width="1932" height="1932" rx={rounded ? 174 : 0} fill="#FF0000" />
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
      <rect width="1000" height="1000" rx={rounded ? 90 : 0} fill={t.accent} />
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
 * Rune geometry is the shipping icon set, drawn on a 128-unit tile where the
 * Ω fills the square 32–96 (ring 19 units thick, feet 12 units). Main strokes
 * use the ring weight (19), secondary strokes the foot weight (12). Every
 * rune is clipped to the Ω's square, and corners are sharp unless the letter
 * itself is round. The 128-unit artwork is mapped onto the 1000-unit tile
 * (square 256–744) with a scale of 7.625.
 */
const ICON_TO_TILE = 'matrix(7.625 0 0 7.625 12 12)';

function Rune({ app, color }: { app: AppKind; color: string }) {
  const clip = `rune-box-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  let body: React.ReactNode = null;
  switch (app) {
    case 'three':
      // Θ Theta
      body = (
        <>
          <circle cx="64" cy="64" r="26" fill="none" stroke={color} strokeWidth="12"/>
          <rect x="40" y="54.5" width="48" height="19"/>
        </>
      );
      break;
    case 'vector':
      // Κ Kappa
      body = (
        <>
          <rect x="32" y="32" width="19" height="64"/>
          <polyline points="44,74 84,22" fill="none" stroke={color} strokeWidth="19"/>
          <polyline points="60,56 98,104" fill="none" stroke={color} strokeWidth="19"/>
        </>
      );
      break;
    case 'motion':
      // Τ Tau
      body = (
        <>
          <rect x="32" y="32" width="64" height="19"/>
          <rect x="54.5" y="32" width="19" height="64"/>
        </>
      );
      break;
    case 'web':
      // Ψ Psi
      body = (
        <>
          <rect x="54.5" y="32" width="19" height="64"/>
          <path d="M38,32 V50 A26,26 0 0 0 90,50 V32" fill="none" stroke={color} strokeWidth="12"/>
        </>
      );
      break;
    case 'photo':
      // Γ Gamma
      body = (
        <>
          <rect x="32" y="32" width="19" height="64"/>
          <rect x="32" y="32" width="58" height="19"/>
        </>
      );
      break;
    case 'image':
      // Λ Lambda
      body = (
        <>
          <path d="M64.00,32.00 L96.00,96.00 L74.76,96.00 L60.09,66.66 L45.42,96.00 L32.00,96.00 Z"/>
        </>
      );
      break;
    case 'publish':
      // Σ Sigma
      body = (
        <>
          <rect x="32" y="32" width="64" height="12"/>
          <rect x="32" y="84" width="64" height="12"/>
          <polyline points="30,30 66,64 30,98" fill="none" stroke={color} strokeWidth="19" strokeLinejoin="miter" strokeMiterlimit="10"/>
        </>
      );
      break;
    case 'video':
      // Δ Delta
      body = (
        <>
          <path fillRule="evenodd" d="M64.00,32.00 L96.00,96.00 L32.00,96.00 Z M60.09,66.66 L51.42,84.00 L68.76,84.00 Z"/>
        </>
      );
      break;
    case 'audio':
      // Φ Phi
      body = (
        <>
          <ellipse cx="64" cy="64" rx="26" ry="17" fill="none" stroke={color} strokeWidth="12"/>
          <rect x="54.5" y="32" width="19" height="64"/>
        </>
      );
      break;
  }
  return (
    <g transform={ICON_TO_TILE}>
      <defs>
        <clipPath id={clip}>
          <rect x="32" y="32" width="64" height="64" />
        </clipPath>
      </defs>
      <g fill={color} clipPath={`url(#${clip})`}>
        {body}
      </g>
    </g>
  );
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
