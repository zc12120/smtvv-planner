"""Static caching over real HTTP framing, with no dependency on WSL TCP."""
import gzip
import http.client
import json
import os
from pathlib import Path
import socket
import tempfile
import threading
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import server
from static_assets import StaticAssets, portrait_manifest


class AssetCacheTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)

    def test_invalidation_even_when_size_and_mtime_are_unchanged(self):
        path = self.root / 'app.js'
        path.write_text('old value' * 500)
        cache = StaticAssets()
        first = cache.get(path)
        self.assertIs(first, cache.get(path))
        timestamp = path.stat().st_mtime_ns
        replacement = self.root / 'replacement'
        replacement.write_text('new value' * 500)
        os.utime(replacement, ns=(timestamp, timestamp))
        replacement.replace(path)
        second = cache.get(path)
        self.assertEqual(first.modified, second.modified)
        self.assertEqual(len(first.data), len(second.data))
        self.assertNotEqual(first.etag, second.etag)
        self.assertEqual(gzip.decompress(second.compressed), second.data)
        self.assertEqual(cache.bytes, second.size)

    def test_entry_and_memory_limits_include_compressed_copies(self):
        cache = StaticAssets(max_bytes=40, max_entries=2, max_file_bytes=30)
        for name in ('a', 'b', 'c'):
            (self.root / name).write_bytes(b'x' * 18)
        first = cache.get(self.root / 'a')
        cache.get(self.root / 'b')
        self.assertIs(cache.get(self.root / 'a'), first)
        cache.get(self.root / 'c')
        self.assertNotIn((str(self.root / 'b'), False), cache.entries)
        self.assertLessEqual(cache.bytes, 40)
        self.assertEqual(cache.bytes, sum(item.size for item in cache.entries.values()))
        (self.root / 'large').write_bytes(b'x' * 31)
        self.assertIsNone(cache.get(self.root / 'large'))
        self.assertIsNone(cache.get(self.root))


class StaticHTTPTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.content = ('const label="测试";\n' * 300).encode()
        (self.root / 'app.js').write_bytes(self.content)
        (self.root / 'index.html').write_bytes(b'<!doctype html>' + b'<p>test</p>' * 300)
        (self.root / 'portrait-abcdef123456-96.webp').write_bytes(b'image')
        self.manifest = {'copyright': 'local art', 'source': {'metadata': 'preserved'},
                         'demons': {'Angel': {'src': '/assets/demons/angel.png', 'width': 512, 'height': 256,
                                             'pictureId': 42, 'display': {'src': '/assets/demons/display/angel.png', 'width': 200, 'height': 250, 'extra': 'unused'},
                                             'optimized': {'format': 'webp', 'variants': [{'src': '/assets/demons/optimized/angel-abcdef123456-96.webp', 'width': 96, 'height': 120}]}}},
                         'essences': {}}
        directory = self.root / 'assets/demons'
        directory.mkdir(parents=True)
        (directory / 'manifest.json').write_text(json.dumps(self.manifest))
        for item in (patch.object(server, 'WEB', self.root),
                     patch.object(server, 'STATIC_ASSETS', StaticAssets()),
                     patch.object(server, 'AUTH_ENABLED', False)):
            item.start()
            self.addCleanup(item.stop)
        self.connection = self.connect()

    def connect(self):
        client, peer = socket.socketpair()
        client.settimeout(3)
        peer.settimeout(3)
        worker = threading.Thread(target=server.Handler,
                                  args=(peer, ('127.0.0.1', 0), SimpleNamespace(server_name='localhost', server_port=0)),
                                  daemon=True)
        worker.start()
        connection = http.client.HTTPConnection('localhost', timeout=3)
        connection.sock = client

        def cleanup():
            connection.close()
            worker.join(timeout=3)
            peer.close()

        self.addCleanup(cleanup)
        return connection

    def request(self, method, path, headers=None, connection=None):
        connection = connection or self.connection
        connection.request(method, path, headers=headers or {})
        response = connection.getresponse()
        return response, response.read()

    def test_gzip_head_and_conditional_responses_share_one_connection(self):
        original_socket = self.connection.sock
        get, body = self.request('GET', '/app.js', {'Accept-Encoding': 'gzip'})
        self.assertEqual(get.status, 200)
        self.assertEqual(get.version, 11)
        self.assertEqual(gzip.decompress(body), self.content)
        self.assertEqual(get.getheader('Vary'), 'Accept-Encoding')
        self.assertEqual(get.getheader('Cache-Control'), 'no-cache')
        self.assertEqual(int(get.getheader('Content-Length')), len(body))
        head, empty = self.request('HEAD', '/app.js', {'Accept-Encoding': 'gzip'})
        self.assertEqual(empty, b'')
        for header in ('ETag', 'Content-Length', 'Content-Encoding'):
            self.assertEqual(head.getheader(header), get.getheader(header))
        cached, empty = self.request('GET', '/app.js', {'Accept-Encoding': 'gzip', 'If-None-Match': 'W/' + get.getheader('ETag')})
        self.assertEqual((cached.status, empty), (304, b''))
        plain, body = self.request('GET', '/app.js', {'Accept-Encoding': 'gzip;q=0, *;q=1', 'If-None-Match': get.getheader('ETag')})
        self.assertEqual((plain.status, body), (200, self.content))
        self.assertIsNone(plain.getheader('Content-Encoding'))
        self.assertNotEqual(plain.getheader('ETag'), get.getheader('ETag'))
        health, body = self.request('GET', '/healthz')
        self.assertEqual((health.status, json.loads(body)), (200, {'status': 'ok'}))
        self.assertIs(self.connection.sock, original_socket)

    def test_index_pages_use_compression_and_hash_named_images_are_immutable_locally(self):
        response, body = self.request('GET', '/', {'Accept-Encoding': 'gzip'})
        self.assertEqual(response.getheader('Content-Encoding'), 'gzip')
        self.assertEqual(gzip.decompress(body), (self.root / 'index.html').read_bytes())
        image, _ = self.request('GET', '/portrait-abcdef123456-96.webp')
        self.assertIn('immutable', image.getheader('Cache-Control'))

    def test_changed_file_invalidates_etag_and_if_none_match_takes_priority_over_date(self):
        first, _ = self.request('GET', '/app.js')
        headers = {'If-Modified-Since': first.getheader('Last-Modified')}
        unchanged, _ = self.request('GET', '/app.js', headers)
        self.assertEqual(unchanged.status, 304)
        (self.root / 'app.js').write_bytes(b'updated')
        changed, body = self.request('GET', '/app.js', {**headers, 'If-None-Match': first.getheader('ETag')})
        self.assertEqual((changed.status, body), (200, b'updated'))
        invalid_date, _ = self.request('GET', '/app.js', {'If-Modified-Since': 'not a date'})
        self.assertEqual(invalid_date.status, 200)

    def test_authorization_precedes_warm_cache_and_conditional_delivery(self):
        warm, _ = self.request('GET', '/app.js')
        with patch('server.check_access', return_value=server.Access(401)):
            for method in ('GET', 'HEAD'):
                response, body = self.request(method, '/app.js', {'If-None-Match': warm.getheader('ETag')}, self.connect())
                self.assertEqual(response.status, 401)
                self.assertEqual(response.getheader('Cache-Control'), 'no-store')
                self.assertIsNone(response.getheader('ETag'))
                if method == 'HEAD':
                    self.assertEqual(body, b'')
                else:
                    self.assertEqual(json.loads(body)['login'], '/auth/')

    def test_authenticated_responses_are_no_store_in_cached_and_streaming_paths(self):
        warm, _ = self.request('GET', '/app.js')
        with patch.object(server, 'AUTH_ENABLED', True), patch('server.check_access', return_value=server.Access(204)):
            response, body = self.request('GET', '/app.js', {'If-None-Match': warm.getheader('ETag')})
            self.assertEqual((response.status, body), (200, self.content))
            self.assertEqual(response.getheader('Cache-Control'), 'no-store')
            response, _ = self.request('GET', '/portrait-abcdef123456-96.webp')
            self.assertEqual(response.getheader('Cache-Control'), 'no-store')
            with patch.object(server, 'STATIC_ASSETS', StaticAssets(max_file_bytes=1)):
                headers = {'If-Modified-Since': 'Wed, 16 Sep 2099 00:00:00 GMT'}
                response, body = self.request('GET', '/app.js', headers)
                self.assertEqual((response.status, body), (200, self.content))
                self.assertEqual(response.getheader('Cache-Control'), 'no-store')
                head, empty = self.request('HEAD', '/app.js', headers)
                self.assertEqual((head.status, empty), (200, b''))

    def test_runtime_manifest_preserves_paths_while_full_manifest_keeps_provenance(self):
        full, body = self.request('GET', '/assets/demons/manifest.json')
        self.assertEqual(json.loads(body), self.manifest)
        runtime, body = self.request('GET', '/assets/demons/manifest.json?view=runtime')
        compact = json.loads(body)
        self.assertEqual(body, portrait_manifest(json.dumps(self.manifest)))
        self.assertEqual(compact['copyright'], self.manifest['copyright'])
        record = compact['demons']['Angel']
        self.assertNotIn('pictureId', record)
        self.assertEqual(record['optimized'], self.manifest['demons']['Angel']['optimized'])
        self.assertNotEqual(runtime.getheader('ETag'), full.getheader('ETag'))

    def test_ambiguous_post_body_is_rejected_and_connection_closed(self):
        self.connection.putrequest('POST', '/api/optimal/cancel')
        self.connection.putheader('Content-Length', '2')
        self.connection.putheader('Content-Length', '20')
        self.connection.endheaders(b'{}')
        response = self.connection.getresponse()
        self.assertEqual(response.status, 400)
        self.assertEqual(response.getheader('Connection'), 'close')
        self.assertIn('error', json.loads(response.read()))


if __name__ == '__main__':
    unittest.main()
