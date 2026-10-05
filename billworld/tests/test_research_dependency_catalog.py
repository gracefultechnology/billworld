import contextlib
import fcntl
import io
import json
from pathlib import Path
from types import SimpleNamespace
import tempfile
import unittest
from unittest.mock import patch
from billworld.research_dependency_catalog import run,candidates
from billworld.research_dependencies import run as analyze,revision
from billworld.tests import test_research_dependency_capture as dependency_fixtures

class CatalogDependencyTests(unittest.TestCase):
    def fixture(self,root):
        helper=dependency_fixtures.DependencyCaptureTests();d,bid,h,ev=helper.fixture(root)
        analyze(d,bid);return d,bid,helper,h,ev

    def test_actual_catalog_selection_recursive_collection_resume_and_root_change(self):
        with tempfile.TemporaryDirectory() as tmp:
            d,bid,helper,h,ev=self.fixture(Path(tmp));self.assertEqual(candidates(d,revision()),[bid])
            attempts=[];bodies={'https://utility.example/child.js':b"import './grand.js';",'https://utility.example/grand.js':b'export const ready=true;'}
            with patch('billworld.research_dependency_capture.capture_asset',side_effect=helper.capture(h,bodies,attempts)),patch('billworld.research_dependency_catalog.shutil.disk_usage',return_value=SimpleNamespace(free=100*1024**3)),contextlib.redirect_stdout(io.StringIO()):
                first=run(d,batch_limit=1);second=run(d,batch_limit=1)
            self.assertEqual(first['phase'],'current_candidate_sweep_finished');self.assertEqual(first['attempted_sources'],2)
            self.assertEqual(second['attempted_sources'],0);self.assertEqual(second['skipped_unchanged'],1);self.assertEqual(len(attempts),2)
            self.assertEqual(first['last_biller']['phase'],'bounded_frontier_exhausted')
            # A supposedly unchanged root is freshly verified even on a skipped sweep.
            (d/'frontends'/ev['body_file']).write_bytes(b'tampered source')
            with self.assertRaisesRegex(ValueError,'hash mismatch'),contextlib.redirect_stdout(io.StringIO()):run(d)
            self.assertEqual(json.loads((d/'frontends/dependency-source/catalog-job.json').read_text())['phase'],'failed')

    def test_batch_budget_resumes_pending_frontier_and_records_fetch_errors(self):
        with tempfile.TemporaryDirectory() as tmp:
            d,bid,helper,h,ev=self.fixture(Path(tmp));attempts=[];bodies={'https://utility.example/child.js':b"import './grand.js';",'https://utility.example/grand.js':None}
            with patch('billworld.research_dependency_capture.capture_asset',side_effect=helper.capture(h,bodies,attempts)),patch('billworld.research_dependency_catalog.shutil.disk_usage',return_value=SimpleNamespace(free=100*1024**3)),contextlib.redirect_stdout(io.StringIO()):
                first=run(d,batch_limit=1,max_batches_per_biller=1);second=run(d,batch_limit=1,max_batches_per_biller=1)
            self.assertEqual(first['last_biller']['phase'],'batch_limit_reached');self.assertEqual(second['attempted_sources'],1)
            self.assertEqual(second['outcomes'],{'fetch_error':1});self.assertEqual(second['last_biller']['asset_status_counts']['fetch_error'],1)
            self.assertIn('Recorded fetch failures are not automatically retried',second['limits'])

    def test_capacity_bounds_and_duplicate_supervisor_guard(self):
        with tempfile.TemporaryDirectory() as tmp:
            d,bid,helper,h,ev=self.fixture(Path(tmp))
            with patch('billworld.research_dependency_catalog.shutil.disk_usage',return_value=SimpleNamespace(free=0)),patch('billworld.research_dependency_catalog.fetch') as capture:
                result=run(d);self.assertEqual(result['phase'],'capacity_limited');self.assertEqual(result['exit_code'],2);capture.assert_not_called()
            with (d/'frontends/dependency-source/catalog-supervisor.lock').open('a') as lock:
                fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
                with self.assertRaisesRegex(ValueError,'already live'):run(d)
            for params in [{'batch_limit':0},{'workers':9},{'max_depth':11},{'max_nodes':0},{'min_free_gib':0},{'biller_limit':False}]:
                with self.assertRaises(ValueError):run(d,**params)

    def test_stale_analysis_is_not_selected_and_biller_limit_is_explicit(self):
        with tempfile.TemporaryDirectory() as tmp:
            d,bid,helper,h,ev=self.fixture(Path(tmp))
            import sqlite3
            db=sqlite3.connect(d/'frontends/dependencies.sqlite');db.execute("UPDATE analyses SET parser_revision='old'");db.commit();db.close()
            self.assertEqual(candidates(d,revision()),[])
            with contextlib.redirect_stdout(io.StringIO()):empty=run(d)
            self.assertEqual(empty['candidate_billers'],0);self.assertEqual(empty['phase'],'current_candidate_sweep_finished')
            self.assertIn('Finished sweep is not full-catalog or source completeness',empty['limits'])
            analyze(d,bid)
            with patch('billworld.research_dependency_catalog.fetch',return_value={'attempted':0,'outcomes':{},'assets':[],'limits':['max_depth_reached']}),contextlib.redirect_stdout(io.StringIO()):limited=run(d,biller_limit=1)
            self.assertEqual(limited['phase'],'biller_limit_reached');self.assertEqual(limited['billers_visited'],1)
            self.assertEqual(limited['last_biller']['limits'],['max_depth_reached'])

    def test_same_body_new_redirect_base_reopens_completed_biller(self):
        with tempfile.TemporaryDirectory() as tmp:
            d,bid,helper,h,ev=self.fixture(Path(tmp));attempts=[];bodies={'https://utility.example/child.js':b'export const ready=true;','https://utility.example/new/child.js':b'export const ready=true;'}
            with patch('billworld.research_dependency_capture.capture_asset',side_effect=helper.capture(h,bodies,attempts)),contextlib.redirect_stdout(io.StringIO()):first=run(d)
            import sqlite3
            ev['final_url']='https://utility.example/new/app.js';db=sqlite3.connect(d/'frontends/frontends.sqlite');db.execute('UPDATE assets SET evidence=? WHERE url=?',(json.dumps(ev),'https://utility.example/app.js'));db.commit();db.close();analyze(d,bid)
            with patch('billworld.research_dependency_capture.capture_asset',side_effect=helper.capture(h,bodies,attempts)),contextlib.redirect_stdout(io.StringIO()):second=run(d)
            self.assertEqual(second['attempted_sources'],1);self.assertNotEqual(first['last_biller']['root_signature'],second['last_biller']['root_signature']);self.assertEqual(attempts[-1],'https://utility.example/new/child.js')
