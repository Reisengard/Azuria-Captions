# ADR 0002: Caption aesthetic spike findings

- Status: accepted as the Gate 0 visual direction
- Date: 2026-09-27
- Scope: caption-safe motion vocabulary and initial Creator/Punchy profiles

## Prototype

`dev/caption_aesthetic_spike.html` (since removed) rendered the canonical 15-second timed-word fixture at 1080×1920 logical resolution. `dev/caption_aesthetic_spike.js` contains a deliberately small seeded planner and renderer that remain isolated from production code until the project and token contracts land in Gate 1.

The demonstration covers:

- `bottomStack`, `centerStack`, and `twoLinePunch` layout families;
- `fade`, `softRise`, and `softScale` entrances;
- active-word color, underline, and a scale capped at 1.035;
- manual, numeric, punctuation, and repeated-word emphasis intent;
- calm Creator and stronger Punchy profiles;
- fixed-seed whole-plan visual variation that preserves text and timing.

## Findings

The direction is viable and worth carrying into the production caption pack.

- All reviewed frames fit the 1080×1920 canvas with at least 58 logical pixels of panel inset and 90 pixels of text-side margin.
- Line breaks are measured before active styling. Each word owns a fixed measured slot, so active color, underline, and scale do not reflow adjacent words.
- Creator uses restrained weight, lime active color, and motion classes 0–1.
- Punchy uses a larger/heavier face, warm active color, and selectively permits the restrained impact treatment.
- Empty pauses show no caption, avoiding stale text between spoken phrases.
- Repeating seed `3107` reproduces the exact plan. Seed `3108` changes visual choices while preserving token IDs, text, segment IDs, and timings.
- No full-frame flashes, inversion, destructive glitch, blur, bounce, or camera motion are needed to make the captions feel authored.

Representative manual checks were made at 1.5 seconds (manual numeric emphasis), 4.1 seconds (center layout and repeated word), and 6.9 seconds (two-line-safe family and active-word transition), in Creator and Punchy profiles.

## Production implications

- Port the three layout families behind zone-aware measurement rather than copying this renderer verbatim.
- Reserve maximum active-word geometry during measurement; active styling must never trigger a new line break.
- Keep structured emphasis intent separate from the visual effect choice.
- Default Creator segments to intensity 0–1 and allow Punchy intensity 2 only under a rolling attention budget.
- Use the existing JIZURA font/measurement and Canvas renderer in production; this prototype's system font and synthetic background are not product dependencies.
- Add the JIZURA / MV profile only after the reviewed safe component metadata and motion budget exist.

## Automated contract

`node dev/caption_aesthetic_check.js` verifies deterministic planning, variation invariants, layout/motion coverage, profile ordering, manual emphasis, timing bounds, active-token lookup, and pause behavior. It runs as part of `npm test --prefix dev`.

