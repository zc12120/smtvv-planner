"""Build the local optimizer atomically and invalidate it when its source changes."""
import hashlib
import os
from pathlib import Path
import subprocess
import tempfile
import threading


ROOT = Path(__file__).resolve().parent
BUILD_LOCK = threading.Lock()


def _wsl_path(path):
    drive, tail = os.path.splitdrive(str(path))
    if not drive:
        raise RuntimeError('计算引擎需要位于 WSL 可访问的本地磁盘。')
    return '/mnt/' + drive[0].lower() + tail.replace('\\', '/')


def engine_command(root=ROOT):
    directory = Path(root) / 'native'
    binary = directory / 'optimal-linux'
    source = directory / 'optimal.cpp'
    if os.name == 'nt':
        windows = directory / 'optimal-windows.exe'
        # A source-free distribution carries a prebuilt engine, as Docker does.
        if windows.is_file() and not source.is_file():
            return [str(windows)]
        command = ['wsl.exe', '--exec', _wsl_path(binary)]
    else:
        command = [str(binary)]

    with BUILD_LOCK:
        if not source.is_file():
            if binary.is_file():
                return command
            raise RuntimeError('缺少计算引擎及其源码，请重新安装。')
        digest = hashlib.sha256(source.read_bytes()).hexdigest()
        stamp = directory / 'optimal-linux.sha256'
        if binary.is_file() and stamp.is_file() and stamp.read_text().strip() == digest:
            return command

        # Never compile over a binary another process may still be executing.
        descriptor, temporary_name = tempfile.mkstemp(prefix='.optimal-', dir=directory)
        os.close(descriptor)
        temporary = Path(temporary_name)
        temporary_stamp = temporary.with_suffix('.sha256')
        try:
            compiler = ['g++', '-O3', '-std=c++17', '-o', str(temporary), str(source)]
            if os.name == 'nt':
                compiler = ['wsl.exe', '--exec', 'g++', '-O3', '-std=c++17',
                            '-o', _wsl_path(temporary), _wsl_path(source)]
            subprocess.run(compiler, check=True, capture_output=True, timeout=90)
            temporary.chmod(0o755)
            temporary_stamp.write_text(digest + '\n')
            temporary.replace(binary)
            temporary_stamp.replace(stamp)
        except (OSError, subprocess.SubprocessError) as error:
            raise RuntimeError('计算引擎编译失败，请确认已安装 g++ 并重试。') from error
        finally:
            temporary.unlink(missing_ok=True)
            temporary_stamp.unlink(missing_ok=True)
    return command
