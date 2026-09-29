# Video Captions release-candidate checklist

Record evidence instead of checking an item by assumption.

## Environment

- Date:
- Commit:
- Hardware / RAM / GPU:
- Operating system:
- Chrome or Edge version and fresh-profile confirmation:
- Fixture manifest/hash:

## End-to-end acceptance

- [ ] Open Video Captions without developer tools.
- [ ] Import the 15-second portrait H.264/AAC fixture.
- [ ] Import word-timestamp JSON and confirm word timing.
- [ ] Correct a word; split and merge a caption.
- [ ] Set manual emphasis, lock a segment, reroll another, and create a variation.
- [ ] Check Creator, Punchy, and JIZURA / MV at normal speed.
- [ ] Seek backward/forward, replay after end, and rapidly seek without timing drift.
- [ ] Save, close, reopen, reject a wrong source, then relink the correct source.
- [ ] Export and cancel once at mid-run; confirm work stops and retry succeeds.
- [ ] Export twice consecutively with original audio.
- [ ] Open both outputs in Chrome and an independent player.
- [ ] Verify 30 fps, expected frame count, start at zero, duration tolerance, audible audio, and first/last captions.
- [ ] Repeat graceful-layout checks with the landscape, silent, 24 fps, and 60 fps fixtures.

## Measurements

- Preview rendered/dropped callbacks and adaptive preview scale:
- Memory after import, repeated seek, project close, export 1, and export 2:
- Three-minute planner generation time:
- Export 1/2 elapsed seconds, real-time factor, and frames/second:
- Cancellation cleanup observations:
- File-handle/object-URL/callback cleanup observations:

## Creative and accessibility review

- [ ] Long word, fast/slow speech, silence, number, repeated word, emoji, mixed text, and CJK cases remain readable.
- [ ] No default plan flashes, clips, covers the subject continuously, or creates adjacent hero moments.
- [ ] Estimated timing, static fallback, missing font, contrast, overflow, line-count, and safe-area warnings are truthful.

## Sign-off

- Critical/high defects:
- Known limitations added to release notes:
- Tester (not the feature implementer):
- Result: PASS / FAIL
