"""Administrator-managed Authelia session policy and login-page preferences."""
from contextlib import contextmanager
from copy import deepcopy
from datetime import datetime, timezone
import fcntl
import json
import os
from pathlib import Path
import re
import shutil
import tempfile
import threading
from urllib.parse import urlsplit

from accounts import replace_private
from management import ManagementError


DEFAULT_LOGIN_SETTINGS = {
    'sessionMinutes': 1440,
    'inactivityMinutes': 720,
    'rememberMinutes': 43200,
    'rememberMeEnabled': True,
    'rememberMeDefault': False,
    'rememberPasswordEnabled': True,
}
SESSION_FIELDS = {'sessionMinutes', 'inactivityMinutes', 'rememberMinutes', 'rememberMeEnabled'}


def duration_minutes(value):
    """Import existing generated durations without silently rounding them."""
    if type(value) is int:
        seconds = value
    elif isinstance(value, str):
        pieces = re.findall(r'(\d+)(s|m|h|d|w)', value)
        if not pieces or ''.join(number + unit for number, unit in pieces) != value:
            raise ValueError('Unsupported session duration')
        seconds = sum(int(number) * {'s': 1, 'm': 60, 'h': 3600, 'd': 86400, 'w': 604800}[unit]
                      for number, unit in pieces)
    else:
        raise ValueError('Invalid session duration')
    if seconds <= 0 or seconds % 60:
        raise ValueError('Session durations must use whole minutes')
    return seconds // 60


class LoginPolicy:
    def __init__(self, directory, origin, configuration=None):
        self.directory = Path(directory)
        self.origin = origin.rstrip('/')
        self.configuration = Path(configuration) if configuration else None
        self.lock = threading.RLock()

    @contextmanager
    def file_lock(self):
        self.directory.mkdir(parents=True, exist_ok=True, mode=0o750)
        descriptor = os.open(self.directory / '.lock', os.O_CREAT | os.O_RDWR, 0o600)
        try:
            fcntl.flock(descriptor, fcntl.LOCK_EX)
            yield
        finally:
            fcntl.flock(descriptor, fcntl.LOCK_UN)
            os.close(descriptor)

    def _base(self):
        if self.configuration:
            try:
                base = json.loads(self.configuration.read_text(encoding='utf-8'))['session']
                if not isinstance(base, dict) or not isinstance(base.get('cookies'), list):
                    raise ValueError('Invalid session configuration')
                return base
            except (OSError, ValueError, KeyError, TypeError):
                raise ManagementError('无法读取现有认证配置，登录设置尚未启用。', 503) from None
        return {'cookies': [{'domain': urlsplit(self.origin).hostname,
                             'authelia_url': self.origin + '/auth/',
                             'default_redirection_url': self.origin + '/'}]}

    def _cookie_index(self, base):
        matches = [i for i, cookie in enumerate(base['cookies'])
                   if cookie.get('authelia_url', '').rstrip('/') == self.origin + '/auth']
        if len(matches) != 1:
            raise ManagementError('无法唯一匹配本站的认证 Cookie 配置。', 503)
        return matches[0]

    @staticmethod
    def validate(settings):
        if not isinstance(settings, dict) or set(settings) != set(DEFAULT_LOGIN_SETTINGS):
            raise ManagementError('登录设置字段不合法。')
        for name in ('rememberMeEnabled', 'rememberMeDefault', 'rememberPasswordEnabled'):
            if type(settings[name]) is not bool:
                raise ManagementError('登录功能开关必须是布尔值。')
        for name, minimum, maximum in (('sessionMinutes', 5, 43200),
                                       ('inactivityMinutes', 1, 43200),
                                       ('rememberMinutes', 5, 525600)):
            if type(settings[name]) is not int or not minimum <= settings[name] <= maximum:
                raise ManagementError('登录期限需为整数分钟：普通登录 5 分钟至 30 天，记住登录最长 365 天。')
        if settings['inactivityMinutes'] > settings['sessionMinutes']:
            raise ManagementError('闲置超时不能长于普通登录有效期。')
        if settings['rememberMeEnabled'] and settings['rememberMinutes'] < settings['sessionMinutes']:
            raise ManagementError('记住登录的有效期不能短于普通登录有效期。')

    def _initial(self):
        settings = deepcopy(DEFAULT_LOGIN_SETTINGS)
        base = self._base()
        effective = {**base, **base['cookies'][self._cookie_index(base)]}
        try:
            for target, source in (('sessionMinutes', 'expiration'), ('inactivityMinutes', 'inactivity')):
                if source in effective:
                    settings[target] = duration_minutes(effective[source])
            if 'remember_me' in effective:
                remember = effective['remember_me']
                settings['rememberMeEnabled'] = remember not in (-1, '-1', '-1s')
                if settings['rememberMeEnabled']:
                    settings['rememberMinutes'] = duration_minutes(remember)
            self.validate(settings)
        except (ValueError, ManagementError):
            raise ManagementError('现有会话期限无法自动导入，请先核对认证配置；原配置未修改。', 503) from None
        return {'schema': 1, 'revision': 0, 'settings': settings, 'history': []}

    def _session(self, settings):
        base = self._base()
        cookies = deepcopy(base['cookies'])
        cookies[self._cookie_index(base)].update({
            'expiration': str(settings['sessionMinutes']) + 'm',
            'inactivity': str(settings['inactivityMinutes']) + 'm',
            # The numeric sentinel is essential: Authelia 4.39 treats '-1s'
            # as a positive one-second duration.
            'remember_me': str(settings['rememberMinutes']) + 'm' if settings['rememberMeEnabled'] else -1,
        })
        return {'session': {'cookies': cookies}}

    def _read(self):
        try:
            current = (self.directory / 'current').resolve(strict=True)
            if current.parent != self.directory.resolve() or not current.name.startswith('v-'):
                raise ValueError('Invalid policy generation')
            state = json.loads((current / 'policy.json').read_text(encoding='utf-8'))
            self.validate(state['settings'])
            if (state.get('schema') != 1 or type(state.get('revision')) is not int
                    or state['revision'] < 0 or not isinstance(state.get('history'), list)):
                raise ValueError('Invalid policy envelope')
            return state
        except (OSError, ValueError, KeyError, TypeError, ManagementError):
            raise ManagementError('登录设置无法读取，请联系管理员检查。', 503) from None

    def _commit(self, state):
        """Publish the UI policy and Authelia overlay as one atomic generation."""
        generation = None
        pointer = None
        published = False
        try:
            overlay = self._session(state['settings'])
            generation = Path(tempfile.mkdtemp(prefix='v-', dir=self.directory))
            os.chmod(generation, 0o750)
            replace_private(generation / 'policy.json', state)
            replace_private(generation / 'session.json', overlay, mode=0o640)
            pointer = self.directory / ('.next-' + generation.name)
            pointer.symlink_to(generation.name, target_is_directory=True)
            os.replace(pointer, self.directory / 'current')
            published = True
            descriptor = os.open(self.directory, os.O_DIRECTORY)
            try:
                os.fsync(descriptor)
            finally:
                os.close(descriptor)
        except OSError:
            raise ManagementError('登录设置保存未完成，请刷新后核对。', 503) from None
        finally:
            if pointer:
                pointer.unlink(missing_ok=True)
            if generation and not published:
                shutil.rmtree(generation, ignore_errors=True)

    def initialize(self):
        with self.lock, self.file_lock():
            if not os.path.lexists(self.directory / 'current'):
                self._commit(self._initial())
            self._read()

    def snapshot(self, history=False):
        with self.lock:
            state = self._read()
            result = {'revision': state['revision'], 'settings': state['settings']}
            if history:
                result['history'] = state['history'][-100:][::-1]
            return result

    def update(self, patch, revision, actor):
        if (type(revision) is not int or not isinstance(patch, dict) or not patch
                or set(patch) - set(DEFAULT_LOGIN_SETTINGS)):
            raise ManagementError('登录设置请求格式不合法。')
        with self.lock, self.file_lock():
            previous = self._read()
            if previous['revision'] != revision:
                raise ManagementError('登录设置已在其他页面更新，请刷新后核对再保存。', 409)
            state = deepcopy(previous)
            state['settings'].update(patch)
            self.validate(state['settings'])
            changes = {key: value for key, value in state['settings'].items()
                       if value != previous['settings'][key]}
            session_changed = self._session(state['settings']) != self._session(previous['settings'])
            if changes:
                state['revision'] += 1
                state['history'].append({'at': datetime.now(timezone.utc).isoformat(timespec='seconds'),
                                         'actor': actor, 'action': 'login-policy', 'detail': changes})
                state['history'] = state['history'][-200:]
                self._commit(state)
            return {**self.snapshot(history=True), 'sessionChanged': session_changed}
