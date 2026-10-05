import contextlib
import fcntl
import io
import json
from pathlib import Path
import sqlite3
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch
from billworld.research_resource_catalog import run, candidates
from billworld.tests import test_research_resources as fixtures
from billworld.research_dependencies import run as analyze


class ResourceCatalogTests(unittest.TestCase):
    def test_actual_selection_resume_hash_guard_and_new_resource(self):
        with tempfile.TemporaryDirectory() as tmp:
            helper = fixtures.ResourceTests(); d, bid, h, ev = helper.fixture(Path(tmp)); attempts = []
            self.assertEqual(candidates(d), [bid])
            with patch('billworld.research_resources.capture_resource', side_effect=helper.capture(h, attempts)), contextlib.redirect_stdout(io.StringIO()):
                first = run(d, batch_limit=1); second = run(d, batch_limit=1)
            self.assertEqual(first['attempted_resources'], 2)
            self.assertEqual(first['phase'], 'current_candidate_sweep_finished')
            self.assertEqual(second['skipped_unchanged'], 1)
            self.assertEqual(len(attempts), 2)
            db = sqlite3.connect(d / 'frontends/frontends.sqlite')
            fresh = h.body(d / 'frontends', b"new URL('./new.png',import.meta.url)", status='frontend_captured', content_type='text/javascript', final_url='https://utility.example/app.js')
            db.execute("UPDATE assets SET evidence=? WHERE url='https://utility.example/app.js'", (json.dumps(fresh),)); db.commit(); db.close(); analyze(d, bid)
            with patch('billworld.research_resources.capture_resource', side_effect=helper.capture(h, attempts)), contextlib.redirect_stdout(io.StringIO()): third = run(d)
            self.assertEqual(third['attempted_resources'], 1)
            self.assertNotEqual(first['last_biller']['source_signature'], third['last_biller']['source_signature'])
            (d / 'frontends' / fresh['body_file']).write_bytes(b'tampered')
            with self.assertRaisesRegex(ValueError, 'hash mismatch'), contextlib.redirect_stdout(io.StringIO()): run(d)
            self.assertEqual(json.loads((d / 'frontends/resources/catalog-job.json').read_text())['phase'], 'failed')

    def test_batch_bound_retains_pending_and_network_failure(self):
        with tempfile.TemporaryDirectory() as tmp:
            helper = fixtures.ResourceTests(); d, bid, h, ev = helper.fixture(Path(tmp))
            with patch('billworld.research_resources.capture_resource', side_effect=helper.capture(h, [])), contextlib.redirect_stdout(io.StringIO()):
                first = run(d, batch_limit=1, max_batches_per_biller=1)
            self.assertEqual(first['last_biller']['phase'], 'batch_limit_reached')
            def fail(row, directory): return row['id'], {'status': 'fetch_error', 'attempted_at': 'now'}
            with patch('billworld.research_resources.capture_resource', side_effect=fail), contextlib.redirect_stdout(io.StringIO()): second = run(d)
            self.assertEqual(second['outcomes'], {'fetch_error': 1})
            self.assertEqual(second['last_biller']['asset_status_counts']['fetch_error'], 1)
            self.assertEqual(second['last_biller']['phase'], 'current_candidates_exhausted')

    def test_capacity_bounds_duplicate_owner_and_finite_batch_owner(self):
        with tempfile.TemporaryDirectory() as tmp:
            helper = fixtures.ResourceTests(); d, bid, h, ev = helper.fixture(Path(tmp))
            with patch('billworld.research_resource_catalog.shutil.disk_usage', return_value=SimpleNamespace(free=0)), patch('billworld.research_resource_catalog.fetch') as network:
                result = run(d); self.assertEqual(result['phase'], 'capacity_limited'); network.assert_not_called()
            for name in ['catalog-supervisor.lock', 'capture.lock']:
                with (d / 'frontends/resources' / name).open('a') as lock:
                    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                    with self.assertRaisesRegex(RuntimeError, 'already live'): run(d)
            for args in [{'batch_limit': 0}, {'workers': 9}, {'max_nodes': 0}, {'min_free_gib': float('nan')}, {'biller_limit': False}]:
                with self.assertRaises(ValueError): run(d, **args)

    def test_stale_analysis_excluded_and_biller_limit_is_terminal(self):
        with tempfile.TemporaryDirectory() as tmp:
            helper = fixtures.ResourceTests(); d, bid, h, ev = helper.fixture(Path(tmp))
            db = sqlite3.connect(d / 'frontends/dependencies.sqlite'); db.execute("UPDATE analyses SET parser_revision='stale'"); db.commit(); db.close()
            self.assertEqual(candidates(d), [])
            with contextlib.redirect_stdout(io.StringIO()): result = run(d)
            self.assertEqual(result['candidate_billers'], 0)
            analyze(d, bid)
            with patch('billworld.research_resources.capture_resource', side_effect=helper.capture(h, [])), contextlib.redirect_stdout(io.StringIO()): result = run(d, biller_limit=1)
            self.assertEqual(result['phase'], 'biller_limit_reached')
            self.assertEqual(result['billers_visited'], 1)

    def test_stop_finishes_current_batch_and_retains_resumable_frontier(self):
        import signal
        from billworld.research_resources import fetch as real_fetch
        with tempfile.TemporaryDirectory() as tmp:
            helper = fixtures.ResourceTests(); d, bid, h, ev = helper.fixture(Path(tmp))
            def stop_after_batch(*args, **kwargs):
                result = real_fetch(*args, **kwargs)
                signal.getsignal(signal.SIGTERM)(signal.SIGTERM, None)
                return result
            original = signal.getsignal(signal.SIGTERM)
            with patch('billworld.research_resources.capture_resource', side_effect=helper.capture(h, [])), patch('billworld.research_resource_catalog.fetch', side_effect=stop_after_batch), contextlib.redirect_stdout(io.StringIO()):
                result = run(d, batch_limit=1)
            self.assertEqual(result['phase'], 'stopped')
            self.assertEqual(result['attempted_resources'], 1)
            self.assertEqual(result['last_biller']['asset_status_counts']['pending'], 1)
            self.assertIs(signal.getsignal(signal.SIGTERM), original)
            with patch('billworld.research_resources.capture_resource', side_effect=helper.capture(h, [])), contextlib.redirect_stdout(io.StringIO()): resumed = run(d)
            self.assertEqual(resumed['attempted_resources'], 1)
            self.assertEqual(resumed['phase'], 'current_candidate_sweep_finished')
