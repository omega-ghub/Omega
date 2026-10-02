// Window-level overlays: stacked toasts, the global file-drop target and the
// first-run tips card. OWNED BY THE SHELL PACKAGE.

import { useEffect, useRef, useState } from 'react';
import { useEditor, type Toast } from '../../../state/store';
import { I } from '../../../ui/Icons';
import { Keys } from '../../../ui/controls';
import { keysFor } from '../actions';
import { importPaths } from './packages';
import { usePrefs } from './prefs';

// ---------------------------------------------------------------------------
// Toasts: the store holds the latest toast; the host keeps a short stack.
// ---------------------------------------------------------------------------

interface Shown extends Toast {
  leaving?: boolean;
}

export function ToastHost() {
  const toast = useEditor((s) => s.toast);
  const [list, setList] = useState<Shown[]>([]);
  const timers = useRef(new Map<number, number>());

  const dismiss = (id: number) => {
    setList((l) => l.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
    window.setTimeout(() => setList((l) => l.filter((t) => t.id !== id)), 160);
    const tm = timers.current.get(id);
    if (tm) window.clearTimeout(tm);
    timers.current.delete(id);
  };

  useEffect(() => {
    if (!toast) return;
    setList((l) => (l.some((t) => t.id === toast.id) ? l : [...l.filter((t) => t.message !== toast.message), toast].slice(-4)));
    const ms = toast.kind === 'error' ? 6500 : 3400;
    timers.current.set(toast.id, window.setTimeout(() => dismiss(toast.id), ms));
  }, [toast]);

  useEffect(() => {
    const map = timers.current;
    return () => map.forEach((t) => window.clearTimeout(t));
  }, []);

  if (list.length === 0) return null;
  return (
    <div className="sh-toasts" role="status" aria-live="polite" data-testid="sh-toasts">
      {list.map((t) => (
        <div key={t.id} className={`sh-toast sh-toast--${t.kind} ${t.leaving ? 'is-leaving' : ''}`} data-testid="sh-toast" data-kind={t.kind} onClick={() => dismiss(t.id)}>
          <span className="sh-toast__icon">{t.kind === 'error' ? <I.Warning size={15} /> : t.kind === 'success' ? <I.CheckCircle size={15} /> : <I.Info size={15} />}</span>
          <span className="sh-toast__msg">{t.message}</span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Global file drop: anything dropped outside a panel that handles drops is
// imported. Panels that accept drops call preventDefault() in their own
// dragover/drop handlers, which is how we know to stay out of the way.
// ---------------------------------------------------------------------------

export function FileDropTarget() {
  const [over, setOver] = useState(false);
  const [count, setCount] = useState(0);
  const hideTimer = useRef<number | null>(null);

  useEffect(() => {
    const hasFiles = (e: DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].includes('Files');
    const hideSoon = () => {
      if (hideTimer.current) window.clearTimeout(hideTimer.current);
      hideTimer.current = window.setTimeout(() => setOver(false), 120);
    };
    const onOver = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      if (e.defaultPrevented) {
        // a panel is handling this spot
        hideSoon();
        return;
      }
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = importPaths ? 'copy' : 'none';
      if (hideTimer.current) window.clearTimeout(hideTimer.current);
      setCount(e.dataTransfer?.items.length ?? 0);
      setOver(true);
      hideTimer.current = window.setTimeout(() => setOver(false), 700);
    };
    const onLeave = (e: DragEvent) => {
      if (!e.relatedTarget) hideSoon();
    };
    const onDrop = (e: DragEvent) => {
      setOver(false);
      if (!hasFiles(e) || e.defaultPrevented) return;
      e.preventDefault();
      const files = [...(e.dataTransfer?.files ?? [])];
      const paths = files.map((f) => window.omega.files.pathForFile(f)).filter(Boolean);
      const ed = useEditor.getState();
      if (!paths.length) return;
      if (ed.readOnly) return ed.showToast('This project is read-only.', 'error');
      if (!importPaths) return ed.showToast('Importing is not available in this build.', 'error');
      Promise.resolve(importPaths(paths)).catch((err: Error) => ed.showToast(`Import failed: ${err.message}`, 'error'));
    };
    window.addEventListener('dragover', onOver);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, []);

  if (!over) return null;
  return (
    <div className="sh-drop" data-testid="sh-drop-overlay" aria-hidden="true">
      <div className="sh-drop__card">
        <span className="sh-drop__icon">
          <I.Import size={20} />
        </span>
        <div className="sh-drop__title">Drop to import</div>
        <div className="sh-drop__sub">{count > 1 ? `${count} items` : 'Video, audio, images and captions'} · added to the media pool</div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// First-run tips
// ---------------------------------------------------------------------------

const STEPS: { title: string; body: string; keys: { label: string; action: string; fallback: string }[]; icon: typeof I.Import }[] = [
  {
    title: 'Bring in media',
    body: 'Drop files anywhere on the window, or use Import in the Media panel.',
    keys: [{ label: 'Import', action: 'media.import', fallback: 'Mod+I' }],
    icon: I.Import,
  },
  {
    title: 'Cut by keyboard',
    body: 'J, K and L shuttle back, stop and forward. Split at the playhead to make a cut.',
    keys: [
      { label: 'Shuttle', action: '', fallback: 'J' },
      { label: '', action: '', fallback: 'K' },
      { label: '', action: '', fallback: 'L' },
      { label: 'Split', action: 'timeline.split', fallback: 'Mod+K' },
    ],
    icon: I.Razor,
  },
  {
    title: 'Deliver',
    body: 'Export from the Deliver workspace. Your project saves itself every few seconds.',
    keys: [{ label: 'Export', action: 'deliver.quickExport', fallback: 'Mod+M' }],
    icon: I.Export,
  },
];

export function Onboarding() {
  const show = usePrefs((s) => s.onboarding);
  const setPrefs = usePrefs((s) => s.set);
  const [step, setStep] = useState(0);
  if (!show) return null;
  const s = STEPS[step];
  const last = step === STEPS.length - 1;
  const close = () => {
    setPrefs({ onboarding: false });
    setStep(0);
  };
  return (
    <div className="sh-tips" role="dialog" aria-label="Getting started" data-testid="sh-onboarding">
      <div className="sh-tips__head">
        <span className="sh-tips__eyebrow">
          Getting started · {step + 1} of {STEPS.length}
        </span>
        <button className="icon-btn icon-btn--xs" aria-label="Dismiss tips" data-tip="Dismiss" onClick={close} data-testid="sh-onboarding-close">
          <I.Close size={14} />
        </button>
      </div>
      <div className="sh-tips__body">
        <span className="sh-tips__icon">
          <s.icon size={18} />
        </span>
        <div>
          <div className="sh-tips__title">{s.title}</div>
          <div className="sh-tips__text">{s.body}</div>
          <div className="sh-tips__keys">
            {s.keys.map((k, i) => {
              const binding = (k.action && keysFor(k.action)[0]) || k.fallback;
              return (
                <span key={i} className="sh-tips__key">
                  {k.label && <span className="muted">{k.label}</span>}
                  <Keys binding={binding} />
                </span>
              );
            })}
          </div>
        </div>
      </div>
      <div className="sh-tips__foot">
        <div className="sh-tips__dots">
          {STEPS.map((_, i) => (
            <button key={i} className={`sh-tips__dot ${i === step ? 'is-active' : ''}`} aria-label={`Tip ${i + 1}`} onClick={() => setStep(i)} />
          ))}
        </div>
        {step > 0 && (
          <button className="btn btn--ghost btn--xs" onClick={() => setStep(step - 1)}>
            Back
          </button>
        )}
        <button className="btn btn--xs btn--primary" data-testid="sh-onboarding-next" onClick={() => (last ? close() : setStep(step + 1))}>
          {last ? 'Done' : 'Next'}
        </button>
      </div>
    </div>
  );
}
