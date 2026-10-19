"""Bounded RAM relay for analytics. Visitor history is stored on the remote node."""
from collections import OrderedDict
import hashlib
import hmac
import ipaddress
import json
from pathlib import Path
import re
import threading
import time
from urllib.parse import parse_qs, urlencode, urlsplit
import uuid

from management import ManagementError

KINDS = {'page', 'leave', 'calculation'}
PHASES = {'submitting', 'completed', 'failed', 'cancelled'}
IDENTIFIER = re.compile(r'^[a-zA-Z0-9-]{16,64}$')


def text(value, limit=200):
    return ''.join(c for c in str(value or '') if c >= ' ' and c != '\x7f')[:limit]


def page_path(value):
    parts = urlsplit(text(value, 1024))
    if parts.scheme or parts.netloc or parts.path not in ('/', '/index.html', '/demon.html', '/skill.html', '/essence.html'):
        raise ManagementError('访问页面不合法。')
    args = parse_qs(parts.query)
    if parts.path in ('/', '/index.html'):
        tab = args.get('tab', ['planner'])[0]
        if tab not in ('planner', 'demons', 'skills', 'essences'):
            tab = 'planner'
        return '/?tab=' + tab
    name = text(args.get('name', [''])[0], 100)
    return parts.path + ('?' + urlencode({'name': name}) if name else '')


def normalize_event(body, ip, user_agent, salt, now):
    if not isinstance(body, dict) or set(body) - {'id', 'visit', 'visitor', 'session', 'kind', 'path', 'referrer', 'duration', 'phase', 'target', 'viewport'}:
        raise ManagementError('访问记录格式不合法。')
    for key in ('id', 'visit', 'visitor', 'session'):
        if not isinstance(body.get(key), str) or not IDENTIFIER.fullmatch(body[key]):
            raise ManagementError('访问标识不合法。')
    kind = body.get('kind')
    if kind not in KINDS or kind == 'calculation' and body.get('phase') not in PHASES:
        raise ManagementError('访问类型不合法。')
    try:
        address = str(ipaddress.ip_address(ip))
    except ValueError:
        raise ManagementError('访问地址不合法。') from None
    duration = body.get('duration', 0)
    if type(duration) not in (int, float) or not 0 <= duration <= 86400:
        raise ManagementError('访问时长不合法。')
    referrer = urlsplit(text(body.get('referrer'), 1024))
    return {'id': body['id'], 'visit': body['visit'], 'visitor': hashlib.sha256((salt + body['visitor']).encode()).hexdigest()[:24],
            'session': hashlib.sha256((salt + body['session']).encode()).hexdigest()[:24], 'kind': kind,
            'at': int(now), 'ip': address, 'path': page_path(body.get('path')), 'duration': round(duration),
            'referrer': text(referrer.hostname, 160), 'ua': text(user_agent, 384),
            'viewport': text(body.get('viewport'), 24), 'phase': text(body.get('phase'), 20) if kind == 'calculation' else '',
            'target': text(body.get('target'), 100) if kind == 'calculation' else ''}


class AnalyticsRelay:
    def __init__(self, config, *, clock=time.time, capacity=5000):
        self.token_hash = config['tokenSha256']
        if not re.fullmatch(r'[a-f0-9]{64}', self.token_hash):
            raise ValueError('Invalid analytics node credential')
        self.salt = config.get('salt', self.token_hash)
        self.clock, self.capacity = clock, capacity
        self.events = OrderedDict()
        self.queries = OrderedDict()
        self.rates = OrderedDict()
        self.changed = threading.Condition(threading.RLock())
        self.last_seen = 0
        self.node_stats = {}
        self.dropped = 0

    def authenticate(self, authorization):
        digest = hashlib.sha256(authorization.removeprefix('Bearer ').encode()).hexdigest()
        if not authorization.startswith('Bearer ') or not hmac.compare_digest(digest, self.token_hash):
            raise ManagementError('统计节点认证失败。', 401)

    def collect(self, body, ip, ua):
        now = self.clock()
        event = normalize_event(body, ip, ua, self.salt, now)
        with self.changed:
            bucket, count = self.rates.pop(ip, (int(now // 60), 0))
            if bucket != int(now // 60):
                bucket, count = int(now // 60), 0
            self.rates[ip] = (bucket, count + 1)
            while len(self.rates) > 4096:
                self.rates.popitem(last=False)
            if count >= 120:
                raise ManagementError('访问记录提交过于频繁。', 429)
            if len(self.events) >= self.capacity and event['id'] not in self.events:
                self.dropped += 1
                return False
            self.events[event['id']] = event
            self.changed.notify_all()
            return True

    def status(self):
        with self.changed:
            return {'enabled': True, 'online': bool(self.last_seen and self.clock() - self.last_seen < 45),
                    'lastSeen': int(self.last_seen), 'buffered': len(self.events), 'dropped': self.dropped,
                    'retentionDays': 60, 'storage': '玻尔1', 'node': self.node_stats}

    def exchange(self, body, *, wait=10):
        if not isinstance(body, dict) or set(body) - {'ack', 'results', 'stats'}:
            raise ManagementError('统计节点请求不合法。')
        ack, results = body.get('ack', []), body.get('results', {})
        if not isinstance(ack, list) or len(ack) > 200 or not all(isinstance(x, str) for x in ack) or not isinstance(results, dict) or len(results) > 4:
            raise ManagementError('统计节点回复不合法。')
        with self.changed:
            self.last_seen = self.clock()
            if isinstance(body.get('stats'), dict):
                self.node_stats = {k: body['stats'][k] for k in ('rows', 'databaseBytes', 'lastPruned', 'geoVersion') if k in body['stats']}
            for key in ack:
                self.events.pop(key, None)
            for key, value in results.items():
                query = self.queries.get(key)
                if query and isinstance(value, dict):
                    query['result'] = value
            self.changed.notify_all()
            deadline = time.monotonic() + wait
            while not self.events and not any(q['result'] is None for q in self.queries.values()):
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    break
                self.changed.wait(remaining)
            return {'events': list(self.events.values())[:200],
                    'queries': [{'id': k, **q['request']} for k, q in self.queries.items() if q['result'] is None],
                    'retentionDays': 60}

    def query(self, options, *, timeout=15):
        mode = options.get('mode', 'summary')
        if mode not in ('summary', 'visits', 'export'):
            raise ManagementError('统计查询不合法。')
        try:
            days = int(options.get('days', 7))
            before = int(options.get('before', 0))
        except (ValueError, TypeError):
            raise ManagementError('统计时间不合法。') from None
        if not 1 <= days <= 60 or before < 0:
            raise ManagementError('统计时间须为 1–60 天。')
        ip = text(options.get('ip'), 64)
        if ip:
            try: ip = str(ipaddress.ip_address(ip))
            except ValueError: raise ManagementError('请输入完整 IP 地址。') from None
        request = {'mode': mode, 'days': days, 'before': before, 'ip': ip, 'path': text(options.get('path'), 160)}
        with self.changed:
            if not self.last_seen or self.clock() - self.last_seen > 45:
                raise ManagementError('玻尔1统计节点暂未连接，稍后刷新即可。', 503)
            if len(self.queries) >= 4:
                raise ManagementError('统计查询繁忙，请稍后重试。', 429)
            key = uuid.uuid4().hex
            self.queries[key] = {'request': request, 'result': None}
            self.changed.notify_all()
            deadline = time.monotonic() + timeout
            try:
                while self.queries[key]['result'] is None:
                    remaining = deadline - time.monotonic()
                    if remaining <= 0:
                        raise ManagementError('统计节点响应超时，请稍后重试。', 503)
                    self.changed.wait(remaining)
                result = self.queries[key]['result']
                if 'error' in result:
                    raise ManagementError('统计查询暂时不可用。', 503)
                return {**result, 'relay': self.status()}
            finally:
                self.queries.pop(key, None)


def from_environment(state_dir):
    import os
    path = Path(os.environ.get('SMTVV_ANALYTICS_CONFIG') or state_dir / 'analytics.json')
    if not path.is_file():
        return None
    return AnalyticsRelay(json.loads(path.read_text()))
