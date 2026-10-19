import concurrent.futures
import hashlib
import http.client
import json
from pathlib import Path
import socket
import tempfile
import threading
import time
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from analytics_store import AnalyticsStore
from management import Access, ManagementError
from visit_analytics import AnalyticsRelay, normalize_event
import server

TOKEN='test-node-token'

def body(**extra):
    return dict(id='event-00000000000001',visit='visit-00000000000001',visitor='visitor-0000000001',session='session-0000000001',kind='page',path='/?tab=demons',**extra)


def relay(**kwargs):
    return AnalyticsRelay({'tokenSha256':hashlib.sha256(TOKEN.encode()).hexdigest()},**kwargs)


class RelayTests(unittest.TestCase):
    def test_normalization_drops_sensitive_query_and_referrer_path(self):
        value=normalize_event(body(referrer='https://example.com/private?token=secret'), '8.8.8.8','Browser','salt',100)
        self.assertEqual(value['referrer'],'example.com')
        self.assertNotEqual(value['visitor'],'visitor-0000000001')
        value=normalize_event({**body(),'path':'/?config=SECRET&tab=planner'},'8.8.8.8','','salt',100)
        self.assertEqual(value['path'],'/?tab=planner')
        for path in ['/api/compute/worker','/healthz','/assets/avatar.webp','https://attacker.invalid/']:
            with self.assertRaises(ManagementError):normalize_event({**body(),'path':path},'8.8.8.8','','s',100)

    def test_buffer_is_bounded_acknowledged_and_authenticated(self):
        node=relay(capacity=1)
        node.authenticate('Bearer '+TOKEN)
        with self.assertRaises(ManagementError):node.authenticate('Bearer wrong')
        self.assertTrue(node.collect(body(),'8.8.8.8',''))
        self.assertFalse(node.collect({**body(),'id':'event-00000000000002'},'8.8.8.8',''))
        self.assertEqual(node.status()['dropped'],1)
        self.assertEqual(len(node.exchange({},wait=0)['events']),1)
        self.assertEqual(node.exchange({'ack':[body()['id']]},wait=0)['events'],[])

    def test_query_round_trip_and_offline_timeout(self):
        node=relay()
        with self.assertRaises(ManagementError):node.query({})
        node.exchange({},wait=0)
        with concurrent.futures.ThreadPoolExecutor() as pool:
            pending=pool.submit(node.query,{'mode':'summary'},timeout=2)
            reply=node.exchange({},wait=.1)
            self.assertEqual(len(reply['queries']),1)
            node.exchange({'results':{reply['queries'][0]['id']:{'views':3}}},wait=0)
            self.assertEqual(pending.result()['views'],3)
        self.assertFalse(node.queries)


class StorageTests(unittest.TestCase):
    def test_dedup_visible_duration_calculations_filters_and_60_day_retention(self):
        with tempfile.TemporaryDirectory() as directory:
            now=[1800000000]
            store=AnalyticsStore(Path(directory)/'visits.sqlite',clock=lambda:now[0]);self.addCleanup(store.close)
            event=normalize_event(body(),'8.8.8.8','Mozilla Chrome/100 Windows','salt',now[0])
            store.ingest([event,event])
            store.ingest([{**event,'id':'leave-00000000000001','kind':'leave','duration':42}])
            store.ingest([{**event,'id':'calc-000000000000001','kind':'calculation','phase':'submitting','target':'Angel'}])
            summary=store.query({'mode':'summary','days':7})
            self.assertEqual(summary['views'],1);self.assertEqual(summary['duration'],42)
            self.assertEqual(summary['calculations']['submitting'],1)
            rows=store.query({'mode':'visits','days':7,'ip':'8.8.8.8'})['items']
            self.assertEqual(rows[0]['browser'],'Chrome');self.assertEqual(len(rows[0]['actions']),1)
            self.assertEqual(store.query({'mode':'visits','days':7,'ip':'1.1.1.1'})['items'],[])
            now[0]+=61*86400;store.prune()
            self.assertEqual(store.stats()['rows'],0)
            self.assertEqual(store.db.execute('SELECT count(*) FROM actions').fetchone()[0],0)
            self.assertEqual(store.db.execute('PRAGMA journal_mode').fetchone()[0],'delete')

    def test_cursor_pagination_and_csv_export_limit(self):
        with tempfile.TemporaryDirectory() as directory:
            store=AnalyticsStore(Path(directory)/'visits.sqlite');self.addCleanup(store.close)
            event=normalize_event(body(),'8.8.8.8','','salt',time.time())
            store.ingest([{**event,'id':str(i),'visit':str(i)} for i in range(65)])
            first=store.query({'mode':'visits','days':1});second=store.query({'mode':'visits','days':1,'before':first['next']})
            self.assertEqual(len(first['items']),50);self.assertEqual(len(second['items']),15)
            self.assertFalse(set(r['id'] for r in first['items'])&set(r['id'] for r in second['items']))


class AnalyticsHTTPTests(unittest.TestCase):
    def request(self,method,path,payload=None,headers=None):
        client,peer=socket.socketpair();client.settimeout(3);peer.settimeout(3)
        thread=threading.Thread(target=server.Handler,args=(peer,('127.0.0.1',0),SimpleNamespace(server_name='local',server_port=0)),daemon=True);thread.start()
        conn=http.client.HTTPConnection('localhost');conn.sock=client
        conn.request(method,path,json.dumps(payload) if payload is not None else None,headers or {})
        response=conn.getresponse();result=(response.status,response.read());conn.close();thread.join(3);peer.close()
        return result

    def test_collection_respects_origin_and_admin_records_require_admin(self):
        node=relay()
        auth=SimpleNamespace(verify=lambda cookie,*a,**k: Access(204,'admin',('admins',)) if cookie=='admin' else Access(401))
        with patch.object(server,'ANALYTICS',node),patch.object(server,'AUTH_ENABLED',True),patch.object(server,'AUTH',auth),patch.object(server,'PUBLIC_ORIGIN','https://planner.example.com'),patch.object(server.SITE,'requires_login',return_value=False),patch.dict(server.CATALOG,{'authPortal':'/auth/'}):
            self.assertEqual(self.request('POST','/api/analytics/collect',body(),{'Origin':'https://evil.invalid'})[0],403)
            self.assertEqual(self.request('POST','/api/analytics/collect',body(),{'Origin':'https://planner.example.com','X-Real-IP':'8.8.8.8'})[0],202)
            self.assertEqual(self.request('GET','/api/admin/analytics?mode=status')[0],401)
            status,data=self.request('GET','/api/admin/analytics?mode=status',headers={'Cookie':'admin'})
            self.assertEqual(status,200);self.assertEqual(json.loads(data)['buffered'],1)
            self.assertEqual(self.request('POST','/api/analytics/worker',{}, {'Authorization':'Bearer wrong'})[0],401)
