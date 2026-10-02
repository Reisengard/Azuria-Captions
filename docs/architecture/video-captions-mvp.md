# Video Captions MVP architecture

This document is the implementation contract for adding Video Captions without changing the existing Lyric Motion product. The detailed product sequence lives in `docs/archive/JIZURA_VIDEO_CAPTIONS_MVP_IMPLEMENTATION_PLAN.md`; this page records the repository-specific baseline that future slices build on.

## Baseline

- Baseline commit: `8da975fb362d966b065217618aedafd5a35a39e0`
- Upstream: `https://github.com/852wa/JIZURA.git`
- Application version at baseline: `0.9.0`
- Browser baseline: latest desktop Chrome/Chromium
- License and attribution: MIT; retain `LICENSE` and `THIRD_PARTY_NOTICES.md`

The browser application is assembled from lexically sorted `src/*.js` files. The numeric filename prefixes are therefore dependency ordering, not decoration. `build.py` embeds the engine, localized UI, CSS, and the pinned MP4 muxer into standalone HTML editions.

Generated release artifacts are committed in this repository: the localized `index.html` files, AE bundles, and release CEP archives. Do not include regenerated artifacts in a source-only caption change unless that change is intended for release. When they are updated, keep source changes and generated output separable in review.

## Reproducible commands

Run commands from the repository root with Python 3 and Node.js available.

```text
python build.py
python build_ae.py --lang en
python build_cep.py --lang en --out dist
node dev/lyric_smoke.js
node dev/fixture_check.js
```

`python build.py --dev` additionally creates the local browser test bundle in `dev/www/`. The broader AE mock tests require the pinned development dependency first:

```text
cd dev
npm ci
node ae_test.js
```

Browser rendering sweeps in `dev/smoke_all.py` additionally require Python Playwright and its Chromium runtime; they are optional developer diagnostics, not the dependency-free baseline smoke check.

## Current project contract

Lyric Motion projects are plain JSON based on `J.defaultProject()`:

- the current project marker is `version: 1`;
- saved files add `appVersion` while the loader discards that field after reading;
- project loading merges known defaults and sanitizes locks, colors, fonts, user fonts, and per-line overrides;
- browser autosave uses the key `jizura.project.v1`;
- audio bytes are not embedded in a project file;
- there is no general schema migration or future-version rejection boundary yet.

Those limitations describe the baseline, not the target caption schema. Caption project validation, migrations, and mode dispatch belong in Gate 1. Existing lyric projects and their planner output must remain compatible.

The dependency-free regression command `node dev/lyric_smoke.js` loads the same sorted source files (excluding the DOM UI entry point), plans `dev/fixtures/lyrics/smoke-project.json`, and compares a deliberately narrow structural snapshot. The snapshot covers timing, seeds, and selected techniques without freezing incidental render data.

Caption data and media recipes live under `dev/fixtures/`. Run `node dev/fixture_check.js` to validate the canonical word transcript, equivalent SRT/VTT text, deliberate invalid cases, and media manifest. Run `dev/fixtures/media/generate.ps1` on a machine with FFmpeg to materialize the synthetic H.264/AAC clips in the ignored `generated/` directory. The manifest is the source of truth for expected duration, dimensions, frame rate, codecs, audio, transcript, license, and provenance.

The Gate 0 media feasibility result and selected production pipeline are recorded in [ADR 0001](decisions/0001-browser-media-export.md). `dev/media_spike.html` is disposable evidence only; it is not a production media module.

The Gate 0 caption-motion direction and visual QA findings are recorded in [ADR 0002](decisions/0002-caption-aesthetic-spike.md). The aesthetic spike is likewise disposable: production layouts and motions must enter through the shared registry, measurement, planner, and renderer contracts.

## Product boundaries

The direction of dependencies is fixed:

```text
input adapters
  -> canonical project and timed text
  -> segmentation and emphasis
  -> caption visual planner
  -> existing registry and renderer
  -> preview or export compositor
```

Keep the existing engine responsible for fonts, measurement, seeded choice, techniques, planning primitives, and Canvas rendering. Add caption-specific project data, timed tokens, segmentation, emphasis, safe zones, budgets, styles, editing, and media orchestration in separate modules. The renderer may receive a source frame; it must not demux media or transcribe speech.

The first supported caption path is one already-edited local video plus imported word-timestamp JSON. Automatic transcription, Live Captions, face tracking, translation, collaboration, mobile export, AE caption parity, and nonlinear video editing are not MVP requirements.

## Change rules

- Preserve Lyric Motion behavior and run `node dev/lyric_smoke.js` for shared-engine changes.
- Keep planning deterministic; do not introduce uncontrolled `Math.random()` into planners.
- Keep generated choices separate from manual overrides and locks.
- Default-deny legacy techniques for captions until capability metadata marks them caption-safe.
- Keep user-facing strings localizable.
- Pin and attribute any new third-party dependency.
- Treat media capability failures as product states with actionable guidance.

