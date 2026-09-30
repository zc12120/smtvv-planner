"""Explicit application construction, separate from HTTP request handling."""
from pathlib import Path
from types import SimpleNamespace
import gzip
import json
import os
import threading
import time
from management import Authelia, SiteStore
from planner import catalog
from static_assets import StaticAssets
from compute_queue import from_environment

SERVICE_FIELDS = frozenset({'ACCOUNTS', 'CATALOG_GZIP', 'WEB', 'CATALOG_JSON', 'STATIC_LOCK', 'SITE', 'PUBLIC_ORIGIN', 'STARTED', 'LOCK', 'AUTH', 'STATE_DIR', 'REMOTE_SYNC', 'LOGIN_POLICY', 'COORDINATOR', 'AUTH_ENABLED', 'TURNSTILE', 'CATALOG', 'STATIC_ASSETS'})


def create_services():
    WEB=Path(__file__).parent/'web'
    LOCK=threading.Semaphore(1)
    REMOTE_SYNC=threading.BoundedSemaphore(8)
    STATIC_LOCK=threading.Lock()
    STATIC_ASSETS=StaticAssets()
    CATALOG=catalog()
    CATALOG['authPortal']='/auth/' if os.environ.get('SMTVV_AUTH_PORTAL')=='/auth/' else ''
    PUBLIC_ORIGIN=os.environ.get('SMTVV_PUBLIC_URL','').rstrip('/')
    if CATALOG['authPortal'] and not PUBLIC_ORIGIN.startswith('https://'):
        raise RuntimeError('SMTVV_PUBLIC_URL must be an HTTPS origin when authentication is enabled')
    AUTH_ENABLED=bool(CATALOG['authPortal'])
    AUTH=Authelia(PUBLIC_ORIGIN,os.environ.get('SMTVV_AUTH_VERIFY_URL','http://127.0.0.1:9091/auth/api/authz/auth-request'),os.environ.get('SMTVV_ADMIN_GROUP','admins')) if AUTH_ENABLED else None
    STATE_DIR=Path(os.environ.get('SMTVV_STATE_DIR') or os.environ.get('STATE_DIRECTORY') or str(Path(__file__).parent/'runtime/site'))
    SITE=SiteStore(STATE_DIR/'settings.json')
    STARTED=time.monotonic()
    ACCOUNTS=None
    LOGIN_POLICY=None
    TURNSTILE=None
    if AUTH_ENABLED and os.environ.get('SMTVV_USERS_FILE'):
        from accounts import Accounts
        if os.environ.get('SMTVV_AUTH_STATE_SHARED')=='1':
            STATE_DIR.mkdir(parents=True,exist_ok=True,mode=0o750)
            os.chmod(STATE_DIR,0o750)
        ACCOUNTS=Accounts(os.environ['SMTVV_USERS_FILE'],os.environ.get('SMTVV_USERS_BOOTSTRAP'))
        if os.environ.get('SMTVV_LOGIN_BOOTSTRAP'):
            from login_policy import LoginPolicy
            from turnstile import TurnstileConfig
            LOGIN_POLICY=LoginPolicy(STATE_DIR/'login-policy',PUBLIC_ORIGIN,os.environ['SMTVV_LOGIN_BOOTSTRAP'])
            LOGIN_POLICY.initialize()
            TURNSTILE=TurnstileConfig(STATE_DIR/'turnstile',PUBLIC_ORIGIN,
                                      testing=os.environ.get('SMTVV_TURNSTILE_TESTING')=='1')
            TURNSTILE.initialize()
    CATALOG['assets']={
        'officialLogo': (WEB/'assets/logo.png').is_file(),
        'elementIcons': (WEB/'assets/elements/phy.png').is_file(),
        'ailmentIcons': (WEB/'assets/ailments/cha.png').is_file(),
    }
    if (WEB/'assets/optimized/story-art.webp').is_file():
        CATALOG['assets']['storyArt']='/assets/optimized/story-art.webp'
    # Catalog data is immutable for the lifetime of this process. Encode/compress it
    # once; every delivery still passes through authorize() and remains no-store.
    CATALOG_JSON=json.dumps(CATALOG,ensure_ascii=False,separators=(',',':')).encode()
    CATALOG_GZIP=gzip.compress(CATALOG_JSON,compresslevel=6,mtime=0)

    COORDINATOR = from_environment()
    return SimpleNamespace(**{key: value for key, value in locals().items() if key in SERVICE_FIELDS})
