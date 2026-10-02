// Captions workspace, left column: caption tracks, the cue list with quality
// checks, find & replace, file import/export and the track's style.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Sequence, Track } from '../../../state/types';
import { activeSequence } from '../../../state/types';
import { useEditor } from '../../../state/store';
import { checkCues, countIssues, findInCues, sortCues } from '../../../engine/captions';
import { displayKey, keysFor } from '../actions';
import {
  addCaptionTrack,
  addCueAtPlayhead,
  deleteCues,
  exportCaptionFile,
  exportInterchange,
  fixTiming,
  importCaptionFile,
  importOtioFile,
  mergeWithNext,
  nudgeCues,
  openChapters,
  replaceAll,
  resolveTrack,
  seekToCue,
  setEdgeToPlayhead,
  splitAtPlayhead,
  splitLong,
} from './commands';
import { CueList } from './CueList';
import { StyleEditor } from './StyleEditor';
import { useCaptionsUi } from './uiState';
import { CI } from './icons';
import './captions.css';

export function CaptionsPanel(_props: Record<string, unknown> = {}) {
  const seq = useEditor((s) => (s.project ? activeSequence(s.project) : null));
  const trackId = useCaptionsUi((s) => s.trackId);
  const tab = useCaptionsUi((s) => s.tab);
  const track = resolveTrack(seq, trackId);
  // Remember the resolved track so actions use the same one.
  useEffect(() => {
    if (track && track.id !== trackId) useCaptionsUi.getState().set({ trackId: track.id });
  }, [track, trackId]);

  if (!seq) return <div className="cap-panel" data-testid="cap-panel" />;
  const tracks = seq.tracks.filter((t) => t.kind === 'caption');

  return (
    <div className="cap-panel" data-testid="cap-panel">
      <Header seq={seq} tracks={tracks} track={track} />
      {!track ? (
        <div className="cap-empty" data-testid="cap-empty">
          <CI.Captions size={30} className="cap-empty__icon" />
          <div className="cap-empty__title">No caption track</div>
          <div className="cap-empty__hint">Add a caption track to write subtitles, or import an SRT or WebVTT file.</div>
          <div className="cap-empty__actions">
            <button type="button" className="cap-btn cap-btn--primary" onClick={() => addCaptionTrack()} data-testid="cap-add-track-empty">
              Add caption track
            </button>
            <button type="button" className="cap-btn cap-btn--ghost cap-btn--text" onClick={() => importCaptionFile()} data-testid="cap-import-empty">
              Import SRT / VTT…
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="cap-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={tab === 'cues'} className={`cap-tab${tab === 'cues' ? ' is-active' : ''}`} onClick={() => useCaptionsUi.getState().set({ tab: 'cues' })} data-testid="cap-tab-cues">
              Captions
            </button>
            <button type="button" role="tab" aria-selected={tab === 'style'} className={`cap-tab${tab === 'style' ? ' is-active' : ''}`} onClick={() => useCaptionsUi.getState().set({ tab: 'style' })} data-testid="cap-tab-style">
              Style
            </button>
          </div>
          {tab === 'cues' ? <CuesView seq={seq} track={track} /> : <StyleEditor seq={seq} track={track} />}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function Header({ seq, tracks, track }: { seq: Sequence; tracks: Track[]; track: Track | null }) {
  const issues = useMemo(() => (track ? checkCues(track.cues) : new Map()), [track?.cues]); // eslint-disable-line react-hooks/exhaustive-deps
  const count = countIssues(issues);
  const jumpToIssue = () => {
    if (!track || !count) return;
    const sorted = sortCues(track.cues).filter((c) => issues.get(c.id)?.length);
    const t = useEditor.getState().playhead;
    const next = sorted.find((c) => c.start > t + 1e-3) ?? sorted[0];
    if (!next) return;
    seekToCue(next);
    useEditor.getState().select({ cueIds: [next.id] });
    useCaptionsUi.getState().set({ tab: 'cues' });
  };
  return (
    <div className="cap-head">
      <span className="cap-title">Captions</span>
      {track && track.cues.length > 0 && (
        <button
          type="button"
          className={`cap-issues${count ? '' : ' is-clear'}`}
          onClick={jumpToIssue}
          title={count ? `${count} caption${count === 1 ? '' : 's'} break reading-speed, line or timing rules. Click to go to the next one.` : 'All captions pass the quality checks'}
          data-testid="cap-issues"
          data-count={count}
        >
          {count ? <CI.Warn size={12} /> : null}
          {count ? count : 'OK'}
        </button>
      )}
      <span className="cap-spacer" />
      {tracks.length > 0 && (
        <select className="cap-select" value={track?.id ?? ''} onChange={(e) => useCaptionsUi.getState().set({ trackId: e.target.value })} title="Caption track" aria-label="Caption track" data-testid="cap-track-select">
          {tracks.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name} · {t.cues.length}
            </option>
          ))}
        </select>
      )}
      <IconButton title="Add caption track" onClick={() => addCaptionTrack()} testid="cap-add-track">
        <CI.Plus size={15} />
      </IconButton>
      <IconButton title="Import SRT / VTT…" onClick={() => importCaptionFile()} testid="cap-import">
        <CI.Import size={15} />
      </IconButton>
      <Menu
        title="Export"
        testid="cap-export"
        icon={<CI.Export size={15} />}
        items={[
          { label: 'Captions', heading: true },
          { label: 'SubRip (.srt)…', run: () => exportCaptionFile('srt'), disabled: !track?.cues.length, testid: 'cap-export-srt' },
          { label: 'WebVTT (.vtt)…', run: () => exportCaptionFile('vtt'), disabled: !track?.cues.length, testid: 'cap-export-vtt' },
          { label: 'SMPTE-TT / TTML (.ttml)…', run: () => exportCaptionFile('ttml'), disabled: !track?.cues.length, testid: 'cap-export-ttml' },
          { sep: true },
          { label: 'Timeline', heading: true },
          { label: 'EDL, CMX 3600 (.edl)…', run: () => exportInterchange('edl'), testid: 'cap-export-edl', disabled: !hasClips(seq) },
          { label: 'OpenTimelineIO (.otio)…', run: () => exportInterchange('otio'), testid: 'cap-export-otio', disabled: !hasClips(seq) },
          { label: 'Final Cut Pro XML (.fcpxml)…', run: () => exportInterchange('fcpxml'), testid: 'cap-export-fcpxml', disabled: !hasClips(seq) },
          { label: 'YouTube chapters…', run: () => openChapters(), testid: 'cap-export-chapters' },
          { sep: true },
          { label: 'Import', heading: true },
          { label: 'OpenTimelineIO as a new sequence…', run: () => importOtioFile(), testid: 'cap-import-otio' },
        ]}
      />
    </div>
  );
}

function hasClips(seq: Sequence): boolean {
  return seq.tracks.some((t) => t.clips.length > 0);
}

// ---------------------------------------------------------------------------

function CuesView({ seq, track }: { seq: Sequence; track: Track }) {
  const cues = useMemo(() => sortCues(track.cues), [track.cues]);
  const issues = useMemo(() => checkCues(track.cues), [track.cues]);
  const search = useCaptionsUi((s) => s.search);
  const replace = useCaptionsUi((s) => s.replace);
  const caseSensitive = useCaptionsUi((s) => s.caseSensitive);
  const follow = useCaptionsUi((s) => s.follow);
  const filter = useMemo(() => (search ? new Set(findInCues(cues, search, { caseSensitive })) : null), [cues, search, caseSensitive]);
  const [showReplace, setShowReplace] = useState(false);
  const addKeys = keysFor('captions.addCue');
  const locked = track.locked;
  const ui = useCaptionsUi.getState().set;

  return (
    <>
      <div className="cap-toolbar" data-testid="cap-toolbar">
        <IconButton title={`Add caption at playhead${addKeys[0] ? ` (${displayKey(addKeys[0])})` : ''}`} onClick={addCueAtPlayhead} disabled={locked} testid="cap-add-cue">
          <CI.Plus size={16} />
        </IconButton>
        <IconButton title="Split caption at playhead" onClick={splitAtPlayhead} disabled={locked || !cues.length} testid="cap-split">
          <CI.Split size={16} />
        </IconButton>
        <IconButton title="Merge with next caption (or merge the selection)" onClick={mergeWithNext} disabled={locked || cues.length < 2} testid="cap-merge">
          <CI.Merge size={16} />
        </IconButton>
        <IconButton title="Delete caption" onClick={deleteCues} disabled={locked || !cues.length} testid="cap-delete">
          <CI.Trash size={16} />
        </IconButton>
        <span className="cap-sep" />
        <IconButton title="Set in to playhead" onClick={() => setEdgeToPlayhead('in')} disabled={locked || !cues.length} testid="cap-set-in">
          <CI.SetIn size={16} />
        </IconButton>
        <IconButton title="Set out to playhead" onClick={() => setEdgeToPlayhead('out')} disabled={locked || !cues.length} testid="cap-set-out">
          <CI.SetOut size={16} />
        </IconButton>
        <IconButton title="Nudge 1 frame earlier" onClick={() => nudgeCues(-1)} disabled={locked || !cues.length} testid="cap-nudge-back">
          <CI.NudgeBack size={16} />
        </IconButton>
        <IconButton title="Nudge 1 frame later" onClick={() => nudgeCues(1)} disabled={locked || !cues.length} testid="cap-nudge-fwd">
          <CI.NudgeFwd size={16} />
        </IconButton>
        <span className="cap-sep" />
        <IconButton title="Fix overlaps and snap to frames (2-frame minimum gap)" onClick={fixTiming} disabled={locked || !cues.length} testid="cap-fix">
          <CI.Fix size={16} />
        </IconButton>
        <IconButton title="Split long captions (2 lines of 42 characters)" onClick={splitLong} disabled={locked || !cues.length} testid="cap-split-long">
          <CI.Wrap size={16} />
        </IconButton>
        <span className="cap-spacer" />
        <IconButton title="Follow the playhead" onClick={() => ui({ follow: !follow })} on={follow} testid="cap-follow">
          <CI.Follow size={15} />
        </IconButton>
      </div>

      <div className="cap-find">
        <div className="cap-field-icon">
          <CI.Search size={13} />
          <input
            className="cap-input"
            value={search}
            placeholder="Find in captions"
            onChange={(e) => ui({ search: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Escape') ui({ search: '' });
              if (!e.ctrlKey && !e.metaKey) e.stopPropagation();
            }}
            aria-label="Find in captions"
            data-testid="cap-search"
          />
        </div>
        <div className="cap-find__row">
          <span className="cap-find__count" data-testid="cap-search-count">
            {search ? `${filter?.size ?? 0} of ${cues.length}` : `${cues.length}`}
          </span>
          <IconButton title="Match case" onClick={() => ui({ caseSensitive: !caseSensitive })} on={caseSensitive} testid="cap-case">
            <span style={{ fontSize: 11, fontWeight: 600 }}>Aa</span>
          </IconButton>
          <IconButton title="Replace" onClick={() => setShowReplace((v) => !v)} on={showReplace} testid="cap-replace-toggle">
            <CI.Chevron size={14} style={{ transform: showReplace ? 'rotate(180deg)' : undefined }} />
          </IconButton>
        </div>
        {showReplace && (
          <>
            <input
              className="cap-input"
              value={replace}
              placeholder="Replace with"
              onChange={(e) => ui({ replace: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') replaceAll(search, replace, caseSensitive);
                if (!e.ctrlKey && !e.metaKey) e.stopPropagation();
              }}
              aria-label="Replace with"
              data-testid="cap-replace"
            />
            <button type="button" className="cap-btn cap-btn--ghost cap-btn--text" disabled={!search || locked || !filter?.size} onClick={() => replaceAll(search, replace, caseSensitive)} data-testid="cap-replace-all">
              Replace all
            </button>
          </>
        )}
      </div>

      {cues.length === 0 ? (
        <div className="cap-empty" data-testid="cap-empty-track">
          <div className="cap-empty__title">No captions on {track.name}</div>
          <div className="cap-empty__hint">
            Move the playhead and add a caption{addKeys[0] ? ' with ' : ''}
            {addKeys[0] ? <kbd className="cap-kbd">{displayKey(addKeys[0])}</kbd> : null}, or import a subtitle file.
          </div>
          <div className="cap-empty__actions">
            <button type="button" className="cap-btn cap-btn--primary" onClick={addCueAtPlayhead} disabled={locked}>
              Add caption
            </button>
            <button type="button" className="cap-btn cap-btn--ghost cap-btn--text" onClick={() => importCaptionFile()}>
              Import SRT / VTT…
            </button>
          </div>
        </div>
      ) : filter && filter.size === 0 ? (
        <div className="cap-empty">
          <div className="cap-empty__hint">No captions contain “{search}”.</div>
        </div>
      ) : (
        <CueList track={track} seq={seq} cues={cues} filter={filter} issues={issues} />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------

function IconButton({ title, onClick, disabled, on, testid, children }: { title: string; onClick: () => void; disabled?: boolean; on?: boolean; testid: string; children: ReactNode }) {
  return (
    <button type="button" className={`cap-btn${on ? ' is-on' : ''}`} title={title} aria-label={title} aria-pressed={on === undefined ? undefined : on} onClick={onClick} disabled={disabled} data-testid={testid}>
      {children}
    </button>
  );
}

type MenuItem = { label: string; heading: true } | { sep: true } | { label: string; run: () => void; disabled?: boolean; testid?: string; heading?: false };

function Menu({ title, icon, items, testid }: { title: string; icon: ReactNode; items: MenuItem[]; testid: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return (
    <div className="cap-menu-wrap" ref={ref}>
      <IconButton title={title} onClick={() => setOpen((v) => !v)} on={open} testid={testid}>
        {icon}
      </IconButton>
      {open && (
        <div className="cap-menu" role="menu">
          {items.map((it, i) =>
            'sep' in it ? (
              <div key={i} className="cap-menu__sep" />
            ) : it.heading ? (
              <div key={i} className="cap-menu__label">
                {it.label}
              </div>
            ) : (
              <button
                key={i}
                type="button"
                role="menuitem"
                className="cap-menu__item"
                disabled={it.disabled}
                onClick={() => {
                  setOpen(false);
                  it.run();
                }}
                data-testid={it.testid}
              >
                <span>{it.label}</span>
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}
