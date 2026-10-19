"""Outbound-only analytics node. Stores history separately from compute workers."""
import argparse
import http.client
import json
import logging
import os
from pathlib import Path
import signal
import threading
import time
from urllib.parse import urlsplit

from analytics_store import AnalyticsStore, GeoLookup


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--config',required=True,type=Path)
    args=parser.parse_args()
    config=json.loads(args.config.read_text())
    url=urlsplit(config['url'])
    if url.scheme!='https' or not url.hostname or url.username or url.password or url.query or url.fragment or url.path not in ('','/'):
        raise ValueError('Analytics URL must be an HTTPS origin')
    logging.basicConfig(level=logging.INFO,format='%(asctime)s %(levelname)s %(message)s')
    os.umask(0o077)
    stopping=threading.Event()
    for sig in (signal.SIGTERM,signal.SIGINT):signal.signal(sig,lambda *_:stopping.set())
    store=AnalyticsStore(config['database'],geo=GeoLookup(config.get('geoDirectory')))
    payload={};connection=None;last_stats=0
    logging.info('Analytics node ready; rolling retention 60 days')
    try:
        while not stopping.is_set():
            try:
                if time.monotonic()-last_stats>60:
                    payload['stats']=store.stats();last_stats=time.monotonic()
                if connection is None:connection=http.client.HTTPSConnection(url.hostname,url.port or 443,timeout=25)
                serialized=json.dumps(payload,ensure_ascii=False,separators=(',',':'))
                if len(serialized.encode())>7*1024*1024:
                    payload['results']={key:{'error':'result too large'} for key in payload.get('results',{})}
                    serialized=json.dumps(payload,separators=(',',':'))
                connection.request('POST','/api/analytics/worker',serialized.encode(),
                                   {'Authorization':'Bearer '+config['token'],'Content-Type':'application/json'})
                response=connection.getresponse();raw=response.read(4*1024*1024)
                if response.status!=200:raise RuntimeError('Coordinator HTTP '+str(response.status))
                reply=json.loads(raw);events=reply.get('events',[])
                store.ingest(events)
                payload={'ack':[e['id'] for e in events],'results':{}}
                # Keep simultaneous CSV exports within the coordinator's body limit.
                for query in reply.get('queries',[])[:1]:
                    try:payload['results'][query['id']]=store.query({k:v for k,v in query.items() if k!='id'})
                    except Exception:
                        logging.exception('Analytics query failed')
                        payload['results'][query['id']]={'error':'query failed'}
            except (OSError,ValueError,RuntimeError,http.client.HTTPException) as error:
                if connection:connection.close();connection=None
                logging.warning('Analytics link unavailable: %s',type(error).__name__)
                stopping.wait(5)
    finally:
        if connection:connection.close()
        store.close()


if __name__=='__main__':main()
