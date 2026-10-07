# Omega — handoff for the next AI model

Branch: `claude/awesome-keller-lt9wjq` (repo `omega-ghub/Omega`). Latest commit at handoff: `acac329`. App version 0.2.0.
Read first: `CLAUDE.md`, `docs/VISION.md`, `docs/ARCHITECTURE.md`, `docs/design/video-architecture.md` (binding build contract), `docs/adr/0004-hub-and-downloadable-apps.md`.

## Product
Omega is an all-in-one creative suite, the cheaper creator-friendly alternative to Adobe.
Pricing (locked by the founder): $149.99 one-time, $9.99/mo Creator, $19.99/seat/mo Studio, plus a free tier.
Promises in VISION.md: no default telemetry, no mandatory sign-in, no background service, nothing leaves the machine without opt-in. No GPL/AGPL dependencies.

- **Hub ("Omega")**: small Creative-Cloud-style dashboard. Apps are separate downloads, installed on demand from a catalog. The hub must never bundle them.
- **Delta** (video, id `video`) is the first and only available app.
- Brand: Ω cutout (red, transparent) for the dashboard; corner window logo is a red square with a white Ω (`OmegaTile`); each app icon is a flat square tile in the app's colour with a white Greek rune on the Ω's 250–750 grid (main stroke ~150, thin ~94).

| App | id | Colour | Role |
|---|---|---|---|
| Delta | video | #884CFD | video editing (UI is neutral grey, icon stays purple) |
| Lambda | image | #5045E8 | photo and image editing |
| Gamma | photo | #00A4E0 | photo library, RAW, batch |
| Kappa | vector | #F7B103 | vector / logo design |
| Psi | audio | #00B1AC | audio |
| Tau | motion | #1ABA59 | motion graphics |
| Theta | three | #FF6A03 | 3D modeling and rendering |
| Phi | web | #2E6AFE | web / UI design |
| Sigma | publish | #F03290 | layout / publishing |

Source of truth: `apps/omega/src/brand/themes.ts`, runes in `src/brand/Logos.tsx`. Reference: `docs/brand/app-icons.png`.
The founder asked for: Delta with huge versatility ("close to infinite possibilities"), cinema-grade, minimal and professional.

## Stack
Electron 44, React 19, TypeScript, Vite 8, zustand+immer. Mediabunny (WebCodecs) for decode/encode, WebGL2 compositor (scene-linear Rec.709, RGBA16F), Web Audio + AudioWorklet limiter, BS.1770 loudness, OTIO/EDL/FCPXML/SRT/VTT/TTML.
Everything is under `apps/omega/`.

## Layout
- `electron/` — `main.ts` (windows, protocols `omega-module://` and `omega-media://`, IPC), `preload.ts`, `api.ts`, `modules.ts` (catalog, download, sha256, zip install into userData/modules/<id>/<version>).
- `src/brand/`, `src/dashboard/`, `src/ui/`, `src/modules/` — hub UI and shared design system.
- `src/state/` — document model v2 (`types.ts`), `store.ts` (Delta store `useEditor`), `hubStore.ts`, `migrate.ts` (v1→v2), `presets.ts`, `defaults.ts`.
- `src/engine/` — shared engine: `time`, `keyframes`, `render` (frame graph), `gpu` (renderer), `effects` (59 effects + 16 transitions, GLSL contract in `effects/types.ts`), `color`, `edit`, `audio`, `media`, `playback`, `scopes`, `export`, `captions`, `interchange`.
- `src/workspaces/video/` — Delta UI: `shell` (App, styles.css, layout), `timeline`, `viewer`, `media`, `inspector`, `effects`, `color`, `audio`, `captions`, `deliver`, plus `actions.ts` (Premiere-compatible keys) and `shortcuts.ts`.
- `scripts/` — `test-unit.mjs`, `test-gpu.mjs`, `test-effects.mjs`, `smoke.mjs` (end-to-end), `make-test-media.mjs`, `package-modules.mjs`, `build-electron.mjs`, `screenshots.mjs`, `dev.mjs`.
- `.github/workflows/build.yml` — typecheck + unit gate, then installers (win/mac/linux, `--publish never`) and the modules job (Delta zip + catalog); attaches to a release on `v*` tags.
- `docs/` — vision, architecture, roadmap, 4 ADRs, research (`research/*.md`), design contract, screenshots.

## Commands (from `apps/omega`)
```
npm ci
npm run typecheck
npm run test:unit        # 426 tests
npm run test:gpu         # 31 pixel tests (SwiftShader)
npm run test:effects     # compiles 258 shader programs
npm run build && npm run build:modules
npm run dist:linux|win|mac
# end to end:
CINEMA=1 node scripts/make-test-media.mjs <mediaDir>
xvfb-run -a node scripts/smoke.mjs <mediaDir> <outDir>
```
The smoke test passes as of the last run (install from catalog, DCI 4K project, import, edit, effects, color, audio, captions, export verified as a 16.02 s H.264 MP4).

## State at handoff
Done: hub with downloadable apps, final rune icon set, Delta integrated from 12 packages, green CI on all 3 OSes, passing smoke test. Installers are CI artifacts of run 37559023758.

Open items:
1. **No release exists.** Pushing tag `v0.2.0` from the cloud session failed (remote hung up). The hub's default catalog URL (`https://github.com/omega-ghub/Omega/releases/latest/download/catalog.json`) only resolves after a tagged release. Create a release tagged `v0.2.0` in GitHub's UI (triggers the workflow) or retry the tag push. A local tag `v0.2.0` may exist only in the old container.
2. Adversarial review pass and fix loop (bugs, fake features, UX polish).
3. "Beyond Premiere" wave: multicam, stabilization, point/planar tracking, track mattes, scene-cut detection, on-device speech-to-text and text-based editing, auto-reframe, hue-vs-hue curves, power windows/node grading, optical-flow retime, spectral noise reduction, smart bins / image sequences / relink by hash.
4. Duplicate key bindings (ArrowUp/Down prev/next edit in viewer vs timeline; Alt+Shift+Arrow in captions vs timeline).
5. Not verified in the running app: effects UI, masks, crop, keyframe copy-paste, ducking. Verify camera-gamut matrices (written from memory). Learn-page `shortcuts.ts` is a static copy. Confirm the shell mounts each package's `Modals`.
6. Known limits: HDR is tone-mapped SDR; no ProRes or 10-bit export; AAC/HEVC encode unavailable in Linux Chromium (falls back to Opus/H.264); FCPXML not tested in Final Cut; software GL is slow, real GPUs faster.
7. Other apps (Lambda, Gamma, etc.) are placeholders in the catalog and hub.

## Gotchas
- `tl-clip` test ids are a hidden list; in tests use `window.__deltaTimeline.clipRects()` or the status bar clip count.
- Vite must keep `assetsInlineLimit: 0` (CSP forbids `data:` URIs).
- `omega-media://` needs CORS headers and `crossOrigin` on media elements.
- WebCodecs needs a real page (file://), not about:blank.
- Parallel test runs share a cache; `test-unit.mjs` uses a per-pid dir.
- Audio thread must never allocate, lock, or do I/O. Every file parser needs a fuzz target. Big technical choices need an ADR first.
- Commit via small checkpoints; push with `git push -u origin claude/awesome-keller-lt9wjq`.
