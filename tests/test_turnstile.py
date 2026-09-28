import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from management import ManagementError
import server
from tests import test_management as management_fixture
from login_policy import LoginPolicy
from turnstile import TurnstileConfig


SITE_KEY = '0x4AAAAAAExampleSiteKey123456'
SECRET_KEY = '0x4AAAAAAExampleSecretKey123456'


class TurnstileConfigTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.config = TurnstileConfig(Path(temporary.name) / 'turnstile',
                                      'https://planner.example.com')
        self.config.initialize()

    def enable(self):
        with patch.object(self.config, 'verify') as verify:
            result = self.config.update({'enabled': True, 'siteKey': SITE_KEY}, 0, 'admin',
                                        secret_key=SECRET_KEY, verification_token='valid',
                                        remote_ip='192.0.2.10')
        verify.assert_called_once_with('valid', SECRET_KEY, 'turnstile_settings', '192.0.2.10', 400)
        return result

    def test_disabled_public_settings_disclose_no_keys(self):
        self.assertEqual(self.config.public_snapshot(), {'enabled': False})
        snapshot = self.config.snapshot()
        self.assertFalse(snapshot['secretConfigured'])
        self.assertNotIn('secretKey', json.dumps(snapshot))

    def test_enabling_requires_complete_keys_and_live_verification(self):
        with self.assertRaises(ManagementError):
            self.config.update({'enabled': True}, 0, 'admin')
        with patch.object(self.config, 'verify', side_effect=ManagementError('failed', 400)):
            with self.assertRaises(ManagementError):
                self.config.update({'enabled': True, 'siteKey': SITE_KEY}, 0, 'admin',
                                   secret_key=SECRET_KEY, verification_token='invalid')
        self.assertEqual(self.config.snapshot()['revision'], 0)
        self.assertEqual(self.config.public_snapshot(), {'enabled': False})

    def test_enabled_public_settings_expose_site_key_but_never_secret(self):
        result = self.enable()
        self.assertTrue(result['secretConfigured'])
        public = self.config.public_snapshot()
        self.assertEqual(public, {'enabled': True, 'siteKey': SITE_KEY,
                                  'theme': 'auto', 'appearance': 'interaction-only'})
        self.assertNotIn(SECRET_KEY, json.dumps(result) + json.dumps(public))

    def test_login_ticket_is_bound_to_ip_and_consumed_once(self):
        self.enable()
        with patch.object(self.config, 'verify') as verify:
            result, header = self.config.challenge('login-token', '192.0.2.10')
        verify.assert_called_once_with('login-token', SECRET_KEY, 'login', '192.0.2.10')
        self.assertTrue(result['required'])
        self.assertIn('HttpOnly; Secure; SameSite=Strict', header)
        cookie = header.split(';', 1)[0]
        self.assertFalse(self.config.consume(cookie, '192.0.2.11'))
        with patch.object(self.config, 'verify'):
            _, header = self.config.challenge('login-token', '192.0.2.10')
        cookie = header.split(';', 1)[0]
        self.assertTrue(self.config.consume(cookie, '192.0.2.10'))
        self.assertFalse(self.config.consume(cookie, '192.0.2.10'))

    def test_preferences_do_not_require_a_new_challenge(self):
        self.enable()
        with patch.object(self.config, 'verify') as verify:
            result = self.config.update({'theme': 'dark', 'appearance': 'always'}, 1, 'admin')
        verify.assert_not_called()
        self.assertTrue(result['settings']['enabled'])

    def test_disabling_does_not_require_a_challenge_and_clearing_secret_disables(self):
        self.enable()
        disabled = self.config.update({'enabled': False}, 1, 'admin')
        self.assertFalse(disabled['settings']['enabled'])
        cleared = self.config.update({'siteKey': ''}, 2, 'admin', clear_secret=True)
        self.assertFalse(cleared['secretConfigured'])

    def test_stale_revision_preserves_current_configuration(self):
        self.enable()
        with self.assertRaises(ManagementError) as error:
            self.config.update({'theme': 'dark'}, 0, 'other-admin')
        self.assertEqual(error.exception.status, 409)
        self.assertEqual(self.config.snapshot()['settings']['theme'], 'auto')

    def test_siteverify_requires_exact_hostname_and_action(self):
        class Response:
            def __init__(self, body): self.body = body
            def __enter__(self): return self
            def __exit__(self, *_): return False
            def read(self, _limit): return json.dumps(self.body).encode()
        for body in ({'success': True, 'hostname': 'other.example.com', 'action': 'login'},
                     {'success': True, 'hostname': 'planner.example.com', 'action': 'other'},
                     {'success': False, 'hostname': 'planner.example.com', 'action': 'login'}):
            with self.subTest(body=body), patch('turnstile.urlopen', return_value=Response(body)):
                with self.assertRaises(ManagementError) as error:
                    self.config.verify('token', SECRET_KEY, 'login')
                self.assertEqual(error.exception.status, 403)
        with patch('turnstile.urlopen', return_value=Response(
                {'success': True, 'hostname': 'planner.example.com', 'action': 'login'})):
            self.config.verify('token', SECRET_KEY, 'login')
        with patch('turnstile.urlopen', return_value=Response([])):
            with self.assertRaises(ManagementError) as error:
                self.config.verify('token', SECRET_KEY, 'login')
            self.assertEqual(error.exception.status, 503)

    def test_official_dummy_key_shape_is_accepted_for_isolated_testing(self):
        settings = {'enabled': False, 'siteKey': '1x00000000000000000000AA',
                    'theme': 'auto', 'appearance': 'always'}
        self.config.validate(settings)

    def test_explicit_testing_mode_accepts_only_the_official_testing_response(self):
        class Response:
            def __enter__(self): return self
            def __exit__(self, *_): return False
            def read(self, _limit):
                return json.dumps({'success': True, 'hostname': 'example.com',
                                   'metadata': {'result_with_testing_key': True}}).encode()
        with patch('turnstile.urlopen', return_value=Response()):
            with self.assertRaises(ManagementError):
                self.config.verify('XXXX.DUMMY.TOKEN.XXXX',
                                   '1x0000000000000000000000000000000AA', 'login')
            testing = TurnstileConfig(self.config.directory, 'https://planner.example.com', testing=True)
            testing.verify('XXXX.DUMMY.TOKEN.XXXX',
                           '1x0000000000000000000000000000000AA', 'login')
            with self.assertRaises(ManagementError):
                testing.verify('XXXX.DUMMY.TOKEN.XXXX', SECRET_KEY, 'login')


class TurnstileHTTPTests(unittest.TestCase):
    request = management_fixture.ManagementHTTPTests.request
    admin_post = management_fixture.ManagementHTTPTests.admin_post

    def setUp(self):
        management_fixture.ManagementHTTPTests.setUp(self)
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.config = TurnstileConfig(Path(temporary.name) / 'turnstile',
                                      'https://planner.example.com')
        self.config.initialize()
        self.login_policy = LoginPolicy(Path(temporary.name) / 'login-policy',
                                        'https://planner.example.com')
        self.login_policy.initialize()
        for name, value in {'TURNSTILE': self.config, 'LOGIN_POLICY': self.login_policy}.items():
            item = patch.object(server, name, value)
            item.start();self.addCleanup(item.stop)

    def test_public_challenge_requires_exact_origin_and_never_accepts_extra_fields(self):
        with patch.object(self.config, 'challenge', return_value=({'verified': True, 'required': True}, 'ticket=value')) as challenge:
            headers = {'Origin': 'https://planner.example.com', 'Content-Type': 'application/json'}
            status, body = self.request('POST', '/api/login/turnstile', {'token': 'value'}, headers)
            self.assertEqual(status, 200);self.assertTrue(body['verified'])
            challenge.assert_called_once_with('value', '127.0.0.1')
        headers['Origin'] = 'https://other.example.com'
        self.assertEqual(self.request('POST', '/api/login/turnstile', {'token': 'value'}, headers)[0], 403)
        headers['Origin'] = 'https://planner.example.com'
        self.assertEqual(self.request('POST', '/api/login/turnstile', {'token': 'value', 'secret': 'no'}, headers)[0], 400)

    def test_internal_gate_consumes_only_the_configured_ticket(self):
        with patch.object(self.config, 'consume', return_value=False) as consume:
            status, _ = self.request('GET', '/_internal/login-gate', headers={'Cookie': 'ticket=value'})
        self.assertEqual(status, 403)
        consume.assert_called_once_with('ticket=value', '127.0.0.1')

    def test_admin_can_configure_secret_without_receiving_it_back(self):
        with patch.object(self.config, 'verify'):
            status, body = self.admin_post('/api/admin/turnstile', {
                'revision': 0, 'patch': {'enabled': True, 'siteKey': SITE_KEY},
                'secretKey': SECRET_KEY, 'verificationToken': 'valid',
            })
        self.assertEqual(status, 200);self.assertTrue(body['secretConfigured'])
        self.assertNotIn(SECRET_KEY, json.dumps(body))
        public = self.request('GET', '/api/login/options')[1]
        self.assertEqual(public['turnstile']['siteKey'], SITE_KEY)
        self.assertNotIn(SECRET_KEY, json.dumps(public))


if __name__ == '__main__':
    unittest.main()
