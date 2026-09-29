# ADR 0006: Caption tracks (up to three, manual assignment)

- Status: accepted
- Date: 2026-09-28
- Scope: `src/08k_caption_tracks.js` (helpers, warnings, track style), `12b_caption_store.js` (commands, validation), `08h_caption_planner.js` / `08h_caption_motion.js` (budget, seeds), `08e_caption_segmenter.js` (per-track re-segmentation), `11c_caption_compositor.js` (layers), `12c_caption_workbench.js` (UI).

## Decision

1. **Data.** `project.tracks[]` (1-3, schema v3, ADR 0004). Segments and plans carry `trackId`. A token is in **at most one segment** (validator `SEGMENT_TOKEN_DUPLICATE`); a segment is on exactly one track. `project.segments` stays sorted by start across all tracks (ties: track order); the store re-sorts after every command when there is more than one track.
2. **Rows.** Within a track, segments must not overlap in time (only one caption per track is on screen). Commands that change a track refuse an overlap (`TRACK_SEGMENT_OVERLAP`); across tracks overlap is normal. Neighbours (boundary drag, merge, timing limits, the timeline handle) are looked up **per track** (`J.captionTrackNeighbor`).
3. **Commands** (kebab-case, all undoable through the existing snapshots): `add-track`, `remove-track`, `rename-track`, `reorder-track`, `set-track-box`, `set-segment-box`, `set-track-roles` (the last three already existed), `set-track-style`, `move-segment-to-track`, `move-tokens-to-track`, `reroll-track`. The delta plan's camelCase names map one to one.
   - `remove-track` **deletes the track's captions, plans and the words on them** from the transcript (D4); the primary track cannot be deleted. Undo restores tokens, segments, plans, timing and locks exactly.
   - `reorder-track` sets the z-order. The primary track is always first (bottom); later tracks are drawn on top, in array order.
   - `move-tokens-to-track` turns each run of moved words into a new segment on the target track; the words left behind keep the segment (and its plan) and are split in two when the moved words sat in the middle. Outer timing is kept. Segments touched must have both `segmentation` and `visualPlan` unlocked (`SEGMENT_FIELD_LOCKED`): a move is never done silently around a lock. `plan.manual` (a box override) stays with the caption.
   - `set-track-style` overrides a small, validated subset of the project style per track (`preset`, `captionTreatment`, `accentColor`, `alignment`, `writingMode`, `motion`, `intensity`, `emphasisStrength`, `segmentation`); null clears a field, `reset` clears all. It re-plans. The motion **budget** is never per track.
4. **Planner.** Plans are made in time order across all tracks, so `recentPlans` (rolling attention window, repetition, adjacent-hero check) is **global**. Continuity (font/position/... "fixed"/"sticky") compares a caption with the previous caption **of its own track** (`previousPlan`, passed explicitly; `evaluateCaptionMotionPlan` only falls back to the global predecessor when the key is absent, which keeps older callers unchanged).
5. **Seeds.** The primary track keeps `hashSeed(seed, segmentId, reroll, version)`, so single-track projects plan exactly as before (plan snapshots unchanged). Other tracks use `hashSeed(seed, trackId, segmentId, reroll, version)` (ADR 0003 §2). `reroll-track` bumps `rerollCount` for the track's unlocked captions only and keeps every other plan.
6. **Segmentation runs per track** over that track's words (`J.replanCaptionSegments`): locked/manual boundaries survive, new IDs never collide across tracks, a word no segment owns yet goes to the primary track. With one track the old code path is used unchanged.
7. **Compositor.** `drawCaptionOverlay` draws every track's current caption in track order (`J.captionSegmentsAt`), after the video notes. It returns the first layer in the old shape plus `layers`. Export uses the same function, so it needs no change. Projects without `tracks` (bare fixtures) draw one caption as before.
8. **Warnings, not moves.** `J.captionBoxCollisions` reports two captions from different tracks that share screen time and screen area (`track-box-collision`). It is derived (not stored) and never moves a box.
9. **UI.** Track list (add / rename / forward / back / delete with confirm / reroll / style), one timeline row per track, other tracks' boxes as dashed ghost outlines while a box is edited, per-word "move" checkboxes plus "move caption" in the inspector, a collision line in the track panel and in the caption's warnings. The box and role panels edit the **active track** (picked in the list, or that of the selected caption).

## Consequences / known gaps

- ~~The transcript validator still rejects two tokens that overlap in time.~~ Resolved in step 7 (ADR 0007): words of a manual text block may overlap speech; a block must not overlap a caption on its own track.
- Deleting a track deletes words from the transcript. Re-importing the transcript file brings them back (and resets every caption to the primary track).
- Density changes re-segment every track with the project-wide word limit unless the track has its own `segmentation` style.
- ~~A caption with locked segmentation still pins only its boundaries against re-segmentation.~~ Resolved in step 7 (ADR 0007 §8): a segmentation-locked caption is kept whole.
