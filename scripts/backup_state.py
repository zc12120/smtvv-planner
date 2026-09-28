#!/usr/bin/env python3
"""Snapshot both state volumes and their matching private configuration."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tarfile
import tempfile

ROOT = Path(__file__).resolve().parents[1]


def backup(compose_file, runtime, output):
    output = Path(output).resolve()
    runtime = Path(runtime).resolve()
    if output.exists():
        raise ValueError('Backup destination already exists')
    output.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    compose = ['docker', 'compose', '-f', str(Path(compose_file).resolve())]
    containers = {}
    for service in ('app', 'authelia'):
        item = subprocess.run(compose + ['ps', '--all', '-q', service], capture_output=True, text=True, check=True).stdout.strip()
        if not re.fullmatch(r'[a-f0-9]{12,64}', item):
            raise ValueError('Expected exactly one ' + service + ' container')
        containers[service] = item
    files = [runtime / relative for relative in ('authelia/configuration.yml', 'authelia/users_database.yml',
             'secrets/session', 'secrets/storage', 'secrets/reset', 'deployment.json', 'nginx.conf', 'openresty-locations.conf')]
    if any(not p.is_file() or p.is_symlink() for p in files):
        raise ValueError('Private deployment configuration is incomplete or contains symlinks')
    bootstrap = runtime / 'login-bootstrap.json'
    if bootstrap.is_file() and not bootstrap.is_symlink():
        files.append(bootstrap)
    paused = []
    temporary_archive = None
    try:
        for item in containers.values():
            state = json.loads(subprocess.run(['docker', 'inspect', item, '--format', '{{json .State}}'],
                               capture_output=True, text=True, check=True).stdout)
            if state['Running'] and not state['Paused']:
                subprocess.run(['docker', 'pause', item], capture_output=True, check=True)
                paused.append(item)
        with tempfile.TemporaryDirectory(prefix='smtvv-backup-') as raw:
            staging = Path(raw)
            for service, item in containers.items():
                target = staging / (service + '-state.tar')
                with target.open('xb') as handle:
                    os.fchmod(handle.fileno(), 0o600)
                    subprocess.run(['docker', 'cp', item + ':/state/.', '-'], stdout=handle, stderr=subprocess.PIPE, check=True)
            for item in paused[:]:
                subprocess.run(['docker', 'unpause', item], capture_output=True, check=True)
                paused.remove(item)
            with tempfile.NamedTemporaryFile(dir=output.parent, prefix='.smtvv-backup-', delete=False) as handle:
                temporary_archive = Path(handle.name)
                os.fchmod(handle.fileno(), 0o600)
            with tarfile.open(temporary_archive, 'w:gz') as archive:
                for name in ('app-state.tar', 'authelia-state.tar'):
                    archive.add(staging / name, arcname=name)
                for filename in files:
                    archive.add(filename, arcname='runtime/' + str(filename.relative_to(runtime)), recursive=False)
                for name in ('.env', 'compose.yaml', 'compose.assets.yaml', 'compose.override.yaml'):
                    filename = Path(compose_file).resolve().parent / name
                    if filename.is_file() and not filename.is_symlink():
                        archive.add(filename, arcname=name, recursive=False)
            os.link(temporary_archive, output)
            return {'backup': str(output), 'bytes': output.stat().st_size,
                    'sha256': hashlib.sha256(output.read_bytes()).hexdigest(),
                    'includes': ['live accounts', 'site settings and audit', 'Authelia storage', 'matching encryption keys', 'gateway configuration']}
    finally:
        for item in paused:
            subprocess.run(['docker', 'unpause', item], capture_output=True, check=True)
        if temporary_archive:
            temporary_archive.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output', type=Path)
    parser.add_argument('--compose-file', type=Path, default=ROOT / 'compose.yaml')
    parser.add_argument('--runtime-dir', type=Path, default=ROOT / 'runtime')
    args = parser.parse_args()
    try:
        print(json.dumps(backup(args.compose_file, args.runtime_dir, args.output)))
    except (OSError, ValueError, subprocess.CalledProcessError):
        parser.exit(1, 'Backup failed. Check Docker and private file permissions; existing backups were not overwritten.\n')


if __name__ == '__main__':
    main()
