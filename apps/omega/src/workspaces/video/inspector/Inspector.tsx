// The Inspector panel: context-sensitive properties of the selection.
//   nothing selected → sequence summary
//   one clip (a linked A/V pair counts as one) → its sections + keyframe lane
//   several clips → batch editing of the fields they share

import { useMemo } from 'react';
import { useEditor, useSequence } from '../../../state/store';
import { LABEL_COLORS } from '../../../state/defaults';
import { assetOf, type Clip, type Track } from '../../../state/types';
import { AudioClipSection } from '../audio';
import { EffectStack } from '../effects';
import { II } from './icons';
import { KeyframeLane } from './KeyframeLane';
import { resolveSelection } from './selection';
import { ClipSection } from './sections/ClipSection';
import { GradientSection, ShapeSection, SolidSection } from './sections/GeneratorSections';
import { ColorQuickSection, MultiInspector, SequenceSummary } from './sections/SummarySections';
import { TextAnimationSection, TextAppearanceSection, TextSection } from './sections/TextSections';
import { MotionSection } from './sections/MotionSection';
import { TimeSection } from './sections/TimeSection';
import { CropSection, FadesSection, FormatSection, MasksSection, TransformSection } from './sections/TransformSections';
import { TransitionsSection } from './sections/TransitionsSection';
import './inspector.css';

function kindLabel(clip: Clip, track: Track, assetKind?: string): string {
  switch (clip.kind) {
    case 'media':
      return track.kind === 'audio' ? 'Audio' : assetKind === 'image' ? 'Still' : 'Video';
    case 'text':
      return 'Title';
    case 'shape':
      return 'Shape';
    case 'solid':
      return 'Solid';
    case 'gradient':
      return 'Gradient';
    case 'adjustment':
      return 'Adjustment';
    case 'sequence':
      return 'Nested sequence';
  }
}

function Header({ dot, title, kind, extra }: { dot?: string; title: string; kind: string; extra?: string }) {
  return (
    <header className="ins-head" data-testid="ins-header">
      {dot && <span className="ins-head__dot" style={{ background: dot }} aria-hidden="true" />}
      <span className="ins-head__name" data-testid="ins-header-name" title={title}>
        {title}
      </span>
      <span className="ins-head__kind" data-testid="ins-header-kind">
        {kind}
      </span>
      {extra && <span className="ins-head__extra">{extra}</span>}
    </header>
  );
}

function SingleClip({ clip, track, audio }: { clip: Clip; track: Track; audio: { clip: Clip; track: Track } | null }) {
  const assetKind = useEditor((s) => (s.project ? assetOf(s.project, clip)?.kind : undefined));
  const isVideo = track.kind === 'video';
  const mediaLike = clip.kind === 'media' || clip.kind === 'sequence';
  const visual = isVideo && clip.kind !== 'adjustment';
  return (
    <>
      <Header dot={LABEL_COLORS[clip.label]} title={clip.name} kind={kindLabel(clip, track, assetKind)} extra={audio && audio.clip.id !== clip.id ? 'Linked A/V' : track.name} />
      <div className="ins-scroll" data-testid="ins-scroll">
        <ClipSection clip={clip} track={track} />
        {isVideo && clip.kind === 'text' && clip.text && (
          <>
            <TextSection clip={clip} />
            <TextAppearanceSection clip={clip} />
            <TextAnimationSection clip={clip} />
          </>
        )}
        {isVideo && clip.kind === 'shape' && clip.shape && <ShapeSection clip={clip} />}
        {isVideo && clip.kind === 'solid' && clip.solid && <SolidSection clip={clip} />}
        {isVideo && clip.kind === 'gradient' && clip.gradient && <GradientSection clip={clip} />}
        {visual && <TransformSection clip={clip} />}
        {visual && <MotionSection clip={clip} />}
        {visual && <FormatSection clip={clip} />}
        {visual && <CropSection clip={clip} />}
        {isVideo && <MasksSection clip={clip} />}
        {mediaLike && <TimeSection clip={clip} />}
        {isVideo && <FadesSection clip={clip} />}
        <TransitionsSection clip={clip} track={track} />
        {isVideo && (
          <div className="ins-ext-sections" data-testid="ins-sec-effects">
            <EffectStack clipId={clip.id} />
          </div>
        )}
        {audio && (
          <div className="ins-ext-sections" data-testid="ins-sec-audio">
            <AudioClipSection clipId={audio.clip.id} />
          </div>
        )}
        {isVideo && <ColorQuickSection clip={clip} />}
      </div>
      <KeyframeLane clip={clip} />
    </>
  );
}

function InspectorBody() {
  const seq = useSequence();
  const ids = useEditor((s) => s.selection.clipIds);
  const target = useMemo(() => resolveSelection(seq, ids), [seq, ids]);
  if (target.mode === 'none')
    return (
      <>
        <Header title={seq.name} kind="Sequence" />
        <div className="ins-scroll" data-testid="ins-scroll">
          <SequenceSummary />
        </div>
      </>
    );
  if (target.mode === 'multi')
    return (
      <>
        <Header title={`${target.items.length} clips selected`} kind="Batch" />
        <div className="ins-scroll" data-testid="ins-scroll">
          <MultiInspector items={target.items} />
        </div>
      </>
    );
  return <SingleClip key={target.clip.id} clip={target.clip} track={target.track} audio={target.audio} />;
}

export function Inspector(_props: Record<string, unknown> = {}) {
  const hasProject = useEditor((s) => !!s.project);
  return (
    <div className="ins" data-testid="ins-panel">
      {hasProject ? (
        <InspectorBody />
      ) : (
        <div className="ins-empty">
          <II.Sliders size={20} />
          <p>No project open</p>
        </div>
      )}
    </div>
  );
}
