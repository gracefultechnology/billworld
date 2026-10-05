import json
from pathlib import Path
import subprocess
import string
import tempfile
import unittest
from billworld.infinity.prepare_generation import prepare, PROTOCOL, PREFIX
from billworld.infinity.bootstrap import ROOT, REVISION

class GenerationContractTests(unittest.TestCase):
    def checkout(self, path):
        source=ROOT/'.upstream/webarena-infinity'
        if not (source/'.git').exists(): self.skipTest('Pinned upstream checkout required')
        subprocess.run(['git','clone','--shared','--no-checkout',str(source),str(path)],check=True,capture_output=True)
        subprocess.run(['git','-C',str(path),'checkout',REVISION,'--','infra/prompts','docs/environment-protocol.md'],check=True,capture_output=True)
        return path

    def test_all_phases_use_billing_protocol_and_install_is_repeatable(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=self.checkout(Path(tmp)/'build')
            original=(root/'docs/environment-protocol.md').read_bytes()
            first=prepare(root); second=prepare(root)
            self.assertEqual(first,second)
            self.assertEqual(len(first['prompts']),7)
            self.assertEqual((root/'docs/environment-protocol.md').read_bytes(),original)
            self.assertEqual((root/'docs/billworld-environment-protocol.md').read_text(),PROTOCOL)
            for item in first['prompts']:
                body=(root/item['file']).read_text()
                self.assertTrue(body.startswith(PREFIX))
                # Same formatting operation as Infinity's actual load_prompt.
                fields={field for _,field,_,_ in string.Formatter().parse(body) if field}
                original=subprocess.check_output(['git','-C',str(root),'show',REVISION+':'+item['file']],text=True)
                self.assertEqual(fields,{field for _,field,_,_ in string.Formatter().parse(original) if field})
                body.format(**{field:'fixture-value' for field in fields})
            generated=(root/'infra/prompts/generate-app.md').read_text().format(docs_source='evidence/packet')
            self.assertIn('./evidence/packet',generated)
            self.assertNotIn('follow `./docs/environment-protocol.md`',generated)
            self.assertFalse(first['pipeline_executed'])
            self.assertEqual(json.loads((root/'billworld-generation-contract.json').read_text()),first)

    def test_dirty_later_phase_rejected_before_any_prompt_changes(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=self.checkout(Path(tmp)/'build')
            dirty=root/'infra/prompts/harden-tasks.md'; dirty.write_text('custom instructions')
            before={p.name:p.read_bytes() for p in (root/'infra/prompts').glob('*.md')}
            with self.assertRaisesRegex(ValueError,'modified construction prompt'): prepare(root)
            self.assertEqual(before,{p.name:p.read_bytes() for p in (root/'infra/prompts').glob('*.md')})
            self.assertFalse((root/'docs/billworld-environment-protocol.md').exists())

    def test_dirty_protocol_rejected_before_prompt_changes(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=self.checkout(Path(tmp)/'build')
            (root/'docs/billworld-environment-protocol.md').write_text('different policy')
            before={p.name:p.read_bytes() for p in (root/'infra/prompts').glob('*.md')}
            with self.assertRaisesRegex(ValueError,'modified billing protocol'): prepare(root)
            self.assertEqual(before,{p.name:p.read_bytes() for p in (root/'infra/prompts').glob('*.md')})
