# ADR 0007: Manual text blocks

- Status: accepted
- Date: 2026-09-28
- Scope: `src/08l_caption_text_blocks.js` (helpers), `12b_caption_store.js` (commands, validation), `10_timed_text.js` (overlap rule), `08f_caption_emphasis.js` (scoring streams), `08e_caption_segmenter.js` (locked captions kept whole), `12c_caption_workbench.js` (UI).

## Decision

1. **What a block is.** Text the user types with a start and end (a title, a note, a translation line). It is **one segment on one track** whose words are tokens with `source: "manual"` and `timingQuality: "estimated"`, spread evenly over the block (D3: active-word behaviour stays on). "Is a text block" is derived, not stored: every word on the segment is `manual`. Captions made by the older `add-caption` command therefore count as blocks and can be edited the same way; no migration is needed.
2. **Commands** (kebab-case, undoable through the existing snapshots):
   - `create-text-block` `{ text, start, end, trackId?, box?, animation?, segmentId?, lockSegmentation? }`. No `trackId` = primary track. `add-caption` is kept as an alias. Segmentation is **locked by default** (`lockSegmentation: false` opts out).
   - `edit-text-block` `{ segmentId, text?, start?, end?, trackId?, box? (null clears), animation? }`. Changing text or timing re-spreads the words. Word IDs are kept by position (extra words get new IDs, dropped words leave the transcript); a word keeps its manual emphasis while its text is unchanged.
   - `delete-text-block` `{ segmentId }` removes the segment, its plan and its words. Speech captions are refused (`SEGMENT_NOT_TEXT_BLOCK`).
   - `move-segment-to-track` on a block moves it whole (through `edit-text-block`); the default segmentation lock is not a reason to refuse. `move-tokens-to-track` still refuses locked captions, so a block's words are not split off.
3. **Overlap rules.** Spoken words (imported/transcribed) still never overlap each other (`TOKEN_TIMING_OVERLAP`). Words of a block may overlap speech and other blocks: `J.validateTranscript` skips `manual` tokens in its overlap check. A block must not overlap another caption **on its own track** (`TEXT_BLOCK_OVERLAP`), which keeps "one caption per track on screen" (ADR 0006). This closes the gap noted in ADR 0006.
4. **Locks.** The segmentation lock only guards the segmenter. Text edits respect the `tokenText` field lock; timing respects `timing` / `start` / `end`; box, animation and track changes respect the `visualPlan` lock and the `box` / `animation` / `trackAssignment` field locks.
5. **Placement and style.** A block's box is `plan.manual.box` (same rules as `set-segment-box`, ADR 0005); without one it follows its track's box. Its style is its track's style and roles (ADR 0006); there is no per-block style layer (D1).
6. **Preset animations only.** `animation: { enter, hold, exit }` writes `plan.manual.entrance / hold / exit`. Each value is a registry id that passes `J.captionComponentEligibility` (caption-safe), or `null` = let the planner choose. No keyframes, no free-form motion, no images. `J.validateCaptionProject` rejects an unsafe id in a saved project (`CAPTION_TECHNIQUE_UNSAFE`). The UI offers the presets of the track's style profile. A manual choice is the user's and is not re-checked against the motion budget, like the existing per-caption animation switch.
7. **Planning.** Creating or editing a block plans **only that block** (as `add-caption` always did), so the other captions keep their look. A later full re-plan treats the block like any other caption (it keeps its `manual` fields and reroll count).
8. **Segmenter.** A segmentation-locked caption is now kept whole: its edges were already forced, and nothing is planned inside it any more. Before this, a long locked caption could still be split inside when the word limit dropped.
9. **Emphasis.** Speech and typed blocks are scored as two separate streams, so a title laid over speech does not change the sentence-start / repetition context of the spoken words, or the reverse. Projects without blocks score exactly as before (plan snapshots unchanged).

## Notes vs text blocks (the open question from §1 of the delta plan)

They stay separate. **Video notes** (`settings.videoEdit.notes`) belong to the video edit (D5): simple annotations with a normalized x/y, drawn under the captions, with no track, box, plan, animation preset or active word. **Text blocks** are captions: they live on a track, are planned, obey placement boxes, roles, warnings and the motion budget, and are exported with the captions. Nothing converts one into the other; a user who wants a styled, timed line uses a block.

## Consequences

- The transcript badge shows "estimated timing" once a block exists (unchanged from `add-caption`).
- A block overlapping speech on the primary track is refused; the user picks another track. Tracks are created by the user (up to three), so the first overlapping title needs a second track.
- Deleting a track deletes the blocks on it (D4), like any other caption on that track.
