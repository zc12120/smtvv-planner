"""Exact bounded fusion-tree enumeration, counts and lazy cost ranking.
Distinct routes are material trees (not permutations of independent execution,
not alternate choices to learn the same requested skill at identical nodes).
"""
import heapq
import itertools
import logging
import threading
import time
import uuid
from collections import defaultdict
from dataclasses import dataclass
from functools import lru_cache
from search_graph import filtered_recipes
from planner import (PLAYABLE, SKILLS, SPECIAL, UNLOCKS, PREREQS, VERSION,
                     read, settings, string_list, transferable, label, validate_route, annotate_skill_sources)

_COSTS=read('comp-costs')
BASE_PRICES={n:2*_COSTS[n] for n in PLAYABLE}

class SearchStopped(Exception):pass
class SearchBusy(Exception):pass

@dataclass(frozen=True)
class Tree:
    name:str
    children:tuple
    mask:int
    cost:int
    steps:int

class Node:
    """Disjoint alternatives in a finite AND/OR DAG; all have the same steps."""
    def __init__(self,engine,name,steps,alts=(),leaf=False):
        self.engine,self.name,self.steps=engine,name,steps
        self.alts=alts
        self.leaf=leaf
        if leaf:self.count=1;self.cost=engine.prices[name]
        else:
            self.count=sum(self.product(a) for a in alts)
            self.cost=min((sum(c.cost for c in a) for a in alts),default=0)
        self.heap=None;self.items=[];self.seen=set()
    @staticmethod
    def product(children):
        total=1
        for child in children:total*=child.count
        return total
    def kth(self,index):
        if index<0 or index>=self.count:raise IndexError(index)
        if self.leaf:return Tree(self.name,(),self.engine.native[self.name],self.cost,0)
        if self.heap is None:
            self.heap=[(sum(c.cost for c in alt),i,(0,)*len(alt)) for i,alt in enumerate(self.alts)]
            heapq.heapify(self.heap)
            self.seen={(i,ranks) for _,i,ranks in self.heap}
        while len(self.items)<=index:
            cost,i,ranks=heapq.heappop(self.heap);alt=self.alts[i]
            children=tuple(child.kth(rank) for child,rank in zip(alt,ranks))
            mask=self.engine.native[self.name]
            for child in children:mask|=child.mask
            self.items.append(Tree(self.name,children,mask,cost,self.steps))
            for j,child in enumerate(alt):
                if ranks[j]+1>=child.count:continue
                updated=ranks[:j]+(ranks[j]+1,)+ranks[j+1:]
                if (i,updated) in self.seen:continue
                self.seen.add((i,updated))
                value=cost-children[j].cost+child.kth(updated[j]).cost
                heapq.heappush(self.heap,(value,i,updated))
        return self.items[index]

ZERO=None

@lru_cache(maxsize=None)
def budgets(total,parts):
    if parts==1:return ((total,),)
    return tuple((n,)+tail for n in range(total+1) for tail in budgets(total-n,parts-1))

class RouteSearch:
    def __init__(self,request):
        self.request=request.copy();self.target=request.get('target')
        if self.target not in PLAYABLE:raise ValueError('请选择目标仲魔。')
        self.graph,self.level,self.slots,self.excluded,self.uncertain=settings(request)
        self.selected=string_list(request.get('skills',[]),'技能',SKILLS)
        if len(self.selected)>self.slots:raise ValueError('所选技能超过可用栏位。')
        self.allowed={n for n,d in self.graph.demons.items() if n not in self.excluded and d['lvl']<=self.level}
        if self.target not in self.allowed:raise ValueError('目标受到等级、DLC、未解锁或排除设置限制。')
        self.skills=[s for s in self.selected if transferable(s)]
        self.unique=[s for s in self.selected if not transferable(s)]
        for s in self.unique:
            if s not in PLAYABLE[self.target]['skills'] or PLAYABLE[self.target]['skills'][s]>self.level:raise ValueError(label(s,'skill')+' 无法由目标自身习得。')
        self.sources=request.get('sources',{})
        if not isinstance(self.sources,dict):raise ValueError('技能来源格式不正确。')
        for s,n in self.sources.items():
            if s not in self.selected or n not in self.allowed or s not in PLAYABLE[n]['skills'] or PLAYABLE[n]['skills'][s]>self.level:raise ValueError('指定技能来源不可用。')
            if not transferable(s) and n!=self.target:raise ValueError('专属技能不可继承。')
        self.full=(1<<len(self.skills))-1
        self.native={n:sum(1<<i for i,s in enumerate(self.skills) if s in PLAYABLE[n]['skills'] and PLAYABLE[n]['skills'][s]<=self.level and (s not in self.sources or self.sources[s]==n)) for n in self.allowed}
        self.prices=BASE_PRICES.copy()
        overrides=request.get('prices',{})
        if not isinstance(overrides,dict):raise ValueError('价格应为仲魔与魔货的对应表。')
        for n,p in overrides.items():
            if n not in PLAYABLE or isinstance(p,bool) or not isinstance(p,int) or not 0<=p<=100000000:raise ValueError('请填写有效的仲魔召唤价格（非负整数）。')
            self.prices[n]=p
        self.price_mode='custom' if overrides else 'baseline'
        self.starting=None
        if request.get('starting') is not None:self.starting=set(string_list(request['starting'],'可用起始材料',PLAYABLE))
        try:self.max_steps=int(request.get('maxSteps',3))
        except (ValueError,TypeError):raise ValueError('最大合体次数须为整数。')
        if not 1<=self.max_steps<=6:raise ValueError('最大合体次数可设置为 1–6 次。')
        self.reverse=defaultdict(list,{name:list(recipes) for name,recipes in filtered_recipes(self.graph,tuple(sorted(self.allowed)),self.uncertain)})
        self.memo={};self.leaves={};self.roots={};self.done_steps=0;self.complete=False;self.finished=False;self.message='';self.error=''
        self.cancelled=threading.Event();self.started=time.monotonic();self.deadline=self.started+60
        self.work=0;self.alternatives=0;self.rank_cache={}

    def tick(self):
        self.work+=1
        if self.work%128==0:
            if self.cancelled.is_set():raise SearchStopped('已取消')
            if time.monotonic()>self.deadline:raise SearchStopped('已达到本轮 60 秒预算；只对已完成的次数范围给出完整比较。可缩小次数或减少技能。')
            if len(self.memo)>220000 or self.alternatives>1200000:raise SearchStopped('本轮搜索达到内存保护阈值；可减少最大次数或限定起始材料。')

    def solve(self,name,steps,need,ban):
        self.tick()
        if self.native[name]&ban:return ZERO
        need &= ~self.native[name]
        if steps==0:
            if need or name==self.target or (self.starting is not None and name not in self.starting):return ZERO
            if name not in self.leaves:self.leaves[name]=Node(self,name,0,leaf=True)
            return self.leaves[name]
        key=(name,steps,need,ban)
        if key in self.memo:return self.memo[key]
        alts=[]
        for ingredients in self.reverse[name]:
            for sizes in budgets(steps-1,len(ingredients)):
                for children in self.assign(ingredients,sizes,need,ban):
                    alts.append(children);self.alternatives+=1;self.tick()
        result=Node(self,name,steps,alts) if alts else ZERO
        self.memo[key]=result;return result

    def assign(self,names,sizes,need,ban):
        """Give a skill to its first covering branch, making alternatives disjoint.
        Ban means that branch's complete available-skill mask must lack a bit.
        This avoids counting the same material tree once per skill assignment.
        """
        self.tick();name,size=names[0],sizes[0]
        if len(names)==1:
            child=self.solve(name,size,need,ban)
            if child:yield (child,)
            return
        if size==0:
            chosen=self.native[name]&need
            choices=(chosen,)
        else:
            possible_else=0
            for n,k in zip(names[1:],sizes[1:]):possible_else|=self.native[n] if k==0 else self.full
            must=need&~possible_else
            fixed=self.native[name]&need
            required=must|fixed;optional=need&~required
            options=[];subset=optional
            while True:
                options.append(required|subset)
                if subset==0:break
                subset=(subset-1)&optional
            choices=options
        for chosen in choices:
            child=self.solve(name,size,chosen,ban|(need&~chosen))
            if not child:continue
            for rest in self.assign(names[1:],sizes[1:],need&~chosen,ban):yield (child,)+rest

    def run(self):
        try:
            for k in range(1,self.max_steps+1):
                root=self.solve(self.target,k,self.full,0)
                if root:self.roots[k]=root
                self.done_steps=k
            self.complete=True;self.message='所设次数范围内已全部比较。'
        except SearchStopped as e:self.message=str(e)
        except Exception as e:self.error=f'搜索失败：{type(e).__name__}: {e}'
        finally:self.finished=True

    def names(self,mask):return [s for i,s in enumerate(self.skills) if mask&(1<<i)]
    def materialize(self,tree):
        materials=[];steps=[]
        def visit(t,root=False):
            if not t.children:
                mid='m'+str(len(materials)+1);learn=self.names(t.mask)
                materials.append(dict(id=mid,name=t.name,learn=learn,level=max([PLAYABLE[t.name]['lvl']]+[int(PLAYABLE[t.name]['skills'][s]) for s in learn]),price=self.prices[t.name],unlock=UNLOCKS.get(t.name,PREREQS.get(t.name,''))))
                return mid
            ids=[visit(c) for c in t.children];inherited=0
            for c in t.children:inherited|=c.mask
            learn=self.names(t.mask&~inherited)+(self.unique if root else [])
            sid='s'+str(len(steps)+1);ins=[c.name for c in t.children]
            steps.append(dict(id=sid,number=len(steps)+1,result=t.name,ingredients=ins,materialIds=ids,inherit=self.names(inherited),learn=learn,keep=self.names(t.mask)+(self.unique if root else []),level=max([PLAYABLE[t.name]['lvl']]+[int(PLAYABLE[t.name]['skills'][s]) for s in learn]),special=t.name in SPECIAL,unlock=UNLOCKS.get(t.name,''),reason=self.graph.reason(t.name,ins)))
            return sid
        final=visit(tree,True)
        names={m['name'] for m in materials}|{s['result'] for s in steps}
        route=dict(found=True,target=self.target,skills=self.selected,materials=materials,steps=steps,finalId=final,conditions={n:UNLOCKS.get(n,PREREQS.get(n,'')) for n in names if UNLOCKS.get(n,PREREQS.get(n,''))},totalCost=tree.cost,stepCount=tree.steps,version=VERSION,priceMode=self.price_mode)
        validate_route(route,self.graph,self.selected,self.sources,self.level,self.slots,self.excluded,self.uncertain)
        if len(steps)!=tree.steps or sum(m['price'] for m in materials)!=tree.cost:raise ValueError('路线计数或费用校验失败。')
        route['validated']=True;return annotate_skill_sources(route)

    def ranked(self,order,index):
        # New completed bounds invalidate the root merge, not node k-best caches.
        signature=(order,self.done_steps)
        if signature not in self.rank_cache:
            heap=[]
            for k,node in self.roots.items():
                heap.append(((k,node.cost) if order=='steps' else (node.cost,k),k,0))
            heapq.heapify(heap);self.rank_cache[signature]=(heap,[])
        heap,items=self.rank_cache[signature]
        while len(items)<=index and heap:
            _,k,rank=heapq.heappop(heap);node=self.roots[k];tree=node.kth(rank);items.append(tree)
            if rank+1<node.count:
                nxt=node.kth(rank+1);key=(k,nxt.cost) if order=='steps' else (nxt.cost,k)
                heapq.heappush(heap,(key,k,rank+1))
        return items[index] if index<len(items) else None

    def snapshot(self,offset=0,limit=10,order='steps'):
        bound=self.done_steps;roots={k:n for k,n in self.roots.items() if k<=bound}
        total=sum(n.count for n in roots.values());minimum_steps=min(roots,default=None);minimum_cost=min((n.cost for n in roots.values()),default=None)
        # During computation, only expose completed bounds. A root is published
        # before done_steps, so take a completed-bound snapshot for consistency.
        self.visible_roots=roots
        results=[]
        if total and self.finished:
            for i in range(offset,min(offset+limit,total)):
                tree=self.ranked(order,i)
                if tree:
                    r=self.materialize(tree);r['shortest']=tree.steps==minimum_steps;r['cheapest']=tree.cost==minimum_cost;results.append(r)
        return dict(jobId=getattr(self,'id',''),complete=self.complete,finished=self.finished,message=self.message,error=self.error,requestedMaxSteps=self.max_steps,completedMaxSteps=bound,total=str(total),offset=str(offset),nextOffset=str(offset+len(results)) if offset+len(results)<total else None,order=order,routes=results,minimumSteps=minimum_steps,minimumCost=minimum_cost,seconds=round(time.monotonic()-self.started,2),states=len(self.memo),priceMode=self.price_mode,version=VERSION)

MAX_ACTIVE_JOBS=4
MAX_RETAINED_JOBS=5
JOB_RETENTION_SECONDS=1800
JOBS={};JOB_LOCK=threading.Lock();COMPUTE_LOCK=threading.Lock()
# A permit covers construction, waiting, running and cancellation cleanup.
# Removing a registry entry must never make a still-live worker unaccounted for.
JOB_SLOTS=threading.BoundedSemaphore(MAX_ACTIVE_JOBS)
def start_routes(request):
    slots=JOB_SLOTS
    compute_lock=COMPUTE_LOCK
    if not slots.acquire(blocking=False):raise SearchBusy('计算队列已满，请稍后重试。')
    registered_id=None
    try:
        previous=request.get('previousJob')
        if previous is not None and (not isinstance(previous,str) or not 1<=len(previous)<=80):
            raise ValueError('上次任务编号不合法。')
        job=RouteSearch(request);job.id=uuid.uuid4().hex
        with JOB_LOCK:
            now=time.monotonic()
            for key,saved in list(JOBS.items()):
                if saved.finished and now-saved.started>JOB_RETENTION_SECONDS:del JOBS[key]
            while len(JOBS)>=MAX_RETAINED_JOBS:
                key=next((key for key,saved in JOBS.items() if saved.finished),None)
                if key is None:raise SearchBusy('计算队列已满，请稍后重试。')
                del JOBS[key]
            JOBS[job.id]=job
            registered_id=job.id
        def work():
            acquired=False
            try:
                # Cancelled queued requests leave without waiting for the
                # running search to finish or dropping their admission permit.
                while not job.cancelled.is_set():
                    if not compute_lock.acquire(timeout=0.1):continue
                    acquired=True
                    if not job.cancelled.is_set():
                        job.started=time.monotonic();job.deadline=job.started+60;job.run()
                    break
            except Exception:
                logging.exception('Route worker failed')
                job.error='路线计算暂时出错，请重试。'
            finally:
                if acquired:compute_lock.release()
                if job.cancelled.is_set():job.message='已取消'
                job.finished=True
                slots.release()
        threading.Thread(target=work,daemon=True,name='smtvv-route-worker').start()
    except Exception:
        if registered_id is not None:
            with JOB_LOCK:JOBS.pop(registered_id,None)
        slots.release()
        raise
    # The running worker now owns the permit. Keep all post-start work out of
    # the startup-failure handler so it cannot release the permit twice.
    # Only an explicitly supplied, unguessable previous job ID may cancel
    # an earlier request; capacity management never cancels another job.
    with JOB_LOCK:
        old=JOBS.get(previous)
        if old:old.cancelled.set()
    return {'jobId':job.id}

def get_routes(request):
    with JOB_LOCK:job=JOBS.get(request.get('jobId'))
    if not job:raise ValueError('搜索已过期，请重新计算。')
    try:offset=int(request.get('offset',0));limit=int(request.get('limit',10))
    except (ValueError,TypeError):raise ValueError('分页参数无效。')
    if offset<0 or not 1<=limit<=20:raise ValueError('分页参数超出范围。')
    order=request.get('order','steps')
    if order not in ('steps','cost'):raise ValueError('排序方式无效。')
    cached=job.rank_cache.get((order,job.done_steps))
    if offset>(len(cached[1]) if cached else 0):raise ValueError('请从第一页开始顺序翻页，避免一次展开过多路线。')
    return job.snapshot(offset,limit,order)

def cancel_routes(request):
    with JOB_LOCK:
        job=JOBS.get(request.get('jobId'))
        if job:job.cancelled.set()
    return {'cancelled':True}
