// The Delta timeline panel: toolbar + sequence tabs (DOM), track headers
// (DOM), ruler and clip area (canvas, see controller.ts / draw.ts).
import { useEffect, useRef } from 'react';
import { useEditor } from '../../../state/store';
import { TimelineController } from './controller';
import { ContextMenu } from './Menu';
import { ClipList, InlineEditor, TransitionPopover } from './Overlays';
import { HScroll, VScroll } from './Scrollbars';
import { SequenceTabs, Toolbar } from './Toolbar';
import { AddTrackButtons, TrackHeaders } from './TrackHeaders';
import { useTLView } from './view';
import './timeline.css';

export function Timeline(_props: Record<string, unknown> = {}) {
  const hasProject = useEditor((s) => !!s.project);
  if (!hasProject) return null;
  return <TimelinePanel />;
}

function TimelinePanel() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const ruler = useRef<HTMLCanvasElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const rulerWrap = useRef<HTMLDivElement>(null);
  const tool = useEditor((s) => s.tool);
  const projectId = useEditor((s) => s.project!.id);
  const activeSeq = useEditor((s) => s.project!.activeSequenceId);

  useEffect(() => {
    const ctl = new TimelineController(canvas.current!, ruler.current!, wrap.current!, rulerWrap.current!);
    ctl.attach();
    return () => ctl.detach();
  }, []);

  // keep the active sequence in the tab strip
  useEffect(() => {
    useTLView.getState().openTab(projectId, activeSeq);
    const v = useTLView.getState();
    v.setGap(null);
    v.setTransition(null);
    v.setT0(v.t0);
  }, [projectId, activeSeq]);

  return (
    <section className="tl-root" data-testid="tl-root" data-tool={tool} aria-label="Timeline">
      <SequenceTabs />
      <Toolbar />
      <div className="tl-main">
        <div className="tl-corner" />
        <div className="tl-ruler-wrap" ref={rulerWrap}>
          <canvas ref={ruler} className="tl-ruler" data-testid="tl-ruler" />
        </div>
        <div className="tl-corner-r" />
        <TrackHeaders />
        <div className="tl-canvas-wrap" ref={wrap}>
          <canvas ref={canvas} className="tl-canvas" data-testid="tl-canvas" role="application" aria-label="Timeline clips" aria-describedby="tl-clip-list-desc" />
        </div>
        <VScroll />
        <AddTrackButtons />
        <HScroll />
        <div className="tl-corner-r" />
      </div>
      <span id="tl-clip-list-desc" className="tl-sr">
        Clips are listed in the visible clip list.
      </span>
      <ClipList />
      <ContextMenu />
      <InlineEditor />
      <TransitionPopover />
    </section>
  );
}
