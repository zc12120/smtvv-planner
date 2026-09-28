import tempfile
import unittest
import http.client
import json
import socket
import threading
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from management import Access, ManagementError, SiteStore, admin_path, normalized_path
import server


class PathAndSettingsTests(unittest.TestCase):
    def test_paths_are_normalized_without_allowing_invalid_input(self):
        self.assertEqual(normalized_path('//api//catalog?cache=1'), '/api/catalog')
        self.assertTrue(admin_path('/admin/../admin/'))
        self.assertTrue(admin_path('/api/admin/settings'))
        self.assertFalse(admin_path('/api/administer'))
        for value in ('api/catalog', '/api/%00catalog', '/api/catalog\n'):
            with self.subTest(value=value), self.assertRaises(ManagementError):
                normalized_path(value)

    def test_site_store_persists_updates_and_rejects_stale_revisions(self):
        with tempfile.TemporaryDirectory() as directory:
            store = SiteStore(Path(directory) / 'settings.json')
            initial = store.snapshot(history=True)
            self.assertEqual(initial['revision'], 0)
            updated = store.update({'requireLogin': False}, 0, 'admin')
            self.assertEqual(updated['revision'], 1)
            self.assertFalse(SiteStore(Path(directory) / 'settings.json').requires_login())
            with self.assertRaisesRegex(ManagementError, '其他页面'):
                store.update({'maintenance': True}, 0, 'admin')
            with self.assertRaises(ManagementError):
                store.update({'notice': {'enabled': True, 'title': '', 'body': ''}}, 1, 'admin')

    def test_admin_access_stays_closed_when_authentication_is_disabled(self):
        with patch.object(server, 'AUTH_ENABLED', False), patch.object(server.SITE, 'requires_login', return_value=False):
            self.assertEqual(server.check_access('', '/admin/').status, 403)
            self.assertEqual(server.check_access('', '/api/catalog').status, 204)

    def test_corrupt_persistent_settings_fail_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            filename = Path(directory) / 'settings.json'
            filename.write_text('{broken')
            with self.assertRaises(ManagementError) as raised:
                SiteStore(filename).requires_login()
            self.assertEqual(raised.exception.status, 503)

    def test_failed_save_preserves_previous_state_and_revision(self):
        with tempfile.TemporaryDirectory() as directory:
            store = SiteStore(Path(directory) / 'settings.json')
            original = store.snapshot(history=True)
            with patch('management.os.replace', side_effect=OSError('disk failure')):
                with self.assertRaises(ManagementError):
                    store.update({'requireLogin': False}, 0, 'admin')
            self.assertEqual(store.snapshot(history=True), original)
            self.assertTrue(SiteStore(store.filename).requires_login())

    def test_settings_reject_unknown_fields_and_non_boolean_switches(self):
        with tempfile.TemporaryDirectory() as directory:
            store = SiteStore(Path(directory) / 'settings.json')
            for change in ({'requireLogin': 0}, {'maintenance': 'true'}, {'password': 'value'},
                           {'notice': {'enabled': True, 'title': 'A' * 81, 'body': ''}}):
                with self.subTest(change=change), self.assertRaises(ManagementError):
                    store.update(change, 0, 'admin')
            self.assertEqual(store.snapshot()['revision'], 0)


class FixtureAuth:
    admin_group = 'admins'

    def verify(self, cookie, uri, method='GET', require_admin=False, **kwargs):
        if cookie == 'test=admin':
            return Access(204, 'test-admin', ('admins',))
        if cookie == 'test=member':
            return Access(403 if require_admin else 204, 'test-member', ('users',))
        return Access(401, location='https://planner.example.com/auth/')


class ManagementHTTPTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.store = SiteStore(Path(directory.name) / 'settings.json')
        self.store.update({'requireLogin': False}, 0, 'test-admin')
        for name, value in {'SITE': self.store, 'AUTH_ENABLED': True, 'AUTH': FixtureAuth(),
                            'ACCOUNTS': None, 'PUBLIC_ORIGIN': 'https://planner.example.com'}.items():
            item = patch.object(server, name, value)
            item.start();self.addCleanup(item.stop)
        portal = patch.dict(server.CATALOG, {'authPortal': '/auth/'})
        portal.start();self.addCleanup(portal.stop)

    def request(self, method, path, body=None, headers=None):
        client, peer = socket.socketpair()
        client.settimeout(5);peer.settimeout(5)
        worker = threading.Thread(target=server.Handler, args=(peer, ('127.0.0.1', 0),
                    SimpleNamespace(server_name='localhost', server_port=0)), daemon=True)
        worker.start()
        connection = http.client.HTTPConnection('localhost', timeout=5)
        connection.sock = client
        try:
            connection.request(method, path, json.dumps(body) if body is not None else None, headers or {})
            response = connection.getresponse()
            raw = response.read()
            return response.status, json.loads(raw) if raw else None
        finally:
            connection.close();worker.join(timeout=5);peer.close()

    def admin_post(self, path, body, origin='https://planner.example.com'):
        return self.request('POST', path, body, {'Cookie': 'test=admin', 'Origin': origin, 'Content-Type': 'application/json'})

    def test_anonymous_tool_does_not_open_admin_or_accept_forged_identity(self):
        self.assertEqual(self.request('GET', '/api/catalog')[0], 200)
        for path in ('/api/admin/overview', '/api//admin/overview', '/%61dmin/', '/admin/../admin/'):
            with self.subTest(path=path):
                self.assertEqual(self.request('GET', path, headers={'Remote-User': 'test-admin', 'Remote-Groups': 'admins'})[0], 401)

    def test_authenticated_non_administrator_cannot_use_admin(self):
        self.assertEqual(self.request('GET', '/api/admin/overview', headers={'Cookie': 'test=member'})[0], 403)

    def test_login_switch_takes_effect_and_admin_keeps_access(self):
        self.assertEqual(self.admin_post('/api/admin/settings', {'revision': 1, 'patch': {'requireLogin': True}})[0], 200)
        self.assertEqual(self.request('GET', '/api/catalog')[0], 401)
        self.assertEqual(self.request('GET', '/api/admin/overview', headers={'Cookie': 'test=admin'})[0], 200)

    def test_admin_mutations_require_exact_origin(self):
        self.assertEqual(self.admin_post('/api/admin/settings', {'revision': 1, 'patch': {'requireLogin': True}}, 'https://sibling.example.com')[0], 403)
        self.assertFalse(self.store.requires_login())

    def test_maintenance_blocks_new_computation_and_allows_status(self):
        self.store.update({'maintenance': True}, 1, 'test-admin')
        with patch.object(server, 'start_optimal') as start, patch.object(server, 'get_optimal', return_value={'finished': False}):
            status, body = self.admin_post('/api/optimal/start', {'target': 'Angel', 'skills': ['Dia']})
            self.assertEqual(status, 503);self.assertTrue(body['maintenance']);start.assert_not_called()
            self.assertEqual(self.admin_post('/api/optimal/status', {'jobId': 'existing'})[0], 200)

    def test_maintenance_allows_retry_of_an_existing_start(self):
        self.store.update({'maintenance': True}, 1, 'test-admin')
        with patch.dict('optimal.JOBS', {'existing': object()}), patch.object(server, 'start_optimal', return_value={'jobId': 'existing'}):
            self.assertEqual(self.admin_post('/api/optimal/start', {'requestId': 'existing', 'target': 'Angel'})[0], 200)

    def test_stale_revision_returns_conflict_without_discarding_settings(self):
        self.store.update({'maintenance': True}, 1, 'test-admin')
        self.assertEqual(self.admin_post('/api/admin/settings', {'revision': 1, 'patch': {'requireLogin': True}})[0], 409)
        self.assertTrue(self.store.paused());self.assertFalse(self.store.requires_login())

    def test_public_state_never_exposes_account_or_audit(self):
        status, body = self.request('GET', '/api/site')
        self.assertEqual(status, 200);self.assertFalse(body['administrator'])
        self.assertEqual(set(body), {'revision', 'settings', 'administrator'})


if __name__ == '__main__':
    unittest.main()
