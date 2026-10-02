# Omega Architecture

> Status: **Proposed.** Decisions marked *ADR* are recorded in `docs/adr/` and need
> engineering-lead sign-off before implementation starts.

## The core idea

Adobe's suite is a set of separate applications that talk to each other through bridges.
Omega is the opposite: **one process and one document model**, with several *workspaces*
that are just different editors over the same data.

```
┌──────────────────────────────────────────────────────────────────────┐
│  Workspaces (UI)   Image │ Video │ Audio │ 3D │ Motion/Composite     │
├──────────────────────────────────────────────────────────────────────┤
│  Shared UI toolkit: panels, docking, inspector, timeline widget,     │
│  node editor, viewport host, command palette, keymaps                │
├──────────────────────────────────────────────────────────────────────┤
│  Application layer: commands, undo/redo, selection, tools, prefs,    │
│  scripting API (one API for everything), plugin host                 │
├──────────────────────────────────────────────────────────────────────┤
│  Document model: a typed, versioned graph of nodes + time            │
│  (layers, clips, tracks, meshes, materials, effects are all nodes)   │
├───────────────┬──────────────┬──────────────┬────────────────────────┤
│ Image engine  │ Media I/O    │ Audio engine │ 3D engine              │
│ tiles, layers,│ decode/encode│ realtime mix,│ meshes, sculpt, USD,   │
│ brushes, FX   │ proxies,cache│ DSP, plugins │ path tracer, raster    │
├───────────────┴──────────────┴──────────────┴────────────────────────┤
│  Core services: GPU abstraction (RHI), color management (OCIO),      │
│  task scheduler, memory/cache manager, asset DB, file format I/O     │
└──────────────────────────────────────────────────────────────────────┘
```

## Key subsystems

### Document model
- Everything is a **node** with typed ports, held in a single project graph. An image
  layer, a video clip, an audio region and a 3D object are all nodes. That is what lets
  a 3D scene be dropped into a video timeline and edited in place.
- **Time is first-class.** Any property can be animated, so a still image is simply a
  document with a duration of zero.
- **Undo is a log of immutable deltas**, not snapshots. This gives cheap undo, a
  persistent history, and a path to real-time collaboration (CRDT-friendly) later.
- **Evaluation is lazy and cached.** The engine only computes the region, frame and
  resolution being viewed.

### Rendering / GPU (ADR-0001)
- A thin **RHI** (render hardware interface) over Vulkan, Metal and Direct3D 12. Every
  engine (image FX, video compositing, 3D) renders through it.
- Image and video effects are written once as GPU shaders and run identically in every
  workspace.
- 3D gets a real-time rasterizer for viewports and a GPU path tracer for final renders.

### Color
- **OpenColorIO** end to end. Scene-linear working space by default, ACES available,
  and color handled the same way in every workspace. This is a common Adobe pain point,
  and we can fix it because there is only one pipeline.

### Media I/O (ADR-0003)
- Decoding and encoding go through **platform hardware codecs** (VideoToolbox, Media
  Foundation/NVENC/AMF/QSV, VA-API) where available, with **FFmpeg (LGPL, dynamically
  linked)** as the fallback.
- A proxy and cache manager generates and invalidates proxies automatically.
- Image formats: OpenImageIO (EXR, TIFF, PNG, JPEG, WebP, AVIF, RAW via LibRaw), plus
  PSD import/export.

### Audio
- A dedicated **real-time audio thread** that never allocates or locks, sample-accurately
  synced to the video timeline.
- Hosts **VST3, AU and CLAP** plugins. Built-in DSP covers EQ, dynamics, reverb, noise
  reduction, loudness normalization (EBU R128) and voice isolation.

### 3D
- **OpenUSD** as the interchange and scene-description format. Import and export glTF,
  FBX and OBJ.
- Polygon modeling, then sculpting with multires, then PBR texture painting (the Substance
  space).

### Scripting and plugins
- **One scripting language for the whole suite.** Proposed: TypeScript/JavaScript on an
  embedded engine, plus Python bindings for pipeline users. Both are generated from a
  single API definition so they can't drift apart.
- **Native plugin SDK** with a stable C ABI, versioned, so plugins built for 1.x keep
  working across all 1.x releases. Third-party plugins run sandboxed where possible.

### File format (ADR-0002)
- `.omega` is a **zip container** holding a JSON/CBOR document graph and the
  content-addressed binary payloads it references (tiles, meshes, audio).
- The spec is versioned and published, and an open-source reader/writer library is
  released under a permissive license.
- Saves are incremental and crash-safe (write to a new file, then atomically rename),
  and autosave is on by default.

## Language and toolkit (ADR-0001)

**Proposed:** a **Rust** core and engines, plus C/C++ interop for proven industry
libraries (OCIO, OIIO, OpenEXR, OpenUSD, FFmpeg, OpenSubdiv). See ADR-0001 for the
trade-offs against C++.

**UI:** a custom GPU-rendered UI toolkit drawn through the same RHI, the approach used
by Blender, Figma and modern editors such as Zed. This gives identical behavior on all
three operating systems, and viewports, timelines and node editors (most of the screen)
need custom rendering anyway. It is the single highest-risk choice in the plan and
must be prototyped in Phase 0 against a fallback (Qt).

## Performance budgets (enforced in CI)

| Metric | Budget |
| --- | --- |
| Cold start to usable window | < 2 s on reference hardware |
| Open a 1 GB project | < 3 s to first interactive frame |
| Brush stroke latency | < 1 frame at 120 Hz |
| 4K H.264/HEVC timeline playback | Real time, no proxies, on a mid-range GPU |
| Audio round-trip latency | < 10 ms at 128-sample buffer |
| Idle CPU (app in background) | < 1 % |

## Repository layout (target)

```
crates/
  omega-core/        # scheduler, memory, logging, math
  omega-rhi/         # GPU abstraction
  omega-color/       # OCIO integration
  omega-doc/         # document graph, undo, serialization
  omega-format/      # .omega reader/writer (published separately)
  omega-media/       # decode/encode, proxies
  omega-image/       # raster engine, brushes, layer FX
  omega-audio/       # realtime engine, plugin hosting
  omega-3d/          # meshes, sculpt, USD, renderers
  omega-ui/          # UI toolkit
  omega-script/      # scripting runtime + generated bindings
  omega-plugin-sdk/  # stable C ABI
apps/
  omega/             # the desktop application
tools/               # build, packaging, benchmarking
docs/
```
