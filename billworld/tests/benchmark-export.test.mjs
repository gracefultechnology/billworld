import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {build,BILLPAY_CORE} from '../benchmark/export.mjs';

const committed=path=>readFileSync(new URL(`../benchmark/${path}`,import.meta.url),'utf8');

test('the committed benchmark files match the released tasks',()=>{
  const {tasks,sites,splits}=build();
  assert.equal(committed('data/tasks.jsonl'),tasks.map(row=>JSON.stringify(row)).join('\n')+'\n');
  assert.equal(committed('data/sites.jsonl'),sites.map(row=>JSON.stringify(row)).join('\n')+'\n');
  assert.deepEqual(JSON.parse(committed('data/splits.json')),splits);
});

test('public rows carry prompts and budgets, never private goals or persona secrets',()=>{
  const {tasks}=build();
  const allowed=['reference_id','task_id','version','site_id','site_name','portal_family','category','prompt','budget_seconds','budget_actions','evidence_cohort','splits'];
  for(const task of tasks)assert.deepEqual(Object.keys(task),allowed);
  assert.ok(!committed('data/tasks.jsonl').includes('"goal"'));
});

test('the core split is ten payment tasks on ten different sites',()=>{
  const core=build().tasks.filter(task=>task.splits.includes('billpay-core-10'));
  assert.deepEqual(core.map(task=>task.reference_id).sort(),[...BILLPAY_CORE].sort());
  assert.equal(new Set(core.map(task=>task.site_id)).size,10);
  assert.ok(core.every(task=>task.category==='payment'));
});
