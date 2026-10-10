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
            for app_name, cohort, count in [('billworld','released',31),('billworld-construction','construction',37)]:
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
            self.assertTrue(all('Construction-only' in t['instruction'] for t in inventories['construction']))

            recovery = next(t['instruction'] for t in inventories['construction'] if t['id'] == 'task_c34')
            self.assertNotIn('alex.inframark', recovery)
            self.assertNotIn('Inframark-2026!', recovery)
            self.assertIn('Forgot Username', recovery)
            self.assertIn('Mailbox-2026!', recovery)

            onswc_recovery = next(t['instruction'] for t in inventories['construction'] if t['id'] == 'task_c37')
            self.assertNotIn('alex.onswc', onswc_recovery)
            self.assertNotIn('ONSWC-2026!', onswc_recovery)
            self.assertIn('Forgot Username', onswc_recovery)
