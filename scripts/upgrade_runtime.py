#!/usr/bin/env python3
"""Upgrade generated gateway/account paths without changing users or encryption keys."""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from scripts.configure import gateway_configuration, nginx_locations, public_origin, session_cookie_name, login_bootstrap


def replace(path, text, mode):
    with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=path.parent, delete=False) as handle:
        temporary = Path(handle.name)
        try:
            os.fchmod(handle.fileno(), mode)
            handle.write(text)
            handle.flush()
            os.fsync(handle.fileno())
            os.replace(temporary, path)
        finally:
            temporary.unlink(missing_ok=True)


def upgrade(directory):
    directory = Path(directory).resolve()
    origin = public_origin(json.loads((directory / 'deployment.json').read_text())['public_url'])
    config_file = directory / 'authelia/configuration.yml'
    config = json.loads(config_file.read_text())
    user_file = directory / 'authelia/users_database.yml'
    users = json.loads(user_file.read_text())
    if not isinstance(users.get('users'), dict) or not users['users']:
        raise ValueError('Existing account database is invalid')
    current = config['authentication_backend']['file']['path']
    if current not in ('/config/users_database.yml', '/planner-state/accounts/users_database.yml'):
        raise ValueError('Custom account path found; migrate that live database explicitly')
    for name in ('session', 'storage', 'reset'):
        if not (directory / 'secrets' / name).is_file():
            raise ValueError('Existing deployment secrets are incomplete')
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    backup = directory / 'upgrade-backups' / stamp
    backup.mkdir(mode=0o700, parents=True)
    for relative in ('authelia/configuration.yml', 'nginx.conf', 'openresty-locations.conf', 'login-bootstrap.json'):
        source = directory / relative
        if source.is_file():
            target = backup / relative
            target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
            shutil.copy2(source, target)
    config['authentication_backend']['file']['path'] = '/planner-state/accounts/users_database.yml'
    session = config['session']
    renamed = False
    remember_me_migrated = False
    # Only migrate our legacy default. Keep operator-defined names and settings.
    for item in (session, *session.get('cookies', [])):
        if item.get('name') == 'smtvv_session':
            item['name'] = session_cookie_name(origin)
            renamed = True
        # Our old disable value is parsed as a positive one-second lifetime.
        if item.get('remember_me') == '-1s':
            item['remember_me'] = -1
            remember_me_migrated = True
    replace(config_file, json.dumps(config, ensure_ascii=False, indent=2) + '\n', 0o600)
    replace(directory / 'login-bootstrap.json', json.dumps(login_bootstrap(config), indent=2) + '\n', 0o644)
    replace(directory / 'nginx.conf', gateway_configuration(origin), 0o644)
    replace(directory / 'openresty-locations.conf', nginx_locations(origin, '127.0.0.1:8765', '127.0.0.1:9091', '/www/sites/smtvv/index'), 0o644)
    os.chmod(user_file, 0o644)
    return {'upgraded': True, 'configuration_backup': str(backup), 'accounts_preserved': True,
            'secrets_preserved': True, 'session_cookie_migrated': renamed,
            'remember_me_migrated': remember_me_migrated}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--runtime-dir', type=Path, default=ROOT / 'runtime')
    args = parser.parse_args()
    try:
        print(json.dumps(upgrade(args.runtime_dir)))
    except (OSError, ValueError, KeyError, TypeError):
        parser.exit(1, 'Runtime migration failed. Check existing configuration; no new accounts or keys were generated.\n')


if __name__ == '__main__':
    main()
