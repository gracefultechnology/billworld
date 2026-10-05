import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from billworld.discover_routes import discover,load_candidates,navigation_url,IndexedCandidates,index_candidates
from billworld.research_catalog import database

class DiscoveryTests(unittest.TestCase):
    def test_indexed_reader_matches_full_reader_with_noncontiguous_biller_spans(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);source=root/'route-candidates.jsonl'
            items=[{'biller_id':bid,'url':f'https://example.com/{n}'} for n,bid in enumerate(['a','b','a'])]
            source.write_text(''.join(json.dumps(x)+'\n' for x in items))
            reader=IndexedCandidates(root)
            self.assertEqual(len(reader),2)
            self.assertEqual({bid:reader.get(bid,[]) for bid in ['a','b']},load_candidates(root))
            self.assertEqual(reader.get('unknown',[]),[])
            self.assertNotIn('url',repr(reader.index))

    def test_indexed_reader_rejects_changed_bytes_even_with_preserved_metadata(self):
        import os
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);source=root/'route-candidates.jsonl'
            source.write_text(json.dumps({'biller_id':'a','url':'https://example.com/a'})+'\n');reader=IndexedCandidates(root);stat=source.stat()
            source.write_bytes(source.read_bytes().replace(b'com/a',b'com/b'));os.utime(source,ns=(stat.st_atime_ns,stat.st_mtime_ns))
            with self.assertRaisesRegex(ValueError,'chunk hash mismatch'):reader.get('a')
            source.write_text('changed')
            with self.assertRaisesRegex(ValueError,'changed during'):reader.get('a')

    def test_indexed_reader_refreshes_stale_index_and_missing_source_is_empty(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);self.assertEqual(len(IndexedCandidates(root)),0)
            source=root/'route-candidates.jsonl';source.write_text(json.dumps({'biller_id':'a'})+'\n');index_candidates(root)
            source.write_text(json.dumps({'biller_id':'b'})+'\n'+json.dumps({'biller_id':'b'})+'\n')
            reader=IndexedCandidates(root);self.assertEqual(len(reader.get('b')),2);self.assertEqual(reader.get('a',[]),[])

    def fixture(self,root,body):
        data=body.encode();digest=hashlib.sha256(data).hexdigest();(root/'bodies').mkdir();(root/'bodies'/digest).write_bytes(data)
        db=database(root)
        evidence={'content_type':'text/html','body_file':'bodies/'+digest,'body_sha256':digest,'final_url':'https://utility.example/tenant/','attempted_at':'2026-10-04'}
        db.execute('INSERT INTO urls VALUES(?,?,?,?)',('source','https://utility.example/','http_captured',json.dumps(evidence)))
        db.execute('INSERT INTO routes VALUES(?,?,?,?)',('biller-one','website','https://utility.example/','source'));db.commit();return db,digest
    def test_anchor_labels_resolve_external_portals_and_preserve_spa_routes(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);db,digest=self.fixture(root,'<a href="https://ipn.paymentus.com/cp/tenant">Pay your bill</a><a href="/portal/#/login">Sign in</a><a href="/support" aria-label><img alt>Customer support</a>')
            summary=discover(root);items=load_candidates(root)['biller-one']
            self.assertEqual(summary['candidate_associations'],3)
            self.assertTrue(all(c['source_body_sha256']==digest and c['review_status']=='unreviewed' for c in items))
            self.assertIn('https://utility.example/portal/#/login',[c['url'] for c in items])
            self.assertEqual(db.execute('SELECT COUNT(*) FROM routes').fetchone()[0],1);db.close()
    def test_body_tampering_and_path_escape_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);db,digest=self.fixture(root,'<a href="/pay">Pay</a>');(root/'bodies'/digest).write_text('tampered')
            with self.assertRaisesRegex(ValueError,'hash mismatch'):discover(root)
            evidence=json.loads(db.execute('SELECT evidence FROM urls').fetchone()[0]);evidence['body_file']='../outside';db.execute('UPDATE urls SET evidence=?',(json.dumps(evidence),));db.commit()
            with self.assertRaisesRegex(ValueError,'escapes'):discover(root)
            db.close()
    def test_credentials_private_literals_and_non_http_links_are_excluded(self):
        for href in ['javascript:alert(1)','mailto:test@example.com','https://user:pass@example.com/pay','http://127.0.0.1/pay','http://localhost/pay','http://10.0.0.1/pay','#']:
            self.assertIsNone(navigation_url('https://utility.example/',href))
        self.assertEqual(navigation_url('https://utility.example/tenant/','../pay?tenant=12#/bill'),'https://utility.example/pay?tenant=12#/bill')
    def test_failed_captures_are_not_discovered_and_repeat_runs_are_stable(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);db,_=self.fixture(root,'<a href="/pay">Pay bill</a><a href="/pay">Pay bill</a>')
            first=discover(root);second=discover(root);self.assertEqual(first['artifact_sha256'],second['artifact_sha256']);self.assertEqual(first['candidate_associations'],1)
            db.execute("UPDATE urls SET status='http_error'");db.commit();self.assertEqual(discover(root)['candidate_associations'],0);db.close()

    def test_literal_navigation_buttons_find_handoffs_without_executing_javascript(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);db,_=self.fixture(root,"""<button onclick="location.href = 'https://www.invoicecloud.com/tenant'">Checkout with QuickPay</button><button onclick="sendPayment(); location.href='/pay'">Pay</button><button onclick="location.href = computeDestination()">Pay</button><button onclick="location.href = 'javascript:sendPayment()'">Pay</button><button onclick="location.href = 'http://127.0.0.1/pay'">Pay</button>""")
            summary=discover(root);items=load_candidates(root)['biller-one'];self.assertEqual(summary['candidate_associations'],1);self.assertEqual(items[0]['navigation_evidence'],'literal_location_assignment');self.assertEqual(items[0]['candidate_kinds'],['links.pay_bill']);self.assertEqual(items[0]['url'],'https://www.invoicecloud.com/tenant');db.close()
