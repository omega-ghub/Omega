# Omega Roadmap (5 years)

> Status: **Proposed.** Dates are relative to the start of engineering (Month 0).

## Sequencing strategy

Building four professional applications in parallel is how ambitious suites fail. Omega
builds **one shared core first**, then ships workspaces one at a time, and each new
workspace makes the previous ones more valuable.

**Proposed launch wedge: Video + Audio + Motion.** Here is the reasoning:
- It is where Adobe's fragmentation hurts most. Premiere, After Effects and Audition with
  Dynamic Link is the most-complained-about workflow in the suite.
- It is what the target creators (YouTubers, streamers, podcasters) use every day.
- It exercises every core system (GPU, color, media I/O, audio, document graph, undo),
  so the core gets proven under real load.
- The main competitor, DaVinci Resolve, is powerful but intimidating for beginners. A
  faster, friendlier creator-focused editor has room to win.

Image is the second workspace and 3D is the third, because 3D is the deepest and
Blender is a very strong free incumbent.

---

## Phase 0: Foundations (Months 0–6)

**Goal:** prove the architecture, then hire against it.

- Prototype the RHI on Vulkan, Metal and D3D12. Prototype the UI toolkit against the Qt
  fallback, then **decide** (ADR).
- Build the document graph with an undo log, the `.omega` format v0, and the task scheduler.
- Media decode spike: 4K HEVC real-time playback through hardware decoders on all three OSes.
- Set up CI on all three OSes, a performance-budget harness, and crash reporting (opt-in).
- Hiring: core/engine, GPU, media and UI leads in place.

**Exit criteria:** a throwaway demo app that plays 4K video, scrubs a timeline, applies a
GPU effect with undo, and saves and reloads, on all three operating systems.

## Phase 1: Video MVP (Months 6–18)

- Multi-track timeline: cut, trim, ripple, roll, slip and slide, plus J/L cuts.
- Real-time effects, transitions, titles/text engine, color correction (wheels, curves,
  LUTs) and keyframing.
- Audio tracks with levels, basic EQ/compression, loudness normalization and an
  auto-ducking mixer.
- Export presets for YouTube, TikTok, Instagram and podcast platforms, with background rendering.
- Import Premiere XML and FCPXML, plus Premiere-compatible keyboard shortcuts.
- **Private beta at Month 12 with ~500 creators.** Ship weekly builds and listen hard.

**Exit criteria:** beta creators publish real videos made start to finish in Omega.

## Phase 2: Public 1.0 — Video, Audio, Motion (Months 18–30)

- Motion/compositing workspace: node- and layer-based compositing, shape layers,
  masks/rotoscoping, tracking.
- Audio workspace: multitrack editing, spectral repair, VST3/AU/CLAP hosting, voice
  isolation, podcast tools.
- Local AI tools: transcription and text-based editing, auto-captions, silence removal,
  scene detection, background removal.
- Scripting API v1 and plugin SDK v1 (stable), plus a marketplace beta.
- **1.0 launch (~Month 24)** with Free and Creator tiers, perpetual license included.

## Phase 3: Image workspace (Months 24–40)

- Layered raster editing with a tiled, GPU-accelerated engine, brushes, adjustment
  layers, smart objects and masks.
- Vector tools (the Illustrator space): paths, boolean operations, typography.
- PSD import/export at high fidelity, plus RAW development.
- **The integration payoff:** an image document is a timeline clip and vice versa. Edit
  a thumbnail or overlay in place from the video workspace.

## Phase 4: 3D workspace (Months 36–54)

- Polygon modeling, UVs, PBR materials and the USD scene graph.
- Sculpting and texture painting (the Substance space).
- Real-time viewport plus a GPU path tracer.
- **The integration payoff:** 3D scenes as live timeline clips and image layers, with
  shared lights, cameras and materials.

## Phase 5: Studio and scale (Months 48–60)

- Studio tier: shared libraries, review and approval links, real-time co-editing (built
  on the delta-log undo model), cloud render.
- Ecosystem: marketplace general availability, education program, certified training.
- Performance and polish pass, plus accessibility audit (WCAG-aligned UI, screen-reader
  support for panels).

---

## Things we do continuously, not "later"

- Performance budgets enforced in CI from Phase 0.
- Crash-free session rate ≥ 99.5 % as a release gate.
- Public changelog and public roadmap. Users vote on priorities.
- Security and privacy review on every cloud-touching feature.
- Accessibility and localization built into the UI toolkit from the start.

## Team shape (rough, proposal)

| Phase | Engineering headcount | Focus |
| --- | --- | --- |
| 0 | 10–15 | Senior core/engine/GPU/media/UI |
| 1–2 | 40–60 | Add video, audio, motion and QA teams, plus developer relations |
| 3–4 | 80–120 | Add image and 3D teams, plus marketplace/platform |
| 5 | 120+ | Studio/cloud and support |

AI coding tools make each engineer more productive, but they don't replace senior
domain experts in color science, codecs, real-time audio and GPU rendering. Hire those
experts first.
