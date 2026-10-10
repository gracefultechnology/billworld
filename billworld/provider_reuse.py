"""Group source-linked provider candidates without granting cloned-site coverage."""
import argparse
from collections import Counter, defaultdict
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
from urllib.parse import urlsplit
from billworld.catalog_index import ROOT, host_family

STATIC_TYPES = {'captured_static_reference_host', 'captured_static_asset_final_host'}
GATES = ['Review biller identity and current portal entry',
         'Compare rendered auth, recovery, registration and guest-payment controls',
         'Verify tenant fees, accepted methods, AutoPay timing and enabled flags',
         'Bind shared services to tenant-specific policy and private episode state',
         'Run tenant browser references, private grader, reset/isolation and fidelity checks']

def build(family, root=ROOT, index=None):
    root=Path(root).resolve();index=Path(index or root/'billworld/research-data/catalog-index.jsonl')
    digest=hashlib.sha256();source_hashes={};groups=defaultdict(list);claim_only=[];stale=[];seen=set();total=0;candidates=0
    with index.open('rb') as stream:
        for raw in stream:
            digest.update(raw);record=json.loads(raw);total+=1
            selected=next((f for f in record['family_candidates'] if f['family']==family),None)
            if selected is None:continue
            bid=record['id']
            if bid in seen:raise ValueError('Duplicate biller ID in provider cohort')
            seen.add(bid);source=(root/record['source_file']).resolve()
            if not source.is_relative_to(root/'categories'):raise ValueError('Source path escapes categories')
            if source not in source_hashes:source_hashes[source]=hashlib.sha256(source.read_bytes()).hexdigest()
            if source_hashes[source]!=record['source_sha256']:
                stale.append(bid);continue
            candidates+=1;hosts=defaultdict(list)
            for signal in selected['signals']:
                url=signal.get('url')
                if host_family(url)!=family:continue
                hosts[urlsplit(url).hostname.lower()].append(signal)
            entry={'id':bid,'name':record['name'],'category':record['category'],'source_file':record['source_file'],'source_sha256':record['source_sha256'],'declared_runtime':record.get('runtime'),'transfer_verified':False}
            if not hosts:claim_only.append(entry)
            for host,signals in hosts.items():
                groups[host].append({**entry,'signal_types':sorted({s['type'] for s in signals}),'urls':sorted({s['url'] for s in signals}),'signals':signals,'association':'static_source_host_only' if all(s['type'] in STATIC_TYPES for s in signals) else 'provider_route_host_candidate'})
    tenants=[]
    for host,records in groups.items():
        records.sort(key=lambda r:r['id']);tenants.append({'host':host,'candidate_records':len(records),'category_counts':dict(sorted(Counter(r['category'] for r in records).items())),'records':records,'required_gates':GATES})
    tenants.sort(key=lambda t:(-t['candidate_records'],t['host']))
    return {'schema':1,'generated_at':datetime.now(timezone.utc).isoformat(),'family':family,'catalog_records_scanned':total,'index_sha256':digest.hexdigest(),'current_source_candidate_records':candidates,'stale_source_records':stale,'host_groups':tenants,'claim_only_records':claim_only,'transferred_runtime_credit':0,'limits':['Candidate associations are not proven shared code, tenant identity or enabled capabilities','Host groups overlap when a biller has multiple provider hosts','Captured signal hashes are indexed metadata, not fresh body-integrity or live-page verification','Only category source hashes revalidated here; current browser review is a separate gate','Existing runtime mapping is a declaration, not transfer or independent fidelity certification']}

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('family');parser.add_argument('--index',type=Path);parser.add_argument('--output',type=Path,required=True);args=parser.parse_args();report=build(args.family,index=args.index);args.output.parent.mkdir(parents=True,exist_ok=True);temporary=args.output.with_suffix('.tmp');temporary.write_text(json.dumps(report,indent=2)+'\n');temporary.replace(args.output);print(json.dumps({k:report[k] for k in ['family','catalog_records_scanned','current_source_candidate_records','stale_source_records','transferred_runtime_credit']}))
