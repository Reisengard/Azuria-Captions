# ADR 0003: Seeds and determinism

- Status: accepted
- Date: 2026-09-28
- Scope: Video Captions planning and rendering (`08e`–`08h`, `11c`, `11p`, `12b`). Lyric Motion keeps its own seeding.

## Decision

1. **Same inputs → same plan.** Planning is a pure function of the project (transcript, segments, style, locks, manual overrides), the frame, `project.seed`, and the per-scope reroll counter. Caption code must not call `Math.random()` or read the clock while planning or drawing.
2. **All randomness comes from `J.h(...)`.** The per-scope seed today is
   `hashSeed(projectSeed, segmentId, rerollCount, CAPTION_PLANNER_VERSION)` (`src/08h_caption_planner.js`).
   When tracks land (step 2/6) the hash gains the track:
   `hashSeed(projectSeed, trackId, segmentId, rerollCount, CAPTION_PLANNER_VERSION)`.
   `J.h` takes at most five numeric keys and strings go through `J.sid`, so the track and segment IDs are folded with `J.sid` and the key order above is fixed. The default (primary) track uses a stable ID so that migrated v2 projects can keep producing identical plans; if the seed function changes shape, `CAPTION_PLANNER_VERSION` is bumped and the plan snapshots are regenerated deliberately.
3. **Reroll is explicit.** Only `rerollCount` (per segment, later per track) changes a seed. Re-planning without a reroll reproduces existing generated values. Manual and locked values are never re-randomized.
4. **The user decides placement.** The planner must not pick a zone/box randomly per attempt (step 4). Until then the existing zone choice stays, because it is seeded and covered by the plan snapshots.
5. **Font measurement is pinned (step 5).** Planner readability uses a fixed glyph-width estimate (deterministic); the renderer uses real canvas metrics, which vary with the loaded font. Fonts will be bundled and measurement pinned so layout is identical across machines. Until then, layout may differ between machines when web fonts fail to load; the workbench already warns when a font is not available.
6. **Guard rails.** `dev/caption_plan_snapshot_test.js` freezes plans (6 scenes: portrait/landscape × creator/punchy/jizura-mv) and `dev/caption_visual_regression.js` freezes rendered frames. Refactor steps must keep both green; an intended change updates them with `--update` in the same commit and says why.

## Consequences

- A step that changes plan output for existing projects is a migration bug unless the delta plan says otherwise.
- New planning code that needs randomness takes a seed argument; it never creates its own source.
