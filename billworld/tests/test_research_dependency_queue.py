import contextlib
import fcntl
import io
import json
import os
from pathlib import Path
import signal
import tempfile
import unittest
from unittest.mock import patch
from billworld.research_dependency_queue import run,capture_state

def batch(statuses=()):return {'parser_revision':'revision','analyses':[{'asset_id':str(i),'body_sha256':'hash','source_url':'https://example.com/a.js','parser_revision':'revision','parse':{'status':status},'dependencies':[{'url':'https://example.com/b.js'}]} for i,status in enumerate(statuses)],'reused':0,'skipped_metadata_current':3}

class DependencyQueueTests(unittest.TestCase):
    def fixture(self,root,phase='completed'):
        directory=root/'frontends';directory.mkdir();(directory/'capture-job.json').write_text(json.dumps({'phase':phase,'exit_code':0,'pid':os.getpid()}));return directory

    def test_resumes_committed_analyses_preserves_errors_and_hashes_compact_batch_receipt(self):
        import hashlib
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);directory=self.fixture(root)
            with patch('billworld.research_dependency_queue.analyze_batch',side_effect=[batch(['parsed','partial','parser_timeout']),batch()]),contextlib.redirect_stdout(io.StringIO()):r=run(root)
            self.assertEqual(r['phase'],'caught_up_to_captured_sources');self.assertEqual(r['sources_analyzed_or_reused'],3);self.assertEqual(r['last_batch_status_counts'],{'parsed':1,'partial':1,'parser_timeout':1});receipt=directory/r['last_batch'];self.assertEqual(r['last_batch_sha256'],hashlib.sha256(receipt.read_bytes()).hexdigest());self.assertNotIn('dependencies',json.loads(receipt.read_text())['sources'][0])
            with patch('billworld.research_dependency_queue.analyze_batch',return_value=batch()):second=run(root)
            self.assertEqual(second['batches_completed'],0);self.assertEqual(second['previous_attempt']['phase'],'caught_up_to_captured_sources')

    def test_live_capture_wait_and_terminal_incomplete_are_distinct(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);directory=self.fixture(root,'collecting');self.assertEqual(capture_state(directory),'running')
            with patch('billworld.research_dependency_queue.analyze_batch',return_value=batch()),patch('billworld.research_dependency_queue.capture_state',side_effect=['running','completed']),patch('billworld.research_dependency_queue.time.sleep') as sleep:r=run(root)
            sleep.assert_called_once_with(10);self.assertEqual(r['phase'],'caught_up_to_captured_sources')
            (directory/'capture-job.json').write_text(json.dumps({'phase':'capacity_limited','exit_code':2}))
            with patch('billworld.research_dependency_queue.analyze_batch',return_value=batch()):r=run(root)
            self.assertEqual(r['phase'],'capture_incomplete');self.assertEqual(r['exit_code'],1)

    def test_disk_reserve_and_invalid_configuration_do_not_start_analysis(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);self.fixture(root)
            for kw in [{'batch_limit':True},{'batch_limit':0},{'min_free_gib':0},{'max_batches':0}]:
                with self.assertRaises(ValueError):run(root,**kw)
            with patch('billworld.research_dependency_queue.shutil.disk_usage') as disk,patch('billworld.research_dependency_queue.analyze_batch') as worker:
                disk.return_value.free=0;r=run(root);worker.assert_not_called()
            self.assertEqual(r['phase'],'capacity_limited')

    def test_single_owner_lock_rejects_second_supervisor(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);directory=self.fixture(root)
            with (directory/'dependency-supervisor.lock').open('a') as handle:
                fcntl.flock(handle,fcntl.LOCK_EX|fcntl.LOCK_NB)
                with self.assertRaisesRegex(ValueError,'already live'):run(root)

    def test_stop_after_current_batch_and_finite_batch_limit_preserve_commits(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);self.fixture(root)
            def analyze(*args,**kw):os.kill(os.getpid(),signal.SIGTERM);return batch(['parsed'])
            prior=signal.getsignal(signal.SIGTERM)
            with patch('billworld.research_dependency_queue.analyze_batch',side_effect=analyze),contextlib.redirect_stdout(io.StringIO()):r=run(root)
            self.assertEqual(r['phase'],'stopped');self.assertEqual(r['batches_completed'],1);self.assertEqual(signal.getsignal(signal.SIGTERM),prior)
            with patch('billworld.research_dependency_queue.analyze_batch',return_value=batch(['parsed'])),contextlib.redirect_stdout(io.StringIO()):r=run(root,max_batches=1)
            self.assertEqual(r['phase'],'batch_limit_reached');self.assertEqual(r['batches_completed'],1)

    def test_source_integrity_failure_is_recorded_without_claiming_caught_up(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);directory=self.fixture(root);prior=signal.getsignal(signal.SIGINT)
            with patch('billworld.research_dependency_queue.analyze_batch',side_effect=ValueError('Captured body hash mismatch')):
                with self.assertRaisesRegex(ValueError,'hash mismatch'):run(root)
            r=json.loads((directory/'dependency-job.json').read_text());self.assertEqual(r['phase'],'failed');self.assertEqual(r['error_type'],'ValueError');self.assertEqual(r['batches_completed'],0);self.assertEqual(signal.getsignal(signal.SIGINT),prior)
