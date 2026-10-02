import { useEffect } from 'react';
import { useStore } from '../../state/store';
import { sequenceDuration } from '../../state/types';
import { playerHost } from './playerHost';

function isTyping(e: KeyboardEvent) {
  const el = e.target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

export function useShortcuts(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e)) return;
      const s = useStore.getState();
      const project = s.project;
      if (!project) return;
      const player = playerHost.current;
      const fps = project.settings.fps;
      const frame = 1 / fps;
      const ctrl = e.ctrlKey || e.metaKey;
      const duration = sequenceDuration(project.sequence);
      const seekTo = (t: number) => {
        const clamped = Math.max(0, Math.min(t, duration));
        if (player) player.seek(clamped);
        else s.setPlayhead(clamped);
      };
      const editPoints = () => {
        const pts = new Set<number>([0, duration]);
        for (const t of project.sequence.tracks) for (const c of t.clips) pts.add(c.start).add(c.start + c.duration);
        return [...pts].sort((a, b) => a - b);
      };

      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      let handled = true;
      switch (true) {
        case key === ' ':
          player?.toggle();
          break;
        case key === 'k' && !ctrl:
          player?.pause();
          break;
        case key === 'l':
          player?.play();
          break;
        case key === 'j':
          player?.pause();
          seekTo(s.playhead - 1);
          break;
        case key === 'ArrowLeft':
          player?.pause();
          seekTo(s.playhead - (e.shiftKey ? 5 : 1) * frame);
          break;
        case key === 'ArrowRight':
          player?.pause();
          seekTo(s.playhead + (e.shiftKey ? 5 : 1) * frame);
          break;
        case key === 'Home':
          seekTo(0);
          break;
        case key === 'End':
          seekTo(duration);
          break;
        case key === 'ArrowUp': {
          const prev = editPoints().filter((p) => p < s.playhead - 1e-6).pop();
          if (prev !== undefined) seekTo(prev);
          break;
        }
        case key === 'ArrowDown': {
          const next = editPoints().find((p) => p > s.playhead + 1e-6);
          if (next !== undefined) seekTo(next);
          break;
        }
        case key === 'i' && !ctrl:
          s.setInPoint(s.playhead);
          break;
        case key === 'o' && !ctrl:
          s.setOutPoint(s.playhead);
          break;
        case key === 'x' && ctrl && e.shiftKey:
          s.setInPoint(null);
          s.setOutPoint(null);
          break;
        case key === 'v' && !ctrl:
          s.setTool('select');
          break;
        case key === 'c' && !ctrl:
          s.setTool('razor');
          break;
        case key === 'k' && ctrl:
          s.splitAtPlayhead();
          break;
        case key === 'Delete' || key === 'Backspace':
          s.deleteSelected();
          break;
        case key === 'a' && ctrl:
          s.selectClips(project.sequence.tracks.flatMap((t) => t.clips.map((c) => c.id)));
          break;
        case key === 'z' && ctrl && e.shiftKey:
        case key === 'y' && ctrl:
          s.redo();
          break;
        case key === 'z' && ctrl:
          s.undo();
          break;
        case key === ',':
          if (s.selectedAssetId) s.addClip(s.selectedAssetId, null, null);
          break;
        case key === '=' || key === '+':
          s.setZoom(s.zoom * 1.25);
          break;
        case key === '-':
          s.setZoom(s.zoom / 1.25);
          break;
        case key === '\\': {
          const width = document.querySelector('.tl__scroll')?.clientWidth ?? 1000;
          s.setZoom(Math.max(4, (width - 160) / Math.max(duration, 1)));
          break;
        }
        case key === 'i' && ctrl:
          void s.importMedia();
          break;
        case key === 's' && ctrl:
          void s.saveProject();
          break;
        case key === 'm' && ctrl:
          s.setExportOpen(true);
          break;
        default:
          handled = false;
      }
      if (handled) e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);
}
