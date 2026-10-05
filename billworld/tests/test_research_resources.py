import contextlib
import fcntl
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from billworld.research_resources import fetch, inventory, resource_type, capture_resource
from billworld.research_dependencies import run
from billworld.tests import test_research_dependency_capture as dependency_tests


class ResourceTests(unittest.TestCase):
    def fixture(self, root):
        d, bid, helper, ev = dependency_tests.DependencyCaptureTests().fixture(root, b"new URL('./logo.png',import.meta.url);new URL('https://cdn.example/font.woff2',import.meta.url);")
        run(d, bid)
        return d, bid, helper, ev

    def capture(self, helper, attempts):
        def fake(row, directory):
            attempts.append(row['url'])
            ev = helper.body(directory, b'\x89PNG\r\n\x1a\nfixture', status='resource_captured', content_type='image/png', final_url=row['url'])
            ev.update(attempted_at='now', requested_url=row['url'], resource_type='png')
            return row['id'], ev
        return fake

    def test_resumable_scoped_capture_and_tamper_rejection(self):
        with tempfile.TemporaryDirectory() as tmp:
            d, bid, h, ev = self.fixture(Path(tmp)); attempts = []
            with patch('billworld.research_resources.capture_resource', side_effect=self.capture(h, attempts)):
                first = fetch(d, bid)
                second = fetch(d, bid)
                third = fetch(d, bid, third_party=True)
            self.assertEqual([first['attempted'], second['attempted'], third['attempted']], [1, 0, 1])
            self.assertEqual(first['assets'][0]['references'][0]['parent_body_sha256'], ev['body_sha256'])
            item = first['assets'][0]
            (d / item['source_directory'] / item['evidence']['body_file']).write_bytes(b'tampered')
            with self.assertRaisesRegex(ValueError, 'hash mismatch'): inventory(d, bid)

    def test_parent_change_removes_historical_association(self):
        import sqlite3
        with tempfile.TemporaryDirectory() as tmp:
            d, bid, h, ev = self.fixture(Path(tmp))
            with patch('billworld.research_resources.capture_resource', side_effect=self.capture(h, [])): fetch(d, bid)
            db = sqlite3.connect(d / 'frontends/frontends.sqlite')
            fresh = h.body(d / 'frontends', b'const changed=1;', status='frontend_captured', content_type='text/javascript')
            db.execute("UPDATE assets SET evidence=? WHERE url='https://utility.example/app.js'", (json.dumps(fresh),)); db.commit(); db.close()
            self.assertEqual(inventory(d, bid)['assets'], [])

    def test_child_source_provenance_and_packet(self):
        from billworld.research_dependency_capture import fetch as children
        from billworld.source_packet import packet
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            d, bid, h, ev = dependency_tests.DependencyCaptureTests().fixture(root)
            fake = dependency_tests.DependencyCaptureTests().capture(h, {'https://utility.example/child.js': b"new URL('./logo.png',import.meta.url);"}, [])
            with patch('billworld.research_dependency_capture.capture_asset', side_effect=fake): children(d, bid, min_free_gib=0)
            with patch('billworld.research_resources.capture_resource', side_effect=self.capture(h, [])): result = fetch(d, bid)
            self.assertEqual(result['assets'][0]['references'][0]['parent_url'], 'https://utility.example/child.js')
            with contextlib.redirect_stdout(io.StringIO()): target = packet(bid, root, d)
            meta = json.loads((target / 'metadata.json').read_text())
            item = meta['source_resource_assets'][0]
            self.assertEqual((target / item['packet_file']).read_bytes(), b'\x89PNG\r\n\x1a\nfixture')
            self.assertEqual(item['execution_policy'], 'reference_only_not_runtime')

    def test_lock_reserve_bounds_and_candidate_limit(self):
        with tempfile.TemporaryDirectory() as tmp:
            d, bid, h, ev = self.fixture(Path(tmp)); directory = d / 'frontends/resources'; directory.mkdir()
            with (directory / 'capture.lock').open('a') as lock:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                with self.assertRaisesRegex(RuntimeError, 'already owns'): fetch(d, bid)
            with patch('billworld.research_resources.shutil.disk_usage', return_value=type('Disk', (), {'free': 0})()):
                with self.assertRaisesRegex(RuntimeError, 'free-space'): fetch(d, bid)
            for kwargs in [{'limit': 0}, {'workers': 9}, {'max_nodes': -1}, {'min_free_gib': float('nan')}]:
                with self.assertRaises(ValueError): fetch(d, bid, **kwargs)
            result = inventory(d, bid, max_nodes=1, third_party=True)
            self.assertEqual(len(result['assets']), 1)
            self.assertIn('max_resource_nodes_reached', result['limits'])

    def test_mime_and_magic_reject_error_pages_and_scripts(self):
        self.assertEqual(resource_type(b'wOF2fixture', 'font/woff2'), 'woff2')
        self.assertEqual(resource_type(b'<?xml version="1.0"?><svg xmlns="x"></svg>', 'image/svg+xml'), 'svg')
        for content, mime in [(b'<html>blocked</html>', 'image/png'), (b'alert(1)', 'text/javascript'), (b'wOF2fixture', 'text/html'), (b'<!DOCTYPE html><svg/>', 'image/svg+xml')]:
            self.assertIsNone(resource_type(content, mime))
        with tempfile.TemporaryDirectory() as tmp:
            from billworld.tests.test_research_frontends import FrontendTests
            directory = Path(tmp); h = FrontendTests()
            ev = h.body(directory, b'<html>blocked</html>', status='http_captured', content_type='image/png')
            with patch('billworld.research_resources.capture', return_value=('id', ev)):
                aid, result = capture_resource({'id': 'id'}, directory)
            self.assertEqual(result['status'], 'unsupported_resource_content')

    def test_retry_only_transport_failures_preserves_attempts(self):
        from billworld.research_dependency_capture import database
        with tempfile.TemporaryDirectory() as tmp:
            d, bid, h, ev = self.fixture(Path(tmp))
            def fail(row, directory): return row['id'], {'status': 'fetch_error', 'attempted_at': 'before'}
            with patch('billworld.research_resources.capture_resource', side_effect=fail):
                self.assertEqual(fetch(d, bid)['attempted'], 1)
                self.assertEqual(fetch(d, bid)['attempted'], 0)
            with patch('billworld.research_resources.capture_resource', side_effect=self.capture(h, [])):
                self.assertEqual(fetch(d, bid, retry=True)['attempted'], 1)
            db = database(d / 'frontends/resources')
            self.assertEqual(db.execute('SELECT count(*) FROM attempts').fetchone()[0], 2); db.close()

    def test_legacy_font_signatures_and_truncated_headers(self):
        self.assertEqual(resource_type(b'OTTOfixture', 'application/font-sfnt'), 'otf')
        self.assertEqual(resource_type(b'\x00\x01\x00\x00fixture', 'font/sfnt'), 'ttf')
        self.assertEqual(resource_type(b'<svg/>', 'image/svg+xml'), 'svg')
        eot = bytearray(100)
        eot[:4] = (100).to_bytes(4, 'little'); eot[4:8] = (18).to_bytes(4, 'little')
        eot[8:12] = (0x20001).to_bytes(4, 'little'); eot[34:36] = b'LP'
        self.assertEqual(resource_type(eot, 'application/vnd.ms-fontobject'), 'eot')
        for mutation in [eot[:40], eot[:-1], eot[:34] + b'XX' + eot[36:], eot[:8] + b'XXXX' + eot[12:]]:
            self.assertIsNone(resource_type(mutation, 'application/vnd.ms-fontobject'))
        self.assertIsNone(resource_type(eot, 'text/html'))

    def test_offline_reclassification_preserves_fetch_history_and_rolls_back_tamper(self):
        from billworld.research_resources import reclassify, CLASSIFIER_REVISION
        from billworld.research_dependency_capture import database
        from billworld.tests.test_research_frontends import FrontendTests
        with tempfile.TemporaryDirectory() as tmp:
            d = Path(tmp); directory = d / 'frontends/resources'; helper = FrontendTests()
            db = database(directory)
            saved = []
            for aid in ['a', 'b']:
                ev = helper.body(directory, b'OTTO' + aid.encode(), status='unsupported_resource_content', content_type='application/font-sfnt')
                ev['attempted_at'] = 'original'; encoded = json.dumps(ev); saved.append(ev)
                db.execute('INSERT INTO assets VALUES(?,?,?,?)', (aid, 'https://example.com/'+aid, ev['status'], encoded))
                db.execute('INSERT INTO attempts VALUES(?,?,?)', (aid, 'original', encoded))
            db.commit()
            body = directory / saved[1]['body_file']; body.write_bytes(b'tampered')
            with patch('billworld.research_resources.capture') as network:
                with self.assertRaisesRegex(ValueError, 'hash mismatch'): reclassify(d)
                self.assertEqual(db.execute("SELECT count(*) FROM assets WHERE status='resource_captured'").fetchone()[0], 0)
                self.assertEqual(db.execute('SELECT count(*) FROM classifications').fetchone()[0], 0)
                body.write_bytes(b'OTTOb')
                first = reclassify(d, limit=1); second = reclassify(d); third = reclassify(d)
                self.assertEqual([first['reviewed'], second['reviewed'], third['reviewed']], [1, 1, 0])
                network.assert_not_called()
            self.assertEqual(db.execute('SELECT count(*) FROM attempts').fetchone()[0], 2)
            audit = db.execute('SELECT previous_evidence,evidence FROM classifications').fetchall()
            self.assertEqual(len(audit), 2)
            for old, new in audit:
                self.assertEqual(json.loads(old)['status'], 'unsupported_resource_content')
                self.assertEqual(json.loads(new)['attempted_at'], 'original')
                self.assertEqual(json.loads(new)['classifier_revision'], CLASSIFIER_REVISION)
            db.close()
            with (directory / 'capture.lock').open('a') as owner:
                fcntl.flock(owner, fcntl.LOCK_EX | fcntl.LOCK_NB)
                with self.assertRaisesRegex(RuntimeError, 'already owns'): reclassify(d)
