"""Durable coordinator. This module never imports or executes a search engine."""
import hashlib
import hmac
import json
import os
from pathlib import Path
import secrets
import sqlite3
import threading
import time
import uuid

from compute_protocol import cache_key, encode, identifier, normalize, revision, OBJECTIVES, computed_objectives, objective_result
from routes import SearchBusy

MAX_RESULT_BYTES = 8 * 1024 * 1024


class ComputeError(ValueError):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


class Coordinator:
    def __init__(self, path, workers, *, version=None, clock=time.time, capacity=64,
                 lease_seconds=30, task_seconds=180):
        self.version = version or revision()
        self.clock, self.capacity = clock, capacity
        self.lease_seconds, self.task_seconds = lease_seconds, task_seconds
        self.workers = workers
        self.last_pruned = float('-inf')
        self.lock = threading.RLock()
        self.changed = threading.Condition(self.lock)
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(path, check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.db.executescript('''
            PRAGMA journal_mode=WAL;
            PRAGMA synchronous=FULL;
            CREATE TABLE IF NOT EXISTS tasks (
                id TEXT PRIMARY KEY, key TEXT NOT NULL, kind TEXT NOT NULL, config TEXT NOT NULL, revision TEXT NOT NULL,
                state TEXT NOT NULL, created REAL NOT NULL, updated REAL NOT NULL,
                started REAL, worker TEXT, slot INTEGER, session TEXT, lease TEXT, expires REAL,
                attempts INTEGER NOT NULL DEFAULT 0, stage TEXT NOT NULL DEFAULT '排队等待计算',
                result TEXT, error TEXT NOT NULL DEFAULT '', result_bytes INTEGER NOT NULL DEFAULT 0);
            CREATE INDEX IF NOT EXISTS tasks_key ON tasks(key, state);
            CREATE UNIQUE INDEX IF NOT EXISTS tasks_active_key ON tasks(key) WHERE state IN ('queued','running');
            CREATE TABLE IF NOT EXISTS tickets (
                id TEXT PRIMARY KEY, task TEXT NOT NULL, key TEXT NOT NULL, created REAL NOT NULL,
                cancelled INTEGER NOT NULL DEFAULT 0, presentation TEXT NOT NULL DEFAULT '{}');
            CREATE INDEX IF NOT EXISTS tickets_task ON tickets(task);
            CREATE TABLE IF NOT EXISTS workers (
                name TEXT NOT NULL, slot INTEGER NOT NULL, seen REAL NOT NULL, session TEXT NOT NULL,
                revision TEXT NOT NULL, PRIMARY KEY(name,slot));
            CREATE TABLE IF NOT EXISTS pages (
                ticket TEXT NOT NULL, ordering TEXT NOT NULL, next_offset INTEGER NOT NULL,
                PRIMARY KEY(ticket, ordering));
        ''')
        if 'result_bytes' not in {r['name'] for r in self.db.execute('PRAGMA table_info(tasks)')}:
            self.db.execute('ALTER TABLE tasks ADD COLUMN result_bytes INTEGER NOT NULL DEFAULT 0')
            self.db.execute('UPDATE tasks SET result_bytes=length(CAST(result AS BLOB)) WHERE result IS NOT NULL')
            self.db.commit()
        if 'presentation' not in {r['name'] for r in self.db.execute('PRAGMA table_info(tickets)')}:
            self.db.execute("ALTER TABLE tickets ADD COLUMN presentation TEXT NOT NULL DEFAULT '{}'")
            self.db.commit()

    def close(self):
        with self.lock:
            self.db.close()

    def authenticate(self, authorization, body):
        name, slot = body.get('worker'), body.get('slot')
        config = self.workers.get(name) if isinstance(name, str) else None
        digest = hashlib.sha256(authorization.removeprefix('Bearer ').encode()).hexdigest()
        if (not authorization.startswith('Bearer ') or not config
                or not hmac.compare_digest(digest, config['tokenSha256'])
                or type(slot) is not int or not 0 <= slot < config['slots']):
            raise ComputeError('工作节点认证失败。', 401)
        return name, slot

    def _prune(self, now):
        if now-self.last_pruned < 2:
            return
        self.last_pruned = now
        self.db.execute("UPDATE tasks SET state='failed',error='计算规则已更新，请重新生成。',updated=? "
                        "WHERE state IN ('queued','running') AND revision!=?", (now,self.version))
        # Recover expired leases, including those left by an application restart.
        self.db.execute("UPDATE tasks SET state=CASE WHEN attempts>=3 THEN 'failed' ELSE 'queued' END, "
                        "stage='排队等待计算', error=CASE WHEN attempts>=3 THEN '计算节点多次中断，请重试。' ELSE '' END, "
                        "worker=NULL,slot=NULL,session=NULL,lease=NULL,expires=NULL,result=NULL,result_bytes=0,updated=? "
                        "WHERE state='running' AND expires<?", (now, now))
        self.db.execute("UPDATE tasks SET state='failed',error='排队时间过长，请稍后重试。',updated=? "
                        "WHERE state='queued' AND created<?", (now, now-900))
        self.db.execute("DELETE FROM tickets WHERE created<? AND task IN "
                        "(SELECT id FROM tasks WHERE state NOT IN ('queued','running'))", (now-1800,))
        rows = self.db.execute("SELECT id,result_bytes AS size,updated FROM tasks "
                               "WHERE state NOT IN ('queued','running') ORDER BY updated DESC").fetchall()
        size = 0
        for index, row in enumerate(rows):
            size += row['size']
            if index >= 512 or size > 128*1024*1024 or row['updated'] < now-86400:
                self.db.execute('DELETE FROM tickets WHERE task=?', (row['id'],))
                self.db.execute('DELETE FROM tasks WHERE id=?', (row['id'],))
        self.db.execute('DELETE FROM pages WHERE ticket NOT IN (SELECT id FROM tickets)')

    def exists(self, job_id):
        with self.lock:
            return isinstance(job_id, str) and self.db.execute('SELECT 1 FROM tickets WHERE id=?', (job_id,)).fetchone() is not None

    def submit(self, request, kind='optimal', *, normalized=False):
        config = request if normalized else normalize(request, kind)
        job_id = request.get('requestId') if not normalized else None
        if job_id is not None:
            identifier(job_id)
        previous = request.get('previousJob') if not normalized else None
        if previous is not None:
            identifier(previous, '上次任务编号')
        key = cache_key(kind, config, self.version)
        with self.changed, self.db:
            now = self.clock()
            self._prune(now)
            existing = self.db.execute('SELECT key FROM tickets WHERE id=?', (job_id,)).fetchone()
            if existing:
                if existing['key'] != key:
                    raise ValueError('同一计算请求不能使用不同配置，请重新生成。')
                return {'jobId': job_id}
            task = self.db.execute("SELECT id FROM tasks WHERE key=? AND state IN ('queued','running','completed') "
                                   "ORDER BY CASE state WHEN 'completed' THEN 0 ELSE 1 END,updated DESC LIMIT 1", (key,)).fetchone()
            if task is None and kind == 'optimal':
                # A completed cheapest/all search may already contain this answer.
                for other in (*OBJECTIVES, 'all'):
                    candidate = self.db.execute("SELECT id,result FROM tasks WHERE key=? AND state='completed' ORDER BY updated DESC LIMIT 1",
                                                (cache_key(kind, {**config, 'objective': other}, self.version),)).fetchone()
                    if candidate and set(computed_objectives(config['objective'])) <= set(json.loads(candidate['result']).get('computedObjectives', [])):
                        task = candidate
                        break
            if self.db.execute('SELECT count(*) FROM tickets').fetchone()[0] >= 2048:
                raise SearchBusy('任务记录暂满，请稍后重试。')
            if task is None:
                active = self.db.execute("SELECT count(*) FROM tasks WHERE state IN ('queued','running')").fetchone()[0]
                if active >= self.capacity:
                    raise SearchBusy('计算队列已满，请稍后重试。')
                task_id = uuid.uuid4().hex
                self.db.execute('INSERT INTO tasks(id,key,kind,config,revision,state,created,updated) VALUES(?,?,?,?,?,?,?,?)',
                                (task_id, key, kind, encode(config), self.version, 'queued', now, now))
            else:
                task_id = task['id']
            job_id = job_id or uuid.uuid4().hex
            presentation={'skills':list(dict.fromkeys(request.get('skills',config.get('skills',[])))),'objective':config.get('objective')}
            self.db.execute('INSERT INTO tickets(id,task,key,created,presentation) VALUES(?,?,?,?,?)', (job_id, task_id, key, now,encode(presentation)))
            if previous and previous != job_id:
                self._cancel(previous, now)
            self.changed.notify_all()
            return {'jobId': job_id}

    def _cancel(self, job_id, now):
        ticket = self.db.execute('SELECT task FROM tickets WHERE id=?', (job_id,)).fetchone()
        if ticket:
            self.db.execute('UPDATE tickets SET cancelled=1 WHERE id=?', (job_id,))
            count = self.db.execute('SELECT count(*) FROM tickets WHERE task=? AND cancelled=0', (ticket['task'],)).fetchone()[0]
            if not count:
                self.db.execute("UPDATE tasks SET state='cancelled',updated=? WHERE id=? AND state IN ('queued','running')", (now, ticket['task']))

    def cancel(self, request):
        job_id = identifier(request.get('jobId'))
        with self.changed, self.db:
            self._cancel(job_id, self.clock())
            self.changed.notify_all()
        return {'cancelled': True}

    def _get(self, job_id):
        row = self.db.execute('SELECT t.*,j.cancelled,j.presentation,j.created AS submitted FROM tickets j '
                              'JOIN tasks t ON j.task=t.id WHERE j.id=?', (job_id,)).fetchone()
        if not row:
            raise ValueError('生成任务已过期，请重新生成。')
        return row

    def snapshot(self, request):
        job_id = identifier(request.get('jobId'))
        with self.lock, self.db:
            self._prune(self.clock())
            row = self._get(job_id)
            config = json.loads(row['config'])
            result = json.loads(row['result']) if row['result'] else {}
            for route in result.get('solutions',{}).values():
                route['skills']=json.loads(row['presentation']).get('skills',config.get('skills',[]))
            cancelled = bool(row['cancelled']) or row['state'] == 'cancelled'
            finished = cancelled or row['state'] in ('completed', 'failed')
            elapsed = (row['updated'] if finished else self.clock()) - (row['started'] or row['submitted'])
            if row['kind'] == 'optimal':
                selected=json.loads(row['presentation']).get('objective') or config.get('objective','all')
                if row['state']=='completed' and 'computedObjectives' not in result:
                    result['computedObjectives']=computed_objectives(config.get('objective','all'))
                result=objective_result({**result,'solutions':result.get('solutions',{})},selected)
                return dict(jobId=job_id, finished=finished, complete=row['state']=='completed' and not cancelled,
                            error=row['error'] if not cancelled else '', message='已取消' if cancelled else result.get('message',''),
                            stage='已完成' if row['state']=='completed' else row['stage'], seconds=max(0, round(elapsed, 2)),
                            solutions={} if cancelled else result.get('solutions', {}),
                            objective=selected,computedObjectives=[] if cancelled else result['computedObjectives'],
                            target=config['target'], priceMode='custom' if config['prices'] else 'baseline')
            return dict(jobId=job_id, finished=finished, complete=row['state']=='completed' and not cancelled,
                        error=row['error'], cancelled=cancelled, result=result, seconds=max(0,round(elapsed,2)))

    def _claim(self, name, slot, session, version):
        now = self.clock()
        self._prune(now)
        self.db.execute('INSERT INTO workers VALUES(?,?,?,?,?) ON CONFLICT(name,slot) DO UPDATE SET '
                        'seen=excluded.seen,session=excluded.session,revision=excluded.revision',
                        (name, slot, now, session, version))
        if version != self.version:
            raise ComputeError('计算版本不一致，请更新工作节点。', 409)
        row = self.db.execute("SELECT * FROM tasks WHERE state='running' AND worker=? AND slot=?", (name,slot)).fetchone()
        if row and row['session'] != session:
            return None
        if row is None:
            row = self.db.execute("SELECT * FROM tasks WHERE state='queued' ORDER BY created,id LIMIT 1").fetchone()
            if row is None:
                return None
            lease = secrets.token_hex(24)
            self.db.execute("UPDATE tasks SET state='running',worker=?,slot=?,session=?,lease=?,expires=?,"
                            "attempts=attempts+1,started=?,updated=?,stage='准备数据',result=NULL,result_bytes=0 WHERE id=?",
                            (name, slot, session, lease, now+self.lease_seconds, now, now, row['id']))
            row = self.db.execute('SELECT * FROM tasks WHERE id=?', (row['id'],)).fetchone()
        return dict(taskId=row['id'], lease=row['lease'], kind=row['kind'], request=json.loads(row['config']),
                    timeout=self.task_seconds, revision=self.version)

    def worker_call(self, authorization, body, *, wait_seconds=5):
        name, slot = self.authenticate(authorization, body)
        action = body.get('action')
        session = identifier(body.get('session'), '节点会话')
        if action == 'claim':
            deadline = time.monotonic()+min(5, max(0, wait_seconds))
            with self.changed:
                while True:
                    with self.db:
                        task = self._claim(name, slot, session, body.get('revision'))
                    if task or time.monotonic() >= deadline:
                        return {'task': task}
                    self.changed.wait(max(0, deadline-time.monotonic()))
        if action not in ('heartbeat', 'finish'):
            raise ComputeError('未知的工作节点操作。')
        with self.changed, self.db:
            now = self.clock()
            self._prune(now)
            self.db.execute('UPDATE workers SET seen=? WHERE name=? AND slot=? AND session=?', (now,name,slot,session))
            row = self.db.execute('SELECT * FROM tasks WHERE id=?', (body.get('taskId'),)).fetchone()
            if (not row or row['worker'] != name or row['slot'] != slot or row['session'] != session
                    or not hmac.compare_digest(row['lease'] or '', str(body.get('lease','')))):
                return {'accepted': False, 'cancel': True}
            if row['state'] in ('completed','failed') and action == 'finish' and row['expires'] is None:
                return {'accepted': True, 'cancel': False}  # Lost acknowledgement retry.
            if row['state'] != 'running':
                return {'accepted': False, 'cancel': True}
            if now-row['started'] > self.task_seconds+15:
                self.db.execute("UPDATE tasks SET state='failed',error='计算超时，请减少技能或限制起始材料。',updated=? WHERE id=?", (now,row['id']))
                return {'accepted': False, 'cancel': True}
            payload = body.get('result')
            result = None
            if payload is not None:
                if not isinstance(payload, dict):
                    raise ComputeError('工作节点结果格式不合法。')
                result = encode(payload)
                if len(result.encode()) > MAX_RESULT_BYTES:
                    raise ComputeError('计算结果超出容量限制。', 413)
            stage = str(body.get('stage', row['stage']))[:120]
            if action == 'finish':
                error = str(body.get('error',''))[:500]
                if result is None and not error:
                    raise ComputeError('缺少计算结果。')
                if row['kind']=='optimal' and not error:
                    if payload.get('complete') is not True or payload.get('error') or not isinstance(payload.get('solutions'),dict):
                        raise ComputeError('工作节点未完成全部计算。')
                    completed=payload.get('computedObjectives')
                    expected=computed_objectives(json.loads(row['config'])['objective'])
                    if (not isinstance(completed,list) or any(not isinstance(k,str) for k in completed)
                            or set(completed)!=set(expected) or not set(payload['solutions'])<=set(completed)):
                        raise ComputeError('工作节点未完成所选方案。')
                    if any(not isinstance(route,dict) or route.get('validated') is not True for route in payload['solutions'].values()):
                        raise ComputeError('路线未通过校验。')
                self.db.execute('UPDATE tasks SET state=?,result=?,result_bytes=?,error=?,stage=?,updated=?,expires=NULL WHERE id=?',
                                ('failed' if error else 'completed',result,len(result.encode()) if result else 0,error,'计算失败' if error else '已完成',now,row['id']))
            else:
                self.db.execute('UPDATE tasks SET expires=?,updated=?,stage=?,result=COALESCE(?,result),result_bytes=COALESCE(?,result_bytes) WHERE id=?',
                                (now+self.lease_seconds,now,stage,result,len(result.encode()) if result else None,row['id']))
            self.changed.notify_all()
            return {'accepted': True, 'cancel': False}

    def synchronous(self, request, kind, timeout=22):
        job = self.submit(request, kind, normalized=kind=='routes_page')
        deadline = time.monotonic()+timeout
        while True:
            snapshot = self.snapshot(job)
            if snapshot['finished']:
                if snapshot['error']:
                    raise ComputeError(snapshot['error'], 503)
                if snapshot['cancelled']:
                    raise ComputeError('计算已取消。', 409)
                return snapshot['result']
            remaining = deadline-time.monotonic()
            if remaining <= 0:
                # The task stays queued/running. Retries share it, then use its cache.
                raise ComputeError('计算尚未完成，请稍后重试。', 503)
            with self.changed:
                self.changed.wait(min(remaining, .5))

    def routes_snapshot(self, request):
        job_id = identifier(request.get('jobId'))
        try:
            offset, limit = int(request.get('offset',0)), int(request.get('limit',10))
        except (TypeError,ValueError):
            raise ValueError('分页参数无效。')
        order = request.get('order','steps')
        if offset < 0 or not 1 <= limit <= 20 or order not in ('steps','cost'):
            raise ValueError('分页参数超出范围。')
        with self.lock:
            row = self._get(job_id)
            if row['kind'] != 'routes':
                raise ValueError('搜索任务类型不匹配。')
            config = json.loads(row['config'])
            cursor = self.db.execute('SELECT next_offset FROM pages WHERE ticket=? AND ordering=?', (job_id,order)).fetchone()
            if offset > (cursor[0] if cursor else 0):
                raise ValueError('请从第一页开始顺序翻页，避免一次展开过多路线。')
        status = self.snapshot(request)
        if not status['finished'] or status['cancelled'] or status['error']:
            return dict(jobId=job_id,finished=status['finished'],complete=False,error=status['error'],
                        message='已取消' if status['cancelled'] else '排队等待计算',routes=[],total='0',
                        requestedMaxSteps=config['maxSteps'],completedMaxSteps=0,seconds=status['seconds'])
        if offset == 0:
            result = status['result'][order]
            result = {**result, 'routes':result['routes'][:limit]}
        else:
            result = self.synchronous({'config':config,'offset':offset,'limit':limit,'order':order}, 'routes_page')
        result = {**result, 'jobId':job_id, 'nextOffset':str(offset+len(result['routes'])) if offset+len(result['routes']) < int(result['total']) else None}
        for route in result['routes']:
            route['skills']=json.loads(row['presentation']).get('skills',config.get('skills',[]))
        with self.lock, self.db:
            self.db.execute('INSERT INTO pages VALUES(?,?,?) ON CONFLICT(ticket,ordering) DO UPDATE SET '
                            'next_offset=max(next_offset,excluded.next_offset)', (job_id,order,offset+len(result['routes'])))
        return result

    def overview(self):
        from planner import label
        with self.lock, self.db:
            now = self.clock()
            self._prune(now)
            rows = self.db.execute('SELECT j.id AS ticket,j.cancelled,t.* FROM tickets j JOIN tasks t ON j.task=t.id ORDER BY j.created DESC LIMIT 200').fetchall()
            workers = self.db.execute('SELECT * FROM workers').fetchall()
            counts = {key:0 for key in ('running','queued','completed','cancelled','failed')}
            items = []
            for row in rows:
                state = 'cancelled' if row['cancelled'] else row['state']
                counts[state] += 1
                config = json.loads(row['config'])
                target = config.get('target','')
                items.append(dict(id=row['ticket'],target=target,label=label(target) if target else row['kind'],
                                  status=state,stage=row['stage'],seconds=max(0,round((row['updated'] if state not in ('queued','running') else now)-(row['started'] or row['created']))),
                                  solutions=len(json.loads(row['result']).get('solutions',{})) if row['result'] else 0,
                                  canCancel=state in ('queued','running'),worker=row['worker']))
            nodes=[]
            for name,config in self.workers.items():
                slots=[w for w in workers if w['name']==name and now-w['seen']<self.lease_seconds and w['revision']==self.version]
                running=self.db.execute("SELECT count(*) FROM tasks WHERE worker=? AND state='running'",(name,)).fetchone()[0]
                nodes.append(dict(name=name,slots=config['slots'],onlineSlots=len(slots),running=running))
            return dict(items=items,counts=counts,capacity=self.capacity,mode='remote',workers=nodes,
                        computeSlots=sum(w['slots'] for w in self.workers.values()))


def from_environment():
    if os.environ.get('SMTVV_COMPUTE_MODE','local') != 'remote':
        return None
    path = Path(os.environ.get('SMTVV_STATE_DIR','runtime/site'))
    config = json.loads(Path(os.environ.get('SMTVV_WORKERS_FILE',str(path/'compute-workers.json'))).read_text())
    if not config or any(not isinstance(v,dict) or type(v.get('slots')) is not int or not 1<=v['slots']<=2
                         or len(v.get('tokenSha256',''))!=64 for v in config.values()):
        raise RuntimeError('Invalid remote compute worker configuration')
    return Coordinator(path/'compute-queue.sqlite3',config)


COORDINATOR = from_environment()
