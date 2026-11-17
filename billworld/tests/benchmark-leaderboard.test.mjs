import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,readdirSync,rmSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {leaderboard,markdown,files} from '../benchmark/leaderboard.mjs';
import {wilson} from '../benchmark/score.mjs';

const splits=JSON.parse(readFileSync(new URL('../benchmark/data/splits.json',import.meta.url),'utf8'));
const tasks=readFileSync(new URL('../benchmark/data/tasks.jsonl',import.meta.url),'utf8').trim().split('\n').map(line=>JSON.parse(line));
const byId=new Map(tasks.map(task=>[task.reference_id,task]));
const commitTasks=()=>null;
const run=({split='billpay_core_10',passing=[],cohort='agent',assistance='none',name='a',version='1',model='m',runAt='2026-10-28T00:00:00.000Z',ids=splits[split]}={})=>({
  billworldCommit:'0'.repeat(40),split,cohort,agent:{name,version,model,accessMode:'browser_only'},assistance,runAt,
  trials:ids.map(id=>({referenceId:id,taskId:byId.get(id).task_id,seed:splits.released.indexOf(id)+1,taskVersion:byId.get(id).version,
    environmentRevision:'0.50.0',attempt:1,success:passing.includes(id),termination:'completed'}))});

test('the leaderboard ranks first-attempt strict pass rate per split and never pools cohorts or assistance',()=>{
  const core=splits.billpay_core_10;
  const {errors,boards}=leaderboard([
    {source:'low.json',results:run({name:'low',passing:core.slice(0,2)})},
    {source:'high.json',results:run({name:'high',passing:core.slice(0,7)})},
    {source:'tie.json',results:run({name:'tie',passing:core.slice(3,5),runAt:'2026-10-29T00:00:00.000Z'})},
    {source:'helped.json',results:run({name:'helped',passing:core,assistance:'person_answers_questions'})},
    {source:'ref.json',results:run({name:'reference',passing:core,cohort:'reference_script',model:null})},
  ],{commitTasks});
  assert.deepEqual(errors,[]);
  assert.deepEqual(Object.keys(boards),['billpay_core_10']);
  const tables=boards.billpay_core_10;
  assert.deepEqual(tables.map(table=>[table.cohort,table.assistance]),[['agent','none'],['agent','person_answers_questions'],['reference_script','none']]);
  const autonomous=tables[0].rows;
  assert.deepEqual(autonomous.map(row=>[row.rank,row.agent,row.passed,row.total]),[[1,'high',7,10],[2,'low',2,10],[2,'tie',2,10]]);
  const [low,high]=wilson(7,10);
  assert.deepEqual([autonomous[0].rate,autonomous[0].low,autonomous[0].high],[0.7,low,high]);
  for(const key of ['agent','version','model','accessMode','billworldCommit','runAt','passed','total'])assert.ok(Object.hasOwn(autonomous[0],key),key);
  assert.deepEqual(tables[1].rows.map(row=>row.agent),['helped']);
  assert.deepEqual(tables[2].rows.map(row=>row.agent),['reference']);
  const text=markdown('billpay_core_10',tables);
  assert.match(text,/## Cohort `agent`, assistance `none`/);
  assert.match(text,/## Cohort `agent`, assistance `person_answers_questions`/);
  assert.match(text,/\| 1 \| high † \| 1 \| m \| browser_only \| `000000000000` \| 2026-10-28T00:00:00.000Z \| billpay_core_10 \| 7 \/ 10 \| 70.0% \| 39.7%–89.2% \|/);
  assert.match(text,/\| reference † \| 1 \| — \|/);
  assert.deepEqual(Object.keys(files(boards)),['billpay_core_10.md','billpay_core_10.json']);
  assert.equal(JSON.parse(files(boards)['billpay_core_10.json']).tables[0].rows[0].agent,'high');
});

test('a released run is ranked on the splits inside it, with full denominators',()=>{
  const held=splits.held_out;
  const {boards}=leaderboard([
    {source:'released.json',results:run({split:'released',name:'full',passing:held.slice(0,5)})},
    {source:'held.json',results:run({split:'held_out',name:'held-only',passing:held.slice(0,10)})},
  ],{commitTasks});
  assert.deepEqual(Object.keys(boards),['released','billpay_core_10','held_out']);
  assert.deepEqual(boards.held_out[0].rows.map(row=>[row.agent,row.runSplit,row.passed,row.total]),[['held-only','held_out',10,held.length],['full','released',5,held.length]]);
  assert.deepEqual(boards.released[0].rows.map(row=>[row.agent,row.total]),[['full',splits.released.length]]);
  assert.deepEqual(boards.billpay_core_10[0].rows.map(row=>[row.agent,row.passed,row.total]),[['full',0,10]]);
  // A partial run keeps the whole split in the denominator.
  const partial=leaderboard([{source:'p.json',results:run({split:'held_out',ids:held.slice(0,3),passing:held.slice(0,3)})}],{commitTasks});
  assert.deepEqual([partial.boards.held_out[0].rows[0].passed,partial.boards.held_out[0].rows[0].total,partial.boards.held_out[0].rows[0].missing],[3,held.length,held.length-3]);
});

test('the leaderboard rejects what score.mjs rejects, and duplicate runs',()=>{
  const bad=run();bad.trials[0].taskVersion=99;
  const outside=run({split:'held_out',ids:['task_m1']});
  const {errors,boards}=leaderboard([
    {source:'bad.json',results:bad},{source:'outside.json',results:outside},{source:'extra.json',results:{...run(),extra:1}},
    {source:'one.json',results:run()},{source:'again.json',results:run()},
  ],{commitTasks});
  assert.deepEqual(boards,{});
  assert.ok(errors.some(error=>/^bad\.json: .*taskVersion 99/.test(error)));
  assert.ok(errors.some(error=>/^outside\.json: .*not in split held_out/.test(error)));
  assert.ok(errors.some(error=>/^extra\.json: .*unexpected extra/.test(error)));
  assert.ok(errors.some(error=>/^again\.json: the same run as one\.json/.test(error)));
});

test('the command line writes a markdown and a JSON board per split, and fails on an invalid file',()=>{
  const dir=mkdtempSync(join(tmpdir(),'billworld-leaderboard-test-'));
  const script=fileURLToPath(new URL('../benchmark/leaderboard.mjs',import.meta.url));
  try{
    writeFileSync(join(dir,'a.json'),JSON.stringify(run({split:'held_out',passing:splits.held_out.slice(0,1)})));
    execFileSync(process.execPath,[script,join(dir,'a.json'),'--out',join(dir,'out')],{stdio:'pipe'});
    assert.deepEqual(readdirSync(join(dir,'out')).sort(),['held_out.json','held_out.md']);
    assert.match(readFileSync(join(dir,'out/held_out.md'),'utf8'),/1 \/ 35/);
    writeFileSync(join(dir,'b.json'),JSON.stringify({...run(),split:'nope'}));
    assert.throws(()=>execFileSync(process.execPath,[script,join(dir,'b.json'),'--out',join(dir,'out2')],{stdio:'pipe'}),/b\.json/);
    assert.throws(()=>readdirSync(join(dir,'out2')));
  }finally{rmSync(dir,{recursive:true,force:true});}
});
