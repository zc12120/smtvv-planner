"""Regressions from the 2026-09-12 review: settings and cancellation races."""
import subprocess
import sys
import threading
import unittest
from unittest.mock import patch

import optimal
from planner import settings


class SettingsValidationTests(unittest.TestCase):
    def test_levels_and_slots_reject_fractional_boolean_and_string_values(self):
        for field in ('level', 'slots'):
            for value in (1.9, True, '2', None, [], {}):
                with self.subTest(field=field, value=value), self.assertRaises(ValueError):
                    settings({field: value})

    def test_uncertain_recipes_require_an_explicit_boolean(self):
        for value in ('false', 'true', 1, None, [], {}):
            with self.subTest(value=value), self.assertRaises(ValueError):
                settings({'allowUncertain': value})
        self.assertFalse(settings({'allowUncertain': False})[-1])
        self.assertTrue(settings({'allowUncertain': True})[-1])


class CancellationTests(unittest.TestCase):
    def test_cancelled_queued_job_exits_while_another_job_owns_the_engine(self):
        thread_class = threading.Thread
        workers = []

        def worker(*args, **kwargs):
            thread = thread_class(*args, **kwargs)
            workers.append(thread)
            return thread

        with patch.dict(optimal.JOBS, {}, clear=True), patch('optimal.threading.Thread', side_effect=worker):
            optimal.COMPUTE_LOCK.acquire()
            try:
                result = optimal.start_optimal({'target': 'Angel', 'skills': ['Dia']})
                job = optimal.JOBS[result['jobId']]
                optimal.cancel_optimal(result)
                workers[0].join(timeout=2)
                self.assertFalse(workers[0].is_alive(), 'cancel must not wait behind another computation')
                self.assertTrue(job.finished)
                self.assertFalse(job.complete)
                self.assertIsNone(job.process)
            finally:
                optimal.COMPUTE_LOCK.release()
                for thread in workers:
                    thread.join(timeout=3)

    def test_cancel_during_process_creation_terminates_the_new_process(self):
        job = optimal.OptimalSearch({'target': 'Angel', 'skills': ['Dia']})
        spawning = threading.Event()
        release = threading.Event()
        popen = subprocess.Popen

        def delayed_spawn(*args, **kwargs):
            spawning.set()
            if not release.wait(timeout=5):
                raise RuntimeError('test did not release process creation')
            return popen([sys.executable, '-c', 'import time; time.sleep(30)'], **kwargs)

        worker = threading.Thread(target=job.run, daemon=True)
        with patch('optimal.subprocess.Popen', side_effect=delayed_spawn):
            try:
                worker.start()
                self.assertTrue(spawning.wait(timeout=5))
                job.cancel()
                release.set()
                worker.join(timeout=3)
                self.assertFalse(worker.is_alive(), 'a cancelled start must not leave an engine running')
                self.assertTrue(job.finished)
                self.assertFalse(job.complete)
                self.assertEqual(job.error, '')
                self.assertIsNotNone(job.process.poll())
            finally:
                release.set()
                job.cancel()
                worker.join(timeout=5)


if __name__ == '__main__':
    unittest.main()
