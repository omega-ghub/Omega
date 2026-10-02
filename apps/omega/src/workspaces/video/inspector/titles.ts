// Title templates: presets of text / shape / solid / gradient layers placed
// on stacked video tracks at the playhead (bottom layer first).

import { useEditor } from '../../../state/store';
import { defaultShapeProps, defaultTextProps, makeClip, makeTrack } from '../../../state/defaults';
import { activeSequence, type Clip, type Project, type Sequence, type ShapeProps, type TextProps, type Track } from '../../../state/types';
import { addGeneratedClip, addTrack } from '../../../engine/edit/ops';
import { snapToFrame } from '../../../engine/time';

export type TitleLayerKind = 'text' | 'shape' | 'solid' | 'gradient';

export interface TitleLayer {
  kind: TitleLayerKind;
  /** Seconds after the title start (default 0). */
  offset?: number;
  /** Seconds (default: the template duration minus the offset). */
  duration?: number;
  init: Partial<Clip>;
}

export interface TitleTemplate {
  id: string;
  name: string;
  description: string;
  duration: number;
  /** Layers for a W×H sequence, bottom first. */
  layers(W: number, H: number): TitleLayer[];
}

const ACCENT = '#8f6bff';
const INTER = 'Inter Variable, Inter, system-ui, sans-serif';
const SERIF = 'Georgia, Times New Roman, serif';

type TextPatch = Partial<Omit<TextProps, 'stroke' | 'shadow' | 'background' | 'animation'>> & {
  stroke?: Partial<TextProps['stroke']>;
  shadow?: Partial<TextProps['shadow']>;
  background?: Partial<TextProps['background']>;
  animation?: Partial<TextProps['animation']>;
};

function text(content: string, patch: TextPatch): TextProps {
  const base = defaultTextProps(content);
  const { animation, stroke, shadow, background, ...rest } = patch;
  return {
    ...base,
    ...rest,
    font: rest.font ?? INTER,
    stroke: { ...base.stroke, ...stroke },
    shadow: { ...base.shadow, ...shadow },
    background: { ...base.background, ...background },
    animation: { ...base.animation, ...animation },
  };
}

function shape(patch: Partial<ShapeProps>): ShapeProps {
  const base = defaultShapeProps();
  return { ...base, ...patch, fill: { ...base.fill, ...patch.fill }, stroke: { ...base.stroke, ...patch.stroke } };
}

function at(x: number, y: number, extra: Partial<Clip['transform']> = {}): Partial<Clip> {
  return { transform: { x, y, scale: 1, scaleX: 1, scaleY: 1, rotation: 0, anchorX: 0, anchorY: 0, opacity: 1, flipH: false, flipV: false, fit: 'fit', ...extra } };
}

export const TITLE_TEMPLATES: TitleTemplate[] = [
  {
    id: 'lowerThird',
    name: 'Lower third',
    description: 'Name and role with an accent bar',
    duration: 5,
    layers(W, H) {
      const k = Math.min(W, H) / 1080;
      const mx = Math.round(W * 0.07);
      const cy = H / 2 - Math.round(H * 0.13) - 52 * k;
      const boxW = Math.round(900 * k);
      const left = -W / 2 + mx + 28 * k;
      return [
        {
          kind: 'shape',
          init: {
            name: 'Accent bar',
            shape: shape({ kind: 'rect', width: Math.max(2, Math.round(6 * k)), height: Math.round(104 * k), radius: Math.round(3 * k), fill: { enabled: true, color: ACCENT } }),
            ...at(-W / 2 + mx + 3 * k, cy),
            keyframes: {
              'transform.scaleY': [
                { t: 0, v: 0, ease: 'easeOut' },
                { t: 0.45, v: 1, ease: 'linear' },
              ],
            },
            fadeOut: 0.35,
          },
        },
        {
          kind: 'text',
          init: {
            name: 'Name',
            text: text('Alex Morgan', {
              size: Math.round(54 * k),
              weight: 700,
              align: 'left',
              maxWidth: boxW,
              shadow: { enabled: true, blur: Math.round(18 * k), y: Math.round(3 * k), opacity: 0.35 },
              animation: { in: 'slideRight', out: 'fade', inDuration: 0.6, outDuration: 0.35 },
            }),
            ...at(left + boxW / 2, cy - 21 * k),
          },
        },
        {
          kind: 'text',
          init: {
            name: 'Role',
            text: text('Director of Photography', {
              size: Math.round(32 * k),
              weight: 500,
              color: '#ffffffc8',
              align: 'left',
              maxWidth: boxW,
              letterSpacing: 0.5 * k,
              shadow: { enabled: true, blur: Math.round(14 * k), y: Math.round(2 * k), opacity: 0.3 },
              animation: { in: 'fade', out: 'fade', inDuration: 0.9, outDuration: 0.35 },
            }),
            ...at(left + boxW / 2, cy + 31 * k),
          },
        },
      ];
    },
  },
  {
    id: 'centered',
    name: 'Centered title',
    description: 'A clean title in the middle of the frame',
    duration: 5,
    layers(W, H) {
      const k = Math.min(W, H) / 1080;
      return [
        {
          kind: 'text',
          init: {
            name: 'Title',
            text: text('Your Title', {
              size: Math.round(120 * k),
              weight: 700,
              letterSpacing: Math.round(2 * k),
              maxWidth: Math.round(W * 0.85),
              animation: { in: 'tracking', out: 'fade', inDuration: 1.2, outDuration: 0.6 },
            }),
            ...at(0, 0),
          },
        },
      ];
    },
  },
  {
    id: 'statement',
    name: 'Big statement',
    description: 'Heavy uppercase type that pops in',
    duration: 4,
    layers(W, H) {
      const k = Math.min(W, H) / 1080;
      return [
        {
          kind: 'text',
          init: {
            name: 'Statement',
            text: text('Make it count', {
              size: Math.round(190 * k),
              weight: 800,
              uppercase: true,
              lineHeight: 0.92,
              letterSpacing: Math.round(-3 * k),
              maxWidth: Math.round(W * 0.8),
              animation: { in: 'pop', out: 'blur', inDuration: 0.5, outDuration: 0.5 },
            }),
            ...at(0, 0),
          },
        },
      ];
    },
  },
  {
    id: 'subtitle',
    name: 'Subtitle',
    description: 'A boxed line of text near the bottom',
    duration: 3,
    layers(W, H) {
      const k = Math.min(W, H) / 1080;
      return [
        {
          kind: 'text',
          init: {
            name: 'Subtitle',
            text: text('A line of subtitle text', {
              size: Math.round(44 * k),
              weight: 500,
              lineHeight: 1.25,
              maxWidth: Math.round(W * 0.7),
              background: { enabled: true, color: '#000000', opacity: 0.62, paddingX: Math.round(24 * k), paddingY: Math.round(12 * k), radius: Math.round(8 * k) },
              animation: { in: 'fade', out: 'fade', inDuration: 0.2, outDuration: 0.2 },
            }),
            ...at(0, H / 2 - Math.round(H * 0.12)),
          },
        },
      ];
    },
  },
  {
    id: 'chapter',
    name: 'Chapter card',
    description: 'Full-frame card with a chapter label',
    duration: 4,
    layers(W, H) {
      const k = Math.min(W, H) / 1080;
      return [
        { kind: 'solid', init: { name: 'Card', solid: { color: '#0c0c10' }, fadeIn: 0.4, fadeOut: 0.4 } },
        {
          kind: 'shape',
          offset: 0.2,
          init: {
            name: 'Rule',
            shape: shape({ kind: 'line', width: Math.round(80 * k), height: 0, fill: { enabled: false, color: ACCENT }, stroke: { enabled: true, color: ACCENT, width: Math.max(2, Math.round(3 * k)) } }),
            ...at(0, -34 * k),
            keyframes: {
              'transform.scaleX': [
                { t: 0, v: 0, ease: 'easeOut' },
                { t: 0.6, v: 1, ease: 'linear' },
              ],
            },
            fadeOut: 0.4,
          },
        },
        {
          kind: 'text',
          offset: 0.2,
          init: {
            name: 'Chapter label',
            text: text('Chapter one', {
              size: Math.round(28 * k),
              weight: 600,
              uppercase: true,
              letterSpacing: Math.round(10 * k),
              color: '#ffffff99',
              animation: { in: 'tracking', out: 'fade', inDuration: 1, outDuration: 0.4 },
            }),
            ...at(0, -86 * k),
          },
        },
        {
          kind: 'text',
          offset: 0.4,
          init: {
            name: 'Chapter title',
            text: text('The Beginning', {
              size: Math.round(96 * k),
              weight: 600,
              letterSpacing: Math.round(-1 * k),
              maxWidth: Math.round(W * 0.8),
              animation: { in: 'slideUp', out: 'fade', inDuration: 0.8, outDuration: 0.4 },
            }),
            ...at(0, 40 * k),
          },
        },
      ];
    },
  },
  {
    id: 'endCard',
    name: 'End card',
    description: 'Closing title with a call to action',
    duration: 6,
    layers(W, H) {
      const k = Math.min(W, H) / 1080;
      return [
        {
          kind: 'gradient',
          init: {
            name: 'Backdrop',
            gradient: {
              kind: 'radial',
              angle: 0,
              stops: [
                { pos: 0, color: '#241a3d' },
                { pos: 1, color: '#060608' },
              ],
            },
            fadeIn: 0.5,
          },
        },
        {
          kind: 'text',
          offset: 0.3,
          init: {
            name: 'Title',
            text: text('Thanks for watching', {
              size: Math.round(96 * k),
              weight: 700,
              maxWidth: Math.round(W * 0.8),
              animation: { in: 'slideUp', out: 'fade', inDuration: 0.8, outDuration: 0.5 },
            }),
            ...at(0, -56 * k),
          },
        },
        {
          kind: 'text',
          offset: 0.9,
          init: {
            name: 'Call to action',
            text: text('Subscribe for more', {
              size: Math.round(34 * k),
              weight: 600,
              background: { enabled: true, color: ACCENT, opacity: 1, paddingX: Math.round(34 * k), paddingY: Math.round(16 * k), radius: Math.round(40 * k) },
              animation: { in: 'pop', out: 'fade', inDuration: 0.5, outDuration: 0.4 },
            }),
            ...at(0, 78 * k),
          },
        },
      ];
    },
  },
  {
    id: 'quote',
    name: 'Quote',
    description: 'Serif quotation with attribution',
    duration: 6,
    layers(W, H) {
      const k = Math.min(W, H) / 1080;
      return [
        {
          kind: 'text',
          init: {
            name: 'Quote',
            text: text('“Simplicity is the ultimate sophistication.”', {
              font: SERIF,
              size: Math.round(72 * k),
              weight: 400,
              italic: true,
              lineHeight: 1.22,
              maxWidth: Math.round(Math.min(W * 0.72, 1300 * k)),
              animation: { in: 'blur', out: 'fade', inDuration: 1.1, outDuration: 0.6 },
            }),
            ...at(0, -40 * k),
          },
        },
        {
          kind: 'text',
          offset: 0.8,
          init: {
            name: 'Attribution',
            text: text('— Leonardo da Vinci', {
              size: Math.round(30 * k),
              weight: 500,
              color: '#ffffffb3',
              letterSpacing: Math.round(1 * k),
              animation: { in: 'fade', out: 'fade', inDuration: 0.8, outDuration: 0.6 },
            }),
            ...at(0, 120 * k),
          },
        },
      ];
    },
  },
  {
    id: 'location',
    name: 'Location tag',
    description: 'Typed place name in the top corner',
    duration: 4,
    layers(W, H) {
      const k = Math.min(W, H) / 1080;
      const boxW = Math.round(760 * k);
      return [
        {
          kind: 'text',
          init: {
            name: 'Location',
            text: text('Lisbon, Portugal', {
              size: Math.round(30 * k),
              weight: 600,
              uppercase: true,
              letterSpacing: Math.round(5 * k),
              align: 'left',
              maxWidth: boxW,
              background: { enabled: true, color: '#000000', opacity: 0.55, paddingX: Math.round(20 * k), paddingY: Math.round(10 * k), radius: Math.round(4 * k) },
              animation: { in: 'typewriter', out: 'fade', inDuration: 1.2, outDuration: 0.4 },
            }),
            ...at(-W / 2 + Math.round(W * 0.06) + boxW / 2, -H / 2 + Math.round(H * 0.1)),
          },
        },
      ];
    },
  },
  {
    id: 'kinetic',
    name: 'Kinetic word reveal',
    description: 'Words land one after another',
    duration: 4,
    layers(W, H) {
      const k = Math.min(W, H) / 1080;
      return [
        {
          kind: 'text',
          init: {
            name: 'Kinetic words',
            text: text('Ideas that move people', {
              size: Math.round(110 * k),
              weight: 800,
              lineHeight: 1.02,
              letterSpacing: Math.round(-2 * k),
              maxWidth: Math.round(W * 0.75),
              animation: { in: 'wordByWord', out: 'slideUp', inDuration: 1.4, outDuration: 0.5 },
            }),
            ...at(0, 0),
          },
        },
      ];
    },
  },
];

export const DEFAULT_TITLE_ID = 'centered';

export function getTemplate(id: string): TitleTemplate | undefined {
  return TITLE_TEMPLATES.find((t) => t.id === id);
}

function isFree(track: Track, a: number, b: number): boolean {
  return !track.locked && !track.clips.some((c) => c.start < b - 1e-6 && c.start + c.duration > a + 1e-6);
}

function newVideoTrack(seq: Sequence): Track {
  let track: Track | null = null;
  try {
    track = addTrack(seq, 'video', 0);
  } catch {
    track = null;
  }
  if (!track || !seq.tracks.includes(track)) {
    const existing = seq.tracks.find((t) => t.id === track?.id);
    if (existing) return existing;
    const n = seq.tracks.filter((t) => t.kind === 'video').length + 1;
    track = makeTrack('video', `V${n}`);
    seq.tracks.unshift(track); // video tracks are stored top-first
  }
  return track;
}

/** Places template layers on free video tracks (bottom → top), adding tracks when needed. Runs on a draft. */
export function placeTemplate(project: Project, seq: Sequence, tpl: TitleTemplate, start: number): string[] {
  const layers = tpl.layers(seq.width, seq.height);
  const fps = seq.fps;
  const spans = layers.map((l) => {
    const a = snapToFrame(start + (l.offset ?? 0), fps);
    const d = snapToFrame(l.duration ?? tpl.duration - (l.offset ?? 0), fps);
    return { a, d: Math.max(1 / fps, d) };
  });
  const end = Math.max(...spans.map((s) => s.a + s.d));
  // Free tracks above everything already playing in the range, from the bottom up
  // (so the title is never hidden under footage); new tracks on top when needed.
  const chosen: Track[] = [];
  const video = seq.tracks.filter((t) => t.kind === 'video'); // top-first
  const topBusy = video.findIndex((t) => t.clips.some((c) => c.start < end - 1e-6 && c.start + c.duration > start + 1e-6));
  const limit = topBusy < 0 ? video.length : topBusy;
  for (let i = limit - 1; i >= 0 && chosen.length < layers.length; i--) if (isFree(video[i], start, end)) chosen.push(video[i]);
  while (chosen.length < layers.length) chosen.push(newVideoTrack(seq));
  const ids: string[] = [];
  layers.forEach((layer, i) => {
    const track = chosen[i];
    const { a, d } = spans[i];
    const init = structuredClone(layer.init);
    let id: string | null = null;
    try {
      id = addGeneratedClip(project, seq, layer.kind, { start: a, duration: d, trackId: track.id, init });
    } catch {
      id = null;
    }
    let clip = id ? seq.tracks.flatMap((t) => t.clips).find((c) => c.id === id) : undefined;
    if (!clip) {
      clip = makeClip(layer.kind, { start: a, duration: d, ...init });
      track.clips.push(clip);
    } else Object.assign(clip, init, { start: clip.start, duration: clip.duration });
    ids.push(clip.id);
  });
  return ids;
}

/** Adds a title template at the playhead (or `at`) and selects it. Returns the new clip ids. */
export function addTitle(templateId: string = DEFAULT_TITLE_ID, at?: number): string[] {
  const s = useEditor.getState();
  if (!s.project) return [];
  const tpl = getTemplate(templateId) ?? getTemplate(DEFAULT_TITLE_ID)!;
  const seq = activeSequence(s.project);
  const start = snapToFrame(Math.max(0, at ?? s.playhead), seq.fps);
  let ids: string[] = [];
  try {
    s.mutateSequence(`Add title: ${tpl.name}`, (draft, project) => {
      ids = placeTemplate(project, draft, tpl, start);
    });
  } catch (e) {
    s.showToast(`Couldn't add the title: ${(e as Error).message}`, 'error');
    return [];
  }
  if (ids.length) s.selectClips(ids.slice(-1));
  return ids;
}
