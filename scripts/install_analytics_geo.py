#!/usr/bin/env python3
"""Fetch a pinned upstream ip2region reader and offline IPv4/IPv6 data."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import tempfile
import urllib.request

COMMIT='f8b0792b0cd729f5b2593f690aeed225e49c1967'
BASE='https://raw.githubusercontent.com/lionsoul2014/ip2region/'+COMMIT+'/'


def install(directory):
    directory=Path(directory);directory.mkdir(parents=True,exist_ok=True,mode=0o700)
    paths={**{'ip2region/'+name:'binding/python/ip2region/'+name for name in ('__init__.py','searcher.py','util.py')},
           'ip2region/LICENSE':'binding/python/LICENSE','LICENSE.md':'LICENSE.md',
           **{name:'data/'+name for name in ('ip2region_v4.xdb','ip2region_v6.xdb')}}
    records={}
    with tempfile.TemporaryDirectory(dir=directory,prefix='.download-') as raw:
        staging=Path(raw)
        for name,source in paths.items():
            target=staging/name;target.parent.mkdir(parents=True,exist_ok=True)
            with urllib.request.urlopen(BASE+source,timeout=120) as response,target.open('wb') as handle:shutil.copyfileobj(response,handle)
            digest=hashlib.sha256()
            with target.open('rb') as handle:
                for block in iter(lambda:handle.read(65536),b''):digest.update(block)
            records[name]={'bytes':target.stat().st_size,'sha256':digest.hexdigest()}
        for name in paths:
            target=directory/name;target.parent.mkdir(parents=True,exist_ok=True);os.replace(staging/name,target)
    import time
    (directory/'source.json').write_text(json.dumps({'project':'https://github.com/lionsoul2014/ip2region','commit':COMMIT,'installedAt':int(time.time()),'files':records},indent=2))
    return {'commit':COMMIT,'files':len(records),'bytes':sum(r['bytes'] for r in records.values())}


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('directory',type=Path)
    print(json.dumps(install(parser.parse_args().directory)))
