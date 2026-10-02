// Human names and display info for keyframeable param paths (see
// engine/keyframes.ts for the path grammar). Used by undo labels, the
// keyframe lane and the graph editor.

import { getEffect } from '../../../engine/effects/registry';
import type { Clip } from '../../../state/types';

export interface ParamInfo {
  label: string;
  /** Unit suffix shown next to values. */
  unit: string;
  /** Display multiplier (0..1 opacity → %). */
  scale: number;
  decimals: number;
}

const KNOWN: Record<string, ParamInfo> = {
  'transform.x': { label: 'Position X', unit: 'px', scale: 1, decimals: 1 },
  'transform.y': { label: 'Position Y', unit: 'px', scale: 1, decimals: 1 },
  'transform.scale': { label: 'Scale', unit: '%', scale: 100, decimals: 1 },
  'transform.scaleX': { label: 'Scale width', unit: '%', scale: 100, decimals: 1 },
  'transform.scaleY': { label: 'Scale height', unit: '%', scale: 100, decimals: 1 },
  'transform.rotation': { label: 'Rotation', unit: '°', scale: 1, decimals: 1 },
  'transform.anchorX': { label: 'Anchor X', unit: 'px', scale: 1, decimals: 1 },
  'transform.anchorY': { label: 'Anchor Y', unit: 'px', scale: 1, decimals: 1 },
  'transform.opacity': { label: 'Opacity', unit: '%', scale: 100, decimals: 1 },
  'crop.left': { label: 'Crop left', unit: '%', scale: 100, decimals: 1 },
  'crop.top': { label: 'Crop top', unit: '%', scale: 100, decimals: 1 },
  'crop.right': { label: 'Crop right', unit: '%', scale: 100, decimals: 1 },
  'crop.bottom': { label: 'Crop bottom', unit: '%', scale: 100, decimals: 1 },
  'crop.feather': { label: 'Crop feather', unit: 'px', scale: 1, decimals: 0 },
  'time.speed': { label: 'Speed', unit: '%', scale: 100, decimals: 0 },
  'text.size': { label: 'Text size', unit: 'px', scale: 1, decimals: 0 },
  'text.letterSpacing': { label: 'Tracking', unit: 'px', scale: 1, decimals: 1 },
  'text.lineHeight': { label: 'Line height', unit: '', scale: 1, decimals: 2 },
  'shape.width': { label: 'Shape width', unit: 'px', scale: 1, decimals: 0 },
  'shape.height': { label: 'Shape height', unit: 'px', scale: 1, decimals: 0 },
  'shape.radius': { label: 'Corner radius', unit: 'px', scale: 1, decimals: 0 },
  'audio.gain': { label: 'Clip gain', unit: 'dB', scale: 1, decimals: 1 },
  'audio.pan': { label: 'Pan', unit: '', scale: 100, decimals: 0 },
  'grade.exposure': { label: 'Exposure', unit: 'st', scale: 1, decimals: 2 },
  'grade.temperature': { label: 'Temperature', unit: '', scale: 1, decimals: 0 },
  'grade.tint': { label: 'Tint', unit: '', scale: 1, decimals: 0 },
  'grade.contrast': { label: 'Contrast', unit: '', scale: 1, decimals: 2 },
  'grade.pivot': { label: 'Pivot', unit: '', scale: 1, decimals: 3 },
  'grade.saturation': { label: 'Saturation', unit: '', scale: 1, decimals: 2 },
  'grade.vibrance': { label: 'Vibrance', unit: '', scale: 1, decimals: 2 },
  'grade.highlights': { label: 'Highlights', unit: '', scale: 1, decimals: 2 },
  'grade.shadows': { label: 'Shadows', unit: '', scale: 1, decimals: 2 },
  'grade.lut.intensity': { label: 'LUT intensity', unit: '%', scale: 100, decimals: 0 },
};

const MASK_KEYS: Record<string, Omit<ParamInfo, 'label'> & { label: string }> = {
  x: { label: 'X', unit: '%', scale: 100, decimals: 1 },
  y: { label: 'Y', unit: '%', scale: 100, decimals: 1 },
  width: { label: 'width', unit: '%', scale: 100, decimals: 1 },
  height: { label: 'height', unit: '%', scale: 100, decimals: 1 },
  rotation: { label: 'rotation', unit: '°', scale: 1, decimals: 1 },
  roundness: { label: 'roundness', unit: '%', scale: 100, decimals: 0 },
  feather: { label: 'feather', unit: 'px', scale: 1, decimals: 0 },
  expansion: { label: 'expansion', unit: 'px', scale: 1, decimals: 0 },
  opacity: { label: 'opacity', unit: '%', scale: 100, decimals: 0 },
};

const WHEEL: Record<string, string> = { lift: 'Lift', gamma: 'Gamma', gain: 'Gain', offset: 'Offset' };

/** Display info for a param path; `clip` resolves mask and effect names. */
export function paramInfo(path: string, clip?: Clip | null): ParamInfo {
  const known = KNOWN[path];
  if (known) return known;
  const parts = path.split('.');
  if (parts[0] === 'masks') {
    const m = clip?.masks.find((x) => x.id === parts[1]);
    const k = MASK_KEYS[parts[2]] ?? { label: parts[2], unit: '', scale: 1, decimals: 2 };
    return { ...k, label: `${m?.name ?? 'Mask'} ${k.label}` };
  }
  if (parts[0] === 'effects') {
    const inst = clip?.effects.find((e) => e.id === parts[1]);
    const def = inst ? getEffect(inst.type) : undefined;
    const p = def?.params.find((x) => x.key === parts[2]);
    const unit = p?.unit ?? '';
    return {
      label: `${def?.name ?? 'Effect'} · ${p?.label ?? parts[2]}`,
      unit: unit === 'x' ? '×' : unit,
      scale: 1,
      decimals: p?.step ? Math.min(3, Math.max(0, Math.ceil(-Math.log10(p.step)))) : 2,
    };
  }
  if (parts[0] === 'grade' && WHEEL[parts[1]]) {
    return { label: `${WHEEL[parts[1]]} ${parts[2]?.toUpperCase() ?? ''}`.trim(), unit: '', scale: 1, decimals: 3 };
  }
  const last = parts[parts.length - 1];
  return { label: last.charAt(0).toUpperCase() + last.slice(1), unit: '', scale: 1, decimals: 2 };
}

export function paramLabel(path: string, clip?: Clip | null): string {
  return paramInfo(path, clip).label;
}
