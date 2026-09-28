"""Protect existing credentials when running the deployment entrypoint again."""
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from scripts import deploy


class DeployTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.root_patch = patch.object(deploy, 'ROOT', self.root)
        self.root_patch.start()
        self.addCleanup(self.temp.cleanup)
        self.addCleanup(self.root_patch.stop)

    def prepare(self):
        with patch('scripts.configure.new_password', return_value=('test-password', 'test-digest')):
            deploy.prepare('https://planner.example.com')

    def snapshot(self):
        return {str(p.relative_to(self.root)): p.read_bytes()
                for p in self.root.rglob('*') if p.is_file()}

    def test_repeat_preserves_accounts_and_secrets(self):
        self.prepare()
        before = self.snapshot()
        self.prepare()
        self.assertEqual(self.snapshot(), before)

    def test_different_domain_does_not_change_state(self):
        self.prepare()
        before = self.snapshot()
        with self.assertRaises(ValueError):
            deploy.prepare('https://other.example.com')
        self.assertEqual(self.snapshot(), before)

    def test_partial_runtime_is_not_reinitialized(self):
        runtime = self.root / 'runtime'
        runtime.mkdir()
        (runtime / 'deployment.json').write_text(json.dumps({'public_url': 'https://planner.example.com'}))
        before = self.snapshot()
        with self.assertRaises(ValueError):
            self.prepare()
        self.assertEqual(self.snapshot(), before)

    def test_missing_env_can_be_recovered_without_rotating_keys(self):
        self.prepare()
        before = self.snapshot()
        (self.root / '.env').unlink()
        self.prepare()
        self.assertEqual(self.snapshot(), before)
