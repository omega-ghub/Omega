// Preferences (Mod+,). Machine-level settings persist in localStorage;
// project defaults (transition and still durations) are undoable edits of
// project.settings. OWNED BY THE SHELL PACKAGE.

import { useState, type ReactNode } from 'react';
import { AppMark, AppTitle } from '../../../brand/Logos';
import { useEditor, type ViewerPrefs } from '../../../state/store';
import { I } from '../../../ui/Icons';
import { Dialog } from '../../../ui/Modal';
import { Keys, Segmented, Switch } from '../../../ui/controls';
import { keysFor } from '../actions';
import { usePrefs, type UiScale } from './prefs';

type Section = 'playback' | 'editing' | 'timeline' | 'appearance' | 'about';

const SECTIONS: { id: Section; label: string; icon: ReactNode }[] = [
  { id: 'playback', label: 'Playback', icon: <I.Play size={15} /> },
  { id: 'editing', label: 'Editing', icon: <I.Razor size={15} /> },
  { id: 'timeline', label: 'Timeline', icon: <I.Sequence size={15} /> },
  { id: 'appearance', label: 'Appearance', icon: <I.Monitor size={15} /> },
  { id: 'about', label: 'About', icon: <I.Info size={15} /> },
];

export function Preferences({ onClose, initial }: { onClose: () => void; initial?: string }) {
  const [section, setSection] = useState<Section>(SECTIONS.some((s) => s.id === initial) ? (initial as Section) : 'playback');
  return (
    <Dialog title="Preferences" icon={<I.Settings size={17} />} onClose={onClose} width={760} height={480} flush testId="sh-preferences">
      <div className="sh-prefs">
        <nav className="sh-prefs__nav">
          {SECTIONS.map((s) => (
            <button key={s.id} className={`sh-prefs__nav-item ${section === s.id ? 'is-active' : ''}`} onClick={() => setSection(s.id)} data-testid={`sh-prefs-${s.id}`}>
              {s.icon}
              {s.label}
            </button>
          ))}
        </nav>
        <div className="sh-prefs__body">
          {section === 'playback' && <Playback />}
          {section === 'editing' && <Editing />}
          {section === 'timeline' && <TimelinePrefs />}
          {section === 'appearance' && <Appearance />}
          {section === 'about' && <About />}
        </div>
      </div>
    </Dialog>
  );
}

function Row({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="sh-prefs__row">
      <div className="sh-prefs__row-text">
        <div className="sh-prefs__row-label">{label}</div>
        {hint && <div className="sh-prefs__row-hint">{hint}</div>}
      </div>
      <div className="sh-prefs__row-control">{children}</div>
    </div>
  );
}

function Playback() {
  const viewer = useEditor((s) => s.viewer);
  const setViewer = useEditor((s) => s.setViewer);
  return (
    <>
      <h3 className="sh-prefs__title">Playback</h3>
      <Row label="Playback resolution" hint="Lower resolutions keep 4K and high frame rates smooth while you edit. Export always renders at full quality.">
        <Segmented<string>
          size="sm"
          value={String(viewer.playbackScale)}
          onChange={(v) => setViewer({ playbackScale: (v === 'auto' ? 'auto' : Number(v)) as ViewerPrefs['playbackScale'] })}
          testId="sh-pref-playback-scale"
          options={[
            { value: 'auto', label: 'Auto' },
            { value: '1', label: 'Full' },
            { value: '0.5', label: '½' },
            { value: '0.25', label: '¼' },
          ]}
        />
      </Row>
      <Row label="Use proxies" hint="Play from lightweight proxy files when they exist. Originals are always used for export.">
        <Switch checked={viewer.useProxies} onChange={(v) => setViewer({ useProxies: v })} label="Use proxies" testId="sh-pref-proxies" />
      </Row>
      <Row label="Loop playback" hint="Playback restarts at the in point (or the start) when it reaches the end.">
        <Switch checked={viewer.loop} onChange={(v) => setViewer({ loop: v })} label="Loop playback" testId="sh-pref-loop" />
      </Row>
    </>
  );
}

function DurationField({ value, onCommit, testId, min = 0.04, max = 600 }: { value: number; onCommit: (v: number) => void; testId: string; min?: number; max?: number }) {
  const [text, setText] = useState<string | null>(null);
  const commit = () => {
    if (text === null) return;
    const v = Number(text.replace(',', '.'));
    if (Number.isFinite(v)) onCommit(Math.min(max, Math.max(min, v)));
    setText(null);
  };
  return (
    <div className="sh-prefs__num">
      <input
        className="input input--sm input--mono"
        inputMode="decimal"
        value={text ?? String(Math.round(value * 1000) / 1000)}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') {
            setText(null);
            e.stopPropagation();
          }
        }}
        data-testid={testId}
      />
      <span className="muted">sec</span>
    </div>
  );
}

function Editing() {
  const settings = useEditor((s) => s.project?.settings);
  const readOnly = useEditor((s) => s.readOnly);
  const mutate = useEditor((s) => s.mutate);
  if (!settings) return null;
  return (
    <>
      <h3 className="sh-prefs__title">Editing defaults</h3>
      <p className="sh-prefs__lead">These defaults belong to this project. Changing them is undoable.</p>
      <Row label="Default transition duration" hint="Used when you add the default transition.">
        <DurationField
          value={settings.defaultTransitionDuration}
          testId="sh-pref-transition-duration"
          onCommit={(v) => !readOnly && mutate('Change default transition duration', (d) => void (d.settings.defaultTransitionDuration = v))}
        />
      </Row>
      <Row label="Still image duration" hint="Length of a still image when it is placed on the timeline.">
        <DurationField
          value={settings.stillDuration}
          testId="sh-pref-still-duration"
          onCommit={(v) => !readOnly && mutate('Change still image duration', (d) => void (d.settings.stillDuration = v))}
        />
      </Row>
      <div className="note sh-prefs__note">
        <I.Save size={15} />
        <span>
          Delta saves every few seconds while you work, and keeps rolling backups in the project's <code>.backups</code> folder. Press <Keys binding={keysFor('shell.save')[0] ?? 'Mod+S'} /> to save and back up immediately.
        </span>
      </div>
    </>
  );
}

function TimelinePrefs() {
  const prefs = usePrefs();
  const snapping = useEditor((s) => s.snapping);
  const magnetic = useEditor((s) => s.magnetic);
  const ed = useEditor.getState();
  return (
    <>
      <h3 className="sh-prefs__title">Timeline</h3>
      <Row label="Snapping" hint="Clips, the playhead and markers snap to each other while you drag. This is also the default for new sessions.">
        <Switch
          checked={snapping}
          testId="sh-pref-snapping"
          label="Snapping"
          onChange={(v) => {
            ed.setSnapping(v);
            prefs.set({ snapping: v });
          }}
        />
      </Row>
      <Row label="Magnetic timeline" hint="Deleting or moving clips closes the gaps they leave on that track.">
        <Switch
          checked={magnetic}
          testId="sh-pref-magnetic"
          label="Magnetic timeline"
          onChange={(v) => {
            ed.setMagnetic(v);
            prefs.set({ magnetic: v });
          }}
        />
      </Row>
    </>
  );
}

function Appearance() {
  const scale = usePrefs((s) => s.uiScale);
  const set = usePrefs((s) => s.set);
  const onboarding = usePrefs((s) => s.onboarding);
  return (
    <>
      <h3 className="sh-prefs__title">Appearance</h3>
      <Row label="Interface size" hint="Scales every panel, label and control. Media is not affected.">
        <Segmented<UiScale>
          size="sm"
          value={scale}
          onChange={(v) => set({ uiScale: v })}
          testId="sh-pref-ui-scale"
          options={[
            { value: 0.9, label: '90%' },
            { value: 1, label: '100%' },
            { value: 1.1, label: '110%' },
          ]}
        />
      </Row>
      <Row label="Getting-started tips" hint="The three-step card shown when Delta opens.">
        <Switch checked={onboarding} onChange={(v) => set({ onboarding: v })} label="Getting-started tips" testId="sh-pref-onboarding" />
      </Row>
    </>
  );
}

function About() {
  const info = useEditor((s) => s.appInfo);
  return (
    <div className="sh-about" data-testid="sh-about">
      <AppMark app="video" size={52} />
      <AppTitle app="video" size="lg" />
      <p className="sh-about__tag">Part of the Omega creative suite.</p>
      <div className="sh-about__facts">
        <div className="row">
          <span className="row__label">Version</span>
          <span className="row__value">{info?.version ?? '—'}</span>
        </div>
        <div className="row">
          <span className="row__label">Electron</span>
          <span className="row__value">{info?.electron ?? '—'}</span>
        </div>
        <div className="row">
          <span className="row__label">Chromium</span>
          <span className="row__value">{info?.chrome ?? '—'}</span>
        </div>
        <div className="row">
          <span className="row__label">Platform</span>
          <span className="row__value">{info?.platform ?? '—'}</span>
        </div>
      </div>
      <p className="sh-about__legal">
        © Omega. Delta runs entirely on this computer: no account, no telemetry, and your media never leaves the machine. Decoding and encoding use the
        platform's WebCodecs through Mediabunny (MPL-2.0); interface type is Inter and JetBrains Mono (SIL Open Font License).
      </p>
    </div>
  );
}
