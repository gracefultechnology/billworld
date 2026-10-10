#!/usr/bin/env python3
"""Build an evidence-linked coverage index; family signals do not certify flows."""
import argparse
from collections import Counter, defaultdict
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import sys
import time
from urllib.parse import urlsplit
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from audit_billworld import identity
from billworld.research_catalog import normalized_url
from billworld.discover_routes import IndexedCandidates

# Structural URL signals only. Each association still needs biller-specific review.
DOMAINS = {
    'starnik.net': 'Starnik', 'invoicecloud.com': 'InvoiceCloud', 'smarthub.coop': 'SmartHub', 'paymentus.com': 'Paymentus',
    'xpressbillpay.com': 'Xpress Bill Pay', 'municipalonlinepayments.com': 'Municipal Online Payments',
    'munisselfservice.com': 'Munis Self Service', 'ezpay.com': 'EZPay', 'doxo.com': 'doxo',
    'pay.gov': 'Pay.gov', 'payitgov.com': 'PayIt', 'paylocity.com': 'Paylocity',
    'mychart.com': 'MyChart', 'mychart.org': 'MyChart', 'personapay.com': 'PersonaPay',
    'myproviderlink.com': 'MyProviderLink', 'patientpay.net': 'PatientPay',
    'athenahealth.com': 'athenahealth', 'healowpay.com': 'healow Pay',
    'epayub.com': 'ePay Utilities', 'onlinepaymentservice.com': 'Online Payment Service',
    'edmundsassoc.com': 'Edmunds', 'epaymentsolutions.com': 'ePayment Solutions',
    'payquicker.com': 'PayQuicker', 'govoice.com': 'GoVoice', 'gozego.com': 'Zego',
    'deliverypay.com': 'DeliveryPay', 'citizenserve.com': 'Citizenserve',
    'authoritypay.com': 'AuthorityPay/Muni-Link', 'muni-link.com': 'AuthorityPay/Muni-Link',
    'spotify.com': 'Spotify', 'netflix.com': 'Netflix', 'hulu.com': 'Hulu',
    'paypal.com': 'PayPal', 'synchrony.com': 'Synchrony', 'myaccountaccess.com': 'My Account Access'
}
# Plain processor text is retained as a claim, never used as observed evidence.
CLAIMS = {'authoritypay': 'AuthorityPay/Muni-Link', 'muni-link': 'AuthorityPay/Muni-Link', 'invoice cloud': 'InvoiceCloud', 'invoicecloud': 'InvoiceCloud', 'smarthub': 'SmartHub',
          'paymentus': 'Paymentus', 'xpressbillpay': 'Xpress Bill Pay', 'doxo': 'doxo',
          'personapay': 'PersonaPay', 'munis': 'Munis Self Service', 'epic mychart': 'MyChart',
          'rita (regional income tax agency)': 'RITA', 'starnik': 'Starnik', 'bs&a': 'BS&A Online',
          'first billing': 'First Billing', 'firstbilling': 'First Billing', 'eonlinebill': 'eOnlineBill',
          'parallon': 'Parallon/HCA ePay', 'pha-web': 'PHA-Web', 'comstar': 'Comstar',
          'amr patient billing': 'AMR', 'gmr air billing': 'GMR', 'pay.gov': 'Pay.gov',
          'bread financial': 'Bread Financial/Comenity', 'comenity': 'Bread Financial/Comenity',
          'republic services online': 'Republic Services', 'waste connections myaccount': 'Waste Connections',
          'lee enterprises': 'Lee Enterprises', 'usa today network': 'Gannett/USA TODAY Network',
          'iowa tax and tags': 'Iowa Tax and Tags', 'synchrony': 'Synchrony'}

def host_family(url):
    value = normalized_url(url)
    if not value: return None
    host = urlsplit(value).hostname
    return next((family for domain, family in DOMAINS.items() if host == domain or host.endswith('.' + domain)), None)

def routes(entry):
    result = {key: entry.get(key) for key in ('website', 'login_url', 'help_center_url')}
    result.update({'links.' + key: value for key, value in (entry.get('links') or {}).items()})
    return result

def classify(entry, captures, discovered=(), frontend_signals=()):
    families = defaultdict(list); route_evidence = []
    for kind, original in routes(entry).items():
        normalized = normalized_url(original)
        if not normalized: continue
        captured = captures.get(normalized)
        family = host_family(original)
        if family: families[family].append({'type': 'provided_route_host', 'kind': kind, 'url': original})
        if captured and captured.get('final_url'):
            redirected = host_family(captured['final_url'])
            if redirected: families[redirected].append({'type': 'captured_final_host', 'kind': kind, 'url': captured['final_url'], 'body_sha256': captured.get('body_sha256')})
        route_evidence.append({'kind': kind, 'original_url': original, 'fetch_url': normalized,
            'capture_status': captured.get('status', 'pending') if captured else 'pending',
            'body_sha256': captured.get('body_sha256') if captured else None,
            'flow_verification': 'unverified'})
    for candidate in discovered:
        source=captures.get(normalized_url(candidate.get('source_url')))
        if not source or source.get('status')!='http_captured' or source.get('body_sha256')!=candidate.get('source_body_sha256'):continue
        family=host_family(candidate.get('url'))
        if family:
            signal={'type':'captured_literal_navigation_host' if candidate.get('navigation_evidence')=='literal_location_assignment' else 'captured_anchor_host','url':candidate['url'],'source_url':candidate['source_url'],'body_sha256':candidate['source_body_sha256'],'label':candidate.get('label',''),'candidate_kinds':candidate.get('candidate_kinds',[]),'review_status':'unreviewed'}
            if signal not in families[family]:families[family].append(signal)
    for signal in frontend_signals:
        source=captures.get(normalized_url(signal.get('source_url')))
        if not source or source.get('status')!='http_captured' or source.get('body_sha256')!=signal.get('body_sha256'):continue
        family=host_family(signal.get('url'))
        if family and signal not in families[family]:families[family].append(signal)
    claim = str(entry.get('payment_processor') or '')
    for phrase, family in CLAIMS.items():
        if phrase in claim.lower():
            signal = {'type': 'catalog_processor_claim', 'text': claim}
            if signal not in families[family]: families[family].append(signal)
    observed = sorted(f for f, signals in families.items() if any(s['type'] != 'catalog_processor_claim' for s in signals))
    return {'family_candidates': [{'family': f, 'signals': families[f], 'flow_equivalence': 'unverified'} for f in sorted(families)],
            'url_family_candidates': observed, 'multiple_url_families': len(observed) > 1, 'route_evidence': route_evidence}

def load_captures(directory, urls=None, compact=False):
    path = directory / 'catalog.sqlite'
    if not path.exists(): return {}
    db = sqlite3.connect(f'file:{path}?mode=ro', uri=True)
    try:
        if urls is None:
            if compact:
                rows=db.execute("SELECT url,json_extract(evidence,'$.status'),json_type(evidence,'$.status'),json_extract(evidence,'$.final_url'),json_extract(evidence,'$.body_sha256') FROM urls WHERE evidence IS NOT NULL")
                return {url:{**({'status':status} if status_type is not None else {}),'final_url':final,'body_sha256':digest} for url,status,status_type,final,digest in rows}
            rows=db.execute('SELECT url,evidence FROM urls WHERE evidence IS NOT NULL')
            return {url:json.loads(evidence) for url,evidence in rows}
        result={}
        for url in sorted({x for x in urls if x}):
            row=db.execute('SELECT evidence FROM urls WHERE url=? AND evidence IS NOT NULL',(url,)).fetchone()
            if row: result[url]=json.loads(row[0])
        return result
    finally: db.close()

def frontend_family_signals(directory,captures,biller_id=None):
    """Structural provider-host hints; metadata freshness, not fresh byte audit."""
    path=directory/'frontends/frontends.sqlite'
    if not path.exists():return {}
    db=sqlite3.connect(f'file:{path}?mode=ro',uri=True);signals=defaultdict(list);seen=defaultdict(set)
    try:
        query='SELECT a.id,a.url,a.status,a.evidence FROM assets a'
        if biller_id:query+=' WHERE a.id IN(SELECT r.asset_id FROM page_billers b JOIN refs r ON r.page_id=b.page_id WHERE b.biller_id=?)'
        for aid,url,status,encoded in db.execute(query,(biller_id,) if biller_id else ()):
            targets=[]
            if host_family(url):targets.append(('captured_static_reference_host',url,None))
            if status=='frontend_captured':
                ev=json.loads(encoded or '{}');final=ev.get('final_url')
                if final and final!=url and host_family(final):targets.append(('captured_static_asset_final_host',final,ev.get('body_sha256')))
            if not targets:continue
            refs=db.execute('''SELECT b.biller_id,p.url,p.body_sha256,r.kind FROM refs r
              JOIN pages p ON p.id=r.page_id JOIN page_billers b ON b.page_id=p.id WHERE r.asset_id=?'''+(' AND b.biller_id=?' if biller_id else ''),(aid,biller_id) if biller_id else (aid,))
            for bid,source_url,body_sha,kind in refs:
                source=captures.get(normalized_url(source_url))
                if not source or source.get('status')!='http_captured' or source.get('body_sha256')!=body_sha:continue
                for typ,target,asset_sha in targets:
                    signal={'type':typ,'url':target,'asset_url':url,'source_url':source_url,'body_sha256':body_sha,
                        'asset_body_sha256':asset_sha,'reference_kind':kind,'review_status':'unreviewed',
                        'integrity_scope':'catalog_hash_metadata_only; packet export must verify bytes',
                        'meaning':'Static provider-host reference; not enabled billing/auth capability or observed browser request'}
                    # Keep first-seen order without rescanning every prior signal for this biller.
                    key=tuple(signal.items())
                    if key not in seen[bid]:
                        seen[bid].add(key);signals[bid].append(signal)
    finally:db.close()
    return dict(signals)

def build(root=ROOT, directory=None, progress=None):
    started=time.monotonic()
    def report(phase, **details):
        if progress is not None:
            progress({'phase':phase,'elapsed_seconds':round(time.monotonic()-started,3),**details})
    directory = directory or root / 'billworld/research-data'; directory.mkdir(parents=True, exist_ok=True)
    paths = sorted((root / 'categories').glob('*.json'))
    if not paths: raise ValueError('No category sources found; refusing to replace the coverage snapshot')
    report('capture_metadata_started')
    captures = load_captures(directory,compact=True)
    report('frontend_signals_started',captured_urls=len(captures))
    frontend_signals = frontend_family_signals(directory,captures)
    report('discovered_routes_started',billers_with_frontend_signals=len(frontend_signals))
    discovered = IndexedCandidates(directory)
    report('catalog_records_started',billers_with_discovered_routes=len(discovered))
    sites = {}
    for path in sorted((root / 'billworld/sites').glob('*.json')):
        site = json.loads(path.read_text())
        for record in site.get('catalog_records', []):
            key = (record['category'], record['name'])
            if key in sites: raise ValueError('A catalog record maps to multiple runtime sites: ' + str(key))
            sites[key] = site
    counts = Counter(); url_counts = Counter(); categories = defaultdict(Counter); representatives = defaultdict(dict)
    total = unknown = multiple = runnable = matched = 0; source_hashes = {}
    output = directory / 'catalog-index.jsonl'
    temporary=output.with_name(output.name+f'.{os.getpid()}.tmp')
    with temporary.open('w') as stream:
        for path in paths:
            raw = path.read_bytes(); source_hashes[str(path.relative_to(root))] = hashlib.sha256(raw).hexdigest()
            for entry in json.loads(raw)['entries']:
                bid=identity(entry,path.stem);candidates=discovered.get(bid,[])
                total += 1; record = {'id': bid, 'name': entry['name'], 'category': path.stem,
                    'source_file': str(path.relative_to(root)), 'source_sha256': source_hashes[str(path.relative_to(root))],
                    'processor_claim': entry.get('payment_processor'), 'source_verified_flag': entry.get('verified'), 'source_last_checked': entry.get('last_checked'),
                    **classify(entry, captures, candidates,frontend_signals.get(bid,[]))}
                record['discovered_route_candidates']=candidates
                site = sites.get((path.stem, entry['name']))
                record['runtime'] = {'site_id': site['id'], 'status': site['implementation_status'], 'evidence_manifest': f"billworld/sites/{site['id']}.json"} if site else None
                # Manifest path uses actual filename; IDs and filenames need not match.
                if site:
                    matched += 1
                    record['runtime']['evidence_manifest'] = next(str(p.relative_to(root)) for p in (root / 'billworld/sites').glob('*.json') if json.loads(p.read_text())['id'] == site['id'])
                    if site['implementation_status'] == 'first_slice': runnable += 1
                if not record['family_candidates']: unknown += 1
                if record['multiple_url_families']: multiple += 1
                for candidate in record['family_candidates']:
                    f = candidate['family']; counts[f] += 1; categories[f][path.stem] += 1
                    if f in record['url_family_candidates']: url_counts[f] += 1
                    basis = 'provided_route_host' if any(s.get('kind') in ('login_url', 'links.pay_bill') and s['type'] == 'provided_route_host' for s in candidate['signals']) else 'catalog_claim_requires_review'
                    if any(signal['type']=='captured_anchor_host' for signal in candidate['signals']) and basis=='catalog_claim_requires_review':basis='captured_anchor_host_requires_review'
                    if any(signal['type'].startswith('captured_static_') for signal in candidate['signals']) and basis=='catalog_claim_requires_review':basis='static_provider_reference_requires_review'
                    if any(normalized_url(routes(entry).get(key)) for key in ('login_url', 'links.pay_bill')) or any(signal['type']=='captured_anchor_host' or signal['type'].startswith('captured_static_') for signal in candidate['signals']):
                        representative={'id': record['id'], 'name': record['name'], 'category': path.stem,
                            'routes': routes(entry), 'discovered_route_candidates':record['discovered_route_candidates'], 'selection_basis': basis, 'runtime_site_id': site['id'] if site else None}
                        old=representatives[f].get(path.stem)
                        if old is None or (representative['runtime_site_id'] is None,representative['id'])<(old['runtime_site_id'] is None,old['id']):representatives[f][path.stem]=representative
                stream.write(json.dumps(record, sort_keys=True) + '\n')
            report('category_completed',category=path.stem,records_written=total)
    if matched != len(sites): raise ValueError('Some explicitly mapped runtime catalog records were not found')
    report('snapshot_verification_started',records_written=total)
    discovered.verify_current()
    digest=hashlib.sha256()
    with temporary.open('rb') as stream:
        for chunk in iter(lambda:stream.read(1024*1024),b''):digest.update(chunk)
    families = []
    for f, count in counts.most_common():
        candidates = representatives[f].values(); picks = []; seen = set()
        # Prefer existing instances, then distinct categories. Stable ordering permits reproducible review.
        for r in sorted(candidates, key=lambda r: (r['runtime_site_id'] is None, r['category'], r['id'])):
            if r['category'] not in seen: picks.append(r); seen.add(r['category'])
            if len(picks) == 3: break
        families.append({'family': f, 'candidate_records': count, 'records_with_url_signal': url_counts[f],
            'categories': dict(sorted(categories[f].items())), 'representatives_for_review': picks})
    summary = {'schema_version': 1, 'generated_at': datetime.now(timezone.utc).isoformat(), 'catalog_records': total,
        'records_without_family_signal': unknown, 'records_with_multiple_url_families': multiple,
        'records_with_discovered_route_candidates':len(discovered), 'runnable_first_slices': runnable, 'fidelity_certified_records': 0,
        'records_with_static_provider_host_signals':len(frontend_signals),
        'catalog_index_sha256':digest.hexdigest(),
        'source_files': source_hashes, 'family_candidates': families,
        'limits': ['Signals identify candidate portal families, not enabled capabilities or equivalent flows.',
                   'Counts overlap when billers have multiple candidate families.', 'Source verified flags are preserved but do not certify a reconstructed environment.',
                   'Only explicit category/name mappings count as runtime coverage; sharing a processor never grants implementation coverage.']}
    target = root / 'billworld/research/family-coverage.json'; target.parent.mkdir(exist_ok=True)
    summary_temp=target.with_name(target.name+f'.{os.getpid()}.tmp');summary_temp.write_text(json.dumps(summary, indent=2) + '\n')
    temporary.replace(output);summary_temp.replace(target)
    report('published',records_written=total,catalog_index_sha256=digest.hexdigest())
    print(json.dumps({key: summary[key] for key in ('catalog_records', 'records_without_family_signal', 'records_with_multiple_url_families', 'runnable_first_slices', 'fidelity_certified_records')}, indent=2))
    return summary

if __name__ == '__main__':
    parser = argparse.ArgumentParser(); parser.add_argument('--directory', type=Path, default=ROOT / 'billworld/research-data'); args = parser.parse_args()
    build(directory=args.directory,progress=lambda event:print(json.dumps(event,sort_keys=True),file=sys.stderr,flush=True))
