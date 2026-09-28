"""Package only application runtime files; exclude local audits and credentials."""
import argparse
import hashlib
import io
import json
from pathlib import Path
import tarfile


def build(destination):
    root = Path(__file__).resolve().parents[1]
    files = list(root.glob('*.py'))
    for directory in ('web', 'data', 'native'):
        files.extend(path for path in (root / directory).rglob('*') if path.is_file())
    files = sorted(path for path in files if '__pycache__' not in path.parts)
    manifest = {}
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tarfile.open(destination, 'w:gz', compresslevel=6) as archive:
        for path in files:
            if path.is_symlink():
                raise ValueError('Runtime symlinks are not allowed: ' + str(path.relative_to(root)))
            name = path.relative_to(root).as_posix()
            content = path.read_bytes()
            manifest[name] = hashlib.sha256(content).hexdigest()
            info = tarfile.TarInfo(name)
            info.size = len(content)
            info.mtime = int(path.stat().st_mtime)
            info.mode = 0o755 if name == 'native/optimal-linux' else 0o644
            archive.addfile(info, io.BytesIO(content))
        content = (json.dumps(manifest, indent=2, ensure_ascii=False) + '\n').encode()
        info = tarfile.TarInfo('release-manifest.json')
        info.size = len(content)
        info.mode = 0o644
        archive.addfile(info, io.BytesIO(content))
    print(json.dumps({'archive': str(destination), 'files': len(manifest),
                      'bytes': destination.stat().st_size,
                      'sha256': hashlib.sha256(destination.read_bytes()).hexdigest()}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('destination', type=Path)
    build(parser.parse_args().destination)
