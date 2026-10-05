#!/usr/bin/env python3
"""Inventory and capture public script/style references, without executing them.
Separate from catalog route coverage. Third-party references are inventoried but
not fetched by default. This is static HTML dependency evidence, not an SPA clone.
"""
import argparse
import concurrent.futures
import hashlib
import html.parser
import ipaddress
import json
from pathlib import Path
import sqlite3
import sys
import urllib.parse
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from billworld.research_catalog import DEFAULT, capture, normalized_url

MAX_ASSET_BYTES = 8 * 1024 * 1024


def checked_body(directory, evidence):
    source = (directory / evidence['body_file']).resolve()
    if not source.is_relative_to((directory / 'bodies').resolve()):
        raise ValueError('Body path escapes evidence directory')
    content = source.read_bytes()
    if hashlib.sha256(content).hexdigest() != evidence['body_sha256']:
        raise ValueError('Body hash mismatch')
    return content


def reference_url(base, value):
    url = normalized_url(urllib.parse.urljoin(base, value))
    if not url: return None
    host = urllib.parse.urlsplit(url).hostname
    if host in ('localhost', 'localhost.localdomain') or host.endswith(('.localhost', '.local')): return None
    try:
        if not ipaddress.ip_address(host).is_global: return None
    except ValueError:
        pass
    return url


def same_host(a, b):
    # Only the explicitly observed hostname and its www alias; no guessed eTLD.
    return urllib.parse.urlsplit(a).hostname.removeprefix('www.') == urllib.parse.urlsplit(b).hostname.removeprefix('www.')


class Dependencies(html.parser.HTMLParser):
    def __init__(self, base):
        super().__init__(); self.base = base; self.refs = set(); self.base_seen = False
    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == 'base' and not self.base_seen and a.get('href'):
            self.base_seen = True
            candidate = reference_url(self.base, a['href'])
            if candidate: self.base = candidate
        kind = None; value = None
        if tag == 'script' and a.get('src'): kind = 'script'; value = a['src']
        if tag == 'link':
            rel = set(a.get('rel', '').lower().split())
            if 'stylesheet' in rel: kind = 'style'
            elif 'modulepreload' in rel: kind = 'script'
            elif 'preload' in rel and a.get('as', '').lower() in ('script', 'style'): kind = a['as'].lower()
            value = a.get('href')
        if kind and value:
            url = reference_url(self.base, value)
            if url: self.refs.add((url, kind))


def database(directory):
    directory.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(directory / 'frontends.sqlite', timeout=30)
    db.executescript('''
      PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS assets(id TEXT PRIMARY KEY, url TEXT UNIQUE, status TEXT DEFAULT 'pending', evidence TEXT);
      CREATE TABLE IF NOT EXISTS pages(id TEXT PRIMARY KEY, url TEXT, body_sha256 TEXT);
      CREATE TABLE IF NOT EXISTS page_billers(page_id TEXT, biller_id TEXT, PRIMARY KEY(page_id,biller_id));
      CREATE TABLE IF NOT EXISTS refs(page_id TEXT, asset_id TEXT, kind TEXT, scope TEXT, PRIMARY KEY(page_id,asset_id,kind));
      CREATE INDEX IF NOT EXISTS refs_asset ON refs(asset_id);
      CREATE INDEX IF NOT EXISTS refs_asset_scope ON refs(asset_id,scope);
      CREATE INDEX IF NOT EXISTS biller_pages ON page_billers(biller_id);
      CREATE TABLE IF NOT EXISTS attempts(asset_id TEXT, attempted_at TEXT, evidence TEXT);
    ''')
    if 'base_url' not in {r[1] for r in db.execute('PRAGMA table_info(pages)')}:
        db.execute('ALTER TABLE pages ADD COLUMN base_url TEXT')
        db.commit()
    return db


def initialize(db, source_directory):
    source = sqlite3.connect(f'file:{source_directory / "catalog.sqlite"}?mode=ro', uri=True)
    source.row_factory = sqlite3.Row
    counts = {'html_pages': 0, 'integrity_failures': 0, 'reused_pages': 0}
    db.execute('CREATE TEMP TABLE IF NOT EXISTS seen_pages(id TEXT PRIMARY KEY)')
    db.execute('DELETE FROM seen_pages')
    progress = source_directory / 'frontends' / 'inventory-progress.json'
    def checkpoint(phase):
        db.commit()
        progress.write_text(json.dumps({**counts, 'phase':phase}, indent=2)+'\n')
    # Each page is durable; unchanged hash-verified pages reuse parsed references.
    # Retired-page cleanup happens only after the complete source scan.
    try:
        for row in source.execute("SELECT id,url,evidence FROM urls WHERE status='http_captured'"):
            ev = json.loads(row['evidence'] or '{}')
            if 'html' not in ev.get('content_type', '').lower() or not ev.get('body_file'): continue
            try: content = checked_body(source_directory, ev)
            except (ValueError, OSError, KeyError):
                counts['integrity_failures'] += 1
                db.execute('DELETE FROM refs WHERE page_id=?', (row['id'],))
                db.execute('DELETE FROM page_billers WHERE page_id=?', (row['id'],))
                db.execute('DELETE FROM pages WHERE id=?', (row['id'],))
                continue
            base = ev.get('final_url') or row['url']
            old = db.execute('SELECT body_sha256,base_url FROM pages WHERE id=?', (row['id'],)).fetchone()
            if old and old[0] == ev['body_sha256'] and old[1] == base:
                counts['reused_pages'] += 1
            else:
                parser = Dependencies(base); parser.feed(content.decode('utf-8', errors='replace'))
                db.execute('DELETE FROM refs WHERE page_id=?', (row['id'],))
                db.execute('INSERT OR REPLACE INTO pages(id,url,body_sha256,base_url) VALUES(?,?,?,?)', (row['id'], row['url'], ev['body_sha256'], base))
                for url, kind in sorted(parser.refs):
                    asset_id = hashlib.sha256(url.encode()).hexdigest()
                    db.execute('INSERT OR IGNORE INTO assets(id,url) VALUES(?,?)', (asset_id, url))
                    db.execute('INSERT INTO refs VALUES(?,?,?,?)', (row['id'], asset_id, kind, 'same_host' if same_host(base, url) else 'third_party'))
            db.execute('INSERT INTO seen_pages VALUES(?)', (row['id'],))
            db.execute('DELETE FROM page_billers WHERE page_id=?', (row['id'],))
            billers = source.execute('SELECT DISTINCT biller_id FROM routes WHERE url_id=?', (row['id'],))
            db.executemany('INSERT INTO page_billers VALUES(?,?)', ((row['id'], r[0]) for r in billers))
            counts['html_pages'] += 1
            # Release the writer before parsing the next page. Download evidence
            # commits share this queue and must not wait through HTML parsing.
            db.commit()
            if counts['html_pages'] % 250 == 0: checkpoint('in_progress')
            if counts['html_pages'] % 5000 == 0: print(json.dumps(counts), flush=True)
        db.execute('DELETE FROM refs WHERE page_id NOT IN (SELECT id FROM seen_pages)')
        db.execute('DELETE FROM page_billers WHERE page_id NOT IN (SELECT id FROM seen_pages)')
        db.execute('DELETE FROM pages WHERE id NOT IN (SELECT id FROM seen_pages)')
        checkpoint('completed')
    except BaseException:
        db.rollback()
        raise
    finally: source.close()
    return counts


def capture_asset(row, directory):
    asset_id, evidence = capture(row, directory, max_bytes=MAX_ASSET_BYTES,
        accept='text/css,application/javascript,text/javascript,text/plain;q=0.7,*/*;q=0.1')
    if evidence['status'] == 'http_captured':
        content = checked_body(directory, evidence)
        mime = evidence.get('content_type', '').split(';')[0].strip().lower()
        html = content.lstrip().lower().startswith((b'<!doctype html', b'<html', b'<head', b'<body'))
        kinds = set(row.get('kinds', 'script,style').split(','))
        supported = ('style' in kinds and mime in ('text/css','text/plain')) or ('script' in kinds and mime in ('application/javascript','text/javascript','application/x-javascript','text/plain'))
        evidence['status'] = 'frontend_captured' if supported and not html else 'not_frontend_content'
        evidence['declared_kinds'] = sorted(kinds)
        evidence['execution_policy'] = 'reference_only_not_runtime'
        evidence['verification_limit'] = 'MIME and HTML sniff only; source/application relevance requires review'
    return asset_id, evidence


def pending(db, limit, third_party=False, retry=False, biller_id=None):
    states = ('pending', 'fetch_error') if retry else ('pending',)
    marks = ','.join('?' for _ in states)
    scope = '' if third_party else "AND r.scope='same_host'"
    biller = 'AND r.page_id IN (SELECT page_id FROM page_billers WHERE biller_id=?)' if biller_id else ''
    db.row_factory = sqlite3.Row
    return [dict(r) for r in db.execute(f'''SELECT a.id,a.url,GROUP_CONCAT(DISTINCT r.kind) kinds FROM assets a JOIN refs r ON r.asset_id=a.id
      WHERE a.status IN ({marks}) {scope} {biller} GROUP BY a.id ORDER BY a.id LIMIT ?''', (*states, *([biller_id] if biller_id else []), limit))]


def status(db):
    return {'schema_version': 1, 'html_pages': db.execute('SELECT COUNT(*) FROM pages').fetchone()[0],
        'billers_with_static_references': db.execute('SELECT COUNT(DISTINCT b.biller_id) FROM page_billers b WHERE EXISTS (SELECT 1 FROM refs r WHERE r.page_id=b.page_id)').fetchone()[0],
        'reference_counts_by_scope': dict(db.execute('SELECT scope,COUNT(*) FROM refs GROUP BY scope')),
        'active_asset_status_counts': dict(db.execute('SELECT a.status,COUNT(*) FROM assets a WHERE EXISTS (SELECT 1 FROM refs r WHERE r.asset_id=a.id) GROUP BY a.status')),
        'same_host_pending': db.execute("SELECT COUNT(*) FROM assets a WHERE a.status='pending' AND EXISTS (SELECT 1 FROM refs r WHERE r.asset_id=a.id AND r.scope='same_host')").fetchone()[0],
        'meaning': 'Static script/style references and raw source evidence. Not executable replicas, dynamic dependency completeness, flow coverage or fidelity certification.'}


def biller_assets(source_directory, biller_id):
    directory = source_directory / 'frontends'
    path = directory / 'frontends.sqlite'
    if not path.exists(): return []
    db = sqlite3.connect(f'file:{path}?mode=ro', uri=True); db.row_factory = sqlite3.Row
    catalog = sqlite3.connect(f'file:{source_directory / "catalog.sqlite"}?mode=ro', uri=True)
    records = {}
    try:
        rows = db.execute('''SELECT a.id,a.url,a.status,a.evidence,r.kind,r.scope,p.id page_id,p.url page_url,p.body_sha256
          FROM page_billers b JOIN pages p ON p.id=b.page_id JOIN refs r ON r.page_id=p.id JOIN assets a ON a.id=r.asset_id
          WHERE b.biller_id=? ORDER BY a.id,p.id,r.kind''', (biller_id,))
        for r in rows:
            current = catalog.execute('SELECT evidence FROM urls WHERE id=?', (r['page_id'],)).fetchone()
            if not current: continue
            if not catalog.execute('SELECT 1 FROM routes WHERE url_id=? AND biller_id=?', (r['page_id'], biller_id)).fetchone(): continue
            ev = json.loads(current[0] or '{}')
            if ev.get('status') != 'http_captured' or ev.get('body_sha256') != r['body_sha256']: continue
            # Associations may be intact even if source files were deleted or tampered with.
            checked_body(source_directory, ev)
            item = records.setdefault(r['id'], {'id':r['id'], 'url':r['url'], 'status':r['status'], 'evidence':json.loads(r['evidence'] or '{}'), 'references':[]})
            item['references'].append({'page_url':r['page_url'], 'page_body_sha256':r['body_sha256'], 'kind':r['kind'], 'scope':r['scope']})
        for item in records.values():
            if item['status'] == 'frontend_captured': checked_body(directory, item['evidence'])
    finally: db.close(); catalog.close()
    return list(records.values())


def fetch_work(db, directory, work, workers):
    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
        remaining = iter(work)
        # Keep a bounded number of futures even for the full catalog.
        futures = set()
        def replenish():
            while len(futures) < workers * 2:
                row = next(remaining, None)
                if row is None: break
                futures.add(pool.submit(capture_asset, row, directory))
        replenish()
        while futures:
            completed, _ = concurrent.futures.wait(futures, return_when=concurrent.futures.FIRST_COMPLETED)
            for f in completed:
                futures.remove(f)
                asset_id, ev = f.result(); encoded = json.dumps(ev)
                with db:
                    db.execute('UPDATE assets SET status=?,evidence=? WHERE id=?', (ev['status'], encoded, asset_id))
                    db.execute('INSERT INTO attempts VALUES(?,?,?)', (asset_id, ev['attempted_at'], encoded))
                print(ev['status'], ev['requested_url'], flush=True)
            replenish()


def main():
    p = argparse.ArgumentParser(description=__doc__); p.add_argument('command', choices=['init','fetch','status'])
    p.add_argument('--directory', type=Path, default=DEFAULT); p.add_argument('--limit', type=int, default=100)
    p.add_argument('--workers', type=int, default=4); p.add_argument('--third-party', action='store_true'); p.add_argument('--retry', action='store_true')
    p.add_argument('--biller-id', help='Select one biller for a prioritized source capture; does not change the inventory')
    a = p.parse_args()
    if a.limit < 1 or not 1 <= a.workers <= 8: p.error('Positive limit and workers between 1 and 8 required')
    directory = a.directory / 'frontends'; db = database(directory)
    if a.command == 'init': print(json.dumps(initialize(db, a.directory)), flush=True)
    if a.command == 'fetch':
        work = pending(db, a.limit, a.third_party, a.retry, a.biller_id)
        fetch_work(db, directory, work, a.workers)
    summary = status(db); (directory / 'status.json').write_text(json.dumps(summary, indent=2)+'\n'); print(json.dumps(summary, indent=2)); db.close()

if __name__ == '__main__': main()
