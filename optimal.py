"""On-demand exact fusion and essence optimization.
A finite (demon, requested-skill subset) state space replaces depth limits.
"""
from copy import deepcopy
import json
import os
import sys
from pathlib import Path
import subprocess
import threading
from threading import Thread as WorkerThread
import time
import uuid
from routes import Tree, SearchBusy
from search_context import SearchContext
from native_engine import engine_command
from search_graph import context_topology
from compute_cache import CompletedResults, configuration_key
from planner import VERSION
from compute_protocol import objective, computed_objectives, objective_result, normalize, identifier

ROOT=Path(__file__).parent

class OptimalSearch:
    def __init__(self,request):
        self.context = SearchContext(request)
        self.objective = self.context.request['objective']
        self.computed_objectives = []
        self.solutions={};self.stage='准备数据';self.cancelled=threading.Event();self.process=None
        self.finished=False;self.complete=False;self.error='';self.message='';self.started=time.monotonic();self.ended=None

    def __getattr__(self, name):
        return getattr(self.context, name)

    def problem(self):
        names,graph=context_topology(self)
        native=[self.native[n] for n in names]+[0]*(graph.nodes-len(names))
        prices=[self.prices[n] if n!=self.target and (self.starting is None or n in self.starting) else -1 for n in names]
        header=f'{len(native)} {len(names)} {len(self.skills)} {names.index(self.target)} {len(graph.arcs)}'
        data='\n'.join([header,' '.join(map(str,native)),' '.join(map(str,prices))])+'\n'+graph.text
        return names,native,graph.arcs,prices,data

    def engine_command(self):
        return engine_command(ROOT)

    def decode(self,payload,names):
        entries=[]
        for node in payload['nodes']:
            children=[]
            for child in node['children']:
                value=entries[child]
                if isinstance(value,tuple):children.extend(value)
                else:children.append(value)
            if node['entity']>=len(names):entries.append(tuple(children))
            else:
                n=names[node['entity']]
                # Align material order with the real recipe before validation.
                if children:
                    child_names=sorted(c.name for c in children)
                    expected=next((ins for ins in self.reverse[n] if sorted(ins)==child_names),None)
                    if expected is None:raise ValueError('优化结果包含无法验证的配方。')
                    lookup={c.name:c for c in children};children=[lookup[x] for x in expected]
                entries.append(Tree(n,tuple(children),node['mask'],node['cost'],node['steps']))
        tree=entries[payload['root']]
        route=self.materialize(tree);route['objective']=payload['objective'];route['optimal']=True;route['settledStates']=payload['settled']
        return route

    def start_engine(self,data,arguments=()):
        if os.environ.get('SMTVV_COMPUTE_MODE')=='remote':
            raise RuntimeError('主站已禁用本机计算。')
        if self.cancelled.is_set():return False
        command=self.engine_command()+list(arguments)
        if os.environ.get('SMTVV_ENGINE_LIMITS')=='1':
            command=[sys.executable,str(ROOT/'engine_limited.py')]+command
        self.process=subprocess.Popen(command,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
        # Cancellation can arrive while Popen is creating the process, before
        # cancel() can see it. Check again before writing a potentially large input.
        if self.cancelled.is_set():
            if self.process.poll() is None:self.process.terminate()
            return False
        self.process.stdin.write(data);self.process.stdin.close()
        return True

    def run(self):
        try:
            if self.cancelled.is_set():self.message='已取消';return
            if self.objective in ('shortest','cheapest','all'):
                names,native,arcs,prices,data=self.problem()
                self.stage='正在计算合体次数最少的路线'
                # Cheapest uses shortest as its search upper bound; keep that result too.
                arguments=('--shortest-only',) if self.objective=='shortest' else ()
                if not self.start_engine(data,arguments):self.message='已取消';return
                for line in self.process.stdout:
                    if self.cancelled.is_set():self.process.terminate();self.message='已取消';break
                    payload=json.loads(line)
                    if payload['found']:self.solutions[payload['objective']]=self.decode(payload,names)
                    self.computed_objectives.append(payload['objective'])
                    self.stage='正在计算费用最低的路线' if payload['objective']=='shortest' and self.objective!='shortest' else '已完成'
                code=self.process.wait()
                if self.cancelled.is_set():self.message='已取消';return
                if code:raise ValueError('计算引擎异常退出：'+self.process.stderr.read()[:300])
                for stream in (self.process.stdout,self.process.stderr):stream.close()
            if self.objective in ('mixed','all'):
                self.stage='正在联合搜索合体与灵体的综合路线'
                from mixed import solve as solve_mixed
                combined=solve_mixed(self)
                if combined:self.solutions['mixed']=combined
                if not self.cancelled.is_set():self.computed_objectives.append('mixed')
            if not self.cancelled.is_set():
                if set(self.computed_objectives)!=set(computed_objectives(self.objective)):
                    raise ValueError('计算引擎未返回所选方案。')
                self.complete=True;self.stage='已完成';self.message='所选方案已计算完成。综合方案默认拥有全部灵体，不计灵体费用。'
        except Exception as e:
            if not self.cancelled.is_set():self.error=f'生成失败：{e}'
        finally:
            if self.process:
                if self.process.poll() is None:
                    self.process.terminate()
                    self.process.wait()
                for stream in (self.process.stdin,self.process.stdout,self.process.stderr):
                    if stream and not stream.closed:stream.close()
            self.ended=time.monotonic();self.finished=True

    def cancel(self):
        self.cancelled.set()
        if self.process and self.process.poll() is None:
            process = self.process
            try:process.terminate()
            except OSError:pass
            def reap():
                try:process.wait(timeout=2)
                except subprocess.TimeoutExpired:
                    try:process.kill()
                    except OSError:pass
            threading.Thread(target=reap, daemon=True).start()

    def snapshot(self):
        return dict(jobId=getattr(self,'id',''),finished=self.finished,complete=self.complete,error=self.error,message=self.message,stage=self.stage,seconds=round((self.ended or time.monotonic())-self.started,2),objective=self.objective,computedObjectives=self.computed_objectives.copy(),solutions=self.solutions.copy(),priceMode=self.price_mode,target=self.target)

MAX_ACTIVE_JOBS = 8
MAX_RETAINED_JOBS = 128
JOB_RETENTION_SECONDS = 1800
JOBS = {}
LOCK = threading.RLock()
COMPUTE_LOCK = threading.Lock()
RESULTS = CompletedResults()


class LocalTask:
    """A bounded execution shared by independent client subscriptions."""
    def __init__(self, config, key):
        self.request, self.key = config, key
        self.target = config['target']
        self.price_mode = 'custom' if config['prices'] else 'baseline'
        self.objective = config['objective']
        self.cancelled = threading.Event()
        self.started = time.monotonic()
        self.ended = None
        self.finished = self.complete = self.cache_hit = False
        self.status = 'queued'
        self.stage = '排队等待计算'
        self.error = self.message = ''
        self.solutions = {}
        self.computed_objectives = []
        self.search = None

    @property
    def process(self):
        return self.search.process if self.search else None

    def restore(self, saved):
        self.solutions = saved['solutions']
        self.computed_objectives = saved['computedObjectives']
        self.message = saved['message']
        self.complete = self.finished = self.cache_hit = True
        self.status, self.stage = 'completed', '已完成'
        self.ended = time.monotonic()

    def cancel(self):
        self.cancelled.set()
        if self.search:
            self.search.cancel()


class LocalJob:
    def __init__(self, job_id, task, selected):
        self.id, self.task, self.selected = job_id, task, selected
        self.cancelled = threading.Event()

    def __getattr__(self, name):
        return getattr(self.task, name)

    def cancel(self):
        with LOCK:
            self.cancelled.set()
            if not any(job.task is self.task and not job.cancelled.is_set() for job in JOBS.values()):
                self.task.cancel()

    def snapshot(self):
        task = self.task
        source = task.search.snapshot() if task.search and not task.finished else dict(
            stage=task.stage, solutions=task.solutions, computedObjectives=task.computed_objectives,
            complete=task.complete, finished=task.finished, error=task.error, message=task.message)
        result = deepcopy(source)
        for route in result['solutions'].values():
            route['skills'] = self.selected.copy()
        cancelled = self.cancelled.is_set()
        result.update(jobId=self.id, target=self.target, priceMode=self.price_mode,
                      objective=self.objective, status='cancelled' if cancelled else task.status,
                      seconds=round((task.ended or time.monotonic()) - task.started, 2),
                      resultId=self.key if task.complete else None)
        if cancelled:
            result.update(finished=True, complete=False, message='已取消', error='', solutions={}, computedObjectives=[])
        return result


def _run_task(task):
    acquired = False
    timer = None
    key = task.key
    try:
        while not task.cancelled.is_set():
            if not COMPUTE_LOCK.acquire(timeout=.1):
                continue
            acquired = True
            key = configuration_key(task.request, ROOT, VERSION)
            saved = RESULTS.get(key)
            if saved is not None and not task.cancelled.is_set():
                task.restore(saved)
                return
            if task.cancelled.is_set():
                break
            task.status, task.stage = 'running', '准备数据'
            task.started = time.monotonic()
            search = task.search = OptimalSearch(task.request)
            search.cancelled = task.cancelled
            timer = threading.Timer(180, task.cancel)
            timer.daemon = True
            timer.start()
            search.run()
            task.solutions, task.computed_objectives = search.solutions, search.computed_objectives
            task.error, task.message, task.complete = search.error, search.message, search.complete
            if task.complete and not task.error and not task.cancelled.is_set() and configuration_key(task.request, ROOT, VERSION) == key:
                saved = dict(solutions=task.solutions, message=task.message, computedObjectives=task.computed_objectives)
                RESULTS.put(key, saved)
                for selected in task.computed_objectives:
                    if set(computed_objectives(selected)) <= set(task.computed_objectives):
                        RESULTS.put(configuration_key({**task.request, 'objective': selected}, ROOT, VERSION), objective_result(saved, selected))
            break
    except Exception:
        import logging
        logging.exception('Local calculation failed')
        task.error = '生成失败，请重新尝试。'
    finally:
        if timer:
            timer.cancel()
        if acquired:
            COMPUTE_LOCK.release()
        if not task.cache_hit:
            if task.cancelled.is_set():
                task.message = '已取消或达到计算时间上限，请重新生成。'
                task.complete = False
            task.status = 'cancelled' if task.cancelled.is_set() else 'completed' if task.complete else 'failed'
            task.stage = '已完成' if task.complete else task.message or '计算失败'
            task.ended, task.finished = time.monotonic(), True
        # Completed tasks retain only the response, never the search graph.
        task.search = None


def start_optimal(request):
    config = normalize(request)
    job_id = request.get('requestId')
    previous = request.get('previousJob')
    if job_id is not None:
        identifier(job_id)
    if previous is not None:
        identifier(previous, '上次任务编号')
    key = configuration_key(config, ROOT, VERSION)
    saved = RESULTS.get(key)
    selected = list(dict.fromkeys(request.get('skills', [])))
    with LOCK:
        existing = JOBS.get(job_id)
        if existing:
            if existing.request != config:
                raise ValueError('同一计算请求不能使用不同配置，请重新生成。')
            return {'jobId': existing.id}
        tasks = {id(job.task): job.task for job in JOBS.values()}
        task = next((t for t in tasks.values() if key is not None and t.key == key and not t.finished and not t.cancelled.is_set()), None)
        new_execution = task is None and saved is None
        if new_execution and sum(not t.finished for t in tasks.values()) >= MAX_ACTIVE_JOBS:
            raise SearchBusy('计算队列已满，请稍后重试。')
        now = time.monotonic()
        for name, old in list(JOBS.items()):
            if old.finished and now - old.started > JOB_RETENTION_SECONDS:
                del JOBS[name]
        while len(JOBS) >= MAX_RETAINED_JOBS:
            name = next((name for name, old in JOBS.items() if old.finished), None)
            if name is None:
                raise SearchBusy('任务记录暂满，请稍后重试。')
            del JOBS[name]
        if saved is not None:
            task = LocalTask(config, key)
            task.restore(saved)
        elif task is None:
            task = LocalTask(config, key)
        job_id = job_id or uuid.uuid4().hex
        job = JOBS[job_id] = LocalJob(job_id, task, selected)
        if new_execution:
            try:
                WorkerThread(target=_run_task, args=(task,), daemon=True, name='smtvv-optimal-worker').start()
            except Exception:
                JOBS.pop(job_id, None)
                raise
        old = JOBS.get(previous)
        if old and old is not job:
            old.cancel()
        return {'jobId': job.id}


def get_optimal(request):
    with LOCK:
        job = JOBS.get(request.get('jobId'))
    if not job:
        raise ValueError('生成任务已过期，请重新生成。')
    return job.snapshot()


def cancel_optimal(request):
    with LOCK:
        job = JOBS.get(request.get('jobId'))
        if job:
            job.cancel()
    return {'cancelled': True}


def jobs_overview():
    from game_data import label
    with LOCK:
        jobs = list(JOBS.items())
    items = []
    counts = {name: 0 for name in ('running', 'queued', 'completed', 'cancelled', 'failed')}
    for job_id, job in reversed(jobs):
        snapshot = job.snapshot()
        status = snapshot['status']
        counts[status] += 1
        items.append(dict(id=job_id, target=job.target, label=label(job.target), status=status,
                          stage=snapshot['stage'], seconds=snapshot['seconds'],
                          solutions=len(snapshot['solutions']), canCancel=status in ('running', 'queued')))
    return dict(items=items, counts=counts, capacity=MAX_ACTIVE_JOBS)


def job_exists(job_id):
    with LOCK:
        return isinstance(job_id, str) and job_id in JOBS
