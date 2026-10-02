// Captions package dialogs: 'captions.import' and 'captions.chapters'.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { activeSequence } from '../../../state/types';
import { useEditor } from '../../../state/store';
import { formatTimecode } from '../../../engine/time';
import { applyImport, captionTracks, chaptersFor, saveChapters, type ImportProps } from './commands';
import { useCaptionsUi } from './uiState';
import { CI } from './icons';
import './captions.css';

export function Modals() {
  const modal = useEditor((s) => s.modal);
  const hasProject = useEditor((s) => !!s.project);
  if (!modal || !hasProject) return null;
  if (modal.id === 'captions.import' && modal.props) return <ImportDialog props={modal.props as unknown as ImportProps} />;
  if (modal.id === 'captions.chapters') return <ChaptersDialog />;
  return null;
}

function Dialog({ title, children, footer, testid, width = 460 }: { title: string; children: ReactNode; footer: ReactNode; testid: string; width?: number }) {
  const close = () => useEditor.getState().closeModal();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
  return (
    <div className="cap-modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="cap-modal" style={{ width }} role="dialog" aria-modal="true" aria-label={title} data-testid={testid}>
        <div className="cap-modal__head">
          <div className="cap-modal__title">{title}</div>
          <button type="button" className="cap-btn" onClick={close} aria-label="Close" title="Close">
            <CI.Close size={16} />
          </button>
        </div>
        <div className="cap-modal__body">{children}</div>
        <div className="cap-modal__foot">{footer}</div>
      </div>
    </div>
  );
}

function ImportDialog({ props }: { props: ImportProps }) {
  const seq = useEditor((s) => (s.project ? activeSequence(s.project) : null));
  const playhead = useEditor((s) => s.playhead);
  const uiTrack = useCaptionsUi((s) => s.trackId);
  const tracks = seq ? captionTracks(seq) : [];
  const [target, setTarget] = useState<string>(() => tracks.find((t) => t.id === uiTrack)?.id ?? tracks[0]?.id ?? 'new');
  const [offset, setOffset] = useState<'zero' | 'playhead'>('zero');
  const [replace, setReplace] = useState(false);
  if (!seq) return null;
  const first = Math.min(...props.cues.map((c) => c.start));
  const last = Math.max(...props.cues.map((c) => c.end));
  const tc = (t: number) => formatTimecode(t, seq.fps, seq.dropFrame, seq.startTimecode);
  const shift = offset === 'playhead' ? playhead - first : 0;
  const existing = tracks.find((t) => t.id === target);
  const run = () => {
    useEditor.getState().closeModal();
    applyImport(props, target, offset, replace && !!existing);
  };
  return (
    <Dialog
      title="Import captions"
      testid="cap-import-dialog"
      footer={
        <>
          <button type="button" className="cap-btn cap-btn--ghost cap-btn--text" onClick={() => useEditor.getState().closeModal()}>
            Cancel
          </button>
          <button type="button" className="cap-btn cap-btn--primary" onClick={run} autoFocus data-testid="cap-import-confirm">
            Import {props.cues.length} caption{props.cues.length === 1 ? '' : 's'}
          </button>
        </>
      }
    >
      <div className="cap-summary">
        <b>{props.fileName}</b> has <b>{props.cues.length}</b> caption{props.cues.length === 1 ? '' : 's'} from <span className="cap-mono">{tc(first)}</span> to <span className="cap-mono">{tc(last)}</span>.
      </div>
      {props.warnings.length > 0 && (
        <ul className="cap-warnings">
          {props.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
      <div className="cap-field">
        <span>Track</span>
        <div className="cap-field__ctl">
          <select className="cap-select" value={target} onChange={(e) => setTarget(e.target.value)} data-testid="cap-import-target">
            {tracks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.cues.length} caption{t.cues.length === 1 ? '' : 's'})
              </option>
            ))}
            <option value="new">New caption track</option>
          </select>
        </div>
      </div>
      <div className="cap-field" style={{ alignItems: 'start' }}>
        <span>Timing</span>
        <div className="cap-radio">
          <label>
            <input type="radio" name="cap-offset" checked={offset === 'zero'} onChange={() => setOffset('zero')} data-testid="cap-import-offset-zero" />
            Keep the file’s times (00:00:00 = sequence start)
          </label>
          <label>
            <input type="radio" name="cap-offset" checked={offset === 'playhead'} onChange={() => setOffset('playhead')} data-testid="cap-import-offset-playhead" />
            First caption at the playhead ({tc(playhead)})
          </label>
          {offset === 'playhead' && Math.abs(shift) > 1e-6 && (
            <span className="cap-unit">
              Shifts every caption by {shift > 0 ? '+' : '−'}
              {Math.abs(shift).toFixed(2)} s
            </span>
          )}
        </div>
      </div>
      {existing && existing.cues.length > 0 && (
        <label className="cap-check">
          <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} data-testid="cap-import-replace" />
          Replace the {existing.cues.length} caption{existing.cues.length === 1 ? '' : 's'} on {existing.name}
        </label>
      )}
    </Dialog>
  );
}

function ChaptersDialog() {
  const seq = useEditor((s) => (s.project ? activeSequence(s.project) : null));
  const result = useMemo(() => (seq ? chaptersFor(seq) : null), [seq]);
  const [copied, setCopied] = useState(false);
  if (!seq || !result) return null;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(result.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      useEditor.getState().showToast('Could not copy to the clipboard', 'error');
    }
  };
  return (
    <Dialog
      title="YouTube chapters"
      testid="cap-chapters-dialog"
      width={480}
      footer={
        <>
          <button type="button" className="cap-btn cap-btn--ghost cap-btn--text" onClick={copy} disabled={!result.text} data-testid="cap-chapters-copy">
            <CI.Copy size={14} />
            {copied ? 'Copied' : 'Copy'}
          </button>
          <button type="button" className="cap-btn cap-btn--primary" onClick={() => saveChapters(result.text)} disabled={!result.text} data-testid="cap-chapters-save">
            Save as text…
          </button>
        </>
      }
    >
      <div className="cap-summary">
        From the chapter markers of <b>{seq.name}</b>. Paste the list into the video description.
      </div>
      {result.text ? (
        <textarea className="cap-chapters" readOnly value={result.text} rows={Math.min(14, Math.max(4, result.chapters.length + 1))} data-testid="cap-chapters-text" onFocus={(e) => e.target.select()} />
      ) : null}
      {result.warnings.length > 0 && (
        <ul className="cap-warnings" data-testid="cap-chapters-warnings">
          {result.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}
