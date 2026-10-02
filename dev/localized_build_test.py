"""Regression checks for product controls in generated localized browser editions."""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

EDITIONS = ('index.html', 'en/index.html', 'ko/index.html', 'zh-hans/index.html', 'zh-hant/index.html', 'id/index.html', 'vi/index.html')

for name in EDITIONS:
    html = (ROOT / name).read_text(encoding='utf-8')
    assert '@LANG_NAV@' not in html, f'{name} left the language menu marker in the page'
    assert html.count('class="lang-switch"') == 2, f'{name} needs a language menu in both the Lyric Motion and the Video Captions top bar'
    assert 'id="captionModeEasy"' in html and 'id="captionModePro"' in html, f'{name} omitted the Simple/Advanced toggle in the captions bar'

for relative in (Path('index.html'), Path('en/index.html')):
    html = (ROOT / relative).read_text(encoding='utf-8')
    assert 'id="productVideoCaptions"' in html, f'{relative} omitted the Video Captions mode button'
    assert 'id="productLyricMotion"' in html, f'{relative} omitted the Lyric Motion mode button'
    assert 'id="captionStyle"' in html, f'{relative} omitted the caption style selector'
    assert 'id="captionRolesPanel"' in html, f'{relative} omitted the text roles panel'
    assert 'window.JIZURA_BUNDLED_FONTS' in html, f'{relative} omitted the bundled font list'
    assert '<option value="creator">Creator</option>' in html, f'{relative} omitted the Creator style option'

# A translation with a stray quote breaks the whole page (the editor never starts), so every inline script must still parse.
import re, subprocess, tempfile
for name in EDITIONS:
    html = (ROOT / name).read_text(encoding='utf-8')
    for index, match in enumerate(re.finditer(r'<script>(.*?)</script>', html, re.S)):
        with tempfile.NamedTemporaryFile('w', suffix='.js', delete=False, encoding='utf-8') as handle:
            handle.write(match.group(1))
        result = subprocess.run(['node', '--check', handle.name], capture_output=True, text=True)
        Path(handle.name).unlink()
        assert result.returncode == 0, f'{name} script #{index} has a syntax error: {result.stderr[:300]}'

print('Localized product mode and caption style build tests passed.')
