# JIZURA — Subtitle MVP delta plan

Source of truth for the refactor started from `JIZURA_HANDOFF_SUBTITLE_MVP_REVISION.md`.
Where this file and the handoff disagree, **this file wins** (it records the audit and the owner's decisions).
Where this file and the code disagree, trust the code and update this file.

Baseline: checkpoint commit `c307142` (Video Captions Gates 0–7 + three-mode shell).
Audit date: 2026-09-28. Audit was read-only.

---

## 1. Decisions (owner-confirmed)

| # | Decision |
|---|---|
| D1 | **Style layer stack (handoff 3A): dropped.** `treatment` stays a single string plus `captionTreatment` (outline/neon/echo/backplate). Roles (3B) still ship. |
| D2 | **Placement is block-level.** No per-word positioning. |
| D3 | **Manual text blocks keep active-word behavior** (words spread evenly across the block, like today's `add-caption`). |
| D4 | **Deleting a track deletes its content** (tokens are NOT returned to the primary track). Must be undoable. The primary track cannot be deleted. |
| D5 | **Video edits are kept**: `clips[]` (trim/reorder), `panels[]` (crop / stack / PiP), `notes[]`, output formats. The handoff's "no trim / single time domain" is **void**. |
| D6 | **Output formats stay as they are** (Shorts, Reels, YouTube 16:9, Square, 4:5). Landscape keeps working. |
| D7 | Live Captions / OBS / `liveSafe` are removed completely (unchanged from handoff). |
| D8 | JIZURA/MV profile is hidden from the MVP UI, not deleted (`jizura-mv` is fully implemented in `08h_caption_planner.js`). |
| D9 | Up to 3 caption tracks; manual assignment + manual text blocks only (unchanged from handoff §4). |

Consequences of D5/D6:
- Caption times are **source-video times**; the compositor maps them through `J.videoSourceTime(clips, t)` when sections are cut. Tracks/boxes must work on top of this.
- Boxes are **normalized (0–1)** so they follow the output format. `notes[]` already use normalized x/y (precedent).
- `notes[]` and manual text blocks overlap in purpose. Proposed: keep notes as simple annotations; text blocks get their own track/box/style. Revisit at step 7.

---

## 2. Audit findings (facts, with locations)

**Verdict: refactor in place.** None of the restart criteria apply. Media/export/demux/preview/relink survive untouched.

### Structure
- Schema: `schemaVersion = 2`, modes `lyrics` | `video-captions` (`src/08a_project.js`). Only migration: `legacyLyrics` (v1 pre-envelope lyric project → v2).
- Segments: flat array `project.segments[]` `{id, start, end, tokenIds, boundarySource, locks{segmentation, visualPlan, fields[]}}`.
- Plans: map `project.plans[segmentId]` = `{id, segmentId, generated, manual, lockedFields}`; resolved by `J.captionResolvedPlan` (generated then manual).
- Store: `CaptionStore` in `src/12b_caption_store.js`; `switch` over command types; full-project before/after snapshots for undo/redo (history limit 100); lookups by ID.
- Seeds: `hashSeed(projectSeed, segmentId, rerollCount)` already deterministic (`J.h`, `J.sid`). Needs `trackId` added.
- Profiles `creator`, `punchy`, `jizura-mv` are hard-coded in `08h_caption_planner.js`.

### Zones (the main migration target)
- `zone` appears ~119 times in 12 source files (`08g` 30, `08h_planner` 21, `12c_workbench` 16, `08_planner` 15 (lyric side, mostly unrelated), `11p_caption_layouts` 10, `12b_store` 9, others).
- Passed as parameter (`env.zone`), stored in `project.safeZones` and copied into each plan (`plan.zone`, `plan.zoneId`).
- **Zones are in pixels** (`{x,y,width,height}` vs frame); compositor rescales by `W/sourceWidth`. Moving to normalized boxes is a schema change.
- Planner picks a zone **randomly per attempt** (`zones[h(seed,attempt,7) % n]`). Must stop: the user decides placement.
- `treatment`: single string, read in planner, compositor (`plan.treatment || textTreatment || treat`), plus `captionTreatment` drawn ad hoc in `11c`.

### Export / compositor
- Export consumes the plan via shared `J.drawCaptionOverlay` (`src/11c_caption_compositor.js`), which resolves **exactly one segment at time t** (`segmentAt` = `find`). Multi-track changes this function; export itself needs little.
- `drawCaptionOverlay` also calls `J.drawVideoNotes` first.
- Export: mediabunny, H.264 via `VideoEncoder.isConfigSupported('avc1.420033')`, AAC passthrough when unedited, re-encoded audio when clips are edited (`J.pumpEditedAudio`). Blob export capped at 30 s / 128 MB unless a writable file handle is given.
- Export tests use mocks. **Real-Chrome encode is not verified by CI**; release checklist has a blank "Chrome/Edge version" line.

### Determinism / fonts
- Planner readability uses a glyph-width guess (`glyphFactor` in `08g`): deterministic.
- Renderer uses real canvas metrics (`J.measure` / `layoutText`), and fonts load from Google Fonts over the network + `FontFace`. Layout can differ across machines. **Bundle fonts + pin measurement.**

### Build
- `build.py` sorts `src/*.js` alphabetically and concatenates (~40k lines) → 3.3 MB single HTML per language (7 editions) + `sitemap.xml`. `python build.py --dev` also writes `dev/www/` (now gitignored).
- No web workers (`Worker` only appears as a capability probe).

### Live remnants (to remove)
- `app/body.html:16` (Live Captions tab + "予定" badge) and `:146` (`liveCaptionsWorkspace`).
- `src/11z_product_shell.js` (`live-captions` mode) and `dev/product_mode_shell_test.js`.
- `liveSafe` in 10 places in `src/` (registry metadata, `internalMeta` in `08h_caption_planner.js`, `11p_*`, `11q_sets.js`, horror set) plus `dev/component_metadata_test.js`, `dev/caption_planner_test.js`, `dev/lyric_smoke.js`.
- Docs/PRD live sections, `app/english.py`, `dev/localized_build_test.py`.
- No OBS / `live/` companion code exists.

### Tests (baseline at c307142; run individually)
32 of 35 pass. Failing, all **stale assertions, not product bugs**:
- `caption_planner_test.js:110` and `caption_style_controls_test.js`: expect `treat: false` in `J.CAPTION_TECHNIQUE_DRAW`; `12c_caption_workbench.js:169` now has `treat: true`.
- `caption_workbench_test.js:18`: expects the workbench source to mention `J.captionTokenStatesAt`; that call moved to the compositor.
- **`npm test` chains with `&&`** and stops at the first failure (halts at the planner test), so later suites never run in CI as written.

### Video edits (kept, see D5)
`src/10a_video_edits.js`, `src/12a_video_edit_ui.js`, store command `set-video-edits`, `J.drawVideoEdit`, `J.drawVideoNotes`, edited-audio path in export. Tests: `video_edits_test.js`, `video_edits_browser_test.js`.

---

## 3. Filename mapping (plan/PRD → repo)

| Plan / PRD | Repo |
|---|---|
| project model | `src/08a_project.js` |
| segmenter / emphasis / zones / motion / planner | `src/08e_`, `08f_`, `08g_`, `08h_caption_*.js` |
| store | `src/12b_caption_store.js` |
| workbench UI | `src/12c_caption_workbench.js` |
| compositor | `src/11c_caption_compositor.js` |
| caption layouts / motion / active-word / expressive | `src/11p_caption_*.js` |
| media import / preview / export / audio / demux | `src/10c_`, `10d_`, `11b_`, `11d_`, `11e_` |
| video edits | `src/10a_video_edits.js`, `src/12a_video_edit_ui.js` |
| product shell | `src/11z_product_shell.js` |
| ADRs | `docs/architecture/decisions/` (0001 export, 0002 aesthetic spike) |

---

## 4. Step plan

Each step must leave the app working and all tests green. Status: `[ ]` todo, `[~]` in progress, `[x]` done.

- [x] **Step 0 — Safety net.** *(done 2026-09-28)*
  Fixed the 3 stale tests (draw flag `treat: true`; active-word check now looks at the compositor; workbench bind-order regex). `npm test` now runs `dev/run_all.js`: every suite runs, all failures are reported (old `&&` chain kept as `test:chain`). Added `dev/caption_plan_snapshot_test.js` (frozen plans, 6 scenes; `npm run update:plan-snapshots`); rendered-frame snapshots were already covered by `caption_visual_regression.js`; Lyric Motion smoke stays first. ADR `decisions/0003-seeds-and-determinism.md` written (includes `trackId` in the seed). `video_edits_browser_test.js` needs Playwright and is not in the runner.
- [ ] **Step 1 — Scope cleanup.**
  Remove live (shell mode, badge, `liveSafe`, docs, tests). Hide JIZURA/MV from the MVP UI. Keep video edits.
- [ ] **Step 2 — Schema v3 + migration.**
  New `schemaVersion`, `tracks[]` with one default (primary, undeletable) track, normalized `box` derived from the current pixel zone, `safeZones` → advisory `guides`, default `roles` reproducing today's look. `segments`/`plans` gain `trackId`. Existing projects must render identically. Write the ADR for schema/IDs/generated-vs-manual.
- [ ] **Step 3 — Route planner + compositor through tracks/boxes** (still one track, no behavior change). Layouts take `env.box`; anchor never moves when the active word changes.
- [ ] **Step 4 — Placement boxes.**
  Box replaces zone as the source of position; planner stops choosing zones randomly. Canvas tool: drag, resize width, snap (center lines / safe edges / thirds), numeric X/Y/width, arrow-key nudge. Overflow / safe-area crossing → warning, never silent movement. Override levels: style default → track → segment.
- [ ] **Step 5 — Roles.**
  `base` / `active` / `emphasis` (+ optional second font) in renderer and inspector, without reflow. Bundle a curated redistributable font set; pin text measurement (ADR: determinism).
- [ ] **Step 6 — Multiple tracks (max 3).**
  Commands: `addTrack`, `removeTrack` (deletes content, undoable), `renameTrack`, `reorderTrack`, `setTrackBox`, `setSegmentBoxOverride`, `setTrackStyle`, `setRole`, `moveTokensToTrack` / `moveSegmentToTrack`, `rerollTrack`. Rules: every included token in exactly one segment of one track; segmentation per track; **global** motion/attention budget; box-collision warning; fixed z-order in `drawCaptionOverlay`; timeline row per track; ghost outlines of other tracks.
- [ ] **Step 7 — Manual text blocks.**
  Extend `add-caption` with track/box/style; commands `createTextBlock`, `editTextBlock`, `deleteTextBlock`. Locked segmentation, preset animations only (no keyframes/images), active-word behavior on. Decide notes-vs-text-blocks overlap (see §1).
- [ ] **Step 8 — Re-verify export + release matrix** (old Gates 6 and 7) **on real Chrome with H.264**; fill in the release checklist; document the fallback path.

Cheap wins to schedule after step 8 (or earlier if convenient): SRT/VTT export, autosave/crash recovery, quantitative success metrics.

---

## 5. Open items

- **ASR:** still no transcription adapter; `transcribe_audio.py` exists at repo root (untracked audio file `audio_transcript.json` is intentionally not committed). Decide whether to pull one adapter forward.
- **Notes vs text blocks** overlap (step 7).
- **Real-Chrome export verification** and how CI handles H.264 (step 8).
- Workers / bundling: no workers today; only decide if export performance needs them.
- Docs to reconcile: PRD live sections (9.3, 9.4, 10, Phase 4) marked removed; `docs/VIDEO_CAPTIONS_ADVANCED_AND_TRIM_SLICES.md` should reflect D5.

## 6. Reduced ADR list

1. Seeds & determinism (incl. font measurement pinning) — **first**.
2. Project schema, IDs, generated-vs-manual (v3, tracks, boxes).
3. Caption component safety metadata & default-deny.
4. Media path & output/audio policy (extends 0001).
