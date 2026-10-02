# ADR-0001: Core language and UI toolkit

- **Status:** Proposed
- **Date:** 2026-10-02
- **Deciders:** Founder, engineering leads (TBD)

## Context
Omega's core will run for decades and handle untrusted files (images, video, 3D assets,
plugins). Most crashes and security bugs in creative software come from memory-safety
errors in file parsers and engines. The industry's key libraries (OCIO, OIIO, OpenEXR,
OpenUSD, FFmpeg) are written in C and C++.

## Options considered
1. **C++20 + Qt.** This is the industry default (DaVinci Resolve, Maya, Houdini). It has
   the largest hiring pool in media and graphics and direct use of every library. On the
   downside, memory-safety bugs are the dominant crash and CVE source, and the build
   systems and package management are painful.
2. **Rust core + C/C++ interop + custom GPU UI.** Memory safety by default, fearless
   multithreading, excellent tooling (cargo), and AI coding tools are very effective
   with it. On the downside, the hiring pool for media and graphics is smaller, binding
   OpenUSD (heavy C++) is work, and the Rust UI ecosystem is immature.
3. **Hybrid: Rust core and engines, Qt UI via a C ABI.** Safe engines with a mature UI.
   The cost is two languages and two build systems at the UI boundary.

## Decision (proposed)
**Option 2**, with Option 3 as the documented fallback for the UI layer:
- Engines, document model, file I/O and the plugin host are written in Rust.
- Existing C/C++ libraries are wrapped behind narrow, fuzz-tested FFI boundaries.
- The UI toolkit is custom and GPU-rendered. In Phase 0 a 6-week prototype must show
  docking panels, text input with IME, accessibility hooks and 120 Hz canvas interaction.
  If it fails, fall back to Qt (Option 3).

## Consequences
- Every file parser gets a fuzz target in CI.
- Hire senior C++ people anyway for the interop layer and the USD/OCIO integration.
- Recruiting can promote Rust as a draw: many strong engineers want to work in it.
