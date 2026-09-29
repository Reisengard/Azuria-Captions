# JIZURA

Browser app (single-file HTML per language) with two working modes: **Lyric Motion** (must not regress) and **Video Captions** (subtitles for one short-form video).

## Source of truth
- `docs/architecture/subtitle-mvp-delta-plan.md` — decisions, audit findings, filename mapping, step plan with status. **Read this first** and update step status when a step finishes.
- `JIZURA_HANDOFF_SUBTITLE_MVP_REVISION.md` — original scope revision; the delta plan overrides it where they differ.
- `docs/architecture/decisions/` — ADRs.
- Where docs and code disagree, trust the code and fix the doc.

## Build
- `src/*.js` are concatenated in **sorted filename order** by `build.py` (no bundler, no modules). Global namespace is `J`. New files must be named so they sort after their dependencies (e.g. `08i_...`).
- `python build.py` regenerates all 7 edition `index.html` files + `sitemap.xml`. Never hand-edit those generated files.
- `python build.py --dev` also writes `dev/www/` (gitignored) for the test tools.
- User-facing strings live in `app/` (`body.html`, `english.py`, `i18n_*.py`); localized builds are tested by `dev/localized_build_test.py`.

## Tests
- Run from `dev/` (`npm install` once). `npm test` runs the chain; run single suites with `node <name>_test.js` or the `test:*` scripts in `dev/package.json`.
- Run suites individually when checking a change: the chain stops at the first failure.
- Lyric Motion guard: `node lyric_smoke.js`. Caption visual snapshots: `node caption_visual_regression.js` (`--update` only when a visual change is intended).
- Export tests use mocks; real H.264 export must be checked in real Chrome.

## Rules for this refactor
- Do one step of the delta plan at a time; each step leaves the app working and tests green.
- Existing projects must load and render identically after a schema migration.
- Determinism: same inputs → same plan. No uncontrolled `Math.random()`; seeds come from `J.h(...)` with project seed, IDs and reroll count.
- Store commands must be undoable and restore IDs, timing, locks and overrides exactly. Keep generated vs manual separation; manual and locked values survive re-planning.
- Never silently move text: overflow / safe-area problems produce warnings.
- Video edits (trim, panels, formats, notes) are kept; caption times are source-video times.
- Ask before committing or pushing; commit per step, not mixed with unrelated changes.
- Unrelated scratch files (e.g. `audio_transcript.json`) are intentionally untracked.
