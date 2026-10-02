// Built-in looks: a card per look with a preview swatch (the look applied to
// a small test scene by the CPU grade model). One click layers it over the
// selected clips' grades as one undo step.
import { useLayoutEffect, useRef } from 'react';
import { defaultGrade } from '../../../state/defaults';
import { applyLook } from './colorActions';
import { renderSwatch } from './gradeModel';
import { composeLook, LOOKS, type LookDef } from './looks';

const SW = 96;
const SH = 54;
const cache = new Map<string, Uint8ClampedArray>();

function swatch(look: LookDef | null): Uint8ClampedArray {
  const key = look?.id ?? '__original';
  let d = cache.get(key);
  if (!d) {
    d = renderSwatch(look ? composeLook(defaultGrade(), look) : defaultGrade(), SW, SH);
    cache.set(key, d);
  }
  return d;
}

function Swatch({ look }: { look: LookDef }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    const c = ref.current;
    if (!c) return;
    c.getContext('2d')?.putImageData(new ImageData(swatch(look) as Uint8ClampedArray<ArrayBuffer>, SW, SH), 0, 0);
  }, [look]);
  return <canvas ref={ref} width={SW} height={SH} className="cl-look__swatch" aria-hidden="true" />;
}

export function LooksSection({ disabled }: { disabled: boolean }) {
  return (
    <div className="cl-looks" data-testid="cl-looks">
      <p className="cl-note">Looks layer over the clip’s correction: balance stays, the look goes on top. Applies to every selected clip.</p>
      <div className="cl-looks__grid">
        {LOOKS.map((look) => (
          <button key={look.id} type="button" className="cl-look" title={look.description} disabled={disabled} data-testid={`cl-look-${look.id}`} onClick={() => applyLook(look.id)}>
            <Swatch look={look} />
            <span className="cl-look__name">{look.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
