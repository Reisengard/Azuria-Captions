"""Subset a TTF to Latin + kana + punctuation + JIS X 0208 level 1 kanji and write woff2 (for assets/fonts).
usage: python tools/subset_font.py IN.ttf OUT.woff2 [WEIGHT]      (WEIGHT pins a variable font's wght axis)
Needs: pip install fonttools brotli"""
import sys
from fontTools import subset
from fontTools.ttLib import TTFont

chars = set()
for lead in range(0x81, 0x99):
    for trail in range(0x40, 0xFD):
        code = (lead << 8) | trail
        if lead == 0x98 and code > 0x9872: continue      # end of JIS level 1 kanji
        try: chars.add(bytes([lead, trail]).decode('shift_jis'))
        except UnicodeDecodeError: pass
for lo, hi in ((0x20, 0x7F), (0xA0, 0x250), (0x1E00, 0x1F00), (0x2000, 0x2070), (0x3000, 0x3100), (0xFF00, 0xFFF0)):
    chars |= {chr(c) for c in range(lo, hi)}
options = subset.Options(); options.flavor = 'woff2'; options.layout_features = ['*']; options.name_IDs = ['*']; options.notdef_outline = True
font = TTFont(sys.argv[1])
if len(sys.argv) > 3:
    from fontTools.varLib import instancer
    font = instancer.instantiateVariableFont(font, {'wght': float(sys.argv[3])})
subsetter = subset.Subsetter(options); subsetter.populate(text=''.join(chars)); subsetter.subset(font)
font.flavor = 'woff2'; font.save(sys.argv[2])
