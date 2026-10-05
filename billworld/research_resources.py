#!/usr/bin/env python3
"""Bounded inert resource capture from current, hash-verified source syntax."""
import argparse
from collections import Counter
import concurrent.futures
from datetime import datetime, timezone
import fcntl
import hashlib
import json
from pathlib import Path
import re
import shutil
from billworld.research_capacity import require_capacity
from billworld.research_catalog import DEFAULT, capture
from billworld.research_frontends import checked_body, reference_url, same_host
from billworld.research_dependencies import biller_dependency_reports
from billworld.research_dependency_capture import traverse, database

LIMITS = ['Static references are not observed browser requests or complete resource coverage',
          'Only current parsed CSS url() and literal import.meta.url resources are eligible',
          'Captured bytes remain inert review inputs; SVG/PDF content is not sanitized for serving',
          'HTML images, computed paths, embedded resources and source maps remain unfinished']


CLASSIFIER_REVISION = 'resource-signature-v2'


def eot_signature(content):
    # EOT submission: little-endian size/version fields and 0x504C at offset 34.
    # https://www.w3.org/submissions/EOT/ (format recognition, not font decoding).
    return (len(content) >= 82 and int.from_bytes(content[:4], 'little') == len(content)
            and 0 < int.from_bytes(content[4:8], 'little') <= len(content) - 82
            and int.from_bytes(content[8:12], 'little') in (0x10000, 0x20001, 0x20002)
            and content[34:36] == b'LP')


def resource_type(content, mime):
    """Conservative MIME/signature check, not full decoding or content approval."""
    mime = mime.split(';')[0].strip().lower()
    checks = [
        ('png', {'image/png'}, content.startswith(b'\x89PNG\r\n\x1a\n')),
        ('jpeg', {'image/jpeg'}, content.startswith(b'\xff\xd8\xff')),
        ('gif', {'image/gif'}, content.startswith((b'GIF87a', b'GIF89a'))),
        ('webp', {'image/webp'}, content[:4] == b'RIFF' and content[8:12] == b'WEBP'),
        ('ico', {'image/x-icon', 'image/vnd.microsoft.icon'}, content.startswith(b'\x00\x00\x01\x00')),
        ('woff', {'font/woff', 'application/font-woff', 'application/octet-stream'}, content.startswith(b'wOFF')),
        ('woff2', {'font/woff2', 'application/font-woff2', 'application/octet-stream'}, content.startswith(b'wOF2')),
        ('ttf', {'font/ttf', 'font/sfnt', 'application/font-sfnt', 'application/x-font-ttf', 'application/octet-stream'}, content.startswith(b'\x00\x01\x00\x00')),
        ('otf', {'font/otf', 'font/sfnt', 'application/font-sfnt', 'application/x-font-opentype', 'application/octet-stream'}, content.startswith(b'OTTO')),
        ('eot', {'application/vnd.ms-fontobject', 'application/octet-stream'}, eot_signature(content)),
        ('pdf', {'application/pdf'}, content.startswith(b'%PDF-')),
        ('svg', {'image/svg+xml'}, bool(re.match(rb'(?:\xef\xbb\xbf)?\s*(?:<\?xml[^>]*\?>\s*)?(?:<!--.*?-->\s*)*<svg(?:\s|/?>)', content[:4096], re.S))),
    ]
    return next((name for name, types, signature in checks if mime in types and signature), None)


def capture_resource(row, directory):
    aid, evidence = capture(row, directory, max_bytes=8 * 1024 * 1024,
                            accept='image/*,font/*,application/pdf;q=0.8,*/*;q=0.1')
    if evidence['status'] == 'http_captured':
        kind = resource_type(checked_body(directory, evidence), evidence.get('content_type', ''))
        evidence.update(status='resource_captured' if kind else 'unsupported_resource_content',
                        resource_type=kind, classifier_revision=CLASSIFIER_REVISION, execution_policy='reference_only_not_runtime',
                        verification_limit='MIME/signature only; decoding, relevance and safe runtime use require review')
    return aid, evidence


def inventory(source_directory, biller_id, max_nodes=500, third_party=False, prepare=False):
    if isinstance(max_nodes, bool) or not isinstance(max_nodes, int) or not 1 <= max_nodes <= 10000:
        raise ValueError('Invalid resource node bound')
    directory = source_directory / 'frontends/resources'
    reports = biller_dependency_reports(source_directory, biller_id)
    children = traverse(source_directory, biller_id)
    reports += [item['dependency_candidates'] for item in children['assets'] if 'dependency_candidates' in item]
    db = database(directory) if prepare or (directory / 'captures.sqlite').exists() else None
    found = {}; limits = set(children['limits'])
    try:
        for report in reports:
            for ref in report['dependencies']:
                if ref['kind'] != 'resource': continue
                url = ref['url']
                if reference_url(report['source_base_url'], url) != url:
                    raise ValueError('Invalid stored resource URL')
                if not third_party and not same_host(report['source_base_url'], url): continue
                aid = hashlib.sha256(url.encode()).hexdigest()
                if aid not in found and len(found) >= max_nodes:
                    limits.add('max_resource_nodes_reached'); continue
                if aid not in found:
                    if prepare:
                        with db: db.execute('INSERT OR IGNORE INTO assets(id,url) VALUES(?,?)', (aid, url))
                    row = db.execute('SELECT * FROM assets WHERE id=?', (aid,)).fetchone() if db else None
                    item = dict(row) if row else {'id': aid, 'url': url, 'status': 'pending', 'evidence': None}
                    item['evidence'] = json.loads(item['evidence'] or '{}')
                    item['references'] = []
                    item['source_directory'] = 'frontends/resources'
                    if item['status'] == 'resource_captured': checked_body(directory, item['evidence'])
                    found[aid] = item
                edge = {'parent_asset_id': report['asset_id'], 'parent_url': report['source_url'],
                        'parent_body_sha256': report['body_sha256'], 'parser_revision': report['parser_revision'],
                        'specifier': ref['specifier'], 'syntax': ref['syntax'],
                        'evidence_type': 'static_source_syntax_not_observed_request'}
                if edge not in found[aid]['references']: found[aid]['references'].append(edge)
        return {'assets': list(found.values()), 'limits': sorted(limits), 'max_nodes': max_nodes,
                'third_party': third_party, 'verified_source_reports': len(reports), 'unfinished': LIMITS}
    finally:
        if db: db.close()


def fetch(source_directory, biller_id, limit=25, workers=2, max_nodes=500, third_party=False, retry=False, min_free_gib=4):
    for value, upper in [(limit, 1000), (workers, 8), (max_nodes, 10000)]:
        if isinstance(value, bool) or not isinstance(value, int) or not 1 <= value <= upper:
            raise ValueError('Invalid resource collection bound')
    if isinstance(min_free_gib, bool) or not isinstance(min_free_gib, (int, float)) or not 1 <= min_free_gib <= 1000:
        raise ValueError('Invalid free-space reserve')
    directory = source_directory / 'frontends/resources'; directory.mkdir(parents=True, exist_ok=True)
    with (directory / 'capture.lock').open('a') as owner:
        try: fcntl.flock(owner, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError: raise RuntimeError('A resource collector already owns this directory')
        before = inventory(source_directory, biller_id, max_nodes, third_party, True)
        states = {'pending', 'fetch_error'} if retry else {'pending'}
        work = [r for r in before['assets'] if r['status'] in states][:limit]
        if work: require_capacity(directory, min_free_gib, len(work) * 8 * 1024**2, before, 'Resource collection')
        db = database(directory); outcomes = Counter()
        try:
            with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
                for aid, ev in pool.map(lambda r: capture_resource(r, directory), work):
                    encoded = json.dumps(ev)
                    with db:
                        db.execute('UPDATE assets SET status=?,evidence=? WHERE id=?', (ev['status'], encoded, aid))
                        db.execute('INSERT INTO attempts VALUES(?,?,?)', (aid, ev['attempted_at'], encoded))
                    outcomes[ev['status']] += 1
        finally: db.close()
        return {'kind': 'biller_inert_resource_capture', 'biller_id': biller_id,
                'attempted': len(work), 'outcomes': dict(outcomes), 'batch_limit': limit,
                **inventory(source_directory, biller_id, max_nodes, third_party)}


def reclassify(source_directory, limit=100):
    """Review saved unsupported bytes offline; retain fetch evidence and audit changes."""
    if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= 1000:
        raise ValueError('Invalid reclassification bound')
    directory = source_directory / 'frontends/resources'
    directory.mkdir(parents=True, exist_ok=True)
    with (directory / 'capture.lock').open('a') as owner:
        try: fcntl.flock(owner, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError: raise RuntimeError('A resource collector already owns this directory')
        db = database(directory)
        try:
            db.execute('CREATE TABLE IF NOT EXISTS classifications(asset_id TEXT, classified_at TEXT, revision TEXT, previous_evidence TEXT, evidence TEXT)')
            db.commit()
            changed = []; reviewed = 0
            with db:
                rows = db.execute("SELECT * FROM assets WHERE status='unsupported_resource_content' AND COALESCE(json_extract(evidence,'$.classifier_revision'),'') != ? ORDER BY id LIMIT ?", (CLASSIFIER_REVISION, limit)).fetchall()
                for row in rows:
                    evidence = json.loads(row['evidence'])
                    content = checked_body(directory, evidence)
                    kind = resource_type(content, evidence.get('content_type', ''))
                    evidence.update(status='resource_captured' if kind else 'unsupported_resource_content',
                                    resource_type=kind, classifier_revision=CLASSIFIER_REVISION,
                                    classified_at=datetime.now(timezone.utc).isoformat(),
                                    execution_policy='reference_only_not_runtime')
                    encoded = json.dumps(evidence)
                    db.execute('INSERT INTO classifications VALUES(?,?,?,?,?)', (row['id'], evidence['classified_at'], CLASSIFIER_REVISION, row['evidence'], encoded))
                    db.execute('UPDATE assets SET status=?,evidence=? WHERE id=?', (evidence['status'], encoded, row['id']))
                    reviewed += 1
                    if kind: changed.append({'asset_id': row['id'], 'resource_type': kind, 'body_sha256': evidence['body_sha256']})
            return {'kind': 'offline_resource_reclassification', 'classifier_revision': CLASSIFIER_REVISION,
                    'reviewed': reviewed, 'newly_supported': changed, 'network_requests': 0,
                    'scope': 'Saved byte classification only; current source associations verified separately'}
        finally: db.close()


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--directory', type=Path, default=DEFAULT); p.add_argument('--biller-id'); p.add_argument('--reclassify', action='store_true')
    p.add_argument('--limit', type=int, default=25); p.add_argument('--workers', type=int, default=2)
    p.add_argument('--max-nodes', type=int, default=500); p.add_argument('--third-party', action='store_true')
    p.add_argument('--retry', action='store_true'); p.add_argument('--min-free-gib', type=float, default=4)
    p.add_argument('--output', type=Path, required=True); a = p.parse_args()
    if a.reclassify and a.biller_id: p.error('Reclassification operates on saved bytes, not a biller scope')
    if not a.reclassify and not a.biller_id: p.error('--biller-id is required for collection')
    result = reclassify(a.directory, a.limit) if a.reclassify else fetch(a.directory, a.biller_id, a.limit, a.workers, a.max_nodes, a.third_party, a.retry, a.min_free_gib)
    a.output.parent.mkdir(parents=True, exist_ok=True)
    temp = a.output.with_suffix('.tmp'); temp.write_text(json.dumps(result, indent=2)+'\n'); temp.replace(a.output)
    print(json.dumps({k: v for k, v in result.items() if k != 'assets'}))
