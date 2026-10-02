import { useEffect, useRef } from 'react';
import { Player } from '../../engine/player';
import { formatTimecode, useStore } from '../../state/store';
import { sequenceDuration } from '../../state/types';
import { I } from '../../ui/Icons';
import { playerHost } from './playerHost';

export function Monitor() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<Player | null>(null);
  const project = useStore((s) => s.project)!;
  const playhead = useStore((s) => s.playhead);
  const playing = useStore((s) => s.playing);
  const setPlayhead = useStore((s) => s.setPlayhead);
  const setPlaying = useStore((s) => s.setPlaying);
  const inPoint = useStore((s) => s.inPoint);
  const outPoint = useStore((s) => s.outPoint);
  const { width, height, fps, dropFrame } = project.settings;
  const duration = sequenceDuration(project.sequence);

  // Create the player once per mount.
  useEffect(() => {
    const canvas = canvasRef.current!;
    const player = new Player(canvas);
    player.onTime = (t) => useStore.getState().setPlayhead(t);
    player.onPlayState = (p) => useStore.getState().setPlaying(p);
    playerRef.current = player;
    playerHost.current = player;
    return () => {
      player.dispose();
      playerHost.current = null;
      playerRef.current = null;
    };
  }, []);

  // Keep the preview canvas sized to the sequence aspect ratio and the panel.
  useEffect(() => {
    const frame = frameRef.current!;
    const canvas = canvasRef.current!;
    const resize = () => {
      const rect = frame.getBoundingClientRect();
      const scale = Math.min(rect.width / width, rect.height / height);
      const w = Math.max(1, Math.floor(width * scale));
      const h = Math.max(1, Math.floor(height * scale));
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      // render at most 1x the sequence size, at least the CSS size (DPR aware)
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.min(width, Math.round(w * dpr));
      canvas.height = Math.min(height, Math.round(h * dpr));
      playerRef.current?.redraw();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(frame);
    return () => ro.disconnect();
  }, [width, height]);

  useEffect(() => {
    playerRef.current?.setProject(project);
  }, [project]);

  useEffect(() => {
    const p = playerRef.current;
    if (p && !p.playing && Math.abs(p.time - playhead) > 1e-6) p.seek(playhead);
  }, [playhead]);

  const player = () => playerRef.current;
  const frame = 1 / fps;
  const seek = (t: number) => {
    player()?.pause();
    const clamped = Math.max(0, Math.min(t, duration));
    player()?.seek(clamped);
    setPlayhead(clamped);
  };

  return (
    <section className="panel monitor">
      <div className="panel__head">
        <span className="panel__title">Program</span>
        <span className="muted">
          {width}×{height} · {fps} fps
        </span>
      </div>
      <div className="monitor__frame" ref={frameRef}>
        <canvas ref={canvasRef} className="monitor__canvas" />
        {duration === 0 && <div className="monitor__hint">Drag media onto the timeline, or double-click a clip in the Media panel.</div>}
      </div>
      <div className="monitor__transport">
        <div className="tc tc--big">{formatTimecode(playhead, fps, dropFrame)}</div>
        <div className="monitor__buttons">
          <button className="icon-btn" title="Go to start (Home)" onClick={() => seek(0)}>
            <I.SkipStart />
          </button>
          <button className="icon-btn" title="Step back (←)" onClick={() => seek(playhead - frame)}>
            <I.StepBack />
          </button>
          <button
            className="icon-btn icon-btn--primary"
            title="Play / pause (Space)"
            onClick={() => {
              player()?.toggle();
              setPlaying(!!player()?.playing);
            }}
          >
            {playing ? <I.Pause size={22} /> : <I.Play size={22} />}
          </button>
          <button className="icon-btn" title="Step forward (→)" onClick={() => seek(playhead + frame)}>
            <I.StepForward />
          </button>
          <button className="icon-btn" title="Go to end (End)" onClick={() => seek(duration)}>
            <I.SkipEnd />
          </button>
          <span className="monitor__sep" />
          <button className={`icon-btn ${inPoint !== null ? 'is-on' : ''}`} title="Mark in (I)" onClick={() => useStore.getState().setInPoint(playhead)}>
            <I.In />
          </button>
          <button className={`icon-btn ${outPoint !== null ? 'is-on' : ''}`} title="Mark out (O)" onClick={() => useStore.getState().setOutPoint(playhead)}>
            <I.Out />
          </button>
        </div>
        <div className="tc muted">{formatTimecode(duration, fps, dropFrame)}</div>
      </div>
    </section>
  );
}
