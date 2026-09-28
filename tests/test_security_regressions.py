"""Regression cases for routing equivalence and bounded public work admission."""
import base64
import hashlib
import http.client
import json
from pathlib import Path
import queue
import re
import socket
import socketserver
import threading
import time
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from management import Access, ManagementError, normalized_path
import optimal
import routes
import server
from scripts.configure import content_security_policy


class PathDispatchTests(unittest.TestCase):
    def post(self, path):
        client, peer = socket.socketpair()
        client.settimeout(3)
        peer.settimeout(3)
        worker = threading.Thread(target=server.Handler, args=(
            peer, ('127.0.0.1', 0), SimpleNamespace(server_name='localhost', server_port=0)), daemon=True)
        worker.start()
        connection = http.client.HTTPConnection('localhost', timeout=3)
        connection.sock = client
        try:
            connection.request('POST', path, '{}', {'Content-Type': 'application/json', 'Connection': 'close'})
            response = connection.getresponse()
            return response.status, json.loads(response.read())
        finally:
            connection.close()
            worker.join(timeout=3)
            peer.close()
            self.assertFalse(worker.is_alive())

    def test_backslash_aliases_never_reach_calculation_or_turnstile(self):
        with patch.object(server, 'start_optimal') as start, patch.object(server, 'TURNSTILE') as turnstile:
            for path in ('/api/optimal%5cstart', '/api/optimal%5Cstart', '/api/optimal\\start',
                         '/api/login%5cturnstile', '/api/%ffoptimal/start'):
                with self.subTest(path=path):
                    self.assertEqual(self.post(path)[0], 400)
            start.assert_not_called()
            turnstile.challenge.assert_not_called()

    def test_trailing_directory_aliases_cannot_dispatch_exact_api_routes(self):
        with patch.object(server, 'check_access', return_value=Access(204)), \
             patch.dict(server.CATALOG, {'authPortal': ''}), \
             patch.object(server, 'start_optimal') as start:
            for ending in ('/', '//', '/.', '/%2e', '/child/..', '%2f'):
                with self.subTest(ending=ending):
                    self.assertEqual(self.post('/api/optimal/start' + ending)[0], 404)
            start.assert_not_called()

    def test_query_backslashes_do_not_change_canonical_path_dispatch(self):
        with patch.object(server, 'check_access', return_value=Access(204)), \
             patch.dict(server.CATALOG, {'authPortal': ''}), \
             patch.object(server.SITE, 'paused', return_value=False), \
             patch.object(server, 'start_optimal', return_value={'jobId': 'accepted'}) as start:
            status, body = self.post('/api/optimal/start?label=a%5cb')
            self.assertEqual((status, body), (200, {'jobId': 'accepted'}))
            start.assert_called_once()

    def test_normal_slash_and_dot_normalization_matches_gateway_routing(self):
        self.assertEqual(normalized_path('/api//other/../optimal/%73tart'), '/api/optimal/start')
        self.assertEqual(normalized_path('/api/optimal/start/a/..'), '/api/optimal/start/')
        self.assertEqual(normalized_path('/api/optimal/start/.'), '/api/optimal/start/')
        self.assertEqual(normalized_path('/'), '/')
        for path in ('/a\\b', '/a%5cb', '/a%00b', '/a%0db', '/a%0ab', '/%ff'):
            with self.subTest(path=path), self.assertRaises(ManagementError):
                normalized_path(path)

    def test_legacy_saturation_returns_retryable_http_response(self):
        with patch.object(server, 'check_access', return_value=Access(204)), \
             patch.dict(server.CATALOG, {'authPortal': ''}), \
             patch.object(server.SITE, 'paused', return_value=False), \
             patch.object(server, 'start_routes', side_effect=routes.SearchBusy('计算队列已满，请稍后重试。')):
            self.assertIs(routes.SearchBusy, optimal.SearchBusy)
            status, body = self.post('/api/routes/start')
            self.assertEqual(status, 429)
            self.assertIn('队列已满', body['error'])


class LegacyAdmissionTests(unittest.TestCase):
    def setUp(self):
        self.compute = threading.Lock()
        self.compute.acquire()
        self.workers = []
        thread_class = threading.Thread

        def create_thread(*args, **kwargs):
            thread = thread_class(*args, **kwargs)
            self.workers.append(thread)
            return thread

        self.patches = [
            patch.object(routes, 'JOBS', {}), patch.object(routes, 'JOB_LOCK', threading.Lock()),
            patch.object(routes, 'COMPUTE_LOCK', self.compute),
            patch.object(routes, 'JOB_SLOTS', threading.BoundedSemaphore(routes.MAX_ACTIVE_JOBS)),
            patch.object(routes.threading, 'Thread', side_effect=create_thread),
        ]
        for item in self.patches:
            item.start()
        self.request = {'target': 'Angel', 'skills': ['Dia'], 'maxSteps': 1}

    def tearDown(self):
        try:
            with routes.JOB_LOCK:
                for job in routes.JOBS.values():
                    job.cancelled.set()
            # Cancellation must not depend on releasing another job's lock.
            for worker in self.workers:
                if worker.ident is not None:
                    worker.join(timeout=3)
                    self.assertFalse(worker.is_alive(), 'queued worker leaked after cancellation')
            acquired = 0
            while routes.JOB_SLOTS.acquire(blocking=False):
                acquired += 1
            self.assertEqual(acquired, routes.MAX_ACTIVE_JOBS, 'worker admission permit leaked')
        finally:
            if self.compute.locked():
                self.compute.release()
            for item in reversed(self.patches):
                item.stop()

    def test_excess_submissions_do_not_create_workers_or_cancel_existing_jobs(self):
        accepted = [routes.start_routes(self.request)['jobId'] for _ in range(routes.MAX_ACTIVE_JOBS)]
        routes.JOBS[accepted[0]].started -= routes.JOB_RETENTION_SECONDS + 1
        with patch.object(routes, 'RouteSearch') as constructor:
            for _ in range(12):
                with self.assertRaises(routes.SearchBusy):
                    routes.start_routes(self.request)
            constructor.assert_not_called()
        self.assertEqual(set(routes.JOBS), set(accepted))
        self.assertEqual(len(self.workers), routes.MAX_ACTIVE_JOBS)
        self.assertTrue(all(worker.is_alive() for worker in self.workers))
        self.assertTrue(all(not job.cancelled.is_set() for job in routes.JOBS.values()))

    def test_cancelled_queued_worker_exits_promptly_and_its_slot_is_reused(self):
        with patch.object(routes.RouteSearch, 'run') as run:
            accepted = [routes.start_routes(self.request) for _ in range(routes.MAX_ACTIVE_JOBS)]
            routes.cancel_routes(accepted[0])
            self.workers[0].join(timeout=1)
            self.assertFalse(self.workers[0].is_alive())
            self.assertTrue(self.compute.locked())
            self.assertTrue(routes.JOBS[accepted[0]['jobId']].finished)
            replacement = routes.start_routes(self.request)
            self.assertIn(replacement['jobId'], routes.JOBS)
            run.assert_not_called()

    def test_retention_only_evicts_finished_jobs(self):
        active = routes.start_routes(self.request)['jobId']
        for i in range(routes.MAX_RETAINED_JOBS - 1):
            routes.JOBS['finished-' + str(i)] = SimpleNamespace(
                finished=True, started=time.monotonic(), cancelled=threading.Event())
        fresh = routes.start_routes(self.request)['jobId']
        self.assertEqual(len(routes.JOBS), routes.MAX_RETAINED_JOBS)
        self.assertIn(active, routes.JOBS)
        self.assertIn(fresh, routes.JOBS)
        self.assertNotIn('finished-0', routes.JOBS)
        self.assertFalse(routes.JOBS[active].cancelled.is_set())

    def test_failed_validation_releases_slots_and_preserves_previous_job(self):
        first = routes.start_routes(self.request)['jobId']
        for previous in (first, [], 123, ''):
            for _ in range(routes.MAX_ACTIVE_JOBS + 1):
                with self.assertRaises(ValueError):
                    routes.start_routes({'target': 'invalid', 'previousJob': previous})
        self.assertFalse(routes.JOBS[first].cancelled.is_set())
        for _ in range(routes.MAX_ACTIVE_JOBS - 1):
            routes.start_routes(self.request)
        self.assertEqual(len(self.workers), routes.MAX_ACTIVE_JOBS)

    def test_worker_start_failure_removes_registration_and_releases_slot(self):
        def fail_start():
            raise RuntimeError('start failed')

        # Fail construction, and separately fail start on a returned worker.
        for factory in (RuntimeError('thread unavailable'), SimpleNamespace(start=fail_start)):
            for _ in range(routes.MAX_ACTIVE_JOBS + 1):
                kwargs = {'side_effect': factory} if isinstance(factory, Exception) else {'return_value': factory}
                with patch.object(routes.threading, 'Thread', **kwargs), self.assertRaises(RuntimeError):
                    routes.start_routes(self.request)
                self.assertEqual(routes.JOBS, {})
        for _ in range(routes.MAX_ACTIVE_JOBS):
            routes.start_routes(self.request)

    def test_worker_exception_releases_compute_and_admission_locks(self):
        with patch.object(routes.RouteSearch, 'run', side_effect=RuntimeError('worker failure')), \
             self.assertLogs(level='ERROR'):
            accepted = routes.start_routes(self.request)
            self.compute.release()
            self.workers[0].join(timeout=2)
        self.assertFalse(self.workers[0].is_alive())
        self.assertFalse(self.compute.locked())
        self.assertTrue(routes.JOBS[accepted['jobId']].finished)
        self.assertIn('重试', routes.JOBS[accepted['jobId']].error)
        self.compute.acquire()
        for _ in range(routes.MAX_ACTIVE_JOBS):
            routes.start_routes(self.request)


class RequestThreadAdmissionTests(unittest.TestCase):
    def setUp(self):
        completed = queue.Queue()

        class SmallServer(server.PlannerHTTPServer):
            max_request_threads = 2

            def process_request_thread(self, *args):
                try:
                    super().process_request_thread(*args)
                finally:
                    completed.put(True)

        class BlockingHandler(socketserver.BaseRequestHandler):
            def handle(self):
                if self.request.recv(1):
                    self.request.sendall(b'accepted')

        self.http = SmallServer(('127.0.0.1', 0), BlockingHandler)
        self.addCleanup(self.http.server_close)
        self.completed = completed

    def connect(self):
        client, peer = socket.socketpair()
        client.settimeout(3)
        peer.settimeout(3)
        self.addCleanup(client.close)
        self.addCleanup(peer.close)
        self.http.process_request(peer, ('127.0.0.1', 0))
        return client

    def test_excess_handlers_receive_503_and_disconnected_slots_recover(self):
        first, second = self.connect(), self.connect()
        rejected = self.connect()
        response = rejected.recv(4096)
        self.assertIn(b'503 Service Unavailable', response)
        self.assertIn(b'Retry-After: 2', response)
        first.close()
        self.completed.get(timeout=3)
        replacement = self.connect()
        replacement.sendall(b'!')
        self.assertEqual(replacement.recv(4096), b'accepted')
        self.completed.get(timeout=3)
        second.close()
        self.completed.get(timeout=3)

    def test_failed_handler_start_does_not_consume_capacity(self):
        for _ in range(4):
            with patch('socketserver.threading.Thread', side_effect=RuntimeError('thread unavailable')):
                with self.assertRaises(RuntimeError):
                    self.connect()
        clients = [self.connect(), self.connect()]
        for client in clients:
            client.sendall(b'!')
            self.assertEqual(client.recv(4096), b'accepted')
            self.completed.get(timeout=3)


class ShippedScriptPolicyTests(unittest.TestCase):
    def test_policy_allows_shipped_inline_scripts_without_arbitrary_inline_execution(self):
        policy = content_security_policy()
        directives = {part.split()[0]: part.split()[1:] for part in policy.split(';') if part.strip()}
        scripts = directives['script-src']
        self.assertNotIn("'unsafe-inline'", scripts)
        self.assertNotIn("'unsafe-eval'", scripts)
        self.assertEqual(directives['object-src'], ["'none'"])
        root = Path(__file__).resolve().parents[1] / 'web'
        for name in ('index.html', 'demon.html', 'skill.html', 'essence.html', 'admin/index.html', 'auth/index.html'):
            inline = re.findall(r'<script\b(?![^>]*\bsrc\s*=)[^>]*>(.*?)</script>', (root / name).read_text(), re.S | re.I)
            self.assertTrue(inline, name)
            for source in inline:
                digest = base64.b64encode(hashlib.sha256(source.encode()).digest()).decode()
                self.assertIn("'sha256-" + digest + "'", scripts, name)


if __name__ == '__main__':
    unittest.main()
