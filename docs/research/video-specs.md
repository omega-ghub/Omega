# Video, Audio & Platform Specs for Omega

Research for the Omega video editor's **New Project** presets and **Export** platform presets.
Compiled 2026-10-02.

> **How this was verified.** Official pages were the target: YouTube Help, Spotify for Creators, Apple Podcasts, Vimeo Help, Twitch Help, LinkedIn Help, Meta, the Netflix Partner Help Center, the Apple ProRes white paper, Avid KB, SMPTE, ITU, the AOMedia, Access Advance and Via LA sites, NVIDIA, MDN and Chrome. The research sandbox's egress proxy **blocked direct fetches** of most of these domains: support.google.com, partnerhelp.netflixstudios.com, podcasters.apple.com, support.apple.com, help.vimeo.com, help.twitch.tv, linkedin.com, facebook.com and developer.mozilla.org. Their values were therefore taken from search-engine extracts of those official pages, and checked against at least one secondary source where possible.
>
> Legend: **[OFFICIAL]** the value comes from the platform's or standards body's own page (via search extract). **[SECONDARY]** only third-party guides confirm it. **[UNCERTAIN]** the value changes often, sources conflict, or it depends on account tier or region. Re-check it before you ship.
>
> Platform limits change several times a year. Keep these presets in a data file that can be updated without an app release.

---

## 1. Frame sizes & aspect ratios

All sizes use square pixels (PAR 1:1) unless noted. Keep both dimensions **even** so 4:2:0 encoding works. Multiples of 8 or 16 avoid encoder padding.

### 1.1 Landscape / broadcast / cinema

| Common name (UI label) | Also called | Width | Height | Aspect | PAR | Notes |
|---|---|---:|---:|---|---|---|
| SD NTSC (DV/D-1) | 480i / 480p | 720 | 480 | 4:3 or 16:9 (anamorphic) | 10:11 (4:3), 40:33 (16:9) | Legacy only. Rec.601. Usually interlaced at 29.97. |
| SD PAL | 576i / 576p | 720 | 576 | 4:3 or 16:9 (anamorphic) | 12:11 (4:3), 16:11 (16:9) | Legacy only. Usually interlaced at 25. |
| SD square-pixel 16:9 | 480p web | 854 | 480 | ~16:9 | 1:1 | Web/proxy use. 854 is not exactly 16:9. |
| HD 720p | HD Ready | 1280 | 720 | 16:9 | 1:1 | SMPTE ST 296. |
| Full HD 1080p | FHD, 2K (consumer slang) | 1920 | 1080 | 16:9 | 1:1 | SMPTE ST 274. The default for most work. |
| QHD 1440p | 2.5K, "2K" on YouTube | 2560 | 1440 | 16:9 | 1:1 | YouTube tier with its own bitrate. |
| UHD 4K | 2160p, "4K" | 3840 | 2160 | 16:9 | 1:1 | ITU-R BT.2020 / SMPTE ST 2036-1. Netflix UHD delivery size. |
| DCI 2K (full container) | 2K DCI | 2048 | 1080 | ~1.90:1 | 1:1 | DCI DCSS. |
| DCI 2K Flat | 2K 1.85 | 1998 | 1080 | 1.85:1 | 1:1 | DCP flat. |
| DCI 2K Scope | 2K 2.39 | 2048 | 858 | 2.39:1 | 1:1 | DCP scope. |
| DCI 4K (full container) | 4K DCI | 4096 | 2160 | ~1.90:1 | 1:1 | DCI DCSS. |
| DCI 4K Flat | 4K 1.85 | 3996 | 2160 | 1.85:1 | 1:1 | DCP flat. |
| DCI 4K Scope | 4K 2.39 | 4096 | 1716 | 2.39:1 | 1:1 | DCP scope. |
| UHD Scope (letterbox-free) | 2.39 UHD | 3840 | 1608 | ~2.39:1 | 1:1 | A common editor timeline for "cinemascope" web delivery. 1606.7 is rounded to an even number. |
| HD Scope | 2.39 HD | 1920 | 804 | ~2.39:1 | 1:1 | Same idea at HD. |
| Ultrawide 21:9 | 2560x1080 | 2560 | 1080 | 64:27 (~2.37:1) | 1:1 | Marketed as "21:9". Monitors and gaming capture. |
| Ultrawide 21:9 (UHD) | 5K2K | 5120 | 2160 | 64:27 | 1:1 | |
| 8K UHD | 4320p, FUHD | 7680 | 4320 | 16:9 | 1:1 | ITU-R BT.2020. YouTube supports it. |

### 1.2 Social / mobile

| Common name | Width | Height | Aspect | Primary use |
|---|---:|---:|---|---|
| Vertical 9:16 HD | 1080 | 1920 | 9:16 | TikTok, Reels, Shorts, Stories, Snapchat, Spotlight. |
| Vertical 9:16 4K | 2160 | 3840 | 9:16 | Vertical master. YouTube Shorts accepts it. Most social apps downscale it. |
| Vertical 9:16 720p | 720 | 1280 | 9:16 | Low-bandwidth or proxy. |
| Portrait 4:5 | 1080 | 1350 | 4:5 | Instagram and Facebook feed (maximum feed height). |
| Portrait 3:4 | 1080 | 1440 | 3:4 | Instagram's profile grid has been 3:4 since Jan 2025. Native 3:4 posts arrived in May 2025. [SECONDARY] |
| Square 1:1 | 1080 | 1080 | 1:1 | Feed, carousels, LinkedIn. |
| Landscape 16:9 | 1920 | 1080 | 16:9 | YouTube, X, LinkedIn, Facebook, Vimeo. |
| Portrait 2:3 | 1000 | 1500 | 2:3 | Pinterest (out of scope; listed for completeness). |

Accepted aspect-ratio ranges by platform: X **1:2.39 to 2.39:1** [OFFICIAL, via developer docs extract]. LinkedIn **1:2.4 to 2.4:1** [OFFICIAL]. YouTube classifies a video as a Short when it is square or vertical **and** no longer than 3 minutes.

---

## 2. Frame rates & timecode

### 2.1 Frame rates

Store frame rates as **exact rationals**, never as floats. The NTSC rates are N×1000/1001.

| Label | Exact rational | Typical use | Region | Timecode |
|---|---|---|---|---|
| 23.976 | 24000/1001 | Film-look content for NTSC-region TV and web. Most narrative and streaming work, including Netflix and many cameras. | NTSC regions (Americas, Japan, Korea) | NDF only. There is no drop-frame variant for 23.976. |
| 24 | 24/1 | True cinema and DCP. | Global (cinema) | NDF |
| 25 | 25/1 | Broadcast and web in PAL/SECAM regions. | Europe, Africa, most of Asia, Australia | NDF |
| 29.97 | 30000/1001 | NTSC broadcast and US TV news. Common for corporate and web work in the US. | NTSC regions | **DF** (broadcast convention) or NDF |
| 30 | 30/1 | Web, screen recording, phones. Not used in broadcast. | Global (web) | NDF |
| 48 | 48/1 | HFR cinema (rare). DCI 2K allows 48. | Cinema | NDF |
| 50 | 50/1 | PAL-region sports and HFR broadcast. Interlaced "50i" is 25 fps. | PAL regions | NDF |
| 59.94 | 60000/1001 | US sports and broadcast HFR, US "60p" cameras. Interlaced 1080i59.94 is 29.97 fps. | NTSC regions | **DF** or NDF |
| 60 | 60/1 | Gaming capture, screen recording, web HFR, phones. | Global (web) | NDF |
| 120 | 120/1 (or 120000/1001) | Slow-motion source and some gaming capture. Few platforms deliver it; YouTube's maximum is 60. | Global | NDF |

Rules of thumb:
- **Match the source frame rate.** YouTube, Vimeo and Spotify all say to upload at the native frame rate [OFFICIAL].
- Spotify accepts **24, 25, 30, 50 and 60** [OFFICIAL]. Whether the NTSC variants (23.976 and others) are accepted is not stated explicitly [UNCERTAIN]. They are widely reported to work.
- Netflix UHD accepts **23.976, 24, 25, 29.97, 30, 50, 59.94 and 60**, progressive only [OFFICIAL].
- DCI: 2K at 24 or 48. 4K at 24 [SECONDARY, Wikipedia summary of the DCI spec].
- TikTok and Instagram recommend 23 to 60 fps [SECONDARY]. X supports up to 60 fps; older API docs said under 40 fps [UNCERTAIN]. Twitch live streams at up to 60.

### 2.2 Drop-frame vs non-drop-frame (SMPTE ST 12-1)

- At 29.97 fps, NDF timecode drifts from the wall clock by **3.6 s per hour (108 frames)**.
- **Drop-frame (DF)** skips **frame numbers** `:00` and `:01` at the start of every minute **except minutes divisible by 10** (00, 10, 20, 30, 40, 50). No actual frames are discarded. Example: `01:22:59;29` is followed by `01:23:00;02`.
- At 59.94 DF, frame numbers 00 to 03 are skipped with the same rule.
- Notation: DF uses a semicolon (`HH:MM:SS;FF`). NDF uses a colon (`HH:MM:SS:FF`).
- 23.976 has **no** drop-frame mode. It always uses NDF, so its timecode runs about 0.1% slower than real time.
- **Omega default:** turn on DF for 29.97 and 59.94 projects, with a per-project toggle. Use NDF everywhere else.

---

## 3. Audio

### 3.1 Sample rates & bit depth

| Setting | Use | Notes |
|---|---|---|
| **48 kHz** | **Video default.** Broadcast, streaming, Netflix, YouTube, Vimeo. | YouTube recommends 48 kHz (96 kHz is also accepted) and Vimeo 48 kHz [OFFICIAL]. Every video project preset should use 48 kHz. |
| 44.1 kHz | Music and CD masters, some podcast-only audio. | Resample to 48 kHz when importing into a video timeline. |
| 96 kHz | High-resolution audio post and sound design. | Rarely needed for delivery. |
| 16-bit | Final delivery of PCM/WAV podcast audio. | |
| **24-bit** | **Production and mastering default.** Netflix requires 24-bit for PCM stems. | |
| 32-bit float | Internal mix bus and intermediates. | Use as Omega's internal mix format. |

### 3.2 Channel layouts

| Layout | Channels | Order (SMPTE/ITU, as used in WAV/MOV) | Use |
|---|---:|---|---|
| Mono | 1 | C | Voice and podcasts. |
| Stereo | 2 | L R | Default for every social platform. |
| 5.1 | 6 | L R C LFE Ls Rs | YouTube (AAC 512 kbps), Vimeo, Netflix, broadcast. |
| 7.1 | 8 | L R C LFE Lss Rss Lrs Rrs | Netflix and cinema. |
| Dolby Atmos | object-based | ADM BWF / IMF IAB | Netflix premium. Out of scope for v1. |

### 3.3 Delivery codec & bitrate

| Target | Codec | Rate | Bitrate | Status |
|---|---|---|---|---|
| YouTube | AAC-LC | 48 or 96 kHz | Mono 128, **Stereo 384**, 5.1 512 kbps | [OFFICIAL] |
| Vimeo | AAC-LC | 48 kHz | 320 kbps CBR | [OFFICIAL] |
| Spotify video podcast | AAC-LC (PCM and FLAC are also accepted) | 48 kHz | 192 kbps (128 kbps minimum) | [OFFICIAL] |
| Instagram, TikTok, X, LinkedIn | AAC-LC | 44.1 or 48 kHz | 128 to 256 kbps | [SECONDARY] |
| Masters (ProRes/DNx) | PCM (LPCM) 24-bit | 48 kHz | n/a | |
| WebM (VP9/AV1) | Opus | 48 kHz | 128 to 192 kbps stereo | |

### 3.4 Loudness targets

All of these use ITU-R BS.1770 metering (integrated LUFS/LKFS, which are the same unit).

| Target | Integrated loudness | True-peak max | Notes | Status |
|---|---|---|---|---|
| **EBU R128** (EU broadcast) | **-23 LUFS** (±0.5 LU; ±1 LU for live) | -1 dBTP | | [OFFICIAL] |
| **ATSC A/85** (US broadcast, CALM Act) | **-24 LKFS** (±2 LU) | -2 dBTP | Dialog-anchored. | [OFFICIAL] |
| **Netflix** | **-27 LKFS ±2 LU, dialog-gated** | -2 dBTP | Uses Dolby Dialogue Intelligence gating. Put the limiter at about -2.3 dBTP for margin. | [OFFICIAL, via Netflix Sound Mix Spec v1.6 extract] |
| **YouTube** | **-14 LUFS** (normalization reference) | -1 dBTP (recommended) | Louder uploads are turned down. Quieter ones are not turned up. | [SECONDARY]. YouTube does not publish this number officially. |
| **Spotify** (music and podcasts) | **-14 LUFS** | -1 dBTP | | [SECONDARY] |
| **Apple Podcasts** | **-16 LKFS ±1 dB** | -1 dBTP | BS.1770-5 metering. Some guides suggest about -19 LUFS for mono files. | [OFFICIAL] |
| TikTok / Instagram / Facebook | about -14 LUFS (de facto) | -1 dBTP | No published spec. | [UNCERTAIN] |

**Omega export defaults:**
- Social and web: **-14 LUFS / -1 dBTP**.
- Podcast: **-16 LUFS / -1 dBTP**.
- EU broadcast: **-23 / -1**.
- US broadcast: **-24 / -2**.
- Netflix: **-27 dialog-gated / -2**. Netflix loudness needs dialog gating, so offer it only as an "analysis" preset.

---

## 4. Platform upload specs (2025-2026)

> Platforms always re-encode uploads. The bitrates below are what to **upload**, not what viewers receive.

### 4.1 YouTube [OFFICIAL]

**General settings**
- **Container:** MP4. Use the moov atom at the front (fast start). No edit lists.
- **Video:** H.264 High Profile, progressive, 2 consecutive B-frames, closed GOP with GOP = half the frame rate, CABAC, VBR, 4:2:0.
- **Audio:** AAC-LC, 48 or 96 kHz. Stereo 384 kbps, 5.1 512 kbps.
- **Frame rate:** native. Up to 60.
- **Aspect ratio:** 16:9 player. Other ratios are pillarboxed or letterboxed automatically.
- **Limits:** **256 GB or 12 hours**, whichever comes first. Unverified accounts are limited to **15 minutes**.
- **Shorts:** vertical or square, **up to 3 minutes** (since 15 Oct 2024). Use 1080x1920.

Recommended **SDR** upload bitrates (H.264, Mbps):

| Resolution | 24/25/30 fps | 48/50/60 fps |
|---|---:|---:|
| 2160p (4K) | 35-45 | 53-68 |
| 1440p | 16 | 24 |
| 1080p | 8 | 12 |
| 720p | 5 | 7.5 |
| 480p | 2.5 | 4 |
| 360p | 1 | 1.5 |
| 4320p (8K) | 80-160 | 120-240 |

Recommended **HDR** upload bitrates (Mbps):

| Resolution | 24/25/30 fps | 48/50/60 fps |
|---|---:|---:|
| 2160p | 44-56 | 66-85 |
| 1440p | 20 | 30 |
| 1080p | 10 | 15 |
| 720p | 6.5 | 9.5 |

The 720p and 1440p HDR rows come from the official table as recalled; the search extracts confirmed only the 2160p and 1080p rows [UNCERTAIN on exact minor rows].

**HDR uploads** need all of the following:
- 10 or 12-bit, **Rec.2020 primaries**, **PQ or HLG** (BT.2100), BT.2020 non-constant-luminance matrix.
- HDR metadata in the codec or container. PQ uploads should also carry SMPTE ST 2086 mastering-display metadata (and MaxCLL/MaxFALL).
- Recommended codecs: **HEVC Main10**, **VP9 Profile 2** or **AV1**. ProRes and DNxHR HQX also work.
- Containers: MOV, MP4 or MKV.

YouTube's published numbers are **minimums**. Uploading at 1.5 to 2× gives the re-encode more headroom.

### 4.2 TikTok

| Item | Value | Status |
|---|---|---|
| Resolution / aspect | 1080x1920, 9:16 (minimum about 540x960). 16:9 and 1:1 are accepted. | [SECONDARY]; ads spec [OFFICIAL] |
| Max length | 10 min in-app; up to 60 min via web upload | [SECONDARY] [UNCERTAIN] |
| Max file size | about 287.6 MB on iOS and 72 MB on Android in-app; up to 10 GB on web | [SECONDARY] [UNCERTAIN] |
| Container / codec | MP4 or MOV; H.264 (H.265 accepted); AAC audio | [SECONDARY] |
| Frame rate | 23 to 60 fps (30 is typical) | [SECONDARY] |
| Ads (In-Feed) | 5 to 60 s, 500 MB or less, bitrate at least 516 kbps (at least 2,500 kbps for auction ads) | [OFFICIAL, ads.tiktok.com extract] |

### 4.3 Instagram (Meta)

| Placement | Size | Aspect | Max length | Max file | Notes |
|---|---|---|---|---|---|
| Reels | 1080x1920 | 9:16 | 3 min in-app; up to 15 min reported for uploads and scheduling tools [UNCERTAIN] | 4 GB | MP4/MOV, H.264, AAC, 30 fps typical. [SECONDARY] |
| Feed video | 1080x1350 (4:5) or 1080x1080. 3:4 (1080x1440) has been allowed since 2025. | 4:5 to 1.91:1 | 60 min | 4 GB | [SECONDARY] |
| Stories | 1080x1920 | 9:16 | 60 s per card (longer uploads are split) | 4 GB | [SECONDARY] |

### 4.4 Facebook (Meta)

| Item | Value | Status |
|---|---|---|
| Feed video | 1080x1080 (1:1), 1080x1350 (4:5), 1920x1080 (16:9) | [SECONDARY] |
| Max length / size (organic) | 240 min / **10 GB** | [SECONDARY, consistent with Meta's video-requirements one-sheet] |
| Ads | 4 GB maximum. 4:5 is recommended for feed. | [SECONDARY] |
| Reels | 1080x1920, 9:16 | [SECONDARY] |
| Codec | MP4/MOV, H.264, AAC 128 kbps or more, 30 fps | [SECONDARY] |

### 4.5 X (Twitter)

| Item | Value | Status |
|---|---|---|
| Resolution | 1280x720 minimum; 1920x1080 recommended. Maximum 1920x1200 landscape or 1200x1920 portrait. | [SECONDARY], from X's media best-practices |
| Aspect | 1:2.39 to 2.39:1 | [OFFICIAL] |
| Max length / size | **2:20 (140 s) / 512 MB** on free accounts. Premium: up to about 3-4 h and 8-16 GB depending on tier and client. | [UNCERTAIN for Premium] |
| Codec | MP4/MOV, H.264 High, AAC-LC, at most 60 fps, about 25 Mbps maximum | [SECONDARY] |

### 4.6 LinkedIn [OFFICIAL, Pages help article]

| Item | Value |
|---|---|
| File size | 75 KB to **5 GB** |
| Duration | 3 s to **10 min** (Pages). Up to 15 min on desktop member posts [UNCERTAIN]. |
| Resolution | 256x144 to 4096x2304 |
| Aspect | 1:2.4 to 2.4:1 |
| Frame rate | 10 to 60 fps |
| Bitrate | 192 kbps to 30 Mbps |
| Format | MP4 recommended. Ads are limited to 200 MB. |

### 4.7 Vimeo [OFFICIAL]

- **Codec:** H.264, **ProRes 422 HQ** or H.265. Constant frame rate at the native rate, PAR 1:1.
- **Bitrate:** SD 2-5, 720p 5-10, **1080p 10-20**, 2K 20-30, **4K 30-60**, 8K 50-80 Mbps.
- **Audio:** AAC-LC, 320 kbps, 48 kHz.
- HDR (HDR10, HLG, Dolby Vision) is supported.
- The maximum file size depends on the plan (storage quota) [UNCERTAIN].

### 4.8 Twitch (live, not file upload)

| Item | Value | Status |
|---|---|---|
| 1080p60 | 6,000 kbps CBR (Twitch's published guideline maximum), H.264, keyframe every 2 s | [SECONDARY, reflecting the official broadcasting guidelines] |
| 720p60 | about 4,500 kbps; 720p30 about 3,000 kbps | [SECONDARY] |
| Audio | AAC, 160 kbps, 48 kHz stereo | [SECONDARY] |
| Enhanced Broadcasting | H.264 and HEVC ladders sent from the client (multiple renditions). AV1 in beta. Higher bitrates are allowed. | [UNCERTAIN] |

Twitch VOD/highlight uploads use MP4, H.264 and AAC. Omega should treat Twitch as a streaming target (later), not as an export preset.

### 4.9 Snapchat

| Item | Value | Status |
|---|---|---|
| Spotlight / Stories | 1080x1920, 9:16, MP4/MOV H.264 | [SECONDARY] |
| Length | Spotlight 5 to 60 s (newer app versions may allow longer) | [UNCERTAIN] |
| File size | up to about 1 GB; 32 MB or less recommended for ads | [SECONDARY] |

### 4.10 Spotify video podcasts [OFFICIAL, Spotify for Creators "Video specs"]

| Item | Value |
|---|---|
| Container | MP4 (recommended) or MOV. One video track and one audio track. |
| Video | H.264 (recommended) or H.265. **1080p or higher** recommended (180p minimum). 16:9. |
| Bitrate | **25 Mbps CBR at 1080p; 35 Mbps CBR at 4K** |
| Frame rate | 24, 25, 30, 50 or 60. Keyframe about every 1 s. |
| Color | Rec.709 |
| Audio | AAC-LC 192 kbps (PCM and FLAC accepted). Stereo. |
| File size | Under 10 GB recommended; **60 GB maximum** |
| Loudness | -14 LUFS [SECONDARY] |

### 4.11 Netflix (reference only; IMF delivery is out of scope)

- **Package:** IMF Application #2E (SMPTE ST 2067-21).
- **Codec:** JPEG 2000. UHD is 3840x2160, RGB 4:4:4 full range, progressive.
- **Frame rates:** 23.976, 24, 25, 29.97, 30, 50, 59.94 or 60.
- **HDR:** Dolby Vision with at least L1 metadata.
- **Audio:** -27 LKFS dialog-gated, -2 dBTP, 24-bit 48 kHz.

Omega can at most export a **ProRes 422 HQ / 4444 mezzanine** for a vendor to IMF-wrap. [OFFICIAL, via extracts]

### 4.12 Platform summary table (drives Export presets)

| Platform | W×H | Aspect | FPS | Video codec | Upload bitrate (Omega target) | Audio | Max length | Max size |
|---|---|---|---|---|---|---|---|---|
| YouTube 1080p | 1920×1080 | 16:9 | native (≤60) | H.264 High | 16 Mbps (24 at HFR) | AAC 384k 48k | 12 h | 256 GB |
| YouTube 1440p | 2560×1440 | 16:9 | native | H.264 High | 32 Mbps (48 at HFR) | AAC 384k | 12 h | 256 GB |
| YouTube 4K | 3840×2160 | 16:9 | native | H.264 High / HEVC | 60 Mbps H.264 / 45 HEVC | AAC 384k | 12 h | 256 GB |
| YouTube 4K HDR | 3840×2160 | 16:9 | native | HEVC Main10 PQ/HLG | 70 Mbps | AAC 384k | 12 h | 256 GB |
| YouTube Shorts | 1080×1920 | 9:16 | native | H.264 | 16 Mbps | AAC 384k | 3 min | 256 GB |
| TikTok | 1080×1920 | 9:16 | 30 (≤60) | H.264 | 12 Mbps | AAC 192k | 10 min (60 web) | 287 MB iOS / 10 GB web |
| IG Reels | 1080×1920 | 9:16 | 30 | H.264 | 10 Mbps | AAC 192k | 3 min (15 upload) | 4 GB |
| IG Feed | 1080×1350 | 4:5 | 30 | H.264 | 10 Mbps | AAC 192k | 60 min | 4 GB |
| IG Story | 1080×1920 | 9:16 | 30 | H.264 | 10 Mbps | AAC 192k | 60 s/card | 4 GB |
| Facebook | 1920×1080 / 1080×1350 | 16:9 / 4:5 | 30 | H.264 | 12 Mbps | AAC 192k | 240 min | 10 GB |
| Facebook Reels | 1080×1920 | 9:16 | 30 | H.264 | 10 Mbps | AAC 192k | [UNCERTAIN] | 4 GB |
| X | 1920×1080 | 16:9 | 30/60 | H.264 High | 15 Mbps (≤25) | AAC 192k | 2:20 free | 512 MB free |
| LinkedIn | 1920×1080 | 16:9 | 30 | H.264 | 15 Mbps (≤30) | AAC 192k | 10 min | 5 GB |
| Vimeo 1080p | 1920×1080 | 16:9 | native | H.264 | 20 Mbps | AAC 320k | plan | plan |
| Vimeo 4K | 3840×2160 | 16:9 | native | H.264/HEVC | 60 Mbps | AAC 320k | plan | plan |
| Spotify video | 1920×1080 | 16:9 | 24/25/30/50/60 | H.264 | **25 Mbps CBR** | AAC 192k | n/a | 60 GB |
| Snapchat | 1080×1920 | 9:16 | 30 | H.264 | 8 Mbps | AAC 192k | 60 s | 1 GB |

Max file size and length are hard platform limits. The export dialog should **warn** when an estimated file size or duration exceeds them; for example, X Free allows at most 512 MB and 140 s.

---

## 5. Codecs & containers

### 5.1 Delivery codecs

| Codec | Containers | Profiles to expose | Bit depth / chroma | Licensing | Notes |
|---|---|---|---|---|---|
| **H.264 / AVC** | MP4, MOV, MKV (WebM is not allowed) | High (8-bit 4:2:0). High 10 and High 4:2:2 are rarely needed. | 8-bit 4:2:0 for delivery | **Via LA AVC/H.264 pool**. Royalties apply to encoder and decoder products above volume thresholds. Free Internet video is royalty-free for end users (per the MPEG LA/Via LA terms). [verify current terms] | Universal compatibility. The default for every social preset. |
| **HEVC / H.265** | MP4, MOV, MKV | Main, **Main10** (HDR) | 8/10-bit, 4:2:0 (4:2:2 on RTX 50 hardware) | **Access Advance** (HEVC Advance pool). It acquired **Via LA's HEVC/VVC program** (announced 15 Dec 2025) to form "VCL Advance". Velos Media and individual licensors also hold patents. **Complex: get legal review before shipping your own software encoder.** Using the OS or GPU encoder (VideoToolbox, Media Foundation, NVENC) shifts most of the licensing to the platform or hardware vendor. [UNCERTAIN legal: consult counsel] | Best for HDR delivery to YouTube, Vimeo and Apple. |
| **AV1** | MP4, WebM, MKV | Main (8/10-bit 4:2:0) | 8/10-bit | **Royalty-free AOMedia Patent License 1.0.** Sisvel runs a separate AV1/VP9 pool targeting **device makers**, not content. AOMedia disputes it. | YouTube accepts it. Best compression. Hardware encode on RTX 40+, RX 7000+ and Intel Arc. No Apple hardware encode. |
| **VP9** | WebM, MP4, MKV | Profile 0 (8-bit); **Profile 2** (10-bit HDR) | 8/10-bit | Royalty-free (Google). Sisvel pool claims also exist. | Web/WebM export. YouTube HDR accepts it. Encoding is slow in software. |
| **VP8** | WebM | n/a | 8-bit | Royalty-free | Legacy WebRTC. Not worth exposing. |

### 5.2 Intermediate / mastering codecs

**Apple ProRes** [OFFICIAL, Apple ProRes White Paper]. Rates are approximate targets at **1920x1080, 29.97 fps**. They scale roughly with pixel count × fps, so UHD is about 4×.

| Variant | Chroma / depth | ~Mbps @1080p29.97 | ~Mbps @UHD29.97 | Use |
|---|---|---:|---:|---|
| ProRes 422 Proxy | 4:2:2 10-bit | 45 | ~182 | Proxies |
| ProRes 422 LT | 4:2:2 10-bit | 102 | ~409 | Lightweight editing |
| ProRes 422 | 4:2:2 10-bit | 147 | ~589 | Standard mezzanine |
| **ProRes 422 HQ** | 4:2:2 10-bit | **220** | ~884 | **Default master.** Vimeo and broadcast. |
| ProRes 4444 | 4:4:4(:4 alpha) up to 12-bit | 330 | ~1,326 | Graphics with alpha, VFX |
| ProRes 4444 XQ | 4:4:4(:4) up to 12-bit | **500** | ~1,989 | HDR and high-end masters |
| ProRes RAW / RAW HQ | Bayer RAW | varies | varies | Camera acquisition only (decode only) |

The UHD figures are scaled estimates [UNCERTAIN ±5%].

ProRes **encoding** is officially licensed by Apple. On Windows and Linux, third-party encoders such as FFmpeg's `prores_ks` are widely used but **not Apple-authorized** [legal note]. Apple Silicon (M1 Pro/Max and later; all M3+) has a hardware ProRes encode engine through VideoToolbox.

**Avid DNxHR** [OFFICIAL, Avid KB]. These are resolution-independent profiles.

| Profile | Chroma / depth | ~MB/s @1080p23.976 | Use |
|---|---|---:|---|
| DNxHR LB | 4:2:2 8-bit | ~4.3 MiB/s (~36 Mbps) | Offline / proxy |
| DNxHR SQ | 4:2:2 8-bit | ~13.8 MiB/s (~115 Mbps) | Standard editing |
| DNxHR HQ | 4:2:2 8-bit | ~20.8 MiB/s (~175 Mbps) | High-quality 8-bit master |
| **DNxHR HQX** | 4:2:2 **10-bit** (spec allows 12-bit) | ~20.8 MiB/s | 10-bit and HDR master (Windows-friendly ProRes alternative) |
| DNxHR 444 | 4:4:4 / RGB 10/12-bit | ~41.7 MiB/s (~350 Mbps) | VFX and finishing |

DNxHR goes in **MOV** or **MXF OP1a/OP-Atom**. A royalty-free SMPTE standard exists (VC-3, SMPTE ST 2019), but the DNxHR extensions are licensed by Avid; FFmpeg's `dnxhd` encoder covers them [UNCERTAIN on formal license status].

### 5.3 Hardware encoders (2025-2026 GPUs)

| Vendor / API | H.264 | HEVC | AV1 | VP9 | ProRes | 4:2:2 | Notes |
|---|---|---|---|---|---|---|---|
| **NVIDIA NVENC** | All since Kepler | 8-bit since Maxwell 2; 10-bit since Pascal | **RTX 40 (Ada, 8th-gen NVENC) and RTX 50 (Blackwell, 9th-gen)** | No (decode only) | No | **RTX 50: H.264 and HEVC 4:2:2 encode/decode** (Video Codec SDK 13) | GeForce has a concurrent-session cap. Use the NVIDIA support matrix as the reference. |
| **AMD AMF (VCN)** | Yes | Yes (10-bit) | **RDNA3 (RX 7000, VCN 4) and later** | No | No | No | RDNA4 (RX 9000) improves H.264 and AV1 quality. |
| **Intel QSV / oneVPL** | Yes | Yes (10-bit, plus 4:2:2/4:4:4 on some generations) | **Arc Alchemist and later, Meteor Lake, Lunar Lake and later iGPUs** | Yes (Gen11+) | No | Partial | Arc was the first consumer AV1 hardware encoder. Lunar Lake also decodes VVC. |
| **Apple VideoToolbox** | Yes | Yes (10-bit, HDR, alpha) | **No hardware AV1 encode** (M3+ decodes AV1) | No | **Yes**: hardware ProRes engine on M1 Pro/Max/Ultra, M2 Pro/Max and later, and all M3/M4/M5-class chips [UNCERTAIN for base M1/M2] | ProRes and HEVC 4:2:2 via the media engine | Omega's best path on macOS. |

### 5.4 Browser / Chromium encoding (WebCodecs & MediaRecorder)

**WebCodecs `VideoEncoder`**
- **Availability:** Chrome/Edge 94+, Firefox 130+ (desktop only), Safari 26+ (full API including AudioEncoder) [SECONDARY].
- **H.264** (`avc1.640028` and similar): Chrome uses the platform or hardware encoder, with an OpenH264 software fallback on desktop. Output is Annex B or AVC format. Safari supports it.
- **VP8 / VP9** (`vp8`, `vp09.00.10.08`, `vp09.02.10.10` for 10-bit): libvpx software in Chrome and Firefox, hardware where available.
- **AV1** (`av01.0.08M.08` and similar): Chrome desktop uses libaom/SVT software plus a hardware path where available. Firefox desktop has broad support. **Support is weak in Safari and on Android** [SECONDARY, webcodecsfundamentals.org dataset].
- **HEVC** (`hvc1.1.6.L123.B0`): **hardware-only**. Chrome 130+ on Windows, macOS and Android, Main profile only. Safari supports it.
- **Always** gate presets with `VideoEncoder.isConfigSupported()` and use fully qualified codec strings.
- **Muxing:** WebCodecs outputs raw chunks. Omega needs its own MP4/WebM muxer (e.g. mp4-muxer/webm-muxer, or Mediabunny).

**WebCodecs `AudioEncoder`**
- Opus is supported broadly. AAC is supported in Chrome on platforms with an OS encoder (Windows, macOS, ChromeOS, Android) and in Safari 26+.
- AAC encoding on Linux Chrome may be unavailable [UNCERTAIN].

**MediaRecorder**
- Chrome supports WebM (VP8/VP9/AV1 with Opus) and also records **MP4 (H.264 + AAC)** since **Chrome 126** (June 2024). Later versions added VP9, AV1 and Opus in MP4, plus HEVC options.
- Safari records MP4 with H.264 and AAC.
- Firefox records WebM only (VP8/VP9 with Opus).
- MediaRecorder runs in real time, offers poor rate control and produces variable timestamps. **Do not use it for final export.** Use it only for webcam and screen capture.

**Implication for Omega:**
- If Omega's renderer is web/Electron-based, export through **WebCodecs** with H.264 (universal) and VP9/AV1 (WebM), and HEVC only where `isConfigSupported` says yes.
- ProRes and DNxHR need a native or WASM (FFmpeg) path.

---

## 6. Color spaces

| Name | Primaries | Transfer (OETF/EOTF) | Matrix | Range | Typical use | Signaling (H.273 CICP: primaries/transfer/matrix) |
|---|---|---|---|---|---|---|
| **Rec.709** (BT.709) | BT.709 | BT.709 OETF; display **BT.1886 (gamma 2.4)** | BT.709 | Limited (16-235) | **Default SDR HD/UHD video.** Required by Spotify. | 1 / 1 / 1 |
| Rec.601 | SMPTE 170M / EBU 3213 | BT.601 | BT.601 | Limited | Legacy SD | 6 (NTSC) or 5 (PAL) / 6 / 6 |
| **sRGB** | BT.709 primaries | sRGB piecewise curve (about 2.2) | n/a (RGB) | Full | Stills, UI, web graphics. Convert to Rec.709 on import. | 1 / 13 / 0 |
| **Display P3** | DCI-P3 primaries, D65 white | sRGB curve | n/a | Full | Apple devices, iPhone SDR stills, web wide-gamut | 12 / 13 / 0 |
| DCI-P3 (theatrical) | P3, DCI white | gamma 2.6 | XYZ in DCP | n/a | DCP mastering | 11 / 17 |
| **Rec.2020** (BT.2020) SDR | BT.2020 | BT.709/BT.1886 | BT.2020 NCL | Limited | Wide-color SDR UHD (rare) | 9 / 1 (or 14/15) / 9 |
| **HDR10 / PQ** (BT.2100 PQ, SMPTE ST 2084) | BT.2020 | **PQ**, absolute, up to 10,000 nits; typically mastered at 1,000 nits | BT.2020 NCL | Limited, 10-bit | YouTube HDR, Netflix, Apple. Needs ST 2086 + MaxCLL/MaxFALL metadata. | 9 / **16** / 9 |
| **HLG** (BT.2100 HLG, ARIB STD-B67) | BT.2020 | **HLG**, relative, backward-compatible, nominal 1,000 nits | BT.2020 NCL | Limited, 10-bit | Live broadcast HDR (BBC/NHK), iPhone HDR video (HLG + Dolby Vision 8.4) | 9 / **18** / 9 |
| Dolby Vision | BT.2020 / P3-D65 mastering | PQ + dynamic metadata | | | Netflix, Apple. **Licensed by Dolby**; v1 should only pass it through. | |

**Recommended Omega working-space model:**
- **SDR:** Rec.709 / BT.1886, using a scene- or display-referred pipeline with a linear float internal working space.
- **HDR:** Rec.2100 PQ or HLG timelines in 10-bit or higher.
- **Tags:** always write color tags. In MP4/MOV that means the `colr` nclx atom. HDR exports also need the `mdcv`/`clli` boxes. Without tags, players guess (QuickTime's "gamma shift" problem).

---

## Sources

The sandbox proxy blocked direct WebFetch for many official domains. The values from those pages were obtained through search-engine extracts of the same URLs, which are listed here.

**Platform specs**
1. YouTube Help: Recommended upload encoding settings. https://support.google.com/youtube/answer/1722171
2. YouTube Help: Upload HDR videos. https://support.google.com/youtube/answer/7126552
3. YouTube Help: Upload videos longer than 15 minutes. https://support.google.com/youtube/answer/71673
4. Hootsuite: YouTube Shorts (3-minute limit). https://blog.hootsuite.com/youtube-shorts/
5. Spotify for Creators: Video specs. https://support.spotify.com/qa-en/creators/article/video-specs
6. Spotify for Creators: Publishing videos. https://support.spotify.com/qa-en/creators/article/publishing-videos
7. TikTok Ads: Auction In-Feed Ads specs. https://ads.tiktok.com/help/article/tiktok-auction-in-feed-ads
8. Fliki: TikTok video size 2026. https://fliki.ai/blog/tiktok-video-size
9. filesize.org: TikTok limits. https://filesize.org/limits/tiktok/
10. Meta: Facebook video requirements one-sheet. https://www.facebook.com/business/m/one-sheeters/video-requirements
11. Sprout Social: Social media video specs guide. https://sproutsocial.com/insights/social-media-video-specs-guide/
12. Buffer: Instagram size guide. https://buffer.com/resources/instagram-image-size/
13. Neal Schaffer: Instagram 3:4 grid change. https://nealschaffer.com/instagram-post-size/
14. Quickframe: Instagram video length. https://quickframe.com/blog/instagram-video-length
15. LinkedIn Help: Video specifications for Pages. https://www.linkedin.com/help/linkedin/answer/a1311816
16. LinkedIn: Video ads specs. https://business.linkedin.com/advertise/ads/sponsored-content/video-ads/specs
17. postfa.st: X video sizes. https://postfa.st/sizes/x/video
18. Buzzvoice: X video length limits (Free/Premium). https://buzzvoice.com/blog/how-long-can-twitter-videos-be
19. Vimeo Help: Video and audio compression guidelines. https://help.vimeo.com/hc/en-us/articles/12426043233169-Video-and-audio-compression-guidelines
20. Twitch Help: Broadcasting guidelines. https://help.twitch.tv/s/article/broadcasting-guidelines
21. bitratecalculator.org: Twitch bitrate 2026. https://bitratecalculator.org/blog/twitch-bitrate-settings-2026
22. Moda: Snapchat Spotlight size. https://moda.app/resources/sizes/snapchat-spotlight

**Delivery, audio and loudness standards**

23. Netflix: Post Production Branded Delivery Specifications. https://partnerhelp.netflixstudios.com/hc/en-us/articles/7262346654995-Post-Production-Branded-Delivery-Specifications
24. Netflix: Sound Mix Specifications & Best Practices v1.6. https://partnerhelp.netflixstudios.com/hc/en-us/articles/360001794307
25. Netflix: Near Field 2.0 Stereo Delivery Specs. https://partnerhelp.netflixstudios.com/hc/en-us/articles/23506749090323
26. Apple Podcasts for Creators: Audio requirements. https://podcasters.apple.com/support/893-audio-requirements
27. EBU R 128 (summary). https://en.wikipedia.org/wiki/EBU_R_128
28. Fora Soft: EBU R128, BS.1770 and ATSC A/85 explained. https://www.forasoft.com/learn/audio-for-video/articles-audio/loudness-normalization-ebu-r128-bs1770-atsc-a85
29. Frame.io Workflow Guide: Loudness for YouTube. https://workflow.frame.io/guide/loudness-for-youtube
30. Production Expert: Netflix loudness spec. https://www.production-expert.com/home-page/2018/8/23/has-netflix-turned-the-clock-back-10-years-or-is-their-new-loudness-delivery-spec-a-stroke-of-genius

**Video standards and color**

31. SMPTE timecode and ST 12-1 drop-frame. https://en.wikipedia.org/wiki/SMPTE_timecode
32. SMPTE ST 12-1 listing. https://standards.globalspec.com/std/1674717/smpte-st-12-1
33. DCI resolutions (4K resolution / Digital cinema). https://en.wikipedia.org/wiki/4K_resolution and https://en.wikipedia.org/wiki/Digital_cinema
34. ITU-R BT.2100 (ICC registry). https://registry.color.org/rgb-registry/bt2100
35. ITU-R Report BT.2408-6 (HDR operational practices). https://www.itu.int/dms_pub/itu-r/opb/rep/R-REP-BT.2408-6-2023-PDF-E.pdf
36. Rec.2020 / Rec.2100. https://en.wikipedia.org/wiki/Rec._2020 and https://en.wikipedia.org/wiki/Rec._2100

**Codecs and licensing**

37. Apple ProRes White Paper (April 2022). https://www.apple.com/final-cut-pro/docs/Apple_ProRes.pdf
38. Apple Support: About Apple ProRes. https://support.apple.com/en-us/102207
39. Avid KB: DNx naming scheme and data rates. https://kb.avid.com/pkb/articles/en_US/Knowledge/Avid-DNx-naming-scheme-and-data-rates
40. Access Advance: Acquisition of Via LA's HEVC/VVC program (15 Dec 2025). https://accessadvance.com/2025/12/15/access-advance-and-via-licensing-alliance-announce-hevc-vvc-program-acquisition/
41. Via LA: HEVC/VVC program. https://www.via-la.com/licensing-programs/hevc-vvc/
42. Streaming Learning Center: What the Access Advance / Via LA deal doesn't change. https://streaminglearningcenter.com/articles/what-the-access-advance-via-la-deal-doesnt-change-about-codec-adoption.html
43. Sisvel: VP9/AV1 Q&A. https://www.sisvel.com/insights/vp9-av1-q-and-a/
44. AV1 (AOMedia Patent License). https://en.wikipedia.org/wiki/AV1

**Hardware and browser encoding**

45. NVIDIA: Video Codec SDK 13.0 (Blackwell). https://developer.nvidia.com/blog/nvidia-video-codec-sdk-13-0-powered-by-nvidia-blackwell/
46. NVIDIA blog: RTX 40 Series (8th-gen NVENC, AV1). https://blogs.nvidia.com/blog/nvidia-studio-geforce-rtx-40-series/
47. Puget Systems: RTX 50 features for creators. https://www.pugetsystems.com/blog/2025/01/21/nvidia-geforce-rtx-50-series-features-for-content-creators/
48. Jellyfin docs: Intel QSV hardware acceleration. https://jellyfin.org/docs/general/post-install/transcoding/hardware-acceleration/intel/
49. Remio: NVENC vs AMF vs QuickSync vs VideoToolbox. https://remio.net/blog/hardware-encoder-comparison
50. MDN: WebCodecs codec selection. https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API/Codec_selection
51. MDN: MediaRecorder.isTypeSupported(). https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder/isTypeSupported_static
52. WebCodecs Fundamentals: Codec support dataset and 2026 analysis. https://webcodecsfundamentals.org/datasets/codec-support/ and https://webcodecsfundamentals.org/datasets/codec-analysis-2026/
53. Chrome 126 release notes (MediaRecorder MP4). https://developer.chrome.com/release-notes/126
54. blink-dev: Intent to ship MP4 container for MediaRecorder. https://groups.google.com/a/chromium.org/g/blink-dev/c/p1OMVj1FrMI
55. StaZhu: Chromium HEVC hardware encode notes. https://github.com/StaZhu/enable-chromium-hevc-hardware-decoding

### Items to re-verify before shipping

1. Exact YouTube HDR bitrates for the 720p and 1440p rows.
2. TikTok in-app file-size caps and the web 60-minute limit.
3. Instagram Reels upload length (3 vs 15 min).
4. X Premium limits.
5. LinkedIn member-post length.
6. Snapchat Spotlight maximum length.
7. Twitch Enhanced Broadcasting codecs.
8. HEVC, AVC and ProRes licensing obligations for Omega's own encoders. **Legal review required.**
9. Whether Apple ProRes hardware encode is present on base M1/M2.

---

## Recommended presets for Omega

Design notes:
- **Frame rates** are exact rationals (`"30000/1001"`). The UI shows the label.
- **Audio** defaults to 48 kHz stereo everywhere.
- **Export bitrates** are deliberately **above** each platform's minimum, because every platform re-encodes. They stay **below** hard caps such as X ≤25 Mbps and LinkedIn ≤30 Mbps.
- `"fps": "source"` means: use the project's frame rate, clamped to the platform maximum.
- `hardLimits` drive the export dialog's warnings.
- Codec availability must be checked at runtime against the native encoder and `isConfigSupported()`, falling back to software.

```json
{
  "newProjectPresets": [
    { "id": "hd1080-2398",  "group": "HD",        "name": "HD 1080p 23.976",           "width": 1920, "height": 1080, "fps": "24000/1001", "timecode": "NDF", "colorSpace": "rec709", "audio": { "sampleRate": 48000, "channels": 2 } },
    { "id": "hd1080-24",    "group": "HD",        "name": "HD 1080p 24",               "width": 1920, "height": 1080, "fps": "24/1",       "timecode": "NDF", "colorSpace": "rec709", "audio": { "sampleRate": 48000, "channels": 2 } },
    { "id": "hd1080-25",    "group": "HD",        "name": "HD 1080p 25 (PAL)",         "width": 1920, "height": 1080, "fps": "25/1",       "timecode": "NDF", "colorSpace": "rec709", "audio": { "sampleRate": 48000, "channels": 2 } },
    { "id": "hd1080-2997",  "group": "HD",        "name": "HD 1080p 29.97 (NTSC)",     "width": 1920, "height": 1080, "fps": "30000/1001", "timecode": "DF",  "colorSpace": "rec709", "audio": { "sampleRate": 48000, "channels": 2 } },
    { "id": "hd1080-30",    "group": "HD",        "name": "HD 1080p 30",               "width": 1920, "height": 1080, "fps": "30/1",       "timecode": "NDF", "colorSpace": "rec709", "audio": { "sampleRate": 48000, "channels": 2 } },
    { "id": "hd1080-50",    "group": "HD",        "name": "HD 1080p 50",               "width": 1920, "height": 1080, "fps": "50/1",       "timecode": "NDF", "colorSpace": "rec709", "audio": { "sampleRate": 48000, "channels": 2 } },
    { "id": "hd1080-5994",  "group": "HD",        "name": "HD 1080p 59.94",            "width": 1920, "height": 1080, "fps": "60000/1001", "timecode": "DF",  "colorSpace": "rec709", "audio": { "sampleRate": 48000, "channels": 2 } },
    { "id": "hd1080-60",    "group": "HD",        "name": "HD 1080p 60",               "width": 1920, "height": 1080, "fps": "60/1",       "timecode": "NDF", "colorSpace": "rec709", "audio": { "sampleRate": 48000, "channels": 2 } },
    { "id": "hd720-30",     "group": "HD",        "name": "HD 720p 30",                "width": 1280, "height": 720,  "fps": "30/1",       "timecode": "NDF", "colorSpace": "rec709", "audio": { "sampleRate": 48000, "channels": 2 } },
    { "id": "qhd1440-30",   "group": "HD",        "name": "QHD 1440p 30",              "width": 2560, "height": 1440, "fps": "30/1",       "timecode": "NDF", "colorSpace": "rec709", "audio": { "sampleRate": 48000, "channels": 2 } },
    { "id": "qhd1440-60",   "group": "HD",        "name": "QHD 1440p 60 (Gaming)",     "width": 2560, "height": 1440, "fps": "60/1",       "timecode": "NDF", "colorSpace": "rec709", "audio": { "sampleRate": 48000, "channels": 2 } },
    { "id": "uhd-2398",     "group": "4K",        "name": "UHD 4K 23.976",             "width": 3840, "height": 2160, "fps": "24000/1001", "timecode": "NDF", "colorSpace": "rec709", "audio": { "sampleRate": 48000, "channels": 2 } },
    { "id": "uhd-25",       "group": "4K",        "name": "UHD 4K 25",                 "width": 3840, "height": 2160, "fps": "25/1",       "timecode": "NDF", "colorSpace": "rec709", "audio": { "sampleRate": 48000, "channels": 2 } },
    { "id": "uhd-2997",     "group": "4K",        "name": "UHD 4K 29.97",              "width": 3840, "height": 2160, "fps": "30000/1001", "timecode": "DF",  "colorSpace": "rec709", "audio": { "sampleRate": 48000, "channels": 2 } },
    { "id": "uhd-30",       "group": "4K",        "name": "UHD 4K 30",                 "width": 3840, "height": 2160, "fps": "30/1",       "timecode": "NDF", "colorSpace": "rec709", "audio": { "sampleRate": 48000, "channels": 2 } },
    { "id": "uhd-60",       "group": "4K",        "name": "UHD 4K 60",                 "width": 3840, "height": 2160, "fps": "60/1",       "timecode": "NDF", "colorSpace": "rec709", "audio": { "sampleRate": 48000, "channels": 2 } },
    { "id": "uhd-hdr-pq-2398", "group": "HDR",    "name": "UHD 4K HDR10 (PQ) 23.976",  "width": 3840, "height": 2160, "fps": "24000/1001", "timecode": "NDF", "colorSpace": "rec2100-pq",  "bitDepth": 10, "audio": { "sampleRate": 48000, "channels": 2 } },
    { "id": "uhd-hdr-hlg-2997", "group": "HDR",   "name": "UHD 4K HDR (HLG) 29.97",    "width": 3840, "height": 2160, "fps": "30000/1001", "timecode": "DF",  "colorSpace": "rec2100-hlg", "bitDepth": 10, "audio": { "sampleRate": 48000, "channels": 2 } },
    { "id": "dci4k-24",     "group": "Cinema",    "name": "DCI 4K 24",                 "width": 4096, "height": 2160, "fps": "24/1",       "timecode": "NDF", "colorSpace": "rec709", "audio": { "sampleRate": 48000, "channels": 6 } },
    { "id": "dci2k-24",     "group": "Cinema",    "name": "DCI 2K 24",                 "width": 2048, "height": 1080, "fps": "24/1",       "timecode": "NDF", "colorSpace": "rec709", "audio": { "sampleRate": 48000, "channels": 6 } },
    { "id": "scope-uhd-24", "group": "Cinema",    "name": "Cinemascope 2.39:1 UHD 24", "width": 3840, "height": 1608, "fps": "24/1",       "timecode": "NDF", "colorSpace": "rec709", "audio": { "sampleRate": 48000, "channels": 2 } },
    { "id": "uw-2560-60",   "group": "Cinema",    "name": "Ultrawide 21:9 1080p 60",   "width": 2560, "height": 1080, "fps": "60/1",       "timecode": "NDF", "colorSpace": "rec709", "audio": { "sampleRate": 48000, "channels": 2 } },
    { "id": "uhd8k-30",     "group": "8K",        "name": "8K UHD 30",                 "width": 7680, "height": 4320, "fps": "30/1",       "timecode": "NDF", "colorSpace": "rec709", "audio": { "sampleRate": 48000, "channels": 2 } },
    { "id": "vert-1080-30", "group": "Social",    "name": "Vertical 9:16 1080x1920 30","width": 1080, "height": 1920, "fps": "30/1",       "timecode": "NDF", "colorSpace": "rec709", "audio": { "sampleRate": 48000, "channels": 2 } },
    { "id": "vert-1080-60", "group": "Social",    "name": "Vertical 9:16 1080x1920 60","width": 1080, "height": 1920, "fps": "60/1",       "timecode": "NDF", "colorSpace": "rec709", "audio": { "sampleRate": 48000, "channels": 2 } },
    { "id": "vert-4k-30",   "group": "Social",    "name": "Vertical 9:16 4K 30",       "width": 2160, "height": 3840, "fps": "30/1",       "timecode": "NDF", "colorSpace": "rec709", "audio": { "sampleRate": 48000, "channels": 2 } },
    { "id": "square-1080-30","group": "Social",   "name": "Square 1:1 1080 30",        "width": 1080, "height": 1080, "fps": "30/1",       "timecode": "NDF", "colorSpace": "rec709", "audio": { "sampleRate": 48000, "channels": 2 } },
    { "id": "portrait-4x5-30","group": "Social",  "name": "Portrait 4:5 1080x1350 30", "width": 1080, "height": 1350, "fps": "30/1",       "timecode": "NDF", "colorSpace": "rec709", "audio": { "sampleRate": 48000, "channels": 2 } },
    { "id": "portrait-3x4-30","group": "Social",  "name": "Portrait 3:4 1080x1440 30", "width": 1080, "height": 1440, "fps": "30/1",       "timecode": "NDF", "colorSpace": "rec709", "audio": { "sampleRate": 48000, "channels": 2 } },
    { "id": "sd-ntsc",      "group": "Legacy",    "name": "SD NTSC 720x480 29.97 (16:9 anamorphic)", "width": 720, "height": 480, "pixelAspect": "40/33", "fps": "30000/1001", "timecode": "DF", "colorSpace": "rec601-ntsc", "audio": { "sampleRate": 48000, "channels": 2 } },
    { "id": "sd-pal",       "group": "Legacy",    "name": "SD PAL 720x576 25 (16:9 anamorphic)",     "width": 720, "height": 576, "pixelAspect": "16/11", "fps": "25/1",       "timecode": "NDF", "colorSpace": "rec601-pal", "audio": { "sampleRate": 48000, "channels": 2 } }
  ],

  "exportPresets": [
    { "id": "yt-1080",       "name": "YouTube 1080p",            "width": 1920, "height": 1080, "fps": "source", "container": "mp4", "codec": "h264-high",  "rateControl": "vbr", "bitrateKbps": 16000, "bitrateKbpsHfr": 24000, "gop": "half-fps-closed", "colorSpace": "rec709",
      "audio": { "codec": "aac-lc", "sampleRate": 48000, "channels": 2, "bitrateKbps": 384, "loudnessLufs": -14, "truePeakDbtp": -1 }, "hardLimits": { "maxDurationSec": 43200, "maxBytes": 274877906944, "maxFps": 60 } },
    { "id": "yt-1440",       "name": "YouTube 1440p",            "width": 2560, "height": 1440, "fps": "source", "container": "mp4", "codec": "h264-high",  "rateControl": "vbr", "bitrateKbps": 32000, "bitrateKbpsHfr": 48000, "colorSpace": "rec709",
      "audio": { "codec": "aac-lc", "sampleRate": 48000, "channels": 2, "bitrateKbps": 384, "loudnessLufs": -14, "truePeakDbtp": -1 }, "hardLimits": { "maxDurationSec": 43200, "maxBytes": 274877906944, "maxFps": 60 } },
    { "id": "yt-4k",         "name": "YouTube 4K",               "width": 3840, "height": 2160, "fps": "source", "container": "mp4", "codec": "h264-high",  "altCodec": "hevc-main", "rateControl": "vbr", "bitrateKbps": 60000, "bitrateKbpsHfr": 85000, "colorSpace": "rec709",
      "audio": { "codec": "aac-lc", "sampleRate": 48000, "channels": 2, "bitrateKbps": 384, "loudnessLufs": -14, "truePeakDbtp": -1 }, "hardLimits": { "maxDurationSec": 43200, "maxBytes": 274877906944, "maxFps": 60 } },
    { "id": "yt-4k-hdr",     "name": "YouTube 4K HDR (HDR10/PQ)","width": 3840, "height": 2160, "fps": "source", "container": "mp4", "codec": "hevc-main10", "altCodec": "av1-main10", "rateControl": "vbr", "bitrateKbps": 70000, "bitrateKbpsHfr": 100000, "colorSpace": "rec2100-pq", "bitDepth": 10, "hdrMetadata": ["st2086", "maxcll", "maxfall"],
      "audio": { "codec": "aac-lc", "sampleRate": 48000, "channels": 2, "bitrateKbps": 384, "loudnessLufs": -14, "truePeakDbtp": -1 }, "hardLimits": { "maxDurationSec": 43200, "maxBytes": 274877906944, "maxFps": 60 } },
    { "id": "yt-shorts",     "name": "YouTube Shorts",           "width": 1080, "height": 1920, "fps": "source", "container": "mp4", "codec": "h264-high",  "rateControl": "vbr", "bitrateKbps": 16000, "colorSpace": "rec709",
      "audio": { "codec": "aac-lc", "sampleRate": 48000, "channels": 2, "bitrateKbps": 384, "loudnessLufs": -14, "truePeakDbtp": -1 }, "hardLimits": { "maxDurationSec": 180, "maxFps": 60 } },
    { "id": "tiktok",        "name": "TikTok",                   "width": 1080, "height": 1920, "fps": "30/1",   "container": "mp4", "codec": "h264-high",  "rateControl": "vbr", "bitrateKbps": 12000, "colorSpace": "rec709",
      "audio": { "codec": "aac-lc", "sampleRate": 48000, "channels": 2, "bitrateKbps": 192, "loudnessLufs": -14, "truePeakDbtp": -1 }, "hardLimits": { "maxDurationSec": 600, "maxBytes": 10737418240, "maxFps": 60, "note": "Mobile in-app caps are much lower (about 287 MB iOS, 72 MB Android). Web allows up to 60 min. [UNCERTAIN]" } },
    { "id": "ig-reels",      "name": "Instagram Reels",          "width": 1080, "height": 1920, "fps": "30/1",   "container": "mp4", "codec": "h264-high",  "rateControl": "vbr", "bitrateKbps": 10000, "colorSpace": "rec709",
      "audio": { "codec": "aac-lc", "sampleRate": 48000, "channels": 2, "bitrateKbps": 192, "loudnessLufs": -14, "truePeakDbtp": -1 }, "hardLimits": { "maxDurationSec": 180, "maxBytes": 4294967296, "maxFps": 60, "note": "Up to 15 min reported for uploads [UNCERTAIN]" } },
    { "id": "ig-feed-4x5",   "name": "Instagram Feed 4:5",       "width": 1080, "height": 1350, "fps": "30/1",   "container": "mp4", "codec": "h264-high",  "rateControl": "vbr", "bitrateKbps": 10000, "colorSpace": "rec709",
      "audio": { "codec": "aac-lc", "sampleRate": 48000, "channels": 2, "bitrateKbps": 192, "loudnessLufs": -14, "truePeakDbtp": -1 }, "hardLimits": { "maxDurationSec": 3600, "maxBytes": 4294967296, "maxFps": 60 } },
    { "id": "ig-story",      "name": "Instagram Story",          "width": 1080, "height": 1920, "fps": "30/1",   "container": "mp4", "codec": "h264-high",  "rateControl": "vbr", "bitrateKbps": 10000, "colorSpace": "rec709",
      "audio": { "codec": "aac-lc", "sampleRate": 48000, "channels": 2, "bitrateKbps": 192, "loudnessLufs": -14, "truePeakDbtp": -1 }, "hardLimits": { "maxDurationSec": 60, "maxBytes": 4294967296, "maxFps": 60 } },
    { "id": "fb-landscape",  "name": "Facebook 1080p",           "width": 1920, "height": 1080, "fps": "30/1",   "container": "mp4", "codec": "h264-high",  "rateControl": "vbr", "bitrateKbps": 12000, "colorSpace": "rec709",
      "audio": { "codec": "aac-lc", "sampleRate": 48000, "channels": 2, "bitrateKbps": 192, "loudnessLufs": -14, "truePeakDbtp": -1 }, "hardLimits": { "maxDurationSec": 14400, "maxBytes": 10737418240, "maxFps": 60 } },
    { "id": "fb-feed-4x5",   "name": "Facebook Feed 4:5",        "width": 1080, "height": 1350, "fps": "30/1",   "container": "mp4", "codec": "h264-high",  "rateControl": "vbr", "bitrateKbps": 10000, "colorSpace": "rec709",
      "audio": { "codec": "aac-lc", "sampleRate": 48000, "channels": 2, "bitrateKbps": 192, "loudnessLufs": -14, "truePeakDbtp": -1 }, "hardLimits": { "maxDurationSec": 14400, "maxBytes": 10737418240, "maxFps": 60 } },
    { "id": "fb-reels",      "name": "Facebook Reels",           "width": 1080, "height": 1920, "fps": "30/1",   "container": "mp4", "codec": "h264-high",  "rateControl": "vbr", "bitrateKbps": 10000, "colorSpace": "rec709",
      "audio": { "codec": "aac-lc", "sampleRate": 48000, "channels": 2, "bitrateKbps": 192, "loudnessLufs": -14, "truePeakDbtp": -1 }, "hardLimits": { "maxBytes": 4294967296, "maxFps": 60 } },
    { "id": "x-1080",        "name": "X (Twitter) 1080p",        "width": 1920, "height": 1080, "fps": "30/1",   "container": "mp4", "codec": "h264-high",  "rateControl": "vbr", "bitrateKbps": 15000, "maxBitrateKbps": 25000, "colorSpace": "rec709",
      "audio": { "codec": "aac-lc", "sampleRate": 48000, "channels": 2, "bitrateKbps": 192, "loudnessLufs": -14, "truePeakDbtp": -1 }, "hardLimits": { "maxDurationSec": 140, "maxBytes": 536870912, "maxFps": 60, "note": "Free-tier limits. Premium allows hours and GBs. [UNCERTAIN]" } },
    { "id": "x-vertical",    "name": "X (Twitter) Vertical",     "width": 1080, "height": 1920, "fps": "30/1",   "container": "mp4", "codec": "h264-high",  "rateControl": "vbr", "bitrateKbps": 15000, "maxBitrateKbps": 25000, "colorSpace": "rec709",
      "audio": { "codec": "aac-lc", "sampleRate": 48000, "channels": 2, "bitrateKbps": 192, "loudnessLufs": -14, "truePeakDbtp": -1 }, "hardLimits": { "maxDurationSec": 140, "maxBytes": 536870912, "maxFps": 60 } },
    { "id": "linkedin-1080", "name": "LinkedIn 1080p",           "width": 1920, "height": 1080, "fps": "30/1",   "container": "mp4", "codec": "h264-high",  "rateControl": "vbr", "bitrateKbps": 15000, "maxBitrateKbps": 30000, "colorSpace": "rec709",
      "audio": { "codec": "aac-lc", "sampleRate": 48000, "channels": 2, "bitrateKbps": 192, "loudnessLufs": -14, "truePeakDbtp": -1 }, "hardLimits": { "maxDurationSec": 600, "maxBytes": 5368709120, "maxFps": 60 } },
    { "id": "linkedin-square","name": "LinkedIn Square",         "width": 1080, "height": 1080, "fps": "30/1",   "container": "mp4", "codec": "h264-high",  "rateControl": "vbr", "bitrateKbps": 10000, "maxBitrateKbps": 30000, "colorSpace": "rec709",
      "audio": { "codec": "aac-lc", "sampleRate": 48000, "channels": 2, "bitrateKbps": 192, "loudnessLufs": -14, "truePeakDbtp": -1 }, "hardLimits": { "maxDurationSec": 600, "maxBytes": 5368709120, "maxFps": 60 } },
    { "id": "vimeo-1080",    "name": "Vimeo 1080p",              "width": 1920, "height": 1080, "fps": "source", "container": "mp4", "codec": "h264-high",  "rateControl": "vbr", "bitrateKbps": 20000, "colorSpace": "rec709",
      "audio": { "codec": "aac-lc", "sampleRate": 48000, "channels": 2, "bitrateKbps": 320, "loudnessLufs": -14, "truePeakDbtp": -1 } },
    { "id": "vimeo-4k",      "name": "Vimeo 4K",                 "width": 3840, "height": 2160, "fps": "source", "container": "mp4", "codec": "h264-high",  "altCodec": "hevc-main", "rateControl": "vbr", "bitrateKbps": 60000, "colorSpace": "rec709",
      "audio": { "codec": "aac-lc", "sampleRate": 48000, "channels": 2, "bitrateKbps": 320, "loudnessLufs": -14, "truePeakDbtp": -1 } },
    { "id": "spotify-video", "name": "Spotify Video Podcast",    "width": 1920, "height": 1080, "fps": "source", "allowedFps": ["24/1", "25/1", "30/1", "50/1", "60/1"], "container": "mp4", "codec": "h264-high", "rateControl": "cbr", "bitrateKbps": 25000, "keyframeIntervalSec": 1, "colorSpace": "rec709",
      "audio": { "codec": "aac-lc", "sampleRate": 48000, "channels": 2, "bitrateKbps": 192, "loudnessLufs": -14, "truePeakDbtp": -1 }, "hardLimits": { "maxBytes": 64424509440 } },
    { "id": "podcast-audio", "name": "Podcast Audio (Apple/Spotify)", "width": null, "height": null, "fps": null, "container": "m4a", "codec": null, "bitrateKbps": null, "colorSpace": null,
      "audio": { "codec": "aac-lc", "sampleRate": 48000, "channels": 2, "bitrateKbps": 192, "loudnessLufs": -16, "truePeakDbtp": -1 } },
    { "id": "snapchat",      "name": "Snapchat Spotlight",       "width": 1080, "height": 1920, "fps": "30/1",   "container": "mp4", "codec": "h264-high",  "rateControl": "vbr", "bitrateKbps": 8000, "colorSpace": "rec709",
      "audio": { "codec": "aac-lc", "sampleRate": 48000, "channels": 2, "bitrateKbps": 192, "loudnessLufs": -14, "truePeakDbtp": -1 }, "hardLimits": { "maxDurationSec": 60, "maxBytes": 1073741824, "note": "Maximum length may be longer in newer app versions [UNCERTAIN]" } },
    { "id": "web-av1",       "name": "Web AV1 (WebM)",           "width": 1920, "height": 1080, "fps": "source", "container": "webm", "codec": "av1-main",  "rateControl": "vbr", "bitrateKbps": 6000, "colorSpace": "rec709",
      "audio": { "codec": "opus", "sampleRate": 48000, "channels": 2, "bitrateKbps": 160, "loudnessLufs": -14, "truePeakDbtp": -1 } },
    { "id": "web-vp9",       "name": "Web VP9 (WebM)",           "width": 1920, "height": 1080, "fps": "source", "container": "webm", "codec": "vp9-profile0", "rateControl": "vbr", "bitrateKbps": 8000, "colorSpace": "rec709",
      "audio": { "codec": "opus", "sampleRate": 48000, "channels": 2, "bitrateKbps": 160, "loudnessLufs": -14, "truePeakDbtp": -1 } },
    { "id": "master-prores-hq",   "name": "Master ProRes 422 HQ",   "width": "source", "height": "source", "fps": "source", "container": "mov", "codec": "prores-422-hq",   "bitrateKbps": 220000, "bitrateNote": "Approximate target at 1080p29.97; scales with resolution and fps", "colorSpace": "source",
      "audio": { "codec": "pcm-s24le", "sampleRate": 48000, "channels": "source", "bitrateKbps": null } },
    { "id": "master-prores-4444", "name": "Master ProRes 4444 (alpha)", "width": "source", "height": "source", "fps": "source", "container": "mov", "codec": "prores-4444", "bitrateKbps": 330000, "colorSpace": "source", "alpha": true,
      "audio": { "codec": "pcm-s24le", "sampleRate": 48000, "channels": "source", "bitrateKbps": null } },
    { "id": "master-dnxhr-hqx",   "name": "Master DNxHR HQX 10-bit",  "width": "source", "height": "source", "fps": "source", "container": "mxf",  "altContainer": "mov", "codec": "dnxhr-hqx", "bitrateKbps": 175000, "bitrateNote": "About 20.8 MiB/s at 1080p23.976", "colorSpace": "source",
      "audio": { "codec": "pcm-s24le", "sampleRate": 48000, "channels": "source", "bitrateKbps": null } },
    { "id": "broadcast-ebu",      "name": "Broadcast EU (EBU R128) 1080p25", "width": 1920, "height": 1080, "fps": "25/1",       "container": "mov", "codec": "prores-422-hq", "bitrateKbps": 184000, "colorSpace": "rec709",
      "audio": { "codec": "pcm-s24le", "sampleRate": 48000, "channels": 2, "bitrateKbps": null, "loudnessLufs": -23, "truePeakDbtp": -1 } },
    { "id": "broadcast-atsc",     "name": "Broadcast US (ATSC A/85) 1080p29.97 DF", "width": 1920, "height": 1080, "fps": "30000/1001", "timecode": "DF", "container": "mov", "codec": "prores-422-hq", "bitrateKbps": 220000, "colorSpace": "rec709",
      "audio": { "codec": "pcm-s24le", "sampleRate": 48000, "channels": 2, "bitrateKbps": null, "loudnessLufs": -24, "truePeakDbtp": -2 } },
    { "id": "streaming-mezz-uhd", "name": "Streaming Mezzanine UHD (Netflix-style, pre-IMF)", "width": 3840, "height": 2160, "fps": "source", "container": "mov", "codec": "prores-4444-xq", "bitrateKbps": 2000000, "bitrateNote": "About 4x the 1080p 500 Mbps rate", "colorSpace": "source",
      "audio": { "codec": "pcm-s24le", "sampleRate": 48000, "channels": "source", "bitrateKbps": null, "loudnessLufs": -27, "loudnessGating": "dialog", "truePeakDbtp": -2 } }
  ]
}
```
