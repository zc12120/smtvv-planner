#!/usr/bin/env python3
"""Manage the live account database. Passwords only go to a private file."""
import argparse
import json
import os
from pathlib import Path
import re
import shlex
import subprocess
import sys
import tempfile
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from scripts.configure import new_password


def apply_update(filename, payload):
    from accounts import Accounts
    from management import ManagementError
    if not Path(filename).is_file():
        raise ManagementError('Live account database does not exist; start the application first')
    accounts = Accounts(filename)
    accounts.administer(payload['username'], digest=payload.get('digest'), delete=payload['delete'],
                        group=os.environ.get('SMTVV_ADMIN_GROUP', 'admins'), email=payload.get('email', ''))


def prepare_credentials(runtime, origin, username, password):
    with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=runtime, prefix='.credentials-', delete=False) as handle:
        filename = Path(handle.name)
        try:
            os.fchmod(handle.fileno(), 0o600)
            handle.write(f'URL: {origin}/auth/\nUsername: {username}\nPassword: {password}\n')
            handle.flush()
            os.fsync(handle.fileno())
        except Exception:
            filename.unlink(missing_ok=True)
            raise
    return filename


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--username')
    parser.add_argument('--delete', action='store_true')
    parser.add_argument('--runtime-dir', type=Path, default=ROOT / 'runtime')
    parser.add_argument('--accounts-file', type=Path, help='Explicit live database for a non-Compose deployment')
    parser.add_argument('--compose-file', type=Path, default=ROOT / 'compose.yaml')
    parser.add_argument('--docker-command', default='docker')
    parser.add_argument('--apply-json', action='store_true', help=argparse.SUPPRESS)
    args = parser.parse_args()
    credential_temp = None
    updated = False
    try:
        if args.apply_json:
            filename = os.environ.get('SMTVV_USERS_FILE')
            if not filename:
                raise ValueError('SMTVV_USERS_FILE must point to the live database')
            apply_update(filename, json.load(sys.stdin))
            print('Account database updated.')
            return
        if not args.username or not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9_-]{2,63}', args.username):
            raise ValueError('Username must contain 3–64 letters, digits, underscores or hyphens')
        origin = json.loads((args.runtime_dir / 'deployment.json').read_text())['public_url']
        payload = {'username': args.username, 'delete': args.delete,
                   'email': args.username + '@' + urlsplit(origin).hostname}
        password = None
        if not args.delete:
            password, payload['digest'] = new_password(args.docker_command)
            credential_temp = prepare_credentials(args.runtime_dir, origin, args.username, password)
        if args.accounts_file:
            apply_update(args.accounts_file, payload)
        else:
            command = shlex.split(args.docker_command) + ['compose', '-f', str(args.compose_file),
                      'exec', '-T', 'app', 'python', '/app/scripts/manage_user.py', '--apply-json']
            result = subprocess.run(command, input=json.dumps(payload), capture_output=True, text=True)
            if result.returncode:
                raise RuntimeError('Live account update failed. Check that Compose app is running; '
                                   'for systemd use --accounts-file with the live database path. '
                                   'Deleting the last administrator is not allowed.')
        updated = True
        if credential_temp is not None:
            filename = args.runtime_dir / 'credentials.txt'
            try:
                os.replace(credential_temp, filename)
            except OSError:
                parser.exit(1, 'Account updated. New credentials are preserved in the private file: ' + str(credential_temp) + '\n')
            credential_temp = None
            print('New login details: ' + str(filename))
        print('Live account updated. The authentication supervisor will revoke existing sessions.')
    except Exception as error:
        from management import ManagementError
        if isinstance(error, (ManagementError, RuntimeError, ValueError)):
            parser.exit(1, str(error) + '\n')
        parser.exit(1, 'Account update failed. Check the live database and private runtime directory.\n')
    finally:
        if credential_temp is not None and not updated:
            credential_temp.unlink(missing_ok=True)


if __name__ == '__main__':
    main()
