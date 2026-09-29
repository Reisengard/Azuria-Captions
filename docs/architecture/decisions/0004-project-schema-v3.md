# ADR 0004: Project schema v3 (tracks, boxes, IDs, generated vs manual)

- Status: accepted
- Date: 2026-09-28
- Scope: `src/08a_project.js` (envelope + migration), `src/12b_caption_store.js` (validation, commands), planner/segmenter stamping.

## Decision

1. **One schema version for both modes.** `J.PROJECT_SCHEMA_VERSION = 3`. Lyric projects migrate v2 → v3 by version bump only. `J.loadProject` migrates v2 explicitly (`J.projectMigrations.v2ToV3`), never mutates its input, and rejects anything newer than 3. `J.validateProject` accepts v3 only.
2. **`tracks[]`** (video-captions only): 1–3 tracks, unique string IDs, exactly one `primary: true` and it is first (undeletable, see D4/D9 in the delta plan). A track is `{ id, name, primary, box, style, roles }`.
   - `box` is **normalized (0–1)** `{x, y, width, height}` (+ `zoneKind` as provenance) so it follows the output format (D2, D6). Block-level only; no per-word position.
   - `style` and `roles` (`base` / `active` / `emphasis`) start **empty = inherit** `project.style` and the plan's resolved fields, which is what reproduces today's look. Steps 4–5 give them content.
3. **`trackId` on every segment and every plan.** The primary track ID is the constant `J.CAPTION_PRIMARY_TRACK_ID = 'track_main'`. Segmenter, `add-caption` and the plan skeletons stamp it; the validator rejects a segment whose track does not exist and a plan whose track differs from its segment's.
4. **Migration derives, it does not re-plan.** The primary box is the first zone the planner would consider for the project (saved valid `safeZones`, else the style's zone kinds) divided by the frame size. Segments/plans are copied byte-for-byte plus `trackId`. Tests assert that the migrated project re-plans to the same plans.
5. **`safeZones` stay for now, `guides[]` mirror them.** Pixel `safeZones` still feed the planner and compositor until step 4 replaces zones by boxes. `guides[]` is the normalized, `advisory: true` copy (kept in sync by the `set-safe-zone` command). They never decide placement.
6. **Generated vs manual is unchanged**: `plans[segmentId] = { generated, manual, lockedFields }`. Track-level and segment-level box/style overrides (step 4) go in `manual`-style override slots, never into `generated`, so re-planning cannot overwrite them.
7. **Seeds are not changed here.** The ADR 0003 seed gains `trackId` in step 6; the default track must keep today's seeds so existing projects render identically.

## Consequences / known gaps

- A freshly created empty project derives its default box from the fallback 1080×1920 frame because no media is attached yet; the box is advisory until step 4, so nothing renders differently. Step 4 must recompute an untouched default box when media is imported.
- Older builds refuse v3 files (`UNSUPPORTED_SCHEMA_VERSION`); there is no downgrade path.
