#!/usr/bin/env python3
"""Resumable bounded resource sweeps over the currently analyzed source catalog."""
import argparse
from collections import Counter
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import os
from pathlib import Path
import shutil
import signal
import sqlite3
from billworld.research_capacity import CaptureCapacityLimited
from billworld.research_catalog import DEFAULT
from billworld.research_dependencies import revision
from billworld.research_resources import fetch, inventory, CLASSIFIER_REVISION
from billworld.research_frontend_queue import write_json


def candidates(source_directory):
    directory = source_directory / 'frontends'
    if not all((directory / name).exists() for name in ['frontends.sqlite', 'dependencies.sqlite']): return []
    db = sqlite3.connect(f'file:{directory / "frontends.sqlite"}?mode=ro', uri=True)
    try:
        db.execute('ATTACH DATABASE ? AS parsed', (str(directory / 'dependencies.sqlite'),))
        # Imports are included because their captured descendants may hold resources.
        return [r[0] for r in db.execute('''WITH eligible AS MATERIALIZED (
            SELECT s.id FROM parsed.analyses a JOIN assets s ON s.id=a.asset_id
            WHERE s.status='frontend_captured' AND a.parser_revision=?
              AND a.body_sha256=json_extract(s.evidence,'$.body_sha256')
              AND json_extract(a.report,'$.source_url')=s.url
              AND EXISTS(SELECT 1 FROM json_each(a.report,'$.dependencies') d
                WHERE json_extract(d.value,'$.kind') IN ('script','style','resource')))
            SELECT DISTINCT b.biller_id FROM eligible e JOIN refs r ON r.asset_id=e.id
            JOIN page_billers b ON b.page_id=r.page_id ORDER BY b.biller_id''', (revision(),))]
    finally: db.close()


def signature(snapshot):
    # inventory freshly verifies rooted source chains and any captured resource bytes.
    inputs = [{'id': a['id'], 'url': a['url'], 'references': a['references']} for a in snapshot['assets']]
    return hashlib.sha256(json.dumps({'assets': inputs, 'limits': snapshot['limits'],
        'max_nodes': snapshot['max_nodes'], 'third_party': snapshot['third_party'],
        'parser_revision': revision(), 'classifier_revision': CLASSIFIER_REVISION}, sort_keys=True).encode()).hexdigest()


def run(source_directory=DEFAULT, batch_limit=25, workers=2, max_nodes=500,
        max_batches_per_biller=20, min_free_gib=4, third_party=True, biller_limit=None):
    for value, upper in [(batch_limit, 1000), (workers, 8), (max_nodes, 10000), (max_batches_per_biller, 1000)]:
        if isinstance(value, bool) or not isinstance(value, int) or not 1 <= value <= upper:
            raise ValueError('Invalid resource sweep bound')
    if isinstance(min_free_gib, bool) or not isinstance(min_free_gib, (int, float)) or not 1 <= min_free_gib <= 1000:
        raise ValueError('Invalid free-space reserve')
    if biller_limit is not None and (isinstance(biller_limit, bool) or not isinstance(biller_limit, int) or biller_limit < 1):
        raise ValueError('Invalid biller limit')
    directory = source_directory / 'frontends/resources'; directory.mkdir(parents=True, exist_ok=True)
    with (directory / 'catalog-supervisor.lock').open('a') as owner:
        try: fcntl.flock(owner, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError: raise RuntimeError('A resource catalog supervisor is already live')
        # Fail before publishing job ownership if a finite resource batch is active.
        with (directory / 'capture.lock').open('a') as batch_owner:
            try: fcntl.flock(batch_owner, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError: raise RuntimeError('A resource batch is already live')
        return run_owned(source_directory, directory, batch_limit, workers, max_nodes,
                         max_batches_per_biller, min_free_gib, third_party, biller_limit)


def run_owned(source_directory, directory, batch_limit, workers, max_nodes, max_batches, reserve, third_party, biller_limit):
    db = sqlite3.connect(directory / 'catalog-sweeps.sqlite', timeout=30)
    db.execute('CREATE TABLE IF NOT EXISTS billers(biller_id TEXT, signature TEXT, phase TEXT, receipt TEXT, PRIMARY KEY(biller_id,signature))')
    db.commit()
    record = {'pid': os.getpid(), 'phase': 'initializing', 'started_at': datetime.now(timezone.utc).isoformat(),
              'collector_revision': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
              'resource_collector_revision': hashlib.sha256(Path(__file__).with_name('research_resources.py').read_bytes()).hexdigest(),
              'parser_revision': revision(), 'classifier_revision': CLASSIFIER_REVISION,
              'batch_limit': batch_limit, 'workers': workers, 'max_nodes': max_nodes,
              'max_batches_per_biller': max_batches, 'min_free_gib': reserve, 'third_party': third_party,
              'billers_visited': 0, 'skipped_unchanged': 0, 'attempted_resources': 0, 'outcomes': {},
              'scope': 'Current analyzed literal source resources; inert public GET evidence only',
              'limits': ['Finished sweep is not full catalog/source coverage',
                         'Stored source-chain bounds, missing analyses and inaccessible source remain incomplete',
                         'Failures/unsupported responses are retained, not automatically retried',
                         'No original source execution, font installation, runtime or fidelity credit']}
    job = directory / 'catalog-job.json'; stops = []
    handlers = {s: signal.signal(s, lambda signum, frame: stops.append(signum)) for s in [signal.SIGINT, signal.SIGTERM]}
    try:
        write_json(job, record)
        cohort = candidates(source_directory); record['candidate_billers'] = len(cohort); write_json(job, record)
        for bid in cohort:
            if stops: record.update(phase='stopped', exit_code=0); break
            if shutil.disk_usage(directory).free < reserve * 1024**3 + batch_limit * 8 * 1024**2:
                record.update(phase='capacity_limited', exit_code=2); break
            before = inventory(source_directory, bid, max_nodes, third_party)
            sig = signature(before)
            old = db.execute('SELECT phase FROM billers WHERE biller_id=? AND signature=?', (bid, sig)).fetchone()
            # A separately requeued/shared source remains eligible even with an old receipt.
            if old and old[0] == 'current_candidates_exhausted' and not any(a['status'] == 'pending' for a in before['assets']):
                record['skipped_unchanged'] += 1; continue
            record.update(phase='collecting', biller_id=bid, source_signature=sig, biller_batches_completed=0); write_json(job, record)
            with db: db.execute('INSERT OR REPLACE INTO billers VALUES(?,?,?,?)', (bid, sig, 'running', None))
            attempted = 0; outcomes = Counter(); last = before; phase = 'batch_limit_reached'
            for batch in range(max_batches):
                if stops: phase = 'stopped'; break
                if shutil.disk_usage(directory).free < reserve * 1024**3 + batch_limit * 8 * 1024**2:
                    phase = 'capacity_limited'; break
                try:
                    last = fetch(source_directory, bid, batch_limit, workers, max_nodes, third_party, min_free_gib=reserve)
                except CaptureCapacityLimited as error:
                    last = error.snapshot; phase = 'capacity_limited'
                    record['capacity_stop'] = {'free_bytes': error.free_bytes, 'required_bytes': error.required_bytes, 'stage': 'before_batch_dispatch'}
                    break
                attempted += last['attempted']; outcomes.update(last['outcomes']); record['attempted_resources'] += last['attempted']
                totals = Counter(record['outcomes']); totals.update(last['outcomes']); record['outcomes'] = dict(totals)
                record['biller_batches_completed'] = batch + 1; write_json(job, record)
                if not any(a['status'] == 'pending' for a in last['assets']): phase = 'current_candidates_exhausted'; break
            receipt = {'biller_id': bid, 'source_signature': sig, 'phase': phase, 'attempted': attempted,
                       'outcomes': dict(outcomes), 'completed_at': datetime.now(timezone.utc).isoformat(),
                       'limits': last['limits'], 'asset_status_counts': dict(Counter(a['status'] for a in last['assets']))}
            with db: db.execute('UPDATE billers SET phase=?,receipt=? WHERE biller_id=? AND signature=?', (phase, json.dumps(receipt), bid, sig))
            record['billers_visited'] += 1; record['last_biller'] = receipt; write_json(job, record)
            print(json.dumps(receipt), flush=True)
            if phase in ('stopped', 'capacity_limited'): record.update(phase=phase, exit_code=2 if phase == 'capacity_limited' else 0); break
            if biller_limit and record['billers_visited'] >= biller_limit: record.update(phase='biller_limit_reached', exit_code=0); break
        else: record.update(phase='current_candidate_sweep_finished', exit_code=0)
    except BaseException as error:
        record.update(phase='failed', exit_code=1, error_type=type(error).__name__, error=str(error)[:500]); raise
    finally:
        for signum, handler in handlers.items(): signal.signal(signum, handler)
        record['last_observed_at'] = datetime.now(timezone.utc).isoformat(); write_json(job, record); db.close()
    return record


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--directory', type=Path, default=DEFAULT); p.add_argument('--batch-limit', type=int, default=25)
    p.add_argument('--workers', type=int, default=2); p.add_argument('--max-nodes', type=int, default=500)
    p.add_argument('--max-batches-per-biller', type=int, default=20); p.add_argument('--min-free-gib', type=float, default=4)
    p.add_argument('--same-host-only', action='store_true'); p.add_argument('--biller-limit', type=int)
    a = p.parse_args()
    result = run(a.directory, a.batch_limit, a.workers, a.max_nodes, a.max_batches_per_biller, a.min_free_gib, not a.same_host_only, a.biller_limit)
    print(json.dumps(result, indent=2)); raise SystemExit(result['exit_code'])
