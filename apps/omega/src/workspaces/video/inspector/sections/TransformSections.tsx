// Transform, crop, masks, video fades and per-format (multi-aspect) overrides.

import { useState } from 'react';
import { useSequence } from '../../../../state/store';
import { defaultCrop, defaultTransform, makeMask } from '../../../../state/defaults';
import type { BlendMode, Clip, FitMode, Mask } from '../../../../state/types';
import { isAnimated } from '../../../../engine/keyframes';
import { fromFrames } from '../../../../engine/time';
import { editClip, editField, editParam, IconButton, ParamRow, ScrubNumber, Section, Select, Toggle, useParam, type SelectOption } from '../controls';
import { NumParam, PointParam, TextInput } from '../fields';
import { II } from '../icons';

export const FIT_OPTIONS: SelectOption<FitMode>[] = [
  { value: 'fit', label: 'Fit' },
  { value: 'fill', label: 'Fill' },
  { value: 'stretch', label: 'Stretch' },
  { value: 'none', label: 'None (100%)' },
];

export const BLEND_OPTIONS: SelectOption<BlendMode>[] = [
  { value: 'normal', label: 'Normal' },
  { value: 'darken', label: 'Darken', group: 'Darken' },
  { value: 'multiply', label: 'Multiply', group: 'Darken' },
  { value: 'colorBurn', label: 'Color burn', group: 'Darken' },
  { value: 'lighten', label: 'Lighten', group: 'Lighten' },
  { value: 'screen', label: 'Screen', group: 'Lighten' },
  { value: 'colorDodge', label: 'Color dodge', group: 'Lighten' },
  { value: 'add', label: 'Add', group: 'Lighten' },
  { value: 'overlay', label: 'Overlay', group: 'Contrast' },
  { value: 'softLight', label: 'Soft light', group: 'Contrast' },
  { value: 'hardLight', label: 'Hard light', group: 'Contrast' },
  { value: 'difference', label: 'Difference', group: 'Comparative' },
  { value: 'exclusion', label: 'Exclusion', group: 'Comparative' },
  { value: 'subtract', label: 'Subtract', group: 'Comparative' },
];

const TRANSFORM_PATHS = ['x', 'y', 'scale', 'scaleX', 'scaleY', 'rotation', 'anchorX', 'anchorY', 'opacity'].map((k) => `transform.${k}`);

/** Resets position/scale/rotation/anchor/opacity/flip (keeps the fit mode) and removes their keyframes. */
export function resetTransform(clipId: string): void {
  editClip(clipId, 'Reset transform', (c) => {
    c.transform = { ...defaultTransform(), fit: c.transform.fit };
    for (const p of TRANSFORM_PATHS) delete c.keyframes[p];
  });
}

/** Adds a mask (centered, half the layer) to a clip; returns its id. */
export function addMask(clipId: string, shape: Mask['shape']): string {
  const m = makeMask(shape);
  editClip(clipId, shape === 'rect' ? 'Add rectangle mask' : 'Add ellipse mask', (c) => {
    const n = c.masks.filter((x) => x.shape === shape).length;
    if (n) m.name = `${m.name} ${n + 1}`;
    c.masks.push(m);
  });
  return m.id;
}

export function TransformSection({ clip }: { clip: Clip }) {
  const mediaLike = clip.kind === 'media' || clip.kind === 'sequence';
  const t = clip.transform;
  const nonUniform = t.scaleX !== 1 || t.scaleY !== 1 || isAnimated(clip, 'transform.scaleX') || isAnimated(clip, 'transform.scaleY');
  const [unlinked, setUnlinked] = useState(nonUniform);
  const showXY = unlinked || nonUniform;
  const scale = useParam(clip.id, 'transform.scale');

  const toggleUniform = () => {
    if (showXY) {
      setUnlinked(false);
      if (nonUniform)
        editClip(clip.id, 'Uniform scale', (c) => {
          c.transform.scaleX = 1;
          c.transform.scaleY = 1;
          delete c.keyframes['transform.scaleX'];
          delete c.keyframes['transform.scaleY'];
        });
    } else setUnlinked(true);
  };

  return (
    <Section
      id="transform"
      title="Transform"
      data-testid="ins-sec-transform"
      actions={
        <IconButton title="Reset transform" data-testid="ins-transform-reset" onClick={() => resetTransform(clip.id)}>
          <II.Reset size={14} />
        </IconButton>
      }
    >
      {mediaLike && (
        <ParamRow label="Fit">
          <Select
            value={t.fit}
            options={FIT_OPTIONS}
            aria-label="Fit"
            data-testid="ins-fit"
            onChange={(fit) => editField(clip.id, 'fit', 'Change fit', (c) => void (c.transform.fit = fit))}
          />
        </ParamRow>
      )}
      <PointParam clip={clip} paths={['transform.x', 'transform.y']} label="Position" unit="px" step={1} precision={1} defaultValue={{ x: 0, y: 0 }} testid="ins-position" />
      <ParamRow label="Scale" clipId={clip.id} path="transform.scale" onReset={() => editParam(clip.id, 'transform.scale', 1)}>
        <ScrubNumber
          value={scale}
          min={0}
          max={100}
          step={0.01}
          dragStep={0.005}
          displayScale={100}
          precision={1}
          unit="%"
          defaultValue={1}
          aria-label="Scale"
          data-testid="ins-scale"
          onChange={(v) => editParam(clip.id, 'transform.scale', v)}
        />
        <IconButton title={showXY ? 'Link width and height (uniform scale)' : 'Scale width and height separately'} active={!showXY} data-testid="ins-scale-uniform" onClick={toggleUniform}>
          {showXY ? <II.Unlink size={14} /> : <II.Link size={14} />}
        </IconButton>
      </ParamRow>
      {showXY && (
        <>
          <NumParam clip={clip} path="transform.scaleX" label="Width" indent min={0} max={100} step={0.01} dragStep={0.005} displayScale={100} precision={1} unit="%" defaultValue={1} testid="ins-scalex" />
          <NumParam clip={clip} path="transform.scaleY" label="Height" indent min={0} max={100} step={0.01} dragStep={0.005} displayScale={100} precision={1} unit="%" defaultValue={1} testid="ins-scaley" />
        </>
      )}
      <NumParam clip={clip} path="transform.rotation" label="Rotation" step={0.1} dragStep={0.25} precision={1} unit="°" defaultValue={0} testid="ins-rotation" />
      <PointParam clip={clip} paths={['transform.anchorX', 'transform.anchorY']} label="Anchor" unit="px" step={1} precision={1} defaultValue={{ x: 0, y: 0 }} testid="ins-anchor" />
      <NumParam
        clip={clip}
        path="transform.opacity"
        label="Opacity"
        slider={{ min: 0, max: 1 }}
        min={0}
        max={1}
        step={0.01}
        dragStep={0.005}
        displayScale={100}
        precision={0}
        unit="%"
        defaultValue={1}
        testid="ins-opacity"
      />
      <ParamRow label="Flip">
        <IconButton title="Flip horizontally" active={t.flipH} data-testid="ins-flip-h" onClick={() => editField(clip.id, 'flipH', 'Flip horizontally', (c) => void (c.transform.flipH = !c.transform.flipH))}>
          <II.FlipH size={15} />
        </IconButton>
        <IconButton title="Flip vertically" active={t.flipV} data-testid="ins-flip-v" onClick={() => editField(clip.id, 'flipV', 'Flip vertically', (c) => void (c.transform.flipV = !c.transform.flipV))}>
          <II.FlipV size={15} />
        </IconButton>
      </ParamRow>
      <ParamRow label="Blend">
        <Select value={clip.blend} options={BLEND_OPTIONS} aria-label="Blend mode" data-testid="ins-blend" onChange={(b) => editField(clip.id, 'blend', 'Change blend mode', (c) => void (c.blend = b))} />
      </ParamRow>
    </Section>
  );
}

export function CropSection({ clip }: { clip: Clip }) {
  const pct = { min: 0, max: 1, step: 0.001, dragStep: 0.001, displayScale: 100, precision: 1, unit: '%', defaultValue: 0 };
  const cropped = clip.crop.left || clip.crop.top || clip.crop.right || clip.crop.bottom || clip.crop.feather || Object.keys(clip.keyframes).some((k) => k.startsWith('crop.'));
  return (
    <Section
      id="crop"
      title="Crop"
      defaultOpen={false}
      data-testid="ins-sec-crop"
      badge={cropped ? '•' : undefined}
      actions={
        <IconButton
          title="Reset crop"
          data-testid="ins-crop-reset"
          onClick={() =>
            editClip(clip.id, 'Reset crop', (c) => {
              c.crop = defaultCrop();
              for (const k of Object.keys(c.keyframes)) if (k.startsWith('crop.')) delete c.keyframes[k];
            })
          }
        >
          <II.Reset size={14} />
        </IconButton>
      }
    >
      <NumParam clip={clip} path="crop.left" label="Left" {...pct} testid="ins-crop-left" />
      <NumParam clip={clip} path="crop.top" label="Top" {...pct} testid="ins-crop-top" />
      <NumParam clip={clip} path="crop.right" label="Right" {...pct} testid="ins-crop-right" />
      <NumParam clip={clip} path="crop.bottom" label="Bottom" {...pct} testid="ins-crop-bottom" />
      <NumParam clip={clip} path="crop.feather" label="Feather" min={0} max={2000} step={1} precision={0} unit="px" defaultValue={0} testid="ins-crop-feather" />
    </Section>
  );
}

const MASK_MODES: SelectOption<Mask['mode']>[] = [
  { value: 'add', label: 'Add' },
  { value: 'subtract', label: 'Subtract' },
  { value: 'intersect', label: 'Intersect' },
];

function MaskBlock({ clip, mask, index }: { clip: Clip; mask: Mask; index: number }) {
  const base = `masks.${mask.id}`;
  const p = (k: string) => `${base}.${k}`;
  const setMask = (key: string, label: string, fn: (m: Mask) => void) =>
    editField(clip.id, `${base}.${key}`, label, (c) => {
      const m = c.masks.find((x) => x.id === mask.id);
      if (m) fn(m);
    });
  const remove = () =>
    editClip(clip.id, 'Delete mask', (c) => {
      c.masks = c.masks.filter((x) => x.id !== mask.id);
      for (const k of Object.keys(c.keyframes)) if (k.startsWith(`${base}.`)) delete c.keyframes[k];
    });
  const pct = { displayScale: 100, precision: 1, unit: '%', step: 0.001 };
  return (
    <div className={`ins-mask ${mask.enabled ? '' : 'ins-mask--off'}`} data-testid={`ins-mask-${index}`}>
      <div className="ins-mask__head">
        <IconButton title={mask.enabled ? 'Disable mask' : 'Enable mask'} active={false} data-testid={`ins-mask-${index}-enabled`} onClick={() => setMask('enabled', mask.enabled ? 'Disable mask' : 'Enable mask', (m) => void (m.enabled = !m.enabled))}>
          {mask.enabled ? <II.Eye size={14} /> : <II.EyeOff size={14} />}
        </IconButton>
        <span className="ins-mask__shape" title={mask.shape === 'rect' ? 'Rectangle' : 'Ellipse'}>
          {mask.shape === 'rect' ? <II.Rect size={13} /> : <II.Ellipse size={13} />}
        </span>
        <TextInput value={mask.name} aria-label="Mask name" data-testid={`ins-mask-${index}-name`} className="ins-mask__name" onCommit={(v) => setMask('name', 'Rename mask', (m) => void (m.name = v.trim() || m.name))} />
        <Select value={mask.mode} options={MASK_MODES} aria-label="Mask mode" data-testid={`ins-mask-${index}-mode`} className="ins-mask__mode" onChange={(mode) => setMask('mode', 'Change mask mode', (m) => void (m.mode = mode))} />
        <IconButton title={mask.invert ? 'Inverted' : 'Invert'} active={mask.invert} data-testid={`ins-mask-${index}-invert`} onClick={() => setMask('invert', 'Invert mask', (m) => void (m.invert = !m.invert))}>
          <II.Invert size={14} />
        </IconButton>
        <IconButton title="Delete mask" data-testid={`ins-mask-${index}-delete`} onClick={remove}>
          <II.Trash size={14} />
        </IconButton>
      </div>
      <PointParam clip={clip} paths={[p('x'), p('y')]} label="Position" {...pct} defaultValue={{ x: 0.5, y: 0.5 }} testid={`ins-mask-${index}-pos`} />
      <PointParam clip={clip} paths={[p('width'), p('height')]} label="Size" labels={['W', 'H']} min={0} {...pct} defaultValue={{ x: 0.5, y: 0.5 }} testid={`ins-mask-${index}-size`} />
      <NumParam clip={clip} path={p('rotation')} label="Rotation" step={0.1} dragStep={0.25} precision={1} unit="°" defaultValue={0} testid={`ins-mask-${index}-rotation`} />
      {mask.shape === 'rect' && (
        <NumParam clip={clip} path={p('roundness')} label="Roundness" min={0} max={1} step={0.01} displayScale={100} precision={0} unit="%" slider={{ min: 0, max: 1 }} defaultValue={0} testid={`ins-mask-${index}-roundness`} />
      )}
      <NumParam clip={clip} path={p('feather')} label="Feather" min={0} max={2000} step={1} precision={0} unit="px" defaultValue={40} testid={`ins-mask-${index}-feather`} />
      <NumParam clip={clip} path={p('expansion')} label="Expansion" min={-2000} max={2000} step={1} precision={0} unit="px" defaultValue={0} testid={`ins-mask-${index}-expansion`} />
      <NumParam clip={clip} path={p('opacity')} label="Opacity" min={0} max={1} step={0.01} displayScale={100} precision={0} unit="%" slider={{ min: 0, max: 1 }} defaultValue={1} testid={`ins-mask-${index}-opacity`} />
    </div>
  );
}

export function MasksSection({ clip }: { clip: Clip }) {
  return (
    <Section
      id="masks"
      title="Masks"
      badge={clip.masks.length || undefined}
      data-testid="ins-sec-masks"
      actions={
        <>
          <IconButton title="Add rectangle mask" data-testid="ins-mask-add-rect" onClick={() => addMask(clip.id, 'rect')}>
            <II.Rect size={14} />
          </IconButton>
          <IconButton title="Add ellipse mask" data-testid="ins-mask-add-ellipse" onClick={() => addMask(clip.id, 'ellipse')}>
            <II.Ellipse size={14} />
          </IconButton>
        </>
      }
    >
      {clip.masks.length === 0 ? (
        <p className="ins-note">Add a rectangle or ellipse mask to reveal part of the layer.</p>
      ) : (
        clip.masks.map((m, i) => <MaskBlock key={m.id} clip={clip} mask={m} index={i} />)
      )}
    </Section>
  );
}

export function FadesSection({ clip }: { clip: Clip }) {
  const fps = useSequence().fps;
  const frame = fromFrames(1, fps);
  const set = (key: 'fadeIn' | 'fadeOut', v: number) =>
    editField(clip.id, key, key === 'fadeIn' ? 'Change fade in' : 'Change fade out', (c) => {
      const other = key === 'fadeIn' ? c.fadeOut : c.fadeIn;
      c[key] = Math.max(0, Math.min(v, c.duration - other));
    });
  return (
    <Section id="fades" title="Video fades" defaultOpen={false} data-testid="ins-sec-fades" badge={clip.fadeIn || clip.fadeOut ? '•' : undefined}>
      <ParamRow label="Fade in">
        <ScrubNumber value={clip.fadeIn} min={0} max={clip.duration} step={frame} dragStep={frame / 2} precision={2} unit="s" defaultValue={0} aria-label="Fade in" data-testid="ins-fade-in" onChange={(v) => set('fadeIn', v)} />
      </ParamRow>
      <ParamRow label="Fade out">
        <ScrubNumber value={clip.fadeOut} min={0} max={clip.duration} step={frame} dragStep={frame / 2} precision={2} unit="s" defaultValue={0} aria-label="Fade out" data-testid="ins-fade-out" onChange={(v) => set('fadeOut', v)} />
      </ParamRow>
    </Section>
  );
}

/** Multi-aspect: position/scale overrides for the active alternate format. */
export function FormatSection({ clip }: { clip: Clip }) {
  const seq = useSequence();
  const fmt = seq.activeFormatId ? seq.formats.find((f) => f.id === seq.activeFormatId) : undefined;
  const playheadX = useParam(clip.id, 'transform.x');
  const playheadY = useParam(clip.id, 'transform.y');
  const playheadScale = useParam(clip.id, 'transform.scale');
  const others = seq.formats.filter((f) => f.id !== fmt?.id && clip.formatOverrides?.[f.id] && Object.keys(clip.formatOverrides[f.id]).length);
  if (!fmt) return null;
  const o = clip.formatOverrides?.[fmt.id] ?? {};
  const set = (key: 'x' | 'y' | 'scale', v: number | undefined) =>
    editField(clip.id, `fmt.${fmt.id}.${key}`, `${v === undefined ? 'Clear' : 'Set'} ${fmt.name} ${key === 'scale' ? 'scale' : 'position'}`, (c) => {
      const all = (c.formatOverrides ??= {});
      const cur = (all[fmt.id] ??= {});
      if (v === undefined) delete cur[key];
      else cur[key] = v;
      if (!Object.keys(cur).length) delete all[fmt.id];
    });
  const row = (key: 'x' | 'y' | 'scale', label: string, base: number) => {
    const has = o[key] !== undefined;
    return (
      <ParamRow label={label}>
        <ScrubNumber
          value={o[key] ?? base}
          step={key === 'scale' ? 0.01 : 1}
          dragStep={key === 'scale' ? 0.005 : 1}
          displayScale={key === 'scale' ? 100 : 1}
          precision={1}
          unit={key === 'scale' ? '%' : 'px'}
          min={key === 'scale' ? 0 : undefined}
          className={has ? 'ins-num--override' : ''}
          aria-label={`${fmt.name} ${label}`}
          data-testid={`ins-fmt-${key}`}
          onChange={(v) => set(key, v)}
        />
        {has && (
          <IconButton title="Use the main format's value" data-testid={`ins-fmt-${key}-clear`} onClick={() => set(key, undefined)}>
            <II.Close size={13} />
          </IconButton>
        )}
      </ParamRow>
    );
  };
  return (
    <Section id="formats" title={`Format · ${fmt.name}`} data-testid="ins-sec-format">
      <p className="ins-note">
        {fmt.width}×{fmt.height}. Overrides apply only to this format; animated values from the main format are replaced while overridden.
      </p>
      {row('x', 'Position X', playheadX)}
      {row('y', 'Position Y', playheadY)}
      {row('scale', 'Scale', playheadScale)}
      {others.length > 0 && (
        <div className="ins-fmt-others">
          {others.map((f) => (
            <div key={f.id} className="ins-fmt-other">
              <span>{f.name} has overrides</span>
              <button
                type="button"
                className="ins-link"
                onClick={() =>
                  editClip(clip.id, `Clear ${f.name} overrides`, (c) => {
                    if (c.formatOverrides) delete c.formatOverrides[f.id];
                  })
                }
              >
                Clear
              </button>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

/** Toggle row helper reused by text/shape sections. */
export function ToggleRow(props: { label: string; checked: boolean; onChange: (v: boolean) => void; testid?: string }) {
  return (
    <ParamRow label={props.label}>
      <Toggle checked={props.checked} onChange={props.onChange} aria-label={props.label} data-testid={props.testid} />
    </ParamRow>
  );
}
