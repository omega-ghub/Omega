// Omega logo family.
//
// * OmegaMark: the red Ω cutout on a transparent background (dashboard brand).
// * OmegaTile: the red square with the white Ω (window corner logo, OS icon).
// * AppMark:   each app built like the Omega tile: a flat square in the app's
//              color with its Greek-letter rune in white, matching the Ω's
//              footprint and weight. Straight strokes, no font dependency.
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
export function OmegaTile({ size = 32, rounded = true, className, title = 'Omega' }: MarkProps) {
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
export function AppMark({ app, size = 32, rounded = true, className }: MarkProps & { app: AppKind }) {
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
 * Rune weights and footprint come straight from the Ω in the Omega tile
 * (1932-unit artwork scaled to 1000): the Ω fills the square 256–744, its
 * ring is 294/1932 = 152 units thick and its feet are 192/1932 = 99 units.
 * Main strokes use the ring weight, secondary strokes the foot weight, and
 * everything is clipped to the Ω's square so ends are cut flat like its feet.
 */
const MAIN = 152;
const THIN = 99;

function Rune({ app, color }: { app: AppKind; color: string }) {
  const clip = `rune-box-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const s = { fill: 'none', stroke: color, strokeLinejoin: 'miter' as const, strokeLinecap: 'butt' as const, strokeMiterlimit: 2.2 };
  const main = { ...s, strokeWidth: MAIN };
  const thin = { ...s, strokeWidth: THIN };
  let body: React.ReactNode = null;
  switch (app) {
    case 'video':
      // Δ Delta — a sharp carved triangle, walls at the Ω's foot weight
      body = <path fill={color} fillRule="evenodd" d="M500 256 L744 744 H256 Z M500 477 L584 645 H416 Z" />;
      break;
    case 'image':
      // Φ Phi — a heavy stave through a thin carved ring
      body = (
        <>
          <path {...thin} d="M410 356 H590 L694 440 V560 L590 644 H410 L306 560 V440 Z" />
          <path {...main} d="M500 200 V800" />
        </>
      );
      break;
    case 'photo':
      // Γ Gamma — heavy stave, thin beam
      body = (
        <>
          <path {...main} d="M332 800 V200" />
          <path {...thin} d="M256 305.5 H800" />
        </>
      );
      break;
    case 'vector':
      // Κ Kappa — heavy stave, thin arms
      body = (
        <>
          <path {...main} d="M332 200 V800" />
          <path {...thin} d="M820 200 L420 500 L820 800" />
        </>
      );
      break;
    case 'audio':
      // λ Lambda — thin hook, heavy long stave, thin leg
      body = (
        <>
          <path {...thin} d="M200 305.5 H420" />
          <path {...main} d="M350 230 L760 800" />
          <path {...thin} d="M560 520 L280 820" />
        </>
      );
      break;
    case 'motion':
      // τ Tau — thin beam, heavy stave, foot kicking right
      body = (
        <>
          <path {...thin} d="M200 305.5 H800" />
          <path {...main} d="M470 256 V744" />
          <path {...thin} d="M500 694.5 H744" />
        </>
      );
      break;
    case 'three':
      // Θ Theta — thin carved ring, heavy bar
      body = (
        <>
          <path {...thin} d="M410 305.5 H590 L694.5 410 V590 L590 694.5 H410 L305.5 590 V410 Z" />
          <path {...main} d="M300 500 H700" />
        </>
      );
      break;
    case 'web':
      // Ξ Xi — thin outer beams, heavy middle beam
      body = (
        <>
          <path {...thin} d="M200 305.5 H800" />
          <path {...main} d="M330 500 H670" />
          <path {...thin} d="M200 694.5 H800" />
        </>
      );
      break;
    case 'publish':
      // Σ Sigma — thin beams, heavy fold
      body = (
        <>
          <path {...thin} d="M256 305.5 H800" />
          <path {...thin} d="M256 694.5 H800" />
          <path {...main} strokeMiterlimit={1.6} d="M300 290 L548 500 L300 710" />
        </>
      );
      break;
  }
  return (
    <>
      <defs>
        <clipPath id={clip}>
          <rect x="256" y="256" width="488" height="488" />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clip})`}>{body}</g>
    </>
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
