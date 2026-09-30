from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlsplit, parse_qs
from email.utils import formatdate, parsedate_to_datetime
import json
import gzip
import logging
import argparse
import os
import threading
import time
import re
import socket
from static_assets import StaticAssets, accepts_gzip
from management import Access, Authelia, SiteStore, ManagementError, admin_path, normalized_path, jobs_snapshot, cancel_job
from planner import catalog, plan, inspect_fusion, reverse_recipes, skill_detail
from routes import start_routes, get_routes, cancel_routes
from optimal import start_optimal, get_optimal, cancel_optimal, SearchBusy
from compute_queue import ComputeError

from services import create_services, SERVICE_FIELDS

_DEFAULT_SERVICES = None
_DEFAULT_LOCK = threading.Lock()


def default_services():
    global _DEFAULT_SERVICES
    if _DEFAULT_SERVICES is None:
        with _DEFAULT_LOCK:
            if _DEFAULT_SERVICES is None:
                _DEFAULT_SERVICES = create_services()
    return _DEFAULT_SERVICES


def __getattr__(name):
    # Backward-compatible imports for local launchers; construction is lazy.
    if name in SERVICE_FIELDS:
        return getattr(default_services(), name)
    raise AttributeError(name)


class DefaultServicesView:
    def __getattr__(self, name):
        # Legacy embedding/tests may override a default; injected services never
        # consult module globals and are independent of one another.
        if name in globals():
            return globals()[name]
        return __getattr__(name)


DEFAULT_SERVICES = DefaultServicesView()

def check_access(cookie,uri,method='GET',administrator=False, services=None):
    services = services or DEFAULT_SERVICES
    administrator=administrator or admin_path(uri)
    if administrator:
        if not services.AUTH_ENABLED:return Access(403)
        return services.AUTH.verify(cookie,uri,method,require_admin=True)
    if not services.AUTH_ENABLED or not services.SITE.requires_login():return Access(204)
    return services.AUTH.verify(cookie,uri,method)

class PlannerHTTPServer(ThreadingHTTPServer):
    # Static portraits can arrive in bursts; keep the accept queue ahead of the proxy.
    request_queue_size=256
    daemon_threads=True
    max_request_threads=48

    def __init__(self,*args,services=None,**kwargs):
        self.services = services if services is not None else DEFAULT_SERVICES
        self._request_slots=threading.BoundedSemaphore(self.max_request_threads)
        super().__init__(*args,**kwargs)

    def process_request(self,request,client_address):
        if not self._request_slots.acquire(blocking=False):
            try:
                request.settimeout(0.5)
                request.sendall(b'HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\n'
                                b'Cache-Control: no-store\r\nRetry-After: 2\r\nConnection: close\r\n\r\n')
            except OSError:pass
            finally:self.shutdown_request(request)
            return
        try:super().process_request(request,client_address)
        except Exception:
            self._request_slots.release()
            raise

    def process_request_thread(self,request,client_address):
        try:super().process_request_thread(request,client_address)
        finally:self._request_slots.release()

class Handler(SimpleHTTPRequestHandler):
    # Content-Length is explicit on every response, allowing browser/proxy
    # connections to be reused without reconnecting for every small asset.
    protocol_version='HTTP/1.1'
    timeout=15
    @property
    def services(self):
        return getattr(self.server, 'services', DEFAULT_SERVICES)

    def __init__(self,*args,**kwargs):
        self.server = args[2] if len(args) > 2 else kwargs['server']
        super().__init__(*args,directory=str(self.services.WEB),**kwargs)
    def setup(self):
        super().setup()
        # Headers and small JSON bodies are separate writes. Persistent TCP
        # connections must not wait for a delayed ACK between those writes.
        if self.connection.family in (socket.AF_INET,socket.AF_INET6):
            self.connection.setsockopt(socket.IPPROTO_TCP,socket.TCP_NODELAY,1)
    def log_message(self, format, *args):
        # Do not let one line per image fill a terminal pipe and stall the origin.
        # Keep client/API failures visible for local diagnosis.
        status = str(args[1]) if len(args) > 1 else ''
        if status.startswith(('4', '5')):
            super().log_message(format, *args)
    def end_headers(self):
        if getattr(self,'_streaming_static',False):
            self.send_header('Cache-Control','no-store' if self.services.AUTH_ENABLED else 'no-cache')
        super().end_headers()
    def send_json(self,content,status=200,headers=None):
        data=json.dumps(content,ensure_ascii=False).encode()
        self.send_response(status);self.send_header('Content-Type','application/json; charset=utf-8');self.send_header('Content-Length',str(len(data)));self.send_header('Cache-Control','no-store')
        if status in (429,503):self.send_header('Retry-After','2')
        for key,value in (headers or {}).items():self.send_header(key,value)
        if self.close_connection:self.send_header('Connection','close')
        self.end_headers()
        if self.command=='HEAD':return
        try:self.wfile.write(data)
        except (BrokenPipeError,ConnectionResetError):pass
    def send_catalog(self):
        compressed=accepts_gzip(self.headers.get('Accept-Encoding',''))
        data=self.services.CATALOG_GZIP if compressed else self.services.CATALOG_JSON
        self.send_response(200)
        self.send_header('Content-Type','application/json; charset=utf-8')
        self.send_header('Content-Length',str(len(data)))
        self.send_header('Cache-Control','no-store')
        self.send_header('Vary','Accept-Encoding')
        if compressed:self.send_header('Content-Encoding','gzip')
        self.end_headers()
        if self.command!='HEAD':
            try:self.wfile.write(data)
            except (BrokenPipeError,ConnectionResetError):pass
    def send_static(self):
        path=Path(self.translate_path(self.path))
        parsed=urlsplit(self.path)
        if parsed.path.endswith('/'):
            for name in ('index.html','index.htm'):
                index=path/name
                if index.is_file():
                    path=index
                    break
        runtime_portraits=parsed.path=='/assets/demons/manifest.json' and parse_qs(parsed.query).get('view')==['runtime']
        try:asset=self.services.STATIC_ASSETS.get(path,runtime_portraits)
        except (OSError,ValueError):asset=None
        if asset is not None:
            compressed=bool(asset.compressed) and accepts_gzip(self.headers.get('Accept-Encoding',''))
            data=asset.compressed if compressed else asset.data
            etag='"'+asset.etag+('-gzip' if compressed else '')+'"'
            # The authenticated deployment keeps its no-store policy. A local
            # unauthenticated preview can revalidate files or reuse hashed copies.
            immutable=bool(re.search(r'-[a-f0-9]{12}-\d+\.(webp|woff2)$',path.name))
            policy='no-store' if self.services.AUTH_ENABLED else 'public, max-age=31536000, immutable' if immutable else 'no-cache'
            fresh=False
            if not self.services.AUTH_ENABLED:
                tags=self.headers.get('If-None-Match')
                if tags:fresh=any(tag.strip().removeprefix('W/') in ('*',etag) for tag in tags.split(','))
                elif self.headers.get('If-Modified-Since'):
                    try:fresh=int(asset.modified)<=parsedate_to_datetime(self.headers['If-Modified-Since']).timestamp()
                    except (ValueError,TypeError,OverflowError):pass
            self.send_response(304 if fresh else 200)
            self.send_header('Content-Type',self.guess_type(str(path)))
            self.send_header('Content-Length',str(len(data)))
            self.send_header('Last-Modified',formatdate(asset.modified,usegmt=True))
            self.send_header('ETag',etag)
            self.send_header('Cache-Control',policy)
            if asset.compressed:self.send_header('Vary','Accept-Encoding')
            if compressed:self.send_header('Content-Encoding','gzip')
            self.end_headers()
            if not fresh and self.command!='HEAD':
                try:self.wfile.write(data)
                except (BrokenPipeError,ConnectionResetError):pass
            return
        # Large files and directory handling retain the standard streaming path.
        if self.services.AUTH_ENABLED:
            # SimpleHTTPRequestHandler implements its own date conditional.
            # Authenticated responses must remain no-store, including large files.
            for header in ('If-Modified-Since','If-None-Match'):
                if header in self.headers:del self.headers[header]
        self._streaming_static=True
        try:
            with self.services.STATIC_LOCK:stream=super().send_head()
        finally:self._streaming_static=False
        if stream is None:return
        try:
            if self.command=='HEAD':return
            while True:
                with self.services.STATIC_LOCK:data=stream.read(64*1024)
                if not data:break
                self.wfile.write(data)
        except (BrokenPipeError,ConnectionResetError):pass
        finally:stream.close()
    def read_json(self,max_bytes=65536):
        if self.headers.get('Transfer-Encoding') or len(self.headers.get_all('Content-Length',[]))!=1:
            raise ManagementError('请求大小不合法。')
        try:size=int(self.headers.get('Content-Length',0))
        except ValueError:raise ManagementError('请求大小不合法。') from None
        if not 0<size<max_bytes:raise ManagementError('请求大小不合法。')
        try:body=json.loads(self.rfile.read(size))
        except (ValueError,TypeError):raise ManagementError('请求格式不合法。') from None
        if not isinstance(body,dict):raise ManagementError('请求格式不合法。')
        return body
    def remote_ip(self):
        return self.headers.get('X-Real-IP') or self.client_address[0]
    def authorize(self):
        decision=check_access(self.headers.get('Cookie',''),self.path,self.command,services=self.services)
        if decision.status==204:return decision
        self.close_connection=True
        message={401:'请先登录。',403:'需要管理员权限。',503:'认证服务暂时不可用，请稍后重试。'}.get(decision.status,'访问被拒绝。')
        self.send_json({'error':message,'login':'/auth/'},decision.status,{'Location':decision.location} if decision.location else None)
        return None

    def do_GET(self):
      try:
        # GET/HEAD bodies are not consumed by this origin. Never interpret their
        # leftover bytes as another request on a persistent connection.
        lengths=self.headers.get_all('Content-Length',[])
        if self.headers.get('Transfer-Encoding') or len(lengths)>1 or any(value!='0' for value in lengths):
            self.close_connection=True
        path=normalized_path(self.path)
        if path=='/healthz':self.send_json({'status':'ok'});return
        if path=='/api/login/options':
            if self.services.LOGIN_POLICY is None:raise ManagementError('登录设置暂时不可用，请稍后重试。',503)
            options=self.services.LOGIN_POLICY.snapshot()
            options['turnstile']=self.services.TURNSTILE.public_snapshot() if self.services.TURNSTILE else {'enabled':False}
            self.send_json(options);return
        if path=='/_internal/login-gate':
            allowed=self.services.TURNSTILE is None or self.services.TURNSTILE.consume(self.headers.get('Cookie',''),self.remote_ip())
            self.send_response(204 if allowed else 403)
            self.send_header('Cache-Control','no-store');self.send_header('Content-Length','0')
            self.end_headers();return
        if path in ('/_internal/access','/_internal/admin-access'):
            decision=check_access(self.headers.get('Cookie',''),self.headers.get('X-Original-URI','/'),self.headers.get('X-Original-Method','GET'),path.endswith('/admin-access'),services=self.services)
            self.send_response(decision.status)
            self.send_header('Cache-Control','no-store');self.send_header('Content-Length','0')
            if decision.location:self.send_header('Location',decision.location)
            self.end_headers();return
        identity=self.authorize()
        if identity is None:return
        if path.startswith('/api/admin'):
            self.admin_get(path,identity);return
        if path=='/api/site':
            state=self.services.SITE.snapshot()
            if not self.services.AUTH_ENABLED:state['settings']['requireLogin']=False
            state['administrator']=bool(self.services.AUTH and self.services.AUTH.verify(self.headers.get('Cookie',''),'/admin/',require_admin=True).status==204)
            self.send_json(state);return
        if path=='/assets/demons/manifest.json' and not (self.services.WEB/'assets/demons/manifest.json').is_file():
            self.send_json({'demons':{},'essences':{}})
        elif path=='/api/catalog':self.send_catalog()
        elif path=='/api/skill':
            name=parse_qs(urlsplit(self.path).query).get('name',[''])[0]
            try:self.send_json(skill_detail(name))
            except ValueError as e:self.send_json({'error':str(e)},404)
        else:
            self.send_static()
      except ManagementError as error:self.send_json({'error':str(error)},error.status)

    def admin_get(self,path,identity):
        if path=='/api/admin/overview':
            state=self.services.SITE.snapshot(history=True)
            login_policy=self.services.LOGIN_POLICY.snapshot(history=True) if self.services.LOGIN_POLICY else None
            turnstile=self.services.TURNSTILE.snapshot(history=True) if self.services.TURNSTILE else None
            if login_policy:
                state['history']=sorted(state['history']+login_policy['history'],key=lambda event:event['at'],reverse=True)[:100]
            if turnstile:
                state['history']=sorted(state['history']+turnstile['history'],key=lambda event:event['at'],reverse=True)[:100]
            self.send_json({**state,'account':{'username':identity.username,'group':self.services.AUTH.admin_group,'canChangePassword':self.services.ACCOUNTS is not None},
                            'loginPolicy':login_policy,
                            'turnstile':turnstile,
                            'version':self.services.CATALOG['version'],'uptime':round(time.monotonic()-self.services.STARTED),
                            'catalog':{'demons':len(self.services.CATALOG['demons']),'skills':len(self.services.CATALOG['skills'])},
                            'jobs':jobs_snapshot(self.services.COORDINATOR)})
        elif path=='/api/admin/settings':self.send_json(self.services.SITE.snapshot())
        elif path=='/api/admin/login-policy':
            if self.services.LOGIN_POLICY is None:raise ManagementError('此部署尚未启用登录设置。',503)
            self.send_json(self.services.LOGIN_POLICY.snapshot(history=True))
        elif path=='/api/admin/turnstile':
            if self.services.TURNSTILE is None:raise ManagementError('此部署尚未启用 Turnstile 设置。',503)
            self.send_json(self.services.TURNSTILE.snapshot(history=True))
        elif path=='/api/admin/jobs':self.send_json(jobs_snapshot(self.services.COORDINATOR))
        elif path=='/api/admin/audit':self.send_json({'items':self.services.SITE.snapshot(history=True)['history']})
        elif path=='/api/admin/export':
            self.send_json({'schema':1,'settings':self.services.SITE.snapshot()['settings']},headers={'Content-Disposition':'attachment; filename="site-settings.json"'})
        else:self.send_json({'error':'管理接口不存在。'},404)
    def do_HEAD(self):
        self.do_GET()
    def do_POST(self):
        try:path=normalized_path(self.path)
        except ManagementError as error:self.close_connection=True;self.send_json({'error':str(error)},error.status);return
        if path=='/api/compute/worker':
            self.worker_post();return
        if path=='/api/login/turnstile':
            try:
                if not self.services.CATALOG['authPortal'] or self.headers.get('Origin')!=self.services.PUBLIC_ORIGIN:
                    raise ManagementError('请求来源无效，请从本站登录页重新操作。',403)
                if self.services.TURNSTILE is None:raise ManagementError('人机验证暂时不可用，请稍后重试。',503)
                body=self.read_json()
                if set(body)!={'token'}:raise ManagementError('人机验证请求格式不合法。')
                result,cookie=self.services.TURNSTILE.challenge(body['token'],self.remote_ip())
                self.send_json(result,headers={'Set-Cookie':cookie} if cookie else None)
            except ManagementError as error:
                self.close_connection=True;self.send_json({'error':str(error)},error.status)
            except Exception:
                logging.exception('Turnstile verification failed')
                self.close_connection=True;self.send_json({'error':'人机验证暂时不可用，请稍后重试。'},503)
            return
        try:
            identity=self.authorize()
            if identity is None:return
        except ManagementError as error:self.close_connection=True;self.send_json({'error':str(error)},error.status);return
        # The gateway authenticates first. Requiring the configured Origin on
        # every mutation also blocks same-site sibling-domain CSRF requests.
        if self.services.CATALOG['authPortal'] and self.headers.get('Origin')!=self.services.PUBLIC_ORIGIN:
            self.close_connection=True
            self.send_json({'error':'请求来源无效，请从本站页面重新操作。'},403)
            return
        if path.startswith('/api/admin'):
            self.admin_post(path,identity);return
        operation={'/api/plan':plan,'/api/fuse':inspect_fusion,'/api/recipes':reverse_recipes,'/api/routes/start':start_routes,'/api/routes/status':get_routes,'/api/routes/cancel':cancel_routes,'/api/optimal/start':start_optimal,'/api/optimal/status':get_optimal,'/api/optimal/cancel':cancel_optimal}.get(path)
        if self.services.COORDINATOR:
            operation={
                '/api/optimal/start':self.services.COORDINATOR.submit,'/api/optimal/status':self.services.COORDINATOR.snapshot,
                '/api/optimal/cancel':self.services.COORDINATOR.cancel,'/api/routes/start':lambda r:self.services.COORDINATOR.submit(r,'routes'),
                '/api/routes/status':self.services.COORDINATOR.routes_snapshot,'/api/routes/cancel':self.services.COORDINATOR.cancel,
                **{'/api/'+kind:(lambda r,k=kind:self.services.COORDINATOR.synchronous(r,k)) for kind in ('plan','fuse','recipes')}
            }.get(path)
        if not operation:self.close_connection=True;self.send_json({'error':'接口不存在'},404);return
        acquired=False;status=200
        gate=self.services.REMOTE_SYNC if self.services.COORDINATOR else self.services.LOCK
        try:
            request=self.read_json()
            if path in ('/api/plan','/api/fuse','/api/recipes','/api/routes/start','/api/optimal/start') and self.services.SITE.paused():
                import optimal
                request_id=request.get('requestId')
                existing=path=='/api/optimal/start' and isinstance(request_id,str) and (self.services.COORDINATOR.exists(request_id) if self.services.COORDINATOR else optimal.job_exists(request_id))
                if not existing:
                    self.send_json({'error':'站点维护中，暂时停止创建新的计算。已有任务可以继续查看。','maintenance':True},503);return
            if path in ('/api/optimal/status','/api/optimal/cancel','/api/routes/cancel') or self.services.COORDINATOR and path in ('/api/optimal/start','/api/routes/start'):
                # These operations only snapshot state or signal cancellation;
                # they must remain available while a new graph is being built.
                content=operation(request)
            else:
                acquired=gate.acquire(blocking=False) if self.services.COORDINATOR else gate.acquire(timeout=20)
                if not acquired:content={'error':'计算繁忙，请稍后重试。'};status=503
                else:content=operation(request)
        except SearchBusy as e:
            content={'error':str(e)};status=429
        except ComputeError as e:
            content={'error':str(e)};status=e.status
        except (ValueError,TypeError,KeyError) as e:
            self.close_connection=True;content={'error':str(e)};status=400
        except ManagementError as e:
            self.close_connection=True;content={'error':str(e)};status=e.status
        except Exception:
            logging.exception('Local planner request failed: %s',self.path)
            self.close_connection=True;content={'error':'计算服务暂时出错，请重试。'};status=500
        finally:
            if acquired:gate.release()
        # A slow or disconnected client must not hold up status/cancel requests.
        try:self.send_json(content,status)
        except (BrokenPipeError,ConnectionResetError):pass

    def worker_post(self):
        if self.services.COORDINATOR is None:
            self.close_connection=True;self.send_json({'error':'接口不存在'},404);return
        try:
            # Authenticate before accepting a potentially large result body.
            import hashlib,hmac
            authorization=self.headers.get('Authorization','')
            digest=hashlib.sha256(authorization.removeprefix('Bearer ').encode()).hexdigest()
            if not authorization.startswith('Bearer ') or not any(hmac.compare_digest(digest,v['tokenSha256']) for v in self.services.COORDINATOR.workers.values()):
                raise ComputeError('工作节点认证失败。',401)
            body=self.read_json(9*1024*1024)
            self.send_json(self.services.COORDINATOR.worker_call(authorization,body))
        except (ComputeError,ManagementError) as error:
            self.close_connection=True;self.send_json({'error':str(error)},error.status)
        except (ValueError,TypeError,KeyError):
            self.close_connection=True;self.send_json({'error':'工作节点请求不合法。'},400)
        except Exception:
            logging.exception('Compute coordinator operation failed')
            self.close_connection=True;self.send_json({'error':'计算调度暂时不可用。'},503)

    def admin_post(self,path,identity):
        try:
            body=self.read_json()
            if path=='/api/admin/settings':
                if set(body)!={'revision','patch'}:raise ManagementError('设置请求字段不合法。')
                self.send_json(self.services.SITE.update(body['patch'],body['revision'],identity.username))
            elif path=='/api/admin/login-policy':
                if self.services.LOGIN_POLICY is None:raise ManagementError('此部署尚未启用登录设置。',503)
                if set(body)!={'revision','patch'}:raise ManagementError('登录设置请求字段不合法。')
                result=self.services.LOGIN_POLICY.update(body['patch'],body['revision'],identity.username)
                if result['sessionChanged']:
                    result['sessionsRevoked']=False
                    deadline=time.monotonic()+12
                    while time.monotonic()<deadline:
                        if self.services.AUTH.verify(self.headers.get('Cookie',''),'/admin/',require_admin=True,timeout=1).status==401:
                            result['sessionsRevoked']=True;break
                        time.sleep(0.25)
                self.send_json(result)
            elif path=='/api/admin/turnstile':
                if self.services.TURNSTILE is None:raise ManagementError('此部署尚未启用 Turnstile 设置。',503)
                if 'revision' not in body or 'patch' not in body or set(body)-{'revision','patch','secretKey','clearSecret','verificationToken'}:
                    raise ManagementError('Turnstile 设置请求字段不合法。')
                self.send_json(self.services.TURNSTILE.update(body['patch'],body['revision'],identity.username,
                                                secret_key=body.get('secretKey'),
                                                clear_secret=body.get('clearSecret',False),
                                                verification_token=body.get('verificationToken'),
                                                remote_ip=self.remote_ip()))
            elif path=='/api/admin/jobs/cancel':
                if set(body)!={'jobId'}:raise ManagementError('取消任务请求不合法。')
                self.send_json(cancel_job(body['jobId'],self.services.SITE,identity.username,self.services.COORDINATOR))
            elif path=='/api/admin/password':
                if set(body)!={'currentPassword','newPassword'}:raise ManagementError('密码请求字段不合法。')
                if self.services.ACCOUNTS is None:raise ManagementError('此部署尚未启用后台密码修改。',503)
                # Persist an intent before touching credentials so a failed audit
                # write can never leave an unreported successful password change.
                self.services.SITE.record(identity.username,'password-request',{})
                self.services.ACCOUNTS.change(identity.username,body['currentPassword'],body['newPassword'],self.services.AUTH.admin_group)
                # The auth supervisor discards all sessions after the atomic file
                # change. Wait until the previous cookie is no longer accepted.
                revoked=False
                deadline=time.monotonic()+12
                while time.monotonic()<deadline:
                    if self.services.AUTH.verify(self.headers.get('Cookie',''),'/admin/',require_admin=True,timeout=1).status==401:
                        revoked=True;break
                    time.sleep(0.25)
                try:self.services.SITE.record(identity.username,'password',{'sessionsRevoked':revoked})
                except ManagementError:logging.error('Password changed but completion audit could not be saved')
                self.send_json({'changed':True,'sessionsRevoked':revoked,'login':'/auth/?rd='+self.services.PUBLIC_ORIGIN+'/admin/'})
            else:self.send_json({'error':'管理接口不存在。'},404)
        except ManagementError as error:
            self.close_connection=True;self.send_json({'error':str(error)},error.status)
        except (ValueError,TypeError,KeyError):
            self.close_connection=True;self.send_json({'error':'请求格式不合法。'},400)
        except Exception:
            logging.exception('Administrator operation failed')
            self.close_connection=True;self.send_json({'error':'操作未能完成，请刷新后重试。'},500)

if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--port',type=int,default=8765)
    parser.add_argument('--host',default='127.0.0.1',help='Keep loopback for local use; containers use a private network.')
    args=parser.parse_args()
    services = create_services()
    if services.AUTH_ENABLED:services.SITE.snapshot()
    print(f'打开 http://{args.host}:{args.port}',flush=True)
    PlannerHTTPServer((args.host,args.port),Handler,services=services).serve_forever()
