# Omega

**One creative suite. One engine. One project file.**

Omega is an all-in-one creative suite for 3D modeling, audio, image and video editing.
It is built for independent creators and small studios. It is priced fairly, its file
format is open, and it does not lock anyone in.

> Status: **pre-alpha / planning.** Nothing here is usable yet. This repository is
> where we write down the plan we will build against.

## Start here

| Document | What it answers |
| --- | --- |
| [docs/VISION.md](docs/VISION.md) | Why Omega exists, who it's for, and the promises we make to creators |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | How one shared engine powers every workspace |
| [docs/ROADMAP.md](docs/ROADMAP.md) | The five-year plan, phase by phase, with exit criteria |
| [docs/adr/](docs/adr/) | Architecture Decision Records: the big technical choices and why we made them |

## The one-sentence pitch

Adobe sells a bundle of separate apps that were bought and stitched together over time.
Omega is **one application** with workspaces for image, video, audio and 3D. They share
a single document model, render engine, color pipeline, asset library and scripting API,
so there is nothing to round-trip and nothing to export between apps.

## Run it (desktop app)

The app lives in [`apps/omega`](apps/omega). It is an Electron + React + TypeScript
desktop application (Windows, macOS, Linux).

```bash
cd apps/omega
npm install
npm run dev          # development with hot reload
npm start            # production build, then launch
npm run dist:win     # installer (also dist:mac, dist:linux)
npm run smoke        # end-to-end UI test (see scripts/smoke.mjs)
```

What works today (preview): the Creator-Cloud-style dashboard, the new-project flow
(destination → preset → name/location, advanced settings tucked away), and the
**Omega Video** workspace: import media, multi-track timeline (move, trim, split,
snap, lock/mute, linked A/V), real-time preview, Premiere-compatible shortcuts, undo/redo,
autosave, and export to MP4/WebM with platform presets. Audio, Image, 3D and Motion
show roadmap previews.

Research behind the product decisions is in [`docs/research/`](docs/research/).
