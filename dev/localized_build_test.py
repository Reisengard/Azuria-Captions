"""Regression checks for product controls in generated localized browser editions."""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

for relative in (Path('index.html'), Path('en/index.html')):
    html = (ROOT / relative).read_text(encoding='utf-8')
    assert 'id="productVideoCaptions"' in html, f'{relative} omitted the Video Captions mode button'
    assert 'id="productLyricMotion"' in html, f'{relative} omitted the Lyric Motion mode button'
    assert 'id="productLiveCaptions"' in html, f'{relative} omitted the Live Captions mode button'
    assert 'id="captionStyle"' in html, f'{relative} omitted the caption style selector'
    assert '<option value="creator">Creator</option>' in html, f'{relative} omitted the Creator style option'
    assert '<option value="jizura-mv">JIZURA / MV' in html, f'{relative} omitted the JIZURA / MV style option'

print('Localized product mode and caption style build tests passed.')
