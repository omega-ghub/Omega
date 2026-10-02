// Inline title editing over the program picture. While editing, the clip is
// left out of the render and this contentEditable shows the text in the
// title's own font, size, rotation and scale. Escape, Mod+Enter or clicking
// away commits; an empty new title is removed again.
import { useEffect, useLayoutEffect, useRef } from 'react';
import { getPlayer } from '../../../engine/playback/player';
import type { FrameGraph } from '../../../engine/render/graph';
import { cssFontFamily } from '../../../engine/render/text';
import { useEditor } from '../../../state/store';
import { activeSequence, findClip } from '../../../state/types';
import { findLayer, layerInfo } from './layers';
import { useViewerUi, type TextEditState } from './uiState';
import { apply } from '../../../engine/playback/geometry';

interface Props {
  edit: TextEditState;
  graph: FrameGraph;
  /** CSS pixels per sequence pixel. */
  k: number;
}

function family(f: string): string {
  try {
    return cssFontFamily(f);
  } catch {
    return f;
  }
}

/** Ends the edit: writes the text, or removes an empty new title. */
export function commitTextEdit(edit: TextEditState, content: string): void {
  const s = useEditor.getState();
  const player = getPlayer();
  player.hidden.delete(edit.clipId);
  useViewerUi.getState().setTextEdit(null);
  const text = content.replace(/ /g, ' ').replace(/\n+$/, '');
  const seq = s.project ? activeSequence(s.project) : null;
  const hit = seq ? findClip(seq, edit.clipId) : null;
  if (!hit || !hit.clip.text) {
    player.invalidate();
    return;
  }
  if (!text.trim()) {
    if (edit.isNew) {
      const last = s.past[s.past.length - 1];
      if (last && edit.historyKey && last.coalesceKey === edit.historyKey) s.undo();
      else
        s.mutate('Delete empty title', (d) => {
          for (const tr of activeSequence(d).tracks) tr.clips = tr.clips.filter((c) => c.id !== edit.clipId);
        });
      s.clearSelection();
    }
    player.invalidate();
    return;
  }
  if (text !== hit.clip.text.content) {
    const firstLine = text.split('\n')[0].trim().slice(0, 40);
    const oldContent = hit.clip.text.content.split('\n')[0].trim().slice(0, 40);
    s.mutate(edit.isNew ? 'Type title' : 'Edit title', (d) => {
      const h = findClip(activeSequence(d), edit.clipId);
      if (!h?.clip.text) return;
      h.clip.text.content = text;
      if (!h.clip.name || h.clip.name === 'Text' || h.clip.name === 'Title' || h.clip.name === oldContent) h.clip.name = firstLine || 'Title';
    });
  }
  player.invalidate();
}

export function TextEditor({ edit, graph, k }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const committed = useRef(false);
  const clip = useEditor((s) => {
    const p = s.project;
    return p ? (findClip(activeSequence(p), edit.clipId)?.clip ?? null) : null;
  });
  const node = findLayer(graph, edit.clipId);

  // Hide the clip from the render while its text is being edited.
  useEffect(() => {
    const player = getPlayer();
    player.hidden.add(edit.clipId);
    player.invalidate();
    committed.current = false;
    return () => {
      player.hidden.delete(edit.clipId);
      player.invalidate();
    };
  }, [edit.clipId]);

  // Seed the content once and put the caret at the end.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.innerText = clip?.text?.content ?? '';
    el.focus({ preventScroll: true });
    const range = document.createRange();
    range.selectNodeContents(el);
    if (edit.isNew) range.collapse(false);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }, [edit.clipId]); // seed once per edited clip; typing must not be reset by re-renders

  if (!clip?.text) return null;
  const t = clip.text;
  // Position from the resolved layer at the playhead (falls back to the static transform).
  const W = graph.width;
  const H = graph.height;
  const info = node ? layerInfo(node, W, H) : null;
  const tf = node?.transform ?? clip.transform;
  const center = info ? apply(info.m, { x: 0, y: 0 }) : { x: W / 2 + tf.x, y: H / 2 + tf.y };
  const size = node?.source?.kind === 'text' ? node.source.text.size : t.size;

  const finish = () => {
    if (committed.current) return;
    committed.current = true;
    commitTextEdit(edit, ref.current?.innerText ?? '');
  };

  return (
    <div
      className="vw-text-edit"
      style={{
        left: center.x * k,
        top: center.y * k,
        transform: `translate(-50%, -50%) rotate(${tf.rotation}deg) scale(${tf.scale * tf.scaleX}, ${tf.scale * tf.scaleY})`,
      }}
    >
      <div
        ref={ref}
        className="vw-text-edit__field"
        contentEditable="plaintext-only"
        suppressContentEditableWarning
        spellCheck={false}
        data-testid="vw-text-editor"
        data-placeholder="Type a title"
        style={{
          fontFamily: family(t.font),
          fontWeight: t.weight,
          fontStyle: t.italic ? 'italic' : 'normal',
          fontSize: size * k,
          lineHeight: t.lineHeight,
          letterSpacing: t.letterSpacing * k,
          color: t.color,
          textAlign: t.align,
          textTransform: t.uppercase ? 'uppercase' : 'none',
          maxWidth: t.maxWidth > 0 ? t.maxWidth * k : undefined,
          whiteSpace: t.maxWidth > 0 ? 'pre-wrap' : 'pre',
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) {
            e.preventDefault();
            finish();
          }
        }}
        onKeyUp={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        onBlur={finish}
      />
    </div>
  );
}
