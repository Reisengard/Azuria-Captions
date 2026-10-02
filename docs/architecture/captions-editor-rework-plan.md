# JIZURA — Video Captions editor rework plan

Status: **approved by the owner** (2026-10-01); all eight decisions in §8 are accepted. Nothing here is implemented yet.
Where the work happens: in a **new, separate repository** created from this project, so the current repository is not affected. E0 starts there, in a new session; see §9 "Before E0".
Scope: Video Captions only. Three areas: the **timeline**, **caption creation / editing / syncing**, and the **interface**.
Relation to `subtitle-mvp-delta-plan.md`: this plan replaces its open items UI-3, UI-4 and UI-5. The delta plan's rules still apply (one step at a time, tests green, undo exact, determinism, no silent text movement, caption times are source-video times).

Decisions are marked **[DECIDE n]** where they apply and collected in §8. All were accepted as recommended, so the text of this plan is what will be built.

---

## 1. What is wrong today (audit, with locations)

### 1.1 Timeline (`src/12c_caption_workbench.js`, `app/body.html:311-329`)

| Finding | Where |
|---|---|
| The only drag is the boundary *between two touching captions*. A caption cannot be moved, its edges cannot be trimmed on their own, and it cannot be dragged to another track. | `startBoundaryDrag` / `moveBoundary` / `finishBoundary` (12c:1174-1191), store `set-segment-boundary` (12b:280) |
| No loop of any kind, no playback speed, no frame step, and **no keyboard shortcuts** (Space does not play). | only local `keydown` handlers exist (12c:1285, 1334, 1376) |
| The playhead **steals the selection**: every frame, `updatePlayhead` selects the caption under it, which rebuilds the timeline, the caption list and four panels. Code already works around it ("or the playhead would select the caption under it again"). | 12c:1161, 12c:770-777, 12c:1277 |
| Every command and every selection change rebuilds the whole timeline DOM (`replaceChildren`) plus all panels (`renderAll`). A live drag over that is not possible without stutter. | 12c:94-131, 12c:733-741 |
| Blocks are placed in `%` of the duration; zoom is ×1/2/4/8 by widening the content, not anchored at the cursor; no ruler, no time ticks, no snapping, no auto-follow while playing. | 12c:116, 12c:126, 12c:1296-1298 |
| The scrub slider and the timeline are two separate controls for the same thing. | `#captionScrub` (body:316) |
| Words are only visible/clickable at zoom ≥ 2 and cannot be edited there. | 12c:1292 |
| Label width `66` is hard-coded in three places. | 12c:1160, 1170, CSS:134 |
| The strip is capped at `38vh`, not resizable, not collapsible. | `app/style.css:66` |
| Earlier browser checks simulated pointer drags; nothing exercises real pointer input. | delta plan steps 4, 6 |

### 1.2 Caption editing and syncing

| Finding | Where |
|---|---|
| A caption can only be created through a folded form: text area + start seconds + end seconds typed by hand. | `details.caption-manual-entry` (body:57-69), 12c:1272 |
| A spoken caption's text is edited **one word at a time** (chip → small editor). There is no "edit this caption's text". | `renderWordChips` / `renderWordEditor` (12c:200-229), `edit-token-text` |
| A spoken caption **cannot be deleted** (only text blocks can). | `delete-text-block` refuses speech (delta plan step 7) |
| Split only works between two words via ✂ chips; not "split at playhead"; text blocks cannot be split. | 12c:204, `splitSegment` (12b:382) |
| "Start / End at playhead" exists, but as two buttons inside a tab of the left panel, with no shortcut, and it fails when the new time would cut a word. | body:144, `applyTiming` (12c:518-529) |
| **Timing rules live in the UI, not the store.** `applyTiming` checks neighbours and word range; the store's `set-segment-timing` accepts anything, and `J.validateCaptionProject` has no per-track overlap check (only `moveTokensToTrack` and text blocks check it). | 12c:525, 12b:271-279, 12b:100-152 |
| No store command moves a caption in time. A spoken caption's words keep their own times, so "moving" it needs a defined meaning (see §3.1). | — |
| Spoken words may never overlap each other, **even on different tracks**. So a spoken caption on track 2 cannot be moved over a time where track 1 has speech. | `J.validateTranscript` (`src/10_timed_text.js:89-94`) |
| Moving to another track is a select + button, or picking word chips + button, inside a folded section. | body:148-157 |

### 1.3 Interface

| Finding | Where |
|---|---|
| ~176 `caption*` controls in the markup; three always-open columns (left 3 tabs, Style 6 tabs, video) + 12 buttons in the top bar. Everything is visible whether or not it applies to what the user is doing. | `app/body.html:19-331` |
| Related things are split across panels: text styling is in *Style* (centre) and *Word styles* (left); per-caption look is in *Caption* (left) but opens *Effects* (centre); box position has its own tab although the box is draggable on the preview. | body:79-107, 201-221, 286-299 |
| The preview (the thing the user is making) gets the narrowest column; the Style panel gets the widest. | `app/style.css:52-53` |
| Feedback goes to one status line at the bottom of the Style panel; errors for a caption show only if its tab is open. | `#captionStatus` (body:308) |
| One 1430-line UI file renders everything on every change. | `src/12c_caption_workbench.js` |
| No autosave / crash recovery (already listed as a cheap win in the delta plan). | — |

---

## 2. Target design in one picture

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ 字面 JIZURA   project name ●saved     ↶ ↷        [Simple|Advanced]  ⋯  Export │  slim top bar
├────┬──────────────────────┬──────────────────────────────────────────────────┤
│ ▤  │  drawer (one at a    │                                                  │
│ Aa │  time, 340px,        │                 PREVIEW (largest area)           │
│ ✦  │  closes on 2nd       │        ┌───────────────────────────┐             │
│ ▦  │  click → preview     │        │   caption box, draggable  │             │
│ 🎬 │  grows)              │        └───────────────────────────┘             │
│    │                      │   ┌ floating caption toolbar ─────────────┐      │
│    │                      │   │ ✎ Text  ✂ Split  ⇥ Sync  ✦ Look  🗑 │      │
├────┴──────────────────────┴───┴───────────────────────────────────────┴──────┤
│ ▶  ⟲loop  1×   00:03.42 / 00:15.00      [Sync]      snap ⌁   − zoom + fit   │  transport
│ ═══ drag handle (resize / collapse timeline) ════════════════════════════════│
│        |0s      |1s      |2s      |3s  ▼    |4s      |5s      ruler + loop   │
│ VIDEO  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓  (waveform, cut stripes) │
│ Main   [ hello world ][ this is  ][  a caption   ]      [ next one ]         │
│ Track2        [ TITLE          ]                                             │
│ + track                                                                      │
└──────────────────────────────────────────────────────────────────────────────┘
```

Principles:
1. **The preview and the timeline are the editor.** Panels are for settings, opened when needed.
2. **Direct manipulation first**: drag to move/trim/retrack, double-click to edit text, drag on empty space to create. Numeric fields exist, but folded.
3. **Context decides what is shown.** A selected caption gets a small floating toolbar; nothing selected → no caption controls on screen.
4. **Selection and playhead are independent.** Playing never changes the selection; the caption under the playhead only gets a "now showing" highlight.
5. **Every drag is one undo step**, committed on release. During the drag only a preview is drawn.

---

## 3. Model and store changes (small, but they come first)

No schema version bump is needed: no new stored fields except where noted. All commands go through `CaptionStore.execute` (snapshot undo, already exact).

### 3.1 What "moving a caption" means **[DECIDE 1]**
A spoken caption has a display window (`segment.start/end`) and words with their own times (they drive the spoken-word highlight).

- **Move** (drag the body): the caption **and its words** shift by the same amount. The highlight stays in step with the caption. *Recommended.*
- **Trim** (drag an edge): only the display window changes. If the edge would cross a word, the window stops at that word (shown as a snap); holding **Shift** while trimming *fits* the words: their times are scaled linearly into the new window and marked `estimated`.

Text blocks already re-spread their words on any timing change; unchanged.

### 3.2 Spoken words on different tracks may overlap **[DECIDE 2]**
Change `J.validateTranscript`'s overlap rule from "all spoken tokens" to "spoken tokens **of the same track**" (owner = the segment's track; unowned tokens = primary). Needed so a caption can be dragged anywhere on another track. The rule "one caption per track on screen" already guarantees the same safety. Projects that load today still load (the rule only gets weaker). Recorded in ADR 0010.

### 3.3 Timing rules move from the UI into the store
- New helper `J.captionSegmentFits(project, segment, start, end, trackId)` in `08k_caption_tracks.js`: inside `[0, duration]`, `end > start`, minimum length (0.1 s), no overlap with another caption on that track, window contains the caption's words (unless fitting).
- Commands use it and fail with `TRACK_SEGMENT_OVERLAP` / `SEGMENT_TIMING_INVALID` / `SEGMENT_WORDS_OUTSIDE`.
- `J.validateCaptionProject` gains the per-track overlap check **for commands only**. On *load*, an overlap in an old file becomes a warning shown on those captions, not a load failure ("existing projects must load and render identically").

### 3.4 New / extended commands

| Command | Does | Notes |
|---|---|---|
| `move-segment` `{segmentId, start, trackId?}` | Shifts the caption and its words; optionally changes track in the same step. | Blocks: reuses `editTextBlock`. Speech to another track: whole caption only (word-level moves stay `move-tokens-to-track`). Re-plans **only this caption** when the track changes (box/style differ), like `planTextBlock`; a pure time shift keeps the plan. Respects `timing` / `trackAssignment` field locks and `visualPlan` lock for track changes. |
| `trim-segment` `{segmentId, start?, end?, words: 'keep'\|'fit'}` | Edge trim with the rules of §3.1 and §3.3. | `set-segment-timing` stays as an alias for `words:'keep'` so old tests and callers work; it gains the store-side checks. |
| `split-segment` + `time` | Split at a time (the playhead): finds the word gap containing it; inside a word → nearest gap. | Text blocks: allowed, words divided at that gap, each half re-spread in its own window. |
| `delete-segment` `{segmentId}` | Deletes any caption, its plan and its words. | Same rule as D4 (deleting a track deletes its words). `delete-text-block` stays as alias. **[DECIDE 3]** |
| `edit-segment-text` `{segmentId, text}` | Rewrite a spoken caption as text. | Same word count → texts replaced, IDs/times/emphasis kept. Different count → the changed run of words is re-spread inside the time span the old run covered, marked `estimated`; unchanged words keep IDs and times. |
| `retime-tokens` `{segmentId, times:[{tokenId,start,end}]}` | Word-level timing from tap sync. | Validated: ordered, inside the caption (window grows to contain them if needed and free). |
| `batch` `{commands:[…], label}` | Runs several commands as **one** undo step; all-or-nothing. | For multi-select moves and a tap-sync pass. Trivial with snapshot undo. |

Unchanged and reused: `set-segment-boundary` (the "roll" drag between two touching captions), `merge-segments`, `create-text-block`, `edit-text-block`, `move-tokens-to-track`, `add-track`, `reorder-track`, `rename-track`, `remove-track`.

Determinism: none of these draw random values. Seeds are by project seed + IDs + reroll count, and IDs are kept, so a move does not change a caption's look.

Tests: extend `dev/caption_store_test.js`, `caption_tracks_test.js`, `caption_text_blocks_test.js`; new `dev/caption_timing_commands_test.js` (each command: effect, refusal cases, locks, exact undo/redo, plan snapshots of untouched captions byte-identical).

---

## 4. Timeline

### 4.1 Structure
New files (named to load after the store `12b_` and before the workbench `12c_`, like `12bz`):

| File | Content | Tested by |
|---|---|---|
| `src/12bp_caption_timeline_model.js` | **Pure functions, no DOM**: time ↔ pixel, zoom about an anchor, tick spacing for the ruler, snap-target collection and nearest-snap, drag resolution (`move` / `trim-start` / `trim-end` / `roll` / `create` / `loop`) → `{start, end, trackId, valid, reason, snappedTo}`, visible-range culling. | `dev/caption_timeline_model_test.js` (node) |
| `src/12bq_caption_timeline_view.js` | DOM: ruler canvas, rows, blocks keyed by segment id (**updated in place**, never `replaceChildren`), playhead, loop region, ghost + snap line during drag, pointer and wheel handling. Emits intents; never touches the store. | browser check (§7) |
| `src/12br_caption_transport.js` | Play/pause, loop, speed, frame step, follow-playhead, keyboard map. | `dev/caption_transport_test.js` (node, fake video) |

`12c` keeps wiring: turns intents into store commands and owns selection.

Units are **pixels per second** (`ui.timeline.pps`), not `%`: range from "whole video fits" up to ~400 px/s. Short-form videos have at most a few hundred captions, so DOM blocks are fine; word ticks are culled to the visible range.

### 4.2 Rows
- **Ruler**: time ticks; click or drag = scrub (replaces the slider; `#captionScrub` stays in the DOM as the accessible/keyboard fallback, visually hidden). Drag with **Alt** (or drag in the upper half) = set the loop region.
- **Video row**: kept sections and striped cuts as today; **audio waveform** drawn behind it (peaks computed once from the decoded audio; it is what makes syncing by eye possible). *Step T6, optional.*
- **One row per caption track** with a header: name (double-click to rename), z-order drag handle (`reorder-track`), ⋯ menu (style, randomize, delete). Clicking a header selects the track. "+ track" row at the bottom while fewer than 3.
- **Words**: no separate row. When zoomed in enough, each block shows its word boundaries as thin ticks inside it, with the word text; the emphasised words are tinted.

### 4.3 Interactions

| Gesture | Result | Command |
|---|---|---|
| Click a block | Select (playhead does not move) | — |
| Double-click a block | Edit its text in place (§5.2) | `edit-segment-text` / `edit-text-block` |
| Drag a block body | Move in time; drag up/down to another track row | `move-segment` |
| Drag a block edge | Trim that edge (Shift = fit words) | `trim-segment` |
| Drag the seam of two touching captions | Move the shared boundary (as today) | `set-segment-boundary` |
| Drag on an empty part of a row | New text block for that range, then type | `create-text-block` |
| Double-click an empty part | New 2 s text block there, then type | `create-text-block` |
| Shift-click / Ctrl-click, or drag a marquee from empty ruler-less area | Multi-select; dragging one moves all | `batch` of `move-segment` |
| Right-click / ⋯ on a block | Menu: split at playhead, merge with previous/next, duplicate, move to track, lock, delete | existing + §3.4 |
| Wheel | Horizontal scroll; **Ctrl+wheel / pinch** zooms about the cursor | — |
| Drag the top edge of the strip | Resize the timeline; double-click collapses it to the transport line | view pref |

Rules while dragging:
- **Snapping** (toggle in the transport; **Alt** = off for this drag): playhead, edges of captions on every track, word boundaries of the dragged caption's neighbours, cut points of the video, loop in/out, 0 and the end. Snap distance is 6 px, so it depends on the zoom. A vertical line shows what it snapped to.
- **No pushing.** A caption never moves its neighbours. Against a neighbour on the same track it stops (edge to edge). A drop that would overlap (e.g. onto another track where the space is taken) shows a red ghost with the reason and is refused; the block returns. This is the timeline version of "never silently move text".
- Locked captions (`timing` field lock) show a lock badge and do not drag.
- The preview follows the drag live (the dragged edge's time is shown in the preview), and a small time readout sits next to the pointer.
- Pointer capture + `pointercancel`/Esc cancel restore the original state without a command.
- Captions in a removed (trimmed-away) section are drawn dimmed with a hint, as they will not be exported.

### 4.4 Playback and loop
- **Loop** (view state, not saved in the project): `L` toggles looping the selected caption (with 0.3 s lead-in/out), or the marked region if one exists. Implemented in the existing per-frame hook that already skips cut sections (`onFrame`, 12c:1208-1217): when the time passes the loop end, seek to the loop start.
- **Speed**: 0.5× / 0.75× / 1× (`video.playbackRate`; pitch preserved by the browser).
- **Follow**: while playing, the view scrolls to keep the playhead visible (pages rather than scrolls continuously); any manual scroll pauses following until the next play.
- **Keyboard** (ignored while typing in a field; listed in the help dialog):

| Key | Action | Key | Action |
|---|---|---|---|
| Space | play / pause | L | loop on/off |
| ← / → | one frame back / forward | Shift+← / → | 1 s |
| ↑ / ↓ | previous / next caption | Home / End | start / end |
| I / O | selected caption starts / ends at playhead | S | split at playhead |
| Enter | edit text of the selected caption | Delete | delete selected |
| N | new caption at the playhead | Esc | cancel drag / close popover / deselect |
| Ctrl+Z / Ctrl+Shift+Z | undo / redo | + / − / 0 | zoom in / out / fit |
| Alt+↑ / ↓ | move caption to the track above / below | , / . | nudge caption 0.05 s |

### 4.5 Accessibility
Blocks stay focusable buttons with `aria-label` "text, start–end, track". Everything a drag does has a key (nudge, I/O, Alt+↑/↓). The roll slider keeps its `role="slider"`.

---

## 5. Creating, editing and syncing captions

### 5.1 Creating
1. **Import** (unchanged formats: word JSON, SRT, VTT), moved to a clear first-run empty state on the stage: "1 Choose video → 2 Add captions (import a file / type them / paste text)".
2. **At the playhead**: `N` or the "+ Caption" button in the transport → a text block starting at the playhead on the active track (default 2 s, shortened to the free space), text field focused.
3. **On the timeline**: drag or double-click on an empty part of a row (§4.3).
4. **Paste a whole script** **[DECIDE 4]**: paste several lines → one caption per line, spread evenly from the playhead to the end (or across the loop region), then fix the timing with tap sync (§5.3). This is the fast path for people without a transcript file. *Recommended, but it is the one new feature here; it can be dropped.*

The folded "type a caption with seconds" form is removed.

### 5.2 Editing a caption
One selected caption shows a **floating toolbar** anchored under its box in the preview (and the same actions in the timeline's right-click menu):

`✎ Text · ✂ Split · ⇤ Start here · End here ⇥ · ✦ Look · ⋯ (merge ◀ / ▶, move to track, no motion, keep as is, delete)`

- **Text**: double-click the caption (preview or timeline), or Enter. One text field for the whole caption for both kinds (`edit-segment-text` for speech, `edit-text-block` for blocks). Enter commits, Esc cancels, Shift+Enter is not a line break (line breaks are the layout's job).
- **Words**: in the edit popover the words are shown as chips under the text field. Click a chip → highlight Auto / On / Off (as today); ✂ between chips splits there. The same chips, so nothing is lost from the current Caption tab.
- **Details** (folded in the popover): start/end seconds with ± nudges, timing quality, layout name, warnings. Warnings also show as a ⚠ badge on the block in the timeline and on the toolbar, with the text in a tooltip, so they are visible without opening anything.
- The left "Caption" tab disappears; its functions are all in the toolbar/popover/timeline.

### 5.3 Syncing
Three levels, from quick fix to full pass:

1. **One press**: `I` / `O` or the toolbar buttons set the selected caption's start / end to the playhead (`trim-segment`; if a word is in the way the words are fitted and the user is told). `,` / `.` nudge the whole caption.
2. **Tap sync (captions)** — the **[Sync]** button in the transport:
   - Scope: from the selected caption to the end of the active track (or only the captions inside the loop region).
   - The video plays (speed selectable; 0.75× is the default in this mode). A large "Tap" button and **Space** mark *"the next caption starts now"*. Hold = it lasts while held (release sets the end); tap = it ends where the next one starts.
   - A reaction offset (default 0.12 s, adjustable 0–0.3 s, stored as a view preference) is subtracted from each tap.
   - During the pass nothing is committed; the timeline shows the new times live. **Stop** → one `batch` command, so a single undo restores the whole pass. Esc discards.
   - Spoken captions with real word timing are moved with their words (§3.1 Move); the UI says so before starting when the scope contains them.
3. **Tap sync (words)** for one caption: the caption loops; each tap marks the next word's start (`retime-tokens`). For karaoke-style highlight on typed or SRT captions whose word times are only estimated.

### 5.4 Selection model
- `ui.selection = { segmentIds: Set, trackId, wordId }` in one place, with `select()`, `toggle()`, `clear()`; panels subscribe.
- The playhead no longer selects. `currentIds` (captions on screen now) is a separate, cheap state that only toggles a CSS class on blocks and list rows.
- Selecting a caption does not seek. Double-clicking a row in the caption list, or ↑/↓, seeks to its start.

---

## 6. Interface

### 6.1 Layout
- **Top bar (slim)**: brand, project name (click to rename), save state ("Saved 12:04" / "Unsaved changes"), Undo, Redo, Simple | Advanced, **Export** (primary). Everything else goes into a **⋯ menu**: New, Open, Save, Save style, Load style, Help, Language, About. `Randomize everything` moves to the Effects drawer.
- **Icon rail** (48 px, left) with one **drawer** (340 px) at a time; clicking the active icon closes the drawer and the preview takes the space. Drawer state is a view preference (localStorage), not project data.

| Rail item | Content (from today's tabs) |
|---|---|
| **Captions** | Caption list (search, ⚠ filter), import, paste script, timing badge. Replaces *Transcript*. |
| **Text** | *Style* tab + *Word styles* tab merged: style family, font/colour/size (all text), spoken word, highlighted words, decoration, accent, alignment, writing mode, words per caption. One sample at the top (the existing `paintCaptionRoleSample`). Sections fold; Advanced-only rows stay hidden in Simple. |
| **Effects** | As today (scope: video / track / this caption; cards; Randomize). |
| **Tracks** | Rarely needed now that the timeline headers do add / rename / reorder / delete; keeps per-track style overrides. In Simple it is hidden until a second track exists. |
| **Video** | Video settings as today (shape, fill, trim, layout & crop, overlays, notes). |

- **Export** becomes a dialog (format, length, caption count, progress, cancel) instead of a tab.
- **Placement box tab is removed.** The box is edited on the preview (already works); when the box is selected a small popover offers scope (track / this caption), X/Y/W/H and Reset.
- **Stage**: preview fills the remaining area and is centred. Stage chips at its top corner: zoom to fit, safe-area guides on/off, reduced-motion preview.
- **Floating elements** share one small popover/menu helper (`src/12bn_caption_popover.js`): anchored to an element or a rect, flips at the viewport edge, closes on Esc / outside click, returns focus, `role="menu"` / `role="dialog"`. No dependency.
- **Feedback**: toasts (bottom-centre of the stage) for results ("Split into two · Undo"), with an Undo action on destructive ones. Errors for a caption attach to that caption (badge + toolbar). The status line in the panel goes away (`#captionStatus` stays as the `aria-live` region).
- **Timeline strip**: resizable and collapsible (§4.3). Sizes are view preferences.
- **Narrow screens**: under 1000 px the drawer overlays the stage instead of pushing it; under 680 px the rail becomes a bottom tab bar and the timeline shows one track at a time. (Editing on a phone stays a secondary case.)

### 6.2 Visual language
Keep the existing tokens (`--panel`, `--line`, `--amber`, `--cyan`, mono for time codes) so Lyric Motion and Captions still look like one product. Changes: more space, fewer borders (sections separated by spacing and a small heading), one accent for selection (cyan) and one for "now showing" (amber), 28–32 px hit targets, icons with text labels on hover/focus (and always-visible labels in the rail's expanded state). No new font, no framework.

### 6.3 Lyric Motion
Hidden, not removed **[DECIDE 5]**: the product tab is hidden and the shell defaults to Video Captions behind one flag (`J.LYRIC_MOTION_VISIBLE = false` in `11z_product_shell.js`). The workspace, its code and `lyric_smoke.js` stay, so "must not regress" still holds and it can be switched back with one line.

### 6.4 Code structure
`12c_caption_workbench.js` is split along the drawers (no behaviour change in the split step):

```
12bn_caption_popover.js        popover / menu / toast helper
12bo_caption_ui_state.js       ui state, selection, view prefs, tiny event bus (on / emit)
12bp_caption_timeline_model.js pure timeline maths
12bq_caption_timeline_view.js  timeline DOM
12br_caption_transport.js      playback, loop, shortcuts
12bs_caption_sync.js           tap sync (captions and words)
12bt_caption_edit.js           floating toolbar, text/word popover, create
12bu_caption_panels_text.js    Text drawer (style + roles)
12bv_caption_panels_effects.js Effects drawer
12bw_caption_panels_tracks.js  Tracks drawer + box popover
12bz_caption_effect_preview.js (exists)
12c_caption_workbench.js       bootstrap: project/media/import/export wiring, drawer routing
```

Rendering: instead of `renderAll()` on every change, modules subscribe to `project`, `selection` and `time` events, and a drawer only renders while it is open. The store gets an optional `onChange` callback (called after execute / undo / redo).

### 6.5 Strings
New strings go to the Japanese source in `app/body.html` / the modules and to `app/english.py` (the other editions show the Japanese source for caption UI, as today). `dev/localized_build_test.py` stays green.

---

## 7. Testing

- **Node suites** for everything pure: store commands (§3), timeline model, transport/loop, sync timing maths, selection.
- **Structural tests** that regex `app/body.html` / `12c` (18 files: `caption_timeline_ui_test`, `caption_workbench_test`, `caption_editing_ui_test`, `caption_style_controls_test`, `caption_accessibility_ui_test`, `product_mode_shell_test`, …) are updated in the step that moves the markup they pin. Control IDs that survive keep their names (`captionPlay`, `captionUndo`, `captionRoleBaseFont`, …) to keep that churn small.
- **New real-browser check** `dev/caption_ui_chrome_check.js` (`npm run check:ui-chrome`), built on the DevTools-protocol harness of `export_chrome_check.js`: real `Input.dispatchMouseEvent` drags and key presses on the fixture video — move, trim, retrack, refused overlap, create by drag, split at playhead, loop, tap sync, undo of each. This closes the "pointer drags were simulated" gap. Not part of `npm test` (needs Chrome), same as the export check.
- **Guards every step**: `node lyric_smoke.js`, `caption_plan_snapshot_test.js` (plans must not change except where a step says so), `caption_visual_regression.js` (no `--update` expected in this whole plan: nothing here changes how a caption is drawn).
- Each step ends with a hand check in the browser pane with the 15 s fixture + word JSON, and a note in this file.

---

## 8. Decisions (owner-confirmed 2026-10-01)

| # | Decision |
|---|---|
| 1 | Moving a spoken caption shifts its words with it. Trimming an edge stops at a word; Shift fits the words into the new window (§3.1). |
| 2 | Spoken words on **different tracks** may overlap in time; the overlap rule is per track (§3.2, ADR 0010). |
| 3 | Deleting a spoken caption deletes its words (same rule as deleting a track, D4); undoable. |
| 4 | "Paste a whole script → one caption per line" + tap sync is the no-transcript path (step C6). |
| 5 | Lyric Motion is hidden behind a flag; its code and `lyric_smoke.js` stay. |
| 6 | Selection does not follow the playhead; clicking a caption does not seek (double-click / ↑↓ do). |
| 7 | Waveform in the video row, as its own late step (T6); skipped above ~10 min of video. |
| 8 | Autosave to the browser (IndexedDB, last project, restore prompt), step U6. |

---

## 9. Step plan

One step at a time; each leaves the app working and tests green; commit per step after asking. Status: `[ ]` todo, `[~]` in progress, `[x]` done.

**Before E0 — new repository (owner).** The rework is done in a separate repository so this one stays as it is. Checklist for the first session there:
- The new repository contains this plan, `subtitle-mvp-delta-plan.md`, `CLAUDE.md` and the ADRs (a full copy of the project at commit `df17aad` or later does this).
- `python build.py --dev` runs, and in `dev/`: `npm install`, then `npm test`, `node lyric_smoke.js`, `node caption_plan_snapshot_test.js` and `node caption_visual_regression.js` are green **before** any change. That run is the baseline every later step is compared with.
- `CLAUDE.md` there names this file as the plan to follow for the rework ("read this first, update step status when a step finishes").
- Then start E0.

**Phase A — foundations (no visible redesign yet)**
- [x] **E0 — Lyric Motion hidden, default mode Video Captions.** Flag in `11z_product_shell.js`; `product_mode_shell_test.js` updated; `lyric_smoke.js` unchanged and green.
- [x] **E1 — Timing rules into the store + new commands.** §3.2–3.4: `captionSegmentFits`, `move-segment`, `trim-segment`, `split-segment` by time, `delete-segment`, `edit-segment-text`, `retime-tokens`, `batch`; per-track token overlap; load-time overlap = warning. ADR 0010. UI unchanged except `applyTiming` now relies on the store. Tests as in §3.
  - Done 2026-10-02: ADR 0010; `dev/caption_timing_commands_test.js` (`npm run test:timing-commands`). `set-segment-timing` is an alias of `trim-segment` (words kept); `applyTiming` sends `trim-segment`. Load-time overlap is reported by `J.captionTrackOverlaps` (no UI display yet). `validateTranscript` takes `options.segments` (per-track rule) and `ignoreUnowned` (planner).
- [x] **E2 — Split `12c` + event bus + selection model.** Pure refactor into the files of §6.4 (panels move as they are); `renderAll` replaced by subscriptions; selection decoupled from the playhead (decision 6). No markup change. Structural tests re-pointed to the new files.
  - Done 2026-10-02: `12c` (1425 lines) is now `12bo` shared state / event bus (`W.on`, `W.emit`: `project`, `selection`, `time`, `error`) / selection / helpers, `12bq` caption list + timeline, `12br` transport, `12bt` caption editing, `12bu` Style + Word styles, `12bv` Effects, `12bw` Tracks + placement box, and `12c` (bootstrap, import/export, `renderActions`). Modules share `J.captionWb` (`W`); they have no load-time DOM access and register their `init` in `W.inits`, which `12c` runs. `12bn` (popover), `12bp` (timeline model) and `12bs` (sync) do not exist yet; they come with C1 / T1 / C4.
  - Selection is `ui.selection = { segmentIds, trackId, wordId }` (`ui.selectedId/trackId/wordId` are accessors on it; `W.toggleSelect`, `W.clearSelection`). The playhead no longer selects: it only marks the captions on screen (`ui.currentIds`, CSS class `is-now`, which has no style yet). A click on a caption in the list or timeline selects without seeking; double-click seeks. A selection change moves the marks in place instead of rebuilding the strip.
  - Not split yet: `renderActions` (undo/redo/save/export enable state) stays in `12c`; the timeline still rebuilds on every `project` event (T1 makes it in place). `english.py` localizes `12bo`–`12bw` like `12c`. Structural tests read the files through `dev/caption_ui_source.js`.

**Phase B — timeline**
- [x] **T1 — Timeline model + new view (read-only parity).** px/s scale, ruler with ticks, keyed blocks updated in place, word ticks inside blocks, track headers, cursor-anchored zoom, wheel scroll, follow-playhead, ruler scrub (slider hidden but kept). Same abilities as today, including the roll drag.
  - Done 2026-10-02: `12bp_caption_timeline_model.js` (pure: px/s scale, anchored zoom, ruler ticks, culling, follow paging; `dev/caption_timeline_model_test.js`, `npm run test:timeline-model`). `12bq` keeps one block per caption and one row/header per track and updates them in place (word ticks are built only for blocks near the viewport and when zoomed in). Ruler canvas scrubs by click/drag; `#captionScrub` stays, visually hidden (`sr-only`). Ctrl+wheel zooms about the cursor, plain wheel scrolls, ± zoom about the centre, 全体 = fit; while playing the view pages with the playhead until a manual scroll/zoom (next play resumes). The WORDS row is gone (ticks sit inside blocks); the roll drag works in px. `ui.timelineZoom` became `ui.timeline = { fit, pps, scrollLeft, follow }`. Trimmed-away video sections now get a stripe style (it was missing). Double-click on a caption now seeks (decision 6). Checked in the browser pane with the 15 s fixture + word JSON via DOM/canvas probes (screenshots timed out); real pointer drags come with T3's chrome check.
- [x] **T2 — Transport: shortcuts, loop, speed, frame step.** §4.4. Loop region on the ruler.
  - Done 2026-10-02: pure transport maths in `12bp` (speed cycle, `markRegion`, `loopRegion`, `loopSeek`, `stepTime`, `adjacentSegment`, `keyAction`; `dev/caption_transport_test.js`, `npm run test:transport`). `12br` owns loop / speed (`ui.transport`, view state, not saved), the per-frame loop wrap (inside `skipCuts`, before the cut skip) and a capture-phase document key handler that is active only in Video Captions and ignores fields, sliders and open dialogs (so the Lyric Motion keys do not also fire). Implemented keys: Space, ←/→ (1/30 s; no source fps is known), Shift+←/→ (1 s), ↑/↓ (previous/next caption, selects and seeks), Home/End (kept range), L, + / − / 0, Esc (stop loop, else deselect). Ruler: Alt+drag or upper-half drag marks the loop region (plain click still scrubs; a click clears a mark); `#captionLoopRegion` band. Speed button cycles 1× → 0.75× → 0.5×. Shortcut list added to the help dialog (English copy only; other editions show Japanese until translated). Keys of later steps (I/O C3, S/Delete/N T5, Alt+↑↓ T4, `,` `.` `Enter` T3/C2, Ctrl+Z U-steps) are not bound yet.
- [x] **T3 — Move and trim by drag**, snapping, refusal ghost, live preview, Esc cancel, lock badges, nudge keys. `caption_ui_chrome_check.js` starts here.
  - Done 2026-10-02: drag maths are pure in `12bp` (`snapTargets`, `nearestSnap`, `resolveDrag`, `nudge`; `dev/caption_timeline_drag_test.js`, `npm run test:timeline-drag`). `12bq` turns pointer events into a ghost (cyan; red with the reason when refused), a snap line (`.caption-drag-snap`) and a time readout, and sends `move-segment` / `trim-segment` only on a valid drop; Esc, `pointercancel` and a refused drop leave the project untouched. A drag starts after 4 px, so a plain click on a block or word tick still selects / seeks. Block body = move (row under the pointer picks the track), 6 px grips at both ends = trim (Shift = fit words; text blocks never stop at words). A caption stops edge to edge at its same-track neighbours and at 0 / the end; on another track a taken slot is refused. Snap targets (6 px, collected at drag start): playhead, loop in/out, kept-section cuts, edges of every caption, word times of the two same-track neighbours, 0 and the end. Snap toggle `#captionSnap` in the transport (`ui.transport.snap`), Alt = off for one drag. `,` / `.` nudge the selected caption by 0.05 s (same rules as a drag). Timing-locked captions (`timing` / `start` / `end` field lock) show a 🔒 badge, a dashed border and do not drag. The preview pauses the video at drag start and shows the frame at the dragged edge; it does not yet show the caption itself at its tentative timing, and the view does not auto-scroll at the strip edges (zoom out to reach far targets).
  - The roll handle (`set-segment-boundary`) is now offered only on the seam of two *touching* captions (gap < 0.02 s, per §4.3); any other end edge trims. Blocks got `aria-label` "text, start–end, track".
  - `dev/caption_ui_chrome_check.js` (`npm run check:ui-chrome`) drives the built app in real Chrome with real mouse and key events (CDP `Input` domain): 32 checks — move, ghost / readout cleanup, neighbour stop, Esc, refused and free track drops, word stop, Shift fit, edge growth, snapping, lock, nudge, undo restores the exact project. Not in `npm test` (needs Chrome and the generated fixture). Other editions show Japanese copy for the new snap button / shortcut rows until translated; English is done.
- [x] **T4 — Tracks on the timeline**: drag between rows, Alt+↑/↓, header rename / reorder / ⋯ menu, "+ track".
  - Done 2026-10-02: dragging a block to another row was already in T3. New: `Alt+↑ / ↓` moves the selected caption to the track above / below at the same time (`move-segment` with `trackId`; refused with the reason when the slot is taken, status message at the first / last track). Track headers (`.caption-track-head`, 112 px wide) have a grip (not on the primary track; drag shows a drop line, one `reorder-track` on release, Esc cancels, never before the primary), double-click on the name = inline rename (Enter / blur commit, Esc cancels, `rename-track`), and a ⋯ menu (rename, up, down, randomize effects, delete; the primary track's move / delete are disabled). The menu is a small local helper in `12bq` (`role="menu"`, arrows, Esc, outside click, flips at the viewport edge); the shared popover helper `12bn` still comes with C1 and can replace it. `＋ トラック` (`#captionTrackAddInline`) sits under the headers and hides at 3 tracks. Pure helpers `adjacentTrackId` / `reorderIndex` in `12bp` (`dev/caption_timeline_tracks_test.js`, `npm run test:timeline-tracks`); track actions in `12bw` now take a track id (`deleteTrack`, `reorderTrack`, `renameTrack`, `rerollTrack`), the panel buttons still act on the active track.
  - Store: `move-segment` on a text block that only changes track no longer sends start / end, so a timing lock does not stop a pure track change (same as for speech). The transport key handler ignores keys inside `[role=menu]`. `caption_ui_chrome_check.js` grew to 53 checks (Alt+arrows, rename, reorder, menu, + track, all through real mouse / key events). Other editions show Japanese copy for the menu labels only where `english.py` has no entry (English is done).
- [x] **T5 — Create and multi-select**: drag / double-click on empty space, `N`, marquee and shift-click, batch move, right-click menu (split at playhead, merge, duplicate, delete).
  - Done 2026-10-02: pure maths in `12bp` (`freeGap`, `newBlockRange`, `createRange`, `marqueeHits`, `resolveGroupMove`, `groupMoveOrder`; keys `N` / `S` / `Delete`; `dev/caption_timeline_create_test.js`, `npm run test:timeline-create`, in `npm test`). New store command `duplicate-segment` `{ segmentId, newSegmentId?, start?, trackId? }`: a typed-block copy (new word ids, even timing, box and preset animations kept) in the first free gap after the original (on another track: from the same time); a gap shorter than the original shortens the copy (never below 0.1 s); no gap refuses with `TRACK_SEGMENT_OVERLAP`. Everything else reuses E1 commands (`create-text-block`, `move-segment`, `split-segment` by time, `delete-segment`, `merge-segments`, `batch`).
  - Creating: drag on an empty part of a track row = ghost (cyan; red when it starts inside a caption), `create-text-block` on release for exactly that range, kept inside the free gap around the press (snaps like a drag; Alt = off; under 0.1 s = just a click; Esc / `pointercancel` cancel). Double-click on an empty part = a 2 s block there, shortened to the free space. `N` = a block at the playhead on the active track (also without a video). A new block holds the placeholder text 新しい字幕 / "New caption", is selected, and the Caption tab's text field gets focus; **Enter in that field now commits** (Esc leaves it) — real in-place editing is still C2.
  - Selecting: Shift / Ctrl / Cmd + click toggles a caption (no drag starts on a Shift-click of a block body; Shift on a trim grip still means "fit words"). Marquee = Shift / Ctrl + drag anywhere, or a plain drag that starts in the VIDEO row or between the rows (a plain drag inside a row is create): a box, blocks it touches get an outline, selection is set on release (additive with Shift). Selection views (`selected`, `aria-selected`) now read the whole set. A click that ends a drag no longer collapses the selection (`swallowClick`).
  - Group move: dragging any member of a multi-selection moves all of them by one amount (a ghost each, one snap line, a `+0.35s` readout); the shift is clamped by 0 / the end and by captions outside the group; a timing-locked member stops the whole drag with a message; no retrack for groups. One `batch` of `move-segment`, applied last-first when moving right so members never run over each other: one undo step. `,` / `.` nudge the whole selection the same way.
  - Menu and keys: right-click (or the context-menu key) on a caption selects it if needed and opens a menu at the pointer: split at playhead, merge with previous / next (same enable rules as the Caption tab), duplicate, delete (the last two act on the whole selection, as `batch`). `S` splits the selected caption at the playhead (one caption only), `Delete` / `Backspace` deletes the selection (undoable, no confirm; the toast with Undo comes with C1). Help dialog and English strings updated. Marquee-select in the caption list, Ctrl+A and group retrack / move-to-track are not done.
  - `caption_ui_chrome_check.js` grew to 81 checks (create by double-click / drag / `N`, Esc and short-drag no-ops, Shift-click toggle, locked group refusal, group drag + nudge + undo, marquee + Esc, right-click menu duplicate, `S`, `Delete`, all through real mouse / key events).
- [ ] **T6 — Waveform + resizable / collapsible strip** (decision 7).

**Phase C — caption editing and sync**
- [ ] **C1 — Popover helper + floating caption toolbar** on the preview; warnings as badges; toasts with Undo.
- [ ] **C2 — Text editing in place** (preview and timeline), word chips in the popover (highlight, split), details fold. The left "Caption" tab is removed.
- [ ] **C3 — One-press sync** (`I` / `O`, toolbar buttons, fit-words notice).
- [ ] **C4 — Tap sync for captions** (button, Space, hold/tap, reaction offset, live preview, one undo).
- [ ] **C5 — Tap sync for words** (one caption, looped).
- [ ] **C6 — Paste a script** (decision 4) and the first-run empty state.

**Phase D — interface**
- [ ] **U1 — Shell**: slim top bar + ⋯ menu, icon rail + single drawer, preview-first grid, view preferences. Panels move into drawers unchanged.
- [ ] **U2 — Text drawer**: merge Style + Word styles, folded sections, one sample.
- [ ] **U3 — Box popover on the preview; Tracks drawer slimmed; Export dialog.** Box tab and Export tab removed.
- [ ] **U4 — Captions drawer**: list with search and ⚠ filter, import; old transcript column removed.
- [ ] **U5 — Responsive, focus order, screen-reader pass, help dialog with the shortcut table, strings in `english.py`, ADR 0008 (UI structure).**
- [ ] **U6 — Autosave / restore** (decision 8).

Order rationale: E1 before any drag UI (the timeline must not own timing rules again); E2 before the timeline (a live drag needs partial rendering); timeline before the editing popovers (they anchor to it and reuse its commands); the shell redesign last, because by then half of the old panels are already gone and what is left to arrange is small. If the owner wants the visual change sooner, U1 can move directly after E2 without affecting the other steps.

Sizes (rough): E0 small · E1 large · E2 large · T1 large · T2 medium · T3 large · T4 medium · T5 medium · T6 medium · C1 medium · C2 medium · C3 small · C4 medium · C5 small · C6 small · U1 large · U2 medium · U3 medium · U4 small · U5 medium · U6 small.

## 10. Out of scope
Per-word positioning (D2), keyframes, automatic transcription (ASR stays an open item of the delta plan), more than 3 tracks (D9), moving the video trim bar into the timeline (the Video drawer keeps it; the timeline keeps showing the cuts), real-time collaboration, touch-first editing.
