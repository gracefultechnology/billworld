#!/usr/bin/env python3
"""Collect literal JS/CSS child sources with verified biller-rooted provenance.

Finite resumable batches; original code is parsed but never executed. Image/font
resources remain candidates. HTML references and source dependency edges stay
separate. A stored child alone is not evidence that a biller still references it.
"""
import argparse
import concurrent.futures
import fcntl
import hashlib
import json
from pathlib import Path
import shutil
import sqlite3
from billworld.research_capacity import require_capacity
from billworld.research_catalog import DEFAULT
from billworld.research_frontends import biller_assets, checked_body, capture_asset, same_host, reference_url
from billworld.research_dependencies import database as analysis_database, analyze, current, revision


def database(directory):
    directory.mkdir(parents=True, exist_ok=True)
    db=sqlite3.connect(directory/'captures.sqlite',timeout=30);db.row_factory=sqlite3.Row
    db.executescript('''PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS assets(id TEXT PRIMARY KEY,url TEXT UNIQUE,status TEXT DEFAULT 'pending',evidence TEXT);
      CREATE TABLE IF NOT EXISTS attempts(asset_id TEXT,attempted_at TEXT,evidence TEXT);
    ''');return db


def traverse(source_directory,biller_id,max_depth=3,max_nodes=500,prepare=False,third_party=True):
    """Rebuild current source chains, never trusting historical biller associations."""
    directory=source_directory/'frontends';children=directory/'dependency-source'
    if not prepare and not (children/'captures.sqlite').exists():return {'assets':[],'limits':[]}
    db=database(children);main=sqlite3.connect(f'file:{directory/"frontends.sqlite"}?mode=ro',uri=True);main.row_factory=sqlite3.Row
    adb=analysis_database(directory);cdb=analysis_database(children);key=revision()
    roots=biller_assets(source_directory,biller_id);root_ids={r['id'] for r in roots}
    frontier=[(r,directory,0) for r in roots if r['status']=='frontend_captured'];visited=set();found={};limits=set()
    try:
        for parent,body_directory,depth in frontier:
            if parent['id'] in visited:continue
            visited.add(parent['id']);ev=parent['evidence'];checked_body(body_directory,ev)
            parser_db=adb if body_directory==directory else cdb
            if prepare:report,_=analyze(parser_db,body_directory,parent,key)
            else:report=current(parser_db,parent,ev,key)
            if not report:continue
            if parent['id'] in found:found[parent['id']]['dependency_candidates']=report
            for ref in report['dependencies']:
                if ref['kind'] not in ('script','style'):continue
                if depth>=max_depth:limits.add('max_depth_reached');continue
                url=ref['url']
                if reference_url(report['source_base_url'],url)!=url:raise ValueError('Invalid stored dependency URL')
                if not third_party and not same_host(report['source_base_url'],url):continue
                aid=hashlib.sha256(url.encode()).hexdigest()
                if aid not in found and len(found)>=max_nodes:limits.add('max_nodes_reached');continue
                chain={'parent_asset_id':parent['id'],'parent_url':parent['url'],'parent_body_sha256':ev['body_sha256'],
                       'parser_revision':key,'specifier':ref['specifier'],'syntax':ref['syntax'],'kind':ref['kind'],
                       'depth':depth+1,'evidence_type':'static_source_syntax_not_observed_request'}
                if aid in root_ids:continue
                if aid not in found:
                    row=main.execute('SELECT * FROM assets WHERE id=?',(aid,)).fetchone()
                    if row and row['status']=='frontend_captured':location=directory
                    else:
                        if prepare:
                            with db:db.execute('INSERT OR IGNORE INTO assets(id,url) VALUES(?,?)',(aid,url))
                        row=db.execute('SELECT * FROM assets WHERE id=?',(aid,)).fetchone();location=children
                    if not row:continue
                    item=dict(row);item['evidence']=json.loads(item['evidence'] or '{}')
                    item['source_directory']=str(location.relative_to(source_directory));item['references']=[]
                    found[aid]=item
                    if item['status']=='frontend_captured':
                        checked_body(location,item['evidence']);frontier.append((item,location,depth+1))
                if chain not in found[aid]['references']:found[aid]['references'].append(chain)
        # Each exported child must have a current root-to-parent chain. BFS edges
        # record immediate provenance; root assets are separately exported.
        return {'assets':list(found.values()),'limits':sorted(limits),'max_depth':max_depth,'max_nodes':max_nodes}
    finally:
        db.close();main.close();adb.close();cdb.close()


def fetch(source_directory,biller_id,limit=100,workers=4,max_depth=3,max_nodes=500,third_party=False,retry=False,min_free_gib=2):
    directory=source_directory/'frontends/dependency-source';directory.mkdir(parents=True,exist_ok=True)
    with (directory/'capture.lock').open('a') as lock:
        try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:raise RuntimeError('A dependency capture batch already owns this directory')
        before=traverse(source_directory,biller_id,max_depth,max_nodes,True,third_party)
        states={'pending','fetch_error'} if retry else {'pending'}
        work=[{**r,'kinds':','.join(sorted({x['kind'] for x in r['references']}))} for r in before['assets'] if r['status'] in states][:limit]
        if work:require_capacity(directory,min_free_gib,len(work)*8*1024**2,before,'Dependency capture')
        db=database(directory);outcomes={}
        try:
            with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
                for aid,ev in pool.map(lambda r:capture_asset(r,directory),work):
                    encoded=json.dumps(ev)
                    with db:
                        db.execute('UPDATE assets SET status=?,evidence=? WHERE id=?',(ev['status'],encoded,aid))
                        db.execute('INSERT INTO attempts VALUES(?,?,?)',(aid,ev['attempted_at'],encoded))
                    outcomes[ev['status']]=outcomes.get(ev['status'],0)+1
        finally:db.close()
        after=traverse(source_directory,biller_id,max_depth,max_nodes,True,third_party)
        return {'kind':'biller_source_dependency_capture','biller_id':biller_id,'attempted':len(work),'outcomes':outcomes,**after,
                'batch_limit':limit,'third_party':third_party,'retry_fetch_errors':retry,
                'policy':'Public GET only; verified literal JS/CSS source chains; no code execution',
                'unfinished':['Resources, computed dependencies and source maps','Static syntax does not prove runtime requests or fidelity']}


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--directory',type=Path,default=DEFAULT)
    p.add_argument('--biller-id',required=True);p.add_argument('--limit',type=int,default=100);p.add_argument('--workers',type=int,default=4)
    p.add_argument('--max-depth',type=int,default=3);p.add_argument('--max-nodes',type=int,default=500)
    p.add_argument('--third-party',action='store_true');p.add_argument('--retry',action='store_true');p.add_argument('--min-free-gib',type=float,default=2)
    p.add_argument('--output',type=Path,required=True);a=p.parse_args()
    if a.limit<1 or not 1<=a.workers<=8 or not 1<=a.max_depth<=10 or a.max_nodes<1 or a.min_free_gib<0:p.error('Invalid batch/depth/node/worker/reserve bounds')
    result=fetch(a.directory,a.biller_id,a.limit,a.workers,a.max_depth,a.max_nodes,a.third_party,a.retry,a.min_free_gib)
    a.output.parent.mkdir(parents=True,exist_ok=True);temp=a.output.with_suffix('.tmp');temp.write_text(json.dumps(result,indent=2)+'\n');temp.replace(a.output)
    print(json.dumps({k:v for k,v in result.items() if k!='assets'}))
