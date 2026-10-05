#!/usr/bin/env python3
"""Consume static frontend references while the checkpointed inventory grows.
One collector per directory. This job records source evidence, not site coverage.
"""
import argparse
from contextlib import contextmanager
import fcntl
from datetime import datetime, timezone
import json
import os
import re
import signal
from pathlib import Path
import shutil
import sys
import time
from urllib.parse import urlsplit
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from billworld.research_frontends import database, pending, fetch_work, status
from billworld.research_catalog import DEFAULT


def write_json(path, value):
    temp = path.with_suffix('.tmp'); temp.write_text(json.dumps(value, indent=2)+'\n'); temp.replace(path)


def inventory_state(directory):
    path = directory/'inventory-job.json'
    if not path.exists(): return 'missing'
    try: record = json.loads(path.read_text())
    except json.JSONDecodeError: return 'updating'
    if record.get('phase') == 'completed' and record.get('exit_code') == 0: return 'completed'
    if record.get('phase') != 'running': return 'incomplete'
    try: os.kill(record['pid'], 0)
    except ProcessLookupError: return 'stopped'
    except PermissionError: pass
    return 'running'


def prioritized_work(db, directory, limit=100):
    path=directory/'capture-priorities.json'
    priorities=[]
    if path.exists():
        priorities=json.loads(path.read_text()).get('biller_ids',[])
        if not isinstance(priorities,list) or len(priorities)>256 or any(not isinstance(x,str) or not re.fullmatch(r'biller_[0-9a-f]{20}',x) for x in priorities):
            raise ValueError('Invalid frontend capture priorities')
        priorities=list(dict.fromkeys(priorities))
    selected=[];seen=set()
    for biller in priorities:
        for row in pending(db,limit,third_party=True,biller_id=biller):
            if row['id'] in seen: continue
            selected.append(row);seen.add(row['id'])
            if len(selected)==limit: return selected,priorities
    # Priorities only reorder pending work; global catalog work remains in scope.
    for row in pending(db,limit+len(selected),third_party=True):
        if row['id'] in seen: continue
        selected.append(row);seen.add(row['id'])
        if len(selected)==limit: break
    return selected,priorities


def dns_failure_burst(db, work):
    """Stop on a widespread DNS failure batch; do not infer permanent dead sites."""
    marks=','.join('?' for _ in work)
    failures=[]
    for asset_id,url,evidence in db.execute(
            f"SELECT id,url,evidence FROM assets WHERE status='fetch_error' AND id IN ({marks})",
            tuple(row['id'] for row in work)):
        error=json.loads(evidence or '{}').get('error','')
        if error.startswith('gaierror:'):
            failures.append((asset_id,urlsplit(url).hostname))
    hosts=sorted({host for _,host in failures})
    return {'suspected':len(failures)>=10 and len(failures)*5>=len(work)*4 and len(hosts)>=3,
            'dns_failures':len(failures),'batch_size':len(work),'distinct_hosts':len(hosts),
            'asset_ids':[asset_id for asset_id,_ in failures],
            'meaning':'Failure burst heuristic, not proof of a network outage or dead domains'}


@contextmanager
def supervisor_owner(directory):
    directory.mkdir(parents=True,exist_ok=True)
    with (directory/'capture-supervisor.lock').open('a') as handle:
        try: fcntl.flock(handle,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError: raise ValueError('A frontend capture supervisor is already live')
        try: yield
        finally: fcntl.flock(handle,fcntl.LOCK_UN)


def run(source_directory=DEFAULT, workers=4, min_free_gib=2, stats_every_batches=25):
    if not isinstance(stats_every_batches,int) or isinstance(stats_every_batches,bool) or not 1<=stats_every_batches<=1000: raise ValueError('Stats interval must be 1–1000 batches')
    with supervisor_owner(source_directory/'frontends'):
        return run_owned(source_directory,workers,min_free_gib,stats_every_batches)


def run_owned(source_directory=DEFAULT, workers=4, min_free_gib=2, stats_every_batches=25):
    directory = source_directory/'frontends'; db = None
    record = {'pid':os.getpid(), 'phase':'initializing_database', 'started_at':datetime.now(timezone.utc).isoformat(),
        'scope':'Static public script/style references including third-party CDNs; GET only, no execution',
        'workers':workers, 'batch_limit':100, 'min_free_gib':min_free_gib, 'batches_completed':0,
        'full_counts_every_batches':stats_every_batches, 'counts_status':'not_yet_measured'}
    job = directory/'capture-job.json'
    # A second live supervisor would duplicate requests before individual commits.
    if job.exists():
        previous = json.loads(job.read_text())
        if previous.get('phase') in ('initializing_database','running','collecting','measuring_progress','awaiting_inventory'):
            try: os.kill(previous['pid'], 0)
            except ProcessLookupError: pass
            else: raise ValueError('A frontend capture supervisor is already live')
        record['previous_attempt'] = {k:previous[k] for k in ('pid','phase','exit_code','last_observed_at') if k in previous}
    write_json(job, record)
    stop_requested=[]
    def request_stop(signum, frame): stop_requested.append(signum)
    previous_handlers={s:signal.signal(s,request_stop) for s in (signal.SIGINT,signal.SIGTERM)}
    def measure():
        record['phase']='measuring_progress'; write_json(job,record)
        snapshot=status(db); snapshot['measured_at']=datetime.now(timezone.utc).isoformat(); write_json(directory/'status.json',snapshot)
        record.update(counts=snapshot,counts_status='measured',counts_as_of_batch=record['batches_completed'])
    try:
        db = database(directory)
        record['phase']='running'; write_json(job,record)
        while True:
            if stop_requested:
                record.update(phase='stopped',exit_code=0,stop_signal=stop_requested[-1]);break
            work,priorities = prioritized_work(db,directory)
            record['priority_billers']=priorities
            if work:
                if shutil.disk_usage(directory).free < min_free_gib * 1024**3:
                    record.update(phase='capacity_limited', exit_code=2); break
                record['phase']='collecting'; write_json(job,record)
                fetch_work(db,directory,work,workers)
                record['batches_completed'] += 1
                marks=','.join('?' for _ in work)
                batch_counts=dict(db.execute(f'SELECT status,COUNT(*) FROM assets WHERE id IN ({marks}) GROUP BY status',tuple(row['id'] for row in work)))
                record['last_batch_status_counts']=batch_counts
                record['last_batch_completed_at']=datetime.now(timezone.utc).isoformat()
                burst=dns_failure_burst(db,work)
                if burst['suspected']:
                    record.update(phase='dns_failure_burst',exit_code=3,dns_failure_burst=burst)
                    write_json(job,record);break
                write_json(job,record)
                if record['batches_completed']%stats_every_batches==0: measure()
                record['phase']='collecting'; write_json(job,record)
                print(json.dumps({'batch':record['batches_completed'],'last_batch_status_counts':batch_counts,'counts_as_of_batch':record.get('counts_as_of_batch')}),flush=True)
                continue
            phase=inventory_state(directory)
            if phase == 'completed': record.update(phase='completed',exit_code=0); break
            if phase not in ('running','updating'):
                record.update(phase='inventory_incomplete',exit_code=1,inventory_state=phase); break
            record['phase']='awaiting_inventory'; write_json(job,record); time.sleep(10)
        if record['phase'] in ('completed','stopped'):
            terminal_phase=record['phase']; measure(); record['phase']=terminal_phase
    except BaseException:
        record.update(phase='failed',exit_code=1); raise
    finally:
        record['last_observed_at']=datetime.now(timezone.utc).isoformat()
        write_json(job,record)
        if db is not None: db.close()
        for s,handler in previous_handlers.items(): signal.signal(s,handler)
    return record


if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory',type=Path,default=DEFAULT);parser.add_argument('--workers',type=int,default=4)
    parser.add_argument('--min-free-gib',type=float,default=2)
    parser.add_argument('--stats-every-batches',type=int,default=25,help='Full count interval; batch outcomes are always recorded')
    args=parser.parse_args()
    if not 1 <= args.workers <= 8 or args.min_free_gib < 1 or not 1<=args.stats_every_batches<=1000: parser.error('Workers must be 1–8, reserve at least 1 GiB, stats interval 1–1000')
    result=run(args.directory,args.workers,args.min_free_gib,args.stats_every_batches);sys.exit(result['exit_code'])
