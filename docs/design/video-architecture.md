# Delta (Omega's video app): overhaul architecture and build contract

This is the contract for the parallel build of the new Delta. Every builder reads
this file first. The code lives in `apps/omega` (Electron 44, React 19, TypeScript,
Vite, zustand + immer, Mediabunny/WebCodecs).

## The bar

- **Pristine, minimal and professional.** Calm dark UI, hairline borders, generous
  but dense spacing, one accent color (Delta purple `--accent`), monoline icons and
  tabular-number timecode. No gradients on chrome, no emoji, no clutter. Think Linear,
  Final Cut and Resolve, not a toy.
- **More capable than Premiere.** Every feature in a package brief below must
  really work. **No placeholders, fake buttons or "coming soon" in shipped UI.** If
  something can't work in our stack, leave it out and say so in your report.
- **Cinema-grade.**
  - DCI 4K (4096×2160) at 23.976, UHD 59.94 and vertical 9:16 timelines must play,
    scrub and export.
  - Scene-linear compositing with log input transforms (S-Log3, LogC3, V-Log,
    C-Log3, F-Log), .cube LUTs, frame-accurate editing, drop-frame timecode,
    sample-accurate audio and loudness compliance.
- **Robust.**
  - Never crash on bad media.
  - Never lose work: autosave every 4 s plus backups, already in core.
  - Every action is undoable with a human label.

## Stack facts and constraints

- Runs in Chromium (Electron). GPU means **WebGL2**, with float textures through
  `EXT_color_buffer_float` and a fallback to RGBA16F or RGBA8 when it's missing.
  WebGPU is out of scope.
- Decode and encode use **WebCodecs through Mediabunny** (`node_modules/mediabunny/dist/mediabunny.d.ts`
  is the source of truth for its API). Export can't produce ProRes or 10-bit from a
  canvas, so don't promise either.
- Tests run under **Xvfb with SwiftShader software GL**: no real GPU, slow but correct.
  `electron/main.ts` already enables the SwiftShader fallback.
- Media is served as `omega-media://local/<encoded absolute path>` (range requests,
  CORS `*`). Use `window.omega.media.urlFor(path)`. `<video>`, `<img>` and `<audio>`
  need `crossOrigin = 'anonymous'`.
- The `window.omega` API is described in `electron/api.ts`: dialogs (`pickMedia`,
  `pickFiles`, `pickSavePath`, `pickExportPath`), `files.writeBinary/readText/writeText/pathForFile/showInFolder`,
  and project save/load/backup.

## Core (already written, owned by core): do not rewrite

| File | What it is |
|---|---|
| `src/state/types.ts` | **Document model v2.** Read it fully. |
| `src/state/defaults.ts` | Factories (`makeClip`, `makeTrack`, `makeSequence`, `defaultGrade`, `makeMask`, `makeTransition`, `makeMarker`, `makeAsset`, `LABEL_COLORS`) |
| `src/state/migrate.ts` | v1 → v2 migration |
| `src/state/store.ts` | `useEditor` zustand store: `mutate(label, recipe, {coalesceKey})`, `mutateSequence`, undo/redo/history, selection, tool, workspace, viewer prefs, modal, toast, clipboard. Also `useSequence()`, `getSequence()`, `useSelectedClips()` |
| `src/state/hubStore.ts` | Hub (dashboard) store. Not part of Delta. |
| `src/engine/time.ts` | frames/timecode (drop-frame), `parseTimecode`, `snapToFrame`, `sourceTimeAt` (speed, reverse, ramps, freeze) |
| `src/engine/keyframes.ts` | Param paths, `paramAt`, `setParam`, `setKeyframe`, `evaluate`, bezier easing |
| `src/engine/render/graph.ts` | `buildFrameGraph(project, seqId, t, opts)`: the resolved description of one frame (layers, transitions, captions). Preview and export both render this. |
| `src/engine/render/frames.ts` | `FrameProvider`: how the renderer gets decoded pictures |
| `src/engine/effects/types.ts` | **GLSL effect and transition contract** (uniform naming, color space, prelude) |
| `src/engine/effects/registry.ts` | `getEffect`, `listEffects`, `instantiateEffect`, `getTransition`, `listTransitions` |
| `src/engine/playback/transport.ts` | `transport.play/pause/seek/shuttle/step`: the only way to control playback |
| `src/engine/playback/viewerBus.ts` | program renderer handle and a frame-rendered event (scopes) |
| `src/workspaces/video/actions.ts` | **Action registry.** Every command is an action with id, label, group and Premiere-compatible `keys`. Shell builds shortcuts, the command palette and menus from it. |
| `src/modules/video/ModuleApp.tsx` | Entry: init, open project, autosave, render `<VideoWorkspace/>` |

**Rule for core files:** if you truly need a contract change, make the smallest
*additive* edit (a new optional field or a new export; never rename or remove), and
list it under "Core changes" in your final report. Re-read the file right before
editing, because another builder may have touched it.

All edits go through `useEditor.getState().mutate('Human label', draft => …)`, or
`mutateSequence`. For continuous controls (sliders, drags) pass
`{ coalesceKey: '<stable key>' }` so one drag is one undo step. Times are seconds;
snap to frames with `snapToFrame(t, seq.fps)`. The sequence (`seq.fps`, `seq.width`,
…) is the source of truth for format; `project.settings` only holds defaults.

## Design tokens (CSS custom properties)

Use only these. The shell package owns `src/styles.css` and keeps these names
stable.

```
--bg  --surface  --surface-2  --surface-3  --surface-4      (dark → lighter layers)
--border  --border-strong                                     (hairlines)
--text  --text-2  --text-3                                    (primary / secondary / tertiary)
--accent  --accent-deep  --accent-soft                        (Delta purple; set at runtime)
--ok  --warn  --danger
--radius (10px)  --radius-sm (6px)
--font (Inter Variable)  --mono (JetBrains Mono Variable)
```

- Base size 12–13px.
- Panel headers are 11px uppercase with 0.06em tracking, in `--text-3`.
- Numbers and timecode use `font-variant-numeric: tabular-nums` and `--mono`.

**CSS:** each package keeps its styles in its own file (`<dir>/<name>.css`, imported
from its components). Class names carry the package prefix shown below, so nothing
collides.

**Icons:** `import { I, IconBase } from 'src/ui/Icons'`. These are monoline icons
on a 24-unit grid, stroke `currentColor`. When you need a new icon, add it to
`<your dir>/icons.tsx` using `IconBase`, in the same style (1.6–1.8 stroke, round
joins, no fills except tiny dots). The shell package will polish the shared set.

**Test hooks:** put `data-testid` on every primary control (e.g.
`data-testid="tl-clip"`, `"fx-add-gaussianBlur"`, `"dl-start-export"`). List them in
your report.

## Packages

Ownership is **disjoint**. Only edit files you own, plus additive core changes as
described above. Each package also owns `<dir>/index.ts`, which exports its panels
and **registers its actions as a side effect**. The shell imports every package
index.

| # | Package | Owns | Prefix |
|---|---|---|---|
| 1 | render | `src/engine/gpu/**`, `src/engine/color/**` | — |
| 2 | effects | `src/engine/effects/library/**`, `src/workspaces/video/effects/**` | `fx-` |
| 3 | edit | `src/engine/edit/**` | — |
| 4 | timeline | `src/workspaces/video/timeline/**` | `tl-` |
| 5 | viewer | `src/engine/playback/**` (except transport.ts / viewerBus.ts contracts), `src/workspaces/video/viewer/**` | `vw-` |
| 6 | audio | `src/engine/audio/**`, `src/workspaces/video/audio/**` | `au-` |
| 7 | color | `src/engine/scopes/**`, `src/workspaces/video/color/**` | `cl-` |
| 8 | media | `src/engine/media/**`, `src/workspaces/video/media/**` | `md-` |
| 9 | inspector | `src/workspaces/video/inspector/**`, `src/engine/render/text.ts` | `ins-` |
| 10 | captions | `src/engine/captions/**`, `src/engine/interchange/**`, `src/workspaces/video/captions/**` | `cap-` |
| 11 | deliver | `src/engine/export/**`, `src/workspaces/video/deliver/**` | `dl-` |
| 12 | shell | `src/workspaces/video/shell/**`, `src/ui/**`, `src/styles.css`, `src/dashboard/**`, `src/App.tsx`, `src/main.tsx` | `sh-` |

The stub files in each directory define the export names other packages already
import. **Keep those exports and their props**, and replace the bodies.

### Conventions every package follows

- **Modals.** A package that owns dialogs exports `function Modals()` from its
  `index.ts`. The shell mounts every package's `Modals` at all times. Each
  `Modals` renders its dialog only when `useEditor().modal?.id` is one of its
  ids, which are prefixed by package, e.g. `timeline.speed`, `deliver.export`,
  `timeline.sequenceSettings`. Open a dialog with
  `useEditor.getState().openModal('timeline.speed', {clipId})`.
- **Import entry point.** The media package exports `importPaths(paths: string[])`
  from its index. The shell calls it for files dropped anywhere on the window, and
  the media panel calls it for its own Import button.
- **Shared controls.** The inspector package exports the shared control kit from
  `src/workspaces/video/inspector/controls.tsx` and writes it **first**:
  `ScrubNumber`, `Slider`, `ColorField`, `Select`, `Toggle`, `Section`,
  `KeyframeButton`, `PointField`. Effects, color and audio may import it. Until it
  exists, build simple local controls and switch later if time allows.
- **Action ownership** (avoids duplicate key bindings):
  - **viewer:** playback, J/K/L, frame stepping, I/O mark in/out/clear (acting on
    whichever monitor has focus), loop, fullscreen, export frame.
  - **timeline:** tools, editing, markers, nudging, clipboard, transitions, speed,
    nest, zoom, snapping, tracks.
  - **media:** import and bins.
  - **color, audio, captions, deliver:** commands in their own domain.
  - **shell:** palette, workspaces (Alt+1…6), save (Mod+S), undo/redo
    (Mod+Z / Mod+Shift+Z), preferences, shortcuts editor.

### Cross-package APIs (who provides, who consumes)

| API | Provider | Consumers |
|---|---|---|
| `Renderer` (`engine/gpu/Renderer.ts`): `render(graph, frames, opts)`, `setSize`, `readPixels`, `dispose` | render | viewer, deliver, color (via viewerBus) |
| `parseCube`, `loadLut`, `getLoadedLut` (`engine/color/lut.ts`) | render | color (LUT import UI), renderer |
| `EFFECTS`, `TRANSITIONS` (GLSL library) | effects | renderer (compiles), timeline/inspector (UI) |
| `EffectStack({clipId})`, `EffectsBrowser` | effects | inspector, shell |
| edit ops (`engine/edit/ops.ts`) | edit | timeline, viewer, media, shell, captions |
| `AudioEngine`, `getPeaks/requestPeaks/onPeaks`, `renderMix`, `analyzeLoudness` (`engine/audio/engine.ts`) | audio | viewer (clock), timeline (waveforms), deliver (mixdown), audio UI |
| `AudioClipSection({clipId})`, `Mixer`, `LoudnessPanel` | audio | inspector, shell |
| `FrameReader`, `decodeFrameAt` (`engine/media/decode.ts`) | media | viewer (paused exact frames), deliver (export), color (stills) |
| `getThumbnail/requestThumbnails/onThumbnails` (`engine/media/thumbnails.ts`) | media | timeline filmstrips, media browser |
| `probeMedia` (`engine/media/probe.ts`) | media | store / media UI |
| `rasterizeText/Shape/Solid/Gradient/Captions` (`engine/render/text.ts`) | inspector | renderer |
| `parseCaptions`, `writeSrt`, `writeVtt` (`engine/captions/format.ts`) | captions | media (import .srt/.vtt), deliver (sidecars) |
| `exportEdl/Otio/Fcpxml/Chapters` (`engine/interchange`) | captions | deliver |
| `transport` | viewer installs the implementation | everyone |
| `ProgramMonitor`, `SourceMonitor` | viewer | shell |
| `Timeline` | timeline | shell |
| `Inspector` | inspector | shell |
| `ColorPanel`, `Scopes` | color | shell |
| `MediaPanel` | media | shell |
| `CaptionsPanel` | captions | shell |
| `DeliverPanel` | deliver | shell |

While a provider is unfinished, its stub returns null, empty or no-op values.
Consumers must handle that gracefully. Nothing should crash when a dependency is
still a stub.

## Workspaces (laid out by the shell)

| Workspace | Layout |
|---|---|
| Edit | Media \| Source \| Program \| Inspector, with the Timeline below |
| Color | Scopes \| Program \| Color tools, with a compact Timeline below |
| Audio | Mixer \| Program \| Loudness and clip audio, with the Timeline below |
| Effects | Effects browser \| Program \| Inspector, with the Timeline below |
| Captions | Captions panel \| Program \| Inspector, with the Timeline below |
| Deliver | Deliver (render queue) \| Program, with a compact Timeline below |

## Verification every builder must do

1. `cd apps/omega && npx tsc --noEmit -p tsconfig.json`. Your files must be free of
   type errors. Errors in other packages' in-progress files are not yours; filter by
   path.
2. `npm run test:unit`. Add `*.test.ts` next to pure logic (edit ops, timecode,
   loudness, LUT parsing, caption parsing, interchange writers, scope math). Tests run
   in Node (no DOM).
3. `npm run build:modules`. The Delta package must still build.
4. Where possible, try your UI for real. Run
   `node scripts/make-test-media.mjs <dir>` (with `CINEMA=1` for 4K, HFR, LUT and SRT
   files), then drive the built app with Playwright under `xvfb-run` the way
   `scripts/smoke.mjs` does. Integration testing of the whole app happens after all
   packages land.

## Final report (your last message)

- What you built: features, with how each works.
- Files created or changed.
- Core changes, if any.
- `data-testid` list.
- Known limitations: anything unimplemented and why.

Do **not** commit or push. The integrator commits.
