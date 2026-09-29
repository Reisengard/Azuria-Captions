# Third-party notices

## Mediabunny 1.60.0 (bundled)

`vendor/mediabunny-1.60.0.min.js` is embedded in the browser editions and is used to read, decode, encode, and mux media for Video Captions export.
Source: https://github.com/Vanilagy/mediabunny — licensed under the Mozilla Public License 2.0.
The complete license text is included at `vendor/mediabunny-LICENSE.txt`.

## mp4-muxer 5.2.2 (bundled)

`vendor/mp4-muxer.min.js` is embedded in `index.html` and is used to write MP4 files.
Source: https://github.com/Vanilagy/mp4-muxer — licensed under the MIT License:

```
MIT License

Copyright (c) 2023 Vanilagy

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Fonts (not bundled)

The web app loads the following typefaces at runtime from Google Fonts (https://fonts.google.com/); they are not
included in this repository. They are distributed by their authors under the SIL Open Font License 1.1:
Noto Sans JP, Noto Serif JP, Dela Gothic One, Zen Kaku Gothic New, Zen Old Mincho, Kaisei Tokumin,
M PLUS Rounded 1c, Mochiy Pop One, DotGothic16, Yuji Syuku, IBM Plex Mono, IBM Plex Sans JP.

### Bundled fonts

`assets/fonts/*.subset.woff2` are subsets (ASCII, Latin, kana, punctuation, JIS X 0208 level 1 kanji) of the faces listed in
`assets/fonts/manifest.json`, embedded in every edition. All are licensed under the SIL Open Font License 1.1
(https://openfontlicense.org/); the license text and copyright line of each family is in `assets/fonts/licenses/`.
They were obtained from https://github.com/google/fonts (`ofl/<family>`), variable fonts pinned to one weight and everything
subset with `tools/subset_font.py`; characters outside the subset fall back to the other faces in the font stack.
Faces: M PLUS Rounded 1c (ExtraBold), Noto Sans JP (500/700/900), Noto Serif JP (700), Zen Kaku Gothic New (Black),
Zen Old Mincho (Black), Dela Gothic One, IBM Plex Sans JP (Medium), IBM Plex Mono (Medium).
Noto Sans JP and the IBM Plex families declare Reserved Font Names ("Source", "Plex"); the subsets keep their original
internal names and are referenced by CSS family name only.
