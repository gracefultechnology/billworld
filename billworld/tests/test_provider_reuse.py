import hashlib,json,tempfile,unittest
from pathlib import Path
from billworld.provider_reuse import build

class ReuseTests(unittest.TestCase):
 def fixture(self,root):
  (root/'categories').mkdir();p=root/'categories/water.json';p.write_text('{}');sha=hashlib.sha256(p.read_bytes()).hexdigest()
  return {'id':'biller-a','name':'Water A','category':'water','source_file':'categories/water.json','source_sha256':sha,'runtime':None,'family_candidates':[{'family':'Starnik','signals':[{'type':'provided_route_host','url':'https://tenant.starnik.net/RP_default.aspx'}]}]}
 def test_groups_reuse_candidates_without_credit_and_preserves_distinct_billers(self):
  with tempfile.TemporaryDirectory() as d:
   root=Path(d);one=self.fixture(root);two={**one,'id':'biller-b','name':'Water B'};index=root/'index.jsonl';index.write_text('\n'.join(json.dumps(r) for r in [one,two]));r=build('Starnik',root,index)
   self.assertEqual(r['current_source_candidate_records'],2);self.assertEqual(r['host_groups'][0]['candidate_records'],2);self.assertEqual(r['transferred_runtime_credit'],0);self.assertEqual(r['host_groups'][0]['records'][0]['association'],'provider_route_host_candidate');self.assertTrue(all(not x['transfer_verified'] for x in r['host_groups'][0]['records']))
 def test_claims_spoof_hosts_static_only_and_stale_sources_are_not_portal_equivalence(self):
  with tempfile.TemporaryDirectory() as d:
   root=Path(d);one=self.fixture(root);claim={**one,'id':'claim','family_candidates':[{'family':'Starnik','signals':[{'type':'catalog_processor_claim','text':'Starnik'},{'type':'provided_route_host','url':'https://starnik.net.attacker.test/'}]}]};static={**one,'id':'static','family_candidates':[{'family':'Starnik','signals':[{'type':'captured_static_reference_host','url':'https://cdn.starnik.net/app.js'}]}]};stale={**one,'id':'stale','source_sha256':'bad'};index=root/'index.jsonl';index.write_text('\n'.join(json.dumps(x) for x in [claim,static,stale]));r=build('Starnik',root,index)
   self.assertEqual(r['stale_source_records'],['stale']);self.assertEqual(len(r['claim_only_records']),1);self.assertEqual(r['host_groups'][0]['records'][0]['association'],'static_source_host_only')
 def test_duplicate_ids_and_escaping_paths_fail(self):
  with tempfile.TemporaryDirectory() as d:
   root=Path(d);one=self.fixture(root);index=root/'index.jsonl';index.write_text(json.dumps(one)+'\n'+json.dumps(one));
   with self.assertRaisesRegex(ValueError,'Duplicate'):build('Starnik',root,index)
   one['source_file']='../outside.json';index.write_text(json.dumps(one))
   with self.assertRaisesRegex(ValueError,'escapes'):build('Starnik',root,index)
