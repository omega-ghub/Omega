// Stills gallery strip: grab the program frame, click a still to show it as
// the reference beside the scopes (and for Match), remove with ×.
import { grabStill } from './colorActions';
import { CI } from './icons';
import { StillCanvas } from './Scopes';
import { clearStills, removeStill, setReference, useReference, useStills } from './stills';

export function Gallery() {
  const stills = useStills();
  const ref = useReference();
  return (
    <div className="cl-gallery" data-testid="cl-gallery">
      <div className="cl-gallery__head">
        <span className="cl-subhead">Stills</span>
        <span className="cl-spacer" />
        {stills.length > 0 && (
          <button type="button" className="cl-chip" title="Remove every still (they are kept for this session only)" data-testid="cl-stills-clear" onClick={clearStills}>
            Clear
          </button>
        )}
      </div>
      <div className="cl-gallery__strip">
        <button type="button" className="cl-gallery__grab" title="Grab a still of the program frame" aria-label="Grab still" data-testid="cl-grab-still" onClick={() => void grabStill()}>
          <CI.Still size={16} />
        </button>
        {stills.map((s) => (
          <div key={s.id} className={`cl-still ${ref?.id === s.id ? 'is-ref' : ''}`} data-testid="cl-still">
            <button
              type="button"
              className="cl-still__btn"
              title={`${s.timecode}${s.clipName ? ` · ${s.clipName}` : ''} — ${ref?.id === s.id ? 'click to hide the reference' : 'click to use as reference'}`}
              aria-pressed={ref?.id === s.id}
              onClick={() => setReference(ref?.id === s.id ? null : s.id)}
            >
              <StillCanvas still={s} className="cl-still__img" />
              <span className="cl-still__tc">{s.timecode}</span>
            </button>
            <button type="button" className="cl-still__x" title="Remove still" aria-label="Remove still" data-testid="cl-still-remove" onClick={() => removeStill(s.id)}>
              <CI.Close size={10} />
            </button>
          </div>
        ))}
        {!stills.length && <span className="cl-gallery__empty">Grab stills to compare shots and match them.</span>}
      </div>
    </div>
  );
}
