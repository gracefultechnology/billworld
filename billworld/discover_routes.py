#!/usr/bin/env python3
"""Extract unverified navigation candidates from hash-checked public HTML, offline."""
import argparse
from collections import Counter, defaultdict
from datetime import datetime, timezone
import hashlib
import html.parser
import ipaddress
import json
from pathlib import Path
import re
import sqlite3
from urllib.parse import urljoin,urlsplit,urlunsplit
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from billworld.research_catalog import ROOT,DEFAULT,normalized_url

class Anchors(html.parser.HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True);self.items=[];self.current=None
    def handle_starttag(self,tag,attrs):
        attrs=dict(attrs)
        if tag=='a':self.current={'href':attrs.get('href',''),'label':(attrs.get('aria-label') or '')[:300],'tag':'a','navigation_evidence':'html_anchor'}
        if tag=='button':
            navigation=re.fullmatch(r'''\s*(?:window\.)?location\.href\s*=\s*(["'])([^"'\\]+)\1\s*;?\s*''',attrs.get('onclick') or '')
            if navigation:self.current={'href':navigation[2],'label':(attrs.get('aria-label') or '')[:300],'tag':'button','navigation_evidence':'literal_location_assignment'}
        if tag=='img' and self.current:self.current['label']+=' '+(attrs.get('alt') or '')[:300]
    def handle_data(self,text):
        if self.current:self.current['label']=(self.current['label']+' '+text)[:500]
    def handle_endtag(self,tag):
        if self.current and tag==self.current['tag']:self.items.append(self.current);self.current=None

def navigation_url(base,href):
    if not isinstance(href,str) or not href.strip() or href.strip().startswith('#') and href.strip()=='#':return None
    value=urljoin(base,href.strip());normal=normalized_url(value)
    if not normal or len(value)>2048:return None
    parsed=urlsplit(value);host=parsed.hostname.lower()
    if host=='localhost' or host.endswith(('.localhost','.local')):return None
    try:
        if not ipaddress.ip_address(host).is_global:return None
    except ValueError:pass
    u=urlsplit(normal);return urlunsplit((u.scheme,u.netloc,u.path,u.query,parsed.fragment))

PATTERNS={
 'login_url':r'\blog\s*in\b|\bsign\s*in\b|\blogon\b|\blogin\b',
 'registration':r'\bregister\b|\bregistration\b|\bsign\s*up\b|\bcreate\s*(?:an?\s*)?account\b',
 'links.pay_bill':r'\bpay\b|\bpayment\b|\bpayments\b|\bbill\s*pay\b|\bquick\s*pay\b',
 'links.autopay_setup':r'\bauto\s*pay\b|\bautopay\b|\bautomatic\s*payments?\b',
 'links.statements_history':r'\bstatements?\b|\bpayment\s*history\b',
 'links.paperless':r'\bpaperless\b|\be\s*bill\b|\bebilling\b',
 'help_center_url':r'\bhelp\b|\bfaq\b|\bfaqs\b|\bfrequently\b|\bcustomer\s*support\b',
 'billing_information':r'\bbilling\b|\bmy\s*account\b|\bcustomer\s*portal\b',
}
def kinds(label,url):
    text=(label+' '+urlsplit(url).path+' '+urlsplit(url).fragment).lower();text=re.sub(r'[-_/]',' ',text)
    return sorted(kind for kind,pattern in PATTERNS.items() if re.search(pattern,text))

def discover(directory=DEFAULT):
    db=sqlite3.connect(f'file:{directory / "catalog.sqlite"}?mode=ro',uri=True)
    grouped=defaultdict(list);counters=Counter();source_count=0
    try:
        for url_id,url,raw in db.execute("SELECT id,url,evidence FROM urls WHERE status='http_captured' AND evidence IS NOT NULL ORDER BY id"):
            evidence=json.loads(raw)
            if 'html' not in evidence.get('content_type','').lower():continue
            content_path=(directory/evidence.get('body_file','')).resolve()
            if not content_path.is_relative_to((directory/'bodies').resolve()):raise ValueError('Captured body path escapes bodies directory')
            content=content_path.read_bytes()
            if hashlib.sha256(content).hexdigest()!=evidence.get('body_sha256'):raise ValueError('Captured body hash mismatch')
            source_count+=1;parser=Anchors();parser.feed(content.decode('utf-8',errors='replace'))
            associated=list(db.execute('SELECT biller_id,kind FROM routes WHERE url_id=? ORDER BY biller_id,kind',(url_id,)))
            seen=set()
            for anchor in parser.items:
                target=navigation_url(evidence.get('final_url') or url,anchor['href'])
                if not target:continue
                label=' '.join(anchor['label'].split());matched=kinds(label,target)
                if not matched or (target,label) in seen:continue
                if len(seen)>=200:break
                seen.add((target,label))
                for biller_id,source_kind in associated:
                    candidate={'biller_id':biller_id,'url':target,'label':label,'candidate_kinds':matched,'review_status':'unreviewed','source_url':url,'source_final_url':evidence.get('final_url') or url,'source_kind':source_kind,'source_body_sha256':evidence['body_sha256'],'source_attempted_at':evidence.get('attempted_at'),'flow_verification':'unverified','navigation_evidence':anchor['navigation_evidence']}
                    candidate['id']=hashlib.sha256(json.dumps(candidate,sort_keys=True).encode()).hexdigest()[:24]
                    grouped[biller_id].append(candidate)
                    for kind in matched:counters[kind]+=1
    finally:db.close()
    output=directory/'route-candidates.jsonl'
    with output.open('w') as stream:
        for biller_id in sorted(grouped):
            for candidate in grouped[biller_id]:stream.write(json.dumps(candidate,sort_keys=True)+'\n')
    index=index_candidates(directory)
    summary={'generated_at':datetime.now(timezone.utc).isoformat(),'source_html_bodies':source_count,'biller_records_with_candidates':len(grouped),'candidate_associations':sum(len(v) for v in grouped.values()),'candidate_kind_counts':dict(sorted(counters.items())),'meaning':'Links found in hash-verified public HTML; no destination content, ownership, tenant association or flow verification implied. No catalog routes changed.','artifact_sha256':index['source_sha256']}
    (directory/'route-discovery-summary.json').write_text(json.dumps(summary,indent=2)+'\n');return summary

def index_candidates(directory):
    source=directory/'route-candidates.jsonl'
    target=directory/'route-candidates-index.json'
    spans=defaultdict(list);total=hashlib.sha256();current=None;start=0;size=0;chunk=hashlib.sha256();count=0
    before=source.stat()
    with source.open('rb') as stream:
        for line in stream:
            candidate=json.loads(line);biller=candidate['biller_id'];position=stream.tell()-len(line)
            if current is not None and biller!=current:
                spans[current].append({'offset':start,'length':size,'sha256':chunk.hexdigest()})
                size=0;chunk=hashlib.sha256()
            if biller!=current: current=biller;start=position
            chunk.update(line);total.update(line);size+=len(line);count+=1
        if current is not None: spans[current].append({'offset':start,'length':size,'sha256':chunk.hexdigest()})
    after=source.stat()
    if (before.st_size,before.st_mtime_ns)!=(after.st_size,after.st_mtime_ns):raise ValueError('Candidate source changed during indexing')
    result={'schema_version':1,'source_file':source.name,'source_bytes':after.st_size,'source_mtime_ns':after.st_mtime_ns,
        'source_sha256':total.hexdigest(),'candidate_associations':count,'billers':dict(spans)}
    temporary=target.with_suffix('.tmp');temporary.write_text(json.dumps(result,sort_keys=True)+'\n');temporary.replace(target)
    return {'index':str(target),'biller_count':len(spans),'candidate_associations':count,'source_sha256':total.hexdigest()}


class IndexedCandidates:
    """Biller-at-a-time reads; retain offsets, never the full candidate corpus."""
    def __init__(self, directory):
        self.source=directory/'route-candidates.jsonl';self.index={}
        if not self.source.exists():return
        target=directory/'route-candidates-index.json'
        if target.exists():self.index=json.loads(target.read_text())
        stat=self.source.stat()
        if self.index.get('source_file')!=self.source.name or (self.index.get('source_bytes'),self.index.get('source_mtime_ns'))!=(stat.st_size,stat.st_mtime_ns):
            index_candidates(directory);self.index=json.loads(target.read_text())
        self.signature=(self.index['source_bytes'],self.index['source_mtime_ns'])

    def __len__(self):return len(self.index.get('billers',{}))

    def verify_current(self):
        if not self.index:return
        stat=self.source.stat()
        if (stat.st_size,stat.st_mtime_ns)!=self.signature:raise ValueError('Candidate source changed during indexed reads')

    def get(self, biller_id, default=None):
        if not self.index:return default
        self.verify_current()
        stat=self.source.stat()
        spans=self.index['billers'].get(biller_id)
        if not spans:return default
        result=[]
        with self.source.open('rb') as stream:
            for span in spans:
                offset=span['offset'];length=span['length']
                if not isinstance(offset,int) or not isinstance(length,int) or offset<0 or length<1 or offset+length>stat.st_size:
                    raise ValueError('Candidate index span outside source file')
                stream.seek(offset);remaining=length;digest=hashlib.sha256()
                while remaining:
                    line=stream.readline(remaining);remaining-=len(line);digest.update(line)
                    if not line:raise ValueError('Truncated candidate index span')
                    candidate=json.loads(line)
                    if candidate['biller_id']!=biller_id:raise ValueError('Candidate index association mismatch')
                    result.append(candidate)
                if digest.hexdigest()!=span['sha256']:raise ValueError('Candidate index chunk hash mismatch')
        self.verify_current()
        return result


def load_candidates(directory, biller_id=None):
    result=defaultdict(list);p=directory/'route-candidates.jsonl'
    if not p.exists(): return result
    index_path=directory/'route-candidates-index.json'
    if biller_id is not None and index_path.exists():
        indexed=json.loads(index_path.read_text());stat=p.stat()
        if indexed.get('source_file')==p.name and (indexed.get('source_bytes'),indexed.get('source_mtime_ns'))==(stat.st_size,stat.st_mtime_ns):
            with p.open('rb') as stream:
                for span in indexed['billers'].get(biller_id,[]):
                    offset=span['offset'];length=span['length']
                    if not isinstance(offset,int) or not isinstance(length,int) or offset<0 or length<1 or offset+length>stat.st_size:
                        raise ValueError('Candidate index span outside source file')
                    stream.seek(offset);remaining=length;digest=hashlib.sha256();candidates=[]
                    while remaining:
                        line=stream.readline(remaining);remaining-=len(line);digest.update(line)
                        if not line:raise ValueError('Truncated candidate index span')
                        candidate=json.loads(line)
                        if candidate['biller_id']!=biller_id:raise ValueError('Candidate index association mismatch')
                        candidates.append(candidate)
                    if digest.hexdigest()!=span['sha256']:raise ValueError('Candidate index chunk hash mismatch')
                    result[biller_id].extend(candidates)
            return result
    # A missing/stale index remains usable without building an all-biller dictionary.
    with p.open() as stream:
        for line in stream:
            candidate=json.loads(line)
            if biller_id is None or candidate['biller_id']==biller_id:
                result[candidate['biller_id']].append(candidate)
    return result

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--directory',type=Path,default=DEFAULT);parser.add_argument('--index-existing',action='store_true');args=parser.parse_args();print(json.dumps(index_candidates(args.directory) if args.index_existing else discover(args.directory),indent=2))
