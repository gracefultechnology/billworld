import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {build,files,outcomeFields,BILLPAY_CORE,CORE_SPLIT} from '../benchmark/export.mjs';

const committed=path=>readFileSync(new URL(`../benchmark/${path}`,import.meta.url),'utf8');

test('the committed benchmark files match the released tasks',()=>{
  const {tasks,sites,splits}=build();
  assert.equal(committed('data/tasks.jsonl'),tasks.map(row=>JSON.stringify(row)).join('\n')+'\n');
  assert.equal(committed('data/sites.jsonl'),sites.map(row=>JSON.stringify(row)).join('\n')+'\n');
  assert.deepEqual(JSON.parse(committed('data/splits.json')),splits);
  for(const [path,text] of Object.entries(files(build())))assert.equal(committed(path),text,path);
  assert.deepEqual(committed('data/billpay_core_10.jsonl').trim().split('\n').map(line=>JSON.parse(line).reference_id),BILLPAY_CORE);
});

test('split ids are hub split names and the card lists the core split file',()=>{
  const {splits}=build();
  for(const name of Object.keys(splits))assert.match(name,/^[A-Za-z0-9_]+$/);
  assert.equal(CORE_SPLIT,'billpay_core_10');
  const card=committed('README.md');
  assert.match(card,/- split: billpay_core_10\n\s+path: data\/billpay_core_10\.jsonl/);
  assert.ok(!card.includes('billpay-core-10'));
});

test('public rows carry prompts and budgets, never private goals or persona secrets',()=>{
  const {tasks}=build();
  const allowed=['reference_id','task_id','version','site_id','site_name','portal_family','category','prompt','budget_seconds','budget_actions','outcome_fields','evidence_cohort','splits'];
  for(const task of tasks)assert.deepEqual(Object.keys(task),allowed);
  assert.ok(!committed('data/tasks.jsonl').includes('"goal"'));
});

test('the core split is ten payment tasks on ten different sites',()=>{
  const core=build().tasks.filter(task=>task.splits.includes(CORE_SPLIT));
  assert.deepEqual(core.map(task=>task.reference_id).sort(),[...BILLPAY_CORE].sort());
  assert.equal(new Set(core.map(task=>task.site_id)).size,10);
  assert.ok(core.every(task=>task.category==='payment'));
});

test('outcome_fields name only the outcome keys each private grader reads',()=>{
  const graded=['confirmation','billingDate','scheduledDate','statementFilename','postedBalanceCents','pendingPaymentCents','remainingBalanceCents'];
  const rows=new Map(build().tasks.map(task=>[task.reference_id,task.outcome_fields]));
  for(const fields of rows.values())assert.ok(fields.every(field=>graded.includes(field)),fields.join());
  for(const id of BILLPAY_CORE)assert.deepEqual(rows.get(id),['confirmation']);
  assert.deepEqual(rows.get('task_m2'),[]); // Juneau AutoPay is graded on saved state alone
  assert.deepEqual(rows.get('task_h1'),['scheduledDate']);
  assert.deepEqual(rows.get('task_h2'),['billingDate']);
  // Every task whose prompt asks for a value back has a graded field, and no other task does.
  for(const task of build().tasks)assert.equal(/report/i.test(task.prompt),task.outcome_fields.length>0,task.reference_id);
  assert.deepEqual(outcomeFields({type:'starnik_schedule',mode:'cancel'}),[]);
  assert.deepEqual(outcomeFields({type:'wipp_statement',due_date:'2026-10-20',amount_cents:1}),['billingDate','remainingBalanceCents']);
  assert.throws(()=>outcomeFields({type:'brand_new_goal'}),/Unknown goal type/);
  assert.throws(()=>outcomeFields({account_id:'acct-primary'}),/Unknown untyped goal shape/);
  assert.throws(()=>outcomeFields({type:'starnik_schedule',mode:'skip'}),/Unknown starnik_schedule mode/);
});
