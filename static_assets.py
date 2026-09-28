"""Bounded static-response cache. Authorization stays in the HTTP handler."""
from collections import OrderedDict
from dataclasses import dataclass
import gzip
import hashlib
import json
from pathlib import Path
import stat as file_mode
import threading

TEXT_TYPES = {'.html','.css','.js','.json','.svg','.txt'}


def accepts_gzip(value):
    encodings = {}
    for item in value.lower().split(','):
        name, *parameters = item.strip().split(';')
        quality = 1.0
        for parameter in parameters:
            key, separator, raw = parameter.strip().partition('=')
            if separator and key == 'q':
                try:
                    quality = float(raw)
                except ValueError:
                    quality = 0
        encodings[name.strip()] = quality if 0 <= quality <= 1 else 0
    return encodings.get('gzip',encodings.get('*',0)) > 0


def portrait_manifest(data):
    source = json.loads(data)
    output = {'copyright':source.get('copyright','')}
    for kind in ('demons','essences'):
        output[kind] = {}
        for name, record in source.get(kind,{}).items():
            item = {key:record[key] for key in ('src','width','height') if key in record}
            if 'display' in record:
                item['display'] = {key:record['display'][key] for key in ('src','width','height') if key in record['display']}
            if 'optimized' in record:
                item['optimized'] = record['optimized']
            output[kind][name] = item
    return json.dumps(output,ensure_ascii=False,separators=(',',':')).encode()


@dataclass(frozen=True)
class Asset:
    signature: tuple
    data: bytes
    compressed: bytes | None
    etag: str
    modified: float

    @property
    def size(self):
        return len(self.data) + (len(self.compressed) if self.compressed else 0)


class StaticAssets:
    def __init__(self, max_bytes=32*1024*1024, max_entries=512, max_file_bytes=4*1024*1024):
        self.max_bytes, self.max_entries, self.max_file_bytes = max_bytes, max_entries, max_file_bytes
        self.lock = threading.Lock()
        self.entries = OrderedDict()
        self.bytes = 0

    def get(self, path, runtime_portraits=False):
        path = Path(path)
        key = (str(path),runtime_portraits)
        # Serialize filesystem reads on DrvFS. Cached bodies and compression are
        # shared; callers send bytes only after this lock has been released.
        with self.lock:
            stat = path.stat()
            if not file_mode.S_ISREG(stat.st_mode) or stat.st_size > self.max_file_bytes:
                return None
            signature = (stat.st_dev,stat.st_ino,stat.st_mtime_ns,stat.st_ctime_ns,stat.st_size)
            saved = self.entries.get(key)
            if saved and saved.signature == signature:
                self.entries.move_to_end(key)
                return saved
            data = path.read_bytes()
            if runtime_portraits:
                data = portrait_manifest(data)
            compressed = gzip.compress(data,compresslevel=6,mtime=0) if path.suffix in TEXT_TYPES and len(data)>1024 else None
            if compressed and len(compressed) >= len(data):
                compressed = None
            saved = Asset(signature,data,compressed,hashlib.sha256(data).hexdigest(),stat.st_mtime)
            previous = self.entries.pop(key,None)
            if previous:
                self.bytes -= previous.size
            if saved.size <= self.max_bytes:
                self.entries[key] = saved
                self.bytes += saved.size
            while len(self.entries)>self.max_entries or self.bytes>self.max_bytes:
                _, removed = self.entries.popitem(last=False)
                self.bytes -= removed.size
            return saved
