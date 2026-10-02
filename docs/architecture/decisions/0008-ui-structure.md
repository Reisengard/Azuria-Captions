# ADR 0008: Interface structure of the Video Captions workbench

- Status: accepted
- Date: 2026-10-02
- Scope: `app/body.html`, `app/style.css`, `src/12bx_caption_shell.js`, `src/12bn_caption_popover.js`, `src/12br_caption_transport.js`
- Plan: `captions-editor-rework-plan.md` §6, steps U1–U5

## Decision

1. **Shell.** A slim top bar (brand, project name, Undo / Redo, Simple | Advanced, ⋯ menu, Export), an icon **rail**, one **drawer** at a time (Captions, Text, Effects, Tracks, Video), a preview-first stage and a timeline strip across the full width. The drawer choice is a view preference in `localStorage` (`jizura.captionShell`), never project data. Panes keep their ids; the shell only decides which are visible.
2. **Floating UI** (box popover, edit popover, toolbar, menus, toasts, Export and Help dialogs) goes through `12bn_caption_popover.js` or native `<dialog>`: Esc closes, focus returns to the opener.
3. **Narrow screens.** Under 1000 px the drawer overlays the stage. Under 680 px the rail becomes a fixed **bottom tab bar** (44 px targets, safe-area aware), the drawer a **sheet** above it (max 62 vh), the drawer starts closed when there is no saved preference, and the timeline shows **only the active track** (`.is-active-track` on its row and header; choosing a track header switches).
4. **Keyboard.** One handler in the transport (capture phase) owns the shortcuts; it ignores fields, open menus/popovers and open dialogs. Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y undo and redo through the store. Esc inside the drawer closes it and focuses its rail item. The Help dialog lists every shortcut.
5. **Focus and reading order** follow the visual order: top bar → rail → drawer → preview → transport → timeline. Hidden panes use `hidden`, so they are neither focusable nor read. Rail buttons are `aria-expanded` / `aria-controls`; the drawer is a labelled region; timeline blocks are focusable buttons labelled "text, start–end, track"; `#captionStatus` is the single polite live region for results; dialogs are native modals.
6. **Reduced motion.** The preview has its own switch; the shell has no animation beyond hover transitions, which `prefers-reduced-motion` turns off.

## Consequences

- Adding a drawer means one entry in `DRAWERS` and one rail button; narrow layout needs no change.
- A phone can review and make small edits; precise timeline editing stays a desktop task (plan §10).
- The `localized_build_test.py` chain covers the new English strings; `caption_ui_chrome_check.js` covers drawer Esc, undo keys and the 480 px layout in real Chrome.
