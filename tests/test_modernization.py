"""Cross-entry validation, shared local tasks, and slow-verifier isolation."""
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch

from configuration import parse_config
from compute_cache import CompletedResults
import optimal
from management import ManagementError
from turnstile import TurnstileConfig


class ConfigurationTests(unittest.TestCase):
    def test_all_search_entries_share_validation_and_canonical_defaults(self):
        for kind in ('plan', 'routes', 'optimal'):
            with self.subTest(kind=kind):
                first = parse_config({'target':'Angel','skills':['Dia','Agi','Dia']},kind)
                second = parse_config({'target':'Angel','skills':['Agi','Dia'],'slots':8,'level':150},kind)
                self.assertEqual(first, second)
                for extra in ({'level':True},{'sources':{'Dia':'Slime'}},{'slots':1},{'prices':{'Pixie':-1}}):
                    with self.assertRaises(ValueError):
                        parse_config({'target':'Angel','skills':['Dia','Agi'],**extra},kind)

    def test_importing_http_module_does_not_initialize_private_runtime(self):
        with tempfile.TemporaryDirectory() as directory:
            env = {**os.environ,'SMTVV_COMPUTE_MODE':'remote','SMTVV_STATE_DIR':directory+'/absent',
                   'SMTVV_WORKERS_FILE':directory+'/missing.json','SMTVV_AUTH_PORTAL':'/auth/',
                   'SMTVV_PUBLIC_URL':'invalid'}
            result = subprocess.run([sys.executable,'-c','import server; assert server._DEFAULT_SERVICES is None'],
                                    cwd=Path(__file__).resolve().parents[1],env=env,capture_output=True,text=True)
            self.assertEqual(result.returncode,0,result.stderr)
            self.assertFalse(Path(directory,'absent').exists())


class LocalSharingTests(unittest.TestCase):
    def test_duplicate_subscribers_share_work_and_cancel_independently(self):
        entered, release = threading.Event(), threading.Event()
        original = optimal.OptimalSearch.run
        def slow(search):
            entered.set()
            if not release.wait(5):raise TimeoutError('fixture stalled')
            original(search)
        with patch.dict(optimal.JOBS,{},clear=True),patch.object(optimal,'RESULTS',CompletedResults()), \
             patch.object(optimal.OptimalSearch,'run',autospec=True,side_effect=slow) as compute:
            first = optimal.start_optimal({'target':'Angel','skills':['Dia','Agi'],'requestId':'first'})
            try:
                self.assertTrue(entered.wait(3))
                second = optimal.start_optimal({'target':'Angel','skills':['Agi','Dia'],'requestId':'second'})
                optimal.cancel_optimal(first)
                self.assertFalse(optimal.JOBS[second['jobId']].task.cancelled.is_set())
                release.set()
                import time
                deadline=time.monotonic()+5
                while not optimal.JOBS[second['jobId']].finished and time.monotonic()<deadline:time.sleep(.01)
                self.assertFalse(optimal.get_optimal(first)['complete'])
                result=optimal.get_optimal(second)
                self.assertTrue(result['complete'],result)
                self.assertEqual(result['solutions']['mixed']['skills'],['Agi','Dia'])
                self.assertEqual(compute.call_count,1)
                self.assertIsNone(optimal.JOBS[second['jobId']].task.search)
            finally:
                release.set()
                for job in optimal.JOBS.values():job.cancel()

    def test_cached_result_does_not_construct_graph_or_need_capacity(self):
        request={'target':'Angel','skills':['Dia']}
        key=optimal.configuration_key(request,optimal.ROOT,optimal.VERSION)
        cache=CompletedResults();cache.put(key,dict(solutions={},computedObjectives=['mixed'],message='cached'))
        with patch.dict(optimal.JOBS,{},clear=True),patch.object(optimal,'RESULTS',cache), \
             patch.object(optimal,'MAX_ACTIVE_JOBS',0),patch.object(optimal,'OptimalSearch',side_effect=AssertionError('graph built')):
            job=optimal.start_optimal(request)
            self.assertTrue(optimal.get_optimal(job)['complete'])
            with self.assertRaises(optimal.SearchBusy):optimal.start_optimal({'target':'Pixie'})


class VerificationIsolationTests(unittest.TestCase):
    def test_slow_verification_does_not_block_snapshot_and_rejects_changed_settings(self):
        entered, release = threading.Event(), threading.Event()
        state={'schema':1,'revision':1,'settings':{'enabled':True,'siteKey':'test-site','theme':'auto','appearance':'interaction-only'},'history':[]}
        with tempfile.TemporaryDirectory() as directory:
            config=TurnstileConfig(directory,'https://planner.example.com')
            def slow(*args):
                entered.set()
                if not release.wait(4):raise TimeoutError('fixture stalled')
            with patch.object(config,'_current',side_effect=lambda:(deepcopy(state),'fixture-secret')), \
                 patch.object(config,'verify',side_effect=slow),ThreadPoolExecutor(max_workers=2) as pool:
                pending=pool.submit(config.challenge,'fixture-token','127.0.0.1')
                try:
                    self.assertTrue(entered.wait(2))
                    snapshot=pool.submit(config.snapshot).result(timeout=.5)
                    self.assertEqual(snapshot['revision'],1)
                    state['revision']=2
                finally:release.set()
                with self.assertRaises(ManagementError) as failure:pending.result(timeout=2)
                self.assertEqual(failure.exception.status,409)
                self.assertEqual(config.tickets,{})


if __name__=='__main__':unittest.main()
