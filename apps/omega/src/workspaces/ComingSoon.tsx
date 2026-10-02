import { AppMark } from '../brand/Logos';
import { THEMES, type AppKind } from '../brand/themes';
import { useStore } from '../state/store';
import { I } from '../ui/Icons';

const PLANS: Record<string, string[]> = {
  audio: ['Multitrack editing with a real-time, lock-free engine', 'VST3, AU and CLAP plugin hosting', 'Spectral repair, voice isolation and loudness to EBU R128', 'Podcast tools: transcript editing, chapters, auto-leveling'],
  image: ['Tiled, GPU-accelerated raster engine with non-destructive layers', 'Vector paths, booleans and typography in the same document', 'High-fidelity PSD import/export and RAW development', 'Any image is a timeline clip: edit thumbnails in place from Video'],
  three: ['Polygon modeling, UVs and PBR materials on OpenUSD', 'Sculpting with multiresolution and texture painting', 'Real-time viewport and a GPU path tracer for finals', 'Scenes drop onto a video timeline as live clips'],
  motion: ['Layer and node compositing in one view', 'Shape layers, masks, rotoscoping and tracking', 'Keyframes shared with the video timeline', 'Templates that drive titles across the suite'],
};

export function ComingSoon({ app }: { app: AppKind }) {
  const t = THEMES[app];
  const project = useStore((s) => s.project);
  const closeProject = useStore((s) => s.closeProject);
  return (
    <div className="soon">
      <AppMark app={app} size={112} />
      <h1 className="soon__title">{t.name}</h1>
      <div className="pill pill--accent">{t.phase}</div>
      <p className="soon__tag">{t.tagline}</p>
      {project && (
        <div className="soon__project">
          Project <b>{project.name}</b> is saved and will open here when the workspace ships.
        </div>
      )}
      <ul className="soon__list">
        {(PLANS[app] ?? []).map((line) => (
          <li key={line}>
            <I.Check size={14} /> {line}
          </li>
        ))}
      </ul>
      <button className="btn btn--accent" onClick={() => closeProject()}>
        Back to dashboard
      </button>
    </div>
  );
}
