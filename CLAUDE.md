# Guidance for AI coding agents working on Omega

Read `docs/VISION.md` and `docs/ARCHITECTURE.md` before making changes.

- **One engine, many workspaces.** Never duplicate a capability inside a workspace if it
  belongs in a shared crate (color, undo, effects, text, assets, scripting).
- **Respect the promises in VISION.md.** Never add telemetry that is on by default, a
  mandatory sign-in, a background service, or anything that sends user content off the
  machine without explicit opt-in.
- **Big technical choices go in an ADR** (`docs/adr/`, copy `0000-template.md`) before code.
- **Every file parser gets a fuzz target.** Untrusted input is the norm in this product.
- **Performance budgets** in ARCHITECTURE.md are requirements. Add or update a benchmark
  when touching a hot path.
- **Licensing:** no GPL/AGPL dependencies. See ADR-0003.
- The real-time audio thread must never allocate, lock or perform I/O.
