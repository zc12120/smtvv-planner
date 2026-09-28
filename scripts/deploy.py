#!/usr/bin/env python3
"""Initialize and start a standalone HTTPS site, or use an existing TLS proxy."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scripts.configure import ROOT, configure, public_origin, write_file


def prepare(origin):
    """Never overwrite an existing deployment's accounts, keys or origin."""
    runtime = ROOT / 'runtime'
    env_file = ROOT / '.env'
    if env_file.exists():
        settings = {}
        for line in env_file.read_text().splitlines():
            key, separator, value = line.partition('=')
            if separator:
                settings[key.strip()] = value.strip().strip('\"\'')
        if settings.get('SMTVV_PUBLIC_URL') != origin:
            raise ValueError('Existing .env uses a different or missing public URL; no configuration was changed.')
    if runtime.exists() and any(runtime.iterdir()):
        required = ['deployment.json', 'authelia/configuration.yml',
                    'authelia/users_database.yml', 'secrets/session',
                    'secrets/storage', 'secrets/reset', 'nginx.conf',
                    'login-bootstrap.json']
        if not all((runtime / name).is_file() for name in required):
            raise ValueError('Existing runtime is incomplete. Restore its matching backup; initialization was refused.')
        existing = json.loads((runtime / 'deployment.json').read_text())
        if existing.get('public_url') != origin:
            raise ValueError('Existing runtime uses a different public URL; no configuration was changed.')
    else:
        configure(origin, runtime)
    if not env_file.exists():
        write_file(env_file, 'SMTVV_BIND=127.0.0.1\nSMTVV_PORT=8088\nSMTVV_PUBLIC_URL=' + origin + '\n')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('public_url', help='Your HTTPS origin, e.g. https://planner.example.com')
    parser.add_argument('--behind-proxy', action='store_true',
                        help='Use an existing HTTPS proxy to 127.0.0.1:8088; do not start Caddy')
    args = parser.parse_args()
    try:
        origin = public_origin(args.public_url)
        subprocess.run(['docker', 'info'], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        subprocess.run(['docker', 'compose', 'version'], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        prepare(origin)
        command = ['docker', 'compose', '-f', 'compose.yaml']
        if not args.behind_proxy:
            command += ['-f', 'compose.https.yaml']
        environment = dict(os.environ, SMTVV_PUBLIC_URL=origin)
        subprocess.run(command + ['config', '--quiet'], cwd=ROOT, env=environment, check=True)
        subprocess.run(command + ['up', '-d', '--build', '--wait', '--wait-timeout', '180'],
                       cwd=ROOT, env=environment, check=True)
    except (OSError, ValueError, RuntimeError, subprocess.CalledProcessError) as error:
        # Never print Docker's captured output: it may contain configuration.
        parser.exit(1, f'Deployment failed: {error}\nAccounts and persistent volumes were not reset.\n')
    print(f'Services started. Website: {origin}/  Admin: {origin}/admin/')
    print('Login details: runtime/credentials.txt (local file; keep private).')
    if not args.behind_proxy:
        print('Public HTTPS is ready once DNS resolves here and automatic certificate issuance succeeds.')


if __name__ == '__main__':
    main()
