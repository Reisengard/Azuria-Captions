"""Run the disposable Gate 0.3 browser spike and capture its output.

Usage: python dev/media_spike_runner.py [chrome-executable]
"""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import json
import os
import subprocess
import sys
import tempfile
import threading
import time

ROOT = Path(__file__).resolve().parent.parent
GENERATED = ROOT / "dev" / "fixtures" / "media" / "generated"
OUTPUT = GENERATED / "media-spike-output.mp4"
RESULT = GENERATED / "media-spike-result.json"
DONE = threading.Event()


class Handler(SimpleHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def do_POST(self):
        length = int(self.headers.get("Content-Length", "0"))
        data = self.rfile.read(length)
        if self.path == "/__media_spike_output":
            OUTPUT.write_bytes(data)
        elif self.path == "/__media_spike_result":
            RESULT.write_bytes(data)
            DONE.set()
        else:
            self.send_error(404)
            return
        self.send_response(204)
        self.end_headers()


def chrome_path():
    if len(sys.argv) > 1:
        return Path(sys.argv[1])
    candidates = [
        Path(os.environ.get("PROGRAMFILES(X86)", "")) / "Microsoft/Edge/Application/msedge.exe",
        Path(os.environ.get("PROGRAMFILES", "")) / "Google/Chrome/Application/chrome.exe",
    ]
    return next((path for path in candidates if path.exists()), None)


def main():
    serve_only = "--serve-only" in sys.argv
    chrome = None if serve_only else chrome_path()
    if not serve_only and not chrome:
        raise SystemExit("Chrome or Edge was not found; pass the browser executable path.")
    source = GENERATED / "portrait-15s-30fps-av.mp4"
    if not source.exists():
        raise SystemExit("Generate media fixtures first with dev/fixtures/media/generate.ps1.")
    GENERATED.mkdir(parents=True, exist_ok=True)
    for path in (OUTPUT, RESULT):
        if path.exists():
            path.unlink()
    os.chdir(ROOT)
    server = ThreadingHTTPServer(("127.0.0.1", 8766 if serve_only else 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    sample_seconds = float(os.environ.get("JIZURA_SPIKE_SECONDS", "15" if serve_only else "0.1"))
    url = f"http://127.0.0.1:{server.server_port}/dev/media_spike.html?autorun=1&report=1&seconds={sample_seconds}"
    if serve_only:
        print(url, flush=True)
        try:
            if not DONE.wait(600):
                raise SystemExit("Media spike timed out after 10 minutes.")
        finally:
            server.shutdown()
    else:
      with tempfile.TemporaryDirectory(prefix="jizura-media-spike-") as profile:
        command = [
            str(chrome), "--headless=new", "--disable-background-timer-throttling",
            "--autoplay-policy=no-user-gesture-required", "--no-first-run", "--no-default-browser-check",
            f"--user-data-dir={profile}", url,
        ]
        browser = subprocess.Popen(command, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)
        deadline = time.monotonic() + 600
        try:
            while not DONE.wait(1):
                code = browser.poll()
                if code is not None:
                    detail = browser.stderr.read().strip()
                    raise SystemExit(f"Browser exited before reporting (code {code}).\n{detail}")
                if time.monotonic() >= deadline:
                    raise SystemExit("Media spike timed out after 10 minutes.")
        finally:
            browser.terminate()
            try:
                browser.wait(timeout=10)
            except subprocess.TimeoutExpired:
                browser.kill()
            server.shutdown()
    result = json.loads(RESULT.read_text(encoding="utf-8"))
    print(json.dumps(result, indent=2))
    if not result.get("ok"):
        raise SystemExit(1)
    probe = json.loads(subprocess.check_output([
        "ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", str(OUTPUT)
    ], text=True))
    video = next(stream for stream in probe["streams"] if stream["codec_type"] == "video")
    audio = next(stream for stream in probe["streams"] if stream["codec_type"] == "audio")
    expected_duration = result["output"]["duration"]
    assert video["codec_name"] == "h264" and video["pix_fmt"] == "yuv420p"
    assert int(video["width"]) == 1080 and int(video["height"]) == 1920
    assert video["avg_frame_rate"] == "30/1"
    assert int(video["nb_frames"]) == result["output"]["frames"]
    assert abs(float(video["duration"]) - expected_duration) < 0.001
    assert audio["codec_name"] == "aac" and int(audio["sample_rate"]) == 48000
    assert abs(float(audio["duration"]) - expected_duration) < 0.05
    print(f"FFprobe passed: {video['nb_frames']} H.264 frames, {video['duration']}s video, {audio['duration']}s AAC audio.")


if __name__ == "__main__":
    main()
