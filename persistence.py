"""Small durable-file primitives shared by account and site settings."""
from contextlib import contextmanager
import fcntl
import json
import os
from pathlib import Path
import shutil
import tempfile

def replace_private(path, value, mode=0o600):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=path.parent,
                                         prefix='.state-', delete=False) as handle:
            temporary = Path(handle.name)
            os.fchmod(handle.fileno(), mode)
            if path.exists() and os.geteuid() == 0:
                previous = path.stat()
                os.fchown(handle.fileno(), previous.st_uid, previous.st_gid)
            json.dump(value, handle, ensure_ascii=False, indent=2)
            handle.write('\n')
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
        descriptor = os.open(path.parent, os.O_DIRECTORY)
        try: os.fsync(descriptor)
        finally: os.close(descriptor)
    finally:
        if temporary: temporary.unlink(missing_ok=True)


@contextmanager
def locked_file(path):
    descriptor = os.open(path, os.O_CREAT | os.O_RDWR, 0o600)
    try:
        fcntl.flock(descriptor, fcntl.LOCK_EX)
        yield
    finally:
        fcntl.flock(descriptor, fcntl.LOCK_UN)
        os.close(descriptor)


def publish_generation(directory, files):
    """Publish name -> (JSON value, permissions) with one durable pointer swap."""
    directory = Path(directory)
    generation = pointer = None
    published = False
    try:
        generation = Path(tempfile.mkdtemp(prefix='v-', dir=directory))
        os.chmod(generation, 0o750)
        for name, (value, mode) in files.items():
            replace_private(generation / name, value, mode=mode)
        pointer = directory / ('.next-' + generation.name)
        pointer.symlink_to(generation.name, target_is_directory=True)
        os.replace(pointer, directory / 'current')
        published = True
        descriptor = os.open(directory, os.O_DIRECTORY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
    finally:
        if pointer:
            pointer.unlink(missing_ok=True)
        if generation and not published:
            shutil.rmtree(generation, ignore_errors=True)
