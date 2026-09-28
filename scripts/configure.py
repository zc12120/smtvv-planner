#!/usr/bin/env python3
"""Create an Authelia deployment without putting passwords in process arguments."""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import shlex
import subprocess
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
AUTHELIA_IMAGE = 'authelia/authelia:4.39.25@sha256:a039d87fb842f0af4f83c03434f5fb6ec45d4b46e86b8b3ac571cc104bbe6e6d'


def public_origin(value):
    url = urlsplit(value)
    if (url.scheme != 'https' or not url.hostname or url.username or url.password
            or url.query or url.fragment or url.path not in ('', '/')
            or not re.fullmatch(r'[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?', url.hostname)
            or '.' not in url.hostname or '..' in url.hostname):
        raise ValueError('Use an HTTPS origin with a DNS hostname, e.g. https://planner.example.com')
    # Accessing port also rejects malformed and out-of-range port values.
    if url.port not in (None, 443):
        raise ValueError('The public HTTPS endpoint must use port 443')
    return 'https://' + url.hostname


def session_cookie_name(origin):
    # Cookie headers omit domain/path, so Authelia cannot distinguish two
    # legacy smtvv_session cookies. Give each site a stable, separate name.
    digest = hashlib.sha256(public_origin(origin).encode('ascii')).hexdigest()[:12]
    return 'smtvv_session_' + digest


def new_password(docker_command='docker'):
    command = shlex.split(docker_command) + [
        'run', '--rm', '--network', 'none', AUTHELIA_IMAGE, 'authelia',
        'crypto', 'hash', 'generate', 'argon2', '--random',
        '--random.length', '32', '--random.charset', 'rfc3986',
    ]
    result = subprocess.run(command, capture_output=True, text=True, check=False)
    if result.returncode:
        # CLI output may contain a generated password: never echo it on failure.
        raise RuntimeError('Authelia password generation failed; check Docker/image availability')
    password = re.search(r'^Random Password:\s*(\S+)\s*$', result.stdout, re.M)
    digest = re.search(r'^Digest:\s*(\$argon2id\$\S+)\s*$', result.stdout, re.M)
    if not password or not digest:
        raise RuntimeError('Unexpected Authelia password output; no credentials were displayed')
    return password.group(1), digest.group(1)


def write_file(path, content, mode=0o600):
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, mode)
    with os.fdopen(descriptor, 'w', encoding='utf-8') as handle:
        handle.write(content)


def content_security_policy():
    # Hash only scripts shipped in the reviewed HTML templates. No client input,
    # settings, notice text or runtime state can extend this allowlist.
    hashes=set()
    for name in ('index.html','demon.html','skill.html','essence.html','admin/index.html','auth/index.html'):
        page=(ROOT/'web'/name).read_text(encoding='utf-8')
        for source in re.findall(r'<script\b(?![^>]*\bsrc\s*=)[^>]*>(.*?)</script>',page,re.S|re.I):
            digest=base64.b64encode(hashlib.sha256(source.encode('utf-8')).digest()).decode('ascii')
            hashes.add("'sha256-"+digest+"'")
    return ("default-src 'self'; base-uri 'none'; script-src 'self' "+' '.join(sorted(hashes))+
            " https://challenges.cloudflare.com; style-src 'self'; style-src-attr 'unsafe-inline'; "
            "img-src 'self' data: blob:; font-src 'self'; connect-src 'self' https://challenges.cloudflare.com; "
            "frame-src https://challenges.cloudflare.com; frame-ancestors 'none'; object-src 'none'; form-action 'self'")


def nginx_locations(origin, app='app:8765', auth='authelia:9091', static_root='/srv/web'):
    hostname = urlsplit(origin).hostname
    auth_check = '''
    auth_request /_smtvv_access;
    auth_request_set $smtvv_redirect $upstream_http_location;
'''
    admin_check=auth_check.replace('/_smtvv_access','/_smtvv_admin')
    proxy = '''
    proxy_pass http://@APP@;
    proxy_http_version 1.1;
    proxy_set_header Host @HOST@;
    proxy_set_header Connection "";
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto https;
    proxy_set_header Remote-User "";
    proxy_set_header Remote-Groups "";
    proxy_set_header Remote-Email "";
    proxy_connect_timeout 3s;
    proxy_read_timeout 30s;
'''
    value = r'''# Generated for one hostname. Include inside its existing TLS server block.
client_max_body_size 64k;
client_body_timeout 15s;
# $uri is nginx's decoded path without the query string. Match a literal
# backslash before location-specific access checks or rate-limit selection.
if ($uri ~ "\\\\") { return 400; }
proxy_hide_header Cache-Control;
proxy_hide_header Expires;
add_header Cache-Control "no-store" always;
add_header X-Content-Type-Options nosniff always;
add_header Referrer-Policy same-origin always;
add_header X-Frame-Options DENY always;
add_header Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=(), usb=()" always;
add_header Content-Security-Policy "@CSP@" always;

location = /healthz {
    access_log off;
    proxy_pass http://@APP@/healthz;
    proxy_connect_timeout 3s;
    proxy_read_timeout 3s;
}

location = /_smtvv_access {
    internal;
    proxy_pass http://@APP@/_internal/access;
    proxy_pass_request_body off;
    proxy_set_header Content-Length "";
    proxy_set_header Connection "";
    proxy_set_header Host @HOST@;
    proxy_set_header X-Original-URI $request_uri;
    proxy_set_header X-Original-Method $request_method;
    proxy_set_header X-Forwarded-Proto https;
    proxy_set_header X-Forwarded-Host @HOST@;
    proxy_set_header X-Forwarded-URI $request_uri;
    proxy_set_header X-Forwarded-Method $request_method;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_connect_timeout 3s;
    proxy_read_timeout 10s;
}

location = /_smtvv_admin {
    internal;
    proxy_pass http://@APP@/_internal/admin-access;
    proxy_pass_request_body off;
    proxy_set_header Content-Length "";
    proxy_set_header Connection "";
    proxy_set_header Host @HOST@;
    proxy_set_header X-Original-URI $request_uri;
    proxy_set_header X-Original-Method $request_method;
    proxy_connect_timeout 3s;
    proxy_read_timeout 10s;
}

location = /_smtvv_login_gate {
    internal;
    proxy_pass http://@APP@/_internal/login-gate;
    proxy_pass_request_body off;
    proxy_set_header Content-Length "";
    proxy_set_header Connection "";
    proxy_set_header Cookie $http_cookie;
    proxy_set_header Host @HOST@;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_connect_timeout 3s;
    proxy_read_timeout 10s;
}

location ^~ /_internal/ { return 404; }

# Public presentation assets contain no planner data or authentication state.
location ^~ /auth/theme/ {
    root @STATIC@;
    try_files $uri =404;
}
location ^~ /assets/p3reload/ {
    root @STATIC@;
    try_files $uri =404;
}

location = /auth { return 302 @ORIGIN@/auth/; }
location = /auth/ {
    root @STATIC@;
    try_files /auth/index.html =404;
    add_header Cache-Control "no-store" always;
    add_header X-Content-Type-Options nosniff always;
    add_header Referrer-Policy same-origin always;
    add_header X-Frame-Options DENY always;
    add_header Content-Security-Policy "default-src 'self'; base-uri 'none'; script-src 'self' 'sha256-1hdOxSBg4DG6NvOqXerA1/xBsAx7sBLNIDLqpgGLu9Q=' https://challenges.cloudflare.com; style-src 'self'; img-src 'self' data:; connect-src 'self' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; child-src https://challenges.cloudflare.com; frame-ancestors 'none'; object-src 'none'; form-action 'self'" always;
}
location = /api/login/turnstile {
    limit_req zone=smtvv_login burst=5 nodelay;
    limit_req_status 429;
    error_page 429 = @smtvv_login_busy;
''' + proxy + '''}
location ^~ /auth/api/firstfactor {
    auth_request /_smtvv_login_gate;
    error_page 403 = @smtvv_turnstile_required;
    add_header Set-Cookie "smtvv_turnstile=; Path=/auth/api/firstfactor; Max-Age=0; HttpOnly; Secure; SameSite=Strict" always;
    add_header Cache-Control "no-store" always;
    add_header X-Content-Type-Options nosniff always;
''' + proxy.replace('@APP@', '@AUTH@') + '''}
location ^~ /auth/ {
    # Authelia supplies its own nonce-based CSP. Defining response headers here
    # avoids inheriting the static application's script-hash policy.
    add_header Cache-Control "no-store" always;
    add_header X-Content-Type-Options nosniff always;
    add_header Referrer-Policy same-origin always;
    proxy_pass http://@AUTH@;
    proxy_http_version 1.1;
    proxy_set_header Host @HOST@;
    proxy_set_header Connection "";
    proxy_set_header X-Forwarded-Proto https;
    proxy_set_header X-Forwarded-Host @HOST@;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Real-IP $remote_addr;
    # Keep Authelia's native forms, CSP and authentication endpoints intact.
    proxy_set_header Accept-Encoding "";
    sub_filter '</head>' '<link rel="stylesheet" href="/auth/theme/p3reload.css?v=p3r-20260913-2"><script defer src="/auth/theme/p3reload.js?v=p3r-20260913-2"></script></head>';
    sub_filter_once on;
    proxy_connect_timeout 3s;
    proxy_read_timeout 30s;
}

location @smtvv_unauthorized {
    default_type application/json;
    return 401 '{"error":"登录已过期，请重新登录。","login":"/auth/"}';
}

location @smtvv_turnstile_required {
    default_type application/json;
    add_header Cache-Control "no-store" always;
    return 403 '{"error":"请完成人机验证后重试。"}';
}

location @smtvv_login_busy {
    default_type application/json;
    add_header Cache-Control "no-store" always;
    add_header Retry-After 10 always;
    return 429 '{"error":"人机验证尝试过于频繁，请稍后重试。"}';
}

location @smtvv_busy {
    default_type application/json;
    add_header Cache-Control "no-store" always;
    add_header Retry-After 10 always;
    return 429 '{"error":"计算请求过于频繁，请稍后重试。"}';
}
'''
    value += '\nlocation = /api/login/options {\n' + proxy + '}\n'
    # Worker credentials are checked by the application, independently of
    # browser login/Origin checks. Never expose the generic internal namespace.
    value += '\nlocation = /api/compute/worker {\n    client_max_body_size 9m;\n' + proxy + '}\n'
    value += '\nlocation = /admin { return 302 @ORIGIN@/admin/; }\n'
    value += '\nlocation ^~ /admin/ {\n' + admin_check + '''    error_page 401 =302 $smtvv_redirect;
    root @STATIC@;
    index index.html;
    try_files $uri $uri/ @smtvv_admin_fallback;
}\n'''
    value += '\nlocation @smtvv_admin_fallback {\n' + admin_check + '    error_page 401 =302 $smtvv_redirect;\n' + proxy + '}\n'
    value += '\nlocation ^~ /api/admin/ {\n' + admin_check + '    error_page 401 = @smtvv_unauthorized;\n' + proxy + '}\n'
    for path in ('/api/optimal/start','/api/routes/start','/api/plan'):
        value += '\nlocation = '+path+' {\n' + auth_check + '''
    error_page 401 = @smtvv_unauthorized;
    limit_req zone=smtvv_start burst=5 nodelay;
    limit_req_status 429;
    error_page 429 = @smtvv_busy;
''' + proxy + '}\n'
    for path in ('/api/fuse','/api/recipes'):
        value += '\nlocation = '+path+' {\n' + auth_check + '''
    error_page 401 = @smtvv_unauthorized;
    limit_req zone=smtvv_query burst=10 nodelay;
    limit_req_status 429;
    error_page 429 = @smtvv_busy;
''' + proxy + '}\n'
    value += '\nlocation /api/ {\n' + auth_check + '    error_page 401 = @smtvv_unauthorized;\n' + proxy + '}\n'
    # The runtime view is generated by the application even when the complete
    # manifest exists on disk. Keep the same access check as other planner data.
    value += '\nlocation = /assets/demons/manifest.json {\n' + auth_check + '    error_page 401 = @smtvv_unauthorized;\n' + proxy + '}\n'
    value += '\nlocation / {\n' + auth_check + '''    error_page 401 =302 $smtvv_redirect;
    root @STATIC@;
    index index.html;
    try_files $uri $uri/ @smtvv_static_fallback;
}\n'''
    # Missing optional portrait manifests are synthesized by the application.
    value += '\nlocation @smtvv_static_fallback {\n' + auth_check + '    error_page 401 =302 $smtvv_redirect;\n' + proxy + '}\n'
    for key, replacement in {'@APP@': app, '@AUTH@': auth, '@HOST@': hostname, '@ORIGIN@': origin, '@STATIC@': static_root,'@CSP@':content_security_policy()}.items():
        value = value.replace(key, replacement)
    return value


def configuration(origin):
    hostname = urlsplit(origin).hostname
    return {
        'theme': 'dark',
        # The upstream auto-healthcheck writes into /app. Our container uses
        # a read-only root filesystem and an explicit HTTP healthcheck instead.
        'server': {'address': 'tcp://:9091/auth', 'disable_healthcheck': True},
        'log': {'level': 'info'},
        'totp': {'disable': True},
        'webauthn': {'disable': True},
        'authentication_backend': {
            'password_reset': {'disable': True},
            'file': {'path': '/planner-state/accounts/users_database.yml'},
        },
        'access_control': {
            'default_policy': 'deny',
            'rules': [{'domain': hostname, 'policy': 'one_factor'}],
        },
        'session': {
            'name': session_cookie_name(origin), 'same_site': 'lax',
            # Administrators can override these defaults from the website.
            # Disable remember-me with numeric -1, never the string '-1s'.
            'expiration': '24h', 'inactivity': '12h', 'remember_me': '30d',
            'cookies': [{'domain': hostname, 'authelia_url': origin + '/auth/',
                         'default_redirection_url': origin + '/'}],
        },
        'regulation': {'max_retries': 5, 'find_time': '2m', 'ban_time': '10m'},
        'storage': {'local': {'path': '/state/db.sqlite3'}},
        'notifier': {'filesystem': {'filename': '/state/notifications.txt'}},
    }


def login_bootstrap(config):
    """Share only non-secret session fields with the unprivileged application."""
    fields = ('name', 'domain', 'authelia_url', 'default_redirection_url',
              'same_site', 'expiration', 'inactivity', 'remember_me')
    session = config['session']
    result = {key: session[key] for key in fields if key in session}
    result['cookies'] = [{key: cookie[key] for key in fields if key in cookie}
                         for cookie in session['cookies']]
    return {'session': result}


def gateway_configuration(origin):
    return '''worker_processes auto;
pid /tmp/nginx.pid;
error_log /dev/stderr warn;
events { worker_connections 512; }
http {
    include /etc/nginx/mime.types;
    access_log /dev/stdout;
    client_body_temp_path /tmp/client_temp;
    proxy_temp_path /tmp/proxy_temp;
    fastcgi_temp_path /tmp/fastcgi_temp;
    uwsgi_temp_path /tmp/uwsgi_temp;
    scgi_temp_path /tmp/scgi_temp;
    # The published port is loopback-only. The external HTTPS proxy overwrites XFF.
    set_real_ip_from 127.0.0.1;
    set_real_ip_from ::1;
    set_real_ip_from 172.16.0.0/12;
    real_ip_header X-Forwarded-For;
    real_ip_recursive on;
    gzip on;
    gzip_min_length 1024;
    gzip_vary on;
    gzip_proxied any;
    gzip_types application/json application/javascript text/javascript text/css image/svg+xml;
    limit_req_zone $binary_remote_addr zone=smtvv_start:1m rate=10r/m;
    limit_req_zone $binary_remote_addr zone=smtvv_query:1m rate=60r/m;
    limit_req_zone $binary_remote_addr zone=smtvv_login:1m rate=12r/m;
    server {
        listen 8080;
        server_name @HOST@;
        if ($host != "@HOST@") { return 421; }
@LOCATIONS@
    }
}
'''.replace('@HOST@', urlsplit(origin).hostname).replace('@LOCATIONS@', nginx_locations(origin))


def configure(origin, directory, docker_command='docker', username=None):
    origin = public_origin(origin)
    username = username or 'planner-' + secrets.token_hex(3)
    if not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9_-]{2,63}', username):
        raise ValueError('Username must contain 3–64 letters, digits, underscores or hyphens')
    if directory.exists() and any(directory.iterdir()):
        raise ValueError('Runtime directory is not empty; refusing to replace accounts or encryption keys')
    password, digest = new_password(docker_command)
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(directory, 0o700)
    for name in ('authelia', 'secrets'):
        (directory / name).mkdir(mode=0o700)
    config = configuration(origin)
    users = {'users': {username: {'displayname': 'Planner Administrator', 'password': digest,
                                  'email': username + '@' + urlsplit(origin).hostname,
                                  'groups': ['admins']}}}
    # JSON is valid YAML; this avoids a second parser or a string-escaping layer.
    for name, data in [('configuration.yml', config), ('users_database.yml', users)]:
        write_file(directory / 'authelia' / name, json.dumps(data, ensure_ascii=False, indent=2) + '\n')
    # The unprivileged application bootstraps its private named volume from this
    # read-only bind. Ancestor directories stay 0700 on the host.
    os.chmod(directory / 'authelia/users_database.yml', 0o644)
    for name in ('session', 'storage', 'reset'):
        write_file(directory / 'secrets' / name, secrets.token_urlsafe(48) + '\n')
    write_file(directory / 'nginx.conf', gateway_configuration(origin), 0o644)
    write_file(directory / 'login-bootstrap.json', json.dumps(login_bootstrap(config), indent=2) + '\n', 0o644)
    write_file(directory / 'openresty-locations.conf', nginx_locations(origin, '127.0.0.1:8765', '127.0.0.1:9091', '/www/sites/smtvv/index'), 0o644)
    write_file(directory / 'credentials.txt', 'URL: ' + origin + '/auth/\nUsername: ' + username + '\nPassword: ' + password + '\n')
    write_file(directory / 'deployment.json', json.dumps({'public_url': origin, 'username': username}, indent=2) + '\n')
    return {'public_url': origin, 'admin_url': origin+'/admin/', 'username': username, 'credentials_file': str(directory / 'credentials.txt')}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('public_url', help='Public HTTPS origin, without a path')
    parser.add_argument('--runtime-dir', type=Path, default=ROOT / 'runtime')
    parser.add_argument('--docker-command', default='docker', help='Docker command; argv is parsed without a shell')
    parser.add_argument('--username')
    args = parser.parse_args()
    try:
        result = configure(args.public_url, args.runtime_dir, args.docker_command, args.username)
    except (OSError, ValueError, RuntimeError) as error:
        parser.exit(1, str(error) + '\n')
    env_file = ROOT / '.env'
    if not env_file.exists():
        write_file(env_file, 'SMTVV_BIND=127.0.0.1\nSMTVV_PORT=8088\nSMTVV_PUBLIC_URL=' + result['public_url'] + '\n')
    print(json.dumps(result, ensure_ascii=False))
    print('Store the credentials in a password manager. Keep runtime/ private and out of Git.')


if __name__ == '__main__':
    main()
