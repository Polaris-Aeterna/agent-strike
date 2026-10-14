"""把 Claude Code 和 Codex 的会话记录翻译成同一种「游戏事件」。

只读：这里从不写 ~/.claude 或 ~/.codex，只在本目录的 .cache/ 里放自己的缓存。

一个事件长这样（字段为空就省略）：
    {"t": 毫秒时间戳, "src": "claude"|"codex", "sid": 会话id, "k": 种类,
     "tool": 工具名, "tgt": 简短目标, "ok": 是否成功, "hs": 是否算爆头, "n": token 数}

种类 k：prompt think shell read edit web agent misc ask answer compact done abort apierr tokens pr
"""
import collections
import datetime
import glob
import json
import os
import re
import threading
import time
from urllib.parse import urlparse

HOME = os.path.expanduser('~')
CLAUDE_GLOB = os.path.join(HOME, '.claude', 'projects', '*', '*.jsonl')
CLAUDE_SUB_GLOB = os.path.join(HOME, '.claude', 'projects', '*', '*', 'subagents', '*.jsonl')
CODEX_DIRS = [os.path.join(HOME, '.codex', 'sessions'), os.path.join(HOME, '.codex', 'archived_sessions')]
CODEX_TITLES = os.path.join(HOME, '.codex', 'session_index.jsonl')
CACHE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.cache')
CACHE_VERSION = 4
# 子代理干的活算回主会话头上；只保留这些种类，免得把「主会话派活」误当成人类下指令
SUB_KINDS = {'shell', 'read', 'edit', 'web', 'misc', 'tokens'}


def iso_ms(s):
    if not s:
        return None
    try:
        return int(datetime.datetime.fromisoformat(s.replace('Z', '+00:00')).timestamp() * 1000)
    except (ValueError, TypeError):
        return None


def ms_iso(ms):
    """UTC ISO prefix, comparable byte-for-byte with Codex line timestamps."""
    return datetime.datetime.fromtimestamp(ms / 1000, datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%S').encode()


def ev(t, src, sid, k, **kw):
    e = {'t': t, 'src': src, 'sid': sid, 'k': k}
    for key, v in kw.items():
        if v is not None and v != '':
            e[key] = v
    return e


# ---------------------------------------------------------------- commands

READONLY_CMDS = {
    'cat', 'head', 'tail', 'sed', 'ls', 'rg', 'grep', 'find', 'wc', 'pwd', 'tree', 'file', 'stat', 'less',
    'du', 'nl', 'awk', 'sort', 'uniq', 'cut', 'diff', 'which', 'echo', 'printf', 'jq', 'realpath',
    'basename', 'dirname', 'date', 'true', 'git-status', 'fd', 'bat', 'pdftotext', 'mdls',
}
SEG_SPLIT = re.compile(r'&&|\|\||[;|\n]')
SAFE_TOKEN = re.compile(r'^[\w.@/+:,-]{1,40}$')
# 这些命令跑成功算「爆头」：测试通过、论文编译通过、提交代码
HEADSHOT_RE = re.compile(
    r'(?:^|[\s;&|(])(?:pytest|py\.test|jest|vitest|mocha|cargo\s+test|go\s+test|'
    r'(?:npm|yarn|pnpm|bun)\s+(?:run\s+)?test|make\s+(?:test|check)|ctest|python3?\s+-m\s+(?:pytest|unittest)|'
    r'latexmk|pdflatex|xelatex|lualatex|tectonic|git\s+commit|git\s+push)\b')


def _segments(cmd):
    out = []
    for seg in SEG_SPLIT.split(cmd or ''):
        words = seg.strip().split()
        while words and ('=' in words[0] or words[0] in ('sudo', 'env', 'time', 'nohup', 'exec', 'command')):
            words = words[1:]
        if words and words[0] not in ('cd', 'set', 'export', 'source', '.'):
            out.append(words)
    return out


def is_readonly(cmd):
    segs = _segments(cmd)
    return bool(segs) and all(os.path.basename(w[0]) in READONLY_CMDS for w in segs)


def summarize_cmd(cmd):
    """'cd x && python3 run.py --k=v' -> 'python3 run.py'. 不带参数值，免得把密钥显示出来。"""
    segs = _segments(cmd)
    if not segs:
        return 'shell'
    words = segs[0]
    parts = [os.path.basename(words[0])[:20]]
    for w in words[1:4]:
        if w.startswith('-'):
            continue
        if SAFE_TOKEN.match(w):
            parts.append(os.path.basename(w.rstrip('/')) or w)
        break
    return ' '.join(parts)[:30]


def short_path(p):
    if not p:
        return ''
    p = str(p)
    if p.startswith('file://'):
        p = p[7:]
    return os.path.basename(p.rstrip('/'))[:30]


def _host(url):
    try:
        return (urlparse(url or '').hostname or 'web')[:30]
    except ValueError:
        return 'web'


def _text_of(content):
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        for b in content:
            if isinstance(b, dict) and isinstance(b.get('text'), str):
                return b['text']
    return ''


# ---------------------------------------------------------------- parsers

def classify_claude(name, inp):
    """-> (kind, target, headshot)"""
    if name == 'Bash':
        cmd = inp.get('command') or ''
        if is_readonly(cmd):
            return 'read', summarize_cmd(cmd), False
        return 'shell', summarize_cmd(cmd), bool(HEADSHOT_RE.search(cmd))
    if name in ('Read', 'NotebookRead'):
        return 'read', short_path(inp.get('file_path') or inp.get('notebook_path')), False
    if name in ('Glob', 'Grep', 'LS', 'ToolSearch', 'ListAgents', 'TaskList', 'TaskGet'):
        return 'read', name.lower(), False
    if name in ('Edit', 'Write', 'MultiEdit', 'NotebookEdit'):
        return 'edit', short_path(inp.get('file_path') or inp.get('notebook_path')), False
    if name == 'WebSearch':
        return 'web', 'search', False
    if name == 'WebFetch':
        return 'web', _host(inp.get('url')), False
    if name in ('Agent', 'Task'):
        return 'agent', str(inp.get('subagent_type') or inp.get('description') or '')[:24], False
    if name == 'AskUserQuestion':
        return 'ask', '', False
    low = name.lower()
    if 'browser' in low or 'chrome' in low:
        return 'web', name.split('__')[-1][:24], False
    return 'misc', name.split('__')[-1][:24], False


class ClaudeParser:
    src = 'claude'

    def __init__(self, sid, title=None, sub=False):
        self.sid = sid
        self.title = title
        self.sub = sub
        self.custom_title = False
        self.cwd = None
        self.pending = {}      # tool_use id -> (kind, tool, tgt, hs, t)
        self.seen_msgs = set()
        self.done_msgs = set()
        self.last_t = None

    def _ev(self, t, k, **kw):
        return ev(t, self.src, self.sid, k, **kw)

    def _prompt(self, t, text):
        if text.startswith('[Request interrupted'):
            return self._ev(t, 'abort')
        return self._ev(t, 'prompt')

    def feed(self, d):
        typ = d.get('type')
        if typ == 'custom-title' and d.get('customTitle'):
            self.title, self.custom_title = d['customTitle'], True
            return []
        if typ == 'agent-name' and d.get('agentName') and not self.custom_title:
            self.title = d['agentName']
            return []
        t = iso_ms(d.get('timestamp'))
        if t is None:
            if typ == 'pr-link' and self.last_t:
                return [self._ev(self.last_t, 'pr')]
            return []
        self.last_t = t
        if d.get('cwd'):
            self.cwd = d['cwd']
        if d.get('isSidechain') and not self.sub:
            return []
        if typ == 'system':
            st = d.get('subtype')
            if st == 'compact_boundary':
                return [self._ev(t, 'compact')]
            if st == 'api_error':
                return [self._ev(t, 'apierr')]
            return []
        msg = d.get('message')
        if not isinstance(msg, dict):
            return []
        content = msg.get('content')
        out = []
        if typ == 'assistant':
            mid = msg.get('id')
            if mid and mid not in self.seen_msgs:
                self.seen_msgs.add(mid)
                n = (msg.get('usage') or {}).get('output_tokens') or 0
                if n:
                    out.append(self._ev(t, 'tokens', n=n))
            for b in content if isinstance(content, list) else []:
                if not isinstance(b, dict):
                    continue
                if b.get('type') == 'thinking':
                    out.append(self._ev(t, 'think'))
                elif b.get('type') == 'tool_use':
                    name = b.get('name') or '?'
                    inp = b.get('input') if isinstance(b.get('input'), dict) else {}
                    kind, tgt, hs = classify_claude(name, inp)
                    self.pending[b.get('id')] = (kind, name, tgt, hs, t)
                    if kind == 'ask':
                        out.append(self._ev(t, 'ask', tool=name))
            if msg.get('stop_reason') == 'end_turn' and mid not in self.done_msgs:
                self.done_msgs.add(mid)
                out.append(self._ev(t, 'done'))
        elif typ == 'user':
            if d.get('isMeta') or d.get('isCompactSummary'):
                return out
            origin = (d.get('origin') or {}).get('kind')
            human = origin in (None, 'human') and d.get('turnOrigin') in (None, 'human')
            if isinstance(content, str):
                if human:
                    out.append(self._prompt(t, content))
                return out
            for b in content if isinstance(content, list) else []:
                if not isinstance(b, dict):
                    continue
                if b.get('type') == 'tool_result':
                    kind, name, tgt, hs, t0 = self.pending.pop(b.get('tool_use_id'), None) or ('misc', '?', '', False, t)
                    if _text_of(b.get('content')).startswith('[Request interrupted'):
                        out.append(self._ev(t, 'abort'))
                        continue
                    ok = not b.get('is_error')
                    if str((d.get('permissionDecision') or {}).get('source', '')).startswith('user'):
                        # 它停下来等你手动批准了
                        out.append(self._ev(t0, 'ask', tool=name))
                        out.append(self._ev(t, 'answer', tool=name))
                    if kind == 'ask':
                        out.append(self._ev(t, 'answer', tool=name))
                        continue
                    out.append(self._ev(t, kind, tool=name, tgt=tgt, ok=ok, hs=True if (hs and ok) else None))
                elif b.get('type') == 'text' and human:
                    out.append(self._prompt(t, b.get('text') or ''))
        return out


class CodexParser:
    src = 'codex'

    def __init__(self, sid, title=None, sub=False):
        self.sid = sid
        self.title = title
        self.sub = sub
        self.cwd = None
        self.asks = {}     # call_id -> async?

    def _ev(self, t, k, **kw):
        return ev(t, self.src, self.sid, k, **kw)

    def feed(self, d):
        t = iso_ms(d.get('timestamp'))
        if t is None:
            return []
        typ = d.get('type')
        p = d.get('payload') if isinstance(d.get('payload'), dict) else {}
        pt = p.get('type')
        if typ == 'session_meta':
            self.cwd = p.get('cwd') or self.cwd
            return []
        if typ == 'event_msg':
            if pt == 'item_completed':
                return self._item(t, p.get('item') or {})
            if pt == 'task_complete':
                return [self._ev(t, 'done')]
            if pt == 'turn_aborted':
                return [self._ev(t, 'abort')]
            return []
        if typ == 'token_usage_record':
            n = (p.get('usage') or {}).get('output_tokens') or 0
            return [self._ev(t, 'tokens', n=n)] if n else []
        if typ == 'response_item':
            if pt == 'function_call' and p.get('name') in ('request_user_input', 'request_user_input_async'):
                self.asks[p.get('call_id')] = p.get('name').endswith('async')
                return [self._ev(t, 'ask', tool='request_user_input')]
            if pt == 'function_call_output' and p.get('call_id') in self.asks:
                if not self.asks[p.get('call_id')]:
                    del self.asks[p.get('call_id')]
                    return [self._ev(t, 'answer', tool='request_user_input')]
        return []

    def _item(self, t, it):
        typ = it.get('type')
        if typ == 'CommandExecution':
            cmd = it.get('command')
            if isinstance(cmd, list):
                cmd = cmd[-1] if cmd else ''
            cmd = cmd if isinstance(cmd, str) else ''
            parsed = [x for x in (it.get('parsed_cmd') or []) if isinstance(x, dict)]
            readonly = bool(parsed) and all(x.get('type') in ('read', 'search', 'list_files') for x in parsed)
            ok = it.get('status') == 'completed' and it.get('exit_code') in (0, None, '0')
            if readonly:
                tgt = short_path(parsed[0].get('path') or parsed[0].get('name')) or summarize_cmd(cmd)
                return [self._ev(t, 'read', tool='exec', tgt=tgt, ok=ok)]
            hs = True if (ok and HEADSHOT_RE.search(cmd)) else None
            return [self._ev(t, 'shell', tool='exec', tgt=summarize_cmd(cmd), ok=ok, hs=hs)]
        if typ == 'FileChange':
            ch = it.get('changes') if isinstance(it.get('changes'), dict) else {}
            names = [short_path(k) for k in ch]
            tgt = (names[0] + (f' +{len(names) - 1}' if len(names) > 1 else '')) if names else ''
            return [self._ev(t, 'edit', tool='apply_patch', tgt=tgt, ok=it.get('status') == 'completed')]
        if typ == 'McpToolCall':
            server, tool = str(it.get('server') or ''), str(it.get('tool') or '?')
            low = (server + tool).lower()
            kind = 'web' if any(x in low for x in ('browser', 'chrome', 'web', 'fetch', 'search')) else 'misc'
            return [self._ev(t, kind, tool=tool[:24], tgt=server[:20], ok=it.get('status') == 'completed')]
        if typ == 'DynamicToolCall':
            ok = it.get('status') != 'failed' and it.get('success') is not False
            return [self._ev(t, 'misc', tool=str(it.get('tool') or '?')[:24], ok=ok)]
        if typ == 'ImageView':
            return [self._ev(t, 'read', tool='view_image', tgt=short_path(it.get('path')), ok=True)]
        if typ == 'WebSearch' or (typ == 'Extension' and str(it.get('kind', '')).startswith('web')):
            return [self._ev(t, 'web', tool='web_search', tgt='search', ok=True)]
        if typ == 'SubAgentActivity' and it.get('kind') == 'started':
            return [self._ev(t, 'agent', tool='spawn_agent')]
        if typ == 'ContextCompaction':
            return [self._ev(t, 'compact')]
        if typ == 'Reasoning':
            return [self._ev(t, 'think')]
        if typ == 'UserMessage':
            out = []
            if self.asks:
                self.asks.clear()
                out.append(self._ev(t, 'answer', tool='request_user_input'))
            out.append(self._ev(t, 'prompt'))
            return out
        return []


class SubParser:
    """Wraps a parser for a subagent log: events are credited to the root session and tagged sub=1."""

    def __init__(self, inner):
        self.inner = inner

    def __getattr__(self, name):
        return getattr(self.inner, name)

    def feed(self, d):
        out = []
        for e in self.inner.feed(d):
            if e['k'] in SUB_KINDS:
                e['sub'] = 1
                out.append(e)
        return out


def make_parser(entry):
    cls = ClaudeParser if entry['src'] == 'claude' else CodexParser
    if entry.get('kind') == 'sub':
        return SubParser(cls(entry['root'], None, sub=True))
    return cls(entry['sid'], entry.get('title'))


def _codex_wanted(raw):
    head = raw[:200]
    if b'"type":"event_msg"' in head:
        return b'"type":"token_count"' not in head and b'"type":"thread_settings_applied"' not in head
    if b'"type":"response_item"' in head:
        return b'"type":"function_call' in head
    return b'"type":"session_meta"' in head or b'"type":"token_usage_record"' in head


def iter_lines(path, src, offset=0, min_ms=None):
    """Yield parsed JSON dicts. Codex lines are pre-filtered on raw bytes, which skips most of a 1GB file."""
    min_iso = ms_iso(min_ms) if (min_ms and src == 'codex') else None
    try:
        f = open(path, 'rb')
    except OSError:
        return
    with f:
        if offset:
            f.seek(offset)
            f.readline()
        for raw in f:
            if src == 'codex':
                if min_iso and raw[14:33] < min_iso and b'"type":"session_meta"' not in raw[:80]:
                    continue
                if not _codex_wanted(raw):
                    continue
            try:
                d = json.loads(raw)
            except ValueError:
                continue
            if isinstance(d, dict):
                yield d


# ---------------------------------------------------------------- index

def _read_codex_titles():
    titles = {}
    try:
        with open(CODEX_TITLES, encoding='utf-8', errors='ignore') as f:
            for line in f:
                try:
                    d = json.loads(line)
                except ValueError:
                    continue
                if d.get('id') and d.get('thread_name'):
                    titles[d['id']] = d['thread_name']
    except OSError:
        pass
    return titles


_TITLE_RE = re.compile(rb'"(customTitle|agentName)":("(?:[^"\\]|\\.)*")')


def _scan_claude(path, st):
    sid = os.path.splitext(os.path.basename(path))[0]
    start = cwd = None
    try:
        with open(path, 'rb') as f:
            for _ in range(80):
                raw = f.readline()
                if not raw:
                    break
                try:
                    d = json.loads(raw)
                except ValueError:
                    continue
                cwd = cwd or d.get('cwd')
                start = start or iso_ms(d.get('timestamp'))
                if start and cwd:
                    break
            f.seek(max(0, st.st_size - 512 * 1024))
            tail = f.read()
    except OSError:
        return None
    title = None
    found = {k: v for k, v in _TITLE_RE.findall(tail)}
    for key in (b'customTitle', b'agentName'):
        if key in found:
            try:
                title = json.loads(found[key])
                break
            except ValueError:
                pass
    return {'src': 'claude', 'sid': sid, 'path': path, 'start': start, 'kind': 'user',
            'cwd': os.path.basename(cwd or ''), 'title': title}


def _scan_claude_sub(path, st):
    start = parent = None
    try:
        with open(path, 'rb') as f:
            for _ in range(10):
                raw = f.readline()
                if not raw:
                    break
                try:
                    d = json.loads(raw)
                except ValueError:
                    continue
                parent = parent or d.get('sessionId')
                start = start or iso_ms(d.get('timestamp'))
                if start and parent:
                    break
    except OSError:
        return None
    parent = parent or os.path.basename(os.path.dirname(os.path.dirname(path)))
    return {'src': 'claude', 'sid': os.path.splitext(os.path.basename(path))[0], 'path': path, 'start': start,
            'kind': 'sub', 'parent': parent, 'cwd': '', 'title': None}


def _scan_codex(path, st):
    try:
        with open(path, 'rb') as f:
            d = json.loads(f.readline())
    except (OSError, ValueError):
        return None
    p = d.get('payload') or {}
    if d.get('type') != 'session_meta' or not p.get('id'):
        return None
    kind = p.get('thread_source')
    if not isinstance(kind, str):
        kind = 'subagent' if isinstance(p.get('source'), dict) and 'subagent' in p['source'] else 'user'
    if kind == 'subagent':
        kind = 'sub' if p.get('parent_thread_id') else 'orphan'
    return {'src': 'codex', 'sid': p['id'], 'path': path, 'start': iso_ms(p.get('timestamp') or d.get('timestamp')),
            'kind': kind, 'parent': p.get('parent_thread_id'), 'cwd': os.path.basename(p.get('cwd') or ''), 'title': None}


class Index:
    """All main sessions on disk: who, when, how big. Subagent and auto-review threads are kept out of the roster."""

    def __init__(self):
        self.lock = threading.RLock()
        self.path = os.path.join(CACHE_DIR, 'index.json')
        self.entries = {}
        try:
            with open(self.path) as f:
                data = json.load(f)
            if data.get('v') == CACHE_VERSION:
                self.entries = data['entries']
        except (OSError, ValueError, KeyError):
            pass

    def refresh(self):
        titles = _read_codex_titles()
        files = [(p, 'claude') for p in glob.glob(CLAUDE_GLOB)] + [(p, 'claude-sub') for p in glob.glob(CLAUDE_SUB_GLOB)]
        for root in CODEX_DIRS:
            for dirpath, _, names in os.walk(root):
                files += [(os.path.join(dirpath, n), 'codex') for n in names if n.endswith('.jsonl')]
        fresh, changed = {}, False
        for path, src in files:
            try:
                st = os.stat(path)
            except OSError:
                continue
            old = self.entries.get(path)
            if old and old['mtime'] == st.st_mtime and old['size'] == st.st_size:
                e = old
            else:
                e = {'claude': _scan_claude, 'claude-sub': _scan_claude_sub, 'codex': _scan_codex}[src](path, st)
                changed = True
                if not e:
                    continue
                e['mtime'], e['size'] = st.st_mtime, st.st_size
            if e['src'] == 'codex':
                e['title'] = titles.get(e['sid']) or e.get('title')
            e['title'] = e.get('title') or e.get('cwd') or e['sid'][:8]
            fresh[path] = e
        by_sid = {(e['src'], e['sid']): e for e in fresh.values()}
        for e in fresh.values():
            if e['kind'] == 'sub':
                root, hops = by_sid.get((e['src'], e['parent'])), 0
                while root and root['kind'] == 'sub' and hops < 8:
                    root, hops = by_sid.get((root['src'], root['parent'])), hops + 1
                e['root'] = root['sid'] if root and root['kind'] == 'user' else None
        with self.lock:
            changed = changed or len(fresh) != len(self.entries)
            self.entries = fresh
        if changed:
            os.makedirs(CACHE_DIR, exist_ok=True)
            tmp = self.path + '.tmp'
            with open(tmp, 'w') as f:
                json.dump({'v': CACHE_VERSION, 'entries': fresh}, f)
            os.replace(tmp, self.path)

    def players(self):
        """Main sessions only; when a Codex thread was archived, keep the live copy."""
        with self.lock:
            out = {}
            for e in self.entries.values():
                if e['kind'] != 'user' or not e.get('start'):
                    continue
                key = (e['src'], e['sid'])
                if key not in out or '/sessions/' in e['path']:
                    out[key] = e
            return list(out.values())

    def subs(self, roots=None):
        """Subagent logs whose root session is known (optionally only for the given (src, sid) roots)."""
        with self.lock:
            return [e for e in self.entries.values()
                    if e['kind'] == 'sub' and e.get('root') and e.get('start')
                    and (roots is None or (e['src'], e['root']) in roots)]

    def find(self, src, sid):
        for e in self.players():
            if e['src'] == src and e['sid'] == sid:
                return e
        return None

    def days(self):
        counts = collections.defaultdict(lambda: {'claude': 0, 'codex': 0})
        for e in self.players():
            d0 = datetime.date.fromtimestamp(e['start'] / 1000)
            d1 = datetime.date.fromtimestamp(max(e['start'] / 1000, e['mtime']))
            for i in range(min((d1 - d0).days, 45) + 1):
                counts[(d0 + datetime.timedelta(days=i)).isoformat()][e['src']] += 1
        return [{'day': d, **c} for d, c in sorted(counts.items(), reverse=True)]

    def sessions(self, src, q='', limit=300):
        q = (q or '').lower()
        rows = [e for e in self.players() if e['src'] == src and (not q or q in (e['title'] + ' ' + e['cwd']).lower())]
        rows.sort(key=lambda e: e['mtime'], reverse=True)
        return [{k: e[k] for k in ('src', 'sid', 'title', 'cwd', 'start', 'size')} | {'end': int(e['mtime'] * 1000)}
                for e in rows[:limit]]


# ---------------------------------------------------------------- replays

def _session_meta(entry, parser=None):
    return {'src': entry['src'], 'title': (parser and parser.title) or entry['title'], 'cwd': entry['cwd']}


def _collect(index, mains, subs, keep=lambda x: True, min_ms=None):
    """Parse main sessions plus their subagents; subagent work is credited to the root session."""
    per_root, meta = collections.defaultdict(list), {}
    for e in mains:
        parser = make_parser(e)
        for line in iter_lines(e['path'], e['src'], min_ms=min_ms):
            per_root[(e['src'], e['sid'])] += [x for x in parser.feed(line) if keep(x)]
        meta[(e['src'], e['sid'])] = _session_meta(e, parser)
    for e in subs:
        key = (e['src'], e['root'])
        if key not in meta:
            root = index.find(*key)
            if not root:
                continue
            meta[key] = _session_meta(root)
        parser = make_parser(e)
        for line in iter_lines(e['path'], e['src'], min_ms=min_ms):
            per_root[key] += [x for x in parser.feed(line) if keep(x)]
    events, sessions = [], {}
    for key, mine in per_root.items():
        if any(x['k'] != 'tokens' for x in mine):
            events += mine
            sessions[key[1]] = meta[key]
    events.sort(key=lambda x: x['t'])
    return events, sessions


def _cached(name, fresh, build):
    path = os.path.join(CACHE_DIR, name)
    if fresh:
        try:
            with open(path) as f:
                data = json.load(f)
            if data.get('v') == CACHE_VERSION:
                return data
        except (OSError, ValueError):
            pass
    data = build()
    data['v'] = CACHE_VERSION
    if fresh:
        os.makedirs(CACHE_DIR, exist_ok=True)
        with open(path + '.tmp', 'w') as f:
            json.dump(data, f, ensure_ascii=False)
        os.replace(path + '.tmp', path)
    return data


def day_events(index, day):
    d = datetime.datetime.strptime(day, '%Y-%m-%d')
    start = int(d.timestamp() * 1000)
    end = int((d + datetime.timedelta(days=1)).timestamp() * 1000)
    complete = end < time.time() * 1000 - 30 * 60 * 1000

    def build():
        overlaps = lambda e: e['start'] <= end and e['mtime'] * 1000 >= start
        events, sessions = _collect(index, [e for e in index.players() if overlaps(e)],
                                    [e for e in index.subs() if overlaps(e)],
                                    keep=lambda x: start <= x['t'] < end, min_ms=start)
        return {'day': day, 'start': start, 'end': end, 'sessions': sessions, 'events': events}

    return _cached(f'day-{day}.json', complete, build)


def session_events(index, src, sid):
    e = index.find(src, sid)
    if not e:
        return None
    settled = e['mtime'] < time.time() - 30 * 60

    def build():
        events, sessions = _collect(index, [e], index.subs({(src, sid)}))
        return {'sessions': sessions, 'events': events}

    return _cached(f'sess-{src}-{sid}.json', settled, build)


# ---------------------------------------------------------------- live

class LiveTailer(threading.Thread):
    """Follows every session file that changed recently and pushes new events to listeners."""

    ACTIVE_S = 30 * 60      # 多久内有改动的会话算「在场」
    BACKLOG_MS = 10 * 60 * 1000

    def __init__(self, index):
        super().__init__(daemon=True)
        self.index = index
        self.tails = {}
        self.backlog = collections.deque(maxlen=4000)
        self.sessions = {}
        self.listeners = set()
        self.lock = threading.Lock()

    def subscribe(self, q):
        with self.lock:
            self.listeners.add(q)
            cutoff = time.time() * 1000 - self.BACKLOG_MS
            return dict(self.sessions), [x for x in self.backlog if x['t'] >= cutoff]

    def unsubscribe(self, q):
        with self.lock:
            self.listeners.discard(q)

    def _publish(self, msg):
        with self.lock:
            if msg['type'] == 'ev':
                self.backlog.extend(msg['events'])
            elif msg['type'] == 'session':
                self.sessions[msg['sid']] = msg['meta']
            for q in list(self.listeners):
                try:
                    q.put_nowait(msg)
                except Exception:
                    pass

    def active(self):
        now = time.time()
        n = {'claude': 0, 'codex': 0}
        for e in self.index.players():
            if now - e['mtime'] < self.ACTIVE_S:
                n[e['src']] += 1
        return n

    def run(self):
        last_refresh = 0
        while True:
            now = time.time()
            if now - last_refresh > 10:
                try:
                    self.index.refresh()
                except Exception as exc:  # keep tailing even if one scan fails
                    print('index refresh failed:', exc)
                last_refresh = now
                for e in self.index.players() + self.index.subs():
                    if e['path'] not in self.tails and now - e['mtime'] < self.ACTIVE_S:
                        self._attach(e)
            for path, tl in list(self.tails.items()):
                self._pump(path, tl)
            time.sleep(0.7)

    def _attach(self, e):
        try:
            size = os.path.getsize(e['path'])
        except OSError:
            return
        tl = {'entry': e, 'parser': make_parser(e), 'off': max(0, size - 3 * 2**20), 'buf': b'', 'first': True,
              'title': None}
        if tl['off']:
            with open(e['path'], 'rb') as f:
                f.seek(tl['off'])
                tl['off'] += len(f.readline())
        self.tails[e['path']] = tl
        self._pump(e['path'], tl)

    def _pump(self, path, tl):
        try:
            with open(path, 'rb') as f:
                f.seek(tl['off'])
                data = f.read(8 * 2**20)
        except OSError:
            return
        if not data:
            return
        tl['off'] += len(data)
        lines = (tl['buf'] + data).split(b'\n')
        tl['buf'] = lines.pop()
        e, parser = tl['entry'], tl['parser']
        src = e['src']
        events = []
        for raw in lines:
            if src == 'codex' and not _codex_wanted(raw):
                continue
            try:
                d = json.loads(raw)
            except ValueError:
                continue
            if isinstance(d, dict):
                events += parser.feed(d)
        if tl['first']:
            tl['first'] = False
            cutoff = time.time() * 1000 - self.BACKLOG_MS
            events = [x for x in events if x['t'] >= cutoff]
        if e['kind'] == 'sub':
            root = None if tl['title'] else self.index.find(src, e['root'])
            if root and root['sid'] not in self.sessions:
                tl['title'] = root['title']
                self._publish({'type': 'session', 'sid': root['sid'], 'meta': _session_meta(root)})
        else:
            title = parser.title or e['title']
            if title != tl['title']:
                tl['title'] = title
                self._publish({'type': 'session', 'sid': e['sid'], 'meta': _session_meta(e, parser)})
        if events:
            events.sort(key=lambda x: x['t'])
            self._publish({'type': 'ev', 'events': events})
