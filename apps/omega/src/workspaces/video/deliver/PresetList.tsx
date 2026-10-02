// Left column: presets grouped by destination, with search and custom
// presets (saved in localStorage). OWNED BY THE DELIVER PACKAGE.

import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { I } from '../../../ui/Icons';
import { PRESET_GROUPS, searchPresets, type ExportPreset, type PresetGroup } from '../../../engine/export';
import { canEncodeAudioWith } from '../../../engine/export/codecs';
import { allPresets, useDeliverDraft } from './draft';

const GROUP_ICON: Record<PresetGroup, (p: { size?: number }) => ReactElement> = {
  Social: (p) => <I.Sparkle {...p} />,
  Streaming: (p) => <I.Monitor {...p} />,
  Master: (p) => <I.Film {...p} />,
  Audio: (p) => <I.Music {...p} />,
  Image: (p) => <I.Image {...p} />,
  Handoff: (p) => <I.ExternalLink {...p} />,
  Custom: (p) => <I.Star {...p} />,
};

/** Presets that need an optional encoder (FLAC) are hidden when it's missing. */
function useAvailablePresets(presets: ExportPreset[]): ExportPreset[] {
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  useEffect(() => {
    let live = true;
    void (async () => {
      const out = new Set<string>();
      for (const p of presets) {
        if (p.requiresAudioCodec && !(await canEncodeAudioWith(p.requiresAudioCodec, { sampleRate: p.settings.audio.sampleRate, channels: p.settings.audio.channels }))) out.add(p.id);
      }
      if (live) setHidden(out);
    })();
    return () => {
      live = false;
    };
  }, [presets]);
  return useMemo(() => presets.filter((p) => !hidden.has(p.id)), [presets, hidden]);
}

export function PresetList() {
  const custom = useDeliverDraft((s) => s.customPresets);
  const selected = useDeliverDraft((s) => s.draft.presetId);
  const modified = useDeliverDraft((s) => s.modified);
  const choosePreset = useDeliverDraft((s) => s.choosePreset);
  const deleteCustom = useDeliverDraft((s) => s.deleteCustom);
  const [query, setQuery] = useState('');
  const presets = useAvailablePresets(useMemo(() => allPresets(custom), [custom]));
  const found = searchPresets(presets, query);

  return (
    <div className="dl-presets" data-testid="dl-presets">
      <div className="dl-search">
        <I.Search size={14} />
        <input className="dl-search__input" placeholder="Search presets" value={query} onChange={(e) => setQuery(e.target.value)} data-testid="dl-preset-search" aria-label="Search presets" />
        {query && (
          <button className="dl-search__clear" onClick={() => setQuery('')} aria-label="Clear search">
            <I.Close size={12} />
          </button>
        )}
      </div>
      <div className="dl-presets__scroll">
        {PRESET_GROUPS.map((group) => {
          const items = found.filter((p) => p.group === group);
          if (!items.length) return null;
          const Icon = GROUP_ICON[group];
          return (
            <div className="dl-pgroup" key={group}>
              <div className="dl-pgroup__title">
                <Icon size={13} />
                {group}
              </div>
              {items.map((p) => (
                <div key={p.id} className={`dl-preset ${p.id === selected ? 'is-active' : ''}`}>
                  <button className="dl-preset__main" onClick={() => choosePreset(p.id)} data-testid={`dl-preset-${p.id}`} aria-pressed={p.id === selected} title={p.hint}>
                    <span className="dl-preset__name">
                      {p.name}
                      {p.id === selected && modified && <span className="dl-preset__mod">edited</span>}
                    </span>
                    <span className="dl-preset__hint">{p.hint}</span>
                  </button>
                  {p.custom && (
                    <button className="dl-preset__del" onClick={() => deleteCustom(p.id)} aria-label={`Delete preset ${p.name}`} title="Delete preset" data-testid={`dl-preset-delete-${p.id}`}>
                      <I.Trash size={13} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          );
        })}
        {!found.length && <div className="dl-empty">No presets match “{query}”.</div>}
      </div>
    </div>
  );
}
