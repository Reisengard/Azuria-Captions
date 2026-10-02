# Azuria Sub — Captions & Subtitles for Short-Form Video

**Azuria Sub** turns a local video and an optional timed transcript into an edited, captioned MP4, entirely in your browser. It is built for short-form video (Shorts, Reels, Stories, square and portrait posts): import a clip, get your words on screen, style them, sync them by hand or by ear, and export a finished 30 fps H.264 file.

> Azuria Sub is derived from [**JIZURA**](https://github.com/852wa/JIZURA) by hakoniwa (MIT License). See [Origin and licensing](#origin-and-licensing).

Nothing is uploaded. The video, transcript, project and rendered output stay on your machine. (Browser extensions, operating-system file providers and downloaded fonts keep their own privacy behaviour.)

## What it does

- **Import** one SDR H.264 MP4 (AAC audio is preserved; a silent file also works).
- **Bring your own timing**: word-timestamp JSON for precise active-word highlighting, SRT/VTT for estimated segment timing, or paste a plain script and sync it yourself. There is no automatic transcription.
- **Edit captions directly** on the preview and the timeline: double-click to edit text, drag to move or trim, split at the playhead, merge, duplicate, delete. Every action is undoable.
- **Sync by tapping**: tap along to the video to time whole captions, or loop one caption and tap its words. One-press `I` / `O` set a caption's start and end at the playhead.
- **Style and motion**: caption looks, per-word styles, emphasis, density, box position and text direction, with deterministic motion plans (the same inputs always give the same result). Advanced mode adds a technique pool for finer control.
- **Tracks**: put captions, titles and notes on separate tracks and reorder them on the timeline.
- **Video editing**: trim and cut sections, crop and rearrange into stacked or picture-in-picture panels, and add independently timed text notes. Post-format presets: YouTube Shorts / Instagram Reels and Stories (1080×1920), YouTube landscape (1920×1080), square (1080×1080), portrait post (1080×1350).
- **Accessibility checks**: warnings for captions that overflow, leave the safe area or are too dense. Text is never moved silently.
- **Save, relink, autosave**: projects store the transcript, captions, plans, overrides, locks, style and a fingerprint of the source video, but not the video itself. Reopen a project and relink the original file. The browser also autosaves your last project and offers to restore it on your next visit.

## Editor at a glance

| Area | What you get |
|---|---|
| Preview | The largest area. Drag the caption box, click it for exact position, double-click to edit text. A small toolbar appears under the selected caption. |
| Timeline | Ruler with zoom and loop region, waveform, kept/cut sections, one row per caption track, snapping, marquee and multi-select, resizable and collapsible. |
| Drawers | Captions (list, search, import, paste script), Text, Effects, Tracks, Video. One drawer at a time, so the preview can grow. |
| Narrow screens | Bottom tab bar, drawer as a sheet, a one-track timeline. |

### Keyboard shortcuts

| Key | Action |
|---|---|
| `Space` | Play / pause (tap during a sync pass) |
| `←` `→` / `Shift+←` `Shift+→` | Step 1/30 s / 1 s |
| `↑` `↓` | Previous / next caption |
| `I` / `O` | Set caption start / end at the playhead |
| `S` | Split at the playhead |
| `N` | New caption at the playhead |
| `Enter` | Edit the selected caption's text |
| `,` `.` | Nudge the selection by 0.05 s |
| `Alt+↑` `Alt+↓` | Move the caption to the track above / below |
| `Delete` | Delete the selection |
| `L` | Loop |
| `Ctrl+Z` / `Ctrl+Shift+Z` | Undo / redo |
| `Esc` | Cancel a drag or sync pass, stop the loop, deselect |

The in-app help dialog has the full list.

## Requirements

- Latest **desktop Chrome or Edge** (WebCodecs with H.264 encoding). Support is decided by codec and API probes, not browser-name detection.
- Source video: SDR H.264 in an MP4 container, AAC audio or none. Convert other formats first.
- Long exports need a browser that can write straight to a file you choose. Short clips may use the in-memory download path.
- Mobile high-resolution export is not supported.

## Run it locally

Open the built page directly, or serve the folder:

```
run_local.bat                      # Windows: serves http://127.0.0.1:8765/
python -m http.server 8765         # any platform, from the repo root
```

Then open the English edition at `/en/`. Each edition is a single self-contained `index.html`.

## Quick start

1. Open **Video Captions** and choose your MP4.
2. Import word-timestamp JSON or SRT/VTT, or open the Captions drawer and **paste a script** (one caption per line).
3. Fix text, split or merge captions, and set timing by dragging, by `I` / `O`, or with **Sync**.
4. Pick a look in **Text** and **Effects**; choose a post format and any trims or panels in **Video**.
5. Check the warnings, preview the whole clip, **Save** the project.
6. Press **Export**. The result is a 30 fps H.264 MP4. Uncut video keeps compatible original AAC audio; trimmed video is decoded, cut and re-encoded as AAC.

More detail (supported inputs, timing quality, relinking, diagnostics, limits): [Video Captions MVP guide](docs/VIDEO_CAPTIONS_MVP.md).

## Timing quality

- **Word timing**: every word has its own start and end; the active-word highlight follows them.
- **Estimated timing**: SRT/VTT cue timing spread across the words. Fine for ordinary captions, but not speech-accurate alignment.

All times, including notes and edits, refer to the **original source video**.

## Not included

Automatic transcription, translation, speaker detection, face tracking, speed changes, combining several source files, animated crop keyframes, HDR, cloud storage, collaboration and Live Captions output.

## Lyric Motion (inherited)

Azuria Sub still contains JIZURA's **Lyric Motion** engine (lyrics → animated lyric videos, After Effects panels). It is kept working and guarded by regression tests, but it is no longer the focus: the app opens in Video Captions. The inherited guides remain for reference: [English](README.en.md) · [Bahasa Indonesia](README.id.md) · [Tiếng Việt](README.vi.md) · [한국어](README.ko.md). The Japanese guide is no longer in this file; it lives in the git history (before the Azuria Sub rewrite) and in the original [JIZURA repository](https://github.com/852wa/JIZURA).

## Languages

The browser app is built in seven editions that share one project format, so a saved project opens in any of them: Japanese (`/`), English (`/en/`), Bahasa Indonesia (`/id/`), Tiếng Việt (`/vi/`), 繁體中文 (`/zh-hant/`), 简体中文 (`/zh-hans/`) and 한국어 (`/ko/`). Some newer caption controls are English-only in the other editions until translated.

## Development

The source is plain JavaScript, no bundler or modules. `src/*.js` files are concatenated in **sorted filename order** into one global namespace, `J`, so new files must be named to sort after their dependencies (for example `08i_...`).

```
python build.py          # regenerate the 7 edition index.html files and sitemap.xml
python build.py --dev    # also write dev/www/ (gitignored) for the test tools
cd dev && npm install    # once
npm test                 # test chain (stops at the first failure)
node lyric_smoke.js      # Lyric Motion regression guard
node caption_visual_regression.js   # caption visual snapshots (--update only for intended changes)
```

Never hand-edit the generated `index.html` files. User-facing strings live in `app/` (`body.html`, `english.py`, `i18n_*.py`). Export tests use mocks; real H.264 export must be checked in real Chrome.

Where to read next:

- [`docs/architecture/captions-editor-rework-plan.md`](docs/architecture/captions-editor-rework-plan.md) — the current rework (timeline, caption editing and sync, interface) and step status.
- [`docs/architecture/subtitle-mvp-delta-plan.md`](docs/architecture/subtitle-mvp-delta-plan.md) — earlier decisions, audit findings and step history.
- [`docs/architecture/decisions/`](docs/architecture/decisions/) — architecture decision records.
- [`docs/VIDEO_CAPTIONS_RELEASE_CHECKLIST.md`](docs/VIDEO_CAPTIONS_RELEASE_CHECKLIST.md) — release-candidate checklist.
- [`CHANGELOG.md`](CHANGELOG.md)

Engineering rules in short: one plan step at a time with tests green; existing projects must load and render identically after a schema migration; same inputs give the same plan (seeds derive from the project seed, IDs and reroll count); store commands are undoable and restore IDs, timing, locks and overrides exactly; manual and locked values survive re-planning; overflow produces warnings, never silent moves.

## Origin and licensing

**Azuria Sub is a derivative work of [JIZURA](https://github.com/852wa/JIZURA)**, Copyright (c) 2026 hakoniwa, released under the MIT License. The original git history was carried over unchanged, so authorship is preserved, and the JIZURA repository is configured as the `upstream` remote.

- **Software licence:** [MIT](LICENSE). You may use, modify and redistribute it, commercially or not, provided the copyright notice and licence text stay in all copies or substantial portions. The notice in `LICENSE` is the original author's and must not be removed.
- **Origin notice:** [NOTICE.md](NOTICE.md). References to JIZURA in the code, docs and history are intentional and record where this project comes from; code identifiers, storage keys and some file names still say `jizura` for compatibility.
- **Third-party components** (for example Mediabunny under MPL-2.0 and mp4-muxer under MIT) and the fonts loaded at runtime from Google Fonts: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
- **Your content:** the licences above cover the software only. They grant no rights to any video, audio, lyrics, transcript, font, trademark or other asset you import. You are responsible for having the rights to use and publish those materials. Captioned videos you export belong to you and the rights holders of what is in them; the software licence does not extend to the output.
- **Name:** "Azuria Sub" is this project's name; "JIZURA" and 字面 belong to the original project and are used here only to credit its origin.

The software is provided "as is", without warranty of any kind.
