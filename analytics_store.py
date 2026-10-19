"""Single-process analytics storage, including NAS-safe rollback journaling."""
import functools
import json
from pathlib import Path
from urllib.parse import quote_plus
import sqlite3
import time


def client_info(ua):
    lower = ua.lower()
    device = '机器人' if any(x in lower for x in ('bot', 'spider', 'crawler')) else '平板' if 'ipad' in lower or 'tablet' in lower else '手机' if 'mobile' in lower or 'android' in lower else '电脑'
    browser = next((name for token, name in [('edg/', 'Edge'), ('opr/', 'Opera'), ('firefox/', 'Firefox'), ('crios/', 'Chrome'), ('chrome/', 'Chrome'), ('safari/', 'Safari')] if token in lower), '其他')
    system = next((name for token, name in [('windows', 'Windows'), ('android', 'Android'), ('iphone', 'iOS'), ('ipad', 'iPadOS'), ('mac os', 'macOS'), ('linux', 'Linux')] if token in lower), '其他')
    return device, browser, system


class GeoLookup:
    def __init__(self, directory=None):
        self.searchers = {}
        self.version = '未安装地区库'
        if directory:
            from ip2region import searcher
            from ip2region import util
            root = Path(directory)
            for version, name in [(4, 'ip2region_v4.xdb'), (6, 'ip2region_v6.xdb')]:
                path = root / name
                if path.is_file():
                    self.searchers[version] = searcher.new_with_vector_index(util.IPv4 if version == 4 else util.IPv6, str(path), util.load_vector_index_from_file(str(path)))
            if self.searchers:
                meta = root / 'source.json'
                self.version = json.loads(meta.read_text()).get('commit', '')[:12] if meta.exists() else 'ip2region'

    @functools.lru_cache(maxsize=4096)
    def lookup(self, ip):
        import ipaddress
        address = ipaddress.ip_address(ip)
        if address.is_private or address.is_loopback:
            return ('内网', '', '', '')
        reader = self.searchers.get(address.version)
        if reader:
            value = reader.search(ip)
            if isinstance(value, bytes): value = value.decode()
            parts = (value or '').split('|')
            if len(parts) >= 4:
                return tuple('' if p == '0' else p for p in parts[:4])
        return ('未知', '', '', '')


class AnalyticsStore:
    def __init__(self, path, *, geo=None, clock=time.time):
        self.path, self.geo, self.clock = Path(path), geo or GeoLookup(), clock
        self.path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.db = sqlite3.connect(path, timeout=15)
        self.db.row_factory = sqlite3.Row
        self.db.executescript('''
            PRAGMA journal_mode=DELETE;
            PRAGMA synchronous=NORMAL;
            PRAGMA cache_size=-4096;
            PRAGMA temp_store=MEMORY;
            PRAGMA auto_vacuum=INCREMENTAL;
            CREATE TABLE IF NOT EXISTS visits (
                seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, at INTEGER NOT NULL,
                last INTEGER NOT NULL, ip TEXT NOT NULL, visitor TEXT NOT NULL, session TEXT NOT NULL,
                path TEXT NOT NULL, referrer TEXT NOT NULL, ua TEXT NOT NULL, device TEXT NOT NULL,
                browser TEXT NOT NULL, os TEXT NOT NULL, viewport TEXT NOT NULL,
                country TEXT NOT NULL, region TEXT NOT NULL, city TEXT NOT NULL, isp TEXT NOT NULL,
                duration INTEGER NOT NULL DEFAULT 0);
            CREATE INDEX IF NOT EXISTS visits_time ON visits(at);
            CREATE INDEX IF NOT EXISTS visits_ip_time ON visits(ip,at);
            CREATE TABLE IF NOT EXISTS actions (
                id TEXT PRIMARY KEY, visit TEXT NOT NULL, at INTEGER NOT NULL, ip TEXT NOT NULL,
                visitor TEXT NOT NULL, phase TEXT NOT NULL, target TEXT NOT NULL, path TEXT NOT NULL);
            CREATE INDEX IF NOT EXISTS actions_time ON actions(at);
            CREATE INDEX IF NOT EXISTS actions_visit ON actions(visit);
            CREATE INDEX IF NOT EXISTS actions_ip_time ON actions(ip,at);
            CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        ''')
        self.cache = {}
        self.last_pruned = 0
        self.prune()

    def close(self):
        self.db.close()

    def ingest(self, events):
        with self.db:
            for event in events:
                if event['kind'] == 'calculation':
                    self.db.execute('INSERT OR IGNORE INTO actions VALUES (?,?,?,?,?,?,?,?)',
                                    tuple(event[k] for k in ('id','visit','at','ip','visitor','phase','target','path')))
                    continue
                country, region, city, isp = self.geo.lookup(event['ip'])
                device, browser, system = client_info(event['ua'])
                self.db.execute('''INSERT INTO visits (id,at,last,ip,visitor,session,path,referrer,ua,device,browser,os,viewport,country,region,city,isp,duration)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
                    last=MAX(visits.last,excluded.last), duration=MAX(visits.duration,excluded.duration)
                    WHERE visits.ip=excluded.ip AND visits.session=excluded.session''',
                    (event['visit'],event['at'],event['at'],event['ip'],event['visitor'],event['session'],event['path'],event['referrer'],event['ua'],device,browser,system,event['viewport'],country,region,city,isp,event['duration']))
        self.prune()

    def prune(self):
        now = self.clock()
        if self.last_pruned and now - self.last_pruned < 86400:
            return
        cutoff = int(now - 60 * 86400)
        with self.db:
            self.db.execute('DELETE FROM visits WHERE at<?', (cutoff,))
            self.db.execute('DELETE FROM actions WHERE at<?', (cutoff,))
            self.db.execute("INSERT OR REPLACE INTO metadata VALUES ('lastPruned',?)", (str(int(now)),))
        self.db.execute('PRAGMA incremental_vacuum(256)')
        self.last_pruned = now
        self.cache.clear()

    def stats(self):
        return {'rows': self.db.execute('SELECT count(*) FROM visits').fetchone()[0],
                'databaseBytes': self.path.stat().st_size, 'lastPruned': int(self.last_pruned), 'geoVersion': self.geo.version}

    def query(self, request):
        self.prune()
        key = json.dumps(request, sort_keys=True)
        now = self.clock()
        cached = self.cache.get(key)
        if cached and now - cached[0] < 30:
            return cached[1]
        # "1 day" means today in the site's Asia/Shanghai timezone.
        start_of_today = int((now + 28800) // 86400) * 86400 - 28800
        cutoff = max(int(now - 60*86400), start_of_today - (request['days']-1)*86400)
        clauses, args = ['at>=?'], [cutoff]
        if request.get('ip'):
            clauses.append('ip=?');args.append(request['ip'])
        if request.get('path'):
            clauses.append('(instr(path,?)>0 OR instr(path,?)>0)');args.extend([request['path'],quote_plus(request['path'])])
        where = ' AND '.join(clauses)
        if request['mode'] == 'summary':
            row = dict(self.db.execute('SELECT count(*) AS views,count(DISTINCT ip) AS ips,count(DISTINCT visitor) AS visitors,count(DISTINCT session) AS sessions,coalesce(round(avg(duration)),0) AS duration FROM visits WHERE '+where,args).fetchone())
            counts = {r['phase']: r['n'] for r in self.db.execute('SELECT phase,count(*) AS n FROM actions WHERE '+where+' GROUP BY phase',args)}
            top = {}
            for label, column in [('pages','path'),('regions',"CASE WHEN region!='' THEN country||' '||region ELSE country END"),('devices','device'),('browsers','browser'),('sources',"CASE WHEN referrer='' THEN '直接访问 / 未提供来源' ELSE referrer END")]:
                top[label] = [dict(r) for r in self.db.execute('SELECT '+column+' AS label,count(*) AS count FROM visits WHERE '+where+' GROUP BY 1 ORDER BY count DESC LIMIT 8',args)]
            trend = [dict(r) for r in self.db.execute("SELECT date(at+28800,'unixepoch') AS day,count(*) AS views,count(DISTINCT ip) AS ips FROM visits WHERE "+where+' GROUP BY 1 ORDER BY 1',args)]
            row.update({'calculations':counts,'top':top,'trend':trend,'days':request['days'],'storage':self.stats()})
            result = row
        else:
            if request.get('before'):
                where += ' AND seq<?';args.append(request['before'])
            limit = 5000 if request['mode'] == 'export' else 50
            rows = [dict(r) for r in self.db.execute('SELECT * FROM visits WHERE '+where+' ORDER BY seq DESC LIMIT ?',[*args,limit+1])]
            more = len(rows)>limit;rows=rows[:limit]
            # Fetch recent calculations for this visit page in one indexed query.
            visits = [r['id'] for r in rows]
            actions = {}
            if visits and request['mode'] != 'export':
                # The bounded time/IP scope avoids a scan across all action history.
                for r in self.db.execute('SELECT visit,at,phase,target FROM actions WHERE at>=? AND visit IN ('+','.join('?'*len(visits))+') ORDER BY at', [cutoff,*visits]):
                    actions.setdefault(r['visit'],[]).append(dict(r))
            for r in rows:r['actions']=actions.get(r['id'],[])
            result = {'items':rows,'more':more,'next':rows[-1]['seq'] if more else 0,'limit':limit,'days':request['days']}
        if len(self.cache) >= 32:
            self.cache.pop(next(iter(self.cache)))
        self.cache[key] = (now,result)
        return result
