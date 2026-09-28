import concurrent.futures
import hashlib
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch

from native_engine import engine_command


@unittest.skipUnless(os.name == 'posix' and shutil.which('g++'), 'requires local g++')
class EngineBuildTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        (self.root / 'native').mkdir()
        self.source = self.root / 'native/optimal.cpp'
        self.source.write_text('int main() { return 0; }')

    def test_source_change_rebuilds_even_when_timestamp_is_unchanged(self):
        first = engine_command(self.root)
        self.assertEqual(subprocess.run(first).returncode, 0)
        timestamp = self.source.stat().st_mtime_ns
        self.source.write_text('int main() { return 7; }')
        os.utime(self.source, ns=(timestamp, timestamp))
        second = engine_command(self.root)
        self.assertEqual(first, second)
        self.assertEqual(subprocess.run(second).returncode, 7)
        stamp = self.root / 'native/optimal-linux.sha256'
        self.assertEqual(stamp.read_text().strip(), hashlib.sha256(self.source.read_bytes()).hexdigest())

    def test_failed_rebuild_keeps_the_last_working_binary(self):
        command = engine_command(self.root)
        old = Path(command[0]).read_bytes()
        self.source.write_text('this is not C++')
        with self.assertRaisesRegex(RuntimeError, '编译失败'):
            engine_command(self.root)
        self.assertEqual(Path(command[0]).read_bytes(), old)
        self.assertEqual(subprocess.run(command).returncode, 0)
        self.assertEqual(list((self.root / 'native').glob('.optimal-*')), [])

    def test_concurrent_requests_publish_one_complete_build(self):
        with patch('native_engine.subprocess.run', wraps=subprocess.run) as compile_run:
            with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
                commands = list(pool.map(lambda _: engine_command(self.root), range(4)))
            self.assertEqual(compile_run.call_count, 1)
        self.assertTrue(all(command == commands[0] for command in commands))
        self.assertEqual(subprocess.run(commands[0]).returncode, 0)

    def test_source_free_distribution_uses_prebuilt_engine(self):
        command = engine_command(self.root)
        self.source.unlink()
        with patch('native_engine.subprocess.run') as compiler:
            self.assertEqual(engine_command(self.root), command)
        compiler.assert_not_called()


class NativeInputTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.command = engine_command()

    def test_malformed_inputs_are_rejected_before_indexing_or_allocating(self):
        cases = [
            '1 2 0 0 0\n0\n0 0\n',       # real entities exceed nodes
            '1 -1 0 0 0\n',              # negative allocation size
            '1 1 1 0 0\n-1\n0\n',       # negative mask
            '1 1 1 0 0\n2\n0\n',        # mask exceeds bit width
            '1 1 0 0 0\n0\n-2\n',       # unsupported price sentinel
            '1 1 0 0 0\n0\n1152921504606846976\n',
            '2 2 0 0 1\n0 0\n0 0\n0',  # incomplete arc
            '2 2 0 0 1\n0 0\n0 0\n0 1 2 1\n',
        ]
        for content in cases:
            with self.subTest(content=content):
                result = subprocess.run(self.command, input=content, capture_output=True, text=True, timeout=3)
                self.assertEqual(result.returncode, 2)
                self.assertEqual(result.stdout, '')


if __name__ == '__main__':
    unittest.main()
