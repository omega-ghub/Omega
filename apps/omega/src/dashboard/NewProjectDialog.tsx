import { useEffect, useMemo, useState } from 'react';
import { AppMark } from '../brand/Logos';
import { THEMES, type AppKind } from '../brand/themes';
import { COLOR_SPACES, DEFAULT_SETTINGS, FRAME_RATES, PROJECT_PRESETS, SAMPLE_RATES, aspectLabel, isDropFrameRate } from '../state/presets';
import { useStore } from '../state/store';
import type { ProjectSettings } from '../state/types';
import { I } from '../ui/Icons';
import { Modal } from '../ui/Modal';

type Destination = '16:9' | '9:16' | '1:1' | '4:5' | 'match' | 'cinema';

const DESTINATIONS: { id: Destination; name: string; hint: string; w: number; h: number }[] = [
  { id: '16:9', name: 'Landscape', hint: 'YouTube, TV, web', w: 16, h: 9 },
  { id: '9:16', name: 'Vertical', hint: 'Shorts, Reels, TikTok', w: 9, h: 16 },
  { id: '1:1', name: 'Square', hint: 'Feeds', w: 1, h: 1 },
  { id: '4:5', name: 'Portrait', hint: 'Instagram feed', w: 4, h: 5 },
  { id: 'cinema', name: 'Cinema', hint: 'DCI, Scope', w: 2.39, h: 1 },
  { id: 'match', name: 'Match first clip', hint: 'Decide from the media', w: 16, h: 9 },
];

export function NewProjectDialog({ app }: { app: AppKind }) {
  const t = THEMES[app];
  const appInfo = useStore((s) => s.appInfo);
  const close = useStore((s) => s.closeNewProject);
  const createProject = useStore((s) => s.createProject);
  const recents = useStore((s) => s.recents);

  const [name, setName] = useState(() => defaultName(app, recents.length));
  const [location, setLocation] = useState(appInfo?.defaultProjectsDir ?? '');
  const [destination, setDestination] = useState<Destination>('16:9');
  const [presetId, setPresetId] = useState('yt-1080');
  const [settings, setSettings] = useState<ProjectSettings>(DEFAULT_SETTINGS);
  const [advanced, setAdvanced] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const presets = useMemo(() => {
    if (destination === 'match') return [];
    if (destination === 'cinema') return PROJECT_PRESETS.filter((p) => p.group === 'Cinema');
    return PROJECT_PRESETS.filter((p) => p.aspect === destination && p.group !== 'Cinema');
  }, [destination]);

  useEffect(() => {
    if (destination === 'match') {
      setSettings((s) => ({ ...s, matchFirstClip: true }));
      return;
    }
    const first = presets.find((p) => p.id === presetId) ?? presets[0];
    if (!first) return;
    setPresetId(first.id);
    setSettings((s) => ({ ...s, width: first.width, height: first.height, fps: first.fps, matchFirstClip: false }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [destination]);

  const choosePreset = (id: string) => {
    const p = PROJECT_PRESETS.find((x) => x.id === id);
    if (!p) return;
    setPresetId(id);
    setSettings((s) => ({ ...s, width: p.width, height: p.height, fps: p.fps, matchFirstClip: false }));
  };

  const browse = async () => {
    const dir = await window.omega.dialogs.pickFolder(location);
    if (dir) setLocation(dir);
  };

  const submit = async () => {
    if (!name.trim()) return setError('Give the project a name.');
    if (!location.trim()) return setError('Choose where to save the project.');
    setBusy(true);
    setError(null);
    try {
      await createProject(app, name.trim(), location, { ...settings, dropFrame: isDropFrameRate(settings.fps) });
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  const aspect = aspectLabel(settings.width, settings.height);
  const previewRatio = settings.width / settings.height;

  return (
    <Modal onClose={close} width={1000} className="newproj">
      <div className="newproj__head">
        <AppMark app={app} size={36} />
        <div>
          <div className="newproj__title">New {t.short} project</div>
          <div className="newproj__sub">{t.available ? t.tagline : `${t.name} is planned for ${t.phase}. You can set up the project now; the workspace opens in preview.`}</div>
        </div>
        <button className="icon-btn newproj__close" onClick={close} aria-label="Close">
          <I.Close />
        </button>
      </div>

      <div className="newproj__body">
        <div className="newproj__left">
          <div className="label">Where is this going?</div>
          <div className="dest-grid">
            {DESTINATIONS.map((d) => (
              <button key={d.id} className={`dest ${destination === d.id ? 'is-active' : ''}`} onClick={() => setDestination(d.id)}>
                <span className="dest__shape">
                  <span className="dest__box" style={{ aspectRatio: `${d.w} / ${d.h}` }} />
                </span>
                <span className="dest__name">{d.name}</span>
                <span className="dest__hint">{d.hint}</span>
              </button>
            ))}
          </div>

          {destination !== 'match' && (
            <>
              <div className="label">Preset</div>
              <div className="preset-list">
                {presets.map((p) => (
                  <button key={p.id} className={`preset ${presetId === p.id ? 'is-active' : ''}`} onClick={() => choosePreset(p.id)}>
                    <span className="preset__name">{p.name}</span>
                    <span className="preset__hint">{p.hint}</span>
                  </button>
                ))}
              </div>
            </>
          )}
          {destination === 'match' && (
            <div className="note">
              The sequence takes its frame size and frame rate from the first video you import. You can change it later in the Inspector.
            </div>
          )}
        </div>

        <div className="newproj__right">
          <label className="field">
            <span>Project name</span>
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} />
          </label>
          <label className="field">
            <span>Location</span>
            <div className="field__row">
              <input value={location} onChange={(e) => setLocation(e.target.value)} />
              <button className="btn btn--ghost" onClick={browse}>
                Browse…
              </button>
            </div>
            <span className="field__hint">
              A folder named after the project is created here. Media stays where it is; nothing is copied unless you ask.
            </span>
          </label>

          <div className="summary">
            <div className="summary__preview">
              <div className="summary__box" style={{ aspectRatio: `${previewRatio}` }}>
                <span>{destination === 'match' ? 'Auto' : aspect}</span>
              </div>
            </div>
            <div className="summary__facts">
              {destination === 'match' ? (
                <div className="summary__fact">Settings follow the first clip</div>
              ) : (
                <>
                  <div className="summary__fact">
                    <b>
                      {settings.width} × {settings.height}
                    </b>{' '}
                    {aspect}
                  </div>
                  <div className="summary__fact">
                    <b>{settings.fps} fps</b> {isDropFrameRate(settings.fps) ? 'drop-frame timecode' : 'non-drop timecode'}
                  </div>
                </>
              )}
              <div className="summary__fact">
                <b>{settings.sampleRate / 1000} kHz</b> stereo
              </div>
              <div className="summary__fact">
                <b>{COLOR_SPACES.find((c) => c.id === settings.colorSpace)?.name}</b>
              </div>
            </div>
          </div>

          <button className="disclosure" onClick={() => setAdvanced((v) => !v)}>
            <I.ChevronDown size={16} style={{ transform: advanced ? 'rotate(180deg)' : undefined }} /> Advanced settings
          </button>
          {advanced && (
            <div className="advanced">
              <div className="field-grid">
                <label className="field">
                  <span>Width</span>
                  <input type="number" min={16} step={2} value={settings.width} disabled={destination === 'match'} onChange={(e) => setSettings((s) => ({ ...s, width: Number(e.target.value) || s.width }))} />
                </label>
                <label className="field">
                  <span>Height</span>
                  <input type="number" min={16} step={2} value={settings.height} disabled={destination === 'match'} onChange={(e) => setSettings((s) => ({ ...s, height: Number(e.target.value) || s.height }))} />
                </label>
                <label className="field">
                  <span>Frame rate</span>
                  <select value={settings.fps} disabled={destination === 'match'} onChange={(e) => setSettings((s) => ({ ...s, fps: Number(e.target.value) }))}>
                    {FRAME_RATES.map((f) => (
                      <option key={f} value={f}>
                        {f} fps
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Audio sample rate</span>
                  <select value={settings.sampleRate} onChange={(e) => setSettings((s) => ({ ...s, sampleRate: Number(e.target.value) as ProjectSettings['sampleRate'] }))}>
                    {SAMPLE_RATES.map((r) => (
                      <option key={r} value={r}>
                        {r / 1000} kHz
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field field--wide">
                  <span>Color space</span>
                  <select value={settings.colorSpace} onChange={(e) => setSettings((s) => ({ ...s, colorSpace: e.target.value as ProjectSettings['colorSpace'] }))}>
                    {COLOR_SPACES.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} — {c.hint}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <p className="muted">Pixel aspect ratio is square and fields are progressive. Interlaced and anamorphic workflows will arrive with broadcast delivery.</p>
            </div>
          )}

          {error && <div className="error">{error}</div>}
          <div className="newproj__actions">
            <button className="btn btn--ghost" onClick={close}>
              Cancel
            </button>
            <button className="btn btn--accent btn--large" onClick={submit} disabled={busy}>
              {busy ? 'Creating…' : 'Create project'}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function defaultName(app: AppKind, n: number) {
  return `${THEMES[app].short} Project ${n + 1}`;
}
