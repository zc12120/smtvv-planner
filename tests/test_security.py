import base64
import hashlib
import http.client
import json
from pathlib import Path
import re
import socket
import threading
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import planner
import server
from scripts.configure import public_origin, configure, gateway_configuration


class OriginProtectionTests(unittest.TestCase):
    def setUp(self):
        self.portal = patch.dict(server.CATALOG, {'authPortal': '/auth/'})
        self.portal.start()
        self.addCleanup(self.portal.stop)
        self.origin = patch.object(server, 'PUBLIC_ORIGIN', 'https://planner.example.com')
        self.origin.start()
        self.addCleanup(self.origin.stop)

    def post(self, origin):
        headers = {'Content-Type': 'application/json'}
        if origin is not None:
            headers['Origin'] = origin
        # Exercise real HTTP parsing/dispatch over a socket pair; no dependency
        # on the host's WSL localhost forwarding or ephemeral TCP port routing.
        client, peer = socket.socketpair()
        client.settimeout(3)
        peer.settimeout(3)
        self.addCleanup(peer.close)
        worker = threading.Thread(target=server.Handler,
                                  args=(peer, ('127.0.0.1', 0), SimpleNamespace(server_name='localhost',server_port=0)),
                                  daemon=True)
        worker.start()
        connection = http.client.HTTPConnection('localhost', timeout=3)
        connection.sock = client
        self.addCleanup(connection.close)
        connection.request('POST', '/api/optimal/start', json.dumps({'target': 'Angel', 'skills': ['Dia']}), headers)
        response = connection.getresponse()
        result = response.status, json.loads(response.read())
        connection.close()
        worker.join(timeout=3)
        return result

    def test_missing_foreign_and_same_site_sibling_origins_cannot_start_a_job(self):
        with patch.object(server, 'start_optimal') as start:
            for origin in (None, 'null', 'https://attacker.invalid', 'https://other.example.com',
                           'https://planner.example.com.attacker.invalid'):
                with self.subTest(origin=origin):
                    status, body = self.post(origin)
                    self.assertEqual(status, 403)
                    self.assertIn('来源', body['error'])
            start.assert_not_called()

    def test_exact_configured_origin_can_start_a_job(self):
        with patch.object(server, 'start_optimal', return_value={'jobId': 'authorized'}) as start:
            status, body = self.post('https://planner.example.com')
            self.assertEqual(status, 200)
            self.assertEqual(body['jobId'], 'authorized')
            start.assert_called_once()


class DistributionTests(unittest.TestCase):
    def test_gateway_proxies_runtime_manifest_with_access_control(self):
        config = gateway_configuration('https://planner.example.com')
        block = re.search(r'location = /assets/demons/manifest\.json \{(.*?)\n\}', config, re.S).group(1)
        self.assertIn('auth_request /_smtvv_access;', block)
        self.assertIn('error_page 401 = @smtvv_unauthorized;', block)
        self.assertIn('proxy_pass http://app:8765;', block)
        self.assertNotIn('try_files', block)

    def test_login_recovery_script_matches_strict_gateway_csp(self):
        config = gateway_configuration('https://planner.example.com')
        policy = re.search(r'add_header Content-Security-Policy "([^"]+)"', config).group(1)
        scripts = re.search(r'(?:^|; )script-src ([^;]+)', policy).group(1).split()
        page = (Path(__file__).resolve().parents[1] / 'web/auth/index.html').read_text()
        inline = re.findall(r'<script\b(?![^>]*\bsrc\s*=)[^>]*>(.*?)</script>', page, re.S)
        self.assertTrue(inline)
        self.assertNotIn("'unsafe-inline'", scripts)
        self.assertNotIn("'unsafe-eval'", scripts)
        for source in inline:
            digest = base64.b64encode(hashlib.sha256(source.encode()).digest()).decode()
            self.assertIn("'sha256-" + digest + "'", scripts)

    def test_catalog_remains_complete_without_optional_game_text(self):
        with patch.object(planner, 'DEMON_PROFILES', {'source': {'kind': 'not-installed', 'label': ''}, 'demons': {}}):
            data = planner.catalog()
        self.assertEqual(len(data['demons']), 275)
        self.assertTrue(all(d['descriptionZh'] == '' for d in data['demons']))
        self.assertTrue(all(len(d['ailments']) == 6 for d in data['demons']))
        self.assertEqual(next(d for d in data['demons'] if d['name'] == 'Pixie')['ailments'], '--w---')

    def test_configuration_rejects_non_https_origins_credentials_and_paths(self):
        for value in ('http://planner.example.com', 'https://u:p@planner.example.com',
                      'https://planner.example.com/auth', 'https://planner.example.com?x=1',
                      'https://planner.example.com:8443', 'https://localhost',
                      'https://evil.example.com/\nserver {}'):
            with self.subTest(value=value), self.assertRaises(ValueError):
                public_origin(value)
        self.assertEqual(public_origin('https://planner.example.com/'), 'https://planner.example.com')

    def test_initialization_refuses_to_replace_existing_secrets(self):
        import tempfile
        from pathlib import Path
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            marker = root / 'existing-secret'
            marker.write_text('keep-me')
            with patch('scripts.configure.new_password') as generate, self.assertRaises(ValueError):
                configure('https://planner.example.com', root)
            generate.assert_not_called()
            self.assertEqual(marker.read_text(), 'keep-me')
