// Turns what the Deliver UI holds (preset, settings, name template,
// destination, range, formats) into concrete jobs: one per selected sequence
// format, each with its resolved range and output path.

import type { Project, Sequence } from '../../state/types';
import { DEFAULT_NAME_TEMPLATE, outputBaseName, outputPath } from './naming';
import { resolveFps, resolveRange } from './plan';
import { handoffFormat } from './presets';
import type { ExportPreset, ExportSettings, PresetLimits, RangeSpec, TimeRange, VideoCodecId } from './types';

/** Main sequence format in a format list. */
export const MAIN_FORMAT = 'main';

export interface ExportDraft {
  presetId: string;
  presetName: string;
  settings: ExportSettings;
  limits?: PresetLimits;
  expectsCodec?: VideoCodecId;
  nameTemplate: string;
  destination: string;
  range: RangeSpec;
  /** MAIN_FORMAT and/or ids from seq.formats. */
  formats: string[];
}

export interface JobSpec {
  name: string;
  sequenceId: string;
  sequenceName: string;
  presetId: string;
  presetName: string;
  settings: ExportSettings;
  rangeSpec: RangeSpec;
  range: TimeRange;
  formatId: string | null;
  formatName: string;
  outputPath: string;
  limits?: PresetLimits;
  expectsCodec?: VideoCodecId;
}

export function aspectName(w: number, h: number): string {
  const g = (a: number, b: number): number => (b ? g(b, a % b) : a);
  const d = g(w, h);
  return w / d <= 32 && h / d <= 32 ? `${w / d}x${h / d}` : `${w}x${h}`;
}

export function draftFromPreset(preset: ExportPreset, base: Partial<ExportDraft> = {}): ExportDraft {
  return {
    presetId: preset.id,
    presetName: preset.name,
    settings: JSON.parse(JSON.stringify(preset.settings)) as ExportSettings,
    ...(preset.limits ? { limits: preset.limits } : {}),
    ...(preset.expectsCodec ? { expectsCodec: preset.expectsCodec } : {}),
    nameTemplate: base.nameTemplate ?? DEFAULT_NAME_TEMPLATE,
    destination: base.destination ?? '',
    range: base.range ?? (preset.settings.kind === 'still' ? { mode: 'frame', time: 0 } : { mode: 'entire' }),
    formats: base.formats ?? [MAIN_FORMAT],
  };
}

/** Effective range spec for a kind (stills always use a frame, handoff the whole sequence). */
export function effectiveRangeSpec(draft: Pick<ExportDraft, 'range' | 'settings'>, playhead: number): RangeSpec {
  const kind = draft.settings.kind;
  if (kind === 'handoff') return { mode: 'entire' };
  if (kind === 'still') {
    if (draft.range.mode === 'frame') return draft.range;
    if (draft.range.mode === 'custom') return { mode: 'frame', time: draft.range.start };
    return { mode: 'frame', time: playhead };
  }
  return draft.range.mode === 'frame' ? { mode: 'entire' } : draft.range;
}

/**
 * Expands a draft into jobs (throws a readable error for an empty range).
 * Handoff exports ignore formats (one file per sequence).
 */
export function buildJobs(draft: ExportDraft, project: Project, seq: Sequence, opts: { playhead: number; now?: Date }): JobSpec[] {
  const spec = effectiveRangeSpec(draft, opts.playhead);
  const fps = draft.settings.kind === 'still' ? seq.fps : resolveFps(draft.settings.video.fps, seq.fps);
  const range = resolveRange(spec, seq, fps);
  const handoff = handoffFormat(draft.settings) !== null;
  const audioOnly = draft.settings.kind === 'audio';
  const wanted = handoff || audioOnly ? [MAIN_FORMAT] : draft.formats.filter((f) => f === MAIN_FORMAT || seq.formats.some((x) => x.id === f));
  const formats = wanted.length ? wanted : [MAIN_FORMAT];
  const multi = formats.length > 1;
  const usesToken = /\{format\}/.test(draft.nameTemplate);
  return formats.map((fid) => {
    const fmt = fid === MAIN_FORMAT ? null : seq.formats.find((f) => f.id === fid)!;
    const formatName = fmt ? fmt.name : multi || usesToken ? aspectName(seq.width, seq.height) : '';
    const name = outputBaseName(draft.nameTemplate || DEFAULT_NAME_TEMPLATE, { project: project.name, sequence: seq.name, preset: draft.presetName, format: formatName, date: opts.now ?? new Date() }, { multiFormat: multi });
    return {
      name,
      sequenceId: seq.id,
      sequenceName: seq.name,
      presetId: draft.presetId,
      presetName: draft.presetName,
      settings: JSON.parse(JSON.stringify(draft.settings)) as ExportSettings,
      rangeSpec: spec,
      range,
      formatId: fmt?.id ?? null,
      formatName: fmt?.name ?? 'Main',
      outputPath: outputPath(draft.destination, name, draft.settings),
      ...(draft.limits ? { limits: draft.limits } : {}),
      ...(draft.expectsCodec ? { expectsCodec: draft.expectsCodec } : {}),
    };
  });
}
