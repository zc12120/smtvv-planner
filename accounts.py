"""Self-service password changes for the current Authelia administrator.

Only the account database is shared with the application. Authelia session and
storage secrets remain private to Authelia. Its supervisor restarts the auth
process after a database change to discard every existing in-memory session.
"""
from collections import deque
from contextlib import contextmanager
import fcntl
import json
import os
from pathlib import Path
import re
import tempfile
import threading
import time

from management import ManagementError


def replace_private(path, value, mode=0o600):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=path.parent,
                                         prefix='.accounts-', delete=False) as handle:
            temporary = Path(handle.name)
            os.fchmod(handle.fileno(), mode)
            if path.exists() and os.geteuid() == 0:
                previous = path.stat()
                os.fchown(handle.fileno(), previous.st_uid, previous.st_gid)
            json.dump(value, handle, ensure_ascii=False, indent=2)
            handle.write('\n')
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
        descriptor = os.open(path.parent, os.O_DIRECTORY)
        try: os.fsync(descriptor)
        finally: os.close(descriptor)
    finally:
        if temporary: temporary.unlink(missing_ok=True)


class Accounts:
    def __init__(self, filename, bootstrap=None):
        # Imported only for authenticated deployments; offline use stays stdlib.
        from argon2 import PasswordHasher, Type
        self.hasher = PasswordHasher(time_cost=3, memory_cost=65536, parallelism=1, type=Type.ID)
        self.filename = Path(filename)
        self.lock = threading.Lock()
        self.attempts = {}
        # Authelia joins the application's group and mounts this directory read-only.
        self.filename.parent.mkdir(parents=True, exist_ok=True, mode=0o750)
        os.chmod(self.filename.parent, 0o750)
        with self.file_lock():
            if not self.filename.exists():
                if not bootstrap:
                    raise RuntimeError('An existing Authelia account database is required')
                data = json.loads(Path(bootstrap).read_text(encoding='utf-8'))
                self.validate_database(data)
                self.write(data)
            self.read()
            os.chmod(self.filename, 0o640)

    @contextmanager
    def file_lock(self):
        fd = os.open(self.filename.with_suffix('.lock'), os.O_CREAT | os.O_RDWR, 0o600)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX)
            yield
        finally:
            fcntl.flock(fd, fcntl.LOCK_UN)
            os.close(fd)

    @staticmethod
    def validate_database(data):
        if not isinstance(data, dict) or not isinstance(data.get('users'), dict) or not data['users']:
            raise ValueError('Invalid account database')
        for account in data['users'].values():
            if not isinstance(account, dict) or not isinstance(account.get('password'), str):
                raise ValueError('Invalid account database')

    def read(self):
        data = json.loads(self.filename.read_text(encoding='utf-8'))
        self.validate_database(data)
        return data

    def write(self, data):
        self.validate_database(data)
        replace_private(self.filename, data, mode=0o640)

    def administer(self, username, digest=None, delete=False, group='admins', email=''):
        """Local operator command: update the same locked database as the website."""
        from argon2 import extract_parameters, Type
        if type(delete) is not bool:
            raise ManagementError('账号操作格式不合法。')
        if not isinstance(username, str) or not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9_-]{2,63}', username):
            raise ManagementError('账号名称格式不合法。')
        if not delete:
            try:
                if extract_parameters(digest).type is not Type.ID:
                    raise ValueError('Expected Argon2id')
            except (ValueError, TypeError, AttributeError):
                raise ManagementError('密码摘要格式不合法。') from None
        with self.lock, self.file_lock():
            data = self.read()
            users = data['users']
            if delete:
                if username not in users:
                    raise ManagementError('账号不存在。', 404)
                del users[username]
                if not any(group in account.get('groups', []) for account in users.values()):
                    raise ManagementError('不能删除最后一个管理员。')
            else:
                users[username] = {**users.get(username, {'displayname': username, 'groups': [group], 'email': email}), 'password': digest}
            self.write(data)

    def change(self, username, current, new, group='admins'):
        from argon2.exceptions import VerificationError, InvalidHashError
        if not isinstance(current, str) or not 1 <= len(current) <= 1024:
            raise ManagementError('请填写当前密码。')
        if (not isinstance(new, str) or not 12 <= len(new) <= 128 or not new.strip()
                or any(ord(c) < 32 or ord(c) == 127 for c in new)):
            raise ManagementError('新密码需为 12–128 个字符，不能包含控制字符。')
        if current == new:
            raise ManagementError('新密码不能与当前密码相同。')
        if not self.lock.acquire(blocking=False):
            raise ManagementError('密码修改正在处理中，请稍后再试。', 429)
        try:
            now = time.monotonic()
            # Attempts include successful checks. Bound memory by removing old users.
            self.attempts = {name: deque(t for t in attempts if now - t < 300)
                             for name, attempts in self.attempts.items() if attempts and now - attempts[-1] < 300}
            attempts = self.attempts.setdefault(username, deque())
            if len(attempts) >= 5:
                raise ManagementError('密码尝试过于频繁，请 5 分钟后重试。', 429)
            attempts.append(now)
            with self.file_lock():
                data = self.read()
                account = data['users'].get(username)
                if not account or group not in account.get('groups', []):
                    raise ManagementError('需要管理员权限。', 403)
                try:
                    self.hasher.verify(account['password'], current)
                except (VerificationError, InvalidHashError):
                    raise ManagementError('当前密码不正确。', 400) from None
                account['password'] = self.hasher.hash(new)
                self.write(data)
        except (OSError, ValueError):
            raise ManagementError('密码未能保存，请稍后重试。', 503) from None
        finally:
            self.lock.release()
