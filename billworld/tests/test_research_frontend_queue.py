import contextlib
import io
import json
import os
import signal
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from billworld.research_frontends import database
from billworld.research_frontend_queue import run, inventory_state, prioritized_work, supervisor_owner


class QueueTests(unittest.TestCase):
    def fixture(self, root, asset=False):
        directory=root/'frontends';db=database(directory)
        if asset:
            db.execute('INSERT INTO assets(id,url) VALUES(?,?)',('asset','https://example.com/app.js'))
            db.execute('INSERT INTO refs VALUES(?,?,?,?)',('page','asset','script','third_party'));db.commit()
        db.close()
        (directory/'inventory-job.json').write_text(json.dumps({'phase':'completed','exit_code':0}))
        return directory

    def test_complete_inventory_and_empty_queue_is_terminal(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);directory=self.fixture(root)
            result=run(root)
            self.assertEqual(result['phase'],'completed');self.assertEqual(result['exit_code'],0)
            self.assertEqual(json.loads((directory/'capture-job.json').read_text())['phase'],'completed')

    def test_cross_host_assets_are_captured_and_attempts_not_repeated(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);directory=self.fixture(root,True)
            def fetch(db,directory,work,workers):
                self.assertEqual(work[0]['url'],'https://example.com/app.js')
                db.execute("UPDATE assets SET status='frontend_captured'");db.commit()
            with patch('billworld.research_frontend_queue.fetch_work',side_effect=fetch) as worker,contextlib.redirect_stdout(io.StringIO()):
                result=run(root);self.assertEqual(worker.call_count,1)
                second=run(root);self.assertEqual(worker.call_count,1)
            self.assertEqual(result['counts']['active_asset_status_counts'],{'frontend_captured':1})
            self.assertEqual(second['batches_completed'],0)

    def test_batch_outcomes_and_periodic_counts_are_distinct_and_completion_is_fresh(self):
        for interval,expected_measures in [(25,1),(2,2)]:
            with self.subTest(interval=interval),tempfile.TemporaryDirectory() as tmp:
                root=Path(tmp);directory=self.fixture(root);db=database(directory)
                db.executemany('INSERT INTO assets(id,url) VALUES(?,?)',[(f'asset-{i:03}',f'https://example.com/{i}.js') for i in range(201)])
                db.executemany('INSERT INTO refs VALUES(?,?,?,?)',[('page',f'asset-{i:03}','script','same_host') for i in range(201)]);db.commit();db.close()
                calls=[]
                def fetch(db,directory,work,workers):
                    calls.append(len(work));record=json.loads((directory/'capture-job.json').read_text())
                    if len(calls)==3:
                        self.assertEqual(record['last_batch_status_counts'],{'frontend_captured':100})
                        if interval==2:
                            self.assertEqual(record['counts_as_of_batch'],2)
                            self.assertEqual(record['counts']['active_asset_status_counts']['pending'],1)
                        else:
                            self.assertNotIn('counts',record)
                            self.assertEqual(record['counts_status'],'not_yet_measured')
                    db.executemany("UPDATE assets SET status='frontend_captured' WHERE id=?",[(row['id'],) for row in work]);db.commit()
                from billworld.research_frontends import status
                with patch('billworld.research_frontend_queue.fetch_work',side_effect=fetch),patch('billworld.research_frontend_queue.status',wraps=status) as measure,contextlib.redirect_stdout(io.StringIO()):
                    result=run(root,stats_every_batches=interval)
                self.assertEqual(calls,[100,100,1]);self.assertEqual(measure.call_count,expected_measures)
                self.assertEqual(result['phase'],'completed');self.assertEqual(result['counts_as_of_batch'],3)
                self.assertEqual(result['last_batch_status_counts'],{'frontend_captured':1})
                self.assertEqual(result['counts']['active_asset_status_counts'],{'frontend_captured':201})
                self.assertEqual(result['counts']['same_host_pending'],0)
                self.assertIn('measured_at',result['counts'])

    def test_invalid_stats_interval_cannot_start_a_supervisor(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);directory=self.fixture(root)
            for interval in [0,1001,True,1.5]:
                with self.assertRaisesRegex(ValueError,'Stats interval'):run(root,stats_every_batches=interval)
            self.assertFalse((directory/'capture-job.json').exists())

    def test_capacity_limit_preserves_pending_work(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);directory=self.fixture(root,True)
            with patch('billworld.research_frontend_queue.shutil.disk_usage') as usage,patch('billworld.research_frontend_queue.fetch_work') as worker:
                usage.return_value.free=0
                result=run(root);worker.assert_not_called()
            self.assertEqual(result['phase'],'capacity_limited');self.assertEqual(result['exit_code'],2)
            db=database(directory);self.assertEqual(db.execute('SELECT status FROM assets').fetchone()[0],'pending');db.close()

    def test_waits_for_live_inventory_and_rejects_missing_inventory_as_completion(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);directory=self.fixture(root)
            (directory/'inventory-job.json').write_text(json.dumps({'phase':'running','pid':os.getpid()}))
            self.assertEqual(inventory_state(directory),'running')
            with patch('billworld.research_frontend_queue.inventory_state',side_effect=['running','completed']),patch('billworld.research_frontend_queue.time.sleep') as sleep:
                self.assertEqual(run(root)['phase'],'completed');sleep.assert_called_once_with(10)
            (directory/'inventory-job.json').unlink()
            self.assertEqual(run(root)['phase'],'inventory_incomplete')

    def test_live_capture_supervisor_is_not_restarted(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);directory=self.fixture(root)
            (directory/'capture-job.json').write_text(json.dumps({'phase':'collecting','pid':os.getpid()}))
            with self.assertRaisesRegex(ValueError,'already live'):run(root)

    def test_database_initialization_has_durable_owner_and_failure_record(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);directory=self.fixture(root)
            previous=signal.getsignal(signal.SIGTERM)
            def fail(path):
                record=json.loads((directory/'capture-job.json').read_text())
                self.assertEqual(record['phase'],'initializing_database')
                self.assertEqual(record['pid'],os.getpid())
                raise RuntimeError('Synthetic migration failure')
            with patch('billworld.research_frontend_queue.database',side_effect=fail):
                with self.assertRaisesRegex(RuntimeError,'migration failure'):run(root)
            record=json.loads((directory/'capture-job.json').read_text())
            self.assertEqual(record['phase'],'failed');self.assertEqual(record['exit_code'],1)
            self.assertEqual(signal.getsignal(signal.SIGTERM),previous)
            self.assertEqual(run(root)['phase'],'completed')

    def test_supervisor_lock_prevents_a_concurrent_start_before_pid_record(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);directory=self.fixture(root)
            with supervisor_owner(directory):
                with self.assertRaisesRegex(ValueError,'already live'):run(root)
                self.assertFalse((directory/'capture-job.json').exists())
            self.assertEqual(run(root)['phase'],'completed')

    def test_priority_reload_orders_shared_assets_once_and_keeps_global_work(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);directory=self.fixture(root,True);db=database(directory)
            a='biller_'+'1'*20;b='biller_'+'2'*20
            db.execute('INSERT INTO assets(id,url) VALUES(?,?)',('z-priority','https://cdn.example/app.js'))
            db.execute('INSERT INTO refs VALUES(?,?,?,?)',('priority-page','z-priority','script','third_party'))
            db.executemany('INSERT INTO page_billers VALUES(?,?)',[('priority-page',a),('priority-page',b)]);db.commit()
            self.assertEqual(prioritized_work(db,directory,1)[0][0]['id'],'asset')
            config=directory/'capture-priorities.json';config.write_text(json.dumps({'biller_ids':[a,b,a]}))
            rows,priorities=prioritized_work(db,directory,10)
            self.assertEqual([r['id'] for r in rows],['z-priority','asset']);self.assertEqual(priorities,[a,b])
            db.execute("UPDATE assets SET status='frontend_captured' WHERE id='z-priority'");db.commit()
            self.assertEqual([r['id'] for r in prioritized_work(db,directory,10)[0]],['asset'])
            db.close()

    def test_malformed_priority_config_fails_without_mutating_queue(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);directory=self.fixture(root,True);db=database(directory)
            for value in ['not-a-list',['../../credentials'],['biller_'+'a'*20]*257]:
                (directory/'capture-priorities.json').write_text(json.dumps({'biller_ids':value}))
                with self.assertRaisesRegex(ValueError,'Invalid'):prioritized_work(db,directory)
                self.assertEqual(db.execute('SELECT status FROM assets').fetchone()[0],'pending')
            db.close()

    def test_signal_stops_at_batch_boundary_and_restores_handlers(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);directory=self.fixture(root,True)
            previous=signal.getsignal(signal.SIGTERM)
            def fetch(db,directory,work,workers): signal.raise_signal(signal.SIGTERM)
            with patch('billworld.research_frontend_queue.fetch_work',side_effect=fetch),contextlib.redirect_stdout(io.StringIO()):
                result=run(root)
            self.assertEqual(result['phase'],'stopped');self.assertEqual(result['exit_code'],0)
            self.assertEqual(result['batches_completed'],1);self.assertEqual(signal.getsignal(signal.SIGTERM),previous)

if __name__ == '__main__':unittest.main()
