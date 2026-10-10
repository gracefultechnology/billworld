import contextlib
import io
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch
from billworld.research_capacity import require_capacity, CaptureCapacityLimited
from billworld import research_dependency_catalog as children
from billworld import research_resource_catalog as resources
from billworld.tests import test_research_dependency_catalog as child_fixtures
from billworld.tests import test_research_resources as resource_fixtures


class CapacityTests(unittest.TestCase):
    def test_reserve_includes_maximum_batch_bytes_and_preserves_snapshot(self):
        snapshot = {'assets': [{'id': 'pending'}], 'limits': []}; required = 4 * 1024**3 + 25 * 8 * 1024**2
        with patch('billworld.research_capacity.shutil.disk_usage', return_value=SimpleNamespace(free=required-1)):
            with self.assertRaises(CaptureCapacityLimited) as caught:
                require_capacity(Path('.'), 4, 25*8*1024**2, snapshot, 'Capture')
        self.assertIs(caught.exception.snapshot, snapshot)
        self.assertEqual(caught.exception.required_bytes, required)
        with patch('billworld.research_capacity.shutil.disk_usage', return_value=SimpleNamespace(free=required)):
            require_capacity(Path('.'), 4, 25*8*1024**2, snapshot, 'Capture')

    def test_child_capacity_drop_between_outer_and_inner_guards_is_resumable(self):
        with tempfile.TemporaryDirectory() as tmp:
            d, bid, helper, h, ev = child_fixtures.CatalogDependencyTests().fixture(Path(tmp))
            with patch('billworld.research_capacity.shutil.disk_usage', side_effect=[SimpleNamespace(free=100*1024**3), SimpleNamespace(free=100*1024**3), SimpleNamespace(free=0)]), patch('billworld.research_dependency_capture.capture_asset') as network, contextlib.redirect_stdout(io.StringIO()):
                result = children.run(d)
            network.assert_not_called(); self.assertEqual(result['phase'], 'capacity_limited'); self.assertEqual(result['exit_code'], 2)
            self.assertEqual(result['last_biller']['asset_status_counts'], {'pending': 1})
            self.assertEqual(result['attempted_sources'], 0)
            self.assertEqual(result['capacity_stop']['stage'], 'before_batch_dispatch')
            attempts = []
            with patch('billworld.research_capacity.shutil.disk_usage', return_value=SimpleNamespace(free=100*1024**3)), patch('billworld.research_dependency_capture.capture_asset', side_effect=helper.capture(h, {'https://utility.example/child.js': b'const child=1;'}, attempts)), contextlib.redirect_stdout(io.StringIO()): resumed = children.run(d)
            self.assertEqual(resumed['attempted_sources'], 1); self.assertEqual(resumed['phase'], 'current_candidate_sweep_finished')

    def test_resource_capacity_drop_preserves_pending_and_records_no_fake_attempts(self):
        with tempfile.TemporaryDirectory() as tmp:
            helper=resource_fixtures.ResourceTests(); d, bid, h, ev=helper.fixture(Path(tmp))
            with patch('billworld.research_capacity.shutil.disk_usage', side_effect=[SimpleNamespace(free=100*1024**3), SimpleNamespace(free=100*1024**3), SimpleNamespace(free=0)]), patch('billworld.research_resources.capture_resource') as network, contextlib.redirect_stdout(io.StringIO()):
                result = resources.run(d)
            network.assert_not_called(); self.assertEqual(result['phase'], 'capacity_limited'); self.assertEqual(result['exit_code'], 2)
            self.assertEqual(result['last_biller']['asset_status_counts'], {'pending': 2}); self.assertEqual(result['attempted_resources'], 0)
            with patch('billworld.research_capacity.shutil.disk_usage', return_value=SimpleNamespace(free=100*1024**3)), patch('billworld.research_resources.capture_resource', side_effect=helper.capture(h, [])), contextlib.redirect_stdout(io.StringIO()): resumed = resources.run(d)
            self.assertEqual(resumed['attempted_resources'], 2); self.assertEqual(resumed['phase'], 'current_candidate_sweep_finished')

    def test_unexpected_exception_is_not_disguised_as_capacity(self):
        with tempfile.TemporaryDirectory() as tmp:
            d, bid, helper, h, ev=child_fixtures.CatalogDependencyTests().fixture(Path(tmp))
            with patch('billworld.research_capacity.shutil.disk_usage', return_value=SimpleNamespace(free=100*1024**3)), patch('billworld.research_dependency_catalog.fetch', side_effect=RuntimeError('Unexpected capture failure')), self.assertRaisesRegex(RuntimeError, 'Unexpected'), contextlib.redirect_stdout(io.StringIO()): children.run(d)
            record=json.loads((d/'frontends/dependency-source/catalog-job.json').read_text())
            self.assertEqual(record['phase'],'failed'); self.assertEqual(record['exit_code'],1)
