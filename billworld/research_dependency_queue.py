#!/usr/bin/env python3
"""Advance inert source analyses in resumable batches while captures arrive."""
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
import time
from billworld.research_catalog import DEFAULT
from billworld.research_dependencies import run as analyze_batch
from billworld.research_frontend_queue import write_json


def capture_state(directory):
    path=directory/'capture-job.json'
    if not path.exists():return 'missing'
    try:record=json.loads(path.read_text())
    except json.JSONDecodeError:return 'updating'
    if record.get('phase')=='completed' and record.get('exit_code')==0:return 'completed'
    if record.get('phase') not in ('initializing_database','collecting','measuring_progress','awaiting_inventory'):return 'terminal_incomplete'
    try:os.kill(record['pid'],0)
    except ProcessLookupError:return 'stopped'
    return 'running'


def cached_counts(directory,revision):
    path=directory/'dependencies.sqlite'
    if not path.exists():return {}
    db=sqlite3.connect(f'file:{path}?mode=ro',uri=True)
    try:return dict(db.execute("SELECT json_extract(report,'$.parse.status'),COUNT(*) FROM analyses WHERE parser_revision=? GROUP BY json_extract(report,'$.parse.status')",(revision,)))
    finally:db.close()


def run(source_directory=DEFAULT,batch_limit=500,min_free_gib=2,max_batches=None):
    if isinstance(batch_limit,bool) or not isinstance(batch_limit,int) or not 1<=batch_limit<=2000:raise ValueError('Batch limit must be 1–2000')
    if not isinstance(min_free_gib,(int,float)) or isinstance(min_free_gib,bool) or not 1<=min_free_gib<=1000:raise ValueError('Disk reserve must be 1–1000 GiB')
    if max_batches is not None and (isinstance(max_batches,bool) or not isinstance(max_batches,int) or max_batches<1):raise ValueError('Max batches must be positive')
    directory=source_directory/'frontends';directory.mkdir(parents=True,exist_ok=True)
    with (directory/'dependency-supervisor.lock').open('a') as owner:
        try:fcntl.flock(owner,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:raise ValueError('A dependency analysis supervisor is already live')
        try:return run_owned(source_directory,batch_limit,min_free_gib,max_batches)
        finally:fcntl.flock(owner,fcntl.LOCK_UN)


def run_owned(source_directory,batch_limit,min_free_gib,max_batches):
    directory=source_directory/'frontends';job=directory/'dependency-job.json'
    record={'pid':os.getpid(),'phase':'initializing','started_at':datetime.now(timezone.utc).isoformat(),'batch_limit':batch_limit,'min_free_gib':min_free_gib,'batches_completed':0,'sources_analyzed_or_reused':0,'scope':'Inert captured script/style syntax; no source execution, child GET or reconstruction credit','limits':['Global metadata-current skip is not fresh byte verification','Parser errors remain explicit cached outcomes','Single supervisor lock; do not run the legacy batch CLI concurrently','Caught up only means currently captured sources, not full catalog completeness']}
    if job.exists():record['previous_attempt']={k:v for k,v in json.loads(job.read_text()).items() if k in ('pid','phase','exit_code','last_observed_at')}
    stop=[];handlers={s:signal.signal(s,lambda signum,frame:stop.append(signum)) for s in (signal.SIGINT,signal.SIGTERM)}
    try:
        write_json(job,record)
        while True:
            if stop:record.update(phase='stopped',exit_code=0,stop_signal=stop[0]);break
            if shutil.disk_usage(directory).free<min_free_gib*1024**3:record.update(phase='capacity_limited',exit_code=2);break
            record['phase']='analyzing';write_json(job,record)
            batch=analyze_batch(source_directory,limit=batch_limit)
            reports=batch['analyses'];record['parser_revision']=batch['parser_revision']
            if reports:
                number=record['batches_completed']+1
                evidence=[{k:r.get(k) for k in ('asset_id','body_sha256','source_url','parser_revision')}|{'parse_status':r['parse']['status'],'dependency_references':len(r.get('dependencies',[]))} for r in reports]
                receipt={'completed_at':datetime.now(timezone.utc).isoformat(),'parser_revision':batch['parser_revision'],'analyzed_or_reused':len(reports),'reused':batch['reused'],'skipped_metadata_current':batch['skipped_metadata_current'],'parse_status_counts':dict(Counter(r['parse']['status'] for r in reports)),'literal_dependency_references':sum(len(r.get('dependencies',[])) for r in reports),'sources':evidence,'full_reports':'dependencies.sqlite analyses; receipt is not a fresh later source audit'}
                name=f'dependency-batches/{os.getpid()}-{number:06}.json';target=directory/name;target.parent.mkdir(exist_ok=True);write_json(target,receipt)
                record.update(batches_completed=number,sources_analyzed_or_reused=record['sources_analyzed_or_reused']+len(reports),last_batch=name,last_batch_sha256=hashlib.sha256(target.read_bytes()).hexdigest(),last_batch_status_counts=receipt['parse_status_counts'],last_batch_completed_at=receipt['completed_at']);write_json(job,record)
                print(json.dumps({k:record[k] for k in ('batches_completed','sources_analyzed_or_reused','last_batch_status_counts')}),flush=True)
                if max_batches and number>=max_batches:record.update(phase='batch_limit_reached',exit_code=0);break
                continue
            state=capture_state(directory);record['capture_state']=state
            if state=='completed':record.update(phase='caught_up_to_captured_sources',exit_code=0);break
            if state not in ('running','updating'):record.update(phase='capture_incomplete',exit_code=1);break
            record['phase']='awaiting_captures';write_json(job,record);time.sleep(10)
    except BaseException as error:
        record.update(phase='failed',exit_code=1,error_type=type(error).__name__,error=str(error)[:500]);raise
    finally:
        for s,handler in handlers.items():signal.signal(s,handler)
        record['last_observed_at']=datetime.now(timezone.utc).isoformat()
        if 'parser_revision' in record:
            try:record['cached_revision_status_counts']=cached_counts(directory,record['parser_revision'])
            except (OSError,sqlite3.Error) as error:record['cached_count_error']=str(error)[:500]
            record['cached_counts_scope']='Stored reports for this parser revision, including inactive/stale source entries; not current catalog coverage'
        write_json(job,record)
    return record


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--directory',type=Path,default=DEFAULT);p.add_argument('--batch-limit',type=int,default=500);p.add_argument('--min-free-gib',type=float,default=2);p.add_argument('--max-batches',type=int);a=p.parse_args();result=run(a.directory,a.batch_limit,a.min_free_gib,a.max_batches);raise SystemExit(result['exit_code'])
