# ADR 0010: Timing rules live in the store; spoken words overlap per track

- Status: accepted
- Date: 2026-10-02
- Scope: `src/08k_caption_tracks.js` (`captionSegmentFits`, `captionTrackOverlaps`), `12b_caption_store.js` (commands), `10_timed_text.js` (overlap rule), `08a_project.js`, `08f_caption_emphasis.js`, `08h_caption_planner.js`
- Plan: `captions-editor-rework-plan.md` step E1 (decisions 1, 2, 3)

## Decision

1. **One timing rule.** `J.captionSegmentFits(project, segment, start, end, trackId, { fit })` answers whether a caption may sit at `[start, end]` on a track: inside `[0, duration]`, at least 0.1 s long, no overlap with another caption on that track, and (unless `fit`) the window contains the caption's words. It returns `{ ok: true }` or `{ ok: false, code }` with `SEGMENT_TIMING_INVALID`, `TRACK_SEGMENT_OVERLAP` or `SEGMENT_WORDS_OUTSIDE`. Every timing command uses it; the UI no longer repeats the rules.
2. **Commands** (all undoable through the snapshot undo):
   - `move-segment { segmentId, start, trackId? }` — the caption and its words shift together (rework decision 1); optionally changes track in the same step. A text block goes through `edit-text-block`. A track change re-plans that caption only; a pure time shift keeps the plan.
   - `trim-segment { segmentId, start?, end?, words: 'keep' | 'fit' }` — `keep` refuses to cut a word; `fit` scales the words into the new window and marks them `estimated`. `set-segment-timing` stays as an alias (`keep`).
   - `split-segment { segmentId, time }` — splits in the word gap containing the time (a time inside a word goes to the nearest gap). A typed block may be split too; each half re-spreads its words.
   - `delete-segment { segmentId }` — deletes any caption, its plan and its words (rework decision 3). `delete-text-block` stays and still refuses speech.
   - `edit-segment-text { segmentId, text }` — same word count keeps IDs, times and emphasis; otherwise only the changed run is re-spread inside the time the old run covered (`estimated`). A pure insertion between words with no gap borrows the neighbouring word's time so every word stays visible.
   - `retime-tokens { segmentId, times }` — word times from tap sync; the window grows to hold them when that is free.
   - `batch { commands, label? }` — several commands as one undo step, all or nothing (no nesting).
3. **Spoken words overlap per track.** `J.validateTranscript` now takes `options.segments`; spoken words must not overlap *within the same track* (unowned words count as the primary track). Without segments the old single-lane rule applies. Words of typed blocks stay exempt (ADR 0007). The planner's emphasis pass passes `ignoreUnowned`, because a caption planned alone cannot see every word's track.
4. **Loading is not stricter.** Captions of one track that overlap in an old file still load and render as before; `J.captionTrackOverlaps(project)` reports them as advisory warnings (like `captionBoxCollisions`). Only commands refuse.

## Consequences

- The rule only gets weaker for transcripts, so every project that loads today still loads.
- `transcript.tokens` is re-sorted (stable, by start) after a move or text edit, so words of different tracks may interleave in the array.
- Nothing here draws random values; IDs are kept, so a move does not change a caption's look.
- Not yet used by the UI: dragging (T3+), tap sync (C-steps). `applyTiming` now sends `trim-segment` and relies on the store's refusals.
