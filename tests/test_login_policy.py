import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import server
from accounts import replace_private
from login_policy import LoginPolicy, DEFAULT_LOGIN_SETTINGS, duration_minutes
from management import Access, ManagementError
from scripts.configure import configuration, login_bootstrap, nginx_locations
from tests import test_management as management_fixture


class LoginPolicyTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.bootstrap = self.root / 'bootstrap.json'
        self.config = configuration('https://planner.example.com')
        replace_private(self.bootstrap, login_bootstrap(self.config))
        self.policy = LoginPolicy(self.root / 'policy', 'https://planner.example.com', self.bootstrap)
        self.policy.initialize()

    def test_existing_cookie_overrides_are_imported_and_other_domains_preserved(self):
        self.config['session']['cookies'][0].update(expiration='6h', inactivity='30m', remember_me='7d')
        self.config['session']['cookies'].append({'domain': 'other.example.com', 'authelia_url': 'https://other.example.com/auth/'})
        replace_private(self.bootstrap, login_bootstrap(self.config))
        policy = LoginPolicy(self.root / 'imported', 'https://planner.example.com', self.bootstrap)
        policy.initialize()
        settings = policy.snapshot()['settings']
        self.assertEqual((settings['sessionMinutes'], settings['inactivityMinutes'], settings['rememberMinutes']), (360, 30, 10080))
        policy.update({'sessionMinutes': 720}, 0, 'admin')
        overlay = json.loads((policy.directory / 'current/session.json').read_text())
        self.assertEqual(overlay['session']['cookies'][1], self.config['session']['cookies'][1])

    def test_disabled_remember_me_uses_the_numeric_sentinel(self):
        self.policy.update({'rememberMeEnabled': False}, 0, 'admin')
        overlay = json.loads((self.policy.directory / 'current/session.json').read_text())
        self.assertEqual(overlay['session']['cookies'][0]['remember_me'], -1)
        self.assertIs(type(overlay['session']['cookies'][0]['remember_me']), int)

    def test_preferences_do_not_restart_sessions(self):
        before = (self.policy.directory / 'current/session.json').read_bytes()
        result = self.policy.update({'rememberPasswordEnabled': False, 'rememberMeDefault': True}, 0, 'admin')
        self.assertFalse(result['sessionChanged'])
        self.assertEqual((self.policy.directory / 'current/session.json').read_bytes(), before)

    def test_durations_change_the_actual_authelia_configuration(self):
        result = self.policy.update({'sessionMinutes': 2880, 'inactivityMinutes': 1440, 'rememberMinutes': 86400}, 0, 'admin')
        self.assertTrue(result['sessionChanged'])
        overlay = json.loads((self.policy.directory / 'current/session.json').read_text())['session']['cookies'][0]
        self.assertEqual((overlay['expiration'], overlay['inactivity'], overlay['remember_me']), ('2880m', '1440m', '86400m'))

    def test_invalid_and_unbounded_values_leave_policy_unchanged(self):
        before = self.policy.snapshot()
        for change in ({'sessionMinutes': True}, {'sessionMinutes': 10.5}, {'sessionMinutes': 0},
                       {'sessionMinutes': 43201}, {'inactivityMinutes': 1441}, {'rememberMinutes': 525601},
                       {'rememberMinutes': 1439}, {'rememberMeEnabled': 1}, {'password': 'not-allowed'}):
            with self.subTest(change=change), self.assertRaises(ManagementError):
                self.policy.update(change, 0, 'admin')
        self.assertEqual(self.policy.snapshot(), before)

    def test_a_second_process_cannot_overwrite_a_newer_revision(self):
        second = LoginPolicy(self.policy.directory, self.policy.origin, self.bootstrap)
        self.policy.update({'rememberPasswordEnabled': False}, 0, 'first')
        with self.assertRaises(ManagementError) as error:
            second.update({'rememberMeDefault': True}, 0, 'second')
        self.assertEqual(error.exception.status, 409)
        self.assertFalse(second.snapshot()['settings']['rememberPasswordEnabled'])

    def test_failed_atomic_publication_preserves_policy_and_session_together(self):
        current = (self.policy.directory / 'current').resolve()
        previous = self.policy.snapshot(history=True)
        real_replace = __import__('os').replace
        def fail_pointer(source, target):
            if Path(target).name == 'current':
                raise OSError('simulated storage failure')
            return real_replace(source, target)
        with patch('login_policy.os.replace', side_effect=fail_pointer), self.assertRaises(ManagementError):
            self.policy.update({'sessionMinutes': 2880}, 0, 'admin')
        self.assertEqual((self.policy.directory / 'current').resolve(), current)
        self.assertEqual(self.policy.snapshot(history=True), previous)

    def test_corrupt_state_is_not_reset_to_defaults(self):
        filename = self.policy.directory / 'current/policy.json'
        filename.write_text('{broken')
        with self.assertRaises(ManagementError) as error:
            self.policy.initialize()
        self.assertEqual(error.exception.status, 503)
        self.assertEqual(filename.read_text(), '{broken')

    def test_bootstrap_excludes_inline_secrets(self):
        self.config['session']['secret'] = 'private-session-secret'
        self.config['session']['redis'] = {'password': 'private-redis-password'}
        self.config['session']['cookies'][0]['unknown'] = 'private-extra'
        data = json.dumps(login_bootstrap(self.config))
        self.assertNotIn('private-', data)

    def test_imported_durations_are_not_silently_rounded(self):
        self.assertEqual(duration_minutes('1h30m'), 90)
        for value in ('1s', 'garbage', '-1s', 1, True):
            with self.subTest(value=value), self.assertRaises(ValueError):
                duration_minutes(value)

    def test_gateway_exposes_only_public_login_options_without_authentication(self):
        config = nginx_locations('https://planner.example.com')
        login = config.split('location = /auth/ {', 1)[1].split('\n}', 1)[0]
        options = config.split('location = /api/login/options {', 1)[1].split('\n}', 1)[0]
        self.assertIn('/auth/index.html', login)
        self.assertIn("frame-ancestors 'none'", login)
        self.assertNotIn('auth_request ', options)
        self.assertIn('auth_request /_smtvv_admin', config)
        self.assertIn('location ^~ /auth/api/firstfactor', config)
        self.assertIn('auth_request /_smtvv_login_gate', config)
        self.assertIn('location = /api/login/turnstile', config)
        self.assertIn('https://challenges.cloudflare.com', config)


class LoginPolicyHTTPTests(unittest.TestCase):
    request = management_fixture.ManagementHTTPTests.request
    admin_post = management_fixture.ManagementHTTPTests.admin_post

    def setUp(self):
        management_fixture.ManagementHTTPTests.setUp(self)
        self.policy = LoginPolicy(self.store.filename.parent / 'login-policy', 'https://planner.example.com')
        self.policy.initialize()
        item = patch.object(server, 'LOGIN_POLICY', self.policy)
        item.start();self.addCleanup(item.stop)

    def test_public_options_do_not_expose_history_or_account(self):
        self.store.update({'requireLogin': True}, 1, 'admin')
        self.policy.update({'rememberPasswordEnabled': False}, 0, 'private-admin')
        status, body = self.request('GET', '/api/login/options')
        self.assertEqual(status, 200)
        self.assertEqual(set(body), {'revision', 'settings', 'turnstile'})
        self.assertEqual(body['turnstile'], {'enabled': False})
        self.assertNotIn('private-admin', json.dumps(body))
        self.assertEqual(self.request('GET', '/api/admin/login-policy')[0], 401)
        self.assertEqual(self.request('GET', '/api/admin/login-policy', headers={'Cookie': 'test=member'})[0], 403)

    def test_preferences_require_administrator_and_same_origin(self):
        data = {'revision': 0, 'patch': {'rememberPasswordEnabled': False}}
        self.assertEqual(self.request('POST', '/api/admin/login-policy', data)[0], 401)
        self.assertEqual(self.admin_post('/api/admin/login-policy', data, 'https://other.example.com')[0], 403)
        status, body = self.admin_post('/api/admin/login-policy', data)
        self.assertEqual(status, 200)
        self.assertFalse(body['sessionChanged'])
        self.assertFalse(body['settings']['rememberPasswordEnabled'])
        self.assertEqual(self.admin_post('/api/admin/login-policy', data)[0], 409)

    def test_session_change_waits_for_actual_cookie_revocation(self):
        decisions = [Access(204, 'admin', ('admins',)), Access(401)]
        with patch.object(server.AUTH, 'verify', side_effect=decisions):
            status, body = self.admin_post('/api/admin/login-policy', {'revision': 0, 'patch': {'sessionMinutes': 2880}})
        self.assertEqual(status, 200)
        self.assertTrue(body['sessionChanged'])
        self.assertTrue(body['sessionsRevoked'])

    def test_overview_includes_login_settings_and_audit(self):
        self.policy.update({'rememberMeDefault': True}, 0, 'admin')
        status, body = self.request('GET', '/api/admin/overview', headers={'Cookie': 'test=admin'})
        self.assertEqual(status, 200)
        self.assertTrue(body['loginPolicy']['settings']['rememberMeDefault'])
        self.assertTrue(any(event['action'] == 'login-policy' for event in body['history']))


if __name__ == '__main__':
    unittest.main()
