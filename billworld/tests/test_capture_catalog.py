import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from audit_billworld import identity
from billworld.capture_catalog import capture_input

class CatalogBrowserCaptureTests(unittest.TestCase):
    def fixture(self, root, routes):
        (root/'categories').mkdir()
        entry={'name':'Utility','bill_type':'gas','service_area':['MN'],**routes}
        path=root/'categories/gas.json';path.write_text(json.dumps({'entries':[entry]}))
        return identity(entry,'gas'),path

    def test_spa_routes_keep_fragments_and_duplicate_routes_keep_all_associations(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);bid,path=self.fixture(root,{'website':'https://utility.example/','login_url':'https://portal.example/ui/#/login','help_center_url':None,'links':{'pay_bill':'https://portal.example/ui/#/paynow','view_bill':'https://portal.example/ui/#/login'}})
            result=capture_input(bid,root)
            self.assertEqual(len(result['sources']),3)
            self.assertEqual(result['sources'][1]['url'],'https://portal.example/ui/#/login')
            self.assertEqual(result['sources'][1]['route_kinds'],['login_url','links.view_bill'])
            self.assertEqual(result['source_sha256'],hashlib.sha256(path.read_bytes()).hexdigest())
            self.assertEqual(result['skipped_routes'],[{'kind':'help_center_url','reason':'missing_or_invalid_public_http_url'}])

    def test_filters_do_not_replace_missing_auth_with_a_guessed_url(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);bid,_=self.fixture(root,{'website':'https://utility.example/','login_url':None})
            result=capture_input(bid,root,['website'])
            self.assertEqual([s['route_kinds'] for s in result['sources']],[['website']])
            with self.assertRaisesRegex(ValueError,'No public routes'):capture_input(bid,root,['login_url'])
            with self.assertRaisesRegex(ValueError,'Unknown route'):capture_input(bid,root,['missing'])

    def test_invalid_local_and_credential_urls_are_excluded(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);bid,_=self.fixture(root,{'website':'https://utility.example/','login_url':'http://127.0.0.2/admin','help_center_url':'https://user:secret@example.org/','links':{'pay_bill':'file:///tmp/private','paperless':'http://192.168.1.10/','view_bill':'http://[::1]/'}})
            result=capture_input(bid,root)
            self.assertEqual(len(result['sources']),1)
            self.assertEqual(len(result['skipped_routes']),5)
            with self.assertRaisesRegex(ValueError,'Expected'):capture_input('../escape',root)
            with self.assertRaisesRegex(ValueError,'not found'):capture_input('biller_'+'0'*20,root)
