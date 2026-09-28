"""Persistent site controls and Authelia-backed administrator authorization."""
from copy import deepcopy
from dataclasses import dataclass
from datetime import datetime, timezone
import http.client
import json
import os
from pathlib import Path
import posixpath
import tempfile
import threading
import time
from urllib.parse import quote, unquote, urlsplit


class ManagementError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


def normalized_path(uri):
    # Use the path as sent, including a leading //; urlsplit would otherwise
    # interpret it as a network location. Match nginx's normalized routing.
    try:
        raw = unquote(uri.split('?', 1)[0], errors='strict')
    except UnicodeError:
        raise ManagementError('请求路径不合法。') from None
    # Linux nginx does not treat a backslash as a path separator. Converting
    # it here would dispatch requests that missed the gateway's rate limits.
    if not raw.startswith('/') or any(c in raw for c in ('\\', '\x00', '\r', '\n')):
        raise ManagementError('请求路径不合法。')
    path = posixpath.normpath('/' + raw.lstrip('/'))
    # Preserve nginx's final slash, including trailing "/." and "/..".
    # Dropping it makes /api/optimal/start/ bypass an exact rate limit.
    if path != '/' and raw.endswith(('/', '/.', '/..')):
        path += '/'
    return path


def admin_path(uri):
    path = normalized_path(uri)
    return path in ('/admin', '/api/admin') or path.startswith(('/admin/', '/api/admin/'))


@dataclass(frozen=True)
class Access:
    status: int
    username: str = ''
    groups: tuple = ()
    location: str = ''


class Authelia:
    def __init__(self, origin, endpoint, admin_group='admins'):
        self.origin = origin.rstrip('/')
        self.endpoint = urlsplit(endpoint)
        self.admin_group = admin_group
        if self.endpoint.scheme not in ('http', 'https') or not self.endpoint.hostname or self.endpoint.username:
            raise ValueError('Invalid internal Authelia verification endpoint')

    def verify(self, cookie, uri, method='GET', require_admin=False, timeout=4):
        normalized_path(uri)
        if len(uri) > 8192 or method not in ('GET', 'HEAD', 'POST', 'OPTIONS', 'PUT', 'PATCH', 'DELETE'):
            return Access(403)
        location = self.origin + '/auth/?rd=' + quote(self.origin + uri, safe='') + '&rm=' + method
        if not cookie or len(cookie) > 16384:
            return Access(401, location=location)
        cls = http.client.HTTPSConnection if self.endpoint.scheme == 'https' else http.client.HTTPConnection
        connection = cls(self.endpoint.hostname, self.endpoint.port, timeout=timeout)
        try:
            endpoint = self.endpoint.path + ('?' + self.endpoint.query if self.endpoint.query else '')
            connection.request('GET', endpoint, headers={
                'Cookie': cookie,
                'Host': urlsplit(self.origin).netloc,
                'X-Original-URL': self.origin + uri,
                'X-Original-Method': method,
                'X-Forwarded-Proto': 'https',
                'X-Forwarded-Host': urlsplit(self.origin).netloc,
                'X-Forwarded-URI': uri,
                'X-Forwarded-Method': method,
            })
            response = connection.getresponse()
            username = response.getheader('Remote-User', '')
            groups = tuple(x.strip() for x in response.getheader('Remote-Groups', '').split(',') if x.strip())
            response.read(65536)
            if response.status in (200, 204) and username:
                if require_admin and self.admin_group not in groups:
                    return Access(403, username, groups)
                return Access(204, username, groups)
            if response.status in (401, 403):
                return Access(response.status, location=location if response.status == 401 else '')
            return Access(503)
        except (OSError, http.client.HTTPException, ValueError):
            # Never fall back to anonymous access when authentication is unavailable.
            return Access(503)
        finally:
            connection.close()


DEFAULT_SETTINGS = {
    'requireLogin': True,
    'maintenance': False,
    'notice': {'enabled': False, 'title': '', 'body': ''},
}


class SiteStore:
    def __init__(self, filename):
        self.filename = Path(filename)
        self.lock = threading.RLock()
        self._state = None

    @staticmethod
    def validate(settings):
        if not isinstance(settings, dict) or set(settings) != set(DEFAULT_SETTINGS):
            raise ManagementError('站点设置字段不合法。')
        if any(type(settings[name]) is not bool for name in ('requireLogin', 'maintenance')):
            raise ManagementError('访问和维护开关必须是布尔值。')
        notice = settings['notice']
        if not isinstance(notice, dict) or set(notice) != {'enabled', 'title', 'body'} or type(notice['enabled']) is not bool:
            raise ManagementError('公告设置不合法。')
        for field, limit in (('title', 80), ('body', 1000)):
            text = notice[field]
            if not isinstance(text, str) or len(text) > limit or any(ord(c) < 32 and c not in '\n\t' for c in text):
                raise ManagementError(f'公告内容格式不正确，标题最多 80 字、正文最多 1000 字。')
        if notice['enabled'] and not (notice['title'].strip() or notice['body'].strip()):
            raise ManagementError('请填写公告后再启用。')

    def _load(self):
        if self._state is not None:
            return
        if self.filename.exists():
            try:
                state = json.loads(self.filename.read_text(encoding='utf-8'))
                self.validate(state['settings'])
                if state.get('schema') != 1 or type(state.get('revision')) is not int or state['revision'] < 0 or not isinstance(state.get('history'), list):
                    raise ValueError('Invalid state envelope')
            except (OSError, ValueError, KeyError, TypeError, ManagementError) as error:
                raise ManagementError('站点设置无法读取，访问已保持关闭，请联系管理员。', 503) from error
            self._state = state
        else:
            state = {'schema': 1, 'revision': 0, 'settings': deepcopy(DEFAULT_SETTINGS), 'history': []}
            self._persist(state)
            self._state = state

    def _persist(self, state):
        temporary = None
        try:
            self.filename.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=self.filename.parent,
                                             prefix='.site-', suffix='.tmp', delete=False) as handle:
                temporary = Path(handle.name)
                os.chmod(temporary, 0o600)
                json.dump(state, handle, ensure_ascii=False, indent=2)
                handle.write('\n')
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary, self.filename)
            if hasattr(os, 'O_DIRECTORY'):
                descriptor = os.open(self.filename.parent, os.O_DIRECTORY)
                try: os.fsync(descriptor)
                finally: os.close(descriptor)
        except OSError as error:
            raise ManagementError('设置未能保存，请稍后重试。', 503) from error
        finally:
            if temporary and temporary.exists():
                temporary.unlink(missing_ok=True)

    def snapshot(self, history=False):
        with self.lock:
            self._load()
            result = {'revision': self._state['revision'], 'settings': deepcopy(self._state['settings'])}
            if history:
                result['history'] = deepcopy(self._state['history'][-100:][::-1])
            return result

    def requires_login(self):
        with self.lock:
            self._load()
            return self._state['settings']['requireLogin']

    def paused(self):
        with self.lock:
            self._load()
            return self._state['settings']['maintenance']

    @staticmethod
    def _event(state, actor, action, detail):
        state['history'].append({'at': datetime.now(timezone.utc).isoformat(timespec='seconds'),
                                 'actor': actor, 'action': action, 'detail': detail})
        state['history'] = state['history'][-200:]

    def update(self, patch, revision, actor):
        if type(revision) is not int or not isinstance(patch, dict) or not patch or set(patch) - set(DEFAULT_SETTINGS):
            raise ManagementError('设置请求格式不合法。')
        with self.lock:
            self._load()
            if revision != self._state['revision']:
                raise ManagementError('设置已在其他页面更新，请刷新后核对再保存。', 409)
            new = deepcopy(self._state)
            new['settings'].update(patch)
            self.validate(new['settings'])
            changed = [key for key in patch if new['settings'][key] != self._state['settings'][key]]
            if changed:
                new['revision'] += 1
                detail = {}
                for key in changed:
                    detail[key] = new['settings'][key] if key != 'notice' else {'enabled': new['settings']['notice']['enabled']}
                self._event(new, actor, 'settings', detail)
                self._persist(new)
                self._state = new
            return self.snapshot(history=True)

    def record(self, actor, action, detail):
        with self.lock:
            self._load()
            new = deepcopy(self._state)
            self._event(new, actor, action, detail)
            self._persist(new)
            self._state = new


def jobs_snapshot():
    from compute_queue import COORDINATOR
    if COORDINATOR:return COORDINATOR.overview()
    import optimal
    from planner import label
    with optimal.LOCK:
        jobs = list(optimal.JOBS.items())
    result = []
    counts = {name: 0 for name in ('running', 'queued', 'completed', 'cancelled', 'failed')}
    for job_id, job in reversed(jobs):
        if job.cancelled.is_set():
            status = 'cancelled'
        elif job.finished:
            status = 'completed' if job.complete else 'failed'
        else:
            status = 'queued' if job.stage == '排队等待计算' else 'running'
        counts[status] += 1
        result.append({'id': job_id, 'target': job.target, 'label': label(job.target), 'status': status,
                       'stage': job.stage, 'seconds': max(0, round((getattr(job,'ended',None) or time.monotonic()) - job.started)),
                       'solutions': len(job.solutions), 'canCancel': status in ('running', 'queued')})
    return {'items': result, 'counts': counts, 'capacity': optimal.MAX_ACTIVE_JOBS}


def cancel_job(job_id, store, actor):
    from compute_queue import COORDINATOR
    import optimal
    if not isinstance(job_id, str) or not 1 <= len(job_id) <= 80:
        raise ManagementError('任务编号不合法。')
    if COORDINATOR:
        try:job=COORDINATOR.snapshot({'jobId':job_id})
        except ValueError:raise ManagementError('任务不存在或已过期。',404) from None
        if job['finished']:return {'cancelled':False,'message':'任务已结束，无需取消。'}
        store.record(actor,'cancel',{'jobId':job_id,'target':job.get('target','')})
        return COORDINATOR.cancel({'jobId':job_id})
    with optimal.LOCK:
        job = optimal.JOBS.get(job_id)
        if job is None:
            raise ManagementError('任务不存在或已过期。', 404)
        if job.finished or job.cancelled.is_set():
            return {'cancelled': False, 'message': '任务已结束，无需取消。'}
        store.record(actor, 'cancel', {'jobId': job_id, 'target': job.target})
        job.cancel()
    return {'cancelled': True}
