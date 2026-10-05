#!/usr/bin/env python3
"""Resumable public GET research for every catalog entry; never submits forms.

python3 billworld/research_catalog.py init
python3 billworld/research_catalog.py fetch --limit 24 --workers 3
python3 billworld/research_catalog.py status
HTTP capture is evidence to review, not proof of working/authenticated flows.
"""
import argparse
import concurrent.futures
import hashlib
import html.parser
import ipaddress
import json
import pathlib
import socket
import sqlite3
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from audit_billworld import identity
DEFAULT = ROOT / 'billworld/research-data'
USER_AGENT = 'BillworldResearch/0.1 (public read-only biller-flow research)'
MAX_BYTES = 2 * 1024 * 1024


def normalized_url(value):
    if not isinstance(value, str): return None
    try:
        u = urllib.parse.urlsplit(value.strip())
        if u.scheme not in ('https', 'http') or not u.hostname or u.username or u.password: return None
        return urllib.parse.urlunsplit((u.scheme.lower(), u.netloc.lower(), u.path or '/', u.query, ''))
    except ValueError: return None


def public_address(url):
    u = urllib.parse.urlsplit(url)
    if not normalized_url(url): raise ValueError('Only public HTTP(S) URLs are supported')
    ips = socket.getaddrinfo(u.hostname, u.port or (443 if u.scheme == 'https' else 80), type=socket.SOCK_STREAM)
    if not ips or any(not ipaddress.ip_address(item[4][0]).is_global for item in ips):
        raise ValueError('Private or non-public network address excluded')


def transport_url(value):
    """Encode source URL spaces/Unicode for HTTP without changing its identity."""
    if not isinstance(value,str) or any(ord(c)<32 or ord(c)==127 for c in value):
        raise ValueError('URL contains control characters')
    normalized=normalized_url(value)
    if not normalized:raise ValueError('Only public HTTP(S) URLs are supported')
    u=urllib.parse.urlsplit(normalized)
    host=u.hostname.encode('idna').decode('ascii')
    authority=('['+host+']') if ':' in host else host
    if u.port is not None:authority+=':'+str(u.port)
    return urllib.parse.urlunsplit((u.scheme,authority,
        urllib.parse.quote(u.path,safe="/%:@!$&'()*+,;=-._~"),
        urllib.parse.quote(u.query,safe="!$&'()*+,-./:;=?@_%~"),''))


class PublicRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        newurl=transport_url(newurl)
        public_address(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


class PageData(html.parser.HTMLParser):
    def __init__(self):
        super().__init__(); self.title_parts = []; self.in_title = False; self.scripts = []; self.links = []
    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == 'title': self.in_title = True
        if tag == 'script' and a.get('src'): self.scripts.append(a['src'])
        if tag == 'a' and a.get('href'): self.links.append(a['href'])
    def handle_endtag(self, tag):
        if tag == 'title': self.in_title = False
    def handle_data(self, data):
        if self.in_title: self.title_parts.append(data)


def database(directory):
    directory.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(directory / 'catalog.sqlite')
    db.executescript('''
      PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS billers (id TEXT PRIMARY KEY, name TEXT, category TEXT, source_file TEXT, source_sha256 TEXT, missing_fields TEXT);
      CREATE TABLE IF NOT EXISTS urls (id TEXT PRIMARY KEY, url TEXT UNIQUE, status TEXT NOT NULL DEFAULT 'pending', evidence TEXT);
      CREATE TABLE IF NOT EXISTS routes (biller_id TEXT, kind TEXT, original_url TEXT, url_id TEXT, PRIMARY KEY(biller_id,kind));
      CREATE INDEX IF NOT EXISTS route_url ON routes(url_id);
      CREATE INDEX IF NOT EXISTS url_status ON urls(status);
      CREATE TABLE IF NOT EXISTS attempts (url_id TEXT, attempted_at TEXT, evidence TEXT);
    ''')
    return db


def initialize(db, root=ROOT):
    invalid = 0
    paths = sorted((root / 'categories').glob('*.json'))
    if not paths: raise ValueError('No category sources found; refusing to replace the catalog snapshot')
    with db:
        db.execute('CREATE TEMP TABLE IF NOT EXISTS seen_billers(id TEXT PRIMARY KEY)')
        db.execute('DELETE FROM seen_billers')
        for path in paths:
            content = path.read_bytes(); source_hash = hashlib.sha256(content).hexdigest()
            for e in json.loads(content)['entries']:
                biller_id = identity(e, path.stem)
                db.execute('INSERT INTO seen_billers VALUES(?)', (biller_id,))
                urls = {k: e.get(k) for k in ['website', 'login_url', 'help_center_url']}
                urls.update({f'links.{k}': (e.get('links') or {}).get(k) for k in ['view_bill', 'pay_bill', 'autopay_setup', 'autopay_cancel', 'statements_history', 'paperless', 'payment_assistance']})
                missing = [k for k, v in urls.items() if not normalized_url(v)]
                db.execute('INSERT OR REPLACE INTO billers VALUES(?,?,?,?,?,?)', (biller_id, e.get('name'), path.stem, str(path.relative_to(root)), source_hash, json.dumps(missing)))
                # Refresh associations without losing already captured URL evidence.
                db.execute('DELETE FROM routes WHERE biller_id=?', (biller_id,))
                for kind, original in urls.items():
                    url = normalized_url(original)
                    if not url:
                        if original: invalid += 1
                        continue
                    url_id = hashlib.sha256(url.encode()).hexdigest()
                    db.execute('INSERT OR IGNORE INTO urls(id,url) VALUES(?,?)', (url_id, url))
                    db.execute('INSERT INTO routes VALUES(?,?,?,?)', (biller_id, kind, original, url_id))
        db.execute('DELETE FROM routes WHERE biller_id NOT IN (SELECT id FROM seen_billers)')
        db.execute('DELETE FROM billers WHERE id NOT IN (SELECT id FROM seen_billers)')
    return invalid


_host_lock = threading.Lock()
_host_next = {}

def capture(row, directory, max_bytes=MAX_BYTES, accept='text/html,application/xhtml+xml,*/*;q=0.5'):
    url_id, url = row['id'], row['url']; attempted_at = datetime.now(timezone.utc).isoformat()
    evidence = {'requested_url': url, 'attempted_at': attempted_at, 'mode': 'public_get', 'authenticated': False, 'review_status': 'unreviewed'}
    try:
        request_url=transport_url(url)
        if request_url!=url:evidence['transport_url']=request_url
        host = urllib.parse.urlsplit(request_url).hostname
        with _host_lock:
            delay = max(0, _host_next.get(host, 0) - time.monotonic())
            _host_next[host] = time.monotonic() + delay + 1.5
        if delay: time.sleep(delay)
        public_address(request_url)
        opener = urllib.request.build_opener(PublicRedirect())
        request = urllib.request.Request(request_url, headers={'User-Agent': USER_AGENT, 'Accept': accept})
        with opener.open(request, timeout=18) as response:
            content = response.read(max_bytes + 1)
            evidence.update(final_url=response.url, http_status=response.status, content_type=response.headers.get('Content-Type', ''), bytes=len(content))
            if len(content) > max_bytes:
                evidence['status'] = 'too_large'; evidence['error'] = 'Body exceeds capture limit; browser capture required'
            else:
                body_hash = hashlib.sha256(content).hexdigest()
                target = directory / 'bodies' / body_hash; target.parent.mkdir(exist_ok=True); target.write_bytes(content)
                evidence.update(body_sha256=body_hash, body_file=str(target.relative_to(directory)), status='http_captured')
                if 'html' in evidence['content_type'].lower():
                    parser = PageData(); parser.feed(content.decode(response.headers.get_content_charset() or 'utf-8', errors='replace'))
                    evidence['title'] = ''.join(parser.title_parts).strip()
                    evidence['script_urls'] = sorted({u for src in parser.scripts if (u := normalized_url(urllib.parse.urljoin(response.url, src)))})
                    evidence['task_link_candidates'] = sorted({u for src in parser.links if (u := normalized_url(urllib.parse.urljoin(response.url, src))) and any(word in u.lower() for word in ['billing', 'payment', 'autopay', 'login', 'sign-in', 'account', 'statement', 'faq', 'help'])})[:200]
                    evidence['rendering_limit'] = 'Server HTML only; JavaScript execution and content matching require browser review'
    except urllib.error.HTTPError as error:
        evidence.update(status='http_error', http_status=error.code, error=str(error))
    except Exception as error:
        evidence.update(status='fetch_error', error=f'{type(error).__name__}: {error}')
    return url_id, evidence


def pending(db, limit, kinds, retry=False):
    db.row_factory = sqlite3.Row
    marks = ','.join('?' for _ in kinds)
    states = "('pending','fetch_error')" if retry else "('pending')"
    query = f'''
      WITH candidates AS (
        SELECT u.id,u.url,MIN(b.category) category FROM urls u JOIN routes r ON r.url_id=u.id JOIN billers b ON b.id=r.biller_id
        WHERE u.status IN {states} AND r.kind IN ({marks}) GROUP BY u.id
      ), ranked AS (SELECT *, ROW_NUMBER() OVER(PARTITION BY category ORDER BY id) rank FROM candidates)
      SELECT id,url FROM ranked ORDER BY rank,category LIMIT ?
    '''
    return [dict(row) for row in db.execute(query, [*kinds, limit])]


def status(db):
    return {
        'biller_count': db.execute('SELECT COUNT(*) FROM billers').fetchone()[0],
        'route_count': db.execute('SELECT COUNT(*) FROM routes').fetchone()[0],
        'unique_url_count': db.execute('SELECT COUNT(*) FROM urls').fetchone()[0],
        'active_unique_url_count': db.execute('SELECT COUNT(DISTINCT url_id) FROM routes').fetchone()[0],
        'url_status_counts': dict(db.execute('SELECT status,COUNT(*) FROM urls GROUP BY status')),
        'biller_records_with_missing_routes': db.execute("SELECT COUNT(*) FROM billers WHERE missing_fields!='[]'").fetchone()[0],
        'meaning': 'http_captured means response body saved; no flow or content verification implied',
    }


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('command', choices=['init', 'fetch', 'status']); p.add_argument('--directory', type=pathlib.Path, default=DEFAULT)
    p.add_argument('--limit', type=int, default=24); p.add_argument('--workers', type=int, default=3)
    p.add_argument('--kinds', default='help_center_url,links.pay_bill'); p.add_argument('--retry', action='store_true')
    args = p.parse_args()
    if args.limit < 1 or not 1 <= args.workers <= 8: p.error('limit must be positive; workers must be between 1 and 8')
    db = database(args.directory)
    if args.command == 'init': print('invalid populated URLs:', initialize(db))
    if args.command == 'fetch':
        work = pending(db, args.limit, args.kinds.split(','), args.retry)
        with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
            futures = [pool.submit(capture, row, args.directory) for row in work]
            for f in concurrent.futures.as_completed(futures):
                url_id, evidence = f.result(); encoded = json.dumps(evidence)
                with db:
                    db.execute('UPDATE urls SET status=?,evidence=? WHERE id=?', (evidence['status'], encoded, url_id))
                    db.execute('INSERT INTO attempts VALUES(?,?,?)', (url_id, evidence['attempted_at'], encoded))
                print(evidence['status'], evidence.get('http_status', ''), evidence['requested_url'], flush=True)
    summary = status(db)
    (args.directory / 'status.json').write_text(json.dumps(summary, indent=2) + '\n'); print(json.dumps(summary, indent=2)); db.close()

if __name__ == '__main__': main()
