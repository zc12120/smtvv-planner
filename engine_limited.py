"""Linux worker-only native process limits; no threaded preexec_fn."""
import os
import ctypes
import resource
import signal
import sys

parent=os.getppid()
if ctypes.CDLL(None,use_errno=True).prctl(1,signal.SIGKILL,0,0,0)!=0:
    raise OSError('Unable to set parent-death signal')
if os.getppid()!=parent or parent==1:
    os._exit(1)
resource.setrlimit(resource.RLIMIT_AS,(512*1024*1024,512*1024*1024))
resource.setrlimit(resource.RLIMIT_CPU,(180,185))
os.execv(sys.argv[1],sys.argv[1:])
