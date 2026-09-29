# JIZURA — Three-Mode Product Requirements Document

> **Scope revision (2026-09-28):** Live Captions / OBS (§4.3, §9.3, §9.4, §10, Live Control UI in §11, Phase 4, the Live alpha release criteria, `liveSafe`) are **removed from scope**. `docs/architecture/subtitle-mvp-delta-plan.md` (decision D7) overrides this file.

**Repository:** [Reisengard/JIZURA](https://github.com/Reisengard/JIZURA)  
**Status:** Development-ready product and technical specification  
**Product modes:** Video Captions, Lyric Motion, Live Captions  
**Primary platform:** desktop Chromium browsers first; an optional local companion for Live Captions  
**Decision:** keep JIZURA's motion-design engine; generalize its lyric-only planning and input workflow.

---

## 1. Executive summary

JIZURA is a browser-based lyric motion-video generator. Its transferable asset is the procedural typography and motion system: it combines independently registered layouts, entrances, holds, exits, decorations, treatments, backgrounds, cameras, effects, and transitions into deterministic animated cuts. The project also has Canvas rendering, browser-side video export through WebCodecs and MP4 muxing, PNG/transparent-layer export, and After Effects / CEP deliverables.

The fork becomes **JIZURA**, a kinetic-text studio with exactly three product modes:

1. **Video Captions** — import an existing video, transcribe or import timed captions, plan readable kinetic captions, preview over the video, and export a finished video or transparent caption layer.
2. **Lyric Motion** — preserve and improve the existing full-frame lyric-motion workflow for music videos and expressive text-led visual pieces.
3. **Live Captions** — run a local caption service that receives microphone or stream audio, processes real-time speech recognition, and provides a transparent animated overlay for OBS Browser Source (and other browser-overlay consumers).

This is not a transcription product whose only differentiator is an animation preset. Transcription provides *what was said and when*; the caption planner determines *how speech becomes readable visual units*; JIZURA decides *how those units are expressed*. The result should be substantially more art-directable than commodity subtitles without requiring After Effects for every word.

## 2. Vision, goals, and non-goals

### Vision

Make high-quality kinetic typography practical for everyday creator video, music work, and live streaming. A creator should be able to generate a good first pass in minutes, selectively re-roll visual decisions, lock what works, correct words or timing, and export reliably.

### Product principles

- **Readability comes before spectacle.** Caption animation must support comprehension, not compete with it.
- **Automation is editable.** Every transcript correction, segment boundary, emphasis decision, and visual decision needs a stable identity and a human override.
- **One creative engine, mode-specific planners.** Do not build three animation engines.
- **Deterministic creativity.** A seed plus project data must reproduce an edit; a user can re-roll only a chosen segment.
- **Progressive capability.** A normal talking-head caption should be mostly calm. Big JIZURA moments should be rare, intentional, and visible in the planner.
- **Local-first live operation.** Live audio and transcription must not silently leave the machine; hosted ASR is an explicit provider choice.

### Success measures

- A creator can produce and export a captioned 9:16 clip with an editable word-timed transcript in one session.
- A normal style remains legible at 1× playback and does not trigger high-attention effects on every segment.
- A streamer can add a transparent OBS Browser Source and receive stable captions without JIZURA encoding the stream.
- Changing a transcript word changes only affected segments unless the user elects to re-plan downstream content.
- A seeded re-render produces equivalent visual decisions and timing.

### Non-goals for the first releases

- Replacing professional NLEs, DAWs, or full compositing software.
- Training or operating a proprietary speech-recognition model.
- Perfect diarization, multilingual translation, or word timing for every language on day one.
- Editing OBS scenes through OBS WebSocket merely to display captions.
- Guaranteeing browser-only export for arbitrary codecs, enormous files, DRM media, or every mobile browser.
- Supporting all 707 legacy creative components in caption-safe styles at launch.

## 3. Users and jobs to be done

| User | Job | Primary mode |
|---|---|---|
| Short-form creator | Turn talking-head footage into readable, branded captions quickly | Video Captions |
| Editor / agency | Apply a repeatable caption language while retaining exceptions and reviewability | Video Captions |
| Music / MV creator | Produce expressive full-frame lyric typography | Lyric Motion |
| Streamer / VTuber | Show attractive accessible captions in a stream without rendering a new video | Live Captions |
| Moderator / producer | Inject manual announcements, lower thirds, or corrections into a live overlay | Live Captions |

## 4. Product scope by mode

### 4.1 Video Captions

**Input:** local video file plus automatic transcription, SRT, WebVTT, ASS/SSA where practical, or JIZURA timed-caption JSON.  
**Core flow:** inspect media → acquire transcript → edit words / timing → create segments → plan visual treatment → preview over source video → lock/re-roll/edit → export.  
**Output:** composited MP4 where browser capability permits; otherwise a supported local-export route; PNG sequence and transparent caption-only exports where feasible; project JSON.

Caption-specific requirements:

- Word timing, optional speaker labels, confidence, language, and source provenance.
- Caption-safe placement using user-safe zones and optional manually supplied subject/face exclusion regions.
- Multiple aspect ratios: 9:16 first, then 16:9, 1:1, 4:5, and custom.
- Active-word state and restrained progression styles.
- Per-segment and per-word overrides, locks, and re-plan controls.

### 4.2 Lyric Motion

This remains a first-class mode rather than a compatibility screen. It retains lyric input, existing lyric syntax and impacts, timing/audio analysis, full-frame backgrounds, camera movement, transitions, and expressive packs. It may import timed lyrics and should eventually share the transcript/caption data model where it helps.

Lyric Motion is allowed a much larger motion budget because text is the composition, not an accessibility layer over footage. It remains the place for heroic type, more aggressive motion, graphic backgrounds, and MV effects.

### 4.3 Live Captions

JIZURA Live is a local service plus Control UI and transparent Overlay UI:

```text
microphone / application or stream audio
              ↓
       selected ASR provider
              ↓  partial + final word events
       live segmenter + caption planner
              ↓
        local caption state store
           ↙                 ↘
  Control UI              Overlay WebSocket
 localhost:3847/control   localhost:3847/overlay
                                  ↓
                         OBS Browser Source
                                  ↓
                              livestream
```

OBS is responsible for composition, video, and broadcasting. JIZURA only serves a transparent browser-rendered typography layer. The product must not require OBS WebSocket for normal caption delivery; OBS WebSocket is optional later for scene/event integrations.

Live requirements:

- audio-device selection and level indication;
- provider, language, latency mode, style, position, intensity, and profanity controls;
- a local overlay URL, transparent background, reconnect behavior, and a test card;
- partial and committed caption states;
- manual text/event injection and a clear-caption control;
- no dependency on video decoding or MP4 encoding during live operation.

## 5. What this approach can and cannot do

### Can do well

- Produce diverse, deterministic animated typography from structured timed text.
- Apply effects at word, phrase, segment, or full-frame scope.
- Preview source video plus captions in a browser Canvas workflow.
- Import/export caption-oriented formats and preserve JIZURA-specific decisions in JSON.
- Use WebCodecs when the browser exposes a suitable decoder/encoder configuration.
- Serve an HTML/Canvas transparent overlay to OBS, Streamlabs, vMix browser inputs, or a local browser.
- Use local or hosted ASR adapters and substitute them without rewriting the planner.
- Keep ordinary captions quiet while reserving stronger motion for semantically or manually important moments.

### Cannot promise

- Browser APIs cannot reliably decode every file/codec/container combination. H.264/AAC MP4 is the practical initial import baseline; browser support varies for HEVC, ProRes, AV1, VFR media, multi-track media, captions embedded in containers, and very large files.
- A `<video>` element alone is not frame-accurate export infrastructure. Accurate compositing needs decoded frames with timestamps, careful audio handling, and capability checks.
- WebCodecs availability, codecs, hardware acceleration, memory ceilings, and muxing support differ by browser and OS. A browser capability probe and fallbacks are required.
- Canvas font rendering, browser font availability, and color handling can differ from After Effects or native tools. Export must embed/choose licensed web fonts and document variance.
- Local browser code cannot freely capture arbitrary desktop or application audio without permissions and platform-specific constraints. The live companion can provide more predictable capture options.
- ASR partial results are inherently revisable. The UI must not pretend they are final.
- Live captions cannot be both zero-latency and maximally accurate; the product exposes the tradeoff rather than hiding it.
- Automated emphasis, face avoidance, semantic interpretation, and diarization are suggestions, not truth. User override is mandatory.

## 6. Technical architecture

### 6.1 Bounded layers

```text
Inputs / adapters
  media import | captions | local/hosted ASR | manual live text
          ↓
Canonical timed-text model
  tokens, timings, revisions, confidence, speakers, metadata
          ↓
Mode planners
  caption segmentation | lyric cuts | live incremental commits
          ↓
Visual plan
  caption-safe effect selection, layout, motion budget, locks, seed
          ↓
Existing JIZURA renderer
  Canvas draw + component registries + effects
          ↓
Mode outputs
  preview/export | lyric MP4/AE | transparent WebSocket overlay
```

The planner must be a pure(ish), testable transformation from stable source/project data and seed to a visual plan. Rendering consumes the plan; it must not silently make new random design decisions per frame.

### 6.2 Existing repository foundation

The current application is assembled from sorted `src/*.js` files by `build.py`; it embeds `app/body.html`, `app/style.css`, vendor MP4 muxing, and produces the browser editions. The central registry in `src/05b_registry.js` separates `layout`, `enter`, `hold`, `exit`, `decor`, `treat`, `bg`, `cam`, `fx`, and `trans`. `src/08_planner.js` currently maps lyric material into cuts; `src/08b_omakase.js` provides mood/style choice including calmer `calm` and `editorial` behavior. Preserve that component model, but insert new typed project data and mode planners before it.

### 6.3 Canonical data model

Use versioned JSON. IDs never derive only from array position.

```ts
type TimedToken = {
  id: string; text: string; normalizedText?: string;
  start: number; end: number; confidence?: number;
  speakerId?: string; source: "asr" | "import" | "manual";
  revision?: number; final: boolean;
  emphasis?: number; manualEmphasis?: boolean;
};

type CaptionSegment = {
  id: string; tokenIds: string[]; start: number; end: number;
  text: string; status: "draft" | "committed" | "locked";
  boundarySource: "planner" | "manual" | "live";
  safeZone?: SafeZone; visualOverrides?: VisualOverrides;
};

type VisualPlan = {
  id: string; segmentId: string; seed: number;
  layout: string; enter: string; hold: string; exit: string;
  treatment?: string; decorations?: string[]; camera?: string;
  effects?: string[]; intensity: 0 | 1 | 2 | 3 | 4;
  motionCost: number; attentionCost: number;
  captionSafe: boolean; lockedFields: string[];
};
```

`Project` contains schema version, mode, source-media references/metadata (not necessarily bytes), transcript, segments, visual plans, style profile, global seed, manual overrides, export settings, and migrations. Store source fingerprints to warn when a project opens against different media.

### 6.4 Caption planner

The caption planner converts a sequence of `TimedToken` records into `CaptionSegment`s, then into constrained visual plans.

Segmentation signals, in priority order:

1. manually locked boundaries and edits;
2. finality / revisions (live mode);
3. pauses, punctuation, and timing gaps;
4. maximum duration, words, glyphs, and line count for aspect ratio and font size;
5. linguistic phrase boundaries when language tooling is available;
6. speaking pace and readability budget;
7. semantic emphasis and style intent.

The planner should never split inside a token. It should prefer 2–6 readable words for common short-form styles but expose style-specific limits. It must return reasons/diagnostics for its decisions so a UI can explain a break (for example, “0.42 s pause” or “exceeded 22 glyphs”).

Emphasis is a score and provenance, not an effect. Compute an initial value from punctuation, user marks, lexical/semantic signals, repetition, and optional acoustic features; retain each contribution. Map it to visual choices only in the style planner. This prevents an ASR or semantic model from hardcoding a specific animation.

### 6.5 Active word state

At render time a token is `upcoming`, `active`, or `spoken`. For an offline segment, exact word timestamps drive the state. A caption-safe default does not reposition the entire phrase as the active word changes; it alters a local property such as fill, weight, 1.00→1.04 scale, or a tiny underline.

## 7. Motion strategy: calm by default, expressive by exception

The existing code already has viable quiet materials. `calm` and `editorial` in `src/08b_omakase.js` reduce motion, glitch, chroma, decoration density, and background switching. Useful existing vocabulary includes `cut`, `blur`, `type`, `wipe`, `still`, `drift`, `breathe`, `shrink`, slow `push`, and the editorial direction in `specimen`, with selective material from `paper` and `sumi`. `breathe` and `drift` are appropriate only when bounded conservatively; `still` is a valid and often superior caption hold.

### 7.1 Intensity classes and metadata

Add component metadata rather than create a separate caption renderer:

| Class | Intent | Examples | Caption default |
|---|---|---|---|
| 0 Static | no motion | cut, still, simple outline/box | common |
| 1 Subtle | low-attention support | fade, blur, soft rise, wipe, active color | default maximum |
| 2 Expressive | deliberate emphasis | small pop, type, cascade, moderate zoom | rare / emphasis only |
| 3 Loud | attention-dominant | slam, bounce, spin, assemble, RGB split | opt-in profiles |
| 4 MV / FX | full-frame spectacle | explode, destructive glitch, strobe, inversion | Lyric Motion only by default |

Every registered primitive needs at least `intensity`, `motionCost`, `attentionCost`, `captionSafe`, `liveSafe`, and optional incompatibilities (for example, `requiresFullFrame`, `flashes`, `movesCamera`). Existing effects can be classified incrementally; unknown components default to not caption-safe.

### 7.2 Motion budget

A style profile carries `maxIntensity`, `motionBudget`, `attentionBudget`, and allowed categories. A standard segment normally receives **one primary motion plus at most one low-cost secondary behavior**: e.g., `softRise + activeColor`, or `fade + still`. It must not combine entrance, bouncing hold, camera move, RGB split, decoration animation, and transition merely because each is independently available.

The budget is per segment and rolling-window based. Adjacent hero moments must spend from a short-term attention budget, preventing three visually loud captions in succession. Manual overrides can exceed the budget with a warning.

### 7.3 Recommended subtle primitives

Implement these caption-oriented primitives early:

- `fade`: opacity only.
- `softRise`: opacity 0→1 and Y +12px→0 in roughly 160 ms.
- `softScale`: opacity 0→1 and scale .97→1, no overshoot.
- `wordFade`: small sequential word opacity stagger.
- `activeLift`: active word scale 1→1.04 and Y −2px.
- `activeWeight`: active-word weight/fill change without geometry motion.
- `activeUnderline`: a brief, low-height underline sweep.
- `softReplace`: crossfade outgoing/incoming phrases with stable anchoring.

No strobe, inversion, full-frame flash, large rotation, explosive glitch, aggressive mosaic, or screen replacement is caption-safe by default. Such components remain valuable in Lyric Motion and explicit expressive profiles.

## 8. Caption safety and placement

Create a `captionSafe` metadata contract for components and a placement system independent of visual styling.

- Safe zones: top, center, bottom, custom polygon/rectangle; default insets for vertical social UI.
- Exclusion zones: user-drawn regions first; future optional face/subject tracking as advisory data.
- Legibility constraints: minimum contrast, outline/shadow/backplate fallback, maximum line count, minimum font size, and no motion that makes reading position unpredictable.
- Anchor stability: an active word must not cause a line to reflow unexpectedly.
- Accessibility: export text/timing sidecar where feasible; retain captions in project data; warn when style violates contrast or flash rules.

Automated subject avoidance must never be destructive or invisible. If it moves a caption, the UI exposes the resulting placement and permits lock/disable.

## 9. Transcription architecture

### 9.1 Provider adapter contract

Define adapters instead of coupling JIZURA to one service:

```ts
interface TranscriptionProvider {
  transcribe(input: AudioInput, options: TranscriptionOptions): AsyncIterable<TranscriptEvent>;
  capabilities(): { wordTimestamps: boolean; partials: boolean; diarization: boolean; local: boolean };
}
```

`TranscriptEvent` supports `partial`, `final`, `error`, `level`, and optional `speaker` events. Normalize provider-specific payloads into canonical tokens. Provider implementations may include a local engine, a user-configured hosted API, and import parsers. Credentials are never serialized into projects or sent to the overlay.

### 9.2 Offline transcription

Video Captions may extract/decode audio, submit/capture it through the chosen adapter, and receive word timestamps. If a provider lacks word timestamps, the UI must label that limitation and either use segment-level timing or offer a separate alignment step. Imported SRT/VTT timing is usually cue-level and should not be misrepresented as word-accurate.

### 9.3 Live partial vs final transcript handling

Live ASR creates two different visual states:

- **Pending:** revisable partial text. Use stable anchoring, very restrained append/replace behavior, no hero motion, and a different semantic status from finalized captions.
- **Committed:** final tokens or a segment passed by a configurable confidence/boundary policy. It can receive an entrance or final-word accent, but does not retroactively thrash previously displayed text.

On a partial revision, preserve the longest stable token prefix, replace only the mutable suffix, and rate-limit redraws. Do not animate each cumulative ASR partial as a new caption. Finality can be inferred from provider final events, pause thresholds, punctuation, elapsed holdback, or manual commit—each recorded as provenance.

### 9.4 Live latency modes

| Mode | Policy | Benefit | Tradeoff |
|---|---|---|---|
| Fast | show partials immediately; small mutable window | lowest apparent delay | more revisions |
| Balanced | short holdback; commit stable phrases | good stability/latency balance | modest delay |
| Accurate | favor final results / longer phrase buffer | cleanest wording and animation | noticeable delay |
| Broadcast-delay assist | align captions to an intentional 1–2 s stream delay | best synchronization and quality | unsuitable for latency-sensitive streams |

Values are provider/network dependent and must be shown as measured telemetry, not guaranteed numbers. The control UI should show ASR delay, planner delay, overlay round-trip, and rendered caption age.

## 10. OBS overlay design

The local companion binds only to loopback by default (e.g., `127.0.0.1:3847`) and serves:

- `/overlay` — a transparent, full-size Canvas/HTML page intended for OBS Browser Source;
- `/control` — authenticated local control panel;
- `/health` — status without sensitive transcript history;
- `/ws` — a WebSocket for state snapshots, patches, and heartbeats.

The overlay starts with transparent CSS/canvas, chooses an OBS-configured canvas size, reconnects with backoff, requests a complete state snapshot after reconnect, and renders a safe fallback (“Caption service unavailable” only in a control/debug option, never by default on stream). OBS setup is simple: add Browser Source → use `http://127.0.0.1:3847/overlay` → set intended resolution/FPS → leave background transparent.

Use an origin/token strategy appropriate to the local process. Do not expose the service on LAN by default. If LAN overlay support is later added, require an explicit bind choice, ephemeral bearer token, CORS/origin allowlist, and visible security warning.

Manual injection is a separate event type: `manualCaption`, `lowerThird`, `announcement`, or `clear`. This enables moderation and streamer automation without falsely mixing manual text with ASR transcript records. OBS WebSocket integrations (scene-aware safe zones, hotkeys, source visibility) are later optional adapters.

## 11. UX and editing requirements

### Shared shell

The mode picker is explicit and contains only **Video Captions**, **Lyric Motion**, and **Live Captions**. Each mode writes the same project envelope with mode-specific sections.

### Video Captions editor

- Media preview with overlay and scrubber.
- Transcript list with word-level timing and confidence markers.
- Segment timeline with editable boundaries and locks.
- Inspector: style profile, safe zone, position, intensity, emphasis, and individual visual plan controls.
- Re-roll visual, re-plan segment, re-plan unlocked selection, and restore seeded result.
- Diagnostics for unsupported media/export paths and readability problems.

### Lyric Motion editor

Keep current lyric-focused controls and make project migration explicit. Advanced caption metadata should not clutter the lyric flow unless it is imported/timed.

### Live Control UI

Audio source, provider/language, latency mode, style/intensity, position, max words, delay, profanity behavior, overlay link, start/stop, manual injection, and status. The UI must make “pending” versus “committed” visible in preview.

## 12. File-by-file repository change plan

Exact filenames should be verified against the fork before each implementation slice; the following plan uses the current repository layout and preserves its build ordering.

| Path | Change |
|---|---|
| `README.en.md`, `README.md` | Reposition product, document all three modes, supported browser/media constraints, privacy, licensing, and development commands. |
| `LICENSE`, `THIRD_PARTY_NOTICES.md` | Keep MIT notice; inventory any ASR, font, muxer, and live-server dependencies before shipping. |
| `build.py` | Extend assembly only after modular mode files are added; keep deterministic ordering and produce any distinct live/control assets deliberately. |
| `app/body.html` | Add mode selection, media import, transcript/timeline/editor shells, and live control/overlay mount points. Avoid embedding business logic in markup. |
| `app/style.css` | Add responsive editor layout, caption inspector, diagnostics, safe-zone and live-control styling; keep overlay styles separately scoped/transparent. |
| `app/english.js`, `app/english.py` | Localize all new mode, transcript, export, and live status strings. |
| `src/05b_registry.js` | Add component metadata schema and validation for intensity, costs, `captionSafe`, `liveSafe`, and incompatibilities. |
| `src/08_planner.js` | Extract lyric-only assumptions into a Lyric Motion planner. Do not overload it with asynchronous ASR or UI state. |
| `src/08b_omakase.js` | Add caption style profiles, motion/attention budget constraints, and a planner that favors existing calm/editorial components. |
| Existing component pack files in `src/` | Classify existing primitives incrementally; mark unknown/unsafe effects unavailable to caption/live profiles until reviewed. |
| **New:** `src/09_project_model.js` | Versioned project schema, IDs, migrations, serialization, and lock/override helpers. |
| **New:** `src/10_timed_text.js` | Canonical tokens, import normalization, revision merge, and validation. |
| **New:** `src/11_caption_segmenter.js` | Offline segmentation, explanations, manual-boundary preservation, and tests. |
| **New:** `src/12_caption_planner.js` | Emphasis mapping, safe placement, motion budgets, and visual-plan generation. |
| **New:** `src/13_caption_primitives.js` | Register `fade`, `softRise`, `softScale`, `wordFade`, active-word treatments, and `softReplace`. |
| **New:** `src/14_media_input.js` | Capability probing, media metadata, video/audio ingestion, frame/timestamp abstraction, and clear unsupported-media errors. |
| **New:** `src/15_transcription.js` | Provider interface, import adapters, credential boundary, progress/error normalization. |
| **New:** `src/16_caption_editor.js` | UI controller for transcript, segment edits, preview synchronization, locks, and diagnostics. |
| Existing renderer/export source files in `src/` | Introduce source-video-underlay compositing and active-word state without regressing Lyric Motion export. Gate features on capabilities. |
| `dev/` | Add fixture projects/media metadata, deterministic planner snapshots, visual regression harness, and tests for imports/exports. |
| `docs/EXPRESSION_PACKS.md` | Document new metadata requirements and caption/live-safe authoring rules. |
| `ae/`, `JIZURA_AE*.jsx`, `cep/` | Keep functional for Lyric Motion initially. Treat caption/video/ASR/live parity as a later explicit program, not an accidental promise. |
| **New companion:** `live/` | Local service, ASR adapters, audio capture adapters, `/overlay`, `/control`, WebSocket protocol, and packaging instructions. Keep it separable from static GitHub Pages. |

The existing sorted-file build strategy becomes fragile as async media/live code grows. Early in Phase 1, document ordering dependencies; before the codebase becomes difficult to maintain, migrate the browser app to a small explicit module/bundling boundary while preserving the static deploy outcome. This is a maintainability change, not a product rewrite.

## 13. Implementation roadmap

### Phase 0 — Foundation and audit (1–2 weeks)

- Create schema, component metadata contract, project fixtures, feature flags, and browser capability matrix.
- Audit every currently selectable primitive for intensity/safety rather than assuming names imply behavior.
- Freeze a set of reference project outputs and establish deterministic planner snapshots.
- Do not change Lyric Motion results without a migration/compatibility test.

**Exit:** a project can load/save a versioned envelope; current components have explicit default safety behavior.

### Phase 1 — Caption planning without video export (2–4 weeks)

- Build timed-text model, SRT/VTT/JIZURA JSON import, transcript editing, segmentation, active-word states, style profiles, motion budgets, and new subtle primitives.
- Provide a Canvas caption preview against a neutral background first.
- Build calm defaults from `calm`, `editorial`, `specimen`, and reviewed components.

**Exit:** imported timed captions become editable, deterministic caption plans with readable preview and re-roll/lock behavior.

### Phase 2 — Video Captions MVP (3–6 weeks)

- Add media capability probe, video-underlay preview, source timing synchronization, safe-zone tools, and supported export path.
- Add at least one transcription adapter plus explicit import-first fallback.
- Validate vertical short-form workflow and error handling for unsupported media.

**Exit:** supported local MP4 input can become a captioned preview and export; unsupported inputs fail intelligibly and retain project edits.

### Phase 3 — Editing and production hardening (3–5 weeks)

- Word/segment correction, emphasis overrides, project migration, partial re-planning, accessibility checks, recovery, browser performance work, and export QA.
- Add project-only / transparent output options where technically supported.

**Exit:** an editor can correct a transcript and selectively alter design without rebuilding the sequence.

### Phase 4 — Live Captions alpha (4–8 weeks)

- Build local companion, loopback service, overlay, Control UI, one local or explicitly configured ASR provider, partial/final reconciliation, latency modes, and manual injection.
- Test OBS setup and long-running reconnects.

**Exit:** a single streamer can operate a stable transparent OBS overlay for a two-hour test stream under defined hardware/network conditions.

### Phase 5 — Integrations and expansion

- More ASR providers/languages, speaker labeling, optional OBS WebSocket, Streamer.bot-style event adapter, scene safe-zone mapping, caption translation, and AE caption interchange only after a separate feasibility decision.

## 14. Testing and quality plan

### Unit tests

- Token normalization, timestamps, edits, IDs, revision merge, and schema migration.
- Segmenter boundaries across pauses, punctuation, rapid speech, long words, CJK/no-space languages, and manual locks.
- Emphasis provenance, budgets, intensity filtering, and no-unsafe-component guarantees.
- Live mutable-suffix algorithm and out-of-order/duplicate provider events.

### Integration tests

- Caption import → plan → render deterministic fixture snapshots.
- Media capability detection and supported/unsupported input messaging.
- Seek, pause, speed, and timeline synchronization.
- WebSocket reconnect/state snapshot and overlay cleanup.
- ASR adapter contract fixtures, including partial revisions and provider failure.

### Visual regression tests

Render deterministic frames at representative aspect ratios and compare with approved tolerance. Include text clipping, safe zones, contrast, active-word anchors, motion budgets, fonts, and every caption-safe primitive. Visual tests must cover both 30/60 fps and reduced-motion mode.

### Manual acceptance tests

- 60-second talking-head vertical clip: default captions remain readable and mostly quiet.
- rapid gaming clip: explicit expressive profile respects rolling motion budget.
- multilingual/corrected transcript: no corrupt token or timing shifts.
- unsupported HEVC/large/VFR file: clear route to conversion/import alternative, no data loss.
- OBS: startup, source reload, network/provider outage, audio-device change, and two-hour soak.

### Performance budgets

Set measurements per target device, rather than inventing universal targets. Record dropped preview frames, encode FPS, memory use, ASR latency, caption age, and overlay reconnect time. The planner must never block the render loop; expensive transcription/analysis runs off the UI-critical path.

## 15. Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Browser codec/API fragmentation | broken imports/exports | capability probe, narrow supported baseline, import-first workflow, documented fallback routes |
| Caption motion is distracting | product misses everyday creator use | safety metadata, calm default, motion budget, visual QA, reduced motion |
| ASR revisions cause flicker | live overlay feels unreliable | pending/committed states, stable-prefix merge, rate limits, latency modes |
| Large browser projects exhaust memory | failed export / crashes | limits, progress/cancellation, chunked pipelines where possible, recovery projects |
| Static app cannot host live service | deployment confusion | separate packaged local companion; GitHub Pages remains browser/lyric application |
| Dependency/font licensing | legal distribution risk | third-party ledger, font licensing review, provider terms review, license notices |
| Original engine regressions | harms current users | preserved Lyric Motion planner, fixtures, feature flags, compatibility tests |
| Automated semantic/face decisions are wrong | loss of user trust | advisory metadata, explanations, simple override/lock, never silently bake decisions |

## 16. Licensing, privacy, and distribution

The upstream repository states an MIT license; retain copyright and license notices in source and redistributions. MIT permits commercial and non-commercial use, modification, and redistribution subject to notice preservation. It does **not** grant rights to copyrighted lyrics, music, video, fonts, third-party models, or assets used in outputs.

Before release:

- Keep `THIRD_PARTY_NOTICES.md` accurate for mp4-muxer, any new packages, ASR engines/models, embedded fonts, and packaged live binaries.
- Do not bundle fonts unless their license permits embedding/distribution; provide user-installed or web-font choices with provenance.
- Do not imply that the MIT license clears a creator's use of copyrighted song lyrics/audio/video.
- Make transcription routing explicit: local provider means local processing; hosted provider displays destination/provider policy and requires user configuration/consent.
- Bind Live Captions to loopback by default and never log raw audio/transcript by default beyond session needs.

## 17. Release criteria

### Video Captions MVP

- Exactly three visible product modes and no ambiguous fourth workflow.
- Supported video plus timed-caption import produces an editable, deterministic preview.
- Default style is caption-safe, has a maximum intensity of 1, and passes clipping/contrast checks on fixtures.
- At least one supported export path completes with synchronized captions and audio on the supported browser baseline.
- Project save/load preserves locks, manual edits, seeds, and warnings.

### Live Captions alpha

- Local service stays loopback-only by default and overlay background is truly transparent in OBS.
- Partial and final results are visually and logically distinct.
- Fast, Balanced, Accurate, and Broadcast-delay assist are documented policies with measured telemetry.
- Provider outage/reconnect does not crash the overlay or flood the stream with debug text.
- A documented OBS Browser Source setup succeeds on the supported baseline.

## 18. Immediate next actions

1. Clone/pin the fork state and create Phase 0 fixtures before implementing UI.
2. Add the project/timed-text schema and component metadata contract first.
3. Extract a caption planner that runs against imported timed text before adding ASR or video export.
4. Implement the small subtle primitive set and caption-safe profile; establish visual regression snapshots.
5. Add supported video preview/export in a capability-gated slice.
6. Ship Live Captions only as a separate local companion after the shared planner is proven offline.

This sequencing protects JIZURA's existing creative identity while establishing a practical, testable path to three coherent modes instead of three disconnected applications.
