import contextlib
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError
from accounts import Accounts, replace_private
from management import ManagementError
from scripts import manage_user
from scripts.upgrade_runtime import upgrade
from scripts.configure import configuration, session_cookie_name


class AccountTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        self.hasher = PasswordHasher()
        self.original_password = 'test-original-password'
        self.bootstrap = self.root / 'runtime/authelia/users_database.yml'
        self.active = self.root / 'state/accounts/users_database.yml'
        replace_private(self.bootstrap, {'users': {
            'test-admin': {'password': self.hasher.hash(self.original_password), 'groups': ['admins']},
            'test-member': {'password': self.hasher.hash(self.original_password), 'groups': ['users']},
        }})
        replace_private(self.root / 'runtime/deployment.json', {'public_url': 'https://planner.example.com'})
        self.accounts = Accounts(self.active, self.bootstrap)

    def test_password_change_validates_old_password_and_persists_new_digest(self):
        self.accounts.change('test-admin', self.original_password, 'test-updated-password')
        digest = Accounts(self.active, self.bootstrap).read()['users']['test-admin']['password']
        self.assertTrue(self.hasher.verify(digest, 'test-updated-password'))
        with self.assertRaises(VerifyMismatchError):
            self.hasher.verify(digest, self.original_password)
        self.assertEqual(self.active.stat().st_mode & 0o777, 0o640)
        self.assertEqual(self.active.parent.stat().st_mode & 0o777, 0o750)

    def test_wrong_password_and_non_admin_do_not_change_database(self):
        before = self.active.read_bytes()
        for user, password in (('test-admin', 'wrong'), ('test-member', self.original_password)):
            with self.assertRaises(ManagementError):
                self.accounts.change(user, password, 'test-updated-password')
        self.assertEqual(self.active.read_bytes(), before)

    def test_password_attempts_are_limited(self):
        for _ in range(5):
            with self.assertRaises(ManagementError):
                self.accounts.change('test-admin', 'wrong', 'test-updated-password')
        with self.assertRaises(ManagementError) as raised:
            self.accounts.change('test-admin', self.original_password, 'test-updated-password')
        self.assertEqual(raised.exception.status, 429)

    def test_operator_updates_live_database_and_not_bootstrap(self):
        before = self.bootstrap.read_bytes()
        manage_user.apply_update(self.active, {'username': 'test-admin', 'digest': self.hasher.hash('test-reset-password'), 'delete': False})
        self.assertTrue(self.hasher.verify(self.accounts.read()['users']['test-admin']['password'], 'test-reset-password'))
        self.assertEqual(self.bootstrap.read_bytes(), before)
        manage_user.apply_update(self.active, {'username': 'test-member', 'delete': True})
        self.assertNotIn('test-member', self.accounts.read()['users'])

    def test_operator_cannot_delete_last_administrator(self):
        before = self.active.read_bytes()
        with self.assertRaisesRegex(ManagementError, '最后一个管理员'):
            self.accounts.administer('test-admin', delete=True)
        self.assertEqual(self.active.read_bytes(), before)

    def test_operator_refuses_missing_live_database(self):
        with self.assertRaises(ManagementError):
            manage_user.apply_update(self.root / 'missing/accounts.json', {'username': 'test-admin', 'delete': True})

    def test_host_cli_targets_application_container_without_printing_credentials(self):
        output = io.StringIO()
        digest = self.hasher.hash('test-generated-password')
        with patch.object(sys, 'argv', ['manage_user.py', '--username', 'test-admin', '--runtime-dir', str(self.root / 'runtime')]), \
             patch.object(manage_user, 'new_password', return_value=('test-generated-password', digest)), \
             patch.object(manage_user.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, '', '')) as run, \
             contextlib.redirect_stdout(output):
            manage_user.main()
        self.assertIn('/app/scripts/manage_user.py', run.call_args.args[0])
        self.assertEqual(json.loads(run.call_args.kwargs['input'])['digest'], digest)
        self.assertNotIn('test-generated-password', output.getvalue())
        self.assertNotIn(digest, output.getvalue())
        self.assertEqual((self.root / 'runtime/credentials.txt').stat().st_mode & 0o777, 0o600)

    @unittest.skipUnless(os.geteuid() == 0, 'Linux root capability boundary check')
    def test_authentication_group_can_read_but_not_write_shared_accounts(self):
        os.chmod(self.root, 0o755)
        os.chmod(self.root / 'state', 0o750)
        for filename in (self.root / 'state', self.active.parent, self.active):
            os.chown(filename, 10001, 10001)
        base = ['setpriv', '--bounding-set=-all', '--inh-caps=-all', '--ambient-caps=-all']
        allowed = subprocess.run(base + ['--groups=10001', 'test', '-r', str(self.active)])
        denied_write = subprocess.run(base + ['--groups=10001', 'test', '-w', str(self.active)])
        denied_read = subprocess.run(base + ['--clear-groups', 'test', '-r', str(self.active)])
        self.assertEqual(allowed.returncode, 0)
        self.assertNotEqual(denied_write.returncode, 0)
        self.assertNotEqual(denied_read.returncode, 0)

    def test_unwritable_credential_destination_does_not_reset_the_live_account(self):
        with patch.object(sys, 'argv', ['manage_user.py', '--username', 'test-admin', '--runtime-dir', str(self.root / 'runtime')]), \
             patch.object(manage_user, 'new_password', return_value=('test-generated-password', self.hasher.hash('test-generated-password'))), \
             patch.object(manage_user, 'prepare_credentials', side_effect=OSError('disk is read-only')), \
             patch.object(manage_user.subprocess, 'run') as run, contextlib.redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit):
                manage_user.main()
        run.assert_not_called()

    def test_runtime_upgrade_preserves_users_and_every_encryption_key(self):
        runtime = self.root / 'runtime'
        config = configuration('https://planner.example.com')
        config['session']['name'] = 'smtvv_session'
        config['session']['inactivity'] = '30m'
        config['session']['remember_me'] = '-1s'
        config['authentication_backend']['file']['path'] = '/config/users_database.yml'
        replace_private(runtime / 'authelia/configuration.yml', config)
        for name in ('session', 'storage', 'reset'):
            replace_private(runtime / 'secrets' / name, {'fixture': name})
        originals = {str(p): p.read_bytes() for p in [self.bootstrap, *(runtime / 'secrets').iterdir()]}
        report = upgrade(runtime)
        self.assertTrue(report['accounts_preserved'])
        upgraded = json.loads((runtime / 'authelia/configuration.yml').read_text())
        self.assertEqual(upgraded['authentication_backend']['file']['path'], '/planner-state/accounts/users_database.yml')
        self.assertTrue(report['session_cookie_migrated'])
        self.assertEqual(upgraded['session']['name'], session_cookie_name('https://planner.example.com'))
        self.assertEqual(upgraded['session']['inactivity'], '30m')
        self.assertTrue(report['remember_me_migrated'])
        self.assertEqual(upgraded['session']['remember_me'], -1)
        again = upgrade(runtime)
        self.assertFalse(again['session_cookie_migrated'])
        self.assertFalse(again['remember_me_migrated'])
        backup = Path(report['configuration_backup']) / 'authelia/configuration.yml'
        self.assertEqual(json.loads(backup.read_text())['session']['remember_me'], '-1s')
        for filename, content in originals.items():
            self.assertEqual(Path(filename).read_bytes(), content)

    def test_cookie_names_are_stable_and_separate_parent_and_child_sites(self):
        name = configuration('https://planner.example.com')['session']['name']
        self.assertNotEqual(name, 'smtvv_session')
        self.assertEqual(name, session_cookie_name('https://PLANNER.example.com/'))
        self.assertNotEqual(name, session_cookie_name('https://example.com'))
        self.assertNotEqual(name, session_cookie_name('https://other.planner.example.com'))

    def test_cookie_migration_preserves_custom_names_and_updates_explicit_legacy_override(self):
        runtime = self.root / 'runtime'
        for name in ('session', 'storage', 'reset'):
            replace_private(runtime / 'secrets' / name, {'fixture': name})
        config = configuration('https://planner.example.com')
        config['session']['name'] = 'operator_session'
        config['session']['cookies'][0]['name'] = 'smtvv_session'
        replace_private(runtime / 'authelia/configuration.yml', config)
        self.assertTrue(upgrade(runtime)['session_cookie_migrated'])
        updated = json.loads((runtime / 'authelia/configuration.yml').read_text())
        self.assertEqual(updated['session']['name'], 'operator_session')
        self.assertEqual(updated['session']['cookies'][0]['name'], session_cookie_name('https://planner.example.com'))
        updated['session']['cookies'][0]['name'] = 'operator_cookie'
        replace_private(runtime / 'authelia/configuration.yml', updated)
        self.assertFalse(upgrade(runtime)['session_cookie_migrated'])
        self.assertEqual(json.loads((runtime / 'authelia/configuration.yml').read_text()), updated)

    def test_remember_me_migration_repairs_cookie_override_and_preserves_custom_lifetimes(self):
        runtime = self.root / 'runtime'
        for name in ('session', 'storage', 'reset'):
            replace_private(runtime / 'secrets' / name, {'fixture': name})
        config = configuration('https://planner.example.com')
        config['session']['remember_me'] = '14d'
        config['session']['cookies'][0]['remember_me'] = '-1s'
        replace_private(runtime / 'authelia/configuration.yml', config)
        self.assertTrue(upgrade(runtime)['remember_me_migrated'])
        updated = json.loads((runtime / 'authelia/configuration.yml').read_text())
        self.assertEqual(updated['session']['remember_me'], '14d')
        self.assertEqual(updated['session']['cookies'][0]['remember_me'], -1)
        updated['session']['cookies'][0]['remember_me'] = '7d'
        replace_private(runtime / 'authelia/configuration.yml', updated)
        self.assertFalse(upgrade(runtime)['remember_me_migrated'])
        self.assertEqual(json.loads((runtime / 'authelia/configuration.yml').read_text()), updated)
