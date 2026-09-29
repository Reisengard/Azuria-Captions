# 0009 — Caption effects are chosen, not drawn

- Status: accepted (2026-09-29, owner request)
- Scope: Video Captions planning (`08h`, `08m`), store (`12b`), workbench (`12c`).
- Supersedes: the "random pick per attempt" part of ADR 0003 for effects. Seeds stay for anything that is not an effect choice.

## Problem

The planner picked layout, entrance, hold, exit, text treatment, decoration and active-word treatment for every caption from a seeded pool. The result looked different caption to caption and the user could not set a standard for the video. "Create variation" and "Reroll" only changed the seed.

## Decision

1. **A look is a set of plain choices**, one per stage: `layout`, `enter`, `hold`, `exit`, `active` (and `treat`, advanced only). Values are registry ids.
2. **Resolution order, per stage:** the caption's own override (`plan.manual`) → the track's `style.look` → the project's `style.look` → older per-stage style fields (`effect`, `holdEffect`, `exitEffect`) → the **standard look of the style profile** (`J.CAPTION_STANDARD_LOOKS`). Nothing in this chain is random; the project seed no longer affects any effect.
3. **Standard looks are fixed per profile** and tested to be inside the motion budget with no warnings.
4. **Randomness is a button.** `randomize-caption-look` (project, track or one caption) draws a look with `J.randomCaptionLook` (seeded from project seed, scope and a variation number) and **stores the result as ordinary choices**. It is deterministic for the same inputs, undoable, never re-drawn on re-plan, and skips locked captions and locked fields. `reroll-track` / `reroll-segment` are kept as aliases of it.
5. **Commands:** `set-caption-look` (`trackId` optional, `look` merges, `null` clears a stage, `reset`), `set-segment-look`, `randomize-caption-look`. Track look is validated inside `set-track-style` too (`look` field).
6. **The motion budget only reports.** A chosen look is planned with `manualOverride`: budget and continuity violations are stored as `overBudget` and shown as a warning; the effect is never swapped. Component safety (caption-safe metadata, portrait, emoji, duration, incompatibilities) stays mandatory: an unusable choice is replaced by the safe default and recorded in `lookWarnings` (`look-unavailable`).
7. **Fit:** a caption that does not fit keeps its look and gets a smaller font (`font-reduced`, reported). Only when the smallest font still does not fit, or the caption is too short to read, does it become the static plan (`fallback`), as before.
8. Decoration is no longer picked: the compositor never drew it, it only used budget.

## Consequences

- Plan snapshots were regenerated on purpose (uniform standard look; `lookWarnings`, `overBudget`, `attempt: 0`).
- Stored plans in existing projects keep their generated values until re-planned; after a re-plan they take the standard look (their own choices, `style.effect` etc. and manual overrides, are kept).
- The simple editor offers the caption-safe set; the advanced editor offers the enabled techniques. The technique toggles now decide what can be *chosen*, not what may be drawn by chance.
- `createCaptionVisualVariation` and `rerollCaptionVisual` still exist; they now store a random look (project / one caption) instead of re-seeding.
- The per-track rolling-attention figure in `motionSummary` still counts neighbours on every track, so it can change on other tracks when one track changes. It is informational.

## Addendum — effect settings (2026-09-29)

- A look can carry **settings** for its effects: `lookSettings = { stage: { all | effectId: { key: value } } }`, stored beside `look` on the project style, a track style, or a caption's `plan.manual`. Layering matches the look: caption > track > project; an unset key keeps the effect's own value (planned from the seed, or its colour rule).
- The schema is `J.CAPTION_LOOK_SETTINGS` (`08m`): shared per stage (`enter`/`exit` length, `hold` strength) plus hand-picked effects (two-tone split, gradient, outlines, shadows, glow, active-word colour/scale/lift/weight). Other effects show "no adjustable settings" until added there.
- Treatment settings are merged into the treatment's params (`cut.treatP`); the curated treatments read explicit colours (`color`, `colorA`, `colorB`) before their automatic colour rules. Lyric Motion never sets these keys, so it renders as before.
- Commands: `set-caption-look` / `set-segment-look` take `lookSettings` (a `null` value clears one setting); `reset` clears settings with the look. Undoable like every command.
- Shown only in the Advanced editor, under the effect grid's sub-tab.

