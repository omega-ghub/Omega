// Transitions at the clip's head (in) and tail (out): type, duration, ease,
// type-specific params, remove.

import { useSequence } from '../../../../state/store';
import { makeTransition } from '../../../../state/defaults';
import type { Clip, Ease, Track, Transition, TransitionType } from '../../../../state/types';
import { addTransition } from '../../../../engine/edit/ops';
import { getTransition, listTransitions } from '../../../../engine/effects/registry';
import { fromFrames } from '../../../../engine/time';
import { editClip, editField, IconButton, ParamRow, ScrubNumber, Section, Select, Toggle, type SelectOption } from '../controls';
import { II } from '../icons';

export const EASE_OPTIONS: SelectOption<Ease>[] = [
  { value: 'linear', label: 'Linear' },
  { value: 'easeIn', label: 'Ease in' },
  { value: 'easeOut', label: 'Ease out' },
  { value: 'easeInOut', label: 'Ease in-out' },
];

const TYPE_NAMES: Record<TransitionType, string> = {
  crossDissolve: 'Cross dissolve',
  filmDissolve: 'Film dissolve',
  additiveDissolve: 'Additive dissolve',
  dipToBlack: 'Dip to black',
  dipToWhite: 'Dip to white',
  wipe: 'Wipe',
  slide: 'Slide',
  push: 'Push',
  zoom: 'Zoom',
  blurDissolve: 'Blur dissolve',
  iris: 'Iris',
  clockWipe: 'Clock wipe',
  whip: 'Whip pan',
  glitch: 'Glitch',
  lightLeak: 'Light leak',
  audioCrossfade: 'Audio crossfade',
};

function typeOptions(audio: boolean): SelectOption<TransitionType | 'none'>[] {
  const none: SelectOption<'none'> = { value: 'none', label: 'None' };
  if (audio) return [none, { value: 'audioCrossfade', label: TYPE_NAMES.audioCrossfade }];
  const defs = listTransitions().filter((d) => d.type !== 'audioCrossfade');
  const opts: SelectOption<TransitionType | 'none'>[] = defs.map((d) => ({ value: d.type as TransitionType, label: d.name, group: d.category }));
  if (!opts.length) {
    // The GLSL library is not loaded: offer the document's built-in types.
    for (const t of Object.keys(TYPE_NAMES) as TransitionType[]) if (t !== 'audioCrossfade') opts.push({ value: t, label: TYPE_NAMES[t] });
  }
  return [none, ...opts];
}

function TransitionEditor({ clip, edge, audio }: { clip: Clip; edge: 'in' | 'out'; audio: boolean }) {
  const seq = useSequence();
  const tr: Transition | null = edge === 'in' ? clip.transitionIn : clip.transitionOut;
  const key = edge === 'in' ? 'transitionIn' : 'transitionOut';
  const frame = fromFrames(1, seq.fps);
  const def = tr ? getTransition(tr.type) : undefined;
  const label = edge === 'in' ? 'In' : 'Out';

  const setType = (type: TransitionType | 'none') => {
    if (type === 'none') {
      editClip(clip.id, `Remove ${label.toLowerCase()} transition`, (c) => void (c[key] = null));
      return;
    }
    if (tr) {
      editClip(clip.id, `Change ${label.toLowerCase()} transition`, (c) => {
        const cur = c[key];
        if (cur) {
          cur.type = type;
          cur.params = {};
        }
      });
      return;
    }
    const duration = Math.min(1, clip.duration);
    try {
      editClip(clip.id, `Add ${label.toLowerCase()} transition`, (_c, s) => addTransition(s, clip.id, edge === 'in' ? 'start' : 'end', type, duration));
    } catch {
      // Editing engine unavailable: set the transition directly.
      editClip(clip.id, `Add ${label.toLowerCase()} transition`, (c) => void (c[key] = makeTransition(type, duration)));
    }
  };

  const setTr = (k: string, l: string, fn: (t: Transition) => void) =>
    editField(clip.id, `${key}.${k}`, l, (c) => {
      const t = c[key];
      if (t) fn(t);
    });

  return (
    <div className="ins-trans" data-testid={`ins-trans-${edge}`}>
      <ParamRow label={label}>
        <Select value={tr?.type ?? 'none'} options={typeOptions(audio)} aria-label={`${label} transition`} data-testid={`ins-trans-${edge}-type`} onChange={setType} />
        {tr && (
          <IconButton title="Remove transition" data-testid={`ins-trans-${edge}-remove`} onClick={() => setType('none')}>
            <II.Close size={13} />
          </IconButton>
        )}
      </ParamRow>
      {tr && (
        <>
          <ParamRow label="Duration" indent>
            <ScrubNumber
              value={tr.duration}
              min={frame * 2}
              max={Math.max(frame * 2, clip.duration * 2)}
              step={frame}
              dragStep={frame / 2}
              precision={2}
              unit="s"
              defaultValue={1}
              aria-label={`${label} transition duration`}
              data-testid={`ins-trans-${edge}-duration`}
              onChange={(v) => setTr('duration', 'Transition duration', (t) => void (t.duration = Math.round(v / frame) * frame))}
            />
          </ParamRow>
          <ParamRow label="Ease" indent>
            <Select value={tr.ease} options={EASE_OPTIONS} aria-label={`${label} transition ease`} data-testid={`ins-trans-${edge}-ease`} onChange={(e) => setTr('ease', 'Transition ease', (t) => void (t.ease = e))} />
          </ParamRow>
          {def?.params.map((p) => {
            const v = tr.params[p.key] ?? Number(p.default);
            const set = (x: number) => setTr(`p.${p.key}`, `Transition ${p.label.toLowerCase()}`, (t) => void (t.params[p.key] = x));
            if (p.type === 'choice' && p.choices)
              return (
                <ParamRow key={p.key} label={p.label} indent>
                  <Select value={v} options={p.choices.map((c) => ({ value: c.value, label: c.label }))} aria-label={p.label} data-testid={`ins-trans-${edge}-p-${p.key}`} onChange={set} />
                </ParamRow>
              );
            if (p.type === 'bool')
              return (
                <ParamRow key={p.key} label={p.label} indent>
                  <Toggle checked={!!v} aria-label={p.label} data-testid={`ins-trans-${edge}-p-${p.key}`} onChange={(on) => set(on ? 1 : 0)} />
                </ParamRow>
              );
            if (p.type !== 'number' && p.type !== 'angle') return null;
            return (
              <ParamRow key={p.key} label={p.label} indent hint={p.hint}>
                <ScrubNumber
                  value={v}
                  min={p.min}
                  max={p.max}
                  step={p.step ?? (p.type === 'angle' ? 1 : 0.01)}
                  unit={p.type === 'angle' ? '°' : p.unit === 'x' ? '×' : p.unit}
                  defaultValue={Number(p.default)}
                  aria-label={p.label}
                  data-testid={`ins-trans-${edge}-p-${p.key}`}
                  onChange={set}
                />
              </ParamRow>
            );
          })}
        </>
      )}
    </div>
  );
}

export function TransitionsSection({ clip, track }: { clip: Clip; track: Track }) {
  const audio = track.kind === 'audio';
  const sorted = [...track.clips].sort((a, b) => a.start - b.start);
  const next = sorted.find((c) => c.start > clip.start + 1e-6);
  const followed = !!next && Math.abs(clip.start + clip.duration - next.start) < 1e-3;
  const count = (clip.transitionIn ? 1 : 0) + (clip.transitionOut ? 1 : 0);
  return (
    <Section id="transitions" title="Transitions" defaultOpen={false} badge={count || undefined} data-testid="ins-sec-transitions">
      <TransitionEditor clip={clip} edge="in" audio={audio} />
      <TransitionEditor clip={clip} edge="out" audio={audio} />
      {followed && clip.transitionOut && <p className="ins-note">A clip follows this one, so the out transition only plays when the next clip is moved away. Use the next clip's in transition for the cut.</p>}
    </Section>
  );
}
