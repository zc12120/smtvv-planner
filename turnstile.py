"""Cloudflare Turnstile settings and one-use login admission tickets."""
from contextlib import contextmanager
from copy import deepcopy
from datetime import datetime, timezone
from http.cookies import SimpleCookie, CookieError
import base64
import fcntl
import hashlib
import hmac
import ipaddress
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import tempfile
import threading
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlsplit
from urllib.request import Request, urlopen

from persistence import publish_generation, locked_file
from management import ManagementError


SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'
TESTING_SECRET_KEY = '1x0000000000000000000000000000000AA'
COOKIE_NAME = 'smtvv_turnstile'
DEFAULT_SETTINGS = {
    'enabled': False,
    'siteKey': '',
    'theme': 'auto',
    'appearance': 'interaction-only',
}
SETTING_FIELDS = set(DEFAULT_SETTINGS)
KEY_RE = re.compile(r'[0-9]x[0-9A-Za-z_-]{10,200}')


def _key(value, label):
    if not isinstance(value, str):
        raise ManagementError(label + '格式不合法。')
    value = value.strip()
    if not KEY_RE.fullmatch(value):
        raise ManagementError(label + '格式不合法。')
    return value


class TurnstileConfig:
    def __init__(self, directory, origin, verify_url=SITEVERIFY_URL, testing=False):
        self.directory = Path(directory)
        self.origin = origin.rstrip('/')
        self.hostname = urlsplit(self.origin).hostname
        self.verify_url = verify_url
        self.testing = testing is True
        self.lock = threading.RLock()
        self.tickets = {}

    def file_lock(self):
        self.directory.mkdir(parents=True, exist_ok=True, mode=0o750)
        return locked_file(self.directory / '.lock')

    @staticmethod
    def validate(settings):
        if not isinstance(settings, dict) or set(settings) != SETTING_FIELDS:
            raise ManagementError('Turnstile 设置字段不合法。')
        if type(settings['enabled']) is not bool:
            raise ManagementError('Turnstile 开关必须是布尔值。')
        if not isinstance(settings['siteKey'], str) or len(settings['siteKey']) > 220:
            raise ManagementError('Turnstile Site Key 格式不合法。')
        if settings['siteKey']:
            settings['siteKey'] = _key(settings['siteKey'], 'Turnstile Site Key')
        if settings['theme'] not in ('auto', 'light', 'dark'):
            raise ManagementError('Turnstile 外观主题不合法。')
        if settings['appearance'] not in ('interaction-only', 'always'):
            raise ManagementError('Turnstile 显示方式不合法。')

    def _current(self):
        try:
            current = (self.directory / 'current').resolve(strict=True)
            if current.parent != self.directory.resolve() or not current.name.startswith('v-'):
                raise ValueError('Invalid Turnstile generation')
            state = json.loads((current / 'settings.json').read_text(encoding='utf-8'))
            self.validate(state['settings'])
            if (state.get('schema') != 1 or type(state.get('revision')) is not int
                    or state['revision'] < 0 or not isinstance(state.get('history'), list)):
                raise ValueError('Invalid Turnstile state')
            secret_file = current / 'secret.json'
            secret = json.loads(secret_file.read_text(encoding='utf-8')) if secret_file.is_file() else None
            if secret is not None:
                secret = _key(secret, 'Turnstile Secret Key')
            if state['settings']['enabled'] and (not state['settings']['siteKey'] or not secret):
                raise ValueError('Enabled Turnstile configuration is incomplete')
            return state, secret
        except (OSError, ValueError, KeyError, TypeError, json.JSONDecodeError, ManagementError):
            raise ManagementError('Turnstile 设置无法读取，请联系管理员检查。', 503) from None

    def _commit(self, state, secret):
        files = {'settings.json': (state, 0o600)}
        if secret:
            files['secret.json'] = (secret, 0o600)
        try:
            publish_generation(self.directory, files)
        except OSError:
            raise ManagementError('Turnstile 设置保存未完成，请刷新后核对。', 503) from None

    def initialize(self):
        with self.lock, self.file_lock():
            if not os.path.lexists(self.directory / 'current'):
                self._commit({'schema': 1, 'revision': 0,
                              'settings': deepcopy(DEFAULT_SETTINGS), 'history': []}, None)
            self._current()

    def snapshot(self, history=False):
        with self.lock:
            state, secret = self._current()
            result = {'revision': state['revision'], 'settings': deepcopy(state['settings']),
                      'secretConfigured': bool(secret)}
            if history:
                result['history'] = deepcopy(state['history'][-100:][::-1])
            return result

    def public_snapshot(self):
        with self.lock:
            state, secret = self._current()
            settings = state['settings']
            if not settings['enabled'] or not secret:
                return {'enabled': False}
            return deepcopy(settings)

    @staticmethod
    def client_ip(value):
        try:
            return str(ipaddress.ip_address(value))
        except ValueError:
            return None

    def verify(self, token, secret, action, remote_ip=None, invalid_status=403):
        if not isinstance(token, str) or not 1 <= len(token) <= 4096:
            raise ManagementError('请完成人机验证后重试。', invalid_status)
        data = {'secret': secret, 'response': token}
        address = self.client_ip(remote_ip)
        if address:
            data['remoteip'] = address
        request = Request(self.verify_url, data=urlencode(data).encode('ascii'), method='POST',
                          headers={'Content-Type': 'application/x-www-form-urlencoded',
                                   'Accept': 'application/json'})
        try:
            with urlopen(request, timeout=6) as response:
                raw = response.read(16385)
            if len(raw) > 16384:
                raise ValueError('Oversized Siteverify response')
            result = json.loads(raw)
            if not isinstance(result, dict):
                raise ValueError('Invalid Siteverify response')
        except (HTTPError, URLError, OSError, TimeoutError, ValueError, json.JSONDecodeError):
            raise ManagementError('人机验证服务暂时不可用，请稍后重试。', 503) from None
        testing_result = (self.testing and secret == TESTING_SECRET_KEY
                          and result.get('metadata', {}).get('result_with_testing_key') is True)
        if (result.get('success') is not True or (not testing_result and (
                result.get('hostname') != self.hostname or result.get('action') != action))):
            raise ManagementError('人机验证未通过，请重新验证。', invalid_status)

    def update(self, patch, revision, actor, *, secret_key=None, clear_secret=False,
               verification_token=None, remote_ip=None):
        if (type(revision) is not int or not isinstance(patch, dict)
                or set(patch) - SETTING_FIELDS or type(clear_secret) is not bool):
            raise ManagementError('Turnstile 设置请求格式不合法。')
        if secret_key is not None and clear_secret:
            raise ManagementError('不能同时更新和清除 Secret Key。')
        with self.lock, self.file_lock():
            previous, previous_secret = self._current()
            if previous['revision'] != revision:
                raise ManagementError('Turnstile 设置已在其他页面更新，请刷新后核对再保存。', 409)
            state = deepcopy(previous)
            state['settings'].update(patch)
            self.validate(state['settings'])
            candidate_secret = None if clear_secret else previous_secret
            if secret_key is not None:
                candidate_secret = _key(secret_key, 'Turnstile Secret Key')
            if state['settings']['enabled'] and (not state['settings']['siteKey'] or not candidate_secret):
                raise ManagementError('启用 Turnstile 前请配置 Site Key 和 Secret Key。')
            protected_changed = (state['settings']['enabled'] and (
                not previous['settings']['enabled']
                or state['settings']['siteKey'] != previous['settings']['siteKey']
                or candidate_secret != previous_secret))
        if protected_changed:
            self.verify(verification_token, candidate_secret, 'turnstile_settings', remote_ip, 400)
        with self.lock, self.file_lock():
            current, current_secret = self._current()
            if current['revision'] != revision or current_secret != previous_secret:
                raise ManagementError('Turnstile 设置已更新，请刷新后重新验证。', 409)
            changes = {key: value for key, value in state['settings'].items()
                       if value != previous['settings'][key]}
            secret_changed = candidate_secret != previous_secret
            if changes or secret_changed:
                state['revision'] += 1
                detail = deepcopy(changes)
                if secret_changed:
                    detail['secretChanged'] = bool(candidate_secret)
                state['history'].append({'at': datetime.now(timezone.utc).isoformat(timespec='seconds'),
                                         'actor': actor, 'action': 'turnstile', 'detail': detail})
                state['history'] = state['history'][-200:]
                self._commit(state, candidate_secret)
                self.tickets.clear()
            return self.snapshot(history=True)

    @staticmethod
    def _ticket_key(secret):
        return hashlib.sha256(b'smtvv-turnstile-ticket\0' + secret.encode('ascii')).digest()

    def challenge(self, token, remote_ip=None):
        with self.lock:
            state, secret = self._current()
            if not state['settings']['enabled']:
                return {'verified': True, 'required': False}, None
        self.verify(token, secret, 'login', remote_ip)
        with self.lock:
            current, current_secret = self._current()
            if current['revision'] != state['revision'] or current_secret != secret:
                raise ManagementError('验证设置已更新，请重新验证。', 409)
            now = int(time.time())
            address = self.client_ip(remote_ip)
            self.tickets = {nonce: issued for nonce, issued in self.tickets.items() if issued[0] >= now}
            if len(self.tickets) >= 1024:
                self.tickets.clear()
            nonce = secrets.token_urlsafe(24)
            expiry = now + 300
            self.tickets[nonce] = (expiry, address)
            payload = f'{expiry}.{nonce}'
            signature = base64.urlsafe_b64encode(hmac.digest(self._ticket_key(secret),
                                                           payload.encode('ascii'), 'sha256')).decode('ascii').rstrip('=')
            value = payload + '.' + signature
            cookie = (f'{COOKIE_NAME}={value}; Path=/auth/api/firstfactor; Max-Age=300; '
                      'HttpOnly; Secure; SameSite=Strict')
            return {'verified': True, 'required': True}, cookie

    def consume(self, cookie_header, remote_ip=None):
        with self.lock:
            state, secret = self._current()
            if not state['settings']['enabled']:
                return True
            try:
                cookie = SimpleCookie()
                cookie.load(cookie_header or '')
                value = cookie[COOKIE_NAME].value
                expiry_text, nonce, signature = value.split('.', 2)
                expiry = int(expiry_text)
            except (CookieError, KeyError, ValueError):
                return False
            payload = f'{expiry}.{nonce}'
            expected = base64.urlsafe_b64encode(hmac.digest(self._ticket_key(secret),
                                                          payload.encode('ascii'), 'sha256')).decode('ascii').rstrip('=')
            if not hmac.compare_digest(signature, expected) or expiry < int(time.time()):
                self.tickets.pop(nonce, None)
                return False
            issued = self.tickets.pop(nonce, None)
            return issued == (expiry, self.client_ip(remote_ip))
