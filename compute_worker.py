"""A single compute slot. Run two supervised instances on each 2-vCPU node."""
import argparse
import ctypes
import http.client
import json
import logging
import multiprocessing
import os
from pathlib import Path
import resource
import signal
import threading
import time
from urllib.parse import urlsplit
import uuid

from compute_protocol import encode, revision


class Transport:
    def __init__(self, config, slot):
        self.config, self.slot = config, slot
        self.session = uuid.uuid4().hex
        url = urlsplit(config['url'])
        if url.scheme != 'https' or not url.hostname or url.username or url.password or url.query or url.fragment:
            raise ValueError('Worker URL must be an HTTPS origin')
        self.host, self.port = url.hostname, url.port or 443
        self.connection = None

    def call(self, action, **payload):
        if self.connection is None:
            self.connection = http.client.HTTPSConnection(self.host, self.port, timeout=8)
        body = encode(dict(worker=self.config['worker'],slot=self.slot,session=self.session,
                           revision=revision(),action=action,**payload)).encode()
        try:
            self.connection.request('POST','/api/compute/worker',body,
                                    {'Authorization':'Bearer '+self.config['token'], 'Content-Type':'application/json'})
            response = self.connection.getresponse()
            data = response.read(10*1024*1024+1)
            if response.status != 200 or len(data)>10*1024*1024:
                # Never log headers, credentials or arbitrary gateway response bodies.
                raise RuntimeError('Coordinator HTTP '+str(response.status))
            return json.loads(data)
        except Exception:
            self.connection.close()
            self.connection = None
            raise


def execute(kind, request, progress):
    from optimal import OptimalSearch
    from planner import plan, inspect_fusion, reverse_recipes
    from routes import RouteSearch
    if kind == 'optimal':
        job = OptimalSearch(request)
        runner = threading.Thread(target=job.run, daemon=True)
        runner.start()
        previous = None
        while runner.is_alive():
            runner.join(.5)
            snapshot = job.snapshot()
            signature = (snapshot['stage'],tuple(snapshot['solutions']))
            if signature != previous and not snapshot['finished']:
                progress({'stage':snapshot['stage'],'result':snapshot})
                previous = signature
        result = job.snapshot()
        if result['error'] or not result['complete']:
            raise ValueError(result['error'] or '计算未能完成，请重试。')
        return result
    if kind in ('plan','fuse','recipes'):
        return {'plan':plan,'fuse':inspect_fusion,'recipes':reverse_recipes}[kind](request)
    if kind in ('routes','routes_page'):
        job = RouteSearch(request if kind=='routes' else request['config'])
        job.run()
        if job.error:
            raise ValueError(job.error)
        if kind == 'routes':
            return {order:job.snapshot(0,20,order) for order in ('steps','cost')}
        # Compatibility endpoint: recompute bounded pages off-host, then cache
        # them centrally. The current UI only uses optimal computations.
        return job.snapshot(request['offset'],request['limit'],request['order'])
    raise ValueError('未知的计算类型。')


def child_compute(connection, task, parent_pid=None):
    os.setsid()
    # Reap a task even if its supervising slot is SIGKILLed or OOM-killed.
    if ctypes.CDLL(None,use_errno=True).prctl(1,signal.SIGKILL,0,0,0)!=0:
        raise OSError('Unable to set parent-death signal')
    if parent_pid is not None and os.getppid()!=parent_pid:
        os._exit(1)
    resource.setrlimit(resource.RLIMIT_AS,(768*1024*1024,768*1024*1024))
    resource.setrlimit(resource.RLIMIT_CPU,(180,185))
    os.environ['SMTVV_COMPUTE_MODE'] = 'worker'
    os.environ['SMTVV_ENGINE_LIMITS'] = '1'
    try:
        result = execute(task['kind'],task['request'],lambda value:connection.send(('progress',value)))
        connection.send(('done',{'result':result}))
    except Exception as error:
        message = str(error)[:400] if isinstance(error,ValueError) else '计算进程异常，请减少技能或限制起始材料后重试。'
        connection.send(('done',{'error':message}))
    finally:
        connection.close()


def stop_child(process):
    # The group also contains any native engine, including orphaned descendants.
    try:
        os.killpg(process.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    process.join(timeout=3)
    if process.is_alive():
        process.kill()
        process.join(timeout=3)


def run_task(transport, task, stopping):
    context = multiprocessing.get_context('fork')
    receiver, sender = context.Pipe(duplex=False)
    process = context.Process(target=child_compute,args=(sender,task,os.getpid()))
    process.start()
    sender.close()
    started = last_contact = time.monotonic()
    heartbeat = 0
    progress = {'stage':'准备数据'}
    progress_dirty = False
    final = None
    pipe_open = True
    accepted = False
    lease = {'taskId':task['taskId'],'lease':task['lease']}
    try:
        while not stopping.is_set():
            now = time.monotonic()
            if pipe_open and receiver.poll(.15):
                try:
                    event,value = receiver.recv()
                    if event=='done':
                        final=value
                        if len(encode(final).encode())>8*1024*1024:
                            final={'error':'路线结果过大，请限制起始材料后重试。'}
                    else:
                        progress=value
                        progress_dirty=True
                except EOFError:
                    pipe_open=False
            elif not pipe_open:
                stopping.wait(.15)
            if final is None and now-started >= task['timeout']:
                stop_child(process)
                final={'error':'计算超时，请减少技能或限制起始材料后重试。'}
            if final is None and not process.is_alive() and (not pipe_open or not receiver.poll()):
                final={'error':'计算进程达到资源限制或异常退出，请调整条件后重试。'}
            if final is not None or now-heartbeat>=4:
                try:
                    update=final if final is not None else progress if progress_dirty else {'stage':progress['stage']}
                    reply=transport.call('finish' if final is not None else 'heartbeat',**lease,**update)
                    progress_dirty=False
                    last_contact=time.monotonic()
                    heartbeat=last_contact
                    if reply.get('cancel'):
                        return
                    if final is not None and reply.get('accepted'):
                        accepted=True
                        return
                except (OSError,ValueError,RuntimeError,http.client.HTTPException) as error:
                    logging.warning('Coordinator connection interrupted: %s',type(error).__name__)
                    heartbeat=time.monotonic()
                    if heartbeat-last_contact>=12:
                        return  # Stop before the server may reassign the lease.
                    stopping.wait(1)
    finally:
        stop_child(process)
        receiver.close()
        logging.info('Task %s %s in %.2fs',task['taskId'],'completed' if accepted else 'released',time.monotonic()-started)


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--config',required=True,type=Path)
    parser.add_argument('--slot',required=True,type=int,choices=(0,1))
    args=parser.parse_args()
    config=json.loads(args.config.read_text())
    logging.basicConfig(level=logging.INFO,format='%(asctime)s %(levelname)s %(message)s')
    stopping=threading.Event()
    for sig in (signal.SIGTERM,signal.SIGINT):
        signal.signal(sig,lambda *_:stopping.set())
    # Preload common graph/data pages before forking each isolated task. Warm
    # pages are shared copy-on-write; each task's mutable search state is private.
    from native_engine import engine_command
    from optimal import OptimalSearch
    engine_command()
    OptimalSearch({'target':'Angel'}).problem()
    transport=Transport(config,args.slot)
    logging.info('Compute slot %s/%d ready, revision %s',config['worker'],args.slot,revision()[:12])
    while not stopping.is_set():
        try:
            reply=transport.call('claim')
            if reply.get('task'):
                run_task(transport,reply['task'],stopping)
        except (OSError,ValueError,RuntimeError,http.client.HTTPException) as error:
            logging.warning('Coordinator unavailable: %s',str(error) if isinstance(error,RuntimeError) else type(error).__name__)
            stopping.wait(3)


if __name__=='__main__':
    main()
