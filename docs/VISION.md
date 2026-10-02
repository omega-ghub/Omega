# Omega Vision

## Mission

Give every creator a professional-grade suite for image, video, audio and 3D. It should
be fast, unified, fairly priced and respectful of their work.

## Who we build for (in priority order)

1. **Independent creators.** YouTubers, streamers, podcasters, freelance designers, indie
   game artists. They produce many kinds of media, often alone, and they are price-sensitive.
2. **Small studios (2–50 seats).** They need collaboration and pipeline features but can't
   afford enterprise contracts.
3. **Students and educators.** Tomorrow's professionals, and the people who decide which
   tool a whole generation learns.

Enterprise matters later. It is not the design target. If we optimize for procurement
departments, we turn into the product we set out to replace.

## The honest competitive picture

Adobe is not our only competitor, and it may not be the hardest one. Every vertical
already has a strong free or cheap tool:

| Domain | Incumbent | Strong cheap/free alternative |
| --- | --- | --- |
| Image | Photoshop, Illustrator | Affinity (free since 2025), Photopea, Krita, GIMP |
| Video | Premiere Pro, After Effects | DaVinci Resolve (free tier), CapCut |
| Audio | Audition | Reaper, Audacity, Resolve Fairlight |
| 3D | Substance, Maya/Max (Autodesk) | Blender (free, open source) |

So **"cheaper than Adobe" alone will not win.** Omega wins on things the single-purpose
tools can't easily copy:

- **True integration.** A 3D scene, a layered image and an audio mix are all native
  objects inside a video timeline. Edit any of them in place. No Dynamic Link, no
  "Edit in…", no exporting intermediate files.
- **Consistency.** One UI language, one set of shortcuts, one scripting API and one
  plugin SDK across every workspace.
- **Performance from day one.** GPU-first, multithreaded, and designed to open fast.
  There is no 30-year-old codebase to work around.
- **Trust.** The business promises below, written down where people can see them.

## Promises to creators (the "no Adobe mistakes" list)

Every promise answers a specific, well-known complaint. These are product requirements,
not marketing copy. Breaking one needs founder sign-off and a public explanation.

| # | Promise | The mistake it avoids |
| --- | --- | --- |
| 1 | **A perpetual license is always available** alongside the subscription. If you stop paying, you keep the last version you paid for. | Subscription-only access, and losing your tools when you stop paying |
| 2 | **Cancel in two clicks, no fees.** No annual-plan-billed-monthly traps. | Hidden early-termination fees (the subject of a 2024 FTC lawsuit against Adobe) |
| 3 | **Your work is yours.** We never train AI on user content, and we never access cloud files except to provide a service you asked for. This is stated plainly in the Terms. | The 2024 Terms of Service backlash over content access and AI training |
| 4 | **Open project format** (`.omega`), with a published spec and reference reader/writer. Import and export of competitor formats is a first-class feature. | Proprietary formats as lock-in |
| 5 | **Works fully offline.** Cloud features are optional add-ons. A license check never blocks opening a file. | Mandatory sign-in and background daemons |
| 6 | **One app, one installer, no background services** unless you opt in. | The Creative Cloud desktop app, plus many resident processes |
| 7 | **Windows, macOS and Linux from day one.** | No Linux support |
| 8 | **AI features are tools, not a toll booth.** Local models where feasible, and transparent pricing for cloud generation. No surprise credit depletion. | Opaque "generative credits" |
| 9 | **One scripting language and one plugin SDK**, stable and versioned, with a deprecation policy. | ExtendScript, CEP and UXP coexisting across apps |
| 10 | **Simple pricing.** At most three tiers, with prices shown on the website. | Confusing plan matrices and regional price games |

## Product principles

1. **One engine, many workspaces.** If two workspaces need the same capability (color,
   effects, text, undo, assets), it lives in the core exactly once.
2. **Non-destructive by default.** Every edit can be revisited. History is part of the document.
3. **Fast is a feature.** Performance budgets are tracked in CI (see ARCHITECTURE.md),
   and a regression is a bug.
4. **Familiar on the surface, better underneath.** Adobe users should feel at home within
   an hour: offer Adobe-compatible shortcut presets and familiar terminology. Innovate
   where it helps creators, not where it only looks different.
5. **Ship depth before breadth.** One workspace that is genuinely excellent beats four
   mediocre ones. See ROADMAP.md for sequencing.
6. **Creators can automate and extend everything.** Anything a user can do in the UI,
   a script can do too.

## Business model (proposal, needs sign-off)

| Tier | Price target | Includes |
| --- | --- | --- |
| **Free** | $0 | Full editing in every workspace. Export watermark-free up to 1080p/stereo. Limited cloud storage. |
| **Creator** | ~$10–12/mo, or ~$150 perpetual with 1 year of updates | Everything, with no export limits and local AI features |
| **Studio** | ~$20/seat/mo | Shared libraries, review/approval, cloud render, team admin |

Revenue beyond licenses: an asset and plugin marketplace with a creator-favorable revenue
split (target 85/15), optional cloud rendering, and paid cloud AI generation at
transparent per-use pricing.
