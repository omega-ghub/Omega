# Adobe Competitive Research (Creative Cloud, Premiere, After Effects)

*Prepared for Omega product planning. Research date: 2026-10-02.*

> **Method note:** WebSearch was used extensively (~35 queries, 45+ distinct sources). Direct page fetching (WebFetch) was blocked by the network egress proxy for most domains (helpx.adobe.com, petapixel.com, theregister.com, cined.com, provideocoalition.com, blog.developer.adobe.com, pymnts.com), so facts below come from search-result extracts of those pages, not full-page reads. Items marked **[unverified]** come from a single secondary source or conflict between sources and should be checked before being used in marketing copy.
>
> **Naming note:** With version 26.0 (January 2026) Adobe renamed **Premiere Pro** to **Adobe Premiere** (dropping "Pro"; internal identifiers unchanged). This report uses "Premiere Pro" for historical context and "Premiere" for the current product.

---

## 1. Creative Cloud desktop app (the launcher)

### Layout and navigation
- Top-level tabs: **Home**, **Apps**, **Files**, **Discover**, **Stock & Marketplace** (Adobe helpx "Creative Cloud desktop app features").
  - **Home:** app shortcuts, "personalized suggestions aligned with your plan" (i.e., upsell), recent files, quick-start buttons for Adobe Express and Firefly.
  - **Apps:** install / update / open apps; an *Installed apps* panel with a *More actions* menu for *Check for updates* and *Enable auto-updates*; categories of available apps.
  - **Files:** Creative Cloud Libraries and cloud documents; recently added Frame.io asset access and opening files in Firefly Boards.
  - **Discover:** tutorials and learning content filterable by app.
  - **Stock & Marketplace:** Adobe Stock, Adobe Fonts, plugins (the old separate "Creative Cloud Market" was retired).
- **Launching:** apps are launched with an **Open** button next to each installed app in Apps/Home. Updates are managed in-app; Preferences has a global *Auto-update* toggle plus per-app toggles and "Advanced options" (import previous settings, remove old versions).
- **Licensing:** apps re-validate the license every 30 days. Annual individual plans get up to 99 days offline; month-to-month plans get 30 days. After that the user must sign in again through the desktop app.

### What users dislike (Adobe Community forums, Medium, Reddit-style sentiment)
- **Background processes that stay running** even when no Adobe app is open: Adobe Desktop Service, AdobeIPCBroker, AdobeUpdateService, CoreSync, CCLibrary, CCXProcess, Creative Cloud Helper, multiple Adobe CEF Helper instances. Users report that "Adobe Desktop" alone uses ~265 MB RAM and each CEF Helper 116-201 MB.
- **CoreSync CPU spikes** (reports of 100% CPU, battery drain, slow Finder).
- **The launcher is required.** Users who only want Photoshop/Premiere must install the full hub (catalog, library manager, update manager). Forum threads ask for a "compact mode / minimal view to launch apps and recent files" and say "please rethink Creative Cloud desktop." One user called it "more like a virus than like a carefully crafted software tool."
- **Sign-in loops, black-screen sign-in, crashes after restart.** Adobe has helpx troubleshooting pages for each of these.
- **Uninstall friction:** the desktop app cannot be removed while any CC app is installed. Individual apps are uninstalled through the launcher.
- **Update and upsell nags,** duplicate update notifications, and promotional Home content.
- **Forced ToS re-acceptance** (June 2024) blocked use, and reportedly even uninstall, until users agreed (see §3).

---

## 2. Start / new-project experience

### 2.1 Premiere home screen
- On launch, Premiere shows a **Home screen**: a left panel with **New Project** and **Open Project** buttons, plus a recent-projects list. Adobe says the content "evolves": more recent projects and fewer tutorials as you gain experience.
- Forum complaints: users cannot stop the Home screen (or auto-reopen of the last project) at launch, and in 25.x the Home screen layout felt "thick" (wasted space).

### 2.2 History of the redesign
| Date | Version | Change |
|---|---|---|
| Apr 2022 | 22.3.1 beta, then public | **Header bar** with **Import / Edit / Export** modes. New **Import mode** shows media first instead of a blank project-settings window. |
| 2022-2023 | 22.x to 23.x GA | Import/Export modes shipped to all users. Created controversy among veteran editors (ProVideo Coalition, No Film School coverage). |
| Oct 2024 | 25.0 | "Fresh, modern design" and a **remodelled New Project dialog**: minimalist, with name, location and some settings in one place before the project exists. A community Idea asked Adobe to revert it ("should be changed back to the way it was in 24"). |
| Jan 2026 | 26.0 | Renamed **Adobe Premiere**. |

### 2.3 New Project flow (current, 25.x/26.x)
1. **Home → New Project.**
2. **New Project dialog:** *Project name*, *Location* (folder picker), and a checkbox **"Skip import mode"**. The checkbox is sticky: once checked, it stays checked for future projects. Older (pre-25) versions exposed a full Project Settings dialog with tabs for General, Scratch Disks and Ingest Settings, covering the renderer (Mercury Playback Engine GPU/Software), capture format, display formats and scratch-disk paths. Those settings moved under *File > Project Settings* **[layout of the 25.x dialog partially unverified]**.
3. **Import mode:**
   - Left: **locations**, meaning local drives, favorites and recent folders.
   - Center: a media browser with **thumbnail hover-scrub**.
   - Bottom: a **selection tray** that collects chosen clips in order. It acts as a mini storyboard.
   - Right: **Import Settings** toggles:
     - **Copy media** (to a chosen location, e.g. off a card)
     - **New bin** (name it)
     - **Create new sequence** (name it). Premiere sets the **sequence settings from the first selected clip**.
     - Organize-media options.
4. **Create** → opens Edit mode with media in the Project panel and, optionally, a sequence already on the timeline.

Key insight: Adobe's own redesign moved away from "configure technical settings first" toward "pick your media first, and settings are inferred." This is the same model iMovie, CapCut, and Resolve's "first clip sets timeline" prompt use.

### 2.4 New Sequence dialog (File > New > Sequence, Cmd/Ctrl+N)
Four tabs: **Sequence Presets**, **Settings**, **Tracks**, **VR Video**.
- **Sequence Presets:** a tree organized by camera or format family: ARRI, AVC-Intra, AVCHD, Digital SLR, DNxHD, DV-24p, DV-NTSC, DV-PAL, DVCPRO50, DVCPROHD, HDV, Mobile & Devices, RED R3D, XDCAM EX / HD / HD422, and others. A description pane explains each preset. Many presets are tape-era or legacy, and the list is long and intimidating. When codecs are not activated, only DV presets appear (a known helpx issue).
- **Settings tab:**
  - *Editing Mode:* determines preview format. *Custom* unlocks all fields.
  - *Timebase:* 23.976, 24, 25, 29.97, 30, 50, 59.94, 60 and more.
  - *Frame Size:* horizontal × vertical, with the aspect ratio displayed.
  - *Pixel Aspect Ratio:* Square Pixels (1.0), D1/DV NTSC 0.9091, PAL 1.0940, anamorphic variants, and others.
  - *Fields:* No Fields (Progressive Scan), Upper Field First, Lower Field First.
  - *Display Format:* timecode style, e.g. 30fps drop-frame.
  - *Working Color Space:* Rec.709, Rec.2100 HLG/PQ, etc.
  - *Audio:* Sample Rate (typically 48000 Hz; 44100 also available) and Display Format (audio samples or milliseconds).
  - *Video Previews:* Preview File Format, Codec, Width/Height, "Maximum Bit Depth", "Maximum Render Quality".
  - **Save Preset** button.
- **Tracks tab:** number of video tracks; audio master type (Stereo, 5.1, Multichannel, Mono); per-track audio types.
- **VR Video tab:** projection, captured view.
- Community request (25.2.1): users want a **default sequence setting**, e.g. always Rec.709 regardless of media. It does not exist.
- Alternative flows: drag a clip onto the "New Item" icon, or right-click a clip and choose **New Sequence From Clip**. Both create a matching sequence. If the first clip dropped onto an empty sequence doesn't match, Premiere shows a **"Clip Mismatch Warning"** with *Change sequence settings* or *Keep existing settings*.

### 2.5 After Effects: New Composition (Composition > New Composition, Cmd/Ctrl+N; settings Cmd/Ctrl+K)
- **Basic tab:**
  - *Preset* dropdown, e.g. HD 1920×1080 29.97, UHD 4K, Social 1080×1920, and others.
  - *Width/Height* with *Lock Aspect Ratio*.
  - *Pixel Aspect Ratio*.
  - *Frame Rate*, with the frame-rate drop-frame/non-drop option.
  - *Resolution* (Full, Half, Third, Quarter, Custom). This sets preview resolution only.
  - *Start Timecode*.
  - *Duration*, maximum 3 hours.
  - *Background Color*.
- **Advanced tab:** anchor; shutter angle and phase (motion blur, e.g. 180°); samples per frame; option to preserve frame rate/resolution when nested.
- **3D Renderer tab:** Classic 3D, Cinema 4D, or Advanced 3D. Advanced 3D does not support native motion blur, a recurring user gotcha.
- **Presets save only** width, height, PAR and frame rate. They do not save resolution, start timecode, duration or advanced settings.
- **New Comp From Selection,** or dragging footage onto the comp button, auto-matches the footage settings.

### 2.6 Premiere Rush / Adobe Express
- **Premiere Rush is being discontinued:**
  - Removed from download on **Sept 30, 2025**.
  - Works on existing installs until **Sept 30, 2026**, when support also ends.
  - Replaced by **Premiere on iPhone/Android** and desktop Premiere.
  - Rush's project creation was simple: name the project, pick media, and aspect ratio is chosen later (16:9, 9:16, 1:1, 4:5) **[from prior knowledge; not re-verified]**.
- **Adobe Express (web/mobile):**
  - Video creation starts from **templates or blank canvases by destination**: Instagram Reel, Story, square post, TikTok, YouTube (16:9), and more.
  - "Resize" changes the destination preset or a **Custom** size.
  - No frame-rate, PAR, or field choices are exposed. It is entirely destination-first.

---

## 3. Adobe's mistakes and controversies (timeline)

| Date | Event | Key facts |
|---|---|---|
| **May 6, 2013** | **Subscription-only switch** (Adobe MAX) | CS6 was the last perpetual Creative Suite. All Apps launched at **$49.99/mo** (annual). A Change.org petition by photographer Derek Schoffstall passed 10k signatures in a week and ~50k overall. A WhiteHouse.gov petition asked the DOJ to investigate. |
| 2013-2025 | **Repeated price increases** | All Apps went $49.99 (2013) → $52.99 (~2019) → $54.99 (2022; Adobe "Creative Cloud offering and price update" blog, Mar 2022) → $59.99 (2023) → $69.99 (June 2025, as CC Pro). One aggregator cites a $89.99 figure; that is likely the month-to-month price, not annual **[unverified]**. |
| **Sept 2022 - Dec 17, 2023** | **Figma acquisition failure** | A $20B deal was announced Sept 2022. Facing an EU Statement of Objections and UK CMA concerns, Adobe and Figma terminated it on **Dec 17, 2023**. Adobe paid Figma a **$1B termination fee** (SEC 8-K). |
| **Feb 17, 2024 → June 2024** | **Terms of Use backlash** | Adobe changed the General Terms in Feb 2024 so that users had to agree Adobe could access content via "automated and manual methods." The terms went unnoticed until a forced "routine re-acceptance" pop-up in early June 2024 blocked app use until users accepted. Designer Sam Santala's X post ("including NDA work?") went viral. Adobe responded June 6-7 and then rewrote the terms (published ~June 18-24, 2024), adding plain-English summaries and stating it "will not use your Local or Cloud Content to train generative AI" and does not scan locally stored content. |
| **June 17, 2024** | **DOJ/FTC lawsuit** | DOJ filed on behalf of the FTC under ROSCA against Adobe and executives Maninder Sawhney and David Wadhwani. Allegations: the "annual, paid monthly" plan buried an **early termination fee of 50% of remaining payments**, and cancellation was an "obstacle course." An internal exec reportedly called the ETF "a bit like heroin for Adobe." |
| **Mar 12-13, 2026** | **Settlement** | **$150M** in total: a **$75M civil penalty** plus **$75M in free services** to eligible customers. Adobe must disclose the ETF and its calculation before enrollment, notify users before trials longer than 7 days convert, and provide easier cancellation. The case was dismissed by stipulation on Mar 13, 2026. Whether the individual executives settled separately is **[unverified]**. |
| Mar 2023 → 2025 | **Firefly and generative credits** | Firefly launched in beta in March 2023. Generative credits were introduced later in 2023. The Firefly Video Model was previewed Sept 11, 2024 and entered beta Oct 14, 2024 (MAX). Generative Extend in Premiere went GA on Apr 2, 2025. Premium features (video and text-to-image with partner models) consume credits. |
| **June 17, 2025** | **Plan restructure (North America)** | All Apps was renamed **Creative Cloud Pro** at **$69.99/mo** (annual, billed monthly; previously $59.99) or $779.99/yr prepaid, and existing All Apps members were auto-migrated. A new **CC Standard** plan ($54.99/mo) has limited AI. Single-app and Photography plan **credits were cut from 500 to 25/month**. CC Pro gets "unlimited" standard generations plus 4,000 premium credits/month (figures vary by source). |
| 2025-2026 | **More hikes** | Lightroom 1TB went from $11.99 to $14.99 (Mar 20, 2026). Enterprise/VIP list prices rose on June 1, 2026. Currency-based adjustments are rolling out from Aug 2026. |
| Ongoing | **Premiere stability and bloat** | Adobe Community threads are titled "Premiere Pro 2025 is a Mess — Stop Pushing Broken Features" and "serious long-term stability problems across versions 2016-2025." Users report rollbacks to 2024, Apple Silicon M3/M4 crashes, caption crashes, and Warp Stabilizer glitches. Many editors report migrating to DaVinci Resolve (secondary sources; anecdotal). |
| Ongoing | **Dynamic Link pain** | After Effects comps go offline or need re-linking, previews and renders are slow, and colors shift. Version mismatches between Premiere and AE break it. Adobe's own advice is to **Render and Replace**, i.e., stop using the live link. |
| Ongoing | **Extensibility fragmentation** | Adobe runs three overlapping systems: **ExtendScript** (an ES3-era JavaScript dialect), **CEP** (Chromium + Node HTML panels), and **UXP** (the new runtime). Premiere UXP entered beta in Dec 2024 and became standard in Premiere 26. Per Adobe's Sept 2026 developer blog, Premiere stops accepting new CEP Marketplace submissions in **Dec 2027**, disables CEP by default in **Dec 2028**, and removes it in **Dec 2029**. ExtendScript has a separate timeline **[exact ExtendScript end-date unverified]**. Developers must port plugins again. |
| Ongoing | **No Linux** | There has never been a Linux version. Forum requests and Change.org petitions date back years. Adobe says it has no plans. (DaVinci Resolve does support Linux.) |

### Current US pricing (individual; annual billed monthly unless noted)
| Plan | Price |
|---|---|
| Creative Cloud Pro (formerly All Apps) | $69.99/mo ($779.99/yr prepaid) |
| Creative Cloud Standard | $54.99/mo |
| Premiere single app | $22.99/mo annual; $34.99 month-to-month; $263.88/yr prepaid |
| CC Pro student/teacher | $29.99/mo first year, then $39.99 |
| Competitors (one-time) | DaVinci Resolve Studio $295; Final Cut Pro $299.99; Resolve free tier |

Omega's price points compare as follows:
- **$149.99 perpetual** is half the price of Resolve Studio or FCP and about 6.5 months of Premiere single-app.
- **$9.99 Creator** is less than half of Premiere single-app's $22.99.
- **$19.99/seat Studio** undercuts CC Pro by about 70%.

---

## 4. Premiere default keyboard shortcuts and panel layout

### Shortcuts (Mac / Windows)
| Action | Key |
|---|---|
| Play reverse / stop / play forward (tap repeatedly to speed up) | **J / K / L** |
| Mark In / Mark Out | **I / O** |
| Mark clip | **X** |
| Clear In and Out | Opt/Ctrl+Shift+X |
| Go to In / Out | Shift+I / Shift+O |
| Selection tool | **V** |
| Track Select Forward / Backward | **A** / Shift+A |
| Ripple Edit tool | **B** |
| Rolling Edit tool | **N** |
| Rate Stretch tool | **R** |
| Razor tool | **C** |
| Slip tool / Slide tool | **Y** / **U** |
| Pen tool | P |
| Hand tool | H |
| Zoom tool | Z |
| Type tool | T |
| Ripple trim previous edit to playhead / next edit to playhead | **Q / W** |
| Add Edit (cut at playhead, targeted tracks) | **Cmd/Ctrl+K** |
| Add Edit to all tracks | Cmd/Ctrl+Shift+K |
| Ripple Delete | **Shift+Delete** (Mac: Shift+Fn+Delete / forward delete) |
| Insert / Overwrite (from Source) | **, (comma) / . (period)** |
| Lift / Extract (In-Out range) | **; / '** |
| Previous / next edit point | Up / Down arrows |
| Step one frame | Left / Right arrows |
| Add marker | **M** |
| Match frame | **F** |
| Snap toggle | **S** |
| Link / unlink | Cmd/Ctrl+L |
| Apply default video / audio transition | Cmd/Ctrl+D / Cmd/Ctrl+Shift+D |
| Zoom timeline in / out | = / - |
| Zoom to fit sequence | \ (backslash) |
| Maximize panel under cursor | ` (grave) |
| Render In to Out | Enter (Win) / Return (Mac) |
| Export media | Cmd/Ctrl+M |
| New sequence | Cmd/Ctrl+N |
| Import | Cmd/Ctrl+I |
| Undo | Cmd/Ctrl+Z |
| Save | Cmd/Ctrl+S |
| Panel focus | Shift+1 Project, Shift+2 Source, Shift+3 Timeline, Shift+4 Program, Shift+5 Effect Controls, Shift+7 Effects |

These shortcuts are confirmed in the Adobe helpx "default keyboard shortcuts" page title and in third-party cheat sheets (Motion Array, AcademyClass, Storyblocks, MASV). The less-common keys (U, panel numbers, backslash) come from established convention plus secondary lists **[verify against helpx before shipping a "Premiere keymap" preset]**. The single-letter keys are identical on Mac and Windows.

### Panel layout (default "Editing" workspace)
- **Header bar** (top): Import | Edit | Export modes, plus a workspace switcher.
- **Top-left:** Source Monitor, tabbed with Effect Controls, Audio Clip Mixer and Metadata.
- **Top-right:** Program Monitor.
- **Bottom-left:** Project panel (bins), tabbed with Media Browser, Libraries, Info, Effects, Markers and History.
- **Bottom-right:** Timeline, flanked by a narrow Tools panel and Audio Meters.
- **Contextual panels**, opened via workspaces or the Window menu:
  - **Effects** (presets, video and audio effects, transitions)
  - **Essential Graphics** (titles and MOGRTs; partly replaced by the newer *Properties* and *Text* panels)
  - **Essential Sound**
  - **Lumetri Color** (Basic Correction, Creative, Curves, Color Wheels, HSL Secondary, Vignette) with **Lumetri Scopes**
- **Preset workspaces:** Editing, Assembly, Color, Effects, Audio, Graphics/Captions and Graphics, Learning, Libraries, Metalogging, Production, Review, Vertical, and others. Larger sets of workspaces were introduced in 22.5.

---

## 5. Sources

**Official Adobe (helpx / news / blog / developer)**
1. Creative Cloud desktop app features — https://helpx.adobe.com/creative-cloud/apps/get-started/adobe-creative-cloud-desktop-app-features.html
2. Know your CC desktop app Home screen — https://helpx.adobe.com/africa/creative-cloud/help/creative-cloud-desktop-app-home-screen.html
3. CC desktop app release notes — https://helpx.adobe.com/creative-cloud/apps/whats-new/release-notes.html
4. Update CC apps automatically — https://helpx.adobe.com/creative-cloud/apps/manage-apps/creative-cloud-apps/update-creative-cloud-apps-automatically.html
5. Internet connectivity / offline grace period — https://helpx.adobe.com/creative-cloud/kb/internet-connection-creative-cloud-apps.html
6. Creative Cloud Market no longer available — https://helpx.adobe.com/creative-cloud/apps/troubleshoot/app-setting-issues/creative-cloud-market-is-no-longer-available.html
7. Create new projects in Premiere — https://helpx.adobe.com/premiere/desktop/organize-media/create-projects/create-new-project.html
8. Start a new project / Import mode — https://helpx.adobe.com/premiere-pro/using/import-media.html
9. Premiere workspaces and home screen overview — https://helpx.adobe.com/ae_en/premiere/desktop/get-started/tour-the-workspace/what-are-workspaces.html
10. Sequence presets and settings — https://helpx.adobe.com/premiere/desktop/edit-projects/change-clip-sequence/sequence-presets-and-settings.html
11. Sequence settings reference — https://helpx.adobe.com/premiere/desktop/edit-projects/change-clip-sequence/sequence-settings-reference.html
12. Create a custom sequence preset — https://helpx.adobe.com/premiere/desktop/edit-projects/change-clip-sequence/create-a-custom-sequence-preset.html
13. Features and sequence presets missing — https://helpx.adobe.com/lu_en/premiere-pro/kb/features-presets-missing-premiere-pro.html
14. Premiere default keyboard shortcuts — https://helpx.adobe.com/premiere/desktop/get-started/keyboard-shortcuts/default-keyboard-shortcuts.html
15. Lift/extract/ripple delete — https://helpx.adobe.com/vn_vi/premiere-pro/how-to/lift-extract-ripple-delete-premiere.html
16. Premiere Pro feature summary Oct 2024 (25.0) — https://helpx.adobe.com/vn_vi/premiere-pro/using/whats-new/2025.html
17. After Effects composition basics — https://helpx.adobe.com/after-effects/desktop/work-with-compositions/composition-settings/composition-basics.html
18. Dynamic Link (Premiere/AE) — https://helpx.adobe.com/premiere-pro/using/dynamic-link.html
19. Premiere Rush discontinuation — https://helpx.adobe.com/premiere-rush/desktop/kb/end-of-life.html
20. Changes to CC individual plans — https://helpx.adobe.com/creative-cloud/apps/manage-plans/changes-to-individual-plan.html
21. Changes to CC for teams plans — https://helpx.adobe.com/account/individual/subscriptions-and-plans/plan-types-and-eligibility/changes-to-teams-plan.html
22. Generative credits FAQ — https://helpx.adobe.com/creative-cloud/apps/generative-ai/generative-credits-faq.html
23. Adobe blog: New in Premiere Pro — redesigned import/export (Apr 2022) — https://blog.adobe.com/en/publish/2022/04/12/new-in-premiere-pro-redesigned-import-and-export-integrated-reviews-and-auto-color
24. Adobe blog: CC offering and price update (Mar 2022) — https://blog.adobe.com/en/publish/2022/03/22/creative-cloud-offering-price-update
25. Adobe news: Firefly Video Model launch (Oct 2024) — https://news.adobe.com/news/2024/10/101424-adobe-launches-firefly-video-model
26. Adobe news: Premiere AI innovation / Generative Extend GA (Apr 2025) — https://news.adobe.com/news/2025/04/new-ai-innovation-in-industry
27. Adobe developer blog: UXP comes to flagship apps (Sept 2026) — https://blog.developer.adobe.com/en/publish/2026/09/investing-in-the-future-of-creative-cloud-extensibility-uxp-comes-to-our-flagship-applications
28. Premiere UXP API reference — https://developer.adobe.com/premiere-pro/uxp/ppro-reference/

**Government / legal / filings**

29. FTC press release (June 2024) — https://ftc.gov/news-events/news/press-releases/2024/06/ftc-takes-action-against-adobe-executives-hiding-fees-preventing-consumers-easily-cancelling
30. Adobe 8-K, Figma termination (Dec 2023) — https://www.sec.gov/Archives/edgar/data/796343/000079634323000254/adbe-20231217.htm
31. Adobe 10-Q FY2026 (settlement disclosure) — https://www.sec.gov/Archives/edgar/data/0000796343/000079634326000112/adbe-20260529.htm
32. WhiteHouse.gov petition (2013) — https://petitions.obamawhitehouse.archives.gov/petition/ask-doj-investigate-adobe-systems-inc-recent-announcement-change-its-software-license/index.html

**Press**

33. TechCrunch: Adobe goes all-in with subscription CC (May 2013) — https://techcrunch.com/2013/05/06/adobe-goes-all-in-with-subscription-based-creative-cloud-will-stop-selling-regular-cs-licenses-shrink-wrapped-boxes/
34. Macworld: CC reactions (2013) — https://www.macworld.com/article/670447/adobe-creative-cloud-reactions-responses-and-reassurance.html
35. CNBC: Adobe and Figma call off deal — https://www.cnbc.com/2023/12/18/adobe-and-figma-call-off-20-billion-merger.html
36. Engadget: Adobe terminates Figma acquisition — https://www.engadget.com/adobe-walks-away-from-its-20-billion-figma-acquisition-amid-regulatory-scrutiny-132203336.html
37. PetaPixel: Photographers outraged by new terms (June 6, 2024) — https://petapixel.com/2024/06/06/photographers-outraged-by-adobes-new-privacy-and-content-terms/
38. PetaPixel: Adobe responds to ToU controversy — https://petapixel.com/2024/06/07/adobe-responds-to-terms-of-use-controversy-says-it-isnt-spying-on-users/
39. CG Channel: Adobe updates Terms of Use — https://www.cgchannel.com/2024/06/adobe-updates-its-terms-of-use-following-artist-backlash/
40. No Film School: Adobe's updated ToS and stance on AI — https://nofilmschool.com/adobe-stance-on-ai
41. VentureBeat: Adobe responds to ToS uproar — https://venturebeat.com/ai/adobe-responds-to-vocal-uproar-over-new-terms-of-service-language
42. 9to5Mac: ToS change outrages professionals — https://9to5mac.com/2024/06/06/change-to-adobe-terms-amp-conditions/
43. Sam Santala on X — https://twitter.com/SamSantala/status/1798292952219091042
44. The Register: Adobe sued over cancel fees (June 2024) — https://www.theregister.com/2024/06/17/adobe_sued_cancel_fees/
45. TechRadar: exec called ETF "heroin" — https://www.techradar.com/pro/adobe-executive-called-software-cancellation-fees-heroin-for-the-company-ftc-says
46. Bloomberg: cancellation suit settled for $150M (Mar 2026) — https://www.bloomberg.com/news/articles/2026-03-13/adobe-cancellation-lawsuit-settled-for-150-million
47. 9to5Mac: Adobe to pay settlement (Mar 2026) — https://9to5mac.com/2026/03/13/adobe-to-pay-75-million-settlement-for-making-it-too-hard-to-cancel-subscriptions/
48. CineD: The $150M price of "Cancel" — https://www.cined.com/the-150-million-price-of-cancel-adobe-settles-doj-lawsuit-over-subscription-practices-every-filmmaker-knows-too-well/
49. Verdict: $150M DOJ settlement — https://www.verdict.co.uk/adobe-agrees-150m-doj-settlement/
50. PetaPixel: CC price could increase (May 2025) — https://petapixel.com/2025/05/20/if-you-have-adobe-creative-cloud-your-price-could-increase-next-month/
51. The Register: pay up or downgrade (May 2025) — https://www.theregister.com/2025/05/20/adobe_price_hikes/
52. Fast Company: CC Pro tier — https://www.fastcompany.com/91337900/adobe-creative-cloud-pro
53. CG Channel: All Apps ends in North America — https://www.cgchannel.com/2025/05/adobe-to-end-creative-cloud-all-apps-subscriptions-in-north-america/
54. PetaPixel: tracking generative credit use (June 2025) — https://petapixel.com/2025/06/24/adobe-is-now-tracking-generative-credit-use-what-you-need-to-know/
55. PetaPixel: Rebranded Adobe Premiere 26 (Jan 2026) — https://petapixel.com/2026/01/20/rebranded-adobe-premiere-26-arrives-with-one-click-object-tracking/
56. Digital Production: Premiere drops the "Pro" — https://digitalproduction.com/2026/01/22/premiere-drops-the-pro-and-picks-up-some-serious-ai/
57. No Film School: redesigned import/export — https://nofilmschool.com/new-premiere-pro-redesigned-import-and-export-integrated-reviews-and-auto-color
58. ProVideo Coalition: new IMPORT and EXPORT workflows — https://www.provideocoalition.com/a-new-adobe-premiere-pro-experience-begins-with-new-import-and-export-workflows/
59. PetaPixel: Premiere adds redesigned import (Apr 2022) — https://petapixel.com/2022/04/12/premiere-pro-adds-cloud-collaboration-and-redesigned-import-process/
60. Creative Bloq: Premiere Pro 25.1 review — https://www.creativebloq.com/entertainment/video-editing-software/adobe-premiere-pro-2024-review
61. TechCrunch: Firefly video generator (Oct 2024) — https://techcrunch.com/2024/10/14/adobe-invites-you-to-embrace-the-tech-with-fireflys-new-video-generator/
62. Frame.io blog: fixing Dynamic Link errors — https://blog.frame.io/2022/06/13/troubleshooting-dynamic-link-problems-in-premiere-pro-and-after-effects/

**Community / user sentiment**

63. Close background processes after closing Adobe product — https://community.adobe.com/t5/creative-cloud-services-discussions/close-the-background-processes-that-remain-open-after-closing-adobe-product/td-p/14473373
64. How to disable CC background processes (Medium) — https://justin-ross.medium.com/how-to-disable-adobes-creative-cloud-background-processes-fb4e572a628c
65. Core Sync choking systems — https://community.adobe.com/t5/creative-cloud-services-discussions/core-sync-process-choking-systems/m-p/10741988/highlight/true
66. Why is CC still bloated in 2023 — https://community.adobe.com/t5/creative-cloud-desktop-discussions/why-is-adobe-creative-cloud-still-bloated-in-2023/m-p/14304104
67. Compact mode / minimal view request — https://community.adobe.com/questions-606/compact-mode-minimal-view-to-launch-apps-and-recent-files-574130
68. Please rethink Creative Cloud desktop — https://community.adobe.com/questions-606/please-rethink-creative-cloud-desktop-576492
69. CC desktop 5.10.0 extremely bloated — https://community.adobe.com/bug-reports-601/creative-cloud-desktop-application-5-10-0-extremely-bloated-1219589
70. Premiere 25 New Project dialog should be changed back — https://community.adobe.com/t5/premiere-pro-ideas/premiere-25-quot-new-project-quot-dialog-should-be-changed-back-to-the-way-it-was-in-24/idc-p/14958703
71. No way to stop Home or recent project on launch — https://community.adobe.com/questions-729/no-way-to-stop-home-or-recent-project-on-launch-1368170
72. Default sequence settings 25.2.1 request — https://community.adobe.com/feature-requests-730/default-sequence-settings-25-2-1-1328517
73. Premiere Pro 2025 is a mess — https://community.adobe.com/questions-729/premiere-pro-2025-is-a-mess-stop-pushing-broken-features-1418031
74. Long-term stability problems 2016-2025 — https://community.adobe.com/t5/premiere-pro-discussions/when-is-enough-enough-serious-long-term-stability-problems-across-versions-2016-2025/m-p/15597606
75. Dynamic linking issues bug report — https://community.adobe.com/bug-reports-728/dynamic-linking-issues-with-premiere-pro-and-after-effects-1330528
76. Linux support request — https://community.adobe.com/questions-617/make-creative-cloud-products-available-on-linux-468831/index7.html

**Shortcut / workflow references (third party)**

77. Motion Array shortcut list — https://motionarray.com/learn/premiere-pro/ultimate-list-of-adobe-premiere-keyboard-shortcuts/
78. AcademyClass cheat sheet 2026 — https://academyclass.com/blog/premiere-pro-keyboard-shortcuts-cheat-sheet/
79. MASV Premiere shortcuts — https://massive.io/tutorials/premiere-pro-keyboard-shortcuts/
80. Larry Jordan: New workspaces in 22.5 — https://larryjordan.com/articles/new-workspaces-in-adobe-premiere-pro-22-5/
81. MakeUseOf: Sequence settings intro — https://www.makeuseof.com/introduction-sequence-settings-adobe-premiere-pro/
82. Resolve vs FCP pricing (Storyblocks) — https://www.storyblocks.com/resources/tutorials/davinci-resolve-vs-final-cut-pro

---

## 6. Implications for Omega

### A. Launcher / dashboard
1. **The launcher is optional and cheap.** Every Omega app must be launchable directly from the OS (Dock, Start menu, file double-click) without the dashboard running. The dashboard is a convenience, never a gate.
2. **Zero resident background processes by default.** Nothing should run when no Omega app is open. Updates are checked at app launch. Cloud sync runs only while an app is open, or when the user explicitly enables a "Sync in background" toggle. Publish a "What's running" panel in Settings that lists every Omega process with its RAM and CPU use. That is directly marketable against CoreSync and CEF Helper.
3. **Lean shell.** The memory budget for the dashboard should be under 150 MB idle; Adobe Desktop alone is about 265 MB. Do not spawn one browser-helper process per panel.
4. **Navigation should be 4 tabs maximum:**
   - **Home**: recent projects first, plus a "New project" button.
   - **Apps**: installed apps with Open / Update; per-app version pinning and rollback.
   - **Files/Cloud**: only for Studio tier users.
   - **Learn**: tutorials, dismissible.
   There are **no ads, upsells or "personalized suggestions" on Home** for paid or perpetual users. A single, dismissible upgrade card is acceptable on the Free tier.
5. **Updates on the user's terms:**
   - Auto-update is off by default for perpetual licenses.
   - Show "update available" once per version, never as recurring nags.
   - Updates never happen mid-session.
   - Keep the previous version installed for one-click rollback. This addresses the common "rolled back to 2024" behavior.
   - Show a changelog before updating.
6. **Offline-first licensing.** A perpetual license works offline indefinitely after activation. Subscriptions get at least a 99-day offline grace period at all tiers, matching Adobe's best case and beating its 30-day month-to-month limit. Never block launch on a terms or marketing dialog.
7. **Uninstall independence.** Each app uninstalls through standard OS mechanisms. Uninstalling the dashboard never requires removing apps first, and vice versa.
8. **Ship Linux,** at least for the video editor. It is a decades-old unmet Adobe request and a cheap differentiator for the creator and dev audience.

### B. New-project setup flow
9. **Media-first, settings-inferred is the default.** Copy what Adobe got right in Import mode and Express:
   - Step 1: "What are you making?" with destination cards: YouTube 16:9, Shorts/Reels/TikTok 9:16, Square 1:1, 4:5 feed, Cinema 2.39, and Match first clip (recommended).
   - Step 2: pick media from a browser with hover-scrub and a selection tray.
   - Step 3: name and location, prefilled with something like `~/Movies/Omega/<Untitled YYYY-MM-DD>`, editable inline.
   - Single **Create** button.
10. **Never show tape-era presets up front.** Hide DV-NTSC/PAL, HDV, DVCPRO, fields, and non-square PAR behind an "Advanced / Broadcast" disclosure. Default settings:
    - progressive
    - square pixels
    - 48 kHz audio
    - Rec.709 SDR
    - frame rate and frame size from the first clip, or from the chosen destination
11. **One compact "Timeline settings" panel**, always re-editable later with no penalty, showing:
    - Resolution, with orientation toggle
    - Frame rate (23.976 / 24 / 25 / 29.97 / 30 / 50 / 59.94 / 60)
    - Color space (Rec.709 / HLG / PQ)
    - Audio sample rate (48k / 44.1k)
    - Preview quality (Auto / Proxy / Full)
    Fields, PAR and drop-frame display appear only under Advanced.
12. **User-settable default timeline settings** and saved presets. Adobe users explicitly asked for this in 25.2.1 and do not have it.
13. **Graceful mismatch handling.** When the first clip differs from the timeline, show a non-modal inline banner ("Clip is 4K 59.94 — match timeline?") instead of a blocking dialog. Remember the user's choice.
14. **Sticky preferences done right.** A "Skip media step" choice must be clearly visible and reversible in the dialog itself, unlike Adobe's hidden sticky "Skip import mode" checkbox.
15. **Home behavior is configurable:** open Home, reopen the last project, or show a blank new project. Adobe users ask for this and do not have it.
16. **Motion/compositing app (AE-equivalent):** use the same destination cards. Put duration and background color on the first screen, and the renderer and motion blur under Advanced. Presets should save everything, including duration and resolution, which is an AE gap. Warn in the UI when a renderer choice disables a feature such as motion blur.

### C. Editing UX
17. **Ship a "Premiere-compatible" keymap preset** alongside Omega's default:
    - J/K/L, I/O, V/A/B/N/R/C/Y/U
    - Q/W, Cmd+K
    - Shift+Delete, `,`/`.`, `;`/`'`, M, F, S
    - `=`/`-`/`\`, `` ` ``, Shift+1-7
    Ideally keep Omega's default close to these keys so switchers have zero relearning. Also offer Final Cut and Resolve keymaps.
18. **Default layout should mirror the Premiere Editing workspace:**
    - Project/Media bottom-left
    - Source top-left
    - Program top-right
    - Timeline bottom-right
    - Inspector tabbed with Source
    Use a single unified **Inspector** instead of separate Effect Controls, Essential Graphics, Essential Sound and Lumetri panels. Adobe's sprawl of overlapping panels is itself a complaint.
19. **No Dynamic Link equivalent.** Motion graphics and compositing should live inside the same project and process, e.g. a "compound/motion clip" opened in a motion tab, with cached renders. There should never be offline comps or version-mismatch failures.
20. **One extensibility API** from day 1 (a modern JS/TS or WASM plugin API, versioned and documented), with a published deprecation policy of at least 3 years. Avoid ExtendScript/CEP/UXP-style churn.
21. **Stability as a feature:**
    - crash-safe autosave with project versions
    - "safe mode" launch without plugins
    - public stability metrics or crash-free session rate
    Never ship a release that forces project format upgrades without a down-save path.

### D. Pricing, trust and terms (marketing and policy)
22. **Cancellation:** one-click cancel in-app and on the web, with **no early termination fees, ever**. Show the price, billing interval and renewal date on the checkout page in plain text. This is the exact behavior the DOJ settlement forced on Adobe, so Omega should make it a headline promise.
23. **Perpetual means perpetual.** For the $149.99 license, define update entitlement clearly, e.g. "all updates for 12 months, keep forever." The license works offline and is never revoked if the company changes plans.
24. **Content and AI terms in plain English up front:** "We never access your local or cloud project content; we never train AI on your content," with a public, versioned ToS changelog. Terms updates must never block app use or uninstall.
25. **AI credits:** if Omega offers generative features, show the credit cost before each action, show the remaining balance in the UI, and never reduce existing allotments mid-plan. Adobe cut single-app credits from 500 to 25 in June 2025.
26. **Price comparison messaging:**
    - Creator at $9.99 vs Premiere single-app at $22.99
    - Studio at $19.99/seat vs CC Pro at $69.99
    - Perpetual at $149.99 vs Resolve Studio at $295 and FCP at $299.99
    - The free tier should include a real, watermark-free 1080p export to compete with Resolve Free **[recommendation; confirm with pricing owner]**
27. **Migration on-ramp:** import Premiere XML/EDL/AAF and `.prproj` where feasible, plus a Premiere keymap and a "Coming from Adobe?" onboarding path in the new-project flow.
