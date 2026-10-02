// Importing files into the project. OWNED BY THE MEDIA PACKAGE.
//
// importMedia(paths) probes media concurrently (3 at a time), routes .cube
// files to project LUTs and .srt/.vtt files to new caption tracks, skips
// files already in the project, and commits everything as ONE undo step
// ('Import 4 files'). Bad files never abort an import: they are collected and
// reported in a single toast. Imports are serialized, and their progress is
// published on mediaJobs.importing.

import { parseCaptions } from '../captions/format';
import { parseCube } from '../color/lut';
import { makeTrack } from '../../state/defaults';
import { useEditor } from '../../state/store';
import type { CaptionCue, LutRef, MediaAsset } from '../../state/types';
import { activeSequence, newId } from '../../state/types';
import { setImportProgress, suggestProxies } from './jobs';
import { basename, defaultDropFrame, evenDim, extOf, mapLimit, posterTime, routeForPath, stem } from './mediaMath';
import { probeFile } from './probe';
import { proxyCandidates } from './proxies';
import { requestThumbnails } from './thumbnails';

export interface ImportOptions {
  /** Bin that receives the new assets (null = project root). Missing bins fall back to the root. */
  binId?: string | null;
  /** Known file sizes (e.g. from the import dialog), saves a request per file. */
  sizes?: Record<string, number>;
  /** Select the imported assets in the media browser (default true). */
  select?: boolean;
}

export interface ImportFailure {
  path: string;
  name: string;
  error: string;
}

export interface ImportResult {
  assetIds: string[];
  lutIds: string[];
  captionTrackIds: string[];
  /** Paths already in the project. */
  skipped: string[];
  failed: ImportFailure[];
  warnings: string[];
  /** Set when the sequence adopted the first clip's format. */
  matchedFormat: { width: number; height: number; fps: number } | null;
}

const NOT_IMPLEMENTED = /not implemented/i;
let chain: Promise<unknown> = Promise.resolve();

/** Imports files (serialized with other imports). Never throws. */
export function importMedia(paths: string[], opts: ImportOptions = {}): Promise<ImportResult> {
  const run = () => runImport(paths, opts);
  const p = chain.then(run, run);
  chain = p.catch(() => undefined);
  return p.catch((err) => {
    console.error('[media] import failed', err);
    useEditor.getState().showToast(`Import failed: ${err instanceof Error ? err.message : String(err)}`, 'error');
    setImportProgress(null);
    return emptyResult();
  });
}

function emptyResult(): ImportResult {
  return { assetIds: [], lutIds: [], captionTrackIds: [], skipped: [], failed: [], warnings: [], matchedFormat: null };
}

interface CaptionFile {
  path: string;
  name: string;
  cues: CaptionCue[];
}

async function runImport(rawPaths: string[], opts: ImportOptions): Promise<ImportResult> {
  const result = emptyResult();
  const project = useEditor.getState().project;
  if (!project || !rawPaths?.length) return result;

  const known = new Set([...project.assets.map((a) => a.path), ...project.luts.map((l) => l.path)]);
  const seen = new Set<string>();
  const media: string[] = [];
  const luts: string[] = [];
  const captions: string[] = [];
  for (const p of rawPaths) {
    if (typeof p !== 'string' || !p || seen.has(p)) continue;
    seen.add(p);
    if (known.has(p)) {
      result.skipped.push(p);
      continue;
    }
    const route = routeForPath(p);
    if (route === 'media') media.push(p);
    else if (route === 'lut') luts.push(p);
    else if (route === 'caption') captions.push(p);
    else result.failed.push({ path: p, name: basename(p), error: extOf(p) ? `.${extOf(p)} files are not supported` : 'Not a media file' });
  }

  const total = media.length + luts.length + captions.length;
  let done = 0;
  const tick = (current: string) => setImportProgress({ total, done, current });
  if (total) tick('');

  // ---- media (probed concurrently) ----
  const assets: MediaAsset[] = [];
  const probed = await mapLimit(media, 3, async (path) => {
    tick(basename(path));
    const r = await probeFile(path, { size: opts.sizes?.[path] });
    done++;
    tick('');
    return r;
  });
  for (const r of probed) {
    if (r.ok) {
      assets.push(r.asset);
      for (const w of r.warnings) result.warnings.push(`${r.asset.name}: ${w}`);
    } else result.failed.push({ path: r.path, name: r.name, error: r.error });
  }

  // ---- LUTs ----
  const lutRefs: LutRef[] = [];
  for (const path of luts) {
    tick(basename(path));
    try {
      const text = await window.omega.files.readText(path);
      try {
        parseCube(text);
      } catch (err) {
        // the LUT parser may not exist yet: accept the file, the renderer validates on load
        if (!NOT_IMPLEMENTED.test(String((err as Error)?.message ?? err))) throw new Error(`Not a valid .cube LUT (${(err as Error).message})`);
      }
      lutRefs.push({ id: newId('lut'), name: stem(path), path });
    } catch (err) {
      result.failed.push({ path, name: basename(path), error: err instanceof Error ? err.message : String(err) });
    }
    done++;
  }

  // ---- captions ----
  const captionFiles: CaptionFile[] = [];
  let captionsUnavailable = false;
  for (const path of captions) {
    tick(basename(path));
    try {
      const text = await window.omega.files.readText(path);
      let cues: CaptionCue[];
      try {
        cues = parseCaptions(text, extOf(path) === 'vtt' ? 'vtt' : 'srt');
      } catch (err) {
        if (NOT_IMPLEMENTED.test(String((err as Error)?.message ?? err))) {
          captionsUnavailable = true;
          throw new Error('Caption import is not available yet');
        }
        throw new Error(`Could not read captions (${(err as Error).message})`);
      }
      if (!cues.length) throw new Error('No captions found in the file');
      captionFiles.push({ path, name: stem(path), cues: cues.map((c) => ({ ...c, id: c.id || newId('cue') })) });
    } catch (err) {
      result.failed.push({ path, name: basename(path), error: err instanceof Error ? err.message : String(err) });
    }
    done++;
  }
  setImportProgress(null);

  // ---- commit: one undo step ----
  const count = assets.length + lutRefs.length + captionFiles.length;
  if (count) {
    const state = useEditor.getState();
    const binId = opts.binId && state.project?.bins.some((b) => b.id === opts.binId) ? opts.binId : null;
    const label = `Import ${count} file${count === 1 ? '' : 's'}`;
    let matched: ImportResult['matchedFormat'] = null;
    let matchedName = '';
    const trackIds: string[] = [];
    state.mutate(label, (d) => {
      const paths = new Set(d.assets.map((a) => a.path));
      for (const a of assets) {
        if (paths.has(a.path)) continue;
        d.assets.push({ ...a, binId });
        result.assetIds.push(a.id);
      }
      for (const l of lutRefs) {
        if (d.luts.some((x) => x.path === l.path)) continue;
        d.luts.push(l);
        result.lutIds.push(l.id);
      }
      const seq = activeSequence(d);
      if (seq) {
        for (const c of captionFiles) {
          const track = makeTrack('caption', c.name);
          track.cues = c.cues;
          seq.tracks.push(track);
          trackIds.push(track.id);
        }
        // Match first clip: the empty sequence adopts the first video's format.
        if (d.settings.matchFirstClip && !seq.tracks.some((t) => t.clips.length > 0)) {
          const first = assets.find((a) => a.kind === 'video' && a.width && a.height && result.assetIds.includes(a.id));
          if (first) {
            seq.width = evenDim(first.width!);
            seq.height = evenDim(first.height!);
            if (first.fps && first.fps > 0) {
              seq.fps = first.fps;
              seq.dropFrame = defaultDropFrame(first.fps);
            }
            d.settings.matchFirstClip = false;
            matched = { width: seq.width, height: seq.height, fps: seq.fps };
            matchedName = first.name;
          }
        }
      }
    });
    result.captionTrackIds = trackIds;
    result.matchedFormat = matched;
    if (opts.select !== false && result.assetIds.length) useEditor.getState().select({ assetIds: [...result.assetIds] });

    // posters first, for the browser
    const added = useEditor.getState().project?.assets.filter((a) => result.assetIds.includes(a.id)) ?? [];
    for (const a of added) if (a.kind !== 'audio') requestThumbnails(a, [posterTime(a)]);
    const proxyIds = proxyCandidates(added);
    if (proxyIds.length) suggestProxies(proxyIds);

    report(result, matchedName, captionsUnavailable);
  } else {
    report(result, '', captionsUnavailable);
  }
  return result;
}

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function report(r: ImportResult, matchedName: string, captionsUnavailable: boolean) {
  const { showToast } = useEditor.getState();
  const parts: string[] = [];
  const added = r.assetIds.length + r.lutIds.length + r.captionTrackIds.length;
  if (r.assetIds.length) parts.push(plural(r.assetIds.length, 'clip'));
  if (r.lutIds.length) parts.push(plural(r.lutIds.length, 'LUT'));
  if (r.captionTrackIds.length) parts.push(plural(r.captionTrackIds.length, 'caption track'));
  let msg = added ? `Imported ${parts.join(', ')}` : '';
  if (r.matchedFormat) {
    const f = r.matchedFormat;
    msg += `${msg ? '. ' : ''}Sequence set to ${f.width}×${f.height} at ${f.fps} fps to match ${matchedName}`;
  }
  if (r.skipped.length) msg += `${msg ? ' · ' : ''}${plural(r.skipped.length, 'file')} already in the project`;
  if (r.failed.length) {
    const list = r.failed.slice(0, 2).map((f) => `${f.name} (${f.error})`).join('; ');
    const more = r.failed.length > 2 ? ` and ${r.failed.length - 2} more` : '';
    const head = captionsUnavailable && r.failed.every((f) => /caption import/i.test(f.error)) ? 'Caption import is not available yet' : `Could not import ${list}${more}`;
    showToast(msg ? `${msg}. ${head}` : head, 'error');
    for (const f of r.failed) console.warn('[media] import failed:', f.path, f.error);
    return;
  }
  if (r.warnings.length) {
    showToast(`${msg ? `${msg}. ` : ''}${r.warnings[0]}${r.warnings.length > 1 ? ` (+${r.warnings.length - 1} more)` : ''}`, 'info');
    return;
  }
  if (msg) showToast(msg, added ? 'success' : 'info');
}
