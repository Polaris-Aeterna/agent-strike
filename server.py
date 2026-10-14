#!/usr/bin/env python3
"""AGENT STRIKE 本地服务器 / local server: python3 server.py, then open http://127.0.0.1:8765

只监听本机。只读你的 Claude / Codex 会话记录，不改它们。
Listens on localhost only. Reads your Claude / Codex session logs, never modifies them.
"""
import errno
import json
import os
import queue
import re
import sys
import time
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

import agentlog

HERE = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.join(HERE, 'web')
PORT = int(os.environ.get('PORT', 8765))

index = agentlog.Index()
tailer = agentlog.LiveTailer(index)


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=WEB, **kwargs)

    def log_message(self, fmt, *args):
        pass

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def _json(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False, separators=(',', ':')).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        u = urlparse(self.path)
        q = {k: v[0] for k, v in parse_qs(u.query).items()}
        try:
            if u.path == '/api/days':
                return self._json({'days': index.days(), 'active': tailer.active()})
            if u.path == '/api/day':
                day = q.get('day', '')
                if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', day):
                    return self._json({'error': 'bad day'}, 400)
                return self._json(agentlog.day_events(index, day))
            if u.path == '/api/sessions':
                src = q.get('src')
                if src not in ('claude', 'codex'):
                    return self._json({'error': 'bad src'}, 400)
                return self._json({'sessions': index.sessions(src, q.get('q', ''))})
            if u.path == '/api/session':
                data = agentlog.session_events(index, q.get('src'), q.get('sid'))
                return self._json(data) if data else self._json({'error': 'not found'}, 404)
            if u.path == '/api/live':
                return self._live()
        except (BrokenPipeError, ConnectionResetError):
            return
        return super().do_GET()

    def _live(self):
        self.send_response(200)
        self.send_header('Content-Type', 'text/event-stream')
        self.send_header('Connection', 'keep-alive')
        self.end_headers()
        inbox = queue.Queue(maxsize=20000)
        sessions, backlog = tailer.subscribe(inbox)

        def send(msg):
            self.wfile.write(b'data: ' + json.dumps(msg, ensure_ascii=False).encode() + b'\n\n')
            self.wfile.flush()

        try:
            send({'type': 'hello', 'now': int(time.time() * 1000), 'sessions': sessions, 'events': backlog})
            while True:
                try:
                    send(inbox.get(timeout=15))
                except queue.Empty:
                    self.wfile.write(b': ping\n\n')
                    self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError, OSError):
            pass
        finally:
            tailer.unsubscribe(inbox)


def _already_running():
    try:
        with urllib.request.urlopen(f'http://127.0.0.1:{PORT}/api/days', timeout=2) as r:
            return 'days' in json.load(r)
    except (OSError, ValueError):
        return False


def main():
    t0 = time.time()
    print('正在建立会话索引（第一次会慢一点）… / Indexing sessions (slower the first time)…', flush=True)
    index.refresh()
    players = index.players()
    n = {s: sum(1 for e in players if e['src'] == s) for s in ('claude', 'codex')}
    print(f"索引完成 / Indexed: Claude {n['claude']}, Codex {n['codex']} sessions ({time.time() - t0:.1f}s)", flush=True)
    try:
        server = ThreadingHTTPServer(('127.0.0.1', PORT), Handler)
    except OSError as exc:
        if exc.errno != errno.EADDRINUSE:
            raise
        if _already_running():
            print(f'AGENT STRIKE 已经在运行了 / is already running: http://127.0.0.1:{PORT}', flush=True)
            sys.exit(0)
        print(f'端口 {PORT} 被别的程序占用了 / Port {PORT} is taken. Try: PORT=8766 python3 server.py', flush=True)
        sys.exit(1)
    server.daemon_threads = True
    tailer.start()
    print(f'AGENT STRIKE 已启动 / is up: http://127.0.0.1:{PORT}', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        sys.exit(0)


if __name__ == '__main__':
    main()
