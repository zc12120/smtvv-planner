"""On-demand exact fusion and essence optimization.
A finite (demon, requested-skill subset) state space replaces depth limits.
"""
import json
import os
import sys
from pathlib import Path
import subprocess
import threading
import time
import uuid
from routes import RouteSearch, Tree, SearchBusy
from native_engine import engine_command
from search_graph import context_topology
from compute_cache import CompletedResults, configuration_key
from planner import VERSION
from compute_protocol import objective, computed_objectives, objective_result

ROOT=Path(__file__).parent

class OptimalSearch(RouteSearch):
    def __init__(self,request):
        # The legacy bounded context supplies validation/data and materialization
        # only; no step budget enters the optimizer problem or stop condition.
        self.objective=objective(request.get('objective','mixed'))
        self.computed_objectives=[]
        super().__init__({k:v for k,v in request.items() if k!='maxSteps'})
        del self.max_steps
        del self.deadline
        self.solutions={};self.stage='准备数据';self.cancelled=threading.Event();self.process=None
        self.finished=False;self.complete=False;self.error='';self.message='';self.started=time.monotonic();self.ended=None

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
                    expected=next((ins for ins in self.reverse[n] if sorted(ins)==sorted(c.name for c in children)),None)
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
            try:self.process.terminate()
            except OSError:pass

    def snapshot(self):
        return dict(jobId=getattr(self,'id',''),finished=self.finished,complete=self.complete,error=self.error,message=self.message,stage=self.stage,seconds=round((self.ended or time.monotonic())-self.started,2),objective=self.objective,computedObjectives=self.computed_objectives.copy(),solutions=self.solutions.copy(),priceMode=self.price_mode,target=self.target)

MAX_ACTIVE_JOBS=8
MAX_RETAINED_JOBS=24
JOB_RETENTION_SECONDS=1800

JOBS={};LOCK=threading.Lock();COMPUTE_LOCK=threading.Lock();RESULTS=CompletedResults()
def start_optimal(request):
    job_id=request.get('requestId')
    if job_id is not None and (not isinstance(job_id,str) or not 1<=len(job_id)<=80):
        raise ValueError('计算请求编号不合法。')
    with LOCK:
        # A client may lose the response after the search has already started.
        # Reusing its request ID returns that job instead of starting it again.
        existing=JOBS.get(job_id)
        if existing:
            if existing.request!={k:v for k,v in request.items() if k!='maxSteps'}:raise ValueError('同一计算请求不能使用不同配置，请重新生成。')
            return {'jobId':existing.id}
        old=JOBS.get(request.get('previousJob'))
        active=[job for job in JOBS.values() if job is not old and not job.finished]
        if len(active)>=MAX_ACTIVE_JOBS:raise SearchBusy('计算队列已满，请稍后重试。')
    # Graph construction and request validation can be expensive. Keep them
    # outside the registry lock so cancellation/status remain responsive.
    job=OptimalSearch(request);job.id=job_id or uuid.uuid4().hex
    with LOCK:
        # Another caller may have submitted the same ID while we prepared it.
        existing=JOBS.get(job_id)
        if existing:
            if existing.request!=job.request:raise ValueError('同一计算请求不能使用不同配置，请重新生成。')
            return {'jobId':existing.id}
        old=JOBS.get(request.get('previousJob'))
        active=[saved for saved in JOBS.values() if saved is not old and not saved.finished]
        if len(active)>=MAX_ACTIVE_JOBS:raise SearchBusy('计算队列已满，请稍后重试。')
        if old:old.cancel()
        # Retire completed/cancelled jobs only; another visitor must never evict a running search.
        now=time.monotonic()
        for key,saved in list(JOBS.items()):
            if (saved.finished or saved.cancelled.is_set()) and now-saved.started>JOB_RETENTION_SECONDS:del JOBS[key]
        while len(JOBS)>=MAX_RETAINED_JOBS:
            key=next((key for key,saved in JOBS.items() if saved.finished or saved.cancelled.is_set()),None)
            if key is None:raise SearchBusy('计算队列已满，请稍后重试。')
            del JOBS[key]
        job.stage='排队等待计算'
        JOBS[job.id]=job
    def work():
        cache_key=configuration_key(job.request,ROOT,VERSION)
        def restore_completed():
            saved=RESULTS.get(cache_key)
            if saved is None or job.cancelled.is_set():return False
            if configuration_key(job.request,ROOT,VERSION)!=cache_key:return False
            job.computed_objectives=saved['computedObjectives'];job.solutions=saved['solutions'];job.message=saved['message'];job.stage='已完成'
            job.complete=True;job.cache_hit=True;job.ended=time.monotonic();job.finished=True
            return True
        # Completed identical configurations do not need to wait behind a
        # different expensive request; configuration validation already ran.
        if restore_completed():return
        # A cancelled queued job must leave promptly, even while another search
        # owns the engine. Otherwise repeated cancel/retry can exhaust threads.
        while not job.cancelled.is_set():
            if not COMPUTE_LOCK.acquire(timeout=0.1):continue
            try:
                if not job.cancelled.is_set():
                    # An engine update may have arrived while this job queued.
                    cache_key=configuration_key(job.request,ROOT,VERSION)
                    if restore_completed():return
                    job.started=time.monotonic();job.stage='准备数据';job.run()
                    if job.complete and not job.error and not job.cancelled.is_set() and configuration_key(job.request,ROOT,VERSION)==cache_key:
                        saved={'solutions':job.solutions,'message':job.message,'computedObjectives':job.computed_objectives}
                        RESULTS.put(cache_key,saved)
                        for selected in job.computed_objectives:
                            if set(computed_objectives(selected))<=set(job.computed_objectives):
                                RESULTS.put(configuration_key({**job.request,'objective':selected},ROOT,VERSION),objective_result(saved,selected))
                    return
            finally:COMPUTE_LOCK.release()
        job.message='已取消';job.ended=time.monotonic();job.finished=True
    try:threading.Thread(target=work,daemon=True).start()
    except Exception:
        with LOCK:JOBS.pop(job.id,None)
        raise
    return {'jobId':job.id}

def get_optimal(request):
    with LOCK:job=JOBS.get(request.get('jobId'))
    if not job:raise ValueError('生成任务已过期，请重新生成。')
    return job.snapshot()

def cancel_optimal(request):
    with LOCK:job=JOBS.get(request.get('jobId'))
    if job:job.cancel()
    return {'cancelled':True}
