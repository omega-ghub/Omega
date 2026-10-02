import { create } from 'zustand';
import type { AppInfo, RecentProject } from '../../electron/api';
import type { AppKind } from '../brand/themes';
import { applyTheme } from '../brand/themes';
import { probeMedia } from '../media/probe';
import { isDropFrameRate } from './presets';
import type { Clip, MediaAsset, Project, ProjectHandle, ProjectSettings, Sequence, Track, TrackKind } from './types';
import { FORMAT_VERSION, newId, sequenceDuration } from './types';

export type DashboardTab = 'home' | 'apps' | 'projects' | 'learn' | 'plans' | 'settings';
export type Tool = 'select' | 'razor';

const MAX_UNDO = 200;

interface OmegaState {
  // shell
  view: 'dashboard' | 'workspace';
  dashboardTab: DashboardTab;
  appInfo: AppInfo | null;
  recents: RecentProject[];
  toast: string | null;
  newProjectFor: AppKind | null;

  // project
  project: Project | null;
  handle: ProjectHandle | null;
  dirty: boolean;
  importing: boolean;

  // editor
  playhead: number;
  playing: boolean;
  inPoint: number | null;
  outPoint: number | null;
  selectedClipIds: string[];
  selectedAssetId: string | null;
  tool: Tool;
  zoom: number; // pixels per second
  exportOpen: boolean;
  undoStack: Sequence[];
  redoStack: Sequence[];

  // actions
  init(): Promise<void>;
  setDashboardTab(tab: DashboardTab): void;
  showToast(message: string | null): void;
  openNewProject(app: AppKind): void;
  closeNewProject(): void;
  createProject(app: AppKind, name: string, location: string, settings: ProjectSettings): Promise<void>;
  openProject(path?: string): Promise<void>;
  saveProject(): Promise<void>;
  closeProject(): Promise<void>;
  removeRecent(path: string): Promise<void>;

  importMedia(): Promise<void>;
  removeAsset(assetId: string): void;
  selectAsset(assetId: string | null): void;

  mutateSequence(fn: (seq: Sequence, project: Project) => void): void;
  addClip(assetId: string, trackId: string | null, start: number | null): void;
  moveClip(clipId: string, start: number, trackId?: string): void;
  trimClip(clipId: string, edge: 'start' | 'end', time: number): void;
  splitAtPlayhead(): void;
  splitClip(clipId: string, time: number): void;
  deleteSelected(): void;
  selectClips(ids: string[], additive?: boolean): void;
  updateClip(clipId: string, patch: Partial<Clip>): void;
  addTrack(kind: TrackKind): void;
  toggleTrackMute(trackId: string): void;
  toggleTrackLock(trackId: string): void;
  undo(): void;
  redo(): void;

  setPlayhead(t: number): void;
  setPlaying(playing: boolean): void;
  setInPoint(t: number | null): void;
  setOutPoint(t: number | null): void;
  setTool(tool: Tool): void;
  setZoom(zoom: number): void;
  setExportOpen(open: boolean): void;
}

function clone<T>(v: T): T {
  return structuredClone(v);
}

function makeSequence(): Sequence {
  return {
    id: newId('seq'),
    name: 'Sequence 1',
    tracks: [
      { id: newId('v'), kind: 'video', name: 'V2', clips: [], muted: false, locked: false },
      { id: newId('v'), kind: 'video', name: 'V1', clips: [], muted: false, locked: false },
      { id: newId('a'), kind: 'audio', name: 'A1', clips: [], muted: false, locked: false },
      { id: newId('a'), kind: 'audio', name: 'A2', clips: [], muted: false, locked: false },
    ],
    markers: [],
  };
}

function findClip(seq: Sequence, id: string): { clip: Clip; track: Track } | null {
  for (const track of seq.tracks) {
    const clip = track.clips.find((c) => c.id === id);
    if (clip) return { clip, track };
  }
  return null;
}

/** First position at or after `desired` on the track where `duration` fits. */
function findFreeStart(track: Track, desired: number, duration: number, excludeId?: string): number {
  const clips = track.clips.filter((c) => c.id !== excludeId).sort((a, b) => a.start - b.start);
  let start = Math.max(0, desired);
  for (let guard = 0; guard < 1000; guard++) {
    const hit = clips.find((c) => start < c.start + c.duration && start + duration > c.start);
    if (!hit) return start;
    start = hit.start + hit.duration;
  }
  return start;
}

function overlaps(track: Track, start: number, duration: number, excludeId?: string) {
  return track.clips.some((c) => c.id !== excludeId && start < c.start + c.duration && start + duration > c.start);
}

function summarize(p: Project): string {
  const s = p.settings;
  return `${s.width}×${s.height} · ${s.fps} fps`;
}

export const useStore = create<OmegaState>((set, get) => ({
  view: 'dashboard',
  dashboardTab: 'home',
  appInfo: null,
  recents: [],
  toast: null,
  newProjectFor: null,
  project: null,
  handle: null,
  dirty: false,
  importing: false,
  playhead: 0,
  playing: false,
  inPoint: null,
  outPoint: null,
  selectedClipIds: [],
  selectedAssetId: null,
  tool: 'select',
  zoom: 60,
  exportOpen: false,
  undoStack: [],
  redoStack: [],

  async init() {
    const [appInfo, recents] = await Promise.all([window.omega.appInfo(), window.omega.projects.recents()]);
    set({ appInfo, recents });
    applyTheme('omega');
  },

  setDashboardTab: (dashboardTab) => set({ dashboardTab }),

  showToast(message) {
    set({ toast: message });
    if (message) setTimeout(() => get().toast === message && set({ toast: null }), 3500);
  },

  openNewProject: (app) => set({ newProjectFor: app }),
  closeNewProject: () => set({ newProjectFor: null }),

  async createProject(app, name, location, settings) {
    const now = Date.now();
    const project: Project = {
      formatVersion: FORMAT_VERSION,
      id: newId('proj'),
      name,
      app,
      createdAt: now,
      modifiedAt: now,
      settings: { ...settings, dropFrame: isDropFrameRate(settings.fps) },
      assets: [],
      sequence: makeSequence(),
    };
    const handle = await window.omega.projects.create(location, name, JSON.stringify(project, null, 2));
    const recent: RecentProject = { path: handle.filePath, name, app, modifiedAt: now, summary: summarize(project) };
    await window.omega.projects.addRecent(recent);
    const recents = await window.omega.projects.recents();
    applyTheme(app);
    set({
      project,
      handle,
      recents,
      dirty: false,
      view: 'workspace',
      newProjectFor: null,
      playhead: 0,
      playing: false,
      inPoint: null,
      outPoint: null,
      selectedClipIds: [],
      selectedAssetId: null,
      undoStack: [],
      redoStack: [],
    });
  },

  async openProject(path) {
    const filePath = path ?? (await window.omega.dialogs.pickProjectFile());
    if (!filePath) return;
    let project: Project;
    try {
      project = JSON.parse(await window.omega.projects.load(filePath));
    } catch (err) {
      get().showToast(`Could not open project: ${(err as Error).message}`);
      await window.omega.projects.removeRecent(filePath);
      set({ recents: await window.omega.projects.recents() });
      return;
    }
    if (!project || typeof project !== 'object' || !project.sequence) {
      get().showToast('That file is not an Omega project.');
      return;
    }
    for (const asset of project.assets) asset.offline = !(await window.omega.media.exists(asset.path));
    const dir = filePath.replace(/[\\/][^\\/]*$/, '');
    const handle: ProjectHandle = { filePath, dir };
    await window.omega.projects.addRecent({ path: filePath, name: project.name, app: project.app, modifiedAt: Date.now(), summary: summarize(project) });
    applyTheme(project.app);
    set({
      project,
      handle,
      recents: await window.omega.projects.recents(),
      dirty: false,
      view: 'workspace',
      playhead: 0,
      playing: false,
      inPoint: null,
      outPoint: null,
      selectedClipIds: [],
      selectedAssetId: null,
      undoStack: [],
      redoStack: [],
    });
  },

  async saveProject() {
    const { project, handle } = get();
    if (!project || !handle) return;
    const saved: Project = { ...project, modifiedAt: Date.now() };
    await window.omega.projects.save(handle.filePath, JSON.stringify(saved, null, 2));
    await window.omega.projects.addRecent({ path: handle.filePath, name: saved.name, app: saved.app, modifiedAt: saved.modifiedAt, summary: summarize(saved) });
    set({ project: saved, dirty: false, recents: await window.omega.projects.recents() });
  },

  async closeProject() {
    if (get().dirty) await get().saveProject();
    applyTheme('omega');
    set({ view: 'dashboard', project: null, handle: null, playing: false, selectedClipIds: [], undoStack: [], redoStack: [], exportOpen: false });
  },

  async removeRecent(path) {
    await window.omega.projects.removeRecent(path);
    set({ recents: await window.omega.projects.recents() });
  },

  async importMedia() {
    const files = await window.omega.dialogs.pickMedia();
    if (files.length === 0) return;
    set({ importing: true });
    const added: MediaAsset[] = [];
    const failed: string[] = [];
    for (const f of files) {
      try {
        added.push(await probeMedia(f.path, f.name));
      } catch {
        failed.push(f.name);
      }
    }
    const project = get().project;
    if (!project) {
      set({ importing: false });
      return;
    }
    const existingPaths = new Set(project.assets.map((a) => a.path));
    const fresh = added.filter((a) => !existingPaths.has(a.path));
    let settings = project.settings;
    // "Match first clip": adopt the first video's size and frame rate.
    if (settings.matchFirstClip && project.assets.length === 0) {
      const firstVideo = fresh.find((a) => a.kind === 'video' && a.width && a.height);
      if (firstVideo) {
        settings = {
          ...settings,
          width: firstVideo.width!,
          height: firstVideo.height!,
          fps: firstVideo.fps ?? settings.fps,
          dropFrame: isDropFrameRate(firstVideo.fps ?? settings.fps),
          matchFirstClip: false,
        };
        get().showToast(`Sequence set to ${settings.width}×${settings.height} at ${settings.fps} fps to match ${firstVideo.name}`);
      }
    }
    set({
      project: { ...project, settings, assets: [...project.assets, ...fresh] },
      dirty: true,
      importing: false,
      selectedAssetId: fresh[0]?.id ?? get().selectedAssetId,
    });
    if (failed.length) get().showToast(`Could not import: ${failed.join(', ')}`);
  },

  removeAsset(assetId) {
    const project = get().project;
    if (!project) return;
    const inUse = project.sequence.tracks.some((t) => t.clips.some((c) => c.assetId === assetId));
    if (inUse) {
      get().showToast('That media is used on the timeline. Remove its clips first.');
      return;
    }
    set({ project: { ...project, assets: project.assets.filter((a) => a.id !== assetId) }, dirty: true, selectedAssetId: null });
  },

  selectAsset: (selectedAssetId) => set({ selectedAssetId }),

  mutateSequence(fn) {
    const { project, undoStack } = get();
    if (!project) return;
    const before = clone(project.sequence);
    const seq = clone(project.sequence);
    fn(seq, project);
    const next: Project = { ...project, sequence: seq };
    set({ project: next, dirty: true, undoStack: [...undoStack.slice(-MAX_UNDO + 1), before], redoStack: [] });
  },

  addClip(assetId, trackId, start) {
    const { project, playhead } = get();
    if (!project) return;
    const asset = project.assets.find((a) => a.id === assetId);
    if (!asset || asset.offline) return;
    const desired = start ?? playhead;
    get().mutateSequence((seq) => {
      const videoTracks = seq.tracks.filter((t) => t.kind === 'video');
      const audioTracks = seq.tracks.filter((t) => t.kind === 'audio');
      const target = trackId ? seq.tracks.find((t) => t.id === trackId) : null;
      const linkId = asset.hasVideo && asset.hasAudio ? newId('link') : undefined;
      const duration = asset.duration;
      let placedStart = desired;
      if (asset.hasVideo) {
        const vTrack = target?.kind === 'video' ? target : videoTracks[videoTracks.length - 1];
        if (vTrack && !vTrack.locked) {
          placedStart = findFreeStart(vTrack, desired, duration);
          vTrack.clips.push({ id: newId('clip'), assetId, name: asset.name, start: placedStart, duration, inPoint: 0, linkId });
        }
      }
      if (asset.hasAudio) {
        const aTrack = target?.kind === 'audio' ? target : audioTracks[0];
        if (aTrack && !aTrack.locked) {
          const aStart = asset.hasVideo ? placedStart : findFreeStart(aTrack, desired, duration);
          if (!overlaps(aTrack, aStart, duration)) {
            aTrack.clips.push({ id: newId('clip'), assetId, name: asset.name, start: aStart, duration, inPoint: 0, linkId });
          } else if (!asset.hasVideo) {
            aTrack.clips.push({ id: newId('clip'), assetId, name: asset.name, start: findFreeStart(aTrack, desired, duration), duration, inPoint: 0 });
          } else {
            // find any free audio track at the same position so A/V stay in sync
            const free = audioTracks.find((t) => !t.locked && !overlaps(t, aStart, duration));
            if (free) free.clips.push({ id: newId('clip'), assetId, name: asset.name, start: aStart, duration, inPoint: 0, linkId });
          }
        }
      }
    });
  },

  moveClip(clipId, start, trackId) {
    get().mutateSequence((seq) => {
      const found = findClip(seq, clipId);
      if (!found) return;
      const { clip, track } = found;
      const dest = trackId ? seq.tracks.find((t) => t.id === trackId) : track;
      if (!dest || dest.kind !== track.kind || dest.locked) return;
      const newStart = Math.max(0, start);
      if (overlaps(dest, newStart, clip.duration, clip.id)) return; // no overwrite: keep where it was
      const delta = newStart - clip.start;
      if (dest !== track) {
        track.clips = track.clips.filter((c) => c.id !== clip.id);
        dest.clips.push(clip);
      }
      clip.start = newStart;
      if (clip.linkId) {
        for (const t of seq.tracks) {
          for (const other of t.clips) {
            if (other.linkId === clip.linkId && other.id !== clip.id) {
              const target = other.start + delta;
              if (target >= 0 && !overlaps(t, target, other.duration, other.id)) other.start = target;
            }
          }
        }
      }
    });
  },

  trimClip(clipId, edge, time) {
    const project = get().project;
    if (!project) return;
    get().mutateSequence((seq) => {
      const found = findClip(seq, clipId);
      if (!found) return;
      const { clip, track } = found;
      if (track.locked) return;
      const asset = project.assets.find((a) => a.id === clip.assetId);
      const maxDuration = asset?.kind === 'image' ? Infinity : (asset?.duration ?? clip.inPoint + clip.duration);
      const minLen = 1 / Math.max(1, project.settings.fps);
      const apply = (c: Clip, t: Track) => {
        if (edge === 'start') {
          const end = c.start + c.duration;
          let ns = Math.max(0, Math.min(time, end - minLen));
          // cannot reveal media before the source start
          ns = Math.max(ns, c.start - c.inPoint);
          const prev = t.clips.filter((o) => o.id !== c.id && o.start + o.duration <= end && o.start < c.start).sort((a, b) => b.start - a.start)[0];
          if (prev) ns = Math.max(ns, prev.start + prev.duration);
          c.inPoint += ns - c.start;
          c.duration = end - ns;
          c.start = ns;
        } else {
          let ne = Math.max(c.start + minLen, time);
          ne = Math.min(ne, c.start + (maxDuration - c.inPoint));
          const next = t.clips.filter((o) => o.id !== c.id && o.start >= c.start + minLen).sort((a, b) => a.start - b.start)[0];
          if (next) ne = Math.min(ne, next.start);
          c.duration = ne - c.start;
        }
      };
      apply(clip, track);
      if (clip.linkId) {
        for (const t of seq.tracks) for (const o of t.clips) if (o.linkId === clip.linkId && o.id !== clip.id) apply(o, t);
      }
    });
  },

  splitAtPlayhead() {
    const { project, playhead, selectedClipIds } = get();
    if (!project) return;
    const targets: string[] = [];
    for (const t of project.sequence.tracks) {
      for (const c of t.clips) {
        const inside = playhead > c.start + 1e-6 && playhead < c.start + c.duration - 1e-6;
        if (inside && (selectedClipIds.length === 0 || selectedClipIds.includes(c.id))) targets.push(c.id);
      }
    }
    if (targets.length === 0) return;
    get().mutateSequence((seq) => {
      for (const id of targets) splitInSequence(seq, id, playhead);
    });
  },

  splitClip(clipId, time) {
    get().mutateSequence((seq) => splitInSequence(seq, clipId, time));
  },

  deleteSelected() {
    const ids = get().selectedClipIds;
    if (ids.length === 0) return;
    get().mutateSequence((seq) => {
      for (const t of seq.tracks) if (!t.locked) t.clips = t.clips.filter((c) => !ids.includes(c.id));
    });
    set({ selectedClipIds: [] });
  },

  selectClips(ids, additive = false) {
    if (additive) {
      const current = new Set(get().selectedClipIds);
      for (const id of ids) current.has(id) ? current.delete(id) : current.add(id);
      set({ selectedClipIds: [...current] });
    } else set({ selectedClipIds: ids });
  },

  updateClip(clipId, patch) {
    get().mutateSequence((seq) => {
      const found = findClip(seq, clipId);
      if (found) Object.assign(found.clip, patch);
    });
  },

  addTrack(kind) {
    get().mutateSequence((seq) => {
      const count = seq.tracks.filter((t) => t.kind === kind).length + 1;
      const track: Track = { id: newId(kind === 'video' ? 'v' : 'a'), kind, name: `${kind === 'video' ? 'V' : 'A'}${count}`, clips: [], muted: false, locked: false };
      if (kind === 'video') seq.tracks.unshift(track);
      else seq.tracks.push(track);
    });
  },

  toggleTrackMute(trackId) {
    get().mutateSequence((seq) => {
      const t = seq.tracks.find((x) => x.id === trackId);
      if (t) t.muted = !t.muted;
    });
  },

  toggleTrackLock(trackId) {
    get().mutateSequence((seq) => {
      const t = seq.tracks.find((x) => x.id === trackId);
      if (t) t.locked = !t.locked;
    });
  },

  undo() {
    const { project, undoStack, redoStack } = get();
    if (!project || undoStack.length === 0) return;
    const previous = undoStack[undoStack.length - 1];
    set({
      project: { ...project, sequence: previous },
      undoStack: undoStack.slice(0, -1),
      redoStack: [...redoStack, project.sequence],
      dirty: true,
      selectedClipIds: [],
    });
  },

  redo() {
    const { project, undoStack, redoStack } = get();
    if (!project || redoStack.length === 0) return;
    const next = redoStack[redoStack.length - 1];
    set({
      project: { ...project, sequence: next },
      redoStack: redoStack.slice(0, -1),
      undoStack: [...undoStack, project.sequence],
      dirty: true,
      selectedClipIds: [],
    });
  },

  setPlayhead(t) {
    const project = get().project;
    const max = project ? sequenceDuration(project.sequence) : 0;
    set({ playhead: Math.max(0, Math.min(t, Math.max(max, 0))) });
  },
  setPlaying: (playing) => set({ playing }),
  setInPoint: (inPoint) => set({ inPoint }),
  setOutPoint: (outPoint) => set({ outPoint }),
  setTool: (tool) => set({ tool }),
  setZoom: (zoom) => set({ zoom: Math.max(4, Math.min(600, zoom)) }),
  setExportOpen: (exportOpen) => set({ exportOpen }),
}));

function splitInSequence(seq: Sequence, clipId: string, time: number) {
  const found = findClip(seq, clipId);
  if (!found) return;
  const { clip, track } = found;
  if (track.locked) return;
  if (time <= clip.start + 1e-6 || time >= clip.start + clip.duration - 1e-6) return;
  const right: Clip = {
    ...clip,
    id: newId('clip'),
    start: time,
    duration: clip.start + clip.duration - time,
    inPoint: clip.inPoint + (time - clip.start),
    linkId: clip.linkId ? `${clip.linkId}_r${Math.round(time * 1000)}` : undefined,
  };
  clip.duration = time - clip.start;
  track.clips.push(right);
  // split the linked partner at the same time so A/V halves stay paired
  if (clip.linkId) {
    for (const t of seq.tracks) {
      for (const o of [...t.clips]) {
        if (o.linkId === clip.linkId && o.id !== clip.id && time > o.start + 1e-6 && time < o.start + o.duration - 1e-6) {
          const r: Clip = { ...o, id: newId('clip'), start: time, duration: o.start + o.duration - time, inPoint: o.inPoint + (time - o.start), linkId: right.linkId };
          o.duration = time - o.start;
          t.clips.push(r);
        }
      }
    }
  }
}

export function formatTimecode(seconds: number, fps: number, dropFrame = false): string {
  const totalFrames = Math.round(seconds * fps);
  const nominal = Math.round(fps);
  if (dropFrame && (nominal === 30 || nominal === 60)) {
    // SMPTE drop-frame: skip 2 (or 4) frame numbers at the start of every
    // minute except each 10th minute, so the display tracks wall-clock time.
    const dropPerMinute = nominal === 30 ? 2 : 4;
    const framesPer10Min = Math.round(fps * 600);
    const framesPerMinute = nominal * 60 - dropPerMinute;
    const tenMinuteBlocks = Math.floor(totalFrames / framesPer10Min);
    const remainder = totalFrames % framesPer10Min;
    let frameNumber = totalFrames + dropPerMinute * 9 * tenMinuteBlocks;
    if (remainder > dropPerMinute) frameNumber += dropPerMinute * Math.floor((remainder - dropPerMinute) / framesPerMinute);
    const ff = frameNumber % nominal;
    const ss = Math.floor(frameNumber / nominal) % 60;
    const mm = Math.floor(frameNumber / (nominal * 60)) % 60;
    const hh = Math.floor(frameNumber / (nominal * 3600));
    return `${pad(hh)}:${pad(mm)};${pad(ss)};${pad(ff)}`;
  }
  const ff = totalFrames % nominal;
  const s = Math.floor(totalFrames / nominal);
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}:${pad(ff)}`;
}

function pad(n: number) {
  return String(n).padStart(2, '0');
}
