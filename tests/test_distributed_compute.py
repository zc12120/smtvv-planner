import concurrent.futures
import hashlib
import http.client
import json
import multiprocessing
import os
import socket
from pathlib import Path
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

from compute_protocol import normalize, computed_objectives
from compute_queue import Coordinator, ComputeError
from compute_worker import run_task
from routes import SearchBusy
import server


class QueueTests(unittest.TestCase):
    def setUp(self):
        self.temporary=tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.path=Path(self.temporary.name)/'queue.sqlite3'
        self.now=[1000.0]
        self.workers={name:{'slots':2,'tokenSha256':hashlib.sha256((name+'-secret').encode()).hexdigest()} for name in ('a','b')}
        self.queue=Coordinator(self.path,self.workers,version='test-revision',clock=lambda:self.now[0])
        self.addCleanup(lambda:self.queue.close())

    def call(self, action, worker='a',slot=0,session='session-one', **body):
        return self.queue.worker_call('Bearer '+worker+'-secret',dict(worker=worker,slot=slot,session=session,revision='test-revision',action=action,**body),wait_seconds=0)

    def claim(self, **kw):
        return self.call('claim',**kw)['task']

    def finish(self,task,**kw):
        return self.call('finish',taskId=task['taskId'],lease=task['lease'],result={'complete':True,'computedObjectives':computed_objectives(task['request']['objective']),'solutions':{},'message':'done'},**kw)

    def test_duplicates_share_work_with_independent_cancel_and_cached_capacity_bypass(self):
        self.queue.capacity=1
        first=self.queue.submit({'target':'Angel','skills':['Dia','Agi'],'requestId':'one'})
        second=self.queue.submit({'target':'Angel','skills':['Agi','Dia','Dia'],'requestId':'two'})
        task=self.claim()
        self.assertIsNone(self.claim(slot=1))
        self.queue.cancel(first)
        self.assertFalse(self.call('heartbeat',taskId=task['taskId'],lease=task['lease'])['cancel'])
        self.finish(task)
        self.assertFalse(self.queue.snapshot(first)['complete'])
        self.assertTrue(self.queue.snapshot(second)['complete'])
        self.queue.submit({'target':'Pixie'})
        cached=self.queue.submit({'target':'Angel','skills':['Dia','Agi']})
        self.assertTrue(self.queue.snapshot(cached)['complete'])
        with self.assertRaises(SearchBusy):self.queue.submit({'target':'Slime'})

    def test_four_slots_and_exclusive_leases(self):
        for target in ('Angel','Pixie','Slime','Satan','Yoshitsune'):
            self.queue.submit({'target':target})
        tasks=[self.claim(worker=w,slot=s) for w in ('a','b') for s in (0,1)]
        self.assertEqual(len({task['taskId'] for task in tasks}),4)
        self.assertEqual(self.claim()['taskId'],tasks[0]['taskId'])
        self.assertIsNone(self.claim(session='new-session'))
        wrong=self.call('finish',worker='b',taskId=tasks[0]['taskId'],lease=tasks[0]['lease'])
        self.assertFalse(wrong['accepted'])

    def test_expired_worker_is_reassigned_and_stale_completion_rejected_after_restart(self):
        job=self.queue.submit({'target':'Angel'})
        first=self.claim()
        self.queue.close()
        self.queue=Coordinator(self.path,self.workers,version='test-revision',clock=lambda:self.now[0])
        self.assertEqual(self.queue.snapshot(job)['stage'],'准备数据')
        self.now[0]+=31
        second=self.claim(worker='b')
        self.assertEqual(first['taskId'],second['taskId'])
        self.assertNotEqual(first['lease'],second['lease'])
        self.assertFalse(self.finish(first)['accepted'])
        self.assertTrue(self.finish(second,worker='b')['accepted'])
        self.assertTrue(self.finish(second,worker='b')['accepted'])
        self.assertTrue(self.queue.snapshot(job)['complete'])

    def test_cancel_last_subscriber_invalidates_lease(self):
        job=self.queue.submit({'target':'Angel'})
        task=self.claim()
        self.queue.cancel(job)
        self.assertTrue(self.call('heartbeat',taskId=task['taskId'],lease=task['lease'])['cancel'])
        self.assertFalse(self.finish(task)['accepted'])
        retry=self.queue.submit({'target':'Angel'})
        self.assertFalse(self.queue.snapshot(retry)['finished'])

    def test_auth_revision_validation_and_bad_replacement(self):
        with self.assertRaises(ComputeError):
            self.queue.worker_call('Bearer wrong',dict(worker='a',slot=0))
        with self.assertRaises(ComputeError):
            self.queue.worker_call('Bearer a-secret',dict(worker='a',slot=2))
        with self.assertRaises(ComputeError):
            self.queue.worker_call('Bearer a-secret',dict(worker='a',slot=0,session='x',revision='wrong',action='claim'),wait_seconds=0)
        job=self.queue.submit({'target':'Angel','requestId':'same'})
        with self.assertRaises(ValueError):self.queue.submit({'target':'Pixie','requestId':'same'})
        with self.assertRaises(ValueError):self.queue.submit({'target':'invalid','previousJob':job['jobId']})
        self.assertFalse(self.queue.snapshot(job)['finished'])

    def test_concurrent_identical_submissions_and_claims_only_compute_once(self):
        with concurrent.futures.ThreadPoolExecutor(max_workers=12) as pool:
            jobs=list(pool.map(lambda _:self.queue.submit({'target':'Angel'}),range(20)))
            tasks=list(pool.map(lambda item:self.claim(worker=item[0],slot=item[1]), [('a',0),('a',1),('b',0),('b',1)]))
        self.assertEqual(len({j['jobId'] for j in jobs}),20)
        self.assertEqual(sum(t is not None for t in tasks),1)

    def test_expired_results_and_revision_never_hit_old_cache(self):
        job=self.queue.submit({'target':'Angel'})
        self.finish(self.claim())
        self.now[0]+=86401
        new=self.queue.submit({'target':'Angel'})
        self.assertFalse(self.queue.snapshot(new)['finished'])
        with self.assertRaises(ValueError):self.queue.snapshot(job)

    def test_no_graph_construction_in_request_normalization(self):
        with patch('planner.cached_graph',side_effect=AssertionError('coordinator must not build graphs')):
            self.queue.submit({'target':'Angel'})
        with self.assertRaises(ValueError):normalize({'target':'Angel','sources':{'Dia':[]}})
        with self.assertRaises(ValueError):normalize({'target':'Angel','prices':{'Pixie':True}})

    def test_shared_result_preserves_each_visitors_skill_order(self):
        first=self.queue.submit({'target':'Angel','skills':['Dia','Agi']})
        second=self.queue.submit({'target':'Angel','skills':['Agi','Dia']})
        task=self.claim()
        self.call('finish',taskId=task['taskId'],lease=task['lease'],result={'complete':True,'computedObjectives':['mixed'],'solutions':{'mixed':{'validated':True,'skills':['Agi','Dia']}}})
        self.assertEqual(self.queue.snapshot(first)['solutions']['mixed']['skills'],['Dia','Agi'])
        self.assertEqual(self.queue.snapshot(second)['solutions']['mixed']['skills'],['Agi','Dia'])

    def test_objective_cache_isolation_and_cheapest_byproduct_reuse(self):
        mixed=self.queue.submit({'target':'Angel'})
        self.finish(self.claim())
        cheap=self.queue.submit({'target':'Angel','objective':'cheapest'})
        self.assertFalse(self.queue.snapshot(cheap)['finished'])
        task=self.claim()
        self.assertEqual(task['request']['objective'],'cheapest')
        self.finish(task)
        self.queue.capacity=0
        short=self.queue.submit({'target':'Angel','objective':'shortest'})
        self.assertTrue(self.queue.snapshot(short)['complete'])
        self.assertEqual(self.queue.snapshot(short)['computedObjectives'],['shortest'])
        self.assertEqual(self.queue.snapshot(short)['objective'],'shortest')
        self.assertEqual(self.queue.snapshot(mixed)['computedObjectives'],['mixed'])
        self.assertIsNone(self.claim())
        with self.assertRaises(SearchBusy):self.queue.submit({'target':'Angel','objective':'all'})
        with self.assertRaises(ValueError):self.queue.submit({'target':'Angel','objective':'invalid'})

    def test_completed_legacy_task_remains_readable_after_upgrade(self):
        job=self.queue.submit({'target':'Angel'})
        task=self.claim();self.finish(task)
        # A stored result from the previous version has neither objective field.
        config={k:v for k,v in task['request'].items() if k!='objective'}
        result={'complete':True,'solutions':{'mixed':{'validated':True},'shortest':{'validated':True},'cheapest':{'validated':True}}}
        with self.queue.db:
            self.queue.db.execute('UPDATE tasks SET config=?,result=? WHERE id=?',(json.dumps(config),json.dumps(result),task['taskId']))
            self.queue.db.execute("UPDATE tickets SET presentation='{}' WHERE id=?",(job['jobId'],))
        snapshot=self.queue.snapshot(job)
        self.assertEqual(set(snapshot['solutions']),{'mixed','shortest','cheapest'})
        self.assertEqual(set(snapshot['computedObjectives']),{'mixed','shortest','cheapest'})

    def test_incomplete_objective_cannot_poison_cache(self):
        job=self.queue.submit({'target':'Angel','objective':'cheapest'})
        task=self.claim()
        with self.assertRaises(ComputeError):
            self.call('finish',taskId=task['taskId'],lease=task['lease'],result={'complete':True,'solutions':{},'computedObjectives':['shortest']})
        self.assertFalse(self.queue.snapshot(job)['complete'])


class WorkerTests(unittest.TestCase):
    def test_real_worker_produces_validated_results_without_local_fallback(self):
        class Transport:
            final=None
            def call(self, action, **body):
                if action=='finish':self.final=body
                return {'accepted':True,'cancel':False}
        transport=Transport()
        run_task(transport,dict(taskId='integration',lease='lease',kind='optimal',request=normalize({'target':'Angel','skills':['Agi','Dia']}),timeout=20),threading.Event())
        self.assertNotIn('error',transport.final)
        result=transport.final['result']
        self.assertTrue(result['complete'],result)
        self.assertEqual(set(result['solutions']),{'mixed'})
        self.assertTrue(all(r['validated'] for r in result['solutions'].values()))

    def test_remote_mode_blocks_native_execution(self):
        from optimal import OptimalSearch
        with patch.dict(os.environ,{'SMTVV_COMPUTE_MODE':'remote'}),patch('optimal.subprocess.Popen') as popen:
            with self.assertRaisesRegex(RuntimeError,'禁用'):OptimalSearch({'target':'Angel'}).start_engine('')
            popen.assert_not_called()

    def test_worker_timeout_and_cancel_reap_process_group(self):
        def hang(connection,task,parent_pid):
            os.setsid()
            time.sleep(30)
        class Transport:
            final=None
            def call(self,action,**body):
                if action=='finish':self.final=body
                return {'accepted':True,'cancel':False}
        transport=Transport()
        with patch('compute_worker.child_compute',hang):
            run_task(transport,dict(taskId='timeout',lease='lease',kind='optimal',request={},timeout=.15),threading.Event())
        self.assertIn('超时',transport.final['error'])
        self.assertFalse(multiprocessing.active_children())

    def test_worker_crash_is_reported_without_waiting_for_full_timeout(self):
        def crash(connection,task,parent_pid):
            os.setsid()
            os._exit(2)
        class Transport:
            final=None
            def call(self,action,**body):
                if action=='finish':self.final=body
                return {'accepted':True,'cancel':False}
        transport=Transport();started=time.monotonic()
        with patch('compute_worker.child_compute',crash):
            run_task(transport,dict(taskId='crash',lease='lease',kind='optimal',request={},timeout=30),threading.Event())
        self.assertIn('error',transport.final)
        self.assertLess(time.monotonic()-started,3)


class RemoteHTTPTests(unittest.TestCase):
    def test_http_dispatch_does_not_call_local_planners_and_worker_auth_is_separate(self):
        with tempfile.TemporaryDirectory() as temporary:
            queue=Coordinator(Path(temporary)/'queue.db',{'a':{'slots':2,'tokenSha256':hashlib.sha256(b'secret').hexdigest()}},version='revision')
            self.addCleanup(queue.close)
            with patch('server.COORDINATOR',queue),patch('server.plan',side_effect=AssertionError('local solver')),patch('server.start_optimal',side_effect=AssertionError('local solver')):
                class IPv6Server(server.PlannerHTTPServer):
                    address_family=socket.AF_INET6
                http=IPv6Server(('::1',0),server.Handler)
                thread=threading.Thread(target=http.serve_forever,daemon=True);thread.start()
                try:
                    def post(path,body,headers=None):
                        connection=http_client.HTTPConnection('::1',http.server_port,timeout=5)
                        connection.request('POST',path,json.dumps(body),headers or {'Content-Type':'application/json'})
                        response=connection.getresponse();result=json.load(response);status=response.status;connection.close()
                        return status,result
                    status,job=post('/api/optimal/start',{'target':'Angel'})
                    self.assertEqual(status,200)
                    self.assertFalse(post('/api/optimal/status',job)[1]['finished'])
                    self.assertEqual(post('/api/compute/worker',{})[0],401)
                    body=dict(action='claim',worker='a',slot=0,session='session',revision='revision')
                    status,claimed=post('/api/compute/worker',body,{'Authorization':'Bearer secret','Content-Type':'application/json'})
                    self.assertEqual(status,200)
                    self.assertEqual(claimed['task']['request']['target'],'Angel')
                finally:
                    http.shutdown();http.server_close();thread.join(2)


http_client=http.client
if __name__=='__main__':unittest.main()
