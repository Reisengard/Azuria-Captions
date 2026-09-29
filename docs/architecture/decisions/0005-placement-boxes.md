# ADR 0005: Placement boxes replace zones as the source of position

- Status: accepted
- Date: 2026-09-28
- Scope: `src/08i_caption_boxes.js`, `08h_caption_planner.js`, `11c_caption_compositor.js`, `11p_caption_layouts.js`, `12b_caption_store.js`, `12c_caption_workbench.js`.

## Decision

1. **Position = a normalized box.** Order of precedence: segment override (`plan.manual.box`) → track box (`track.box`) → style default. The style default only applies to a track box that was never edited (`box.manual !== true`); it is recomputed when the position preset changes or media is imported.
2. **The planner does not pick positions.** `planCaptions` resolves one box per segment (`J.captionEffectiveBox`); the old `zones[h(seed, attempt, 7) % n]` choice is gone. If text does not fit, the plan falls back to a static style **inside the same box** and the readability result carries the warning; the box never moves.
3. **Plans carry both `box` (normalized) and `zone` (pixels).** `zone` is derived from `box`; it stays because readability, tests and plans saved before this step use it. The compositor draws from `plan.box` when present and otherwise from the saved pixel `zone` (rescaled), so **existing projects render identically until they are re-planned**. Re-planning moves unlocked captions into the track box (seed-driven layout choices may change with it, as the plan snapshots show).
4. **Layouts take `box`** (with `frame`) besides `zone`. Geometry depends only on text, font and box, never on the active word (tested).
5. **Commands** `set-track-box` (`box` | `reset: true`) and `set-segment-box` (`box` | `null`). Both validate (`CAPTION_BOX_INVALID`, never clamp), re-plan, and are undoable through the existing snapshots. `set-segment-box` respects `visualPlan` and `box` field locks. Overrides live in `manual`, so re-planning cannot overwrite them.
6. **Warnings, not movement.** `J.captionBoxWarnings`: `box-outside-safe-area`, `box-narrow`; overflow/too-many-lines come from readability. The workbench lists them next to the box tool.
7. **Canvas tool**: drag to move, right handle for width, numeric X/Y/W/H, arrow-key nudge (Shift = larger), snap to centre lines / social-safe edges / thirds (Alt = free). Keyboard nudges and dragging stop at the frame edge; typed values outside the frame are rejected with a message.

## Consequences

- `safeZones` still exist (they feed the default box and `guides[]`); they no longer choose positions.
- Height is editable as well as X/Y/width (the plan only required X/Y/width).
- Step 6 (multiple tracks) reuses `track.box`, `plan.manual.box` and `J.captionEffectiveBox`; the compositor will need per-track z-order.
