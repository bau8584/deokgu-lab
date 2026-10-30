"""덕구랩 서버 — 정적 화면 + 좋아요·제안함·댓글 API (로컬 백엔드 상자 deokgu-lab).

2026-10-30 Cloudflare Pages(+Functions+D1)에서 옮겨 옴. functions/api/*.js 와 똑같이 답한다(화면 쪽 assets/api.js 그대로).
GET  /api/ping                          {ok:true}
GET  /api/likes?ids=a,b                 {a:1,b:0}
POST /api/likes {item_id}               {count}            (+1)
POST /api/feedback {item_id,message,contact,hp}  {ok:true}
GET  /api/comments?item_id=x            [{id,item_id,name,message,up,down,created_at}] 최신순
POST /api/comments {item_id,name,message,pw,hp}
POST /api/comments/<id>/edit {pw,message}   {ok}
POST /api/comments/<id>/delete {pw}         {ok}
POST /api/comments/<id>/vote {dir}          {up,down}

저장 = /data/lab.db 한 파일(SQLite, 표 모양은 d1/schema.sql 그대로). 사이트 파일은 /site(저장소 통째, 읽기 전용).
사이트 파일 중 화면에 쓰는 종류(html·그림·글꼴 등)만 내보내고, 메모·설정·작업 폴더는 404.
"""
import hashlib, hmac, json, os, re, secrets, sqlite3, threading, time, uuid
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs, unquote

PORT = int(os.environ.get('LAB_PORT', 8793))
SITE = os.environ.get('LAB_SITE', '/site')
DB_PATH = os.path.join(os.environ.get('LAB_DATA', '/data'), 'lab.db')
LOCK = threading.Lock()

SHOW_EXT = {'.html', '.css', '.js', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico',
            '.woff', '.woff2', '.ttf', '.otf', '.mp4', '.webm'}
HIDE_TOP = {'functions', 'd1', 'scripts', 'server', 'docs', 'node_modules'}


def db():
    con = sqlite3.connect(DB_PATH, timeout=10)
    con.row_factory = sqlite3.Row
    return con


def init_db():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    schema = open(os.path.join(SITE, 'd1', 'schema.sql'), encoding='utf-8').read()
    with LOCK, db() as con:
        con.executescript(schema)
        # 옛 D1에서 옮겨 올 것 — /data/seed.json 이 있으면 한 번 붓고 seed.done.json 으로 이름 바꿈(git엔 안 둠)
        seed = os.path.join(os.path.dirname(DB_PATH), 'seed.json')
        if os.path.exists(seed):
            s = json.load(open(seed, encoding='utf-8'))
            for i, n in (s.get('likes') or {}).items():
                con.execute('insert into likes(item_id, count) values (?,?) on conflict(item_id) do update set count = max(count, excluded.count)', (i, n))
            for c in s.get('comments') or []:  # 비번은 못 옮김 → 이 댓글은 수정·삭제 안 됨
                con.execute('insert or ignore into comments(id, item_id, name, message, pw_hash, up, down, created_at) values (?,?,?,?,?,?,?,?)',
                            (c['id'], c['item_id'], c.get('name'), c['message'], '', c.get('up', 0), c.get('down', 0), c['created_at']))
            os.replace(seed, seed[:-5] + '.done.json')


def now_ms():
    return int(time.time() * 1000)


# 비번 해시 — functions/_lib/util.js 와 같은 "salt:hashHex"(PBKDF2-SHA256 10만 번)
def hash_pw(pw):
    salt = secrets.token_bytes(16)
    return salt.hex() + ':' + hashlib.pbkdf2_hmac('sha256', pw.encode(), salt, 100000, 32).hex()


def verify_pw(pw, stored):
    salt_hex, _, hash_hex = str(stored or '').partition(':')
    if not salt_hex or not hash_hex:
        return False
    try:
        salt = bytes.fromhex(salt_hex)
    except ValueError:
        return False
    return hmac.compare_digest(hashlib.pbkdf2_hmac('sha256', pw.encode(), salt, 100000, 32).hex(), hash_hex)


# 같은 IP가 window초 안에 limit회 넘게 요청했으면 True(=차단)
def rate_limited(con, ip, action, limit, window):
    n = con.execute('select count(*) from rate_hits where ip=? and action=? and at>?',
                    (ip, action, now_ms() - window * 1000)).fetchone()[0]
    if n >= limit:
        return True
    con.execute('insert into rate_hits(ip, action, at) values (?,?,?)', (ip, action, now_ms()))
    if secrets.randbelow(20) == 0:  # 가끔 하루 지난 기록 청소
        con.execute('delete from rate_hits where at < ?', (now_ms() - 24 * 3600 * 1000,))
    return False


def honeypot(v):
    return bool(v and str(v).strip())


class H(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=SITE, **kw)

    def log_message(self, fmt, *args):
        pass

    def ip(self):
        return self.headers.get('CF-Connecting-IP') or 'unknown'

    def send_json(self, data, status=200):
        b = json.dumps(data, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def bad(self, msg, status=400):
        self.send_json({'error': msg}, status)

    def body(self):
        try:
            n = int(self.headers.get('Content-Length') or 0)
            v = json.loads(self.rfile.read(min(n, 64 * 1024)) or b'null')
            return v if isinstance(v, dict) else None
        except Exception:
            return None

    def end_headers(self):
        if not self.path.startswith('/api/'):
            self.send_header('Cache-Control', 'no-cache')  # 고친 화면이 바로 보이게(바뀐 게 없으면 304)
        super().end_headers()

    # ── 정적 파일 ─────────────────────────────
    def hidden(self):
        parts = [p for p in unquote(urlparse(self.path).path).split('/') if p]
        if any(p.startswith(('.', '_')) for p in parts):
            return True
        if parts and parts[0] in HIDE_TOP:
            return True
        if not parts or self.path.split('?')[0].endswith('/'):
            return False
        ext = os.path.splitext(parts[-1])[1].lower()
        if not ext:
            return not os.path.isdir(self.translate_path(self.path))  # 폴더면 SimpleHTTP가 / 붙여 넘김
        return ext not in SHOW_EXT

    def list_directory(self, path):
        self.send_error(404)
        return None

    def do_HEAD(self):
        if self.hidden():
            return self.send_error(404)
        super().do_HEAD()

    def do_GET(self):
        u = urlparse(self.path)
        if u.path.startswith('/api/'):
            return self.api_get(u.path, parse_qs(u.query))
        if self.hidden():
            return self.send_error(404)
        super().do_GET()

    # ── API ─────────────────────────────
    def api_get(self, path, q):
        if path == '/api/ping':
            return self.send_json({'ok': True})
        if path == '/api/likes':
            ids = [s.strip() for s in (q.get('ids') or [''])[0].split(',') if s.strip()]
            out = {i: 0 for i in ids}
            if ids:
                with db() as con:
                    rows = con.execute('select item_id, count from likes where item_id in (%s)' % ','.join('?' * len(ids)), ids)
                    for r in rows:
                        out[r['item_id']] = r['count']
            return self.send_json(out)
        if path == '/api/comments':
            item = (q.get('item_id') or [''])[0]
            if not item:
                return self.bad('item_id required')
            with db() as con:
                rows = con.execute('select id, item_id, name, message, up, down, created_at from comments '
                                   'where item_id=? order by created_at desc', (item,)).fetchall()
            return self.send_json([dict(r) for r in rows])
        self.bad('not found', 404)

    def do_POST(self):
        path = urlparse(self.path).path
        b = self.body()
        if b is None:
            return self.bad('bad json')
        with LOCK, db() as con:
            if path == '/api/likes':
                return self.like(con, b)
            if path == '/api/feedback':
                return self.feedback(con, b)
            if path == '/api/comments':
                return self.comment(con, b)
            m = re.fullmatch(r'/api/comments/([^/]+)/(edit|delete|vote)', path)
            if m:
                return getattr(self, 'c_' + m.group(2))(con, unquote(m.group(1)), b)
        self.bad('not found', 404)

    def like(self, con, b):
        i = str(b.get('item_id') or '').strip()
        if not i or len(i) > 100:
            return self.bad('bad item_id')
        if rate_limited(con, self.ip(), 'like', 30, 60):
            return self.bad('too many requests', 429)
        con.execute('insert into likes(item_id, count) values (?,1) on conflict(item_id) do update set count = count + 1', (i,))
        self.send_json({'count': con.execute('select count from likes where item_id=?', (i,)).fetchone()[0]})

    def feedback(self, con, b):
        if honeypot(b.get('hp')):
            return self.send_json({'ok': True})  # 봇 → 성공처럼 답하고 버림
        msg = str(b.get('message') or '').strip()
        if len(msg) < 3 or len(msg) > 2000:
            return self.bad('bad message')
        contact = str(b['contact']).strip()[:200] if b.get('contact') else None
        item = str(b['item_id'])[:100] if b.get('item_id') else None
        if rate_limited(con, self.ip(), 'feedback', 5, 60):
            return self.bad('too many requests', 429)
        con.execute('insert into feedback(id, item_id, message, contact, created_at) values (?,?,?,?,?)',
                    (str(uuid.uuid4()), item, msg, contact, now_ms()))
        self.send_json({'ok': True})

    def comment(self, con, b):
        if honeypot(b.get('hp')):
            return self.send_json({'id': str(uuid.uuid4()), 'up': 0, 'down': 0})
        item = str(b.get('item_id') or '').strip()
        msg = str(b.get('message') or '').strip()
        pw = str(b.get('pw') or '')
        if not item:
            return self.bad('item_id required')
        if len(msg) < 2 or len(msg) > 1000:
            return self.bad('bad message')
        if not re.fullmatch(r'[0-9]{4}', pw):
            return self.bad('pw must be 4 digits')
        name = str(b['name']).strip()[:40] if b.get('name') else None
        if rate_limited(con, self.ip(), 'comment', 10, 60):
            return self.bad('too many requests', 429)
        cid, t = str(uuid.uuid4()), now_ms()
        con.execute('insert into comments(id, item_id, name, message, pw_hash, up, down, created_at) values (?,?,?,?,?,0,0,?)',
                    (cid, item, name, msg, hash_pw(pw), t))
        self.send_json({'id': cid, 'item_id': item, 'name': name, 'message': msg, 'up': 0, 'down': 0, 'created_at': t})

    def c_edit(self, con, cid, b):
        msg = str(b.get('message') or '').strip()
        if len(msg) < 2 or len(msg) > 1000:
            return self.bad('bad message')
        if rate_limited(con, self.ip(), 'edit', 20, 60):
            return self.bad('too many requests', 429)
        row = con.execute('select pw_hash from comments where id=?', (cid,)).fetchone()
        if not row or not verify_pw(str(b.get('pw') or ''), row['pw_hash']):
            return self.send_json({'ok': False})
        con.execute('update comments set message=? where id=?', (msg, cid))
        self.send_json({'ok': True})

    def c_delete(self, con, cid, b):
        if rate_limited(con, self.ip(), 'delete', 20, 60):
            return self.bad('too many requests', 429)
        row = con.execute('select pw_hash from comments where id=?', (cid,)).fetchone()
        if not row or not verify_pw(str(b.get('pw') or ''), row['pw_hash']):
            return self.send_json({'ok': False})
        con.execute('delete from comments where id=?', (cid,))
        self.send_json({'ok': True})

    def c_vote(self, con, cid, b):
        d = b.get('dir')
        if d not in ('up', 'down'):
            return self.bad('bad dir')
        if rate_limited(con, self.ip(), 'vote', 30, 60):
            return self.bad('too many requests', 429)
        con.execute('update comments set %s = %s + 1 where id=?' % (d, d), (cid,))
        row = con.execute('select up, down from comments where id=?', (cid,)).fetchone()
        if not row:
            return self.bad('not found', 404)
        self.send_json(dict(row))


if __name__ == '__main__':
    init_db()
    print('deokgu-lab on', PORT, flush=True)
    ThreadingHTTPServer(('', PORT), H).serve_forever()
