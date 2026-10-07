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
/**
 * The runes, rebuilt from the founder's final logo sheet and measured on the
 * Ω's 1000-unit grid: every rune fills the Ω's square (250–750), main strokes
 * are 150 wide and secondary strokes 94 wide (the Ω's ring and feet).
 */
const RUNES: Partial<Record<AppKind, { d: string; rule?: 'evenodd' | 'nonzero' }>> = {
  // Δ Delta — carved triangle: thin left side and base, thick right side
  video: { d: 'M500 250 L750 750 H250 Z M472 517 L402.5 656 H541.5 Z', rule: 'evenodd' },
  // Λ Lambda — open chevron: thin left leg, thick right leg
  image: { d: 'M500 250 L750 750 H586 L470 515 L356 750 H250 Z' },
  // Γ Gamma — heavy stave and beam
  photo: { d: 'M250 250 H700 V400 H400 V750 H250 Z' },
  // Κ Kappa — stave with two arms
  vector: { d: 'M250 250 H400 V384 L498 250 H685 L559 421 L750 675 V750 H619 L466 547 L400 638 V750 H250 Z' },
  // Ψ Psi — a bowl with three stems
  audio: {
    d: 'M250 250 H344 V383 A156 156 0 0 0 656 383 V250 H750 V383 A250 250 0 0 1 250 383 Z M425 250 H575 V750 H425 Z',
  },
  // Τ Tau — a bar and a stem
  motion: { d: 'M250 250 H750 V400 H575 V750 H425 V400 H250 Z' },
  // Θ Theta — a round ring cut by a heavy bar
  three: {
    d: 'M500 250 A250 250 0 1 1 500 750 A250 250 0 1 1 500 250 Z M361 425 A158 158 0 0 1 639 425 Z M639 575 A158 158 0 0 1 361 575 Z',
    rule: 'evenodd',
  },
  // Φ Phi — a heavy stave through an oval ring
  web: {
    d: 'M250 500 A250 180 0 1 1 750 500 A250 180 0 1 1 250 500 Z M344 500 A156 84 0 1 0 656 500 A156 84 0 1 0 344 500 Z M425 250 H575 V750 H425 Z',
  },
  // Σ Sigma — two thin beams joined by a heavy fold
  publish: { d: 'M250 250 H750 V344 H463 L619 500 L463 656 H750 V750 H250 V656 L406 500 L250 344 Z' },
};

function Rune({ app, color }: { app: AppKind; color: string }) {
  const r = RUNES[app];
  if (!r) return null;
  return <path d={r.d} fill={color} fillRule={r.rule ?? 'nonzero'} />;
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
