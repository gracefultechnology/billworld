import contextlib
import hashlib
import io
import json
import importlib.util
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch
from billworld.infinity import bootstrap

class InfinityOverlayTests(unittest.TestCase):
    def test_overlay_is_repeatable_on_clean_pinned_evaluator_sources(self):
        source = bootstrap.ROOT / '.upstream/webarena-infinity'
        if not (source / '.git').exists():
            self.skipTest('Bootstrap the pinned upstream checkout to validate its overlay')
        with tempfile.TemporaryDirectory() as tmp:
            checkout=Path(tmp); (checkout/'evaluation').mkdir(); (checkout/'apps').mkdir()
            for name in ['agents.py','tasks.py','vision_agents.py']:
                original=subprocess.check_output(['git','-C',str(source),'show',bootstrap.REVISION+':evaluation/'+name])
                (checkout/'evaluation'/name).write_bytes(original)
            # This focused test supplies source files from the exact pinned Git object.
            # Repository creation/pin verification remains the real bootstrap's job.
            with patch.object(bootstrap.subprocess,'check_output',return_value=bootstrap.REVISION),contextlib.redirect_stdout(io.StringIO()):
                bootstrap.install(checkout)
                first={str(p.relative_to(checkout)):hashlib.sha256(p.read_bytes()).hexdigest() for p in checkout.rglob('*') if p.is_file()}
                bootstrap.install(checkout)
                second={str(p.relative_to(checkout)):hashlib.sha256(p.read_bytes()).hexdigest() for p in checkout.rglob('*') if p.is_file()}
            self.assertEqual(first,second)
            for name in ['agents.py','tasks.py','vision_agents.py']:
                compile((checkout/'evaluation'/name).read_text(),name,'exec')
            inventories = {}
            # Counts follow the canonical harness inventories, which each site owner edits;
            # set equality below still requires generated definitions to match them exactly.
            import ast as _ast
            _tree = _ast.parse((bootstrap.OVERLAY/'app'/'harness.py').read_text())
            _counts = {node.targets[0].id: len(node.value.keys) for node in _tree.body if isinstance(node, _ast.Assign) and getattr(node.targets[0], 'id', '') in ('RELEASED_TASKS', 'CONSTRUCTION_TASKS')}
            for app_name, cohort, count in [('billworld','released',_counts['RELEASED_TASKS']),('billworld-construction','construction',_counts['CONSTRUCTION_TASKS'])]:
                app = checkout/'apps'/app_name
                definitions = json.loads((app/'real-tasks.json').read_text())
                config = json.loads((app/'billworld-root.json').read_text())
                self.assertEqual(config['construction'], cohort == 'construction')
                self.assertEqual(len(definitions), count)
                self.assertTrue(all(t['site_cohort'] == cohort for t in definitions))
                spec = importlib.util.spec_from_file_location('cohort_harness', app/'harness.py')
                hooks = importlib.util.module_from_spec(spec); spec.loader.exec_module(hooks)
                self.assertEqual(hooks.SITE_COHORT, cohort)
                self.assertEqual(set(hooks.TASKS), {t['id'] for t in definitions})
                self.assertEqual({k:v[1] for k,v in hooks.TASKS.items()}, {t['id']:t['billworld_task_id'] for t in definitions})
                with tempfile.TemporaryDirectory() as control_dir:
                    control = Path(control_dir)/'worker.json'
                    control.write_text(json.dumps({'construction':cohort != 'construction'}))
                    with patch.object(hooks, 'worker', return_value=control):
                        with self.assertRaisesRegex(ValueError, 'cohort mismatch'):
                            hooks.admin('http://127.0.0.1:12345', 'report', {})
                inventories[cohort] = definitions
            self.assertFalse({t['id'] for t in inventories['released']} & {t['id'] for t in inventories['construction']})
            # Batavia is a released first slice: every Batavia task file is generated once, as task_bat*, never as construction.
            batavia_files = sorted(p.name for p in (bootstrap.ROOT/'billworld/tasks').glob('batavia-*.json'))
            batavia_ids = {json.loads((bootstrap.ROOT/'billworld/tasks'/name).read_text())['id'] for name in batavia_files}
            released_batavia = [t for t in inventories['released'] if t['billworld_task_id'].startswith('batavia-')]
            self.assertEqual({t['billworld_task_id'] for t in released_batavia}, batavia_ids)
            self.assertEqual(len(released_batavia), len(batavia_files))
            self.assertTrue(all(t['id'].startswith('task_bat') and 'Construction-only' not in t['instruction'] for t in released_batavia))
            self.assertFalse(any(t['billworld_task_id'].startswith('batavia-') for t in inventories['construction']))
            batavia_recovery = next(t['instruction'] for t in released_batavia if t['billworld_task_id'] == 'batavia-recover-login-v1')
            self.assertNotIn('Billworld-2026!', batavia_recovery)
            # Lockwood is a released first slice: every lockwood task file is generated once, as task_lw*.
            lockwood_files = sorted(p.name for p in (bootstrap.ROOT/'billworld/tasks').glob('lockwood-*.json'))
            released_lockwood = [t for t in inventories['released'] if t['billworld_task_id'].startswith('lockwood-')]
            self.assertEqual({t['billworld_task_id'] for t in released_lockwood}, {json.loads((bootstrap.ROOT/'billworld/tasks'/name).read_text())['id'] for name in lockwood_files})
            self.assertEqual(len(released_lockwood), len(lockwood_files))
            self.assertTrue(all(t['id'].startswith('task_lw') and 'Construction-only' not in t['instruction'] for t in released_lockwood))
            self.assertFalse(any(t['billworld_task_id'].startswith('lockwood-') for t in inventories['construction']))
            self.assertNotIn('Billworld-2026!', next(t['instruction'] for t in released_lockwood if t['billworld_task_id'] == 'lockwood-recover-login-v1'))
            self.assertIn('"scheduledDate"', next(t['instruction'] for t in released_lockwood if t['billworld_task_id'] == 'lockwood-schedule-draft-v1'))
            self.assertTrue(all('Construction-only' in t['instruction'] for t in inventories['construction']))

            # Inframark is a released first slice: every inframark task file is generated once, as task_inf*.
            inframark_files = sorted(p.name for p in (bootstrap.ROOT/'billworld/tasks').glob('inframark-*.json'))
            released_inframark = [t for t in inventories['released'] if t['billworld_task_id'].startswith('inframark-')]
            self.assertEqual({t['billworld_task_id'] for t in released_inframark}, {json.loads((bootstrap.ROOT/'billworld/tasks'/name).read_text())['id'] for name in inframark_files})
            self.assertEqual(len(released_inframark), len(inframark_files))
            self.assertTrue(all(t['id'].startswith('task_inf') and 'Construction-only' not in t['instruction'] for t in released_inframark))
            self.assertFalse(any(t['billworld_task_id'].startswith('inframark-') for t in inventories['construction']))
            recovery = next(t['instruction'] for t in released_inframark if t['id'] == 'task_inf5')
            self.assertNotIn('alex.inframark', recovery)
            self.assertNotIn('Inframark-2026!', recovery)
            self.assertIn('Forgot Username', recovery)
            self.assertIn('Mailbox-2026!', recovery)

            onswc = [t for t in inventories['released'] if t['id'].startswith('task_onswc')]
            self.assertEqual(len(onswc), 18)
            self.assertFalse(any(t['billworld_task_id'].startswith('onswc-') for t in inventories['construction']))
            onswc_recovery = next(t['instruction'] for t in onswc if t['id'] == 'task_onswc3')
            self.assertNotIn('alex.onswc', onswc_recovery)
            self.assertNotIn('ONSWC-2026!', onswc_recovery)
            self.assertIn('Forgot Username', onswc_recovery)
