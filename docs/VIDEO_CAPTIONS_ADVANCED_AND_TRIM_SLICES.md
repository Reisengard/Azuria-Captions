# Caption advanced styles and playhead trim slices

This document is the script for the approved plan. Do the first slice whose status is `todo`. Set that status to `done`, write the check you ran, and stop. Do not start the next slice in the same turn.

If the check fails, fix that slice and stop. Do not skip a slice. Do not drop a technique group. Do not turn a missing technique id on.

Rebuild the browser pages with `python build.py` before any Playwright test. Those tests open `en/index.html`, which is a built file. Unit tests under `dev/` load `src/` directly and do not need that rebuild.

The landscape fixture for the trim tests is `dev/fixtures/media/generated/landscape-10s-30fps-av.mp4`. If that file is missing, run `dev/fixtures/media/generate.ps1` on a machine with FFmpeg, then rerun the test. If FFmpeg is missing, say so in the slice status and do not mark the slice done.

## Locked decisions

Simple and Advanced are the two values of `project.style.editor`. The values are the strings `simple` and `advanced`. A missing value means `simple`.

The technique pool is `project.techniques`. It belongs to the caption project. It is not the lyric field `project.enabled`. In Lyric Motion, a missing technique id is on. In this pool, a missing id is off, except a caption-safe id that the active caption profile already lists.

The ten groups, in this order, are `layout`, `enter`, `hold`, `exit`, `decor`, `treat`, `bg`, `cam`, `fx`, and `trans`. The five set flags are `extra`, `wa`, `typo`, `kinetic`, and `horror`. All five default to false.

Turning a part on does not set `captionSafe` on the registry. Simple mode ignores the pool and plans captions as it does today.

`J.mainDraw` in `src/06_layouts.js` already applies `J.ENTER`, `J.HOLD`, `J.EXIT`, and `J.TREAT` by id. Entrance, hold, exit, and text treatment do not need a new renderer. Layout, decor, background, camera, frame effect, and transition do. `J.drawCaptionOverlay` does not call those renderers today.

A kept section is one `{ start, end }` pair on `settings.videoEdit.clips`, in source seconds. A remove range is the unsaved inputs `cutStart` and `cutEnd`. Marks do not call Apply.

## Status

| Slice | Status | Check |
|---|---|---|
| 1. Mark a kept section from the playhead | done | Passed from the repo root: `node dev/video_edits_test.js`, `node dev/lyric_smoke.js`, `python build.py`, then `node dev/video_edits_browser_test.js`. The browser test needed `NODE_PATH` pointed at a temp install of the `playwright` package because the repo does not depend on it. It used Edge headless. Export was 1080×1080, duration 0.704, audio present, page errors []. |
| 2. Mark a remove range from the playhead | done | Passed from the repo root: `node dev/video_edits_test.js`, `node dev/lyric_smoke.js`, `python build.py`, then `node dev/video_edits_browser_test.js`. The browser test needed `NODE_PATH` pointed at `C:\Users\shisu\AppData\Local\Temp\jizura-playwright\node_modules` because the repo does not depend on `playwright`. It used Edge headless. Export was 1080×1080, duration 0.704, audio present, page errors []. |
| 3. Add Simple and Advanced | done | Passed from the repo root. `node dev/caption_style_controls_test.js` opened as simple, hid `#captionTechniqueHost`, showed the empty host after Advanced, and restored simple when the project omitted `editor`. `node dev/lyric_smoke.js` passed. `python tools/check_i18n.py` for zh-Hant, zh-Hans, ko, id, and vi exited 0. The new Editor phrase is in each loaded BODY map. The checker still prints older caption-string gaps, 80 missing BODY keys, and exits 0. `python build.py` wrote the pages. Edge headless on `en/index.html` showed Simple with the host hidden, Advanced with the host shown, and a reopened project file still on Advanced. Lyric Motion stayed in easy mode, with the easy control visible. A fresh page load starts an empty project, so the editor is Simple again. |
| 4. Store the technique pool | done | Passed from the repo root: `node dev/caption_store_test.js`, then `node dev/lyric_smoke.js`. An old caption project with no `techniques` field loaded. `J.captionTechniqueOn` was false for `knSlamStack` and true for `captionFade` on the creator profile. An explicit false turned `captionFade` off. An explicit true turned `knSlamStack` on and left `captionSafe` unset on that registry entry. Undo restored the previous pool. Lyric smoke stayed unchanged (3 lines, 3 cuts, seed 424242). |
| 5. Show the Techniques screen | done | Passed from the repo root. `node dev/caption_style_controls_test.js` showed all ten group names in Advanced, disabled part checkboxes and bulk buttons, five enabled set checkboxes, a hidden host in Simple, and an extra-set toggle that stored `techniques.extra` without writing `project.enabled` or a lyric project. With the enter draw flag flipped only inside the test, one entrance command stored the id, replaced an unlocked plan, kept a locked layout, and undid both in one step. The source flags stayed false. `node dev/lyric_smoke.js` passed (3 lines, 3 cuts, seed 424242). `python tools/check_i18n.py` for zh-Hant, zh-Hans, ko, id, and vi printed the older caption-string gaps and exited 0. `python build.py` wrote the pages. Edge headless on `index.html` hid the host in Simple, showed the ten groups and 884 disabled part boxes in Advanced, stored the extra set only on the caption pool, and a Lyric Motion technique-tab checkbox changed only the lyric project. The same Advanced panel was present at 390×844. `en/index.html` showed the ten English group names with the part boxes disabled. |
| 6. Let Advanced plans read the pool | done | Passed from the repo root: `node dev/caption_planner_test.js`, `node dev/caption_store_test.js`, `node dev/lyric_smoke.js`. Advanced with kinetic off stored no kinetic layout id. Advanced with `extra` on and `captionSoftRise` false stored other entrances, and stored only `captionSoftRise` when the other creator entrances were false. Advanced with `pop` true stored `pop` while all ten `J.CAPTION_TECHNIQUE_DRAW` literals stayed false. Simple with `knSlamStack` true matched the untouched creator plans. Advanced with `knSlamStack` true stored that layout only when `kinetic` was true. Lyric smoke stayed 3 lines, 3 cuts, seed 424242. |
| 7. Draw enabled entrance, hold, and exit | done | Passed from the repo root: `node dev/caption_effect_rendering_test.js`, `node dev/caption_style_controls_test.js`, `node dev/caption_planner_test.js`, `node dev/lyric_smoke.js`, `python build.py`. The draw test planned one cue with `pop` on, `drawCaptionOverlay` did not throw, the cut entrance stayed `pop`, and `pop` apply wrote glyph functions. With `pop` off the same cue drew a caption-safe creator entrance. The style test left enter, hold, and exit part boxes and bulk buttons enabled, and left the other seven groups disabled. Lyric smoke stayed 3 lines, 3 cuts, seed 424242. Edge headless on `en/index.html` used `NODE_PATH` pointed at `C:\Users\shisu\AppData\Local\Temp\jizura-playwright\node_modules`. Advanced with `pop` on played `pop`. Turning `pop` off played `captionFade`. Simple kept `pop` true on the pool, hid the technique host, and played `captionSoftRise`. Page errors []. Only `enter`, `hold`, and `exit` draw flags were true. |
| 8. Draw enabled text treatment | done | Passed from the repo root: `node dev/caption_effect_rendering_test.js`, `node dev/lyric_smoke.js`, `python build.py`. The draw test planned one cue with `wide` on, `drawCaptionOverlay` did not throw, `cut.treat` was `wide`, and `captionTreatment` stayed `outline`. With `wide` off, `cut.treat` was unset. Lyric smoke stayed 3 lines, 3 cuts, seed 424242. Edge headless on `en/index.html` used `NODE_PATH` pointed at `C:\Users\shisu\AppData\Local\Temp\jizura-playwright\node_modules`. Advanced with `wide` on changed the cue pixels and set `cut.treat` to `wide`. Turning `wide` off restored the same pixels and left `cut.treat` unset. `captionTreatment` stayed `outline`. Page errors []. Draw flags true: `enter`, `hold`, `exit`, `treat`. Draw flags false: `layout`, `decor`, `bg`, `cam`, `fx`, `trans`. |
| 9. Draw enabled layouts | todo | |
| 10. Draw enabled decor | todo | |
| 11. Draw enabled background, camera, and frame effect | todo | |
| 12. Draw enabled transitions | todo | |
| 13. Apply a lyric palette to caption colors | todo | |
| 14. Add live technique thumbnails | todo | |

## 1. Mark a kept section from the playhead

Add **Start here** and **End here** on each kept-section row in `src/12a_video_edit_ui.js`.

Each button reads `video().currentTime`. The first edit copies the virtual full-span clip into `draft.clips`, the same way the number inputs already do. **Start here** writes that row's `start`. **End here** writes that row's `end`. Round the time to the nearest hundredth of a second.

If the video has no duration, show `Load a video first.` and do not change the draft. If the new range is inverted, outside the file, or out of source order, do not change the draft. Show `Kept sections must be in source order, inside the video, and must not overlap.`

Leave the draft unapplied. Set the status text to `Unapplied changes`.

Use `data-action="markStart"` and `data-action="markEnd"`. Put the row index on the button so each section edits its own pair.

Files you may change are `src/12a_video_edit_ui.js` and `dev/video_edits_browser_test.js`.

Run these commands from the repo root.

```text
node dev/video_edits_test.js
node dev/lyric_smoke.js
python build.py
node dev/video_edits_browser_test.js
```

Extend the browser test. After the video is ready, set `currentTime` to `1.5`, click **Start here** on section 1, set `currentTime` to `4`, and click **End here**. The two inputs must show `1.50` and `4.00`. The project must not gain `settings.videoEdit.clips` until **Apply video edits**. Then click Apply and assert the stored pair.

Stop. Do not add the remove-range buttons in this slice.

## 2. Mark a remove range from the playhead

Add **Remove from here** and **Remove to here** beside the existing Cut from and Cut to inputs in `src/12a_video_edit_ui.js`.

**Remove from here** writes `video().currentTime` into the Cut from input. **Remove to here** writes it into the Cut to input. Round to the nearest hundredth of a second. Do not run the existing cut action. Do not change `draft.clips`.

Use `data-action="markCutStart"` and `data-action="markCutEnd"`. If the video has no duration, show `Load a video first.`

Files you may change are `src/12a_video_edit_ui.js` and `dev/video_edits_browser_test.js`.

Run the same four commands as slice 1.

Extend the browser test. Set `currentTime` to `0.5`, click **Remove from here**, set `currentTime` to `0.8`, and click **Remove to here**. The Cut from and Cut to inputs must show those times, and the kept section must be unchanged. Then click **Remove this time range** and assert the same kept pieces the test already expects for a cut from `0.5` to `0.8`.

Stop.

## 3. Add Simple and Advanced

Add a control to the caption style panel in `app/body.html`. The two choices are Simple and Advanced. The default is Simple.

In `src/12c_caption_workbench.js`, write `style.editor` through the existing `set-caption-style` command. The empty project sets `editor` to `simple`. A loaded project with no `editor` field renders as Simple.

Add an empty element `#captionTechniqueHost` in the style panel. Hide it when the editor is `simple` or missing. Show it when the editor is `advanced`. Leave the current family, strength, motion, density, position, accent, writing direction, and emphasis controls visible in both modes.

Do not call lyric `setMode`. Do not add `is-easy` or `pro-only` for this control.

Add the new Japanese phrase to `BODY` in `app/english.py` and to the matching `BODY` map in every language module that `tools/check_i18n.py` loads.

Files you may change are `app/body.html`, `src/12c_caption_workbench.js`, `app/english.py`, the other `app/` language modules, and `dev/caption_style_controls_test.js`.

Run these commands.

```text
node dev/caption_style_controls_test.js
node dev/lyric_smoke.js
python tools/check_i18n.py zh-Hant
python tools/check_i18n.py zh-Hans
python tools/check_i18n.py ko
python tools/check_i18n.py id
python tools/check_i18n.py vi
python build.py
```

The style-controls test must open as Simple, hide `#captionTechniqueHost`, switch to Advanced, show the host, and restore `simple` from a project that omits `editor`.

On the built caption page, confirm Simple hides the host and Advanced shows it. Reload and confirm the choice remains. Open Lyric Motion and confirm its easy or phone mode still appears.

Stop. Do not build the technique list in this slice.

## 4. Store the technique pool

Add `project.techniques` for caption projects. Add one undoable command, `set-technique`, in `src/12b_caption_store.js`.

The command is one of these two shapes.

```text
{ type: 'set-technique', set: 'kinetic', value: true }
{ type: 'set-technique', group: 'enter', entries: { pop: true, captionFade: false } }
```

`set` is one of the five set names. `group` is one of the ten group names. `value` is a boolean. Every value in `entries` is a boolean. One command is one undo step.

Reject an unknown set, an unknown group, a non-boolean value, or an id that is not in `J.registry(group)`. On rejection, leave the project and the undo stack unchanged.

Add `J.captionTechniques(project)`. It fills missing sets with false and missing group maps with empty objects. It does not write the project.

Add `J.captionTechniqueOn(project, group, id)`. It does not read `style.editor`. The rules are:

1. An explicit boolean in `enabled[group][id]` wins.
2. Otherwise the id is on only when `capabilities.captionSafe` is true and the active profile lists that id for the group.
3. Groups with no profile list use `captionSafe` alone for this default.
4. Every other missing id is off.

Do not call this function from `J.planCaptions` in this slice.

Files you may change are `src/12b_caption_store.js`, `src/08h_caption_planner.js` only if the profile-list lookup must live next to `styleFor`, and `dev/caption_store_test.js`.

Run these commands.

```text
node dev/caption_store_test.js
node dev/lyric_smoke.js
```

The store test must show all of the following.

- An old caption project with no `techniques` field loads.
- `J.captionTechniqueOn` is false for `knSlamStack`.
- `J.captionTechniqueOn` is true for a caption-safe entrance that the active profile lists, such as `captionFade` on the `creator` profile.
- An explicit false for that caption-safe id makes `J.captionTechniqueOn` false.
- An explicit true for `knSlamStack` makes `J.captionTechniqueOn` true and leaves `captionSafe` unset on that registry entry.
- Undo restores the previous pool.
- A lyric plan from `dev/fixtures/lyrics/smoke-project.json` is unchanged. `node dev/lyric_smoke.js` is that check.

Stop. Do not add UI in this slice.

## 5. Show the Techniques screen

Mount a caption-owned panel into `#captionTechniqueHost` from `src/12c_caption_workbench.js`. Read `J.order` and `J.registry`. Do not call `renderTech`. Do not read or write the lyric project.

Show the five set checkboxes first. Use the registry and the existing lyric labels for extra parts, Japanese motifs, typographic parts, kinetic parts, and horror. Those five checkboxes are enabled. They send `set-technique` and keep undo.

Then show the ten groups, collapsed, in the locked order. Each group shows its Japanese label, an on-count, **All on**, **All off**, **Invert**, and a name filter. Each part shows `def.name` and a checkbox.

Add `J.CAPTION_TECHNIQUE_DRAW` next to the panel. All ten values start as false. A group whose value is false shows its part checkboxes and its three bulk buttons disabled, plus the sentence `This group is not drawn on the video yet.` Set switches stay enabled.

A change to an enabled group sends one `set-technique` command for the ids that changed, then replans unlocked cues through the store. This slice does not enable any group, so the part boxes stay disabled. The commands must still work when a later slice flips a flag.

Files you may change are `src/12c_caption_workbench.js`, `app/body.html` only for a hook that slice 3 did not already add, `app/style.css` for layout of this panel, the language maps for any new Japanese phrase, and `dev/caption_workbench_test.js` or `dev/caption_style_controls_test.js`.

Run the style or workbench test, `node dev/lyric_smoke.js`, the five `check_i18n.py` commands, and `python build.py`.

The test must find all ten group names in Advanced, find the part checkboxes disabled, and find the five set checkboxes enabled. Simple must hide the host. Turning a set on must store the flag and must not change a lyric project's `enabled` map.

On the built page, open Advanced and confirm the ten groups and the disabled part boxes. Open Lyric Motion's technique tab and confirm it still changes only the lyric project.

Stop.

## 6. Let Advanced plans read the pool

Change `J.planCaptions` in `src/08h_caption_planner.js`.

When `style.editor` is not `advanced`, keep today's candidate lists. Ignore `project.techniques`.

When `style.editor` is `advanced`, a candidate id must pass `J.captionTechniqueOn`. It must also pass the set flags. An id with `extra`, `wa`, or `set` is out of the automatic pool when that flag is off, using the same meaning as `J.randomOk`. An explicit true does not override an off set for automatic planning. A later per-cue pin may still name that id. This slice has no per-cue pin.

Do not add `Math.random()`. Keep seeds deterministic.

Files you may change are `src/08h_caption_planner.js` and `dev/caption_planner_test.js`.

Run these commands.

```text
node dev/caption_planner_test.js
node dev/caption_store_test.js
node dev/lyric_smoke.js
```

Assert all of the following.

- Advanced, with no explicit ids and `kinetic` off, does not emit a kinetic layout id.
- Advanced, with one caption-safe entrance set to false, does not emit that entrance.
- Advanced, with `pop` set to true and the `enter` draw flag still false, may store `pop` on the plan. Drawing it is slice 7. This slice only checks the stored id.
- Simple, with `knSlamStack` set to true, still emits only caption-safe profile ids.

Stop.

## 7. Draw enabled entrance, hold, and exit

Set `J.CAPTION_TECHNIQUE_DRAW.enter`, `hold`, and `exit` to true. The Techniques screen enables those three groups. The other seven stay disabled. Update the slice 5 test to match.

`J.drawCaptionOverlay` already copies `plan.entrance`, `plan.hold`, and `plan.exit` onto the cut that `J.mainDraw` reads. Keep that path. Keep the zone clip. Do not rewrite token times.

If a lyric id is on the resolved plan, pass that id through. Unknown ids still fall back inside `J.mainDraw` to `cut`, `cut`, and `still`. Do not add that fallback again in the compositor.

Files you may change are `src/12c_caption_workbench.js`, `src/11c_caption_compositor.js` only if an id is dropped before `mainDraw`, the slice 5 test, and the dev test that already calls `J.drawCaptionOverlay`. Search `dev/` for `drawCaptionOverlay`.

Run the draw test, the workbench or style test, `node dev/caption_planner_test.js`, and `node dev/lyric_smoke.js`. Then `python build.py`.

The draw test enables one lyric entrance that has `apply`, such as `pop`, on one cue. The call to `drawCaptionOverlay` must not throw. A second call with that id turned off must use a caption-safe entrance again.

On the built page, switch to Advanced, turn that entrance on, and play the cue. Turn it off and confirm the cue returns to a caption-safe entrance. Switch to Simple and confirm the cue stays caption-safe even if the pool still has the lyric id on.

Stop.

## 8. Draw enabled text treatment

Set `J.CAPTION_TECHNIQUE_DRAW.treat` to true. Enable that group in the Techniques screen. Leave layout, decor, background, camera, frame effect, and transition disabled.

`J.mainDraw` applies `J.TREAT[cut.treat]` when `cut.treat` is set. Pass the resolved plan's treat id through. Do not confuse it with `captionTreatment`, which is the compositor paint `outline`, `backplate`, `neon`, or `echo`. Keep that paint. A lyric treat id is an extra `cut.treat` value.

Files you may change are the compositor, the workbench flag, and the draw test from slice 7.

Run that draw test and `node dev/lyric_smoke.js`. Rebuild before looking at the page.

The test enables one real `J.TREAT` id other than `none`. The draw call must not throw. With the id off, `cut.treat` must be unset.

On the page, turn that treatment on and off and confirm the cue changes and then returns.

Stop.

## 9. Draw enabled layouts

Set `J.CAPTION_TECHNIQUE_DRAW.layout` to true.

Caption layout ids keep using `J.composeCaptionLayout` inside the zone.

A lyric layout id uses `J.LAYOUTS[id].render`. Read `Renderer.drawCut` in `src/09_render.js` before writing the call. Build the smallest cut that render needs from the cue text, the cue duration, and the caption tokens. Do not replace `token.start` or `token.end`.

If the registry entry has `capabilities.requiresFullFrame` set true, or the entry has no `capabilities` object, draw that layout on the full video frame for the cue. The video plate is already drawn underneath. If the entry is caption-safe, keep the zone path.

Files you may change are `src/11c_caption_compositor.js`, the draw flag, and the draw test.

Run the draw test and `node dev/lyric_smoke.js`. Rebuild before looking at the page.

The test uses one lyric layout id with the pool flag on, and the same cue with the flag off. The off case must match a caption layout. The on case must call that layout's `render` or draw pixels outside the caption zone when the part is full-frame.

On the page, enable one lyric layout, play the cue, disable it, and confirm the caption layout returns. Simple must ignore the flag.

Stop.

## 10. Draw enabled decor

Set `J.CAPTION_TECHNIQUE_DRAW.decor` to true.

Read how `Renderer.drawCut` paints `J.DECOR`. For a caption-safe decor id, draw it around the caption box. For an id with `requiresFullFrame`, or with no `capabilities` object, draw it on the full frame for that cue.

Do not draw decor when the pool says the id is off.

Files you may change are the compositor and the draw test. Run the draw test and `node dev/lyric_smoke.js`. Rebuild before looking at the page.

On the page, enable one decor part and confirm it appears on that cue only. Disable it and confirm it is gone.

Stop.

## 11. Draw enabled background, camera, and frame effect

Set `J.CAPTION_TECHNIQUE_DRAW.bg`, `cam`, and `fx` to true together. These three groups only make sense on the video plate, so they land as one check.

Read `Renderer.drawCut` and the frame effect pass before editing. Apply an enabled background under the caption and over the video. Apply an enabled camera to that cue's frame. Apply an enabled frame effect to that cue's frame. A cue with all three off must look like the slice 10 result.

These parts can hide or flash the footage. That is allowed only when the pool enabled the id and the editor is Advanced.

Files you may change are the compositor and the draw test. Run the draw test and `node dev/lyric_smoke.js`. Rebuild before looking at the page.

On the page, enable one frame effect, confirm the cue changes, then turn it off and confirm the footage returns. Repeat for one background and one camera move. Simple must show none of them.

Stop.

## 12. Draw enabled transitions

Set `J.CAPTION_TECHNIQUE_DRAW.trans` to true.

A transition blends the previous cue's frame into the current cue's frame for the transition duration that the `J.TRANS` entry already uses. Read the lyric transition call before editing. If there is no previous cue, draw the current cue with no blend.

Files you may change are the compositor and the draw test. Run the draw test and `node dev/lyric_smoke.js`. Rebuild before looking at the page.

On the page, enable one transition, play across the boundary between two cues, and confirm the blend. Turn it off and confirm a hard change. Simple must not blend.

Stop.

## 13. Apply a lyric palette to caption colors

Add a palette control inside `#captionTechniqueHost`, visible only in Advanced.

Choosing a key from `J.STYLES` reads `schemes[0]` and writes `textColor`, `backgroundColor`, and `accentColor` through `replanStyle`. Do not set `style.preset` to the lyric style name. An unknown preset already falls back to `creator`. Do not copy texture, grain, ghost, or glitch.

Copy `fonts.body` only when the existing font loader can load that family before the next paint. If it cannot, leave the profile font in place and still apply the three colors.

Files you may change are `src/12c_caption_workbench.js`, `app/body.html`, the language maps, and `dev/caption_planner_test.js` or the workbench test.

Run the planner or workbench test, `node dev/lyric_smoke.js`, the five i18n checks, and `python build.py`.

The test sets one known lyric style key and asserts the three colors on the replanned plans. `style.preset` must still be `creator`, `punchy`, or `jizura-mv`.

On the page, pick a palette and confirm the subtitle colors change on the video. Lyric Motion's own style tab must still change only lyric projects.

Stop.

## 14. Add live technique thumbnails

Do this slice only after slices 7 through 12 are `done`.

For each visible part in an enabled group, paint one canvas with the lyric preview renderer. Use the same preview helper the lyric technique tab uses, or the smallest call that renders one registry id for about one second. Do not write the lyric project. Do not start a preview loop for a group whose draw flag is false.

Cap the work to canvases on screen. The lyric tab already uses an intersection observer for this. Follow that pattern in the caption panel without sharing its lyric project state.

Files you may change are `src/12c_caption_workbench.js` and a workbench test. Run that test, `node dev/lyric_smoke.js`, and `python build.py`.

On the page, open one enabled group and confirm a thumbnail paints. Collapse the group and confirm the loop stops. Open Lyric Motion and confirm its thumbnails still play.

Stop. This is the last slice.

## Commands used across slices

From the repo root:

```text
node dev/video_edits_test.js
node dev/video_edits_browser_test.js
node dev/caption_store_test.js
node dev/caption_style_controls_test.js
node dev/caption_planner_test.js
node dev/lyric_smoke.js
python tools/check_i18n.py zh-Hant
python tools/check_i18n.py zh-Hans
python tools/check_i18n.py ko
python tools/check_i18n.py id
python tools/check_i18n.py vi
python build.py
```

Run the commands named in the slice you are doing. A green command from an earlier slice does not close the current slice.
