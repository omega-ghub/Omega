# ADR-0002: Open `.omega` project format

- **Status:** Proposed
- **Date:** 2026-10-02
- **Deciders:** Founder, engineering leads (TBD)

## Context
Proprietary formats are Adobe's strongest lock-in, and also the thing creators resent most.
One of our public promises (VISION.md #4) is an open format.

## Decision (proposed)
- `.omega` is a zip container (stored, not compressed, for large media) holding:
  - `manifest.json`: format version, app version, and the feature flags required to open it
  - `graph.cbor`: the document node graph (JSON is accepted on read, for debugging and diffing)
  - `blobs/<sha256>`: content-addressed binary payloads (image tiles, meshes, audio, thumbnails)
  - `history/`: optional persisted undo log
- External media is referenced by relative path plus content hash, so moving a project
  folder never breaks it.
- The spec lives in a public repository. `omega-format` is published under MIT/Apache-2.0.
- Compatibility rule: a newer Omega always opens older files. An older Omega opens a newer
  file read-only, with a clear message naming the features it doesn't support.

## Consequences
- Format changes need a spec PR and a migration test.
- Competitors can read our files. That is intentional, because trust is the product.
