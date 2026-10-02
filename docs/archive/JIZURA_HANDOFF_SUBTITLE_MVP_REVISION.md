# JIZURA — Handoff: Subtitle MVP Scope Revision

**Purpose of this file:** carry decisions made in a planning conversation (claude.ai) into Claude Code, where the real codebase is visible.
**Audience:** Claude Code working inside the JIZURA repository.
**Status:** Gates 0–7 of `JIZURA_VIDEO_CAPTIONS_MVP_IMPLEMENTATION_PLAN.md` are already coded. The planning conversation had **no access to the code**, only to the two plan documents. Everything below about the code is inference from those documents. **Verify against the repo before acting on any of it.**

---

## 0. Instructions for Claude Code (read first)

1. Read this file, then `JIZURA_3_Mode_PRD.md` and `JIZURA_VIDEO_CAPTIONS_MVP_IMPLEMENTATION_PLAN.md` (if present in the repo/docs).
2. **Do not change any code yet.** Run the audit in section 6 and report findings.
3. Give a verdict: *refactor in place* (expected) or *restart the subtitle layer*, with evidence. Use the restart criteria in section 6.
4. Write a short **delta plan** (what exists, what changes, in what order) using real file and function names. Do not rewrite the original plan as if starting fresh.
5. Wait for approval before starting migration step 1.
6. Where this file and the code disagree, trust the code and tell me. Where this file and the older plan documents disagree, this file wins (section 9 lists the conflicts).

---

## 1. Product scope (revised)

JIZURA is a **subtitle/caption tool for one short-form video**. It is not a video editor.

**Fixed decisions (record as ADRs if not already recorded):**

- One video per project. **No trim, no speed change, no reordering, no multi-clip, no B-roll, no general timeline.**
- Because the video stays untouched, keep: a single time domain (token times = source-video times), original-audio passthrough where reliable, and the `<video>` element as the preview clock.
- **Live Captions, OBS, the `live/` companion, `liveSafe` metadata, and the PRD live sections are dropped completely.** Remove any code, metadata, docs, tests, or UI that exist only for live. Nothing should be "deferred" or "planned".
- **No PNG/GIF/sticker/image overlays and no user keyframes in the MVP.** Animation is preset-only (in / hold / out / active-word).
- Lyric Motion is preserved and must not regress.
- Portrait 9:16 remains the optimized target. Landscape should keep working where free, but is not a release gate.
- Style families for MVP: **Creator** and **Punchy**. **JIZURA / MV is deferred** until the layer/track model is proven.
- Automatic transcription is still not a release blocker, but see section 8 (recommended to pull one adapter forward).

**Cut or shrink from the old plan:** G3.3 (reviewed expressive subset) shrinks to primitives Creator and Punchy actually use; free word-boundary dragging, the dev debug overlay, and the Advanced diagnostics view are deferred; ADR list is cut to four (section 7); landscape tests are removed from gates.

---

## 2. New feature A: Precise placement (boxes replace zones)

**Problem:** zones (top/center/bottom/custom rectangle) are too coarse for "exactly where".

**Design:**

- Placement is a **box**, not a zone. A box has: anchor point (`x`, `y` in 0–1, normalized), `width` (normalized), `align`, `maxLines`. Normalized coordinates keep preview and export identical at any resolution.
- Social-UI safe areas become **guides and warnings only**. They do not decide position. The user does.
- Three override levels, using the existing generated-vs-manual separation: **style default → track-level box → per-segment override**.
- Layouts receive `env.box` instead of `env.zone`. A layout must **never move the anchor when the active word changes**.
- If a custom box causes overflow or crosses safe-area guides, **show a warning; never silently move the text**.
- **Direct manipulation on the preview canvas:** drag to move, handles to resize width, snapping to center lines / safe-area edges / thirds, numeric X/Y/width fields, arrow-key nudging. This is expected to be the largest new UI task.

---

## 3. New feature B: Text roles and style layers

### 3B. Roles (confirmed)

Each style defines **roles**, each with its own font, size, weight, case, and color:

- `base`
- `active` (the currently spoken word)
- `emphasis` (words with high emphasis score or manual emphasis)
- optional second font family

Role changes must not reflow the line unless the plan reserved the maximum geometry (existing active-word rule).

### 3A. Style layer stack (proposed — NOT yet explicitly confirmed by the product owner)

An ordered list replacing the single `treatment` string: `backplate → shadow → stroke → fill → glow`, each with color, size/width, offset. Recommended because it gives treatments a clean home and matches how modern caption tools work. **Ask the product owner to confirm before building it.** Roles (3B) can ship without it.

### Fonts

- MVP: **bundle a curated set of fonts with known, redistributable licenses.** This also fixes a determinism problem (text measurement depends on installed fonts, and segmentation uses text width).
- User-uploaded fonts: later, as a project-referenced asset with relink (same pattern as source video), with a licensing note.
- Avoid Google Fonts network loading (non-deterministic).

### Resulting visual plan shape

```text
plan
 ├─ box (placement; resolved from style → track → segment)
 ├─ roles: base / active / emphasis
 └─ styleLayers (if 3A confirmed): backplate → shadow → stroke → fill → glow
```

---

## 4. New feature C: Caption tracks (multiple simultaneous groups)

Up to **3 caption tracks** on screen at once, each in its own place.

```text
project
 ├─ transcript.tokens[]      one canonical source of words
 └─ tracks[]  (max 3)
     ├─ id, name, zOrder
     ├─ box
     ├─ style (roles + style layers)
     └─ segments[] → visual plans
```

Each track has its own box, style, segmentation, and plans. Tracks overlap freely in time.

### How words get into a track (decision made)

| Option | Decision |
|---|---|
| 1. **Manual assignment** — user selects words/segments in the transcript and moves them to a track | **SHIP in MVP** |
| 2. By speaker (`speakerId`) | Schema ready only (field exists); no feature |
| 3. **Manual text blocks** — user types text with start/end (title, note, translation line) | **SHIP in MVP** |
| 4. Automatic keyword track | **DEFER** (planner feature, post-MVP) |

### Manual text blocks — rules

Keep them deliberately plain, so they do not become a general text tool:

- Fields: text, start, end, track, box, style, preset animations (same enter/hold/exit presets). **No keyframes, no free-form animation, no images.**
- Represented as tokens with `source: "manual"` living in a track. Suggested: `timingQuality: "manual"`; words inside the block may be spread evenly for active-word state, or the block may render as one unit with no active-word behavior (decide during audit based on what the renderer supports).
- A manual block is one segment with `segmentation` locked by default (the segmenter must not split it unless the user edits it).
- Users may create, edit text/timing, move between tracks, and delete blocks. Add commands for each (section 5).

### Invariants and rules

- **Every included token belongs to exactly one segment in exactly one track** (replaces the old "exactly one segment" rule). Duplicating a token across tracks (echo effect) is out of scope.
- There is a **default primary track** that cannot be deleted. Deleting another track returns its tokens to the primary track (confirm this rule during audit; it must be undoable).
- **Motion/attention budget is global across all tracks** (rolling window), never per track. Otherwise three tracks each spend a full budget and the screen gets loud.
- **Collision warning:** if two track boxes overlap at the same moment, warn. Do not move anything.
- Segmentation runs **per track over that track's tokens only**. Locked/manual boundaries survive re-planning.
- Locks and rerolls still work per segment. Add "reroll track".
- Compositor draws tracks in fixed z-order. Export consumes the frozen plan list unchanged.
- Placement tool edits the selected track's box; other tracks display as ghost outlines.
- Timeline: one row per track (plus video and playhead).

---

## 5. Data and command changes

**Schema (bump `schemaVersion`; write a real migration):**

- Add `tracks[]`. Migrate today's single segment list into one default track. Derive its `box` from the current zone. Default `roles` (and `styleLayers`, if confirmed) so the current look is **reproduced exactly**.
- `segments` and `plans` gain `trackId` (or live inside their track — decide during audit based on how they are stored today).
- `safeZones` become `guides` (advisory).
- Keep `generated` vs `manual` separation for box, roles, layers.
- Keep stable IDs. Never derive IDs only from array position.

**New store commands (all undoable; undo must restore IDs, timing, locks, overrides exactly):**

- `addTrack`, `removeTrack`, `renameTrack`, `reorderTrack`
- `setTrackBox`, `setSegmentBoxOverride`, `setTrackStyle`, `setRole`
- `moveTokensToTrack` / `moveSegmentToTrack`
- `createTextBlock`, `editTextBlock`, `deleteTextBlock`
- `rerollTrack` (in addition to existing segment reroll)

**Seeds:** derive deterministically, e.g. hash(projectSeed, trackId, segmentId, rerollCounter). **Decide this before touching the planner.** No uncontrolled `Math.random()`.

---

## 6. The audit (do this first, report back)

Answer with file names, counts, and evidence:

1. Where does `zone` appear? How many files? Passed as a parameter or read from global state?
2. Is `treatment` a single string consumed in one place, or spread across layouts and the renderer?
3. Do project, segment, and plan objects have stable IDs and separate `generated`/`manual` fields as the plan required?
4. Can store commands be extended with `trackId` without rewriting them? How is undo implemented?
5. How many tests exist for determinism, locks, and project round-trip? Do they pass today? Paste the summary.
6. Does export consume a plan list, or assume one caption list?
7. Did the browser export decision (H.264/AAC in Chrome) hold on real Chrome? What is the documented supported path? Are export tests run in real Chrome (headless/open-source Chromium often lacks H.264 encode)?
8. How is the build assembled (sorted concatenation)? Are workers used for demux/decode/encode? Is the build strategy causing pain?
9. How is text measured, and which fonts does it depend on? Would two machines produce different segmentation?
10. Is any live-related code present that should be removed?
11. Where does the code diverge from the plan documents? (Filenames, data shapes, merged modules.)

**Restart the subtitle layer only if the audit finds one of these:**

- the renderer is so coupled to the old plan shape that changing it means rewriting most of the render path;
- no real IDs or generated/manual separation, so the store and every command would be rewritten;
- thin or absent tests, so a refactor would be blind (in this case, write characterization/snapshot tests first, then reassess);
- the code is far from the plan (shortcuts, merged modules, no determinism).

**Expected outcome:** none of these apply, and the media/export work (demux, decode, audio passthrough, encode/mux, cancellation, capability probing, relink, preview clock) survives untouched.

---

## 7. Refactor path (each step leaves the app working)

**Step 0 — Safety net.** Snapshot tests of current plans and rendered frames from the existing fixtures, plus the Lyric Motion smoke test. Nothing proceeds without these.

**Step 1 — Schema migration only.** New `schemaVersion`, one default track, box derived from zone, roles/layers defaulted to reproduce today's look. **Existing projects must render identically.** Remove live code in this step or a separate cleanup PR.

**Step 2 — Route planner and renderer through the new shape** with no behavior change (still one track).

**Step 3 — Placement boxes** replace zones as the source of position. Add the canvas placement tool (drag, resize, snap, numeric, nudge), guides and warnings.

**Step 4 — Roles** (and style layers if confirmed) in the renderer and inspector.

**Step 5 — Multiple tracks:** manual assignment UI, global motion budget, collision warnings, timeline rows, ghost outlines, reroll track.

**Step 6 — Manual text blocks** (plain, preset animations only).

**Step 7 — Re-run export verification and the release matrix** (old Gates 6 and 7) once at the end. Export consumes a frozen plan, so it should need little change beyond drawing multiple tracks in z-order.

Steps 1 and 2 are deliberately invisible refactors so regressions are easy to spot.

**Reduced ADR list (four):** (1) project schema, IDs, and generated-vs-manual; (2) caption component safety metadata and default-deny; (3) media path and output/audio policy; (4) seeds and determinism (including font measurement pinning). Do the seeds ADR first.

---

## 8. Gaps flagged in review (still open)

- **ASR:** the target user will not hand-produce word-timestamp JSON. Recommend pulling one transcription adapter forward (even local Whisper via a helper) or at least a very good import-first flow. Do not couple the schema or planner to any provider.
- **Export strategy:** verify the browser-vs-companion decision on real Chrome; document the fallback. (This is a media-export companion question only; it has nothing to do with the dropped live companion.)
- **Bundling/workers:** force an explicit decision (ADR or note) if workers are needed and sorted concatenation is painful.
- **CI codecs:** export tests need real Chrome with H.264 support; state how CI handles this.
- **Determinism caveat:** "same inputs → same plan" only holds if text measurement is pinned (bundled fonts or recorded metrics). Say so in the docs.
- **Cheap wins to add:** SRT/VTT **export** (sidecar) and **autosave/crash recovery**.
- **Success metrics:** add quantitative ones (e.g., time from import to first export, number of manual edits per minute of video).

---

## 9. Inconsistencies between the old documents (resolve in favor of the plan + this file)

- Segment `status`: PRD `draft | committed | locked` vs plan `generated` + a `locks` object → **use the plan's version**.
- Token contract: PRD has `final`, `revision`, numeric `emphasis`; plan has an emphasis object with reasons and no live fields → **use the plan's version**; drop live-only fields.
- Filenames: PRD `src/09_project_model.js` etc. vs plan `src/08c_project_model.js` etc. → **use the repo's actual names** and record the mapping.
- The plan cites `JIZURA Fork Planner - PRD.pdf`, which was not available to the planning conversation.
- `schemaVersion: 2` implies a v1 (the lyric project format) that the plan does not describe → document it during the audit.
- Mark the PRD's live sections (9.3, 9.4, 10, Phase 4, and live references elsewhere) as **removed**.

---

## 10. Open questions for the product owner

1. **Style layer stack (3A):** confirm or drop. Default recommendation: include, since it replaces the single `treatment` string.
2. **Placement granularity:** default is **block-level** (a whole caption block is positioned). Per-word positioning is not planned. Confirm.
3. Manual text blocks: active-word behavior inside a block, or render as one unit? (Can be settled after the audit.)
4. Should deleting a track return its tokens to the primary track (proposed default)?

---

## 11. Suggested first message to Claude Code

> Read `docs/handoff.md` (this file) and the two plan documents. Do not modify any code. Run the audit in section 6 and report: answers to each question, a refactor-vs-restart verdict with evidence, the mapping between plan filenames and real filenames, and a short delta plan following section 7. Then stop and wait for my approval.
