import contextlib
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from billworld.research_frontends import database
from billworld.research_frontend_queue import run, dns_failure_burst, supervisor_owner
from billworld.research_frontend_recovery import recover


class DNSRecoveryTests(unittest.TestCase):
    def fixture(self,root,count=20):
        directory=root/'frontends';db=database(directory)
        for i in range(count):
            row={'id':f'{i:03}','url':f'https://host{i%4}.example/{i}.js'}
            ev=json.dumps({'status':'fetch_error','error':'gaierror: DNS unavailable','attempted_at':'2026-10-05T14:30:00+00:00','requested_url':row['url']})
            db.execute('INSERT INTO assets VALUES(?,?,?,?)',(row['id'],row['url'],'fetch_error',ev))
            db.execute('INSERT INTO refs VALUES(?,?,?,?)',('page',row['id'],'script','same_host'))
            db.execute('INSERT INTO attempts VALUES(?,?,?)',(row['id'],'2026-10-05T14:30:00+00:00',ev))
        db.commit();(directory/'inventory-job.json').write_text(json.dumps({'phase':'completed','exit_code':0}))
        return db

    def test_recovery_is_bounded_windowed_and_preserves_attempts_and_prior_evidence(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);db=self.fixture(root)
            original=list(db.execute('SELECT * FROM attempts'))
            db.execute("UPDATE assets SET status='frontend_captured' WHERE id='000'")
            for asset_id,error,at in [('001','timeout: slow','2026-10-05T14:30:00Z'),('002','gaierror: old','2026-10-05T13:59:59Z'),('003','gaierror: later','2026-10-05T16:00:00Z')]:
                db.execute('UPDATE assets SET evidence=? WHERE id=?',(json.dumps({'error':error,'attempted_at':at}),asset_id))
            db.commit()
            result=recover(root,'2026-10-05T14:00:00Z','2026-10-05T16:00:00Z',5)
            self.assertEqual(result['requeued'],5);self.assertEqual(list(db.execute('SELECT * FROM attempts')),original)
            self.assertEqual(db.execute("SELECT COUNT(*) FROM assets WHERE status='pending'").fetchone()[0],5)
            audits=list(db.execute('SELECT asset_id,prior_evidence FROM dns_requeues'))
            self.assertEqual(len(audits),5)
            for asset_id,evidence in audits:self.assertEqual(db.execute('SELECT evidence FROM assets WHERE id=?',(asset_id,)).fetchone()[0],evidence)
            self.assertEqual(recover(root,'2026-10-05T14:00:00Z','2026-10-05T16:00:00Z',100)['requeued'],11)
            self.assertEqual(recover(root,'2026-10-05T14:00:00Z','2026-10-05T16:00:00Z',100)['requeued'],0)
            db.close()

    def test_recovery_rejects_live_collector_invalid_dates_and_unbounded_limits(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);db=self.fixture(root);db.close()
            with supervisor_owner(root/'frontends'):
                with self.assertRaisesRegex(ValueError,'already live'):recover(root,'2026-10-05T14:00:00Z','2026-10-05T16:00:00Z')
            for since,until,limit in [('2026-10-05','2026-10-06',5),('2026-10-06T00:00:00Z','2026-10-05T00:00:00Z',5),('2026-10-05T14:00:00Z','2026-10-05T16:00:00Z',10001)]:
                with self.assertRaises(ValueError):recover(root,since,until,limit)

    def test_burst_requires_large_cross_host_majority_and_stops_before_next_batch(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);db=self.fixture(root,120)
            work=[{'id':f'{i:03}'} for i in range(100)]
            self.assertTrue(dns_failure_burst(db,work)['suspected'])
            db.execute("UPDATE assets SET url='https://one.example/app.js' || id")
            self.assertFalse(dns_failure_burst(db,work)['suspected'])
            db.rollback();db.execute("UPDATE assets SET status='pending'");db.commit();db.close()
            def fail(db,directory,work,workers):
                db.executemany("UPDATE assets SET status='fetch_error' WHERE id=?",[(r['id'],) for r in work]);db.commit()
            with patch('billworld.research_frontend_queue.fetch_work',side_effect=fail) as fetch,contextlib.redirect_stdout(io.StringIO()):
                result=run(root,min_free_gib=1)
            self.assertEqual(fetch.call_count,1);self.assertEqual(result['phase'],'dns_failure_burst');self.assertEqual(result['exit_code'],3)
            db=database(root/'frontends');self.assertEqual(db.execute("SELECT COUNT(*) FROM assets WHERE status='pending'").fetchone()[0],20);db.close()


if __name__=='__main__':unittest.main()
