// Brand system. The suite (the hub) is Omega, in red. Each app has its own
// name, a Greek-letter rune that is its icon, and its own flat color, applied
// as CSS variables via data-app on <html>.
//
// App icons follow the Omega tile: a flat square in the app's color with the
// rune in white (src/brand/Logos.tsx). The palette spans the whole rainbow,
// red (Omega) → orange → yellow → green → teal → cyan → blue → indigo →
// violet → pink.
//
// Internal ids ('video', 'image', …) never change; names live only here.

export type AppKind = 'omega' | 'video' | 'image' | 'photo' | 'vector' | 'audio' | 'motion' | 'three' | 'web' | 'publish';

export interface AppTheme {
  id: AppKind;
  /** Product name shown everywhere, e.g. "Delta". */
  name: string;
  /** One formal line describing what the app is for (shown under the name). */
  description: string;
  /** Category, used for accessibility labels and default project names. */
  category: string;
  /** One-word kind, e.g. "Video" (used in default project names). */
  short: string;
  /** The Greek letter the rune is based on. */
  letter: string;
  tagline: string;
  /** The app color: flat icon tile, accents inside the app. */
  accent: string;
  accentDeep: string;
  accentSoft: string; // translucent accent for fills
  /** Rune color on the tile (white, like the Ω on the Omega tile). */
  rune: string;
  /** @deprecated kept for older call sites; same as `accent`. */
  tile: string;
  phase: string;
  available: boolean;
}

function app(t: Omit<AppTheme, 'tile'>): AppTheme {
  return { ...t, tile: t.accent };
}

export const THEMES: Record<AppKind, AppTheme> = {
  omega: app({
    id: 'omega',
    name: 'Omega',
    description: 'The creative suite.',
    category: 'Creative Suite',
    short: 'Creative Suite',
    letter: 'Ω',
    tagline: 'One creative suite. One engine. One project file.',
    accent: '#FF0000',
    accentDeep: '#B3001B',
    accentSoft: 'rgba(255, 0, 0, 0.14)',
    rune: '#FFFFFF',
    phase: '',
    available: true,
  }),
  video: app({
    id: 'video',
    name: 'Delta',
    description: 'Professional video editing, color grading and finishing.',
    category: 'Video Editing',
    short: 'Video',
    letter: 'Δ',
    tagline: 'Edit, grade, mix and deliver. Cinema-grade video editing.',
    accent: '#8A4DFF',
    accentDeep: '#6A2EE0',
    accentSoft: 'rgba(138, 77, 255, 0.16)',
    rune: '#FFFFFF',
    phase: 'Available now (preview)',
    available: true,
  }),
  image: app({
    id: 'image',
    name: 'Phi',
    description: 'Image editing and compositing for photography and design.',
    category: 'Image Editing',
    short: 'Image',
    letter: 'Φ',
    tagline: 'Layers, masks, brushes and type on a GPU canvas.',
    accent: '#2F6BFF',
    accentDeep: '#1C4FD6',
    accentSoft: 'rgba(47, 107, 255, 0.16)',
    rune: '#FFFFFF',
    phase: 'Phase 3',
    available: false,
  }),
  photo: app({
    id: 'photo',
    name: 'Gamma',
    description: 'Photo library, RAW development and batch editing.',
    category: 'Photo Development',
    short: 'Photo',
    letter: 'Γ',
    tagline: 'Organize, develop and deliver entire shoots.',
    accent: '#00A3E0',
    accentDeep: '#0081B3',
    accentSoft: 'rgba(0, 163, 224, 0.16)',
    rune: '#FFFFFF',
    phase: 'Phase 3',
    available: false,
  }),
  vector: app({
    id: 'vector',
    name: 'Kappa',
    description: 'Vector illustration, logo and brand identity design.',
    category: 'Vector Design',
    short: 'Vector',
    letter: 'Κ',
    tagline: 'Precise paths, type and brand systems that scale to any size.',
    accent: '#F5B300',
    accentDeep: '#C98F00',
    accentSoft: 'rgba(245, 179, 0, 0.16)',
    rune: '#FFFFFF',
    phase: 'Phase 3',
    available: false,
  }),
  audio: app({
    id: 'audio',
    name: 'Lambda',
    description: 'Audio recording, editing, mixing and restoration.',
    category: 'Audio Editing',
    short: 'Audio',
    letter: 'λ',
    tagline: 'Record, mix and repair. Podcasts, music and dialogue.',
    accent: '#F0328C',
    accentDeep: '#C71A6C',
    accentSoft: 'rgba(240, 50, 140, 0.16)',
    rune: '#FFFFFF',
    phase: 'Phase 2',
    available: false,
  }),
  motion: app({
    id: 'motion',
    name: 'Tau',
    description: 'Motion graphics, animation and visual effects compositing.',
    category: 'Motion Graphics',
    short: 'Motion',
    letter: 'τ',
    tagline: 'Keyframes, shape layers and compositing, by layers or nodes.',
    accent: '#19B954',
    accentDeep: '#0F8F3F',
    accentSoft: 'rgba(25, 185, 84, 0.16)',
    rune: '#FFFFFF',
    phase: 'Phase 2',
    available: false,
  }),
  three: app({
    id: 'three',
    name: 'Theta',
    description: '3D modeling, sculpting, texturing and rendering.',
    category: '3D Modeling',
    short: '3D',
    letter: 'Θ',
    tagline: 'Model, sculpt, texture and render. Scenes drop straight into Delta.',
    accent: '#FF6B00',
    accentDeep: '#D45400',
    accentSoft: 'rgba(255, 107, 0, 0.16)',
    rune: '#FFFFFF',
    phase: 'Phase 4',
    available: false,
  }),
  web: app({
    id: 'web',
    name: 'Xi',
    description: 'Website, interface and interactive prototype design.',
    category: 'Web & UI Design',
    short: 'Web',
    letter: 'Ξ',
    tagline: 'Design responsive sites and apps, then publish or hand off.',
    accent: '#00B2A9',
    accentDeep: '#008A83',
    accentSoft: 'rgba(0, 178, 169, 0.16)',
    rune: '#FFFFFF',
    phase: 'Phase 4',
    available: false,
  }),
  publish: app({
    id: 'publish',
    name: 'Sigma',
    description: 'Page layout and publishing for print and digital.',
    category: 'Layout & Publishing',
    short: 'Layout',
    letter: 'Σ',
    tagline: 'Books, magazines, decks and PDFs with real typography.',
    accent: '#4F46E5',
    accentDeep: '#3A32C4',
    accentSoft: 'rgba(79, 70, 229, 0.18)',
    rune: '#FFFFFF',
    phase: 'Phase 5',
    available: false,
  }),
};

/** Display order in the hub. */
export const WORKSPACE_ORDER: AppKind[] = ['video', 'image', 'photo', 'vector', 'audio', 'motion', 'three', 'web', 'publish'];

export function applyTheme(kind: AppKind) {
  const t = THEMES[kind];
  const root = document.documentElement;
  root.dataset.app = kind;
  root.style.setProperty('--accent', t.accent);
  root.style.setProperty('--accent-deep', t.accentDeep);
  root.style.setProperty('--accent-soft', t.accentSoft);
}
