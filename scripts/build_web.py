"""Build one shared page loader and content-version local page assets."""
import hashlib
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / 'web'


def versioned(url):
    path = WEB / url.lstrip('/').split('?')[0]
    return '/' + str(path.relative_to(WEB)) + '?v=' + hashlib.sha256(path.read_bytes()).hexdigest()[:12]


def build():
    assets = json.loads((ROOT / 'scripts/web_assets.json').read_text())
    manifest = {page: [versioned(url) for url in urls] for page, urls in assets.items()}
    template = (ROOT / 'scripts/templates/bootstrap.js').read_text()
    (WEB / 'bootstrap.js').write_text(template.replace('/* ASSET_MANIFEST */', json.dumps(manifest, separators=(',', ':'))))
    for name in [*assets, 'auth/index.html']:
        path = WEB / name
        page = path.read_text()
        def update(match):
            url = match[2]
            base = url.split('?')[0]
            if base.startswith(('https:', 'data:')):
                return match[0]
            file = WEB / base.lstrip('/') if base.startswith('/') else path.parent / base
            if not file.is_file():
                return match[0]
            return match[1] + versioned('/' + str(file.relative_to(WEB))) + match[3]
        page = re.sub(r'((?:src|href)=")([^"]+\.(?:js|css)(?:\?[^"]*)?)(")', update, page)
        path.write_text(page)


if __name__ == '__main__':
    build()
