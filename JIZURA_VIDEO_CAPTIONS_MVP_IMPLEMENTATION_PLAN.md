# JIZURA Video Captions MVP — Agent-Ready Implementation Plan

**Source documents:** `JIZURA_3_Mode_PRD.md` and `JIZURA Fork Planner - PRD.pdf`  
**Priority:** Video Captions for short-form video  
**Deferred product modes:** Lyric Motion is preserved; Live Captions is deferred until the shared caption engine is proven  
**Primary platform:** latest desktop Chrome/Chromium  
**Primary media target:** edited short-form clips, 15 seconds to 3 minutes, SDR, H.264/AAC MP4, portrait 1080×1920, constant 30 fps output  
**Planning unit:** narrow pull requests that leave the application buildable and testable

---

## 1. Outcome

The MVP is complete when a user can:

1. Open JIZURA and choose **Video Captions**.
2. Load a supported local short-form video.
3. Import a transcript containing word timestamps.
4. Generate readable caption segments automatically.
5. Preview animated captions over the source video in sync.
6. See active-word emphasis.
7. Choose among three style families: **Creator**, **Punchy**, and **JIZURA / MV**.
8. Create a deterministic visual variation without changing text or timing.
9. Lock a caption and reroll one unlocked caption.
10. Correct caption text and split or merge segments without editing JSON.
11. Select and edit a manual caption-safe zone.
12. Export an MP4 with synchronized captions and the original audio on the supported Chrome baseline.
13. Save a versioned project, reopen it, relink the source video if needed, and retain edits, locks, seeds, and generated plans.

The MVP proves the product thesis: JIZURA's procedural motion system can generate captions that are more expressive than template subtitles while remaining readable, controllable, and fast to edit.

Automatic transcription is deliberately **not a release blocker**. The architecture must expose a transcription adapter boundary, but the first complete path begins with imported timed text. Live Captions, OBS integration, face tracking, translation, collaboration, mobile export, AE caption parity, and general nonlinear video editing are outside this MVP.

## 2. Fixed scope decisions

Agents must not reinterpret these decisions without a recorded architecture decision.

### 2.1 Supported workflow

- One already-edited local video per project.
- No B-roll, multiple clips, transitions between source clips, speed changes, or source-video trimming in MVP.
- Portrait 9:16 is the optimized workflow. Landscape may preview correctly when the source is browser-playable, but it is not a release gate.
- Interactive preview uses `HTMLVideoElement`, its playback clock, `requestVideoFrameCallback()` where available, and Canvas composition.
- Final export uses a deliberately isolated media pipeline. A seek-based prototype may validate the concept, but production MVP acceptance requires deterministic source-frame handling for the supported H.264/AAC fixture set.

### 2.2 Timed-text input

- Canonical input is word-timestamp JSON.
- Project tokens have stable IDs and record timing provenance.
- SRT and WebVTT import are useful secondary inputs. If included, cue-level timing must be marked `estimated` when expanded into word timing.
- Automatic speech recognition is a post-MVP integration unless the core path finishes early. No agent may make schema, planner, editor, preview, or export depend on a specific ASR provider.

### 2.3 Creative behavior

- The default Creator style is calm and caption-safe.
- Most segments use intensity class 0 or 1.
- One segment normally receives one primary motion and at most one low-cost secondary behavior.
- Full-frame flashes, strobing, inversion, destructive glitch, background replacement, and aggressive camera motion are unavailable in default caption profiles.
- Existing Lyric Motion behavior must remain functional. Caption work extends the engine; it does not replace the lyric planner.

### 2.4 Persistence and determinism

- Project files contain references and metadata, not embedded source-video bytes.
- The user can relink missing media.
- Generated choices and manual overrides are stored separately.
- The same project schema version, generator version, seed, transcript, segments, and locks must produce the same visual plan.
- Planning code must not use uncontrolled `Math.random()`.

### 2.5 Browser and media promise

- Best-supported browser: latest desktop Chrome/Chromium.
- Input baseline: ordinary SDR H.264/AAC MP4 that Chrome can decode and the selected export pipeline can process.
- Output baseline: SDR H.264/AAC MP4 at 1080×1920/30 fps when capability checks pass.
- VFR inputs may be normalized to constant-frame-rate output.
- HDR, Dolby Vision, ProRes, HEVC, DRM, arbitrary containers/codecs, long-form, and 4K60 are not promised.
- Capability detection, actionable errors, and fallback guidance are part of the MVP.

## 3. Architecture boundaries

### 3.1 Keep as the JIZURA creative engine

- font loading and text measurement;
- glyph rendering;
- animation primitives;
- layouts, entrances, holds, exits, decorations, treatments, backgrounds, cameras, effects, and transitions;
- registry and technique registration;
- Canvas renderer;
- seeded randomization;
- existing Lyric Motion planner and audio-analysis behavior;
- reusable portions of the existing encoder and MP4 muxer integration.

### 3.2 Add as Video Captions product logic

- versioned project envelope and migrations;
- source-media metadata and relinking;
- canonical timed tokens;
- transcript import and validation;
- caption segmentation;
- semantic emphasis intent;
- active-word state;
- caption-safe zones and manual avoid regions;
- caption-safe component metadata;
- motion and attention budgets;
- style profiles;
- transcript, segment, inspector, and timeline editing;
- source-video preview composition;
- media demux/decode/audio preservation/export orchestration;
- capability diagnostics and user-facing recovery guidance.

### 3.3 Dependency direction

The dependency direction is fixed:

```text
input adapters
    ↓
canonical project + timed text
    ↓
segmentation + emphasis
    ↓
caption visual planner
    ↓
existing JIZURA registry + renderer
    ↓
preview compositor / export compositor
```

The renderer may consume a source frame but must not become responsible for demuxing or transcription. The caption planner must not import UI state. Import adapters must not choose animations. Media export must consume a frozen visual plan rather than rerolling it.

## 4. Proposed source layout for the MVP

Preserve the current sorted-JavaScript build initially. Add files with explicit numeric prefixes that make dependencies obvious. Do not migrate to a framework as part of the MVP.

### Existing files to change

- `src/01_util.js`: add only genuinely generic helpers, stable-ID support, and seeded utilities if absent.
- `src/02_fonts.js`: add caption-readable font groups and font readiness checks.
- `src/02b_lang.js`: reuse for language-aware tokenization; do not assume spaces.
- `src/03_text.js`: expose measurement needed by readability scoring and zone fitting.
- `src/04_styles.js`: add or delegate to caption style profiles without changing lyric style semantics.
- `src/05_anim.js`: add adaptive-duration hooks needed by caption primitives.
- `src/05b_registry.js`: add validated component capability metadata.
- `src/06_layouts.js`: allow layouts to receive a zone; do not globally retrofit unreviewed layouts as caption-safe.
- `src/07_decor.js`: classify reviewed decorations; unknown items remain unavailable to caption profiles.
- `src/08_planner.js`: preserve lyric behavior and create a mode dispatch boundary.
- `src/08b_omakase.js`: reuse calm/editorial weighting ideas; do not let caption rules mutate lyric output.
- `src/09_render.js`: accept a supplied source frame/media layer and render caption plans without owning decode.
- `src/10_audio.js`: preserve lyric analysis and expose waveform/energy hooks only when useful.
- `src/11_export.js`: retain existing encoding knowledge while delegating source decode, audio, and composition to new helpers.
- `src/12_ui.js`: become an application shell/mode dispatcher over new caption UI controllers rather than absorbing all new behavior.
- `app/body.html`: add the mode selector and Video Captions workbench mounts.
- `app/style.css`: add the desktop editor, responsive minimum behavior, diagnostics, and safe-zone overlay styling.
- `app/english.js` and localization sources: add every new user-facing string.
- `build.py`: include new files in deterministic order and continue producing static browser builds.
- `docs/EXPRESSION_PACKS.md`: document caption component metadata and safety rules.
- `README.md` and `README.en.md`: document the supported MVP workflow and truthful media constraints.

### New files recommended

- `src/08c_project_model.js`: project schema, migrations, validation, serialization, media references, generator version.
- `src/08d_timed_text.js`: token model, stable IDs, import normalization, edit helpers, timing provenance.
- `src/08e_caption_segmenter.js`: candidate boundaries, scoring, selection, manual-boundary preservation, diagnostics.
- `src/08f_caption_emphasis.js`: structured emphasis intent and explainable provenance.
- `src/08g_caption_zones.js`: zone model, social-safe defaults, manual zone edits, fit scoring.
- `src/08h_caption_planner.js`: compatible-technique selection, budgets, continuity, deterministic visual plans, rerolls, locks.
- `src/08i_caption_styles.js`: Creator, Punchy, and JIZURA / MV weighted profiles.
- `src/08j_caption_techniques.js`: caption-safe layouts, entrances, holds, exits, and treatments.
- `src/09b_active_word.js`: upcoming/active/spoken calculation and render helpers.
- `src/10b_media_capabilities.js`: feature/codec probes and actionable diagnostics.
- `src/10c_media_import.js`: object URL lifecycle, metadata, source fingerprint, relink behavior.
- `src/10d_media_preview.js`: video clock, frame callback, Canvas source-frame handoff, seek synchronization.
- `src/11b_media_demux.js`: container adapter and encoded sample timeline.
- `src/11c_media_decode.js`: video decoding and frame selection.
- `src/11d_media_audio.js`: original-audio passthrough/remux for unmodified sources, with guarded fallback behavior.
- `src/11e_caption_compositor.js`: source frame plus frozen JIZURA visual plan.
- `src/11f_caption_export.js`: export orchestration, progress, cancellation, cleanup, error mapping.
- `src/12b_caption_store.js`: caption editor state, commands, undo/redo, dirty state, persistence boundary.
- `src/12c_caption_ui.js`: workbench controller and mode lifecycle.
- `src/12d_transcript_ui.js`: transcript editing and segment operations.
- `src/12e_caption_timeline.js`: minimum viable segment/word timeline and seeking.
- `src/12f_caption_inspector.js`: simple style controls and segment-level overrides.
- `dev/fixtures/captions/`: deterministic word-timed transcripts.
- `dev/fixtures/media/`: small licensed/generated media fixtures and a manifest describing codec, fps, dimensions, and expected duration.
- `dev/caption_tests.js`: schema, segmenter, planner, determinism, locks, and project round-trip tests.
- `dev/media_tests.js`: capability, demux/decode, frame count, timestamps, audio, cancellation, and export tests.
- `dev/visual_caption_test.html`: deterministic visual-regression test page.

If the repository's actual naming or build order differs at implementation time, preserve these responsibilities and record the filename mapping in the first PR. Do not perform a wholesale directory reorganization until the prototype loop is proven.

## 5. Canonical MVP data contracts

### 5.1 Project envelope

```js
{
  schemaVersion: 2,
  generatorVersion: "caption-mvp-1",
  mode: "video-captions",
  id: "project_...",
  media: {
    name, size, lastModified, fingerprint,
    duration, width, height,
    sourceFrameRate, hasAudio,
    videoCodec, audioCodec,
    relinkRequired
  },
  transcript: {
    language,
    timingQuality: "word" | "estimated" | "segment",
    tokens: []
  },
  segments: [],
  style: {},
  plans: {},
  safeZones: [],
  seed,
  settings: {},
  createdAt,
  updatedAt
}
```

### 5.2 Timed token

```js
{
  id: "word_000042",
  text: "actually",
  normalizedText: "actually",
  start: 4.230,
  end: 4.670,
  confidence: 0.97,
  source: "import",
  timingQuality: "word",
  speakerId: null,
  emphasis: { score: 0.32, reasons: [] },
  manualEmphasis: null
}
```

### 5.3 Caption segment

```js
{
  id: "segment_0012",
  tokenIds: ["word_000042", "word_000043"],
  start: 4.230,
  end: 5.610,
  boundarySource: "planner",
  boundaryReasons: [],
  status: "generated",
  manual: {},
  locks: {
    segmentation: false,
    visualPlan: false,
    fields: []
  }
}
```

### 5.4 Visual plan

```js
{
  id: "plan_segment_0012",
  segmentId: "segment_0012",
  seed: 932144,
  styleFamily: "creator",
  layout: "captionBottomTwoLine",
  enter: "captionSoftRise",
  hold: "captionStill",
  exit: "captionFade",
  activeWord: "captionActiveColor",
  treatment: "captionBoldOutline",
  decorations: [],
  intensity: 1,
  motionCost: 0.28,
  attentionCost: 0.16,
  captionSafe: true,
  zoneId: "zone_bottom_safe",
  generated: {},
  manual: {},
  lockedFields: []
}
```

Generated values and manual values must remain distinct. The resolved value is computed by a helper; UI code must not mutate generated data to represent an override.

## 6. Agent execution model

### 6.1 Recommended lanes

Use four stable agent lanes. Agents may work concurrently only when their dependency gates are satisfied.

**Lane A — Domain and planner**

- project schema;
- timed text;
- segmentation;
- emphasis;
- zones;
- deterministic caption planning;
- style profiles and budgets.

**Lane B — Rendering and creative pack**

- registry metadata;
- caption-safe component audit;
- subtle primitives;
- caption layouts and active-word rendering;
- readability and visual snapshots.

**Lane C — Media**

- capability probe;
- media import and preview;
- demux/decode spike;
- source audio handling;
- composited export, progress, cancellation, cleanup.

**Lane D — Editor and integration**

- mode shell;
- caption store and command model;
- transcript/segment UI;
- timeline and preview coordination;
- inspector, locks, rerolls, save/reopen, errors, accessibility.

One integration owner reviews cross-lane contracts and owns release gates. The integration owner should not silently rewrite another lane's contract; contract changes require a small architecture decision record and dependent-agent notification.

### 6.2 Pull request rules

- One independently reviewable behavior per PR.
- Prefer 200–600 changed lines; larger media or UI PRs must explain why they cannot be split.
- Every PR includes tests or an explicit reason tests are impossible at that slice.
- Every PR states affected modes: Video Captions, Lyric Motion, or shared engine.
- Shared-engine PRs require a Lyric Motion regression check.
- No PR mixes framework/build migration with product behavior.
- No generated `index.html`, AE bundles, or CEP archives should obscure source review unless the repository convention requires updating them; if required, keep source changes and generated outputs in separate commits.
- Commit messages follow narrow intent, for example `feat(captions): add stable timed-token model`.

### 6.3 Definition of ready for a task

A task may start only when:

- its upstream contract is merged or pinned to a reviewed branch;
- expected inputs and outputs are written in the task;
- fixture data exists or the task includes creating it;
- acceptance checks are objective;
- the task names the files it may change;
- open product decisions are either resolved or explicitly excluded.

### 6.4 Definition of done for every task

- implementation is complete behind the intended mode/feature boundary;
- automated tests pass;
- deterministic behavior is tested when planning is involved;
- no new uncontrolled randomness is introduced;
- user-facing failures are actionable;
- new third-party dependencies are pinned, justified, and added to notices;
- new UI strings are localizable;
- no regression in the Lyric Motion smoke test;
- relevant documentation and fixture expectations are updated;
- the PR describes manual verification performed.

## 7. Ordered implementation program

The program is organized into gates, not calendar promises. A small team of agents can parallelize work inside a gate, but may not skip the exit criteria.

---

## Gate 0 — Baseline, repository contract, and risk spikes

**Purpose:** freeze what currently works, define truthful scope, and attack the two largest unknowns—caption aesthetics and source-video export—before building a large editor.

### G0.1 Repository baseline

**Owner:** integration  
**Depends on:** none  
**Likely files:** `README*`, `docs/`, `dev/`, build scripts

Steps:

1. Record the fork commit, upstream remote, build commands, generated-artifact policy, and browser baseline.
2. Run the existing build and available tests.
3. Create a Lyric Motion smoke fixture with seed and expected structural output.
4. Record current project schema/version behavior.
5. Add `docs/architecture/video-captions-mvp.md` summarizing boundaries and non-goals from this plan.

Acceptance:

- clean checkout builds using documented commands;
- current lyric fixture can be regenerated;
- upstream attribution and license remain intact;
- agents have one source for build/test commands.

### G0.2 Fixture pack

**Owner:** integration with lanes A/C  
**Depends on:** G0.1

Create legally safe, tiny fixtures:

- 15-second 1080×1920 H.264/AAC 30 fps clip with speech-like audio and visible timing slate;
- 10-second landscape clip for non-primary regression;
- no-audio clip;
- 24 fps and 60 fps diagnostic clips if repository size permits; otherwise deterministic fixture-generation instructions;
- word-timestamp JSON with punctuation, a pause, a number, a repeated word, and one manually emphasized token;
- SRT/VTT equivalents for parser tests;
- invalid timing, overlap, unknown schema version, missing token, and unsafe technique fixtures.

Acceptance:

- every fixture has a manifest with duration, dimensions, codecs, frame rate, audio expectation, transcript expectation, and license/provenance;
- tests never depend on a user's personal media.

### G0.3 Media export feasibility spike

**Owner:** lane C  
**Depends on:** G0.2  
**Output:** disposable prototype plus decision record, not production editor code

Steps:

1. Probe Chrome's supported H.264 decoder and encoder configurations on target development machines.
2. Evaluate a pinned MP4 demux path compatible with existing muxing.
3. Decode fixture video frames with timestamps.
4. Draw a fixed overlay on each frame.
5. Encode constant 30 fps output.
6. Preserve/remux AAC audio without changing source duration.
7. Verify duration, frame count/timestamps, audio presence, and A/V sync.
8. Measure memory and export speed for 15 seconds and extrapolate cautiously to 3 minutes.
9. Document failure behavior when H.264 encoding is unavailable.

Decision gate:

- choose the production media path and dependency;
- explicitly state supported codec/configuration;
- identify whether original AAC can be remuxed unchanged;
- if browser-only MP4 export cannot be made reliable on the baseline, choose one fallback before editor work expands: transparent PNG sequence, local companion export, or a more constrained codec profile.

### G0.4 Caption aesthetic spike

**Owner:** lanes A/B  
**Depends on:** G0.2

Build a hard-coded 15-second demonstration from word JSON with:

- three caption layouts;
- `fade`, `softRise`, `softScale`, `activeColor`, and one restrained impact behavior;
- active-word state;
- one punctuation/number emphasis rule;
- Creator and Punchy profile drafts;
- a variation button using a fixed seed.

Acceptance:

- no clipped text at 1080×1920;
- active words do not reflow the line;
- default captions remain readable at playback speed;
- same seed yields the same plan;
- reviewers judge the output worth continuing before full editor investment.

**Gate 0 exit:** the existing product is baselined; fixtures exist; browser media export has an explicit chosen path; a timed transcript produces a compelling caption preview.

---

## Gate 1 — Project, timed-text, and registry foundations

### G1.1 Mode and project envelope

**Owner:** lane A  
**Depends on:** G0.1

Steps:

1. Add `mode: "lyrics" | "video-captions"` dispatch without changing existing lyric output.
2. Add schema and generator version fields.
3. Implement project validation with actionable errors and unknown-version rejection.
4. Add migration entry points; only implement migrations that are actually needed.
5. Add save/load round-trip tests.

Acceptance:

- lyric projects continue to load and render;
- a caption project round-trips without data loss;
- unsupported future schema versions fail without mutation.

### G1.2 Timed-token model and import

**Owner:** lane A  
**Depends on:** G1.1

Steps:

1. Define stable token IDs, timing, confidence, provenance, timing quality, language, speaker placeholder, and emphasis intent.
2. Validate non-negative time, `end >= start`, project duration bounds, and token ordering.
3. Normalize punctuation without losing displayed text.
4. Implement word-JSON import first.
5. Implement SRT/VTT import only behind explicit `estimated` timing quality.
6. Add language-aware tokenization using `Intl.Segmenter` where appropriate and a tested fallback.

Acceptance:

- editing one token does not renumber unrelated tokens;
- bad timing identifies the exact token and cause;
- cue-level imports never claim word-accurate timing;
- CJK fixture does not require spaces.

### G1.3 Component capability metadata

**Owner:** lane B  
**Depends on:** G0.1

Add metadata validation for:

- `intensity` 0–4;
- `motionCost` and `attentionCost` 0–1;
- `captionSafe` and `liveSafe`;
- `minDuration`, optional `preferredDuration`, `maxWords`;
- `portraitFriendly`, `emojiSafe`, `requiresFullFrame`, `flashes`, `movesCamera`;
- incompatible component IDs or categories.

Unknown metadata must fail closed for caption selection while remaining available to Lyric Motion.

Acceptance:

- caption picker cannot select an unreviewed component;
- lyric registry behavior remains compatible;
- invalid metadata fails during development with a specific component name.

### G1.4 Caption store and command model

**Owner:** lane D  
**Depends on:** G1.1, G1.2

Implement commands rather than ad hoc mutation:

- edit token text;
- set manual emphasis;
- split segment;
- merge adjacent segments;
- set segment timing/boundary;
- set safe zone;
- set visual override;
- lock/unlock segment or field;
- reroll segment;
- undo/redo.

Acceptance:

- every user edit is undoable;
- undo/redo restores IDs, timing, locks, and overrides exactly;
- generated and manual fields remain separate.

**Gate 1 exit:** a versioned caption project can load, validate, edit through commands, save, and reopen; caption-safe registry metadata is enforceable.

---

## Gate 2 — Deterministic caption intelligence

### G2.1 Segmentation engine v1

**Owner:** lane A  
**Depends on:** G1.2

Pipeline:

1. normalize tokens;
2. produce candidate boundaries from punctuation, silence, duration, words, glyph width, and sentence endings;
3. score candidate segments;
4. penalize overflow, orphaned weak words, too-short dwell, and uneven line balance;
5. select a non-overlapping segmentation;
6. emit boundary reasons for debugging;
7. preserve manual and locked boundaries on replanning.

Initial configurable defaults for Creator style should target 2–6 words, a practical dwell time, no more than two lines, and width derived from the active safe zone rather than raw character count.

Acceptance:

- no invalid overlap;
- every token belongs to exactly one segment unless explicitly excluded;
- segments stay within project duration;
- locked/manual boundaries survive replanning;
- fast, slow, punctuation-free, numbers, repeated words, and CJK fixtures pass.

### G2.2 Emphasis intent v1

**Owner:** lane A  
**Depends on:** G1.2

Implement explainable rules only:

- manual emphasis always wins;
- punctuation and sentence-final emphasis;
- conservative number/percentage/currency emphasis;
- repeated-word escalation;
- capitalization as a weak signal, not truth;
- no opaque model dependency.

Return a score plus reasons. Do not choose effects in this module.

### G2.3 Zone model and readability scoring

**Owner:** lanes A/B  
**Depends on:** G1.3

Implement:

- bottom, center, top, and custom caption zones;
- vertical-video social-safe inset preset;
- manual rectangle editing;
- zone-aware text measurement;
- minimum font size, maximum lines, overflow, contrast strategy, duration compatibility, and stable-anchor checks;
- candidate rejection and regeneration when a plan cannot fit.

Face detection is excluded. A manual safe zone is the MVP solution.

### G2.4 Motion budget and continuity

**Owner:** lane A  
**Depends on:** G1.3, G2.2, G2.3

Implement:

- per-segment maximum intensity;
- motion and attention cost totals;
- one-primary-plus-one-subtle-secondary default rule;
- rolling attention budget to prevent adjacent hero moments;
- recent-technique history to reduce repetitive randomness;
- style-controlled continuity for font, alignment, position, treatment, accent color, and animation family;
- manual override warning rather than silent refusal.

### G2.5 Visual planner, variations, and locks

**Owner:** lane A  
**Depends on:** G2.1–G2.4

Steps:

1. Resolve style constraints.
2. Choose a compatible zone and layout.
3. Filter techniques by duration, words, glyphs, metadata, budget, and recent history.
4. Choose entrance, hold, exit, active-word treatment, text treatment, and optional decoration.
5. validate readability;
6. retry with bounded attempts, then fall back to a known safe static plan;
7. store the complete resolved plan and seed;
8. implement whole-project visual variation without structural resegmentation;
9. implement single-segment reroll that preserves locked fields and all other plans.

Acceptance:

- same inputs/seed/generator version produce identical plans;
- no caption profile selects unsafe/unreviewed techniques;
- short captions exclude incompatible timing;
- segment reroll changes only the targeted unlocked plan;
- whole-project visual variation preserves tokens, timings, segment IDs, manual emphasis, and locked plans;
- fallback always produces legible static output.

**Gate 2 exit:** timed words become deterministic, explainable, readable visual plans independent of video and UI.

---

## Gate 3 — Caption-safe creative pack and renderer integration

### G3.1 First layouts

**Owner:** lane B  
**Depends on:** G2.3

Implement and test at least:

- `captionBottomStack`;
- `captionBottomTwoLine`;
- `captionCenterStack`;
- `captionSingleWordHero`;
- `captionLeftAnchor`;
- `captionRightAnchor`;
- `captionTwoLinePunch`.

Each layout consumes `env.zone`, respects padding, returns measurement diagnostics, and avoids changing anchor when the active word changes.

### G3.2 Subtle primitives

**Owner:** lane B  
**Depends on:** G1.3

Implement:

- `captionFade`;
- `captionSoftRise`;
- `captionSoftScale`;
- `captionWordFade`;
- `captionSoftReplace`;
- `captionStill`;
- `captionActiveColor`;
- `captionActiveScale` capped near 1.04;
- `captionActiveLift` capped near 2 px at design scale;
- `captionActiveWeight` where the chosen font supports it;
- `captionActiveUnderline`.

Every technique declares duration and safety metadata. No overshoot, bounce, or blur may be smuggled into primitives named “soft.”

### G3.3 Reviewed expressive subset

**Owner:** lane B  
**Depends on:** G1.3, G3.1

Review a small existing subset such as `pop`, `type`, `blur`, `wipe`, `drift`, `breathe`, `shrink`, and selected specimen/editorial treatments. Either adapt timing through a caption wrapper or mark the original unsafe. Add one restrained impact entrance for Punchy and a deliberately opt-in expressive subset for JIZURA / MV.

Do not audit all legacy packs before the MVP. Default-deny makes incremental review safe.

### G3.4 Active-word renderer

**Owner:** lane B  
**Depends on:** G1.2, G3.2

Calculate `upcoming`, `active`, and `spoken` from the preview/export clock and token timing. Ensure transitions are frame-rate independent and deterministic. Active-word styling must not alter measured line breaks unless the plan explicitly reserved the maximum geometry.

### G3.5 Three style profiles

**Owner:** lanes A/B  
**Depends on:** G2.4, G3.1–G3.4

**Creator**

- calm default;
- high positional/font continuity;
- intensity 0–1 normally;
- active color/weight/underline;
- no full-frame effects.

**Punchy**

- shorter segments;
- occasional isolated keyword;
- intensity 0–2 with rolling budget;
- small impact motion only on strong emphasis;
- no strobe, inversion, or destructive glitch.

**JIZURA / MV**

- showcases the original identity;
- intensity 0–3 on explicitly chosen profile;
- still constrained to keep spoken captions readable over video;
- any full-frame behavior requires a separate user opt-in and is not enabled by default in MVP.

### G3.6 Visual regression harness

**Owner:** lane B  
**Depends on:** G3.1–G3.5

Capture deterministic frames at entry, active word, hold, exit, and segment transition across portrait and landscape fixtures. Include long text, emoji fallback, CJK, numbers, minimum duration, and maximum supported words.

**Gate 3 exit:** the shared renderer can draw caption plans with a reviewed technique pack and three differentiated styles, backed by deterministic visual snapshots.

---

## Gate 4 — Source-video preview

### G4.1 Capability diagnostics

**Owner:** lane C  
**Depends on:** G0.3

Detect actual capabilities rather than user-agent strings:

- video playback and metadata;
- `requestVideoFrameCallback`;
- `VideoDecoder`, `VideoEncoder`, `AudioDecoder`, `AudioEncoder`;
- supported selected codec configurations;
- File System Access where used;
- worker and OffscreenCanvas availability where used.

Return structured capabilities for UI and export. Add an Advanced diagnostics view later; do not scatter raw checks through components.

### G4.2 Media import and lifecycle

**Owner:** lane C  
**Depends on:** G4.1

Implement file selection/drop, object URL creation/revocation, metadata extraction, source fingerprint, errors, and relinking. Loading a second file must release the first. Save projects without embedding video.

### G4.3 Preview clock and composition

**Owner:** lane C  
**Depends on:** G4.2, G3.4

Steps:

1. Use the video element as the authoritative preview clock and audio source.
2. On presented frames, draw the source video into the preview Canvas using a documented contain/cover policy.
3. Pass the same media time to the frozen caption plan renderer.
4. Keep captions synchronized through play, pause, seek, replay, and end.
5. Drop visual preview frames rather than inventing a second clock when the UI falls behind.
6. Render at adaptive preview resolution while preserving logical design coordinates.

Acceptance:

- caption active-word state follows video time after arbitrary seeks;
- repeated play/pause does not accumulate drift;
- object URLs and callbacks are cleaned up when the project closes;
- source video remains visually dominant.

### G4.4 Debug overlay

**Owner:** lane C  
**Depends on:** G4.3

Add development-only information: media time, presented frame timestamp, active segment/token, plan ID/seed, zone/layout, preview scale, dropped callbacks, and capability summary.

**Gate 4 exit:** a supported local video previews with synchronized caption plans and diagnostic evidence of timing correctness.

---

## Gate 5 — Minimum complete editor

### G5.1 Mode shell

**Owner:** lane D  
**Depends on:** G1.1, G4.3

Expose exactly three product modes, but only Video Captions receives the new editor during this program. Lyric Motion opens the preserved experience. Live Captions is visibly “planned” only if product design wants it exposed; it must not appear functional.

### G5.2 Video Captions workbench

**Owner:** lane D  
**Depends on:** G4.3

Create a desktop-first layout with:

- transcript/segment panel;
- video preview with safe-zone overlay;
- simple style/segment inspector;
- compact segment/word timeline;
- project, undo, redo, variation, save, and export actions.

Do not expose the entire registry in Simple mode.

### G5.3 Transcript and segment editing

**Owner:** lane D  
**Depends on:** G1.4, G2.1

Implement:

- token text correction;
- segment selection and seeking;
- split at token boundary;
- merge adjacent segments;
- manual emphasis intent;
- displayed timing and timing-quality badge;
- validation messages attached to the affected item.

Free dragging of every word boundary is optional for MVP. Segment boundary editing and exact numeric entry are sufficient if implemented clearly.

### G5.4 Style, variation, and locks

**Owner:** lane D  
**Depends on:** G2.5, G3.5

Simple controls:

- style family;
- intensity;
- motion amount;
- caption density/words per caption;
- position/safe zone;
- accent color and font direction;
- emphasis strength;
- create visual variation;
- lock segment;
- reroll selected segment;
- disable animation for selected segment.

Replanning must warn before changing unlocked segmentation. Visual variation must never change segmentation.

### G5.5 Timeline v1

**Owner:** lane D  
**Depends on:** G4.3, G5.3

Minimum tracks:

- source video duration;
- caption segments;
- word boundaries at sufficient zoom;
- playhead.

Required interactions are seek, select segment, inspect word timing, and adjust segment boundary within neighboring token constraints. A professional multitrack NLE is out of scope.

### G5.6 Save, reopen, and relink

**Owner:** lane D  
**Depends on:** G1.1, G4.2, G5.4

Acceptance:

- save contains schema/generator version, transcript, segments, plans, generated/manual separation, locks, seed, style, zones, and source fingerprint;
- reopening without source media asks for relink;
- wrong media produces a fingerprint warning and does not silently proceed;
- reopening with correct media reproduces visual plans.

### G5.7 Accessibility and reduced motion

**Owner:** lane D with lane B  
**Depends on:** G3.5, G5.2

- add reduced-motion preview control;
- warn on overflow, insufficient contrast strategy, excessive line count, unsafe flashing metadata, or off-safe-area text;
- ensure core controls are keyboard reachable and labeled;
- aggressive profile selection communicates its higher-motion behavior.

**Gate 5 exit:** a user can complete the editing workflow without touching JSON and can recover the project after closing it.

---

## Gate 6 — Production MVP export

### G6.1 Demux adapter

**Owner:** lane C  
**Depends on:** G0.3 decision

Implement the chosen pinned demuxer behind an internal adapter. Normalize track metadata, decoder configuration, samples, timestamps, keyframes, duration, and audio samples. Reject unsupported or malformed inputs clearly.

### G6.2 Video decode and output timeline

**Owner:** lane C  
**Depends on:** G6.1

- decode supported video samples;
- normalize VFR source presentation to the selected constant output timeline;
- select/retain the appropriate frame for each output timestamp;
- bound decoded-frame memory and close `VideoFrame`s promptly;
- expose progress and cancellation checkpoints.

### G6.3 Audio preservation

**Owner:** lane C  
**Depends on:** G6.1

For an untrimmed, speed-unchanged source, preserve/remux compatible AAC samples whenever reliable. Verify timestamps begin correctly and output duration matches the video timeline. If passthrough is impossible, fail with a useful supported-path message rather than silently dropping audio.

### G6.4 Compositor

**Owner:** lane C with lane B  
**Depends on:** G6.2, G3.6

For every output timestamp:

1. obtain the correct source frame;
2. draw it with the same fit policy as preview;
3. render background caption decoration if allowed;
4. render typography and active-word state from the frozen plan;
5. render caption foreground decoration/effects;
6. create/submit an output `VideoFrame`;
7. close all temporary frame resources.

Preview and export must share logical rendering paths so they do not drift visually.

### G6.5 Encode, mux, progress, cancel, cleanup

**Owner:** lane C  
**Depends on:** G6.3, G6.4

- capability-check selected H.264 output before work begins;
- encode 1080×1920/30 fps baseline;
- mux video plus preserved audio;
- stream to a user-selected file when the supported browser API is available, otherwise use a guarded Blob path for short fixtures;
- expose progress by output frames/time;
- cancellation closes decoder, encoder, frames, streams, and file handles;
- map technical failures to recovery instructions.

### G6.6 Export verification

**Owner:** integration  
**Depends on:** G6.5

Automated and manual checks:

- output opens in Chrome and at least one independent player;
- duration is within defined tolerance;
- expected frame count/timestamps are present;
- audio exists and is not accidentally silent;
- slate fixture demonstrates A/V/caption sync;
- first/last caption is not clipped;
- range begins at zero correctly;
- cancel leaves no continuing encoder work;
- unsupported codec/configuration fails before a long operation;
- two consecutive exports do not leak enough memory to destabilize the app.

**Gate 6 exit:** supported fixture videos export repeatably with captions and original audio.

---

## Gate 7 — Hardening and MVP release

### G7.1 Full regression matrix

**Owner:** integration with all lanes

Run:

- Lyric Motion smoke test;
- project schema/load/save/migration tests;
- planner determinism and lock tests;
- visual snapshots for all caption-safe primitives;
- preview play/pause/seek/replay tests;
- export duration/frame/audio/sync/cancel tests;
- invalid project and unsupported codec tests;
- portrait primary and landscape graceful behavior;
- long words, fast speaker, slow speaker, silence, numbers, repeats, emoji fallback, and mixed/CJK text.

### G7.2 Performance and resource pass

Measure on a documented ordinary creator laptop:

- preview frame behavior at adaptive resolution;
- memory after import, repeated seek, project close, and two exports;
- plan generation time for a 3-minute transcript;
- export speed and encoder queue;
- cleanup of object URLs, callbacks, frames, encoders, and file handles.

No universal performance promise should be added without measurements. The release notes list tested hardware/browser configurations.

### G7.3 Error and recovery pass

Every known failure must say what the user can do. Required cases include:

- unsupported input codec/container;
- browser cannot encode chosen H.264 configuration;
- source media missing or mismatched;
- transcript validation failure;
- no word timing / estimated timing;
- insufficient memory or output write failure;
- cancelled export;
- project from unsupported future version;
- font failed to load;
- visual plan fell back to static for safety.

### G7.4 Documentation and licensing

- retain MIT attribution;
- update `THIRD_PARTY_NOTICES.md` for demux/media dependencies and fonts;
- document that software licensing does not clear video, audio, lyrics, fonts, or user assets;
- publish the exact supported workflow and non-goals;
- document project relinking and timing-quality meanings;
- document browser diagnostics and export fallback;
- include privacy wording even though MVP import remains local.

### G7.5 Release candidate acceptance

Use a fresh Chrome profile and clean checkout. A tester who did not build the feature must complete the 13-step MVP outcome without developer tools or hand-edited JSON.

**Gate 7 exit:** all release criteria pass, critical/high defects are closed, notices and limitations are accurate, and the build is reproducible.

## 8. Dependency map and safe parallelization

### Wave 1

- Integration: G0.1 and fixture specification.
- Lane C: media export feasibility once base fixture exists.
- Lanes A/B: caption aesthetic spike using the transcript fixture.

### Wave 2

- Lane A: project/timed-text contracts.
- Lane B: registry metadata and reviewed safety defaults.
- Lane C: capability probe based on export-spike decision.
- Lane D: command/store design against the reviewed project contract.

### Wave 3

- Lane A: segmenter, emphasis, zones, budgets, planner.
- Lane B: caption layouts, subtle primitives, active-word rendering.
- Lane C: media import and preview.
- Lane D: mode shell skeleton, using fixture plans rather than unfinished planner internals.

### Wave 4

- Lane A/B: styles and planner/render integration.
- Lane C: preview hardening and production media pipeline.
- Lane D: workbench, transcript editing, timeline, inspector, save/reopen.

### Wave 5

- Lane C/B: export compositor and encoding.
- Lane D: export UX, diagnostics, accessibility.
- Integration: full system tests and release matrix.

Agents must not concurrently edit the same high-conflict files without a named integration strategy. In particular, `src/09_render.js`, `src/11_export.js`, `src/12_ui.js`, `app/body.html`, and `app/style.css` should each have one active owner at a time.

## 9. Test specification

### 9.1 Domain tests

- stable IDs survive text edits;
- invalid timing is rejected at the token;
- every included token maps to exactly one segment;
- manual boundaries survive segmentation rerun;
- manual emphasis overrides computed emphasis;
- semantic emphasis survives style change;
- generated values remain distinct from overrides;
- same seed produces the same plan;
- a targeted reroll changes only the target;
- locks survive save/reopen and reroll;
- unsafe/unreviewed components never appear in caption profiles;
- duration-incompatible techniques are filtered;
- rolling motion budget prevents adjacent hero moments;
- planner fallback is readable and static.

### 9.2 Renderer tests

- entry/hold/active/exit snapshots for every new primitive;
- active-word change does not reflow text;
- zone padding and maximum lines are respected;
- portrait layout is not clipped;
- landscape behaves gracefully;
- emoji-unsafe techniques fall back;
- CJK is segmented/measured without space assumptions;
- reduced-motion output avoids non-essential motion;
- caption rendering over video matches neutral-background coordinates.

### 9.3 Preview tests

- play, pause, seek forward/backward, replay, end, and rapid seek;
- video clock remains authoritative;
- active word changes at expected times;
- dropped preview frames do not advance a separate caption clock;
- replacing media releases the previous object URL;
- reopening/relinking restores sync.

### 9.4 Export tests

- supported H.264/AAC baseline;
- no-audio input if supported, with truthful output behavior;
- 24 and 60 fps input normalized to 30 fps output;
- VFR diagnostic input if fixture is available;
- output duration/frame count/audio presence;
- first frame/last frame and start timestamp;
- caption timing against a visible/audio slate;
- cancellation at early, middle, and late stages;
- decoder/encoder error cleanup;
- repeated export resource behavior;
- unsupported codec and encoder configuration messaging.

### 9.5 Manual creative acceptance

For each of Creator, Punchy, and JIZURA / MV:

- watch the full 15-second and 60-second fixtures at normal speed;
- score readability, distraction, visual continuity, emphasis appropriateness, and variation usefulness;
- reject any default result with flashing, repeated high-attention effects, unstable position, clipped text, or unreadable dwell;
- verify Creator is mostly calm, Punchy uses contrast rather than constant motion, and JIZURA / MV remains recognizably expressive without covering the subject continuously.

## 10. Release blockers and explicit deferrals

### Release blockers

- nondeterministic planner output;
- lost manual edits or locks;
- Lyric Motion regression on baseline fixture;
- unsupported techniques entering safe profiles;
- caption/video timing drift after seeking;
- exported file lacks audio when the supported fixture has audio;
- visibly incorrect A/V/caption synchronization;
- export leaks or hangs after cancellation;
- source video silently embedded into project JSON;
- misleading capability or timing-quality claims;
- no recovery path for missing source media;
- unreadable default output on the primary portrait fixtures.

### Deferred until after MVP

- automatic transcription provider UI and credentials;
- local Whisper/WebGPU model delivery;
- semantic LLM analysis;
- face/person detection and tracking;
- diarization and speaker styling;
- translation and bilingual tracks;
- Live Captions and OBS overlay;
- AE/Premiere caption interchange;
- alpha video formats;
- mobile high-resolution export;
- cloud projects, collaboration, accounts, billing;
- multiple source clips, B-roll, trimming, speed ramps, or NLE features;
- HDR/wide-gamut/pro mastering preservation;
- all legacy effects becoming caption-safe.

## 11. Post-MVP sequence

Do not begin these until Gate 7 is passed and MVP usage identifies the next bottleneck.

1. Add a transcription adapter interface and one provider with word timestamps.
2. Improve segment timing and emphasis using speech energy from existing audio analysis.
3. Add more conservative styles before adding more spectacular effects.
4. Add transparent PNG-sequence and professional escape-hatch exports if not already retained.
5. Evaluate manual avoid regions over time, then optional face tracking.
6. Build Live Captions from the same timed-token, segment, plan, and renderer contracts.
7. Revisit build/module organization only after the product boundary is stable.

## 12. Agent task template

Every coding-agent prompt should use this structure:

```text
Task ID and title:
Goal:
Why this task exists:
Allowed files:
Files that must not change:
Inputs/contracts:
Required behavior:
Acceptance checks:
Tests to add/run:
Manual verification:
Compatibility requirement:
Out of scope:
Expected PR/commit shape:
Escalate if:
```

Example:

```text
Task ID and title: G2.1 Caption segmentation engine v1
Goal: Convert validated timed tokens into readable, non-overlapping caption segments.
Why: Segmentation is the first product-specific transformation and must remain independent of ASR and visual effects.
Allowed files: src/08e_caption_segmenter.js, dev/caption_tests.js, caption fixtures.
Files that must not change: renderer, export, UI, lyric parser.
Inputs/contracts: Project schema v2 and TimedToken contract from G1.1/G1.2.
Required behavior: Candidate boundaries, scoring, manual-boundary preservation, diagnostics, language-aware width inputs.
Acceptance checks: All G2.1 checks in the implementation plan.
Tests to add/run: fast/slow/no-punctuation/numbers/repeats/CJK/invalid timing/locked boundaries.
Manual verification: Print or inspect segment reasons for the canonical fixture.
Compatibility requirement: No change to lyric planning output.
Out of scope: semantic model, ASR, visual technique selection, UI.
Expected PR/commit shape: one implementation commit and one fixture/test commit if helpful.
Escalate if: the timed-token contract cannot represent a required boundary or text measurement introduces renderer coupling.
```

## 13. Architecture decision records required

Create short records before merging decisions in these areas:

- ADR-001: mode and project schema/version policy;
- ADR-002: stable IDs and generated-versus-manual resolution;
- ADR-003: caption component safety metadata and default-deny policy;
- ADR-004: media demux/decode dependency and supported input baseline;
- ADR-005: output codec, audio preservation, and export fallback;
- ADR-006: preview clock and preview/export rendering parity;
- ADR-007: deterministic seed derivation for project and segment rerolls.

Each ADR states context, decision, alternatives considered, consequences, and tests that enforce it.

## 14. MVP release checklist

### Product

- [ ] Video Captions is usable end to end.
- [ ] Lyric Motion baseline remains usable.
- [ ] Live Captions has not leaked into MVP dependencies.
- [ ] Three style families are visibly differentiated.
- [ ] Default output is calm, readable, and caption-safe.

### Data and planning

- [ ] Schema and generator versions are stored.
- [ ] Stable token and segment IDs survive edits.
- [ ] Manual data remains distinct from generated data.
- [ ] Segmentation is deterministic and explainable.
- [ ] Visual planning is deterministic and budget-constrained.
- [ ] Locks and targeted rerolls behave exactly.

### Media

- [ ] Capability probe runs before unsupported operations.
- [ ] Preview uses video time as authority.
- [ ] Export uses the approved demux/decode path.
- [ ] Supported exports retain audio and synchronization.
- [ ] Cancellation and repeated export release resources.

### UX

- [ ] Transcript corrections, split, merge, emphasis, lock, and reroll require no JSON edits.
- [ ] Manual safe zone works.
- [ ] Save/reopen/relink works.
- [ ] Errors offer a useful next action.
- [ ] Reduced motion and accessibility checks are present.

### Quality and release

- [ ] Automated domain, visual, preview, and export tests pass.
- [ ] Fresh-profile acceptance test passes.
- [ ] Performance results are documented on named hardware.
- [ ] README and supported-media statement are accurate.
- [ ] Licenses and third-party notices are current.
- [ ] No critical/high known defect remains.

---

## 15. Final sequencing recommendation

The first code should not be a large editor rewrite or an ASR integration. The highest-confidence sequence is:

```text
baseline + fixtures
    → media export spike and caption aesthetic spike
    → project/timed-text contracts
    → safe registry metadata
    → segmentation/emphasis/zones
    → deterministic visual planner
    → caption-safe technique pack
    → source-video preview
    → minimum editor
    → production export
    → hardening and release
```

This sequence tests the hardest engineering risk early, keeps the original JIZURA engine intact, and ensures every agent works against stable contracts. It also protects the key product idea: calm, editable captions most of the time, with JIZURA's expressive vocabulary reserved for moments where contrast makes it meaningful.
