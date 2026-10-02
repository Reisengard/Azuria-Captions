# Caption Project Saving — Implementation Plan

## Recommendation

Implement this in **6 slices**, ideally one pull request per slice. Each slice should leave the caption editor usable and include its own focused tests.

The existing project serializer, loader, validation, migration, and video relinking provide the foundation. This is an extension of the caption project lifecycle, not a new editor or a replacement project format.

**Planning estimate:** approximately 7–12 developer-days for a developer familiar with the repository, including focused testing. This is a source-based estimate, not a delivery commitment. Browser compatibility and media relinking are the largest uncertainties.

## Scope

Repository: https://github.com/Reisengard/Azuria-Captions

Reviewed baseline: `main` at `ba0b614dcfa4c64429c526c0aa5fd866fa793cc2`.

Recheck the current branch before implementation. The observations below describe that reviewed baseline; the app and test suite were not run during this assessment.

### Intended experience

1. Create a caption project and give it a readable name.
2. Save its editable project file to the PC.
3. Continue editing with automatic browser recovery.
4. Return later and choose the project from Recent Projects or open its file.
5. Reconnect the source video automatically when access is available; otherwise select it through the existing relink flow.
6. Resume near the previous editing position with caption decisions preserved.

### Included

- Caption project naming and identity.
- Save, Save As, and Open.
- Unsaved-change tracking and protection when replacing a project.
- Automatic local recovery and recent projects.
- Remembered project and source-video file handles where supported.
- Basic editor-session restoration.
- Backward compatibility with existing caption project JSON files.

### Excluded

- Lyrics-mode changes or a shared project-manager rewrite.
- Cloud accounts, synchronization, collaboration, or server storage.
- Desktop application packaging or operating-system file associations.
- Embedding source videos in project JSON or creating portable media archives.
- New video-editing features.
- Persisting undo/redo history across sessions.
- Guaranteeing identical output across arbitrary future renderer versions or missing fonts.

Existing caption project settings that affect output must still survive save/load, even when they belong to the current video composition settings. Preserve them without expanding that feature area.

## Existing foundation

- `src/08a_project.js`: `J.saveProject`, `J.loadProject`, validation, and schema migration. Current schema version is 3.
- `src/12b_caption_store.js`: caption project state, command execution, serialization, and in-memory undo/redo.
- `src/12c_caption_workbench.js`: project creation, manual save/open, media import, and relink wiring.
- `src/12bo_caption_ui_state.js`: shared caption UI state and events.
- `src/10c_media_import.js`: source-media metadata, fingerprinting, and relinking.
- `src/11_export.js`: shared file-download helper. Avoid changing its behavior for lyrics and other exports.
- `app/body.html`: existing caption Save, Open, New, and relink controls.

The current caption Save downloads a JSON document. Open reloads that document and requires the original video to be selected again. The workbench starts with an empty project; its UI session and undo history are separate from serialized project data.

Existing tests worth extending include `dev/caption_project_lifecycle_test.js`, `dev/caption_store_test.js`, `dev/caption_schema_v3_test.js`, `dev/caption_tracks_test.js`, and `dev/media_import_test.js`. Some lifecycle tests are structural checks; they do not replace browser testing.

## Design rules for every slice

1. **The project document remains the portable source of caption data.** Continue using the existing serializer and loader; never reconstruct a project from UI controls.
2. **Use three separate persistence layers:** project JSON for editable content; browser recovery records for local drafts; browser session records for file handles and viewing position.
3. **Keep runtime objects out of project JSON.** No DOM nodes, video elements, object URLs, or file handles. Never treat an old object URL as a reusable video reference.
4. **Preserve stored plans on reopen and relink.** Do not rerandomize or regenerate caption animation decisions as a side effect of loading.
5. **Validate before replacing the active project.** A malformed file or failed recovery load must not destroy current work.
6. **Keep persistence caption-specific.** Use a dedicated storage namespace and controller; do not attach the caption editor to the lyrics autosave path.
7. **Distinguish recovery from file saving.** “Recovered locally” and “Saved to file” are different states. A successful browser backup does not mean the PC file was updated.
8. **Mark saves complete only after the relevant operation succeeds.** A fallback download can report “Download started,” but cannot prove that the user retained the file.

## Slice 1 — Project identity and lifecycle state

**Outcome:** the editor has a named caption document and can reliably tell whether its content differs from the last saved version.

**Estimated effort:** 1 day.

### Work

- Add a human-readable caption project name using an additive metadata field compatible with existing files, subject to the current validator. Derive a sensible fallback from the opened filename or existing ID.
- Introduce a caption-only lifecycle controller around the existing store and project events.
- Track the active document, a content revision, and the last successfully saved snapshot/revision. Do not rely only on `updatedAt`; imports and undo/redo must be covered.
- Define New, Open, Rename, Save, Save As, and Restore transitions.
- Define Save As as the same logical project at a new file destination for this release. Do not introduce a separate Duplicate feature.
- Keep editor selection, playhead, and other view changes out of content-dirty tracking.
- Make dirty state compare actual persisted content so undoing back to the saved state clears it.

### Acceptance checks

- Existing caption JSON opens without losing caption data or changing plans.
- Rename survives save/load; unnamed legacy files receive a usable display name.
- Text, timing, styles, tracks, overrides, and imports make the project dirty.
- Undo back to the saved content clears dirty state; redo makes it dirty again.
- Seeking or selecting a caption does not mark the document dirty.
- Opening invalid input leaves the current project untouched.

## Slice 2 — Dependable manual Save, Save As, and Open

**Outcome:** users can deliberately save to a PC file and replace the active project without silently losing edits.

**Depends on:** Slice 1.

**Estimated effort:** 1–2 days.

### Work

- Add caption-specific file operations that call `J.saveProject` and `J.loadProject`.
- Where supported, use browser file pickers and retain the project-file handle for the current session. Save updates that file; Save As chooses a new destination.
- Preserve the current download/upload approach as a fallback. Explain its behavior through concise status text.
- Keep existing `.json` projects supported; do not make a new extension a prerequisite.
- Use the project name for suggested filenames, with invalid filename characters removed.
- Add visible unsaved state, saving state, save errors, and cancellation handling.
- Before New, Open, or another action replaces unsaved content, provide Save / Discard / Cancel. A cancelled or failed save must not continue the replacement.
- Add a caption-scoped Ctrl/Cmd+S shortcut and a best-effort browser close/reload warning while dirty. Do not treat unload events as the recovery mechanism.
- If edits occur during an asynchronous save, mark only the captured snapshot as saved; newer edits remain dirty.

### Acceptance checks

- Save followed by Open preserves the complete serialized caption content.
- Supported browsers can save subsequent changes to the same chosen file.
- Picker cancellation, permission rejection, and write failure leave content intact and do not show a false success.
- Editing during a slow save does not accidentally clear dirty state.
- New/Open respects Save / Discard / Cancel, including failed saves.
- The fallback still downloads and opens project files without advanced file APIs.

## Slice 3 — Automatic local recovery

**Outcome:** a refresh or accidental closure no longer routinely loses recent caption edits.

**Depends on:** Slices 1–2.

**Estimated effort:** 1–2 days.

### Work

- Add a versioned, caption-only IndexedDB database for recovery records.
- Store validated serialized project snapshots, project ID/name, recovery revision, and last local-save time. Do not store video bytes.
- Debounce saves after content changes, including undo/redo and imports. A starting interval of roughly one second is reasonable; test responsiveness with large transcripts.
- Use transactional writes and prevent older asynchronous writes from replacing newer revisions.
- Offer recovery on startup. Keep recovery available when the source video is missing.
- Handle quota, unavailable storage, and corrupt-record failures with visible status while keeping manual file saving usable.
- Request persistent browser storage where appropriate, but handle denial normally.
- Define safe behavior for the same project in multiple tabs: detect competing revisions and preserve a recovery copy instead of silently overwriting newer work.

### Acceptance checks

- After a completed recovery write, refreshing restores caption content and stored plans.
- Undo/redo results are reflected in the next recovery snapshot.
- A failed write does not replace the last good recovery snapshot.
- Storage failure does not block editing or manual Save.
- Opening a different project cannot write a pending snapshot into the wrong project record.
- Concurrent tabs do not silently destroy one another’s newer recovery state.
- The UI distinguishes “Saved locally for recovery” from “Saved to file.”

## Slice 4 — Recent Projects and recovery selection

**Outcome:** users can return to previous caption work without locating a JSON file every time.

**Depends on:** Slice 3.

**Estimated effort:** 1–2 days.

### Work

- Add a compact Recent Projects entry point inside the caption interface.
- Show project name, last local edit time, and whether source media needs reconnection. Thumbnails are optional and not required for this slice.
- Open the selected validated local snapshot through the same lifecycle flow as a file open.
- Provide “Remove from this browser” with clear wording. This must not delete project or video files from the PC.
- Prevent duplicates during ordinary reopening of the same project.
- If an opened disk file and a local recovery record with the same project ID contain different content, offer a clear choice. Do not automatically replace either based solely on timestamps.
- Retain only useful projects; avoid filling the list with untouched empty documents.

### Acceptance checks

- Multiple projects can be edited, closed, and reopened independently.
- Recent-project switching protects unsaved changes in the active project.
- Removing a local entry does not touch disk files or other projects.
- A conflicting disk file and recovery snapshot remain recoverable until the user chooses.
- An old or corrupt local record cannot prevent the rest of the recent list from opening.

## Slice 5 — Remembered project and video access

**Outcome:** supported browsers reopen saved work with substantially fewer file-selection steps.

**Depends on:** Slices 2–4.

**Estimated effort:** 1–2 days.

### Work

- Store supported project-file and source-video handles in IndexedDB, associated with the project/session record rather than exported JSON.
- Use a file-handle-capable source picker where available; keep normal upload and relink controls working.
- On an explicit reopen action, check permissions and request renewed access if needed. Do not promise silent access in every session.
- Reuse the existing media controller to load and verify the remembered source. Fall back to manual relinking when it is moved, deleted, inaccessible, or mismatched.
- Do not let a recent-project record silently overwrite a disk project changed elsewhere; detect changed disk content before a later Save and offer reload or Save As.
- Review fingerprint compatibility: the current fingerprint includes `lastModified` and samples file contents. Copying a video with a different timestamp can therefore prevent a match.
- Version any improved fingerprint scheme and maintain a deliberate path for legacy references. Do not silently replace the old algorithm or accept files by name alone.
- For ambiguous legacy matches, require an explicit user decision rather than pretending identity has been proven. Keep caption timing and plans unchanged.

### Acceptance checks

- Reopening with valid stored handles and permission restores media without another file selection.
- Revoked access produces a usable permission/relink path rather than a broken project.
- Missing or wrong media leaves caption data editable and intact.
- Save/load/relink does not change caption plans, overrides, timing, or tracks.
- Copying or renaming the original video follows the documented matching behavior.
- Legacy fingerprints and projects remain supported.
- Unsupported browsers retain the manual workflow.
- External disk edits cannot be silently overwritten through a stale remembered handle.

## Slice 6 — Resume editing position and verify the complete flow

**Outcome:** reopening feels like resuming a caption session, and the combined feature is ready to ship.

**Depends on:** Slices 1–5.

**Estimated effort:** 1–3 days.

### Work

- Persist a small, separate session record: playhead time, selected caption/track, timeline zoom and scroll, and useful panel selection.
- Restore content first, reconnect media second, and restore view state only after the relevant UI/media is ready.
- Validate saved IDs and clamp playback position to the available duration. Ignore unknown view fields safely.
- Keep playback paused on reopen. Undo/redo history starts fresh by design.
- Ensure reopening prepares the fonts needed by stored caption plans; surface unavailable fonts without silently regenerating plans.
- Review status language so an in-memory edit is never described as a completed disk save.
- Add a brief caption help explanation for project files, local recovery, and relinking.
- Run an end-to-end browser scenario with edited text/timing, multiple tracks, per-caption overrides, stored effects, save, close, reopen, relink, and continued editing.
- Run focused persistence tests and the relevant existing caption regression suite. Build and smoke-check the generated/localized application using the repository’s current build process.

### Acceptance checks

- Reopening restores a valid selected caption and useful timeline position.
- Missing captions, changed media duration, or stale session data do not crash the editor.
- Restoring view state does not dirty the document or change its exported content.
- Browser recovery and disk reopen preserve the same caption decisions.
- Both advanced-file-API and fallback flows pass browser testing.
- Lyrics behavior remains unchanged in a focused smoke check.
- No promise of persistent undo history, guaranteed media access, or browser storage as a permanent backup appears in the UI.

## Delivery order and useful stopping points

Implement in order: **1 → 2 → 3 → 4 → 5 → 6**.

- **After Slice 2:** a dependable manual PC project-file workflow.
- **After Slice 3:** manual files plus automatic recovery; a useful first release if time is tight.
- **After Slice 4:** a convenient local project library, with manual media relinking as needed.
- **After Slice 6:** the recommended complete experience, including remembered access and editing position.

Do not postpone all testing until Slice 6. Each slice needs tests for its own failure cases before the next builds on it.

## Suggested implementation boundaries

Use small caption-specific modules for lifecycle state, browser storage, and file access; exact names should follow current repository conventions. Keep workbench changes focused on orchestration and controls.

Use the existing project serializer as the content boundary, not raw browser storage of the entire `ui` object. Store a recovery schema version separately from the project schema version. Add a project migration only when a document-format change actually needs it.

Prefer a shared Open/Restore path so disk loading and browser recovery cannot develop different rules for validation, unsaved changes, media cleanup, fonts, and preserved plans.

## Deferred follow-up: portable project package

Consider a separate feature after these six slices if users need to move complete projects between computers. A package could contain project JSON and the original media, but introduces large-file streaming, package validation, cancellation, storage usage, and packaging compatibility work. It is not necessary to deliver convenient local caption saving and reopening.

## Technical references

- [Reviewed caption workbench](https://github.com/Reisengard/Azuria-Captions/blob/ba0b614dcfa4c64429c526c0aa5fd866fa793cc2/src/12c_caption_workbench.js)
- [Reviewed project serializer and loader](https://github.com/Reisengard/Azuria-Captions/blob/ba0b614dcfa4c64429c526c0aa5fd866fa793cc2/src/08a_project.js)
- [Reviewed caption store](https://github.com/Reisengard/Azuria-Captions/blob/ba0b614dcfa4c64429c526c0aa5fd866fa793cc2/src/12b_caption_store.js)
- [Reviewed media relinking and fingerprinting](https://github.com/Reisengard/Azuria-Captions/blob/ba0b614dcfa4c64429c526c0aa5fd866fa793cc2/src/10c_media_import.js)
- [Browser file access and stored handles](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access)
- [Browser storage quotas and eviction](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria)
