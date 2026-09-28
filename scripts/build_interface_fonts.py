"""Build the locally served interface/display fonts from OFL font sources.

Source directory: Barlow-{Regular,Medium,SemiBold,Bold}.ttf, Cinzel.ttf,
ArchivoBlack-Regular.ttf, ChakraPetch-SemiBold.ttf and their *-OFL.txt files.
Noto Serif CJK is read from --cjk-source. No network access is used by this tool.
"""
import argparse
import json
from pathlib import Path
import sys

from fontTools import subset
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def save_subset(source, destination, text, face=None):
    options = subset.Options()
    options.name_IDs = ['*']
    options.name_legacy = True
    options.name_languages = ['*']
    options.layout_features = ['*']
    font = TTFont(source, recalcTimestamp=False, **({'fontNumber': face} if face is not None else {}))
    worker = subset.Subsetter(options=options)
    worker.populate(text=text)
    worker.subset(font)
    font.flavor = 'woff2'
    font.save(destination)
    print(destination.name, destination.stat().st_size, flush=True)


def build(source, cjk_source, output):
    import planner
    output.mkdir(parents=True, exist_ok=True)
    latin = ''.join(chr(code) for code in range(32, 591)) + '–—‘’“”…·×→←✓'
    for weight in ('Regular', 'Medium', 'SemiBold', 'Bold'):
        save_subset(source / f'Barlow-{weight}.ttf', output / f'barlow-{weight.lower()}.woff2', latin)
    for filename, name in [('Cinzel.ttf', 'cinzel'), ('ArchivoBlack-Regular.ttf', 'archivo-black'), ('ChakraPetch-SemiBold.ttf', 'chakra-petch')]:
        save_subset(source / filename, output / f'{name}.woff2', latin)
    for name in ('Barlow', 'Cinzel', 'ArchivoBlack', 'ChakraPetch'):
        notice = (source / f'{name}-OFL.txt').read_text()
        (output / f'{name}-OFL.txt').write_text('\n'.join(line.rstrip() for line in notice.splitlines()) + '\n')
    catalog = planner.catalog()
    for language, short, face in [('zh-Hans', 'sc', 2), ('ja', 'jp', 0), ('zh-Hant', 'tc', 3), ('ko', 'kr', 1)]:
        ui = json.loads((ROOT / 'web/auth/theme/locales' / ('en.json' if language == 'zh-Hans' else language + '.json')).read_text())
        text = latin + ''.join(ui if language == 'zh-Hans' else ui.values())
        if language == 'zh-Hans':
            text += ''.join(item['label'] for key in ('demons', 'skills', 'essences') for item in catalog[key])
            text += ''.join(item['raceLabel'] for item in catalog['demons'])
        else:
            game_path = ROOT / 'web/assets/locales' / (language + '.json')
            if game_path.is_file():
                game = json.loads(game_path.read_text())
                text += ''.join(item['name'] for key in ('demons', 'skills', 'essences') for item in game[key].values())
                text += ''.join(game['races'].values())
        save_subset(cjk_source / 'NotoSerifCJK-Bold.ttc', output / f'archive-serif-{short}.woff2', text, face)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('--cjk-source', type=Path, default=Path('/usr/share/fonts/opentype/noto'))
    parser.add_argument('--output', type=Path, default=ROOT / 'web/auth/theme/fonts')
    args = parser.parse_args()
    build(args.source, args.cjk_source, args.output)
