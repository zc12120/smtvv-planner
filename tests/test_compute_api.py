import concurrent.futures
import gzip
import http.client
import json
import socket
import threading
import time
import unittest
from unittest.mock import patch

import optimal
import server


class StartRequestTests(unittest.TestCase):
    def setUp(self):
        self.jobs = patch.dict(optimal.JOBS, {}, clear=True)
        self.jobs.start()
        self.addCleanup(self.jobs.stop)
        self.worker = patch('optimal.WorkerThread')
        self.thread = self.worker.start()
        self.addCleanup(self.worker.stop)
        self.request = {'target': 'Angel', 'skills': ['Dia'], 'requestId': 'lost-start-response'}

    def test_repeated_start_returns_same_job_and_starts_one_worker(self):
        first = optimal.start_optimal(self.request)
        second = optimal.start_optimal(dict(self.request))
        self.assertEqual(first, second)
        self.assertEqual(first['jobId'], self.request['requestId'])
        self.assertEqual(len(optimal.JOBS), 1)
        self.thread.return_value.start.assert_called_once()

    def test_can_cancel_before_receiving_start_response(self):
        optimal.start_optimal(self.request)
        optimal.cancel_optimal({'jobId': self.request['requestId']})
        repeated = optimal.start_optimal(self.request)
        self.assertTrue(optimal.JOBS[repeated['jobId']].cancelled.is_set())
        self.thread.return_value.start.assert_called_once()

    def test_request_id_cannot_return_a_different_configuration(self):
        optimal.start_optimal(self.request)
        with self.assertRaisesRegex(ValueError, '不同配置'):
            optimal.start_optimal({**self.request, 'skills': ['Agi']})
        self.thread.return_value.start.assert_called_once()

    def test_invalid_replacement_does_not_cancel_valid_job(self):
        first = optimal.start_optimal(self.request)
        with self.assertRaises(ValueError):
            optimal.start_optimal({'target': 'not-a-demon', 'previousJob': first['jobId']})
        self.assertFalse(optimal.JOBS[first['jobId']].cancelled.is_set())

    def test_retry_ignores_legacy_depth_limit_consistently(self):
        request = {**self.request, 'maxSteps': 1}
        self.assertEqual(optimal.start_optimal(request), optimal.start_optimal(request))
        self.thread.return_value.start.assert_called_once()

    def test_failed_worker_start_can_be_retried(self):
        self.thread.return_value.start.side_effect = RuntimeError('worker unavailable')
        with self.assertRaises(RuntimeError):
            optimal.start_optimal(self.request)
        self.assertEqual(optimal.JOBS, {})
        self.thread.return_value.start.side_effect = None
        result = optimal.start_optimal(self.request)
        self.assertIn(result['jobId'], optimal.JOBS)

    def test_visitors_cannot_evict_each_others_running_jobs(self):
        for index in range(optimal.MAX_ACTIVE_JOBS):
            optimal.start_optimal({**self.request, 'requestId': f'visitor-{index}', 'prices': {'Pixie': index}})
        first = optimal.JOBS['visitor-0']
        with self.assertRaisesRegex(optimal.SearchBusy, '队列已满'):
            optimal.start_optimal({**self.request, 'requestId': 'over-capacity', 'prices': {'Pixie': 100}})
        self.assertEqual(len(optimal.JOBS), optimal.MAX_ACTIVE_JOBS)
        self.assertTrue(all(not job.cancelled.is_set() for job in optimal.JOBS.values()))
        self.assertIs(optimal.JOBS['visitor-0'], first)
        self.assertEqual(optimal.start_optimal({**self.request, 'requestId': 'visitor-0', 'prices': {'Pixie': 0}}), {'jobId': 'visitor-0'})

    def test_only_completed_jobs_are_evicted_when_retention_is_full(self):
        first = optimal.start_optimal(self.request)
        for index in range(optimal.MAX_RETAINED_JOBS - 1):
            result = optimal.start_optimal({**self.request, 'requestId': f'completed-{index}'})
            optimal.JOBS[result['jobId']].finished = True
        optimal.start_optimal({**self.request, 'requestId': 'new-visitor'})
        self.assertEqual(len(optimal.JOBS), optimal.MAX_RETAINED_JOBS)
        self.assertIn(first['jobId'], optimal.JOBS)
        self.assertNotIn('completed-0', optimal.JOBS)
        self.assertFalse(optimal.JOBS[first['jobId']].cancelled.is_set())

    def test_registry_stays_available_during_graph_construction(self):
        existing = optimal.start_optimal(self.request)
        entered, release = threading.Event(), threading.Event()
        search = optimal.OptimalSearch

        def prepare(request):
            entered.set()
            release.wait(timeout=5)
            return search(request)

        # setUp stubs worker creation; use a real executor thread for preparation.
        self.worker.stop()
        with patch('optimal.OptimalSearch', side_effect=prepare):
            with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
                future = pool.submit(optimal.start_optimal, {**self.request, 'requestId': 'preparing', 'skills': ['Agi']})
                try:
                    self.assertTrue(entered.wait(timeout=2))
                    self.assertTrue(optimal.LOCK.acquire(timeout=0.5), 'registry must not be locked by preparation')
                    optimal.LOCK.release()
                    self.assertEqual(optimal.get_optimal(existing)['jobId'], existing['jobId'])
                    optimal.cancel_optimal(existing)
                    self.assertTrue(optimal.JOBS[existing['jobId']].cancelled.is_set())
                finally:
                    release.set()
                created = future.result(timeout=3)
        job = optimal.JOBS[created['jobId']]
        job.cancel()
        deadline = time.monotonic() + 5
        while not job.finished and time.monotonic() < deadline:
            time.sleep(0.01)
        self.assertTrue(job.finished)


class ComputeHTTPTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.http = server.PlannerHTTPServer(('127.0.0.1', 0), server.Handler)
        cls.thread = threading.Thread(target=cls.http.serve_forever, daemon=True)
        cls.thread.start()
        # WSL can briefly refuse a newly bound loopback port before it is reachable.
        for attempt in range(50):
            try:
                with socket.create_connection(cls.http.server_address, timeout=0.5):
                    break
            except OSError:
                if attempt == 49:
                    cls.http.shutdown()
                    cls.http.server_close()
                    raise
                time.sleep(0.05)

    @classmethod
    def tearDownClass(cls):
        cls.http.shutdown()
        cls.http.server_close()
        cls.thread.join(timeout=3)

    def post(self, path, data):
        connection = http.client.HTTPConnection('127.0.0.1', self.http.server_port, timeout=5)
        try:
            connection.request('POST', '/api/optimal/' + path,
                               json.dumps(data).encode(), {'Content-Type': 'application/json'})
            response = connection.getresponse()
            return response.status, json.load(response)
        finally:
            connection.close()

    def test_unexpected_failure_returns_json_and_service_remains_usable(self):
        with patch('server.start_optimal', side_effect=RuntimeError('unexpected test failure')):
            with self.assertLogs(level='ERROR'):
                status, body = self.post('start', {'target': 'Angel'})
        self.assertEqual(status, 500)
        self.assertIn('重试', body['error'])
        self.assertNotIn('unexpected test failure', body['error'])
        self.assertEqual(self.post('cancel', {'jobId': 'missing'}), (200, {'cancelled': True}))

    def test_validation_failure_remains_a_non_retryable_400(self):
        status, body = self.post('start', {'target': 'not-a-demon'})
        self.assertEqual(status, 400)
        self.assertIn('目标', body['error'])

    def test_full_queue_returns_retryable_json_without_disconnecting(self):
        with patch('server.start_optimal', side_effect=optimal.SearchBusy('计算队列已满，请稍后重试。')):
            status, body = self.post('start', {'target': 'Angel'})
        self.assertEqual(status, 429)
        self.assertIn('队列已满', body['error'])

    def test_public_catalog_head_matches_get_without_a_response_body(self):
        connection = http.client.HTTPConnection('127.0.0.1', self.http.server_port, timeout=5)
        try:
            connection.request('HEAD', '/api/catalog')
            response = connection.getresponse()
            self.assertEqual(response.status, 200)
            self.assertGreater(int(response.getheader('Content-Length')), 0)
            self.assertEqual(response.read(), b'')
            self.assertIn('application/json', response.getheader('Content-Type'))
        finally:
            connection.close()

    def test_slow_response_does_not_block_cancel_requests(self):
        writing = threading.Event()
        release = threading.Event()
        send_json = server.Handler.send_json

        def delayed_response(handler, content, status=200):
            if handler.path == '/api/optimal/start':
                writing.set()
                release.wait(timeout=15)
            return send_json(handler, content, status)

        with patch('server.Handler.send_json', delayed_response), patch('server.start_optimal', return_value={'jobId': 'slow-client'}):
            with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
                future = pool.submit(self.post, 'start', {'target': 'Angel'})
                try:
                    if not writing.wait(timeout=5):
                        if future.done():
                            future.result()
                        self.fail('start response did not reach the slow client')
                    self.assertEqual(self.post('cancel', {'jobId': 'slow-client'}), (200, {'cancelled': True}))
                finally:
                    release.set()
                self.assertEqual(future.result(timeout=3), (200, {'jobId': 'slow-client'}))

    def test_slow_graph_preparation_does_not_block_status_or_cancel(self):
        entered = threading.Event()
        release = threading.Event()

        def prepare(request):
            entered.set()
            release.wait(timeout=8)
            return {'jobId': 'preparing'}

        with patch('server.start_optimal', side_effect=prepare), \
             patch('server.get_optimal', return_value={'stage': 'working'}):
            with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
                future = pool.submit(self.post, 'start', {'target': 'Angel'})
                try:
                    self.assertTrue(entered.wait(timeout=3))
                    self.assertEqual(self.post('status', {'jobId': 'existing'}), (200, {'stage': 'working'}))
                    self.assertEqual(self.post('cancel', {'jobId': 'existing'}), (200, {'cancelled': True}))
                    self.assertFalse(future.done(), 'control requests complete before graph preparation')
                finally:
                    release.set()
                self.assertEqual(future.result(timeout=3)[0], 200)

    def test_catalog_compression_preserves_data_headers_and_head_semantics(self):
        for accept, compressed in [('gzip', True), ('GZip;q=0.5', True),
                                   ('gzip;q=0, *;q=1', False), ('identity', False)]:
            with self.subTest(accept=accept):
                lengths = []
                for method in ('GET', 'HEAD'):
                    connection = http.client.HTTPConnection('127.0.0.1', self.http.server_port, timeout=5)
                    try:
                        connection.request(method, '/api/catalog', headers={'Accept-Encoding': accept})
                        response = connection.getresponse()
                        self.assertEqual(response.status, 200)
                        self.assertEqual(response.getheader('Cache-Control'), 'no-store')
                        self.assertEqual(response.getheader('Vary'), 'Accept-Encoding')
                        self.assertEqual(response.getheader('Content-Encoding'), 'gzip' if compressed else None)
                        lengths.append(int(response.getheader('Content-Length')))
                        body = response.read()
                        if method == 'HEAD':
                            self.assertEqual(body, b'')
                        else:
                            self.assertEqual(len(body), lengths[-1])
                            self.assertEqual(json.loads(gzip.decompress(body) if compressed else body), server.CATALOG)
                            if compressed:
                                self.assertLess(len(body), len(server.CATALOG_JSON) // 3)
                    finally:
                        connection.close()
                self.assertEqual(lengths[0], lengths[1])

    def test_catalog_authorization_precedes_compressed_delivery(self):
        with patch('server.check_access', return_value=server.Access(401)):
            connection = http.client.HTTPConnection('127.0.0.1', self.http.server_port, timeout=5)
            try:
                connection.request('GET', '/api/catalog', headers={'Accept-Encoding': 'gzip'})
                response = connection.getresponse()
                self.assertEqual(response.status, 401)
                self.assertIsNone(response.getheader('Content-Encoding'))
                self.assertEqual(json.load(response)['login'], '/auth/')
            finally:
                connection.close()


if __name__ == '__main__':
    unittest.main()
