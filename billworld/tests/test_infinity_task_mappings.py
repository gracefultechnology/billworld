import importlib.util
import json
from pathlib import Path
import shutil
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[2]
APP=ROOT/'billworld/infinity/app'


class TaskMappingTests(unittest.TestCase):
    def load_harness(self, construction):
        tmp=Path(tempfile.mkdtemp());self.addCleanup(shutil.rmtree,tmp)
        for name in ('harness.py','tasks.json'):shutil.copy2(APP/name,tmp/name)
        (tmp/'billworld-root.json').write_text(json.dumps({'root':str(ROOT),'construction':construction}))
        spec=importlib.util.spec_from_file_location('mapping_test_harness',tmp/'harness.py')
        hooks=importlib.util.module_from_spec(spec);spec.loader.exec_module(hooks)
        return hooks

    def test_harness_loads_both_cohorts_from_tasks_json(self):
        mappings=json.loads((APP/'tasks.json').read_text())
        self.assertEqual(set(mappings),{'released','construction'})
        for construction,cohort in ((False,'released'),(True,'construction')):
            hooks=self.load_harness(construction)
            expected={key:tuple(value) for key,value in mappings[cohort].items()}
            self.assertEqual(hooks.TASKS,expected)
            # Episode seeds come from mapping order, so loading must keep it.
            self.assertEqual(list(hooks.TASKS),list(mappings[cohort]))

    def test_every_mapping_names_a_task_manifest_once(self):
        manifests={}
        for path in (ROOT/'billworld/tasks').glob('*.json'):
            task=json.loads(path.read_text());manifests[task['id']]=task['site_id']
        mappings=json.loads((APP/'tasks.json').read_text())
        self.assertTrue(mappings['released'])
        self.assertFalse(set(mappings['released'])&set(mappings['construction']))
        task_ids=[]
        for cohort in mappings.values():
            for reference,entry in cohort.items():
                self.assertRegex(reference,r'^task_[a-z]+\d+$')
                self.assertEqual(len(entry),2,reference)
                site_id,task_id=entry
                self.assertEqual(manifests.get(task_id),site_id,reference)
                task_ids.append(task_id)
        self.assertEqual(len(task_ids),len(set(task_ids)))


if __name__=='__main__':
    unittest.main()
