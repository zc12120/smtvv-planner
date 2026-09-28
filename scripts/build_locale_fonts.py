"""Subset locally installed OFL Noto CJK fonts for the public language UI.

Optional authoring dependencies: fonttools and brotli. The browser and server
only need the generated WOFF2 files, not a Python font toolchain.
"""
import argparse
import json
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parents[1]


def build(source, output):
    output.mkdir(parents=True, exist_ok=True)
    for language, short, face in [('ja', 'jp', 0), ('zh-Hant', 'tc', 3), ('ko', 'kr', 1)]:
        ui = json.loads((ROOT / f'web/auth/theme/locales/{language}.json').read_text())
        text = ''.join(ui.values()) + '简体中文繁體中文日本語한국어English✓0123456789+-/ ·'
        game_path = ROOT / f'web/assets/locales/{language}.json'
        if game_path.is_file():
            game = json.loads(game_path.read_text())
            text += ''.join(row['name'] + row['description'] for row in game['demons'].values())
            text += ''.join(row['name'] + row['effect'] for row in game['skills'].values())
            text += ''.join(row['name'] for row in game['essences'].values())
            text += ''.join(game['races'].values()) + ''.join(game['aliases'].values())
        # Include all Latin/ASCII punctuation and numbers used by dynamic UI.
        text += ''.join(chr(code) for code in range(32, 256))
        for weight in ('Regular', 'Bold'):
            font = TTFont(source / f'NotoSansCJK-{weight}.ttc', fontNumber=face, recalcTimestamp=False)
            options = subset.Options()
            options.name_IDs = ['*']
            options.name_legacy = True
            options.name_languages = ['*']
            options.layout_features = ['*']
            subsetter = subset.Subsetter(options=options)
            subsetter.populate(text=text)
            subsetter.subset(font)
            font.flavor = 'woff2'
            destination = output / f'noto-{short}{"-bold" if weight == "Bold" else ""}.woff2'
            font.save(destination)
            print(destination.relative_to(ROOT), destination.stat().st_size)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=Path('/usr/share/fonts/opentype/noto'))
    parser.add_argument('--output', type=Path, default=ROOT / 'web/auth/theme/fonts')
    args = parser.parse_args()
    build(args.source, args.output)
