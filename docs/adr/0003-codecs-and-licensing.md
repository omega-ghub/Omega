# ADR-0003: Codecs and third-party licensing

- **Status:** Proposed
- **Date:** 2026-10-02
- **Deciders:** Founder, engineering leads, legal counsel (required)

## Context
Video codecs carry patent royalties (H.264/AVC and especially H.265/HEVC, through several
patent pools). A free tier with unlimited installs could create large royalty exposure if
we ship our own encoders. Some open-source libraries are GPL, which is incompatible with
a closed-source commercial product.

## Decision (proposed)
1. **Use OS and GPU hardware codecs first** (VideoToolbox, Media Foundation, NVENC/NVDEC,
   AMF, Quick Sync, VA-API). The OS or hardware vendor typically holds the codec license.
2. **FFmpeg is built LGPL-only and dynamically linked**, with no GPL or non-free components.
3. **Promote royalty-free formats:** AV1, VP9, Opus, FLAC, and ProRes decode where licensed.
4. **Run automated license scanning in CI** (e.g. `cargo-deny`) with an allow-list: MIT,
   Apache-2.0, BSD, Zlib, MPL-2.0 and LGPL (dynamic only). GPL/AGPL fails the build.
5. **Get legal review before shipping any codec**, especially HEVC encode on Linux.

## Consequences
- Some Linux configurations may lack HEVC encode out of the box. Document this, and offer
  AV1 as the default there.
- Licensing is a release gate, not an afterthought.
