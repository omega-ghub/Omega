// Color commands. Each is registered as an action (palette, menus, keys) in
// index.ts and used directly by the panel's buttons.
import { useEditor } from '../../../state/store';
import { newId } from '../../../state/types';
import type { LutRef } from '../../../state/types';
import { formatTimecode } from '../../../engine/time';
import { paramAt } from '../../../engine/keyframes';
import { loadLut, parseCube, setLoadedLut, type ParsedLut } from '../../../engine/color/lut';
import { onFrameRendered } from '../../../engine/playback/viewerBus';
import { estimateIlluminant, solveMatch, solveWhiteBalance } from '../../../engine/scopes/analysis';
import { readProgramFrame, READBACK_WIDTH } from '../../../engine/scopes/feed';
import type { PixelReadback } from '../../../engine/gpu/Renderer';
import { clipLocal, editGradeClip, editGradeClips, getGradeClip, gradeTargetIds, playheadOverClip } from './grade';
import { linearTable, logDomainTable, wbMatrix } from './gradeModel';
import { applyGradeToSource, applyLookTo, applyMatchTo, applyWhiteBalanceTo, gradeSnapshot, pasteGradeInto, resetGradeOf, setSourceInputTransform } from './gradeOps';
import { LOOK_BY_ID } from './looks';
import { addStill, getReference } from './stills';
import type { InputTransform } from '../../../state/types';

const toast = (m: string, k: 'info' | 'success' | 'error' = 'info') => useEditor.getState().showToast(m, k);

export const hasTarget = () => gradeTargetIds().length > 0;

// ---------------------------------------------------------------------------
// Frame capture
// ---------------------------------------------------------------------------

function nextFrame(timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      off();
      clearTimeout(timer);
      resolve();
    };
    const off = onFrameRendered(finish);
    const timer = setTimeout(finish, timeoutMs);
  });
}

/**
 * Reads the program frame as graded, without the split / bypass compare or
 * the qualifier matte (those are temporarily switched off for one frame).
 */
export async function captureCleanFrame(maxWidth = READBACK_WIDTH): Promise<PixelReadback | null> {
  const { viewer, setViewer } = useEditor.getState();
  const dirty = viewer.compare !== 'off' || viewer.showMatte;
  if (!dirty) return readProgramFrame(maxWidth);
  const saved = { compare: viewer.compare, showMatte: viewer.showMatte };
  setViewer({ compare: 'off', showMatte: false });
  await nextFrame(1200);
  const frame = readProgramFrame(maxWidth);
  setViewer(saved);
  return frame;
}

function requireClipAtPlayhead(verb: string) {
  const hit = getGradeClip();
  if (!hit) {
    toast(`Select a clip to ${verb}.`);
    return null;
  }
  if (!playheadOverClip(hit.clip)) {
    toast(`Move the playhead over “${hit.clip.name}” to ${verb}.`);
    return null;
  }
  return hit;
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

export function copyGrade() {
  const hit = getGradeClip();
  if (!hit) return toast('Select a clip to copy its grade.');
  const s = useEditor.getState();
  s.setGradeClipboard(gradeSnapshot(hit.clip, clipLocal(hit.clip, s.playhead)));
  toast(`Copied the grade of “${hit.clip.name}”`, 'success');
}

export function pasteGrade() {
  const s = useEditor.getState();
  const g = s.gradeClipboard;
  const ids = gradeTargetIds(s);
  if (!g) return toast('Copy a grade first.');
  if (!ids.length) return toast('Select clips to paste the grade to.');
  // a LUT that no longer exists in the project is dropped
  const lutOk = !g.lut.id || !!s.project?.luts.some((l) => l.id === g.lut.id);
  const grade = lutOk ? g : { ...g, lut: { ...g.lut, id: null } };
  editGradeClips(ids, ids.length > 1 ? `Paste grade to ${ids.length} clips` : 'Paste grade', (c) => pasteGradeInto(c, grade));
}

export function resetGrade() {
  const ids = gradeTargetIds();
  if (!ids.length) return toast('Select a clip to reset its grade.');
  editGradeClips(ids, ids.length > 1 ? `Reset grade of ${ids.length} clips` : 'Reset grade', (c) => resetGradeOf(c));
}

export function toggleBypass() {
  const hit = getGradeClip();
  if (!hit) return toast('Select a clip to bypass its grade.');
  const on = !hit.clip.grade.enabled;
  editGradeClips(gradeTargetIds(), on ? 'Enable grade' : 'Bypass grade', (c) => {
    c.grade.enabled = on;
  });
}

export function setCompare(mode: 'off' | 'split' | 'bypass') {
  const s = useEditor.getState();
  s.setViewer({ compare: s.viewer.compare === mode ? 'off' : mode });
}

export function toggleMatte() {
  const s = useEditor.getState();
  s.setViewer({ showMatte: !s.viewer.showMatte });
}

export function applyLook(lookId: string) {
  const look = LOOK_BY_ID.get(lookId);
  const ids = gradeTargetIds();
  if (!look) return;
  if (!ids.length) return toast('Select a clip to apply a look.');
  editGradeClips(ids, `Apply look “${look.name}”`, (c) => applyLookTo(c, look));
}

export function applyToSource() {
  const hit = getGradeClip();
  if (!hit) return toast('Select a clip first.');
  if (!hit.clip.assetId) return toast('Only media clips have a source.');
  const snap = gradeSnapshot(hit.clip, clipLocal(hit.clip, useEditor.getState().playhead));
  let n = 0;
  useEditor.getState().mutate('Apply grade to all clips from this source', (d) => {
    n = applyGradeToSource(d, hit.clip.assetId!, snap, hit.clip.id);
  });
  toast(n ? `Applied to ${n} other clip${n === 1 ? '' : 's'} from this source` : 'No other clips use this source', n ? 'success' : 'info');
}

export function setClipInputTransform(clipId: string, it: InputTransform) {
  editGradeClip(clipId, 'Change input transform', (c) => {
    c.grade.inputTransform = it;
  });
}

export function setInputTransformForSource() {
  const hit = getGradeClip();
  if (!hit?.clip.assetId) return toast('Select a media clip first.');
  const asset = hit.project.assets.find((a) => a.id === hit.clip.assetId);
  if (!asset) return;
  const it = hit.clip.grade.inputTransform === 'auto' ? asset.inputTransform : hit.clip.grade.inputTransform;
  useEditor.getState().mutate(`Set input transform for “${asset.name}”`, (d) => {
    setSourceInputTransform(d, asset.id, it);
  });
  toast(`All clips of “${asset.name}” now use its input transform`, 'success');
}

/**
 * Auto balance: measure the current frame (gray world + white point, see
 * engine/scopes/analysis.ts), then set temperature/tint (and gain for any
 * remainder) so the estimated illuminant becomes neutral. One undo step.
 */
export async function autoBalance() {
  const hit = requireClipAtPlayhead('balance it');
  if (!hit) return;
  const frame = await captureCleanFrame();
  if (!frame) return toast('No picture to analyse: the program viewer has not drawn a frame yet.');
  const est = estimateIlluminant(frame, linearTable(hit.seq.colorSpace));
  if (!est) return toast('This frame is too dark or clipped to balance.', 'error');
  const s = useEditor.getState();
  const local = clipLocal(hit.clip, s.playhead);
  const current = { temperature: paramAt(hit.clip, 'grade.temperature', local), tint: paramAt(hit.clip, 'grade.tint', local) };
  const sol = solveWhiteBalance(est.cast, wbMatrix, current);
  const dT = sol.temperature - current.temperature;
  const dN = sol.tint - current.tint;
  if (Math.abs(dT) < 0.5 && Math.abs(dN) < 0.5 && sol.residual.every((r) => Math.abs(r - 1) < 0.004)) return toast('Already balanced', 'success');
  editGradeClip(hit.clip.id, 'Auto balance', (c) => applyWhiteBalanceTo(c, local, sol));
  toast(`Balanced: temperature ${fmt(sol.temperature)}, tint ${fmt(sol.tint)}`, 'success');
}

/** Match the selected clip to the reference still (mean/std per channel + saturation). */
export async function matchToReference() {
  const ref = getReference();
  if (!ref) return toast('Grab a still and select it as the reference first.');
  const hit = requireClipAtPlayhead('match it');
  if (!hit) return;
  const frame = await captureCleanFrame();
  if (!frame) return toast('No picture to analyse: the program viewer has not drawn a frame yet.');
  const sol = solveMatch(frame, ref, logDomainTable(hit.seq.colorSpace));
  const local = clipLocal(hit.clip, useEditor.getState().playhead);
  editGradeClip(hit.clip.id, 'Match to reference', (c) => applyMatchTo(c, local, sol));
  toast('Matched to the reference still. Run again to refine.', 'success');
}

export async function grabStill() {
  const frame = await captureCleanFrame();
  if (!frame) return toast('Nothing to grab: the program viewer has not drawn a frame yet.');
  const s = useEditor.getState();
  if (!s.project) return;
  const hit = getGradeClip(s);
  const seq = hit?.seq;
  const fps = seq?.fps ?? s.project.settings.fps;
  const tc = seq ? formatTimecode(s.playhead, seq.fps, seq.dropFrame, seq.startTimecode) : formatTimecode(s.playhead, fps);
  addStill({ width: frame.width, height: frame.height, data: frame.data, time: s.playhead, timecode: tc, clipId: hit?.clip.id ?? null, clipName: hit?.clip.name ?? '' });
  toast(`Still grabbed at ${tc}`, 'success');
}

const fmt = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}`;

// ---------------------------------------------------------------------------
// LUTs
// ---------------------------------------------------------------------------

const baseName = (p: string) => p.replace(/^.*[\\/]/, '').replace(/\.cube$/i, '');

/** Import .cube files into the project; assigns the first to the selected clip if it has none. */
export async function importLuts(): Promise<void> {
  const s = useEditor.getState();
  if (!s.project) return;
  let paths: string[] = [];
  try {
    paths = await window.omega.dialogs.pickFiles('Import LUT', ['cube']);
  } catch (err) {
    return toast(`Could not open the file dialog: ${(err as Error).message}`, 'error');
  }
  if (!paths?.length) return;
  const added: LutRef[] = [];
  const parsedById = new Map<string, ParsedLut>();
  const failed: string[] = [];
  for (const path of paths) {
    const existing = useEditor.getState().project?.luts.find((l) => l.path === path);
    if (existing) {
      added.push(existing);
      continue;
    }
    try {
      const text = await window.omega.files.readText(path);
      const parsed = parseCube(text);
      const name = parsed.title?.trim() || baseName(path);
      const id = newId('lut');
      parsedById.set(id, parsed);
      added.push({ id, name, path });
    } catch (err) {
      failed.push(`${baseName(path)}: ${(err as Error).message}`);
    }
  }
  if (failed.length) toast(`Not a valid .cube LUT — ${failed.join('; ')}`, 'error');
  const fresh = added.filter((l) => !useEditor.getState().project?.luts.some((x) => x.id === l.id));
  const target = getGradeClip();
  const assign = target && !target.clip.grade.lut.id ? added[0] : undefined;
  if (!fresh.length && !assign) return;
  useEditor.getState().mutate(fresh.length > 1 ? `Import ${fresh.length} LUTs` : assign && !fresh.length ? 'Assign LUT' : 'Import LUT', (d) => {
    for (const l of fresh) d.luts.push(l);
    if (assign && target) {
      for (const seq of d.sequences)
        for (const tr of seq.tracks)
          for (const c of tr.clips) if (c.id === target.clip.id) c.grade.lut.id = assign.id;
    }
  });
  for (const l of fresh) {
    const parsed = parsedById.get(l.id);
    if (parsed) setLoadedLut(l.id, parsed, l.path);
    else loadLut(l.id, l.path).catch(() => {});
  }
  if (fresh.length && !failed.length) toast(fresh.length > 1 ? `Imported ${fresh.length} LUTs` : `Imported “${fresh[0].name}”`, 'success');
}

export function setClipLut(clipId: string, lutId: string | null) {
  const lut = lutId ? useEditor.getState().project?.luts.find((l) => l.id === lutId) : null;
  editGradeClip(clipId, lut ? `Apply LUT “${lut.name}”` : 'Remove LUT from clip', (c) => {
    c.grade.lut.id = lut ? lut.id : null;
  });
  if (lut) loadLut(lut.id, lut.path).catch(() => toast(`Could not load “${lut.name}”. Is the file still there?`, 'error'));
}

/** Removes a LUT from the project and from every clip that used it. */
export function removeLut(lutId: string) {
  const lut = useEditor.getState().project?.luts.find((l) => l.id === lutId);
  if (!lut) return;
  useEditor.getState().mutate(`Remove LUT “${lut.name}”`, (d) => {
    d.luts = d.luts.filter((l) => l.id !== lutId);
    for (const seq of d.sequences) for (const tr of seq.tracks) for (const c of tr.clips) if (c.grade.lut.id === lutId) c.grade.lut.id = null;
  });
}
