// Brand system. The suite (the hub) is Omega, in red. Each app has its own
// name, a Greek letter that doubles as its icon (the way Adobe uses Pr / Ps),
// and its own accent color, applied as CSS variables via data-app on <html>.
//
// Internal ids ('video', 'image', …) never change; names live only here.

export type AppKind = 'omega' | 'video' | 'audio' | 'image' | 'three' | 'motion';

export interface AppTheme {
  id: AppKind;
  /** Product name shown everywhere, e.g. "Delta". */
  name: string;
  /** What the app is for, shown as a label above the name, e.g. "Video Editing". */
  category: string;
  /** One-word kind, e.g. "Video" (used in default project names). */
  short: string;
  /** The Greek letter used in the icon. */
  letter: string;
  tagline: string;
  accent: string;
  accentDeep: string;
  accentSoft: string; // translucent accent for fills
  /** Very dark tint of the accent, used as the icon tile. */
  tile: string;
  phase: string;
  available: boolean;
}

export const THEMES: Record<AppKind, AppTheme> = {
  omega: {
    id: 'omega',
    name: 'Omega',
    category: 'Creative Suite',
    short: 'Creative Suite',
    letter: 'Ω',
    tagline: 'One creative suite. One engine. One project file.',
    accent: '#FF0000',
    accentDeep: '#B3001B',
    accentSoft: 'rgba(255, 0, 0, 0.14)',
    tile: '#FF0000',
    phase: '',
    available: true,
  },
  video: {
    id: 'video',
    name: 'Delta',
    category: 'Video Editing',
    short: 'Video',
    letter: 'Δ',
    tagline: 'Edit, grade, mix and deliver. Cinema-grade video editing.',
    accent: '#9B6BFF',
    accentDeep: '#6E3BEA',
    accentSoft: 'rgba(155, 107, 255, 0.16)',
    tile: '#170D2E',
    phase: 'Available now (preview)',
    available: true,
  },
  audio: {
    id: 'audio',
    name: 'Lambda',
    category: 'Audio & Podcasts',
    short: 'Audio',
    letter: 'λ',
    tagline: 'Record, mix and repair. Podcasts, music and dialogue.',
    accent: '#FF4FA3',
    accentDeep: '#D61F7A',
    accentSoft: 'rgba(255, 79, 163, 0.16)',
    tile: '#2B0A1C',
    phase: 'Phase 2',
    available: false,
  },
  image: {
    id: 'image',
    name: 'Phi',
    category: 'Photo & Design',
    short: 'Image',
    letter: 'Φ',
    tagline: 'Raster and vector in one canvas. Layers, brushes, type and RAW.',
    accent: '#3D8BFF',
    accentDeep: '#1F5FD6',
    accentSoft: 'rgba(61, 139, 255, 0.16)',
    tile: '#0A1A33',
    phase: 'Phase 3',
    available: false,
  },
  three: {
    id: 'three',
    name: 'Theta',
    category: '3D Modeling',
    short: '3D',
    letter: 'Θ',
    tagline: 'Model, sculpt, texture and render. Scenes drop straight into Delta.',
    accent: '#FF8A1F',
    accentDeep: '#D9620A',
    accentSoft: 'rgba(255, 138, 31, 0.16)',
    tile: '#2E1606',
    phase: 'Phase 4',
    available: false,
  },
  motion: {
    id: 'motion',
    name: 'Tau',
    category: 'Motion Graphics',
    short: 'Motion',
    letter: 'τ',
    tagline: 'Motion graphics and compositing. Nodes or layers, your call.',
    accent: '#2ED47A',
    accentDeep: '#169E55',
    accentSoft: 'rgba(46, 212, 122, 0.16)',
    tile: '#0A2416',
    phase: 'Phase 2',
    available: false,
  },
};

export const WORKSPACE_ORDER: AppKind[] = ['video', 'image', 'audio', 'three', 'motion'];

export function applyTheme(app: AppKind) {
  const t = THEMES[app];
  const root = document.documentElement;
  root.dataset.app = app;
  root.style.setProperty('--accent', t.accent);
  root.style.setProperty('--accent-deep', t.accentDeep);
  root.style.setProperty('--accent-soft', t.accentSoft);
}
