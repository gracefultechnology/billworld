#!/usr/bin/env python3
"""Resume bounded literal-import collection across the currently analyzed catalog.

Uses the existing biller-rooted collector, source caches and public-GET policy.
A finished sweep means only that this captured/analyzed cohort was visited.
"""
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
from billworld.research_dependency_capture import fetch
from billworld.research_frontends import biller_assets
from billworld.research_frontend_queue import write_json


def candidates(source_directory,key):
    path=source_directory/'frontends';main=path/'frontends.sqlite';analysis=path/'dependencies.sqlite'
    if not main.exists() or not analysis.exists():return []
    db=sqlite3.connect(f'file:{main}?mode=ro',uri=True)
    try:
        db.execute('ATTACH DATABASE ? AS parsed',(str(analysis),))
        return [r[0] for r in db.execute('''WITH eligible AS MATERIALIZED (
          SELECT s.id FROM parsed.analyses a JOIN assets s ON s.id=a.asset_id
          WHERE s.status='frontend_captured' AND a.parser_revision=?
            AND a.body_sha256=json_extract(s.evidence,'$.body_sha256')
            AND json_extract(a.report,'$.source_url')=s.url
            AND EXISTS(SELECT 1 FROM json_each(a.report,'$.dependencies') d WHERE json_extract(d.value,'$.kind') IN ('script','style')))
          SELECT DISTINCT b.biller_id FROM eligible e JOIN refs r ON r.asset_id=e.id
          JOIN page_billers b ON b.page_id=r.page_id ORDER BY b.biller_id''',(key,))]
    finally:db.close()


def signature(source_directory,biller_id,key,bounds):
    # Revalidate current HTML/source bytes before relying on a previous sweep.
    roots=biller_assets(source_directory,biller_id)
    inputs=[{'id':r['id'],'status':r['status'],'body_sha256':r['evidence'].get('body_sha256'),
             'url':r['url'],'source_context':{k:r['evidence'].get(k) for k in ('final_url','content_type','declared_kinds')},'references':r['references']} for r in roots]
    return hashlib.sha256(json.dumps({'roots':inputs,'parser_revision':key,'bounds':bounds},sort_keys=True).encode()).hexdigest()


def run(source_directory=DEFAULT,batch_limit=25,workers=2,max_depth=3,max_nodes=500,max_batches_per_biller=20,
        min_free_gib=2,third_party=True,biller_limit=None):
    for value,lower,upper in [(batch_limit,1,1000),(workers,1,8),(max_depth,1,10),(max_nodes,1,10000),(max_batches_per_biller,1,1000)]:
        if isinstance(value,bool) or not isinstance(value,int) or not lower<=value<=upper:raise ValueError('Invalid catalog collector bounds')
    if isinstance(min_free_gib,bool) or not isinstance(min_free_gib,(int,float)) or not 1<=min_free_gib<=1000:raise ValueError('Invalid disk reserve')
    if biller_limit is not None and (isinstance(biller_limit,bool) or not isinstance(biller_limit,int) or biller_limit<1):raise ValueError('Invalid biller limit')
    directory=source_directory/'frontends/dependency-source';directory.mkdir(parents=True,exist_ok=True)
    with (directory/'catalog-supervisor.lock').open('a') as owner:
        try:fcntl.flock(owner,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:raise ValueError('A catalog dependency collector is already live')
        try:return run_owned(source_directory,directory,batch_limit,workers,max_depth,max_nodes,max_batches_per_biller,min_free_gib,third_party,biller_limit)
        finally:fcntl.flock(owner,fcntl.LOCK_UN)


def run_owned(source_directory,directory,batch_limit,workers,max_depth,max_nodes,max_batches,min_free_gib,third_party,biller_limit):
    key=revision();bounds={'max_depth':max_depth,'max_nodes':max_nodes,'third_party':third_party}
    db=sqlite3.connect(directory/'catalog-sweeps.sqlite',timeout=30)
    db.execute('CREATE TABLE IF NOT EXISTS billers(biller_id TEXT,signature TEXT,phase TEXT,receipt TEXT,PRIMARY KEY(biller_id,signature))');db.commit()
    record={'pid':os.getpid(),'collector_revision':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'phase':'initializing','started_at':datetime.now(timezone.utc).isoformat(),'parser_revision':key,
            'bounds':bounds,'batch_limit':batch_limit,'workers':workers,'batches_per_biller':max_batches,'min_free_gib':min_free_gib,
            'billers_visited':0,'skipped_unchanged':0,'attempted_sources':0,'outcomes':{},
            'scope':'Current analyzed literal JS/CSS dependencies; no source execution or reconstruction credit',
            'limits':['Finished sweep is not full-catalog or source completeness','Depth/node/batch bounds remain explicit','Computed imports, resources, source maps and authenticated source remain unfinished','Recorded fetch failures are not automatically retried','Root signature skip is not a recrawl of previously stored child sources']}
    job=directory/'catalog-job.json';stop=[];handlers={s:signal.signal(s,lambda signum,frame:stop.append(signum)) for s in (signal.SIGINT,signal.SIGTERM)}
    try:
        write_json(job,record)
        cohort=candidates(source_directory,key);record['candidate_billers']=len(cohort);write_json(job,record)
        for bid in cohort:
            if stop:record.update(phase='stopped',exit_code=0);break
            if shutil.disk_usage(directory).free<min_free_gib*1024**3:record.update(phase='capacity_limited',exit_code=2);break
            sig=signature(source_directory,bid,key,bounds)
            old=db.execute('SELECT phase FROM billers WHERE biller_id=? AND signature=?',(bid,sig)).fetchone()
            if old and old[0]=='bounded_frontier_exhausted':record['skipped_unchanged']+=1;continue
            record.update(phase='collecting',biller_id=bid,root_signature=sig);write_json(job,record)
            with db:db.execute('INSERT OR REPLACE INTO billers VALUES(?,?,?,?)',(bid,sig,'running',None))
            attempted=0;outcomes=Counter();last=None;phase='batch_limit_reached'
            for batch in range(max_batches):
                if stop:phase='stopped';break
                if shutil.disk_usage(directory).free<min_free_gib*1024**3:phase='capacity_limited';break
                try:
                    last=fetch(source_directory,bid,limit=batch_limit,workers=workers,max_depth=max_depth,max_nodes=max_nodes,third_party=third_party,min_free_gib=min_free_gib)
                except CaptureCapacityLimited as error:
                    last=error.snapshot;phase='capacity_limited'
                    record['capacity_stop']={'free_bytes':error.free_bytes,'required_bytes':error.required_bytes,'stage':'before_batch_dispatch'}
                    break
                attempted+=last['attempted'];outcomes.update(last['outcomes']);record['attempted_sources']+=last['attempted']
                total=Counter(record['outcomes']);total.update(last['outcomes']);record['outcomes']=dict(total)
                record['biller_batches_completed']=batch+1;write_json(job,record)
                pending=sum(a['status']=='pending' for a in last['assets'])
                if not pending:phase='bounded_frontier_exhausted';break
            receipt={'biller_id':bid,'root_signature':sig,'parser_revision':key,'bounds':bounds,'phase':phase,'attempted':attempted,
                     'outcomes':dict(outcomes),'completed_at':datetime.now(timezone.utc).isoformat(),
                     'limits':last['limits'] if last else [],'asset_status_counts':dict(Counter(a['status'] for a in last['assets'])) if last else {}}
            with db:db.execute('UPDATE billers SET phase=?,receipt=? WHERE biller_id=? AND signature=?',(phase,json.dumps(receipt),bid,sig))
            record['billers_visited']+=1;record['last_biller']=receipt;write_json(job,record)
            print(json.dumps(receipt),flush=True)
            if phase in ('stopped','capacity_limited'):record.update(phase=phase,exit_code=2 if phase=='capacity_limited' else 0);break
            if biller_limit and record['billers_visited']>=biller_limit:record.update(phase='biller_limit_reached',exit_code=0);break
        else:record.update(phase='current_candidate_sweep_finished',exit_code=0)
    except BaseException as error:
        record.update(phase='failed',exit_code=1,error_type=type(error).__name__,error=str(error)[:500]);raise
    finally:
        for signum,handler in handlers.items():signal.signal(signum,handler)
        record['last_observed_at']=datetime.now(timezone.utc).isoformat();write_json(job,record);db.close()
    return record


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--directory',type=Path,default=DEFAULT)
    p.add_argument('--batch-limit',type=int,default=25);p.add_argument('--workers',type=int,default=2)
    p.add_argument('--max-depth',type=int,default=3);p.add_argument('--max-nodes',type=int,default=500)
    p.add_argument('--max-batches-per-biller',type=int,default=20);p.add_argument('--min-free-gib',type=float,default=2)
    p.add_argument('--same-host-only',action='store_true');p.add_argument('--biller-limit',type=int)
    a=p.parse_args();result=run(a.directory,a.batch_limit,a.workers,a.max_depth,a.max_nodes,a.max_batches_per_biller,a.min_free_gib,not a.same_host_only,a.biller_limit)
    print(json.dumps(result,indent=2));raise SystemExit(result['exit_code'])
