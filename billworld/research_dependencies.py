#!/usr/bin/env python3
"""Offline, provenance-bound literal JS/CSS dependency candidates. No execution/fetch."""
import argparse
from datetime import datetime, timezone
from email.message import Message
import hashlib
import json
from pathlib import Path
import sqlite3
import subprocess
from urllib.parse import urlsplit, urlunsplit, quote
from billworld.research_catalog import DEFAULT
from billworld.research_frontends import biller_assets, checked_body, reference_url

ROOT=Path(__file__).resolve().parents[1]
PARSER=ROOT/'billworld/parse-frontend-dependencies.mjs'
LIMITS=['Static syntax candidates, not observed browser requests or dependency completeness',
        'Computed imports, import maps, bare module resolution, CommonJS/AMD, webpack chunk factories, workers and runtime injection remain unresolved',
        'CSS images/fonts and import.meta.url resources are inventoried but not fetched',
        'Original source is never executed; graph adds no runtime or fidelity coverage']


def revision():
    pins=json.loads((ROOT/'package.json').read_text())['devDependencies']
    return hashlib.sha256(PARSER.read_bytes()+Path(__file__).read_bytes()+json.dumps({k:pins[k] for k in ('acorn','css-tree')},sort_keys=True).encode()).hexdigest()


def database(directory):
    directory.mkdir(parents=True,exist_ok=True)
    db=sqlite3.connect(directory/'dependencies.sqlite',timeout=30)
    db.execute('PRAGMA journal_mode=WAL')
    db.execute('CREATE TABLE IF NOT EXISTS analyses(asset_id TEXT PRIMARY KEY, body_sha256 TEXT, base_url TEXT, parser_revision TEXT, report TEXT)')
    db.commit();return db


def kind(evidence):
    mime=evidence.get('content_type','').split(';')[0].strip().lower()
    if mime=='text/css':return 'style'
    if mime in ('application/javascript','text/javascript','application/x-javascript'):return 'script'
    roles=set(evidence.get('declared_kinds',[]))
    if mime=='text/plain' and len(roles)==1 and roles<= {'script','style'}:return next(iter(roles))


def parse(content,evidence,role):
    header=Message();header['content-type']=evidence.get('content_type','')
    encoding=header.get_content_charset() or 'utf-8-sig'
    try:source=content.decode(encoding)
    except (LookupError,UnicodeDecodeError) as error:return {'status':'decode_error','error':str(error)[:500],'references':[],'issues':[]}
    try:
        result=subprocess.run(['node','--max-old-space-size=512',str(PARSER)],input=json.dumps({'source':source,'kind':role}),capture_output=True,text=True,timeout=30,check=False)
    except subprocess.TimeoutExpired:return {'status':'parser_timeout','references':[],'issues':[]}
    if result.returncode:return {'status':'parser_error','returncode':result.returncode,'references':[],'issues':[]}
    return json.loads(result.stdout)


def resolve_references(base,report):
    references=[];unresolved=[]
    for ref in report.get('references',[]):
        value=ref['specifier'];reason=None
        try:scheme=urlsplit(value).scheme.lower()
        except ValueError:scheme='';reason='invalid_or_nonpublic_url'
        if not value:reason='empty_reference'
        elif ref['syntax']=='css-url' and value.startswith('#'):reason='embedded_fragment'
        if reason is None and scheme and scheme not in ('http','https'):reason='unsupported_or_embedded_scheme'
        elif reason is None and ref['kind']=='script' and not value.startswith(('./','../','/','http://','https://')):reason='bare_module_requires_import_map'
        if reason is None:
            try:url=reference_url(base,value)
            except ValueError:url=None
            if not url:reason='invalid_or_nonpublic_url'
        if reason:unresolved.append({**ref,'reason':reason})
        else:
            parts=urlsplit(url);url=urlunsplit((parts.scheme,parts.netloc,quote(parts.path,safe="/%:@+~!$&'()*,-.;="),quote(parts.query,safe="/%?:@+~!$&'()*,-.;="),''))
            references.append({**ref,'url':url,'evidence_type':'static_source_syntax_not_observed_request'})
    return references,unresolved


def current(db,row,ev,key,base=None):
    base=base or ev.get('final_url') or row['url']
    old=db.execute('SELECT body_sha256,base_url,parser_revision,report FROM analyses WHERE asset_id=?',(row['id'],)).fetchone()
    if not old or old[:3]!=(ev.get('body_sha256'),base,key):return None
    report=json.loads(old[3])
    if report.get('source_url')!=row['url'] or report.get('source_content_type')!=ev.get('content_type','') or report.get('declared_kinds')!=sorted(ev.get('declared_kinds',[])):return None
    return report


def analyze(db,directory,row,parser_revision=None):
    parser_revision=parser_revision or revision();ev=row.get('evidence') or {}
    if isinstance(ev,str):ev=json.loads(ev)
    if row['status']!='frontend_captured':return None,False
    content=checked_body(directory,ev)
    if len(content)>8*1024*1024:raise ValueError('Source exceeds frontend capture bound')
    base=ev.get('final_url') or row['url'];role=kind(ev)
    cached=current(db,row,ev,parser_revision,base)
    if cached:return cached,True
    result=parse(content,ev,role) if role else {'status':'ambiguous_source_kind','references':[],'issues':[]}
    refs,unresolved=resolve_references(base,result)
    report={'asset_id':row['id'],'source_url':row['url'],'source_base_url':base,'body_sha256':ev['body_sha256'],
            'source_content_type':ev.get('content_type',''),'declared_kinds':sorted(ev.get('declared_kinds',[])),
            'kind':role,'parser_revision':parser_revision,'analyzed_at':datetime.now(timezone.utc).isoformat(),
            'parse':{k:v for k,v in result.items() if k!='references'},'dependencies':refs,'unresolved_specifiers':unresolved,
            'execution_policy':'reference_only_not_runtime','limits':LIMITS}
    with db:db.execute('INSERT OR REPLACE INTO analyses VALUES(?,?,?,?,?)',(row['id'],ev['body_sha256'],base,parser_revision,json.dumps(report)))
    return report,False


def biller_dependency_reports(source_directory,biller_id):
    directory=source_directory/'frontends';path=directory/'dependencies.sqlite'
    if not path.exists():return []
    db=sqlite3.connect(f'file:{path}?mode=ro',uri=True);reports=[];key=revision()
    try:
        # biller_assets verifies both current HTML provenance and captured source hashes.
        for row in biller_assets(source_directory,biller_id):
            if row['status']!='frontend_captured':continue
            report=current(db,row,row['evidence'],key)
            if report:reports.append(report)
        return reports
    finally:db.close()


def run(source_directory=DEFAULT,biller_id=None,limit=100,include_current=False):
    directory=source_directory/'frontends';db=database(directory);source=None;results=[];reused=0;skipped=0;key=revision()
    try:
        if biller_id:rows=biller_assets(source_directory,biller_id)
        else:
            source=sqlite3.connect(f'file:{directory/"frontends.sqlite"}?mode=ro',uri=True);source.row_factory=sqlite3.Row
            rows=(dict(r) for r in source.execute("SELECT a.id,a.url,a.status,a.evidence FROM assets a WHERE a.status='frontend_captured' AND EXISTS(SELECT 1 FROM refs r WHERE r.asset_id=a.id) ORDER BY a.id"))
        for row in rows:
            ev=row.get('evidence') or {}
            if isinstance(ev,str):ev=json.loads(ev)
            if not biller_id and not include_current and current(db,row,ev,key):
                skipped+=1;continue
            report,hit=analyze(db,directory,row,key)
            if report:results.append(report);reused+=int(hit)
            if len(results)>=limit:break
        return {'kind':'offline_frontend_dependency_candidates','biller_id':biller_id,'analyzed_or_reused':len(results),'reused':reused,'skipped_metadata_current':skipped,
                'parser_revision':key,'analyses':results,'limits':LIMITS}
    finally:
        db.close()
        if source:source.close()


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--directory',type=Path,default=DEFAULT);p.add_argument('--biller-id');p.add_argument('--limit',type=int,default=100);p.add_argument('--include-current',action='store_true',help='Recheck and export cached source analyses, rather than advance the global frontier');p.add_argument('--output',type=Path,required=True);args=p.parse_args()
    if args.limit<1:p.error('Positive limit required')
    result=run(args.directory,args.biller_id,args.limit,args.include_current);args.output.parent.mkdir(parents=True,exist_ok=True);temporary=args.output.with_suffix('.tmp');temporary.write_text(json.dumps(result,indent=2)+'\n');temporary.replace(args.output)
    print(json.dumps({k:v for k,v in result.items() if k!='analyses'}))
