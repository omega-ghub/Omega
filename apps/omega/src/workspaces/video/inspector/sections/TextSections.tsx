// Text clips: content and typography, appearance (stroke, shadow, background
// box) and in/out animation presets.

import type { Clip, TextAnimation, TextProps } from '../../../../state/types';
import { transport } from '../../../../engine/playback/transport';
import {
  ColorField,
  editField,
  IconButton,
  ParamRow,
  PointField,
  ScrubNumber,
  Section,
  Segmented,
  Select,
  Toggle,
  type SelectOption,
} from '../controls';
import { NumParam, TextArea } from '../fields';
import { matchFont, primaryFamily, requestLocalFonts, useFontChoices, WEIGHTS } from '../fonts';
import { II } from '../icons';

type TextDraft = { text?: TextProps };

/** Edits clip.text with a coalesce key per field. */
function setText(clip: Clip, key: string, label: string, fn: (t: TextProps) => void) {
  editField(clip.id, `text.${key}`, label, (c: TextDraft) => {
    if (c.text) fn(c.text);
  });
}

export const IN_ANIMATIONS: SelectOption<TextAnimation['in']>[] = [
  { value: 'none', label: 'None' },
  { value: 'fade', label: 'Fade' },
  { value: 'slideUp', label: 'Slide up' },
  { value: 'slideDown', label: 'Slide down' },
  { value: 'slideLeft', label: 'Slide left' },
  { value: 'slideRight', label: 'Slide right' },
  { value: 'typewriter', label: 'Typewriter' },
  { value: 'pop', label: 'Pop' },
  { value: 'blur', label: 'Blur in' },
  { value: 'wordByWord', label: 'Word by word' },
  { value: 'tracking', label: 'Tracking in' },
];

export const OUT_ANIMATIONS: SelectOption<TextAnimation['out']>[] = [
  { value: 'none', label: 'None' },
  { value: 'fade', label: 'Fade' },
  { value: 'slideUp', label: 'Slide up' },
  { value: 'slideDown', label: 'Slide down' },
  { value: 'slideLeft', label: 'Slide left' },
  { value: 'slideRight', label: 'Slide right' },
  { value: 'pop', label: 'Pop' },
  { value: 'blur', label: 'Blur out' },
  { value: 'tracking', label: 'Tracking out' },
];

export function TextSection({ clip }: { clip: Clip }) {
  const t = clip.text!;
  const fonts = useFontChoices();
  const match = matchFont(fonts, t.font);
  const fontOptions: SelectOption<string>[] = fonts.map((f) => ({ value: f.family, label: f.label, group: f.group }));
  if (!match) fontOptions.unshift({ value: t.font, label: primaryFamily(t.font) || 'Custom', group: 'Current' });
  const weightOptions: SelectOption<number>[] = WEIGHTS.map((w) => ({ value: w.value, label: `${w.label} · ${w.value}` }));
  if (!WEIGHTS.some((w) => w.value === t.weight)) weightOptions.push({ value: t.weight, label: String(t.weight) });

  return (
    <Section id="text" title="Text" data-testid="ins-sec-text">
      <div className="ins-text-content">
        <TextArea
          value={t.content}
          rows={Math.min(6, Math.max(2, t.content.split('\n').length + 1))}
          aria-label="Text"
          data-testid="ins-text-content"
          onChange={(v) => setText(clip, 'content', 'Edit text', (x) => void (x.content = v))}
        />
      </div>
      <ParamRow label="Font">
        <div className="ins-fontpick" onPointerDown={() => void requestLocalFonts()} style={{ display: 'flex', flex: 1, minWidth: 0 }}>
          <Select
            value={match?.family ?? t.font}
            options={fontOptions}
            aria-label="Font"
            data-testid="ins-text-font"
            onChange={(font) => setText(clip, 'font', 'Change font', (x) => void (x.font = font))}
          />
        </div>
      </ParamRow>
      <ParamRow label="Weight">
        <Select value={t.weight} options={weightOptions} aria-label="Weight" data-testid="ins-text-weight" onChange={(w) => setText(clip, 'weight', 'Change weight', (x) => void (x.weight = w))} />
      </ParamRow>
      <NumParam clip={clip} path="text.size" label="Size" min={1} max={2000} step={1} precision={0} unit="px" testid="ins-text-size" />
      <ParamRow label="Style">
        <IconButton title="Italic" active={t.italic} data-testid="ins-text-italic" onClick={() => setText(clip, 'italic', 'Italic', (x) => void (x.italic = !x.italic))}>
          <span className="ins-glyph ins-glyph--italic">I</span>
        </IconButton>
        <IconButton title="All caps" active={t.uppercase} data-testid="ins-text-upper" onClick={() => setText(clip, 'uppercase', 'All caps', (x) => void (x.uppercase = !x.uppercase))}>
          <span className="ins-glyph">TT</span>
        </IconButton>
        <span className="ins-spacer" />
        <Segmented
          value={t.align}
          aria-label="Alignment"
          data-testid="ins-text-align"
          options={[
            { value: 'left', icon: <II.AlignLeft size={14} />, title: 'Align left', 'data-testid': 'ins-text-align-left' },
            { value: 'center', icon: <II.AlignCenter size={14} />, title: 'Center', 'data-testid': 'ins-text-align-center' },
            { value: 'right', icon: <II.AlignRight size={14} />, title: 'Align right', 'data-testid': 'ins-text-align-right' },
          ]}
          onChange={(a) => setText(clip, 'align', 'Align text', (x) => void (x.align = a))}
        />
      </ParamRow>
      <ParamRow label="Color">
        <ColorField value={t.color} alpha aria-label="Text color" data-testid="ins-text-color" onChange={(c) => setText(clip, 'color', 'Text color', (x) => void (x.color = c))} />
      </ParamRow>
      <NumParam clip={clip} path="text.lineHeight" label="Line height" min={0.5} max={4} step={0.01} precision={2} defaultValue={1.15} testid="ins-text-lineheight" />
      <NumParam clip={clip} path="text.letterSpacing" label="Tracking" min={-200} max={1000} step={0.5} precision={1} unit="px" defaultValue={0} testid="ins-text-tracking" />
      <ParamRow label="Wrap width" hint="Lines wrap at this width; 0 = no wrapping">
        <ScrubNumber
          value={t.maxWidth}
          min={0}
          max={20000}
          step={10}
          dragStep={2}
          precision={0}
          unit={t.maxWidth > 0 ? 'px' : undefined}
          format={(v) => (v > 0 ? String(Math.round(v)) : 'Off')}
          defaultValue={0}
          aria-label="Wrap width"
          data-testid="ins-text-maxwidth"
          onChange={(v) => setText(clip, 'maxWidth', 'Change wrap width', (x) => void (x.maxWidth = Math.max(0, Math.round(v))))}
        />
      </ParamRow>
    </Section>
  );
}

export function TextAppearanceSection({ clip }: { clip: Clip }) {
  const t = clip.text!;
  return (
    <Section id="textAppearance" title="Appearance" data-testid="ins-sec-textappearance">
      <ParamRow label="Stroke">
        <Toggle checked={t.stroke.enabled} aria-label="Stroke" data-testid="ins-text-stroke" onChange={(on) => setText(clip, 'stroke.enabled', on ? 'Add stroke' : 'Remove stroke', (x) => void (x.stroke.enabled = on))} />
        {t.stroke.enabled && (
          <>
            <ColorField compact value={t.stroke.color} aria-label="Stroke color" data-testid="ins-text-stroke-color" onChange={(c) => setText(clip, 'stroke.color', 'Stroke color', (x) => void (x.stroke.color = c))} />
            <ScrubNumber
              value={t.stroke.width}
              min={0}
              max={200}
              step={0.5}
              precision={1}
              unit="px"
              defaultValue={4}
              aria-label="Stroke width"
              data-testid="ins-text-stroke-width"
              onChange={(v) => setText(clip, 'stroke.width', 'Stroke width', (x) => void (x.stroke.width = v))}
            />
          </>
        )}
      </ParamRow>
      <ParamRow label="Shadow">
        <Toggle checked={t.shadow.enabled} aria-label="Shadow" data-testid="ins-text-shadow" onChange={(on) => setText(clip, 'shadow.enabled', on ? 'Add shadow' : 'Remove shadow', (x) => void (x.shadow.enabled = on))} />
        {t.shadow.enabled && (
          <>
            <ColorField compact value={t.shadow.color} aria-label="Shadow color" data-testid="ins-text-shadow-color" onChange={(c) => setText(clip, 'shadow.color', 'Shadow color', (x) => void (x.shadow.color = c))} />
            <ScrubNumber
              value={t.shadow.opacity}
              min={0}
              max={1}
              step={0.01}
              displayScale={100}
              precision={0}
              unit="%"
              defaultValue={0.5}
              aria-label="Shadow opacity"
              data-testid="ins-text-shadow-opacity"
              onChange={(v) => setText(clip, 'shadow.opacity', 'Shadow opacity', (x) => void (x.shadow.opacity = v))}
            />
          </>
        )}
      </ParamRow>
      {t.shadow.enabled && (
        <>
          <ParamRow label="Blur" indent>
            <ScrubNumber value={t.shadow.blur} min={0} max={500} step={1} precision={0} unit="px" defaultValue={24} aria-label="Shadow blur" data-testid="ins-text-shadow-blur" onChange={(v) => setText(clip, 'shadow.blur', 'Shadow blur', (x) => void (x.shadow.blur = v))} />
          </ParamRow>
          <ParamRow label="Offset" indent>
            <PointField
              value={{ x: t.shadow.x, y: t.shadow.y }}
              step={1}
              precision={0}
              unit="px"
              defaultValue={{ x: 0, y: 8 }}
              data-testid="ins-text-shadow-offset"
              onChange={(p) =>
                setText(clip, 'shadow.offset', 'Shadow offset', (x) => {
                  x.shadow.x = p.x;
                  x.shadow.y = p.y;
                })
              }
            />
          </ParamRow>
        </>
      )}
      <ParamRow label="Background">
        <Toggle checked={t.background.enabled} aria-label="Background box" data-testid="ins-text-bg" onChange={(on) => setText(clip, 'background.enabled', on ? 'Add background' : 'Remove background', (x) => void (x.background.enabled = on))} />
        {t.background.enabled && (
          <>
            <ColorField compact value={t.background.color} aria-label="Background color" data-testid="ins-text-bg-color" onChange={(c) => setText(clip, 'background.color', 'Background color', (x) => void (x.background.color = c))} />
            <ScrubNumber
              value={t.background.opacity}
              min={0}
              max={1}
              step={0.01}
              displayScale={100}
              precision={0}
              unit="%"
              defaultValue={0.6}
              aria-label="Background opacity"
              data-testid="ins-text-bg-opacity"
              onChange={(v) => setText(clip, 'background.opacity', 'Background opacity', (x) => void (x.background.opacity = v))}
            />
          </>
        )}
      </ParamRow>
      {t.background.enabled && (
        <>
          <ParamRow label="Padding" indent>
            <PointField
              value={{ x: t.background.paddingX, y: t.background.paddingY }}
              labels={['H', 'V']}
              min={0}
              step={1}
              precision={0}
              unit="px"
              defaultValue={{ x: 32, y: 16 }}
              data-testid="ins-text-bg-padding"
              onChange={(p) =>
                setText(clip, 'background.padding', 'Background padding', (x) => {
                  x.background.paddingX = p.x;
                  x.background.paddingY = p.y;
                })
              }
            />
          </ParamRow>
          <ParamRow label="Radius" indent>
            <ScrubNumber
              value={t.background.radius}
              min={0}
              max={1000}
              step={1}
              precision={0}
              unit="px"
              defaultValue={12}
              aria-label="Background radius"
              data-testid="ins-text-bg-radius"
              onChange={(v) => setText(clip, 'background.radius', 'Background radius', (x) => void (x.background.radius = v))}
            />
          </ParamRow>
        </>
      )}
    </Section>
  );
}

export function TextAnimationSection({ clip }: { clip: Clip }) {
  const a = clip.text!.animation;
  const preview = (edge: 'in' | 'out') => {
    const len = edge === 'in' ? Math.min(clip.duration, a.inDuration + 0.6) : Math.min(clip.duration, a.outDuration + 0.6);
    const from = edge === 'in' ? clip.start : clip.start + clip.duration - len;
    transport.seek(from);
    if (transport.playRange) transport.playRange(from, from + len);
    else transport.play();
  };
  return (
    <Section id="textAnimation" title="Text animation" data-testid="ins-sec-textanim" badge={a.in !== 'none' || a.out !== 'none' ? '•' : undefined}>
      <ParamRow label="In">
        <Select value={a.in} options={IN_ANIMATIONS} aria-label="In animation" data-testid="ins-text-anim-in" onChange={(v) => setText(clip, 'animation.in', 'Text animation in', (x) => void (x.animation.in = v))} />
        <ScrubNumber
          value={a.inDuration}
          min={0.04}
          max={30}
          step={0.05}
          precision={2}
          unit="s"
          defaultValue={0.5}
          width={64}
          disabled={a.in === 'none'}
          aria-label="In duration"
          data-testid="ins-text-anim-in-dur"
          onChange={(v) => setText(clip, 'animation.inDuration', 'Animation in duration', (x) => void (x.animation.inDuration = v))}
        />
        <IconButton title="Preview the in animation" disabled={a.in === 'none'} data-testid="ins-text-anim-in-preview" onClick={() => preview('in')}>
          <II.TriRight size={12} />
        </IconButton>
      </ParamRow>
      <ParamRow label="Out">
        <Select value={a.out} options={OUT_ANIMATIONS} aria-label="Out animation" data-testid="ins-text-anim-out" onChange={(v) => setText(clip, 'animation.out', 'Text animation out', (x) => void (x.animation.out = v))} />
        <ScrubNumber
          value={a.outDuration}
          min={0.04}
          max={30}
          step={0.05}
          precision={2}
          unit="s"
          defaultValue={0.5}
          width={64}
          disabled={a.out === 'none'}
          aria-label="Out duration"
          data-testid="ins-text-anim-out-dur"
          onChange={(v) => setText(clip, 'animation.outDuration', 'Animation out duration', (x) => void (x.animation.outDuration = v))}
        />
        <IconButton title="Preview the out animation" disabled={a.out === 'none'} data-testid="ins-text-anim-out-preview" onClick={() => preview('out')}>
          <II.TriRight size={12} />
        </IconButton>
      </ParamRow>
    </Section>
  );
}
