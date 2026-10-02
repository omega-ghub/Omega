# ADR-0004: Small hub, separately downloadable apps

- **Status:** Accepted (implemented in apps/omega)
- **Date:** 2026-10-02
- **Deciders:** Founder

## Context
Omega is a suite of apps (Video, Audio, Image, 3D, Motion). Installing all of them
up front makes the download heavy, and most people use one or two. The suite
should just be the way to reach the apps.

## Decision
- The **hub** is the only thing installed with the suite: dashboard, project
  list, app manager, account and plan screens.
- Each **app** is a separate package, downloaded on demand from a signed-hash
  catalog (`catalog.json`), verified by SHA-256, unpacked into the user's data
  folder, and opened in its own window. Uninstalling an app never touches projects.
- Apps share one project format, so a project can span apps.
- Catalog lives next to the release assets; `OMEGA_CATALOG_URL` overrides it for
  testing and for studios hosting their own mirror.

## Consequences
- The hub still contains the Electron runtime (~90 MB), which all apps share.
  Getting the hub much smaller would require leaving Electron for a native
  webview shell (Tauri) or a native UI; revisit in Phase 0 of ROADMAP.md.
- Heavy payloads (codecs, ML models, the 3D engine) belong in app packages, never
  in the hub.
- Catalog entries must later carry a platform field and a signature so native
  per-OS packages can be offered safely.
