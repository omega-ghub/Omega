// Brand system. The suite is red; each workspace has its own accent so a user
// always knows where they are. Applied as CSS variables via data-app on <html>.

export type AppKind = 'omega' | 'video' | 'audio' | 'image' | 'three' | 'motion';

export interface AppTheme {
  id: AppKind;
  name: string; // product name, e.g. "Omega Video"
  short: string; // e.g. "Video"
  tagline: string;
  accent: string;
  accentDeep: string;
  accentSoft: string; // translucent accent for fills
  phase: string;
  available: boolean;
}

export const THEMES: Record<AppKind, AppTheme> = {
  omega: {
    id: 'omega',
    name: 'Omega',
    short: 'Omega',
    tagline: 'One creative suite. One engine. One project file.',
    accent: '#FF0000',
    accentDeep: '#B3001B',
    accentSoft: 'rgba(255, 0, 0, 0.14)',
    phase: '',
    available: true,
  },
  video: {
    id: 'video',
    name: 'Omega Video',
    short: 'Video',
    tagline: 'Edit, color and finish. Audio and motion live right on the timeline.',
    accent: '#3B7BFF',
    accentDeep: '#1D4ED8',
    accentSoft: 'rgba(59, 123, 255, 0.16)',
    phase: 'Available now (preview)',
    available: true,
  },
  audio: {
    id: 'audio',
    name: 'Omega Audio',
    short: 'Audio',
    tagline: 'Record, mix and repair. Podcasts, music and dialogue.',
    accent: '#19C37D',
    accentDeep: '#0E8F5B',
    accentSoft: 'rgba(25, 195, 125, 0.16)',
    phase: 'Phase 2',
    available: false,
  },
  image: {
    id: 'image',
    name: 'Omega Image',
    short: 'Image',
    tagline: 'Raster and vector in one canvas. Layers, brushes, type and RAW.',
    accent: '#FF9F1C',
    accentDeep: '#D97706',
    accentSoft: 'rgba(255, 159, 28, 0.16)',
    phase: 'Phase 3',
    available: false,
  },
  three: {
    id: 'three',
    name: 'Omega 3D',
    short: '3D',
    tagline: 'Model, sculpt, texture and render. Scenes drop straight into video.',
    accent: '#8B5CF6',
    accentDeep: '#6D28D9',
    accentSoft: 'rgba(139, 92, 246, 0.16)',
    phase: 'Phase 4',
    available: false,
  },
  motion: {
    id: 'motion',
    name: 'Omega Motion',
    short: 'Motion',
    tagline: 'Motion graphics and compositing. Nodes or layers, your call.',
    accent: '#F43F8E',
    accentDeep: '#BE185D',
    accentSoft: 'rgba(244, 63, 142, 0.16)',
    phase: 'Phase 2',
    available: false,
  },
};

export const WORKSPACE_ORDER: AppKind[] = ['video', 'audio', 'image', 'three', 'motion'];

export function applyTheme(app: AppKind) {
  const t = THEMES[app];
  const root = document.documentElement;
  root.dataset.app = app;
  root.style.setProperty('--accent', t.accent);
  root.style.setProperty('--accent-deep', t.accentDeep);
  root.style.setProperty('--accent-soft', t.accentSoft);
}
