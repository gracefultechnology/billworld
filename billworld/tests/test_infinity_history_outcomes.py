import importlib.util
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

class HistoryOutcomeTests(unittest.TestCase):
    def test_private_adapter_accepts_only_safe_integer_summary_fields(self):
        path=Path(__file__).resolve().parents[2]/'.upstream/webarena-infinity/apps/billworld/harness.py'
        if not path.exists(): self.skipTest('Bootstrap upstream overlay first')
        spec=importlib.util.spec_from_file_location('history_outcome_harness',path)
        hooks=importlib.util.module_from_spec(spec);spec.loader.exec_module(hooks)
        for payload,expected in [
            ({'postedBalanceCents':8432,'pendingPaymentCents':1000,'remainingBalanceCents':7432,'state':{'success':True}}, {'postedBalanceCents':8432,'pendingPaymentCents':1000,'remainingBalanceCents':7432}),
            ({'postedBalanceCents':True,'pendingPaymentCents':'1000','remainingBalanceCents':74.32,'events':[]}, {}),
            ({'postedBalanceCents':9007199254740992,'pendingPaymentCents':None}, {})]:
            with self.subTest(payload=payload),tempfile.TemporaryDirectory() as tmp:
                worker=Path(tmp)/'worker.json'
                worker.with_suffix('.episode.json').write_text(json.dumps({'episodeId':'episode-test','taskId':'gmg-read-history-balances-v1'}))
                result=SimpleNamespace(final_result=json.dumps(payload),steps=1,elapsed=0.1)
                with patch.object(hooks,'worker',return_value=worker),patch.object(hooks,'admin',return_value={'constructionSlice':False,'success':False,'checks':{}}) as admin:
                    hooks.verify_run('http://127.0.0.1:1',{'id':'task_gmg6'},result)
                    self.assertEqual(admin.call_args.args[2]['outcome'],expected)
