import importlib.util
import json
import pathlib
import tempfile
import unittest
from unittest.mock import patch, MagicMock

script = pathlib.Path(__file__).resolve().parents[1] / 'research_catalog.py'
spec = importlib.util.spec_from_file_location('research_catalog', script)
research = importlib.util.module_from_spec(spec)
spec.loader.exec_module(research)

class ResearchTests(unittest.TestCase):
    def test_http_transport_encodes_spaces_and_unicode_without_double_encoding_or_query_loss(self):
        self.assertEqual(research.transport_url('https://example.com/Style Library/é%20x.js?v=a+b&tenant=1'), 'https://example.com/Style%20Library/%C3%A9%20x.js?v=a+b&tenant=1')
        self.assertEqual(research.transport_url('https://bücher.example:8443/a?q=é x'), 'https://xn--bcher-kva.example:8443/a?q=%C3%A9%20x')
        self.assertEqual(research.transport_url('http://[2001:4860:4860::8888]/a'), 'http://[2001:4860:4860::8888]/a')
        for url in ['https://user:secret@example.com/a','https://example.com/a\r\nb','file:///a']:
            with self.assertRaises(ValueError):research.transport_url(url)

    def test_capture_keeps_original_url_and_checks_public_transport_before_request(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory=pathlib.Path(tmp);response=MagicMock();response.__enter__.return_value=response
            response.read.return_value=b'/* synthetic source */';response.url='https://example.com/Style%20Library/a.js';response.status=200;response.headers.get.return_value='text/javascript'
            opener=MagicMock();opener.open.return_value=response
            with patch.object(research,'public_address') as public,patch.object(research.urllib.request,'build_opener',return_value=opener),patch.object(research.time,'sleep'):
                _,ev=research.capture({'id':'asset','url':'https://example.com/Style Library/a.js'},directory)
            self.assertEqual(ev['status'],'http_captured');self.assertEqual(ev['requested_url'],'https://example.com/Style Library/a.js');self.assertEqual(ev['transport_url'],response.url)
            public.assert_called_once_with(response.url);self.assertEqual(opener.open.call_args.args[0].full_url,response.url)

    def test_normalization_preserves_tenant_query_and_separates_navigation_fragment(self):
        self.assertEqual(research.normalized_url('https://Portal.example/path?tenant=123#/login'), 'https://portal.example/path?tenant=123')
        for url in ['file:///etc/passwd', 'javascript:alert(1)', 'https://user:secret@example.com', None]:
            self.assertIsNone(research.normalized_url(url))
        with self.assertRaisesRegex(ValueError, 'non-public'):
            research.public_address('http://127.0.0.1/')

    def test_catalog_snapshot_refresh_preserves_evidence_and_removes_stale_billers(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp); (root / 'categories').mkdir()
            path = root / 'categories/water.json'
            path.write_text(json.dumps({'entries': [{'name': 'Utility', 'bill_type': 'water', 'service_area': ['NY'], 'website': 'https://example.com', 'login_url': 'https://example.com/#login'}]}))
            db = research.database(root / 'evidence')
            research.initialize(db, root)
            self.assertEqual(research.status(db)['biller_count'], 1)
            self.assertEqual(research.status(db)['route_count'], 2)
            self.assertEqual(research.status(db)['active_unique_url_count'], 1)
            self.assertEqual(db.execute("SELECT original_url FROM routes WHERE kind='login_url'").fetchone()[0], 'https://example.com/#login')
            db.execute("UPDATE urls SET status='http_captured',evidence='{}'"); db.commit()
            research.initialize(db, root)
            self.assertEqual(research.status(db)['url_status_counts'], {'http_captured': 1})
            path.write_text(json.dumps({'entries': [{'name': 'Replacement', 'bill_type': 'water', 'service_area': ['NY'], 'website': 'https://new.example'}]}))
            research.initialize(db, root)
            self.assertEqual(research.status(db)['biller_count'], 1)
            self.assertEqual(research.status(db)['active_unique_url_count'], 1)
            self.assertEqual(db.execute('SELECT name FROM billers').fetchone()[0], 'Replacement')
            db.close()

    def test_empty_source_cannot_erase_catalog(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp); db = research.database(root / 'evidence')
            with self.assertRaisesRegex(ValueError, 'No category'):
                research.initialize(db, root)
            db.close()

if __name__ == '__main__': unittest.main()
