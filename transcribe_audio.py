from pathlib import Path
import json
import sys

from faster_whisper import WhisperModel


AUDIO = Path(r"E:\Downloads\Web\Screen_Recording_20260927_222530_WhatsApp_H.264_1.m4a")
OUTPUT = Path(r"Z:\AI\Projects\JIZURA\audio_transcript.json")
sys.stdout.reconfigure(encoding="utf-8")


def timestamp(seconds: float) -> str:
    whole = int(seconds)
    return f"{whole // 3600:02d}:{(whole % 3600) // 60:02d}:{whole % 60:02d}"


model = WhisperModel("large-v3", device="cuda", compute_type="float16", local_files_only=True)
segments, info = model.transcribe(
    str(AUDIO),
    language="pt",
    beam_size=5,
    vad_filter=True,
    condition_on_previous_text=True,
)

result = {
    "language": info.language,
    "language_probability": info.language_probability,
    "duration": info.duration,
    "segments": [],
}

for segment in segments:
    item = {
        "start": segment.start,
        "end": segment.end,
        "start_time": timestamp(segment.start),
        "end_time": timestamp(segment.end),
        "text": segment.text.strip(),
    }
    result["segments"].append(item)
    print(f"[{item['start_time']} - {item['end_time']}] {item['text']}", flush=True)

OUTPUT.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
print(f"Saved {len(result['segments'])} segments to {OUTPUT}", flush=True)
