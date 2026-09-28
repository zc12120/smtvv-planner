"""Crop native UI icons from an RGBA atlas exported from a local SMT5V install.

The atlas and generated game images are optional assets, not part of the public
source distribution. This build tool neither downloads nor modifies game files.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
ATLAS_SIZE = (1024, 680)
CELL_SIZE, CELL_STRIDE, CELL_OFFSET = 80, 84, 4
ELEMENTS = {
    'phy': (0, 0), 'fir': (1, 0), 'ice': (2, 0), 'ele': (3, 0),
    'for': (4, 0), 'lig': (5, 0), 'dar': (6, 0), 'alm': (7, 0),
    'ail': (8, 0), 'sup': (9, 0), 'rec': (10, 0), 'pas': (0, 1),
    # These categories already share the passive glyph in the planner.
    'innate': (0, 1), 'spe': (0, 1),
}
AILMENTS = {
    'mir': (3, 2), 'sle': (4, 2), 'pan': (5, 2),
    'cha': (6, 2), 'sea': (7, 2), 'poi': (8, 2),
}


def digest(data):
    return hashlib.sha256(data).hexdigest()


def build(atlas_path, metadata_path, output):
    atlas_bytes = atlas_path.read_bytes()
    source = json.loads(metadata_path.read_text(encoding='utf-8'))
    if source.get('atlasSha256') != digest(atlas_bytes):
        raise ValueError('Atlas does not match its source metadata')
    with Image.open(io.BytesIO(atlas_bytes)) as original:
        if original.size != ATLAS_SIZE or original.mode != 'RGBA':
            raise ValueError('Expected the native 1024×680 RGBA icon_element_01 atlas')
        atlas = original.copy()

    files, icons = {}, {}
    for group, mapping in [('elements', ELEMENTS), ('ailments', AILMENTS)]:
        for key, (column, row) in mapping.items():
            x, y = CELL_OFFSET + column * CELL_STRIDE, CELL_OFFSET + row * CELL_STRIDE
            cell = atlas.crop((x, y, x + CELL_SIZE, y + CELL_SIZE))
            bounds = cell.getchannel('A').getbbox()
            expected = (8, 8, 72, 72) if group == 'elements' else (4, 4, 80, 80)
            if bounds != expected:
                raise ValueError(f'Unexpected native icon bounds: {group}/{key}: {bounds}')
            # Remove only transparent margins. No resampling, recoloring or sharpening.
            image = cell.crop(bounds)
            buffer = io.BytesIO()
            image.save(buffer, format='PNG', optimize=True)
            png = buffer.getvalue()
            with Image.open(io.BytesIO(png)) as check:
                if check.mode != 'RGBA' or check.tobytes() != image.tobytes():
                    raise ValueError(f'PNG round trip changed native pixels: {key}')
            relative = f'{group}/{key}.png'
            files[relative] = png
            icons[relative] = {
                'src': f'/assets/{relative}',
                'atlasCell': [column, row],
                'atlasCrop': [x + bounds[0], y + bounds[1], x + bounds[2], y + bounds[3]],
                'width': image.width, 'height': image.height,
                'sha256': digest(png), 'pixelSha256': digest(image.tobytes()),
                'bytes': len(png),
            }

    manifest = {
        'schemaVersion': 1, 'copyright': 'ATLUS / SEGA', 'source': source,
        'atlasSize': list(ATLAS_SIZE),
        'grid': {'cellSize': CELL_SIZE, 'stride': CELL_STRIDE, 'offset': CELL_OFFSET},
        'resampled': False, 'pngPixelsLossless': True,
        'elements': len(ELEMENTS), 'ailments': len(AILMENTS), 'icons': icons,
    }
    files['elements/manifest.json'] = (json.dumps(manifest, ensure_ascii=False, indent=2) + '\n').encode()
    # Finish all decoding and verification before updating any output.
    for relative in files:
        target = output / relative
        if target.resolve() in {atlas_path.resolve(), metadata_path.resolve()}:
            raise ValueError('Output would overwrite a source file')
    for relative, content in files.items():
        target = output / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.is_file() and target.read_bytes() == content:
            continue
        temporary = target.with_name(f'.{target.name}.{os.getpid()}.tmp')
        try:
            temporary.write_bytes(content)
            os.replace(temporary, target)
        finally:
            temporary.unlink(missing_ok=True)
    return {'elements': len(ELEMENTS), 'ailments': len(AILMENTS),
            'imageBytes': sum(icon['bytes'] for icon in icons.values()),
            'output': str(output)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('atlas', type=Path, help='Native RGBA icon_element_01.png')
    parser.add_argument('--source-metadata', type=Path, required=True,
                        help='Source JSON including atlasSha256 and extraction provenance')
    parser.add_argument('--output', type=Path, default=ROOT / 'web/assets')
    args = parser.parse_args()
    print(json.dumps(build(args.atlas, args.source_metadata, args.output), ensure_ascii=False))


if __name__ == '__main__':
    main()
