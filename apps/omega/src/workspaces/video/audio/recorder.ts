// Voiceover recording: arm an audio track, 3-2-1 count-in, record the
// microphone with MediaRecorder (Opus in WebM) while the program plays, then
// save to <project>/Voiceover/VO <date>.webm, import it and place it at the
// record start on the armed track. The recorded take is aligned to what was
// heard: the time between the recorder starting and the program becoming
// audible is trimmed from the head of the clip.

import { AudioEngine } from '../../../engine/audio/engine';
import { placeMedia } from '../../../engine/edit/ops';
import { probeMedia } from '../../../engine/media/probe';
import { transport } from '../../../engine/playback/transport';
import { makeAsset, makeClip } from '../../../state/defaults';
import { useEditor } from '../../../state/store';
import type { MediaAsset, Project, Sequence, Track } from '../../../state/types';
import { activeSequence, newId } from '../../../state/types';
import { useAudioUi } from './uiStore';

interface Take {
  stream: MediaStream;
  recorder: MediaRecorder | null;
  chunks: Blob[];
  mime: string;
  analyser: AnalyserNode | null;
  sourceNode: MediaStreamAudioSourceNode | null;
  countdownTimer: number;
  recStartPerf: number;
  audiblePerf: number | null;
  cancelled: boolean;
}

let take: Take | null = null;
const levelBuf = new Float32Array(2048);

/** Live input level of the microphone (dBFS), for the input meter. */
export function inputLevel(): { peak: number; rms: number } {
  const an = take?.analyser;
  if (!an) return { peak: -Infinity, rms: -Infinity };
  an.getFloatTimeDomainData(levelBuf);
  let pk = 0;
  let s = 0;
  for (let i = 0; i < levelBuf.length; i++) {
    const v = levelBuf[i];
    const a = v < 0 ? -v : v;
    if (a > pk) pk = a;
    s += v * v;
  }
  const db = (x: number) => (x > 0 ? 20 * Math.log10(x) : -Infinity);
  return { peak: db(pk), rms: db(Math.sqrt(s / levelBuf.length)) };
}

function toast(msg: string, kind: 'info' | 'success' | 'error' = 'info') {
  useEditor.getState().showToast(msg, kind);
}

function seqOf(p: Project): Sequence {
  return activeSequence(p);
}

/** The armed track, or (arming it) the selected / first unlocked audio track. */
export function resolveArmedTrack(): Track | null {
  const s = useEditor.getState();
  if (!s.project) return null;
  const seq = seqOf(s.project);
  const audio = seq.tracks.filter((t) => t.kind === 'audio');
  const ui = useAudioUi.getState();
  let t = audio.find((x) => x.id === ui.armedTrackId) ?? null;
  if (!t) {
    const selected = audio.find((x) => x.id === s.selection.trackId);
    t = selected ?? audio.find((x) => !x.locked) ?? null;
    if (t) ui.set({ armedTrackId: t.id });
  }
  return t;
}

function beep(freq: number) {
  void AudioEngine.get()
    .context()
    .then((ctx) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.frequency.value = freq;
      g.gain.setValueAtTime(0, ctx.currentTime);
      g.gain.linearRampToValueAtTime(0.12, ctx.currentTime + 0.005);
      g.gain.setValueAtTime(0.12, ctx.currentTime + 0.07);
      g.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.09);
      osc.connect(g).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.1);
    })
    .catch(() => {});
}

export function isRecording(): boolean {
  return useAudioUi.getState().phase !== 'idle';
}

/** Starts (count-in, then record) or stops the voiceover take. */
export function toggleVoiceover(): void {
  const phase = useAudioUi.getState().phase;
  if (phase === 'idle') void startVoiceover();
  else if (phase === 'countdown') cancelVoiceover();
  else if (phase === 'recording') stopVoiceover();
}

export async function startVoiceover(): Promise<void> {
  const ui = useAudioUi.getState();
  if (ui.phase !== 'idle') return;
  const s = useEditor.getState();
  if (!s.project || !s.handle) {
    toast('Open a saved project to record a voiceover.', 'error');
    return;
  }
  const track = resolveArmedTrack();
  if (!track) {
    toast('Add an audio track to record a voiceover.', 'error');
    return;
  }
  if (track.locked) {
    toast(`${track.name} is locked. Unlock it or arm another track.`, 'error');
    return;
  }
  if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    toast('Recording is not available on this system.', 'error');
    return;
  }
  ui.set({ phase: 'countdown', countdown: 3, error: null });
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
  } catch (err) {
    ui.set({ phase: 'idle', countdown: 0 });
    toast(`Microphone unavailable: ${(err as Error).message || 'permission denied'}`, 'error');
    return;
  }
  if (useAudioUi.getState().phase !== 'countdown') {
    stream.getTracks().forEach((t) => t.stop());
    return;
  }
  const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'].find((m) => MediaRecorder.isTypeSupported(m)) ?? '';
  take = { stream, recorder: null, chunks: [], mime, analyser: null, sourceNode: null, countdownTimer: 0, recStartPerf: 0, audiblePerf: null, cancelled: false };
  // input meter
  try {
    const ctx = await AudioEngine.get().context();
    const src = ctx.createMediaStreamSource(stream);
    const an = ctx.createAnalyser();
    an.fftSize = 2048;
    src.connect(an);
    take.analyser = an;
    take.sourceNode = src;
  } catch {
    /* meter is optional */
  }
  // 3-2-1 count-in
  const t = take;
  let n = 3;
  beep(880);
  t.countdownTimer = window.setInterval(() => {
    n--;
    if (t.cancelled) return;
    if (n > 0) {
      useAudioUi.getState().set({ countdown: n });
      beep(880);
    } else {
      window.clearInterval(t.countdownTimer);
      beep(1320);
      beginRecording(t);
    }
  }, 1000);
}

function beginRecording(t: Take) {
  if (t.cancelled || take !== t) return;
  const s = useEditor.getState();
  const recordStart = s.playhead;
  let recorder: MediaRecorder;
  try {
    recorder = new MediaRecorder(t.stream, t.mime ? { mimeType: t.mime, audioBitsPerSecond: 192_000 } : undefined);
  } catch (err) {
    finish(t);
    toast(`Could not start recording: ${(err as Error).message}`, 'error');
    return;
  }
  t.recorder = recorder;
  recorder.ondataavailable = (e) => {
    if (e.data.size) t.chunks.push(e.data);
  };
  recorder.onstop = () => void save(t, recordStart);
  recorder.start(1000);
  t.recStartPerf = performance.now();
  useAudioUi.getState().set({ phase: 'recording', countdown: 0, recordStart, recordStartedAt: Date.now() });
  // play the program so the take can be performed to picture
  transport.play();
  // measure when the record-start position became audible (alignment)
  const engine = AudioEngine.get();
  const watch = () => {
    if (take !== t || !t.recorder || t.recorder.state !== 'recording') return;
    if (engine.playing) {
      const now = engine.currentTime();
      if (now > recordStart + 1e-3) {
        t.audiblePerf = performance.now() - (now - recordStart) * 1000;
        return;
      }
    }
    if (performance.now() - t.recStartPerf < 3000) requestAnimationFrame(watch);
  };
  requestAnimationFrame(watch);
}

export function stopVoiceover(): void {
  const t = take;
  if (!t?.recorder || t.recorder.state === 'inactive') return;
  useAudioUi.getState().set({ phase: 'saving' });
  transport.pause();
  t.recorder.stop();
}

export function cancelVoiceover(): void {
  const t = take;
  if (!t) {
    useAudioUi.getState().set({ phase: 'idle', countdown: 0 });
    return;
  }
  t.cancelled = true;
  window.clearInterval(t.countdownTimer);
  if (t.recorder && t.recorder.state !== 'inactive') {
    t.recorder.onstop = null;
    t.recorder.stop();
    transport.pause();
  }
  finish(t);
}

function finish(t: Take) {
  window.clearInterval(t.countdownTimer);
  t.stream.getTracks().forEach((x) => x.stop());
  try {
    t.sourceNode?.disconnect();
  } catch {
    /* ignore */
  }
  if (take === t) take = null;
  useAudioUi.getState().set({ phase: 'idle', countdown: 0, inputDb: -Infinity });
}

function stamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}.${p(d.getMinutes())}.${p(d.getSeconds())}`;
}

async function save(t: Take, recordStart: number) {
  const elapsed = (performance.now() - t.recStartPerf) / 1000;
  const inputLatency = (t.stream.getAudioTracks()[0]?.getSettings() as { latency?: number })?.latency ?? 0;
  const align = t.audiblePerf !== null ? Math.max(0, Math.min(1, (t.audiblePerf - t.recStartPerf) / 1000 + inputLatency)) : 0;
  const armed = useAudioUi.getState().armedTrackId;
  finish(t);
  useAudioUi.getState().set({ phase: 'saving' });
  try {
    const s = useEditor.getState();
    if (!s.project || !s.handle) throw new Error('The project was closed.');
    const blob = new Blob(t.chunks, { type: t.mime || 'audio/webm' });
    if (blob.size < 100) throw new Error('Nothing was recorded.');
    const ext = t.mime.includes('ogg') ? 'ogg' : 'webm';
    const sep = s.handle.dir.includes('\\') && !s.handle.dir.includes('/') ? '\\' : '/';
    const name = `VO ${stamp()}.${ext}`;
    const path = `${s.handle.dir}${sep}Voiceover${sep}${name}`;
    await window.omega.files.writeBinary(path, await blob.arrayBuffer());
    let asset: MediaAsset;
    try {
      asset = await probeMedia(path, name);
    } catch {
      asset = makeAsset({ name, path, kind: 'audio', duration: elapsed, hasAudio: true, hasVideo: false });
    }
    if (!(asset.duration > 0) || !Number.isFinite(asset.duration)) asset = { ...asset, duration: elapsed };
    asset = { ...asset, kind: 'audio', hasAudio: true, hasVideo: false };
    const clipDuration = Math.max(0.05, asset.duration - align);
    let placedId: string | null = null;
    useEditor.getState().mutate('Record voiceover', (draft) => {
      const seq = activeSequence(draft);
      let bin = draft.bins.find((b) => b.name === 'Voiceover' && b.parentId === null);
      if (!bin) {
        bin = { id: newId('bin'), name: 'Voiceover', parentId: null };
        draft.bins.push(bin);
      }
      draft.assets.push({ ...asset, binId: bin.id });
      const trackId = seq.tracks.find((x) => x.id === armed && x.kind === 'audio')?.id ?? seq.tracks.find((x) => x.kind === 'audio')?.id;
      if (!trackId) return;
      try {
        const ids = placeMedia(draft, seq, asset.id, { start: recordStart, mode: 'overwrite', audioTrackId: trackId, videoTrackId: null, sourceIn: align, sourceOut: asset.duration });
        placedId = ids?.[0] ?? null;
      } catch {
        placedId = overwriteClip(seq, trackId, asset, recordStart, align, clipDuration);
      }
    });
    if (placedId) useEditor.getState().selectClips([placedId]);
    toast(`Voiceover recorded: ${name} (${clipDuration.toFixed(1)} s)`, 'success');
  } catch (err) {
    toast(`Voiceover not saved: ${(err as Error).message}`, 'error');
  } finally {
    useAudioUi.getState().set({ phase: 'idle' });
  }
}

/** Fallback placement while the edit package's placeMedia is unavailable: overwrite on one track. */
function overwriteClip(seq: Sequence, trackId: string, asset: MediaAsset, start: number, inPoint: number, duration: number): string | null {
  const track = seq.tracks.find((t) => t.id === trackId);
  if (!track) return null;
  const end = start + duration;
  const kept = [];
  for (const c of track.clips) {
    const cs = c.start;
    const ce = c.start + c.duration;
    if (ce <= start || cs >= end) {
      kept.push(c);
      continue;
    }
    if (cs < start) kept.push({ ...c, duration: start - cs, transitionOut: null });
    if (ce > end) {
      const cut = end - cs;
      kept.push({ ...c, id: newId('clip'), start: end, duration: ce - end, inPoint: c.inPoint + cut * c.speed, transitionIn: null, linkId: undefined });
    }
  }
  const clip = makeClip('media', { assetId: asset.id, name: asset.name, start, duration, inPoint, label: 'violet' });
  kept.push(clip);
  kept.sort((a, b) => a.start - b.start);
  track.clips = kept;
  return clip.id;
}
