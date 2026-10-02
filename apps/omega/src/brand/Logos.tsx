// Omega logo family.
//
// The suite mark is the red Ω cutout (no tile). Each app mark is a dark tile tinted with
// the app's color, a hairline accent border, and the app's Greek letter
// drawn as a rune: straight carved strokes, no font dependency, identical on
// every OS. Like Adobe's Pr / Ps tiles, the rune is the recognizable part, and
// the UI always shows the category ("Video") next to the name.

import type { AppKind } from './themes';
import { THEMES } from './themes';

export interface MarkProps {
  size?: number;
  rounded?: boolean;
  className?: string;
  title?: string;
}

/**
 * The Omega cutout: the red Ω keyhole on a transparent background, traced
 * from the founder's master artwork (resources/omega-cutout.png, 1932 px).
 * Used for the dashboard brand and the hub's title-bar corner logo.
 */
export const OMEGA_CUTOUT_PATH =
  'M173 1771 V1437 H330 A792 792 0 1 1 1601 1437 H1758 V1771 H1064 V1218 A272 272 0 1 0 864 1218 V1771 Z';

export function OmegaMark({ size = 32, className, title = 'Omega', color = '#FF0000' }: MarkProps & { color?: string }) {
  return (
    <svg width={size} height={size} viewBox="150 150 1632 1632" className={className} role="img" aria-label={title}>
      <path d={OMEGA_CUTOUT_PATH} fill={color} />
    </svg>
  );
}

/** App marks: tinted tile + accent border + Greek letter. */
export function AppMark({ app, size = 32, rounded = true, className }: MarkProps & { app: AppKind }) {
  if (app === 'omega') return <OmegaMark size={size} rounded={rounded} className={className} />;
  const t = THEMES[app];
  const r = rounded ? 200 : 0;
  const gid = `mark-${app}-${size}`;
  return (
    <svg width={size} height={size} viewBox="0 0 1000 1000" className={className} role="img" aria-label={`${t.name} — ${t.category}`}>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={t.tile} />
          <stop offset="1" stopColor="#07070a" />
        </linearGradient>
      </defs>
      <rect width="1000" height="1000" rx={r} fill={`url(#${gid})`} />
      <rect x="16" y="16" width="968" height="968" rx={Math.max(0, r - 16)} fill="none" stroke={t.accent} strokeOpacity="0.85" strokeWidth="32" />
      <Letter app={app} color={t.accent} />
    </svg>
  );
}

const STROKE = 84;

/**
 * The app runes: each Greek letter rebuilt from straight, carved strokes —
 * no curves, crossing strokes overshoot slightly like chiselled staves.
 */
function Letter({ app, color }: { app: AppKind; color: string }) {
  const common = { fill: 'none', stroke: color, strokeWidth: STROKE, strokeLinejoin: 'miter' as const, strokeLinecap: 'butt' as const, strokeMiterlimit: 12 };
  switch (app) {
    case 'video':
      // Δ  Delta — two staves meeting at a point, cut by an overshooting base
      return (
        <g {...common}>
          <path d="M262 742 L500 262 L738 742" />
          <path d="M214 742 H786" />
        </g>
      );
    case 'image':
      // Φ  Phi — a full stave through a diamond
      return (
        <g {...common}>
          <path d="M500 214 V786" />
          <path d="M500 330 L676 500 L500 670 L324 500 Z" />
        </g>
      );
    case 'audio':
      // λ  Lambda — a hooked long stave and a short leg
      return (
        <g {...common}>
          <path d="M292 256 H376 L708 760" />
          <path d="M540 506 L320 760" />
        </g>
      );
    case 'three':
      // Θ  Theta — a tall six-sided ring with a bar
      return (
        <g {...common}>
          <path d="M500 234 L686 352 V648 L500 766 L314 648 V352 Z" />
          <path d="M314 500 H686" />
        </g>
      );
    case 'motion':
      // τ  Tau — a bar and a stave with a kicked foot
      return (
        <g {...common}>
          <path d="M248 332 H752" />
          <path d="M500 332 V640 L604 744 H690" />
        </g>
      );
    default:
      return null;
  }
}

/**
 * App name with its category as a small label above it ("VIDEO" over
 * "Delta"), so the rune never has to explain itself.
 */
export function AppTitle({ app, size = 'md', className = '' }: { app: AppKind; size?: 'sm' | 'md' | 'lg'; className?: string }) {
  const t = THEMES[app];
  return (
    <span className={`app-title app-title--${size} ${className}`}>
      <span className="app-title__cat">{t.category}</span>
      <span className="app-title__name">{t.name}</span>
    </span>
  );
}

/** Mark plus product name (and optional category). */
export function OmegaWordmark({ size = 28, app = 'omega', withCategory = false }: { size?: number; app?: AppKind; withCategory?: boolean }) {
  const t = THEMES[app];
  return (
    <span className="wordmark" style={{ gap: size * 0.4 }}>
      <AppMark app={app} size={size} />
      <span className="wordmark__text" style={{ fontSize: size * 0.72 }}>
        {t.name}
        {withCategory && <span className="wordmark__cat"> {t.category}</span>}
      </span>
    </span>
  );
}
