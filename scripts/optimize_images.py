"""Build lossless portrait copies and a smaller decorative illustration."""
import argparse
import hashlib
import json
from pathlib import Path
import tempfile

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
RECIPE = b'responsive-lossless-v1:96,192,original:lanczos'


def atomic_bytes(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=path.parent, prefix='.asset-', delete=False) as output:
        temporary = Path(output.name)
        output.write(data)
    try:
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def save_webp(image, path, lossless=True, quality=100):
    import io
    buffer = io.BytesIO()
    image.save(buffer, format='WEBP', lossless=lossless, quality=quality, method=6, exact=True)
    atomic_bytes(path, buffer.getvalue())


def optimize(root):
    manifest_path = root / 'demons/manifest.json'
    report = {'portraits':0, 'uniqueSources':0, 'sourceBytes':0, 'fullWebpBytes':0, 'smallWebpBytes':0}
    if manifest_path.is_file():
        manifest = json.loads(manifest_path.read_text())
        seen = {}
        for section in ('demons', 'essences'):
            for record in manifest.get(section, {}).values():
                source_url = record.get('display', {}).get('src')
                if not isinstance(source_url, str) or not source_url.startswith('/assets/demons/display/'):
                    continue
                source = root / source_url.removeprefix('/assets/')
                if not source.resolve().is_relative_to((root / 'demons/display').resolve()) or not source.is_file():
                    raise ValueError('Invalid portrait display source')
                if source_url not in seen:
                    content = source.read_bytes()
                    digest = hashlib.sha256(content + RECIPE).hexdigest()[:12]
                    with Image.open(source) as opened:
                        image = opened.convert('RGBA')
                    variants = []
                    for width in sorted({min(96,image.width), min(192,image.width), image.width}):
                        height = max(1, round(image.height * width / image.width))
                        destination = root / 'demons/optimized' / f'{source.stem}-{digest}-{width}.webp'
                        if not destination.is_file():
                            resized = image if width == image.width else image.resize((width,height),Image.Resampling.LANCZOS)
                            save_webp(resized, destination)
                        variants.append({'src':'/assets/' + destination.relative_to(root).as_posix(), 'width':width, 'height':height})
                    seen[source_url] = {'format':'webp', 'variants':variants}
                    report['uniqueSources'] += 1
                    report['sourceBytes'] += len(content)
                    report['fullWebpBytes'] += (root / variants[-1]['src'].removeprefix('/assets/')).stat().st_size
                    report['smallWebpBytes'] += (root / variants[0]['src'].removeprefix('/assets/')).stat().st_size
                record['optimized'] = seen[source_url]
                report['portraits'] += 1
        atomic_bytes(manifest_path, (json.dumps(manifest,ensure_ascii=False,indent=2)+'\n').encode())
    artwork = root / 'story-art.webp'
    if artwork.is_file():
        with Image.open(artwork) as source:
            image = source.convert('RGBA')
        width = min(720, image.width)
        resized = image.resize((width,round(image.height*width/image.width)),Image.Resampling.LANCZOS)
        destination = root / 'optimized/story-art.webp'
        save_webp(resized,destination,lossless=False,quality=94)
        report['artwork'] = {'beforeBytes':artwork.stat().st_size,'afterBytes':destination.stat().st_size,'width':width,'quality':94}
        if destination.stat().st_size >= artwork.stat().st_size:
            destination.unlink()
            report['artwork']['usedOriginal'] = True
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--assets',type=Path,default=ROOT/'web/assets')
    args = parser.parse_args()
    print(json.dumps(optimize(args.assets),ensure_ascii=False))
