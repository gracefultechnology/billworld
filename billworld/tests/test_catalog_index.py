import contextlib
import io
import json
import hashlib
from pathlib import Path
import tempfile
import unittest
from billworld.catalog_index import host_family, classify, build, frontend_family_signals, load_captures

class IndexTests(unittest.TestCase):
    def test_compact_capture_metadata_preserves_classification_without_large_arrays(self):
        from billworld.tests.test_research_frontends import FrontendTests
        with tempfile.TemporaryDirectory() as tmp:
            helper=FrontendTests();d,c,db,bid=helper.fixture(Path(tmp))
            full=load_captures(d);compact=load_captures(d,compact=True)
            entry={'website':'https://utility.example/'}
            self.assertEqual(classify(entry,full),classify(entry,compact))
            self.assertTrue(all(set(ev)=={'status','final_url','body_sha256'} for ev in compact.values()))
            self.assertEqual(frontend_family_signals(d,full),frontend_family_signals(d,compact))
            db.close();c.close()
    def test_static_provider_signal_is_unverified_and_stale_source_is_excluded(self):
        url='https://utility.example/'
        signal={'type':'captured_static_reference_host','url':'https://cdn.paymentus.com/client.js','source_url':url,'body_sha256':'current','integrity_scope':'catalog_hash_metadata_only'}
        captures={url:{'status':'http_captured','body_sha256':'current'}}
        result=classify({'website':url},captures,frontend_signals=[signal])
        self.assertEqual(result['url_family_candidates'],['Paymentus']);self.assertEqual(result['family_candidates'][0]['flow_equivalence'],'unverified')
        signal['body_sha256']='stale';self.assertEqual(classify({},captures,frontend_signals=[signal])['family_candidates'],[])
        signal.update(body_sha256='current',url='https://paymentus.com.attacker.example/client.js');self.assertEqual(classify({},captures,frontend_signals=[signal])['family_candidates'],[])

    def test_static_inventory_signals_dedupe_shared_sources_preserve_metadata_scope_and_filter_biller(self):
        from billworld.tests.test_research_frontends import FrontendTests
        with tempfile.TemporaryDirectory() as tmp:
            helper=FrontendTests();d,c,db,bid=helper.fixture(Path(tmp));db.execute("UPDATE assets SET url='https://cdn.paymentus.com/client.js' WHERE url='https://utility.example/app.js'")
            db.execute("INSERT INTO page_billers VALUES('page','other')");db.commit()
            captures=load_captures(d);signals=frontend_family_signals(d,captures)
            self.assertEqual(set(signals),{bid,'other'});self.assertEqual(len(signals[bid]),1);self.assertIn('metadata_only',signals[bid][0]['integrity_scope'])
            self.assertEqual(set(frontend_family_signals(d,captures,bid)),{bid});self.assertEqual(frontend_family_signals(d,captures,'unknown'),{})
            captures['https://utility.example/']['body_sha256']='changed';self.assertEqual(frontend_family_signals(d,captures),{})
            db.close();c.close()

    def test_frontend_redirect_host_remains_distinct_from_literal_reference_and_missing_queue_is_supported(self):
        from billworld.tests.test_research_frontends import FrontendTests
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);self.assertEqual(frontend_family_signals(root,{}),{})
            helper=FrontendTests();d,c,db,bid=helper.fixture(root)
            ev={'final_url':'https://cdn.invoicecloud.com/runtime.js','body_sha256':'script-hash'}
            db.execute("UPDATE assets SET status='frontend_captured',evidence=? WHERE url='https://utility.example/app.js'",(json.dumps(ev),));db.commit()
            signals=frontend_family_signals(d,load_captures(d),bid)[bid]
            self.assertEqual(signals[0]['type'],'captured_static_asset_final_host');self.assertEqual(signals[0]['asset_body_sha256'],'script-hash')
            db.close();c.close()
    def test_host_boundaries_and_private_or_credential_urls(self):
        self.assertEqual(host_family('https://tenant.smarthub.coop/ui/#/accountAccess'), 'SmartHub')
        self.assertIsNone(host_family('https://smarthub.coop.attacker.example/login'))
        self.assertIsNone(host_family('https://fake-smarthub.coop/login'))
        self.assertEqual(host_family('https://swepsonville.authoritypay.com/'), 'AuthorityPay/Muni-Link')
        self.assertIsNone(host_family('https://authoritypay.com.attacker.example/'))
        self.assertIsNone(host_family('https://user:secret@paymentus.com/login'))

    def test_claims_redirects_and_competing_families_remain_unverified(self):
        entry = {'login_url': 'https://tenant.smarthub.coop/ui/#/login', 'links': {'pay_bill': 'https://invoicecloud.com/tenant'}, 'payment_processor': 'Paymentus'}
        result = classify(entry, {})
        self.assertEqual(result['url_family_candidates'], ['InvoiceCloud', 'SmartHub'])
        self.assertTrue(result['multiple_url_families'])
        self.assertEqual({x['family'] for x in result['family_candidates']}, {'InvoiceCloud', 'SmartHub', 'Paymentus'})
        self.assertTrue(all(x['flow_equivalence'] == 'unverified' for x in result['family_candidates']))
        self.assertEqual(result['route_evidence'][0]['original_url'], entry['login_url'])
        self.assertNotIn('#', result['route_evidence'][0]['fetch_url'])
        redirected = classify({'login_url': 'https://utility.example/pay'}, {'https://utility.example/pay': {'final_url': 'https://ipn4.paymentus.com/cp/tenant', 'status': 'http_captured', 'body_sha256': 'digest'}})
        self.assertEqual(redirected['url_family_candidates'], ['Paymentus'])
        self.assertEqual(redirected['route_evidence'][0]['flow_verification'], 'unverified')

    def test_runtime_coverage_requires_explicit_category_and_name_mapping(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); (root/'categories').mkdir(); (root/'billworld/sites').mkdir(parents=True)
            (root/'categories/water.json').write_text(json.dumps({'entries': [
                {'name': 'Implemented Utility', 'service_area': ['NY'], 'bill_type': 'water', 'verified': True, 'login_url': 'https://tenant.smarthub.coop/ui/#/login'},
                {'name': 'Same Processor Different Utility', 'service_area': ['NY'], 'bill_type': 'water', 'verified': True, 'login_url': 'https://other.smarthub.coop/ui/#/login'}]}))
            (root/'billworld/sites/prototype.json').write_text(json.dumps({'id': 'prototype-site', 'implementation_status': 'first_slice', 'catalog_records': [{'category': 'water', 'name': 'Implemented Utility'}]}))
            with contextlib.redirect_stdout(io.StringIO()): result = build(root)
            self.assertEqual(result['catalog_records'], 2); self.assertEqual(result['runnable_first_slices'], 1); self.assertEqual(result['fidelity_certified_records'], 0)
            self.assertEqual(result['catalog_index_sha256'],hashlib.sha256((root/'billworld/research-data/catalog-index.jsonl').read_bytes()).hexdigest())
            records = [json.loads(line) for line in (root/'billworld/research-data/catalog-index.jsonl').read_text().splitlines()]
            self.assertEqual(records[0]['runtime']['evidence_manifest'], 'billworld/sites/prototype.json'); self.assertIsNone(records[1]['runtime'])
            self.assertTrue(records[1]['source_verified_flag'])

    def test_missing_source_catalog_cannot_overwrite_a_snapshot(self):
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaisesRegex(ValueError, 'No category sources'): build(Path(tmp))

    def test_failed_mapping_keeps_previous_index_and_summary(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);(root/'categories').mkdir();(root/'billworld/sites').mkdir(parents=True);(root/'billworld/research').mkdir();(root/'billworld/research-data').mkdir()
            (root/'categories/water.json').write_text(json.dumps({'entries':[{'name':'Example','website':'https://example.com/'}]}))
            (root/'billworld/sites/missing.json').write_text(json.dumps({'id':'missing','implementation_status':'first_slice','catalog_records':[{'category':'water','name':'Absent'}]}))
            index=root/'billworld/research-data/catalog-index.jsonl';summary=root/'billworld/research/family-coverage.json';index.write_text('old-index');summary.write_text('old-summary')
            with self.assertRaisesRegex(ValueError,'not found'):build(root)
            self.assertEqual(index.read_text(),'old-index');self.assertEqual(summary.read_text(),'old-summary')

    def test_captured_anchor_is_a_candidate_signal_and_stale_hash_is_not_evidence(self):
        captures={'https://utility.example/':{'status':'http_captured','body_sha256':'digest'}}
        discovered=[{'source_url':'https://utility.example/','source_body_sha256':'digest','url':'https://ipn.paymentus.com/cp/tenant','label':'Pay bill','candidate_kinds':['links.pay_bill']}]
        result=classify({'website':'https://utility.example/'},captures,discovered)
        self.assertEqual(result['url_family_candidates'],['Paymentus'])
        self.assertEqual(result['family_candidates'][0]['signals'][0]['type'],'captured_anchor_host')
        self.assertEqual(result['family_candidates'][0]['flow_equivalence'],'unverified')
        discovered[0]['source_body_sha256']='stale'
        self.assertEqual(classify({},captures,discovered)['family_candidates'],[])

    def test_literal_navigation_handoff_retains_separate_processor_families(self):
        source='https://swepsonville.authoritypay.com/'
        result=classify({'links':{'pay_bill':source}}, {source:{'status':'http_captured','body_sha256':'digest'}}, [{'source_url':source,'source_body_sha256':'digest','url':'https://www.invoicecloud.com/townofswepsonvillenc','navigation_evidence':'literal_location_assignment'}])
        self.assertEqual(result['url_family_candidates'],['AuthorityPay/Muni-Link','InvoiceCloud']);self.assertTrue(result['multiple_url_families']);self.assertEqual(result['family_candidates'][1]['signals'][0]['type'],'captured_literal_navigation_host')
