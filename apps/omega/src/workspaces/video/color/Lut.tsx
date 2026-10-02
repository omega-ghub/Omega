// Project LUTs: import .cube files, choose one for the clip, set its
// intensity (keyframeable), remove LUTs from the project.
import { useEffect, useState } from 'react';
import { paramAt } from '../../../engine/keyframes';
import { useEditor } from '../../../state/store';
import type { Clip } from '../../../state/types';
import { importLuts, removeLut, setClipLut } from './colorActions';
import { SliderRow } from './controls';
import { setGradeParam } from './grade';
import { CI } from './icons';

const fileName = (p: string) => p.replace(/^.*[\\/]/, '');

export function LutSection({ clip, local }: { clip: Clip; local: number }) {
  const luts = useEditor((s) => s.project?.luts ?? []);
  const [missing, setMissing] = useState<Record<string, boolean>>({});
  useEffect(() => {
    let alive = true;
    void (async () => {
      const out: Record<string, boolean> = {};
      for (const l of luts) {
        try {
          out[l.id] = !(await window.omega.media.exists(l.path));
        } catch {
          out[l.id] = false;
        }
      }
      if (alive) setMissing(out);
    })();
    return () => {
      alive = false;
    };
  }, [luts]);
  const current = clip.grade.lut.id;
  const intensity = paramAt(clip, 'grade.lut.intensity', local);

  return (
    <div className="cl-lut" data-testid="cl-lut">
      <div className="cl-lut__head">
        <span className="cl-subhead">Project LUTs</span>
        <button type="button" className="cl-tool" data-testid="cl-lut-import" onClick={() => void importLuts()} title="Import .cube LUT files into the project">
          <CI.Plus size={14} />
          <span>Import .cube…</span>
        </button>
      </div>
      <div className="cl-lut__list" role="radiogroup" aria-label="LUT for this clip">
        <button type="button" role="radio" aria-checked={!current} className={`cl-lut__row ${!current ? 'is-on' : ''}`} data-testid="cl-lut-none" onClick={() => current && setClipLut(clip.id, null)}>
          <span className="cl-lut__radio" />
          <span className="cl-lut__name">None</span>
        </button>
        {luts.map((l) => (
          <div key={l.id} className={`cl-lut__row ${current === l.id ? 'is-on' : ''}`} data-testid={`cl-lut-${l.id}`}>
            <button type="button" role="radio" aria-checked={current === l.id} className="cl-lut__pick" data-testid="cl-lut-select" onClick={() => current !== l.id && setClipLut(clip.id, l.id)} title={l.path}>
              <span className="cl-lut__radio" />
              <span className="cl-lut__name">{l.name}</span>
              <span className="cl-lut__file">{missing[l.id] ? 'File missing' : fileName(l.path)}</span>
            </button>
            <button type="button" className="cl-icon-btn" title={`Remove “${l.name}” from the project`} aria-label={`Remove ${l.name}`} data-testid={`cl-lut-remove-${l.id}`} onClick={() => removeLut(l.id)}>
              <CI.Trash size={13} />
            </button>
          </div>
        ))}
        {!luts.length && <p className="cl-note">No LUTs in this project yet. Import a .cube (1D or 3D) to use it on any clip.</p>}
      </div>
      {current && (
        <div className="cl-rows">
          <SliderRow
            label="Intensity"
            value={intensity}
            min={0}
            max={1}
            step={0.01}
            defaultValue={1}
            precision={0}
            displayScale={100}
            unit="%"
            clipId={clip.id}
            path="grade.lut.intensity"
            testid="cl-lut-intensity"
            onChange={(v) => setGradeParam(clip.id, 'grade.lut.intensity', Math.round(v * 1000) / 1000, 'Change LUT intensity')}
          />
        </div>
      )}
    </div>
  );
}
