"""Small, process-local cache of fully validated, completed computations."""
from collections import OrderedDict
import hashlib
import json
from pathlib import Path
import threading
import time


def configuration_key(request, root, rules_version):
    from compute_protocol import cache_key, revision
    from configuration import parse_config
    try:
        source = Path(root) / 'native/optimal.cpp'
        engine = source if source.is_file() else Path(root) / 'native/optimal-linux'
        engine_revision = hashlib.sha256(engine.read_bytes()).hexdigest()
        return cache_key('optimal', parse_config(request), [rules_version, revision(), engine_revision])
    except (OSError, TypeError, ValueError):
        return None


class CompletedResults:
    def __init__(self, max_entries=16, max_bytes=8*1024*1024, ttl=1800):
        self.max_entries, self.max_bytes, self.ttl = max_entries, max_bytes, ttl
        self.lock = threading.Lock()
        self.entries = OrderedDict()
        self.bytes = 0

    def get(self, key):
        if key is None:
            return None
        with self.lock:
            item = self.entries.get(key)
            if item is None:
                return None
            created, payload = item
            if time.monotonic()-created > self.ttl:
                self.entries.pop(key)
                self.bytes -= len(payload)
                return None
            self.entries.move_to_end(key)
        # Decode outside the lock. Every job owns its own result dictionaries.
        return json.loads(payload)

    def put(self, key, value):
        if key is None:
            return
        payload = json.dumps(value,ensure_ascii=False,separators=(',',':')).encode()
        if len(payload) > self.max_bytes:
            return
        with self.lock:
            previous = self.entries.pop(key,None)
            if previous is not None:
                self.bytes -= len(previous[1])
            self.entries[key] = (time.monotonic(),payload)
            self.bytes += len(payload)
            while len(self.entries) > self.max_entries or self.bytes > self.max_bytes:
                _, removed = self.entries.popitem(last=False)
                self.bytes -= len(removed[1])

    def clear(self):
        with self.lock:
            self.entries.clear()
            self.bytes = 0
