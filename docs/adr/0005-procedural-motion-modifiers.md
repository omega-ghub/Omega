# ADR-0005: Procedural motion — physical eases and param modifiers

- **Status:** Accepted
- **Date:** 2026-10-08
- **Deciders:** Ethan Cooper (founder), Claude (implementation)

## Context
Delta's animation is keyframes with linear/hold/ease/bezier interpolation. Creators
who come from After Effects reach for things Delta cannot express without hand-keying
hundreds of frames: overshoot and bounce, camera shake, floating, looping, and values
that follow other values. After Effects does these with expressions (`wiggle()`,
`loopOut()`, `linkTo`), which are powerful but brittle, code-based and hostile to
beginners. Constraints: the viewer, scrubbing and export must agree frame for frame;
undo must stay trivial; the project format must stay open and OTIO-persistable; no new
dependencies; everything animated already reads through `paramAt`.

## Options considered
1. **Embedded expression language (JS/sandbox).** Maximum power; but non-deterministic
   risks, security surface (untrusted project files), fragile, bad for beginners.
2. **Bake procedural motion into keyframes.** Simple; but destroys editability and bloats files.
3. **Declarative modifiers layered over keyframes, plus physical ease kinds.** Pure,
   deterministic, data-only, editable with ordinary inspector controls.

## Decision
Option 3.
- New ease kinds `back`, `elastic`, `bounce`, `spring` (per-keyframe `ezp` parameters).
- `Clip.modifiers[path]` holds an ordered list of `wiggle`, `loop` and `follow` modifiers.
  Evaluation order is fixed: loop → keyframes → follow → wiggle. Modifiers are ignored on
  `time.*` paths. Follow depth is capped at 4 and a param cannot follow itself.
- Noise is a seeded integer-hash value noise (no `Math.random`, no clock). Wiggle origin
  and rate-dependent settings shift/scale with trims, splits and speed changes.
- Persisted in the project/OTIO metadata under `modifiers`; old files simply lack it.

## Consequences
- Easier: shake, float, loop, trail and spring motion in one click; fully undoable; safe to
  load untrusted files (data only, no code execution).
- Harder: a general expression escape hatch is not provided; if needed later it needs its
  own ADR with a sandbox design.
- The importer reads `modifiers` from untrusted JSON through `sanitizeModifiers` (shape-validated,
  numbers clamped, junk dropped; covered by a unit test).
- Follow the same path of work: cloner/effectors and data-driven templates build on this.
