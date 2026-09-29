"""Local browser regression trial: python dev/caption_browser_trial.py VIDEO SRT.
Open http://127.0.0.1:8766/dev/caption_browser_trial.html.
The supplied files stay on localhost and are not copied into the repository.
"""
import argparse
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlsplit

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('video', type=Path)
parser.add_argument('subtitles', type=Path)
parser.add_argument('--port', type=int, default=8766)
args = parser.parse_args()
files = {'/trial-video.mp4': args.video.resolve(strict=True), '/trial.srt': args.subtitles.resolve(strict=True)}
root = Path(__file__).resolve().parent.parent

class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(root), **kw)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def do_GET(self):
        source = files.get(urlsplit(self.path).path)
        if source:
            data = source.read_bytes()
            self.send_response(200)
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)
        else:
            super().do_GET()

print(f'Open http://127.0.0.1:{args.port}/dev/caption_browser_trial.html', flush=True)
ThreadingHTTPServer(('127.0.0.1', args.port), Handler).serve_forever()
