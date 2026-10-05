import contextlib
import io
import hashlib
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
from audit_billworld import identity
from billworld.source_packet import packet

class PacketTests(unittest.TestCase):
    def fixture(self, root):
        (root/'categories').mkdir(); (root/'billworld/sites').mkdir(parents=True); (root/'billworld/captures').mkdir()
        entry = {'name':'Public Utility','bill_type':'water','service_area':['NY'],'login_url':'https://portal.example/login'}
        (root/'categories/water.json').write_text(json.dumps({'entries':[entry]}))
        return identity(entry,'water')

    def test_reviewed_rejection_requires_matching_capture_bytes_and_cannot_promote_failures(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);bid=self.fixture(root)
            source=root/'billworld/captures/login';source.mkdir();body=b'<main>Wrong flow</main>';digest=hashlib.sha256(body).hexdigest();(source/'page.html').write_bytes(body)
            page={'id':'login','requestedUrl':'https://portal.example/login','directory':'login','htmlSha256':digest,'contentStatus':'captured_requires_review','status':200}
            raw=root/'billworld/captures/example-manifest.json';raw.write_text(json.dumps({'pages':[page]}))
            research=root/'billworld/review.json';research.write_text(json.dumps({'pages':[{**page,'contentStatus':'wrong_flow','review_reason':'Observed different form'}]}))
            (root/'billworld/sites/site.json').write_text(json.dumps({'catalog_records':[{'category':'water','name':'Public Utility'}],'capture_manifest':'review.json'}))
            with contextlib.redirect_stdout(io.StringIO()):target=packet(bid,root)
            entry=json.loads((target/'metadata.json').read_text())['public_browser_captures'][0]
            self.assertFalse(entry['candidate_visual_reference']);self.assertEqual(entry['capture_content_status'],'captured_requires_review');self.assertFalse((target/'public-captures/login').exists())
            research.write_text(json.dumps({'pages':[{**page,'htmlSha256':'stale','contentStatus':'wrong_flow'}]}))
            with contextlib.redirect_stdout(io.StringIO()):target=packet(bid,root)
            self.assertTrue(json.loads((target/'metadata.json').read_text())['public_browser_captures'][0]['candidate_visual_reference'])
            raw.write_text(json.dumps({'pages':[{**page,'contentStatus':'application_not_ready'}]}));research.write_text(json.dumps({'pages':[page]}))
            with contextlib.redirect_stdout(io.StringIO()):target=packet(bid,root)
            self.assertFalse(json.loads((target/'metadata.json').read_text())['public_browser_captures'][0]['candidate_visual_reference'])

    def test_http_200_loading_screen_is_not_an_application_reference(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp); bid=self.fixture(root)
            source=root/'billworld/captures/loading';source.mkdir()
            (source/'page.html').write_text('<main>Loading...</main>')
            (root/'billworld/captures/loading-manifest.json').write_text(json.dumps({'pages':[{
                'id':'loading','requestedUrl':'https://portal.example/login','directory':'loading',
                'contentStatus':'application_not_ready','status':200}]}))
            with contextlib.redirect_stdout(io.StringIO()):target=packet(bid,root)
            captured=json.loads((target/'metadata.json').read_text())['public_browser_captures'][0]
            self.assertEqual(captured['status'],200)
            self.assertFalse(captured['candidate_visual_reference'])
            self.assertFalse((target/'public-captures/loading').exists())

    def test_blocked_capture_is_recorded_but_never_copied_as_a_visual_reference(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); bid = self.fixture(root)
            manifest = root/'billworld/captures/example-manifest.json'
            manifest.write_text(json.dumps({'pages':[{'id':'blocked','requestedUrl':'https://portal.example/login','directory':'blocked','contentStatus':'http_error','status':403}]}))
            source = root/'billworld/captures/blocked'; source.mkdir(); (source/'screenshot.png').write_bytes(b'blocked-screen')
            with contextlib.redirect_stdout(io.StringIO()): target = packet(bid,root)
            metadata = json.loads((target/'metadata.json').read_text())
            self.assertFalse(metadata['public_browser_captures'][0]['candidate_visual_reference']); self.assertFalse((target/'public-captures/blocked').exists())
            manifest.write_text(json.dumps({'pages':[{'id':'login','requestedUrl':'https://portal.example/login','directory':'login','contentStatus':'captured_requires_review','status':200}]}))
            source = root/'billworld/captures/login'; source.mkdir(); (source/'visible-text.txt').write_text('Login')
            with contextlib.redirect_stdout(io.StringIO()): fresh = packet(bid,root)
            self.assertNotEqual(fresh,target); self.assertEqual((fresh/'public-captures/login/visible-text.txt').read_text(),'Login')
            self.assertFalse((fresh/'public-captures/blocked').exists())

    def test_corrupt_http_body_fails_before_publishing_packet_metadata(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); bid = self.fixture(root); directory = root/'billworld/research-data'; directory.mkdir()
            (directory/'bodies').mkdir(); (directory/'bodies/expected').write_bytes(b'wrong-body')
            db = sqlite3.connect(directory/'catalog.sqlite'); db.execute('CREATE TABLE urls(url TEXT,evidence TEXT)')
            db.execute('INSERT INTO urls VALUES(?,?)',('https://portal.example/login',json.dumps({'status':'http_captured','body_file':'bodies/expected','body_sha256':'expected'}))); db.commit(); db.close()
            with self.assertRaisesRegex(ValueError,'hash mismatch'): packet(bid,root,directory)
            self.assertEqual(list((directory/'packets').rglob('metadata.json')),[])

    def test_document_packets_preserve_hashes_revisions_and_reject_corruption_or_escape(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp); bid=self.fixture(root); (root/'billworld/research').mkdir()
            pdf=root/'billworld/captures/guide.pdf'; pdf.write_bytes(b'documented-guide')
            document={'url':'https://portal.example/guide.pdf','file':'guide.pdf','sha256':hashlib.sha256(pdf.read_bytes()).hexdigest(),'evidenceType':'documented'}
            manifest=root/'billworld/research/public.json'; manifest.write_text(json.dumps({'documents':[document]}))
            site=root/'billworld/sites/example.json'; site.write_text(json.dumps({'catalog_records':[{'category':'water','name':'Public Utility'}],'capture_manifest':'research/public.json'}))
            with contextlib.redirect_stdout(io.StringIO()): first=packet(bid,root)
            exported=json.loads((first/'metadata.json').read_text())['public_documents'][0]
            self.assertEqual((first/exported['file']).read_bytes(),pdf.read_bytes()); self.assertEqual(exported['execution_policy'],'reference_only_not_runtime')
            manifest.write_text(json.dumps({'documents':[document],'review':'new independent review'}))
            with contextlib.redirect_stdout(io.StringIO()): second=packet(bid,root)
            self.assertNotEqual(first,second)
            pdf.write_bytes(b'tampered')
            with self.assertRaisesRegex(ValueError,'document hash mismatch'): packet(bid,root)
            document['file']='../../outside.pdf'; manifest.write_text(json.dumps({'documents':[document]}))
            with self.assertRaisesRegex(ValueError,'path escapes'): packet(bid,root)

    def test_rendered_html_is_exported_only_with_matching_hash_and_safe_paths(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);bid=self.fixture(root)
            source=root/'billworld/captures/public';source.mkdir();html=source/'page.html';html.write_bytes(b'<main>Public login</main>')
            manifest=root/'billworld/captures/public-manifest.json'
            page={'id':'public','requestedUrl':'https://portal.example/login','directory':'public','contentStatus':'captured_requires_review','htmlSha256':hashlib.sha256(html.read_bytes()).hexdigest()}
            manifest.write_text(json.dumps({'pages':[page]}))
            with contextlib.redirect_stdout(io.StringIO()):target=packet(bid,root)
            self.assertEqual((target/'public-captures/public/page.html').read_bytes(),html.read_bytes())
            html.write_bytes(b'corrupted')
            with self.assertRaisesRegex(ValueError,'HTML hash mismatch'):packet(bid,root)
            page['directory']='../../outside';manifest.write_text(json.dumps({'pages':[page]}))
            with self.assertRaisesRegex(ValueError,'path escapes'):packet(bid,root)
            page['directory']='public';page['id']='../escape';manifest.write_text(json.dumps({'pages':[page]}))
            with self.assertRaisesRegex(ValueError,'Unsafe public capture ID'):packet(bid,root)

    def test_public_tenant_metadata_is_hash_checked_and_exported_as_reference_only(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);bid=self.fixture(root)
            source=root/'billworld/captures/public';(source/'assets').mkdir(parents=True)
            body=b'{"RequiredCaptcha":true,"EnableGuestPay":false}'
            digest=hashlib.sha256(body).hexdigest();(source/'assets'/digest).write_bytes(body)
            asset={'url':'https://portal.example/api/public-config','resourceType':'public_metadata',
                   'file':'assets/'+digest,'sha256':digest,'bytes':len(body),'retrieval':'public_GET_metadata'}
            (source/'assets.json').write_text(json.dumps([asset]))
            (root/'billworld/captures/public-manifest.json').write_text(json.dumps({'pages':[{
                'id':'public','requestedUrl':'https://portal.example/login','directory':'public',
                'contentStatus':'captured_requires_review','status':200}]}))
            with contextlib.redirect_stdout(io.StringIO()):target=packet(bid,root)
            exported=json.loads((target/'public-captures/public/assets.json').read_text())[0]
            self.assertEqual(exported['resourceType'],'public_metadata')
            self.assertEqual(exported['execution_policy'],'reference_only_not_runtime')
            self.assertEqual((target/exported['packet_file']).read_bytes(),body)
            (source/'assets'/digest).write_bytes(b'changed')
            with self.assertRaisesRegex(ValueError,'asset hash mismatch'):packet(bid,root)


class ConfigurationPacketTests(unittest.TestCase):
    fixture = PacketTests.fixture
    def test_configuration_provenance_hash_json_and_capture_boundary(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);bid=self.fixture(root);(root/'billworld/research').mkdir()
            config=root/'billworld/captures/policy.json';config.write_bytes(b'{"length":8,"digit":true}')
            item={'url':'https://portal.example/policy','file':'policy.json','sha256':hashlib.sha256(config.read_bytes()).hexdigest(),'mode':'public_get','authenticated':False,'http_status':200,'content_type':'application/json; charset=utf-8'}
            manifest=root/'billworld/research/public.json';manifest.write_text(json.dumps({'configurations':[item]}))
            (root/'billworld/sites/example.json').write_text(json.dumps({'catalog_records':[{'category':'water','name':'Public Utility'}],'capture_manifest':'research/public.json'}))
            with contextlib.redirect_stdout(io.StringIO()):target=packet(bid,root)
            exported=json.loads((target/'metadata.json').read_text())['public_configurations'][0]
            self.assertEqual((target/exported['file']).read_bytes(),config.read_bytes());self.assertEqual(exported['execution_policy'],'reference_only_not_runtime')
            config.write_bytes(b'tampered')
            with self.assertRaisesRegex(ValueError,'configuration hash mismatch'):packet(bid,root)
            item['authenticated']=True;manifest.write_text(json.dumps({'configurations':[item]}))
            with self.assertRaisesRegex(ValueError,'unauthenticated public GET'):packet(bid,root)
            item['authenticated']=False;item['file']='../../outside';manifest.write_text(json.dumps({'configurations':[item]}))
            with self.assertRaisesRegex(ValueError,'path escapes'):packet(bid,root)
