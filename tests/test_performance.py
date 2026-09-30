"""Exactness and isolation checks for shared computation work."""
import json
from pathlib import Path
import random
import subprocess
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

from compute_cache import CompletedResults, configuration_key
from native_engine import engine_command
import optimal
from search_graph import context_topology, topology


def relaxation_oracle(native, prices, bits, goal, arcs, by_cost):
    """Independent fixed-point solver: no queue, dominance, or upper bounds."""
    best = [dict() for _ in native]
    for entity, price in enumerate(prices):
        if price >= 0:
            best[entity][native[entity]] = (price, 0) if by_cost else (0, price)
    for _ in range(1000):
        changed = False
        for left, right, result, step in arcs:
            for lm, lw in list(best[left].items()):
                for rm, rw in list(best[right].items()):
                    mask = lm | rm | native[result]
                    weight = (lw[0] + rw[0] + (0 if by_cost else step),
                              lw[1] + rw[1] + (step if by_cost else 0))
                    previous = best[result].get(mask)
                    if previous is None or weight < previous:
                        best[result][mask] = weight
                        changed = True
        if not changed:
            return best[goal].get((1 << bits) - 1)
    raise AssertionError('Small finite oracle did not converge')


class NativeExactnessTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.command = engine_command()

    def compare(self, native, prices, bits, goal, arcs):
        text = '\n'.join([
            f'{len(native)} {len(prices)} {bits} {goal} {len(arcs)}',
            ' '.join(map(str, native)), ' '.join(map(str, prices)),
            *(' '.join(map(str, arc)) for arc in arcs),
        ]) + '\n'
        result = subprocess.run(self.command, input=text, text=True,
                                capture_output=True, check=True, timeout=5)
        solutions = [json.loads(line) for line in result.stdout.splitlines()]
        self.assertEqual([item['objective'] for item in solutions], ['shortest', 'cheapest'])
        for payload, by_cost in zip(solutions, (False, True)):
            expected = relaxation_oracle(native, prices, bits, goal, arcs, by_cost)
            self.assertEqual(payload['found'], expected is not None)
            if expected is None:
                continue
            root = payload['nodes'][payload['root']]
            actual = (root['cost'], root['steps']) if by_cost else (root['steps'], root['cost'])
            self.assertEqual(actual, expected, (text, payload['objective']))
            self.assertEqual((root['entity'], root['mask']), (goal, (1 << bits) - 1))
            # Replay the emitted derivation independently, including zero arcs.
            for index, node in enumerate(payload['nodes']):
                children = node['children']
                if not children:
                    self.assertLess(node['entity'], len(prices))
                    self.assertGreaterEqual(prices[node['entity']], 0)
                    self.assertEqual((node['mask'], node['cost'], node['steps']),
                                     (native[node['entity']], prices[node['entity']], 0))
                    continue
                self.assertEqual(len(children), 2)
                self.assertTrue(all(0 <= child < index for child in children), 'no cyclic back pointers')
                left, right = (payload['nodes'][child] for child in children)
                step = node['steps'] - left['steps'] - right['steps']
                self.assertTrue((left['entity'], right['entity'], node['entity'], step) in arcs or
                                (right['entity'], left['entity'], node['entity'], step) in arcs)
                self.assertEqual(node['cost'], left['cost'] + right['cost'])
                self.assertEqual(node['mask'], left['mask'] | right['mask'] | native[node['entity']])

    def test_random_cyclic_graphs_match_independent_fixed_point_oracle(self):
        generator = random.Random(20260916)
        for case in range(80):
            count = generator.randint(3, 7)
            real = generator.randint(2, count)
            bits = generator.randint(0, 3)
            native = [generator.randrange(1 << bits) for _ in range(real)] + [0] * (count - real)
            prices = [generator.choice([-1, 0, 0, 1, 3, 9]) for _ in range(real)]
            arcs = []
            for _ in range(generator.randint(0, 18)):
                left, right = generator.sample(range(count), 2)
                arcs.append((left, right, generator.randrange(count), generator.randrange(2)))
            with self.subTest(case=case):
                self.compare(native, prices, bits, generator.randrange(real), arcs)

    def test_equal_upper_bound_zero_cost_cycles_and_virtual_nodes(self):
        self.compare([1, 2, 0, 0, 0], [0, 0, -1, -1], 2, 3,
                     [(0, 1, 4, 0), (4, 0, 3, 1), (3, 1, 3, 0), (3, 0, 2, 0), (2, 1, 3, 0)])


class TopologyCacheTests(unittest.TestCase):
    def test_reuse_keeps_request_prices_and_masks_separate(self):
        first = optimal.OptimalSearch({'target': 'Angel', 'skills': ['Dia']})
        second = optimal.OptimalSearch({'target': 'Angel', 'skills': ['Agi'], 'prices': {'Pixie': 0}})
        self.assertIs(context_topology(first)[1], context_topology(second)[1])
        self.assertNotEqual(first.native, second.native)
        self.assertNotEqual(first.prices, second.prices)

    def test_mutating_one_reverse_index_does_not_poison_cached_graph(self):
        first = optimal.OptimalSearch({'target': 'Angel'})
        second = optimal.OptimalSearch({'target': 'Angel'})
        before = context_topology(second)[1]
        first.reverse['Angel'].clear()
        self.assertTrue(second.reverse['Angel'])
        self.assertNotEqual(context_topology(first)[1].arcs, before.arcs)
        self.assertIs(context_topology(second)[1], before)
        third = optimal.OptimalSearch({'target': 'Angel'})
        self.assertEqual(third.reverse['Angel'], second.reverse['Angel'])

    def test_constraints_and_essence_leaf_offsets_are_in_the_key(self):
        request = {'target': 'Angel'}
        first = optimal.OptimalSearch(request)
        for override in ({'level': 25}, {'excluded': ['Pixie']}, {'dlc': False}, {'allowUncertain': True}):
            other = optimal.OptimalSearch({**request, **override})
            self.assertIsNot(context_topology(first)[1], context_topology(other)[1])
        names = ('a', 'b', 'c', 'target')
        recipes = (('target', (('a', 'b', 'c'),)),)
        graph = topology(names, recipes, 3)
        self.assertEqual(graph.nodes, 8)
        self.assertEqual(graph.arcs, ((0, 1, 7, 0), (7, 2, 3, 1)))
        self.assertNotEqual(graph.arcs, topology(names, recipes).arcs)


class CompletedResultsTests(unittest.TestCase):
    def test_values_are_independent_lru_eviction_and_ttl(self):
        cache = CompletedResults(max_entries=2, ttl=10)
        with patch('compute_cache.time.monotonic', return_value=100):
            original = {'steps': [1]}
            cache.put('a', original)
            original['steps'].append(2)
            cache.put('b', {})
            restored = cache.get('a')
            restored['steps'].append(3)
            self.assertEqual(cache.get('a'), {'steps': [1]})
            cache.put('c', {})
            self.assertIsNone(cache.get('b'))
        with patch('compute_cache.time.monotonic', return_value=111):
            self.assertIsNone(cache.get('a'))
            self.assertIsNone(cache.get('c'))
        self.assertEqual(cache.bytes, 0)

    def test_byte_bound_and_oversized_results(self):
        cache = CompletedResults(max_bytes=20)
        cache.put('a', {'a': '1234567890'})
        cache.put('b', {'b': '1234567890'})
        self.assertIsNone(cache.get('a'))
        self.assertLessEqual(cache.bytes, 20)
        cache.put('large', {'x': 'x' * 100})
        self.assertIsNone(cache.get('large'))
        self.assertIsNotNone(cache.get('b'))
        cache.clear()
        self.assertEqual(cache.bytes, 0)
        self.assertIsNone(cache.get(None))

    def test_keys_include_rules_engine_and_every_computation_constraint(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / 'native').mkdir()
            source = root / 'native/optimal.cpp'
            source.write_text('version one')
            request = {'target': 'Angel', 'skills': ['Dia']}
            key = configuration_key(request, root, 'rules-one')
            self.assertIsNotNone(key)
            self.assertEqual(key, configuration_key({**request, 'requestId': 'new', 'previousJob': 'old', 'maxSteps': 1}, root, 'rules-one'))
            for override in ({'skills': ['Agi']}, {'prices': {'Pixie': 0}}, {'sources': {'Dia': 'Pixie'}},
                             {'starting': []}, {'level': 40}, {'slots': 4}, {'dlc': False},
                             {'excluded': ['Pixie']}, {'locked': ['Alice']}, {'allowUncertain': True}):
                self.assertNotEqual(key, configuration_key({**request, **override}, root, 'rules-one'))
            self.assertNotEqual(key, configuration_key(request, root, 'rules-two'))
            source.write_text('version two')
            self.assertNotEqual(key, configuration_key(request, root, 'rules-one'))
            source.unlink()
            self.assertIsNone(configuration_key(request, root, 'rules-one'))
            (root / 'native/optimal-linux').write_bytes(b'prebuilt')
            self.assertIsNotNone(configuration_key(request, root, 'rules-one'))


class CachedJobTests(unittest.TestCase):
    def setUp(self):
        self.workers = []
        original_thread = threading.Thread

        def thread(*args, **kwargs):
            worker = original_thread(*args, **kwargs)
            self.workers.append(worker)
            return worker

        for item in (patch.dict(optimal.JOBS, {}, clear=True),
                     patch.object(optimal, 'RESULTS', CompletedResults()),
                     patch.object(optimal, 'COMPUTE_LOCK', threading.Lock()),
                     patch('optimal.WorkerThread', side_effect=thread)):
            item.start()
            self.addCleanup(item.stop)
        self.addCleanup(self.join_workers)

    def join_workers(self):
        for job in optimal.JOBS.values():
            job.cancel()
        for worker in self.workers:
            worker.join(timeout=5)

    def run_job(self, request):
        result = optimal.start_optimal(request)
        self.workers[-1].join(timeout=5)
        job = optimal.JOBS[result['jobId']]
        self.assertTrue(job.finished, 'worker must finish or restore the cached result')
        return job

    def test_identical_completed_request_restores_validated_independent_results_without_waiting(self):
        request = {'target': 'Angel', 'skills': ['Dia']}
        with patch.object(optimal.OptimalSearch, 'run', autospec=True, side_effect=optimal.OptimalSearch.run) as compute:
            first = self.run_job(request)
            self.assertTrue(first.complete, first.error)
            expected = json.loads(json.dumps(first.solutions))
            self.assertTrue(all(route['validated'] for route in expected.values()))
            first.solutions.clear()
            optimal.COMPUTE_LOCK.acquire()
            try:
                second = self.run_job({**request, 'maxSteps': 1, 'previousJob': first.id})
            finally:
                optimal.COMPUTE_LOCK.release()
            self.assertTrue(second.cache_hit)
            self.assertNotEqual(first.id, second.id)
            self.assertEqual(second.solutions, expected)
            self.assertEqual(compute.call_count, 1)
            third = self.run_job({**request, 'starting': []})
            self.assertTrue(third.complete)
            self.assertEqual(third.solutions, {})
            self.assertEqual(compute.call_count, 2)

    def test_cheapest_byproduct_restores_shortest_but_not_mixed(self):
        request = {'target':'Angel','skills':['Dia'],'objective':'cheapest'}
        first = self.run_job(request)
        self.assertTrue(first.complete,first.error)
        with patch.object(optimal.OptimalSearch,'run',side_effect=AssertionError('cached shortest must not run')):
            shortest = self.run_job({**request,'objective':'shortest'})
        self.assertTrue(shortest.cache_hit)
        self.assertEqual(shortest.computed_objectives,['shortest'])
        self.assertEqual(shortest.solutions,{'shortest':first.solutions['shortest']})
        mixed = self.run_job({**request,'objective':'mixed'})
        self.assertFalse(getattr(mixed,'cache_hit',False))
        self.assertEqual(set(mixed.solutions),{'mixed'})

    def test_errors_and_cancelled_jobs_never_enter_completed_cache(self):
        request = {'target': 'Angel', 'skills': ['Dia']}

        def fail(job):
            job.error = 'test failure'
            job.finished = True

        with patch.object(optimal.OptimalSearch, 'run', autospec=True, side_effect=fail) as compute:
            self.run_job(request)
            self.run_job(request)
            self.assertEqual(compute.call_count, 2)
            self.assertEqual(optimal.RESULTS.bytes, 0)
        optimal.COMPUTE_LOCK.acquire()
        try:
            result = optimal.start_optimal(request)
            optimal.cancel_optimal(result)
            self.workers[-1].join(timeout=2)
            job = optimal.JOBS[result['jobId']]
            self.assertTrue(job.finished)
            self.assertFalse(job.complete)
            self.assertEqual(optimal.RESULTS.bytes, 0)
        finally:
            optimal.COMPUTE_LOCK.release()

    def test_engine_change_during_computation_does_not_publish_under_the_old_key(self):
        revision = ['before']
        compute = optimal.OptimalSearch.run

        def changing_engine(job):
            compute(job)
            revision[0] = 'after'

        with patch('optimal.configuration_key', side_effect=lambda *args: revision[0]), \
             patch.object(optimal.OptimalSearch, 'run', autospec=True, side_effect=changing_engine):
            job = self.run_job({'target': 'Angel', 'skills': ['Dia']})
        self.assertTrue(job.complete, job.error)
        self.assertEqual(optimal.RESULTS.bytes, 0)

    def test_a_queued_job_rechecks_engine_revision_before_restoring_results(self):
        checked = threading.Event()
        revision = ['before']

        def key(*args):
            checked.set()
            return revision[0]

        optimal.COMPUTE_LOCK.acquire()
        with patch('optimal.configuration_key', side_effect=key), patch.object(optimal.OptimalSearch, 'run') as compute:
            try:
                result = optimal.start_optimal({'target': 'Angel', 'skills': ['Dia']})
                self.assertTrue(checked.wait(timeout=2))
                revision[0] = 'after'
                optimal.RESULTS.put('after', {'solutions': {}, 'computedObjectives':['mixed'], 'message': 'current revision'})
            finally:
                optimal.COMPUTE_LOCK.release()
            self.workers[-1].join(timeout=3)
            job = optimal.JOBS[result['jobId']]
            self.assertTrue(job.finished)
            self.assertTrue(job.cache_hit)
            self.assertEqual(job.message, 'current revision')
            compute.assert_not_called()


if __name__ == '__main__':
    unittest.main()
