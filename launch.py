"""Start or reuse this local app, then open the browser (Windows / WSL / Linux)."""
import json
import os
import subprocess
import sys
import urllib.request
import webbrowser
from server import Handler, PlannerHTTPServer
from planner import VERSION

def open_browser(url):
    if os.name=='nt':os.startfile(url)
    elif 'microsoft' in os.uname().release.lower():
        command='/mnt/c/Windows/System32/cmd.exe'
        try:subprocess.Popen([command,'/c','start','',url],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        except OSError:webbrowser.open(url)
    else:webbrowser.open(url)

def main():
    for port in range(8765,8775):
        url=f'http://localhost:{port}'
        try:server=PlannerHTTPServer(('127.0.0.1',port),Handler)
        except OSError:
            try:
                with urllib.request.urlopen(url+'/api/catalog',timeout=2) as r:data=json.load(r)
                if data.get('version')==VERSION and data.get('source'):
                    print('工具已在运行：'+url,flush=True);open_browser(url);return
            except (OSError,ValueError):pass
            continue
        print('真女5复仇已启动：'+url+'\n保持此窗口打开。按 Ctrl+C 停止。',flush=True)
        open_browser(url)
        try:server.serve_forever()
        except KeyboardInterrupt:pass
        finally:server.server_close()
        return
    raise SystemExit('8765–8774 端口均被占用。请使用 python server.py --port 其他端口。')

if __name__=='__main__':main()
