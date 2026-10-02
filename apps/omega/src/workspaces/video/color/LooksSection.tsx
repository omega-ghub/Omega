// Built-in looks: a card per look with a preview swatch (the look applied to
// a small test scene by the CPU grade model). One click layers it over the
// selected clips' grades as one undo step.
import { useEffect, useRef } from 'react';
import { defaultGrade } from '../../../state/defaults';
import { applyLook } from './colorActions';
import { renderSwatch } from './gradeModel';
import { composeLook, LOOKS, type LookDef } from './looks';

const SW = 80;
const SH = 45;
const cache = new Map<string, Uint8ClampedArray>();
// Swatches are rendered one per tick (each is ~3600 pixels through the full
// grade pipeline), so opening the tab never blocks the UI.
const queue: (() => void)[] = [];
let pumping = false;
function pump() {
  const job = queue.shift();
  if (!job) {
    pumping = false;
    return;
  }
  job();
  setTimeout(pump, 0);
}
function enqueue(job: () => void) {
  queue.push(job);
  if (!pumping) {
    pumping = true;
    setTimeout(pump, 0);
  }
}

function Swatch({ look }: { look: LookDef }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let alive = true;
    const paint = (d: Uint8ClampedArray) => ref.current?.getContext('2d')?.putImageData(new ImageData(d as Uint8ClampedArray<ArrayBuffer>, SW, SH), 0, 0);
    const hit = cache.get(look.id);
    if (hit) paint(hit);
    else
      enqueue(() => {
        if (!alive) return;
        const d = cache.get(look.id) ?? renderSwatch(composeLook(defaultGrade(), look), SW, SH);
        cache.set(look.id, d);
        paint(d);
      });
    return () => {
      alive = false;
    };
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
