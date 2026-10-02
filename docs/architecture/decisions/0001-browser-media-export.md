# ADR 0001: Browser media pipeline for Video Captions

- Status: accepted for MVP implementation
- Date: 2026-09-27
- Scope: supported SDR H.264/AAC MP4 inputs in latest desktop Chromium

## Decision

Use a timestamp-driven demux/decode/compose/encode pipeline for production export:

1. Pin Mediabunny `1.60.0` as the caption media adapter and add its MPL-2.0 license to third-party notices when the dependency is introduced.
2. Demux the selected MP4 into encoded video and audio packets.
3. Feed video packets to `VideoDecoder` in decode order and select source frames by presentation timestamp for a constant 30 fps output timeline.
4. Draw the selected source frame and frozen JIZURA caption plan to a Canvas or `OffscreenCanvas`.
5. Encode composited frames with `VideoEncoder` using the capability-gated H.264 configuration.
6. Pass through original AAC packets when the source is untrimmed and packet timestamps/configuration are compatible. Decode and re-encode audio only as an explicit fallback, with the fallback reported to the user.
7. Mux with Mediabunny using writer backpressure and a file-backed target where available. Retain the existing PNG-sequence fallback when H.264 export is unavailable.

Do not use repeated `HTMLVideoElement.currentTime` seeks as the production frame source. Keep the video element as the interactive preview clock only.

Mediabunny is selected over adding MP4Box.js because it provides the required MP4 demuxer, WebCodecs sample/packet abstractions, encoded-audio packet passthrough, backpressure-aware writer, and MP4 muxer behind one adapter. It is also the stated successor to the repository's existing, now-deprecated `mp4-muxer`. The dependency remains isolated behind JIZURA media adapter modules so it can be replaced without affecting project, planner, renderer, or editor contracts.

Primary references:

- [mp4-muxer deprecation notice](https://github.com/Vanilagy/mp4-muxer/blob/main/README.md)
- [Mediabunny media sources and encoded-packet APIs](https://mediabunny.dev/guide/media-sources)
- [Mediabunny API reference](https://mediabunny.dev/api/)
- [W3C WebCodecs MP4 decoding sample](https://github.com/w3c/webcodecs/tree/main/samples/video-decode-display)

## Spike evidence

The disposable spike is `dev/media_spike.html` plus `dev/media_spike.js` (removed after the gate; see git history). It uses the generated 15-second portrait fixture and deliberately simple code:

- source: 1080×1920, H.264/AAC MP4, 30 fps, 15 seconds;
- source frames: exact-time `HTMLVideoElement` seeks;
- composition: Canvas source frame plus a fixed timestamped overlay;
- output: WebCodecs H.264 and AAC, muxed by the repository's existing `mp4-muxer`;
- verification: FFprobe over the locally captured browser output.

Observed on this Windows development host in a normal Chromium session:

- 450 requested and 450 encoded video frames;
- H.264 High profile, yuv420p, 1080×1920, 30/1 fps;
- video starts at 0 and is exactly 15.000 seconds;
- AAC-LC mono, 48 kHz, starts at 0 and is 15.018667 seconds;
- final MP4 duration: 15.018667 seconds;
- output size: 14,900,418 bytes;
- elapsed export time: 85.745 seconds, or 5.716× source duration;
- naive three-minute extrapolation: about 17 minutes, before memory pressure or thermal throttling.

The 18.7 ms AAC tail is normal encoder-frame padding and remains under one 30 fps video frame. This run decoded and re-encoded AAC, so it proves synchronized audio output but not lossless passthrough. Packet passthrough must be verified with Mediabunny in the production media slice.

The seek prototype is too slow and its complexity grows poorly because later seeks repeatedly decode from earlier keyframes. A prior headless attempt did not finish inside ten minutes. This strengthens the decision to decode each source packet once in presentation order.

## Capability and failure behavior

Capability checks must test configurations, not browser names:

- `VideoDecoder.isConfigSupported()` for the demuxed source configuration;
- `VideoEncoder.isConfigSupported()` for the selected H.264 output profile and dimensions;
- audio packet compatibility for passthrough, otherwise `AudioDecoder` and `AudioEncoder` support;
- file-backed streaming availability and memory-safe fallback;
- worker and `OffscreenCanvas` availability when the production path uses them.

If H.264 encoding is unavailable, disable MP4 export before work begins and offer the existing PNG-sequence path with actionable Chrome/Edge guidance. If AAC passthrough is incompatible but AAC encoding is available, re-encode and disclose that choice. If neither passthrough nor encoding is available, do not emit a silent file: offer video-only export plus a separate WAV soundtrack.

This host also showed environment-specific browser behavior: installed Chrome crashed its GPU process in headless mode, Edge headless did not complete the WebCodecs job, while the normal Chromium session completed. Automated headless success must therefore not be used as the sole capability signal or release criterion.

## Consequences

- Caption export gains deterministic source-frame handling and can normalize VFR inputs to 30 fps.
- Original AAC can remain bit-for-bit encoded data when passthrough preconditions hold.
- The caption path introduces a pinned MPL-2.0 dependency and must update notices before merging that dependency.
- The existing lyric exporter is unchanged during the caption prototype; migration away from deprecated `mp4-muxer` should be a separate, regression-tested shared-engine change.
- Production tests must cover B-frames, VFR selection, AAC priming/padding, cancellation, decoder/encoder backpressure, file cleanup, and three-minute memory behavior.

## Re-verification (2026-09-28, delta plan step 8)

The decision held on real browsers with the production pipeline (Mediabunny demux → WebCodecs decode → caption compositor → WebCodecs H.264 → Mediabunny mux), after the tracks / boxes / roles / text-block refactor:

- **Google Chrome 154.0.8037.58** (headless, and headed with the window minimized during each export) and **Microsoft Edge 153.0.4234.48** (headless), each with a fresh profile, on Windows 11 with an RTX 3050: 7 of 7 scenarios passed in every run (portrait / landscape / 24 fps / 60 fps / silent / trimmed / 3-minute; Shorts, Reels, YouTube 16:9, Square, 4:5).
- Exact frame counts (⌈duration × 30⌉, decoded by FFprobe), 30/1 fps, start at 0, H.264 Constrained Baseline. **AAC passthrough is bit-exact** when the video is untrimmed (FFmpeg packet MD5 equal to the source); trimmed exports re-encode AAC as designed.
- Speed is about 0.17–0.24× real time (3 minutes in about 30 s), far better than the seek-based spike (5.7×). The JS heap stays under about 50 MB, and repeated exports do not grow it.
- The earlier note "installed Chrome crashed its GPU process in headless mode; Edge headless did not complete" **no longer reproduces** with these versions and the production pipeline. Headless results matched headed results, but the release criterion stays a real browser run.
- An export keeps running while the page is hidden (window minimized). Import and preview do not: Chrome defers `<video>` loading in hidden pages until they are shown.
- One defect was found and fixed: float rounding of trimmed durations added a near-zero-length frame.

Tool: `dev/export_chrome_check.js` (`npm run check:export-chrome` in `dev/`). Evidence and the supported/fallback path are recorded in `docs/VIDEO_CAPTIONS_RELEASE_CHECKLIST.md`.

**Fallback, as implemented** (supersedes "offer the existing PNG-sequence path" above, which only exists for Lyric Motion): when H.264 encoding is unavailable, export stops before any work with `MEDIA_ENCODER_UNSUPPORTED`, and the recovery text sends the user to Chrome/Edge or to another computer with the saved project and a relink. There is no second caption encoder. Sources over 30 s or 128 MB need the file-backed save (`showSaveFilePicker`); elsewhere `MEDIA_FILE_SAVE_REQUIRED` is raised up front. A sidecar SRT/VTT export is the planned encoder-free fallback.
