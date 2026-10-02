// The shell's view of every Delta package: panels, optional exports
// (Modals, TitlesBrowser, importPaths, progress hooks), all guarded so a
// package that is still a stub never breaks the editor. Importing the
// package indexes also registers their actions. OWNED BY THE SHELL PACKAGE.

import type { ComponentType } from 'react';
import * as audio from '../audio';
import * as captions from '../captions';
import * as color from '../color';
import * as deliver from '../deliver';
import * as effects from '../effects';
import * as inspector from '../inspector';
import * as media from '../media';
import * as timeline from '../timeline';
import * as viewer from '../viewer';

export const PACKAGES: Record<string, object> = { media, timeline, viewer, inspector, effects, color, audio, captions, deliver };

/** An optional export, only if it is a function (component, hook or API). */
export function optional<T>(ns: object, name: string): T | undefined {
  const v = (ns as Record<string, unknown>)[name];
  return typeof v === 'function' ? (v as T) : undefined;
}

/** Every package's `Modals` component (each renders only its own modal ids). */
export const PACKAGE_MODALS: { name: string; Modals: ComponentType }[] = Object.entries(PACKAGES)
  .map(([name, ns]) => ({ name, Modals: optional<ComponentType>(ns, 'Modals') }))
  .filter((m): m is { name: string; Modals: ComponentType } => !!m.Modals);

export const TitlesBrowser = optional<ComponentType>(inspector, 'TitlesBrowser');

/** media's import entry point (files dropped on the window). */
export const importPaths = optional<(paths: string[]) => unknown>(media, 'importPaths');

export interface QueueStatus {
  /** 0..1 progress of the running job, or null when idle. */
  progress: number | null;
  label?: string;
  /** Jobs waiting (including the running one). */
  pending?: number;
}

/**
 * Optional render-queue status hook published by deliver. It is looked up by
 * a few likely names; the status bar simply hides the meter when none exists.
 */
export const useDeliverStatus = ['useQueueStatus', 'useRenderQueueStatus', 'useExportStatus', 'useDeliverStatus']
  .map((n) => optional<() => QueueStatus | null | undefined>(deliver, n))
  .find(Boolean);

export const { MediaPanel } = media;
export const { Timeline } = timeline;
export const { ProgramMonitor, SourceMonitor } = viewer;
export const { Inspector } = inspector;
export const { EffectsBrowser } = effects;
export const { ColorPanel, Scopes } = color;
export const { Mixer, LoudnessPanel, AudioClipSection } = audio;
export const { CaptionsPanel } = captions;
export const { DeliverPanel } = deliver;
