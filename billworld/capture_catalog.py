#!/usr/bin/env python3
"""Capture a catalog record's public pages with the existing Puppeteer collector."""
import argparse
import hashlib
import json
import ipaddress
from pathlib import Path
import subprocess
import sys
from urllib.parse import urlsplit
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from audit_billworld import identity
from billworld.research_catalog import normalized_url, public_address

def capture_input(biller_id, root=ROOT, kinds=None):
    if not biller_id.startswith('biller_') or len(biller_id) != 27 or any(c not in '0123456789abcdef' for c in biller_id[7:]):
        raise ValueError('Expected a catalog biller ID')
    found = None
    for path in sorted((root/'categories').glob('*.json')):
        for entry in json.loads(path.read_text())['entries']:
            if identity(entry, path.stem) == biller_id:
                if found: raise ValueError('Catalog ID is ambiguous')
                found = (path, entry)
    if not found: raise ValueError('Catalog ID was not found')
    path, entry = found
    routes = {k:entry.get(k) for k in ('website','login_url','help_center_url')}
    routes.update({'links.'+k:v for k,v in (entry.get('links') or {}).items()})
    if kinds and set(kinds)-set(routes): raise ValueError('Unknown route kind')
    sources=[]; skipped=[]; by_url={}
    for kind, value in routes.items():
        if kinds and kind not in kinds: continue
        if not normalized_url(value): skipped.append({'kind':kind,'reason':'missing_or_invalid_public_http_url'}); continue
        # Fragments identify SPA routes and must survive browser capture, unlike HTTP fetch deduplication.
        url=value.strip(); parts=urlsplit(url)
        try: local_address = not ipaddress.ip_address(parts.hostname).is_global
        except ValueError: local_address = parts.hostname == 'localhost' or parts.hostname.endswith('.localhost')
        if local_address:
            skipped.append({'kind':kind,'reason':'local_address'});continue
        if url in by_url:
            by_url[url]['route_kinds'].append(kind);continue
        source={'id':biller_id+'-'+kind.replace('.','-'),'url':url,'route_kinds':[kind]}
        sources.append(source);by_url[url]=source
    if not sources: raise ValueError('No public routes available for the selected catalog record')
    return {'schema_version':1,'selection':biller_id,'biller_name':entry['name'],'category':path.stem,
        'source_file':str(path.relative_to(root)),'source_sha256':hashlib.sha256(path.read_bytes()).hexdigest(),
        'mode':'public_read_only','sources':sources,'skipped_routes':skipped,
        'limits':['No form submission or production authentication.','Provided routes require identity/content review; capture does not certify fidelity.']}

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('biller_id');parser.add_argument('--kinds',help='Comma-separated catalog route keys')
    parser.add_argument('--plan-only',action='store_true',help='Save provenance and route input without starting a browser')
    parser.add_argument('--node',default='node');args=parser.parse_args()
    value=capture_input(args.biller_id,kinds=args.kinds.split(',') if args.kinds else None)
    directory=ROOT/'billworld/research-data/capture-inputs';directory.mkdir(parents=True,exist_ok=True)
    path=directory/(args.biller_id+'.json');path.write_text(json.dumps(value,indent=2)+'\n')
    print(json.dumps({'input':str(path),'pages':len(value['sources']),'skipped_routes':len(value['skipped_routes'])}),flush=True)
    if not args.plan_only:
        for source in value['sources']: public_address(source['url'])
        subprocess.run([args.node,str(ROOT/'billworld/capture.mjs'),'--source-list',str(path)],cwd=ROOT,check=True)
if __name__=='__main__': main()
