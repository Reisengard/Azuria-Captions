# Video Captions MVP

Video Captions turns a local video and optional timed transcript into an edited, captioned MP4. Processing stays in the browser: JIZURA does not upload the video, transcript, project, or rendered output. Browser extensions, operating-system file providers, and downloaded fonts remain subject to their own privacy behavior.

## Supported workflow

1. Open **Video Captions** in the latest desktop Chrome or Edge.
2. Choose one SDR H.264 MP4. AAC audio is preserved; a silent H.264 MP4 is also supported.
3. Import word-timestamp JSON for precise active-word timing, or SRT/VTT for estimated segment timing.
4. Correct words, split or merge captions, set emphasis, and adjust style, density, position, or text direction.
5. Inspect accessibility warnings, preview the complete video, and save the JIZURA project.
6. Choose **Export**. JIZURA writes a 30 fps H.264 MP4 at the selected post format. Uncut video preserves compatible original AAC audio; trimmed video decodes, cuts, and re-encodes audio as AAC.

## Video editing

Open **Video editing** below the preview. Choose a post format: YouTube Shorts or Instagram Reels/Stories (1080×1920), YouTube landscape (1920×1080), square (1080×1080), or portrait post (1080×1350). These are convenient presets, not guarantees about a platform's upload limits. YouTube accepts [square or vertical Shorts](https://support.google.com/youtube/answer/15424877).

- **Trim & cut:** adjust the start/end of kept sections, or remove a time range. Sections remain in source order and gaps disappear in the exported video. Restore full video clears cuts.
- **Crop & rearrange:** start with stacked panels or picture in picture. Select a panel and drag a crop rectangle on the source. Drag its output panel to reposition it, or enter crop and placement percentages for precise resizing. Panels fill their destination without stretching; later panels appear above earlier ones. Layouts apply throughout the video.
- **Extra captions & notes:** add independently timed text, with position, size, and color. Multiple notes can coexist with the animated subtitle sequence. Notes use static outlined text.
- Choose **Apply video edits** to update the main preview and export. Editing controls show a draft until applied. Applied changes use the project's Undo/Redo history and are included when saving.

All editing times and the timeline refer to the original source, including note and subtitle times. Playback skips removed sections; paused scrubbing can still inspect the original footage. Output duration is shown in the editing panel. The source file is never modified, and a transcript is not required to save or export a video edit.

The export capability is checked before encoding begins. Long exports require browser support for writing directly to a chosen file. Short fixtures may use the guarded in-memory download path.

## Timing quality

- **Word timing** means each token has its own start and end time. Active-word highlighting follows those boundaries.
- **Estimated timing** means SRT/VTT cue timing was distributed across its words. It is useful for ordinary captions but is not a claim of speech-accurate word alignment.

## Saving and relinking

A project stores the transcript, caption segments, deterministic visual plans, manual overrides, locks, style, seed, and a source fingerprint. It deliberately does not embed the source video. After reopening a project, choose the original video when prompted. JIZURA warns and refuses to continue when the fingerprint does not match.

## Diagnostics and recovery

- Unsupported source: convert it to SDR H.264 video with AAC audio in an MP4 container.
- H.264 output unavailable: use the latest desktop Chrome or Edge and update graphics drivers.
- Memory or write failure: close memory-heavy tabs and use a browser that offers a file-backed save location.
- Missing audio: JIZURA fails instead of silently producing a muted export when compatible source audio was expected.
- Static safety fallback: shorten the caption or reduce motion/intensity and replan it.
- Font fallback: check the network connection or choose another font. System fallback text remains available.
- Browser capability details are available through JIZURA's media diagnostics; support is decided from codec/API probes, not browser-name detection.

## Scope and non-goals

This MVP does not perform automatic transcription, translation, speaker detection, face tracking, speed changes, combining multiple source files, animated crop keyframes, HDR mastering, mobile high-resolution export, cloud storage, collaboration, or Live Captions output. The new video-edit controls are currently labeled in English across editions.

JIZURA's MIT license and bundled dependency licenses cover the software only. They do not grant rights to any video, audio, lyrics, transcript, font, trademark, or other asset you import. You are responsible for having the necessary rights to use and publish those materials.

## Release verification

Automated tests cover project migration, deterministic planning and locks, caption-safe visual snapshots, preview clock behavior, codec rejection, 24/60-to-30 fps timeline normalization contracts, AAC timestamps/duration, cancellation, cleanup paths, and Lyric Motion compatibility.

Before publishing a release, complete [the release-candidate checklist](VIDEO_CAPTIONS_RELEASE_CHECKLIST.md) in a clean checkout and fresh Chrome profile. Record actual hardware, browser/OS versions, fixture hashes, export time, and memory observations. No universal speed or memory claim is made.
