import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {run,parseOutcome} from '../benchmark/run.mjs';
import {score,validate,wilson,schema} from '../benchmark/score.mjs';

const released=JSON.parse(readFileSync(new URL('../benchmark/data/splits.json',import.meta.url),'utf8')).released;
const manifest=JSON.parse(readFileSync(new URL('../tasks/juneau-pay.json',import.meta.url),'utf8'));

test('the runner gives a scripted agent only public inputs and records a schema-valid trial',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'billworld-run-test-'));
  try{
    // The fake agent saves its stdin, spends one metered action and reports nothing.
    const capture=join(dir,'stdin.json'),agentScript=join(dir,'agent.mjs');
    writeFileSync(agentScript,`import {writeFileSync} from 'node:fs';
let raw='';process.stdin.on('data',chunk=>raw+=chunk);process.stdin.on('end',async()=>{
  writeFileSync(process.argv[2],raw);const input=JSON.parse(raw);
  const malformed=await (await fetch(input.meterUrl,{method:'POST',body:JSON.stringify({name:'click button'})})).json();
  const meter=await (await fetch(input.meterUrl,{method:'POST',body:JSON.stringify({name:'navigate'})})).json();
  writeFileSync(process.argv[2]+'.meter',JSON.stringify({malformed,meter,env:Object.keys(process.env)}));console.log('{}');});`);
    const adminToken='test-admin-token-'+'x'.repeat(24);
    const {results,path}=await run({split:'billpay_core_10',only:['task_m1'],out:join(dir,'out'),dbPath:':memory:',adminToken,agent:'scripted-none',
      agentCmd:`${JSON.stringify(process.execPath)} ${JSON.stringify(agentScript)} ${JSON.stringify(capture)}`,log:()=>{}});
    assert.deepEqual(validate(schema,JSON.parse(readFileSync(path,'utf8'))),[]);
    assert.equal(results.trials.length,1);
    const [trial]=results.trials;
    assert.equal(trial.referenceId,'task_m1');assert.equal(trial.seed,released.indexOf('task_m1')+1);assert.equal(trial.attempt,1);assert.equal(trial.taskVersion,1);
    assert.equal(trial.termination,'completed');assert.equal(trial.success,false);assert.equal(trial.agentActions,1);
    const stdin=readFileSync(capture,'utf8'),input=JSON.parse(stdin);
    assert.deepEqual(Object.keys(input).sort(),['budget','meterUrl','outcomeFields','persona','prompt','startUrl']);
    assert.deepEqual(input.outcomeFields,['confirmation']);
    assert.ok(!stdin.includes(adminToken),'admin token reached the agent');
    for(const secret of ['"goal"','"task"','entryToken','connectorToken','adminUrl',JSON.stringify(manifest.goal)])assert.ok(!stdin.includes(secret),secret);
    assert.deepEqual(Object.keys(input.persona),['credentials']);
    const {malformed,meter,env}=JSON.parse(readFileSync(capture+'.meter','utf8'));
    // A malformed name is an error, not the budget's end, and spends nothing.
    assert.ok(malformed.error&&!Object.hasOwn(malformed,'allowed'));
    assert.deepEqual([meter.allowed,meter.used,meter.limit],[true,1,100]);
    assert.ok(!env.some(key=>key.startsWith('BILLWORLD_')));
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('an agent that exits with an error or no outcome is recorded as agent_error',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'billworld-run-test-'));
  try{
    const {results}=await run({split:'billpay_core_10',only:['task_m3'],out:join(dir,'out'),dbPath:':memory:',log:()=>{},
      agentCmd:`${JSON.stringify(process.execPath)} -e "process.exit(3)"`});
    assert.equal(results.trials[0].termination,'agent_error');assert.equal(results.trials[0].success,false);assert.equal(results.trials[0].seed,released.indexOf('task_m3')+1);
  }finally{rmSync(dir,{recursive:true,force:true});}
  assert.deepEqual(parseOutcome('log line\n{"confirmation":"BW-1","goal":"x"}\n',['confirmation']),{confirmation:'BW-1'});
  assert.equal(parseOutcome('not json',['confirmation']),null);
  // A pretty-printed final object wins over an earlier log line; a trailing scalar does not hide the object.
  assert.deepEqual(parseOutcome('{"progress":1}\n{\n  "confirmation": "BW-1"\n}',['confirmation']),{confirmation:'BW-1'});
  assert.deepEqual(parseOutcome('{"confirmation":"BW-1"}\n42',['confirmation']),{confirmation:'BW-1'});
  assert.equal(parseOutcome('42\ntrue',['confirmation']),null);
  // Values of the wrong type are dropped, never passed to a grader that calls .trim() on them.
  assert.deepEqual(parseOutcome('{"confirmation":null,"billingDate":123,"postedBalanceCents":1.5,"remainingBalanceCents":0}',
    ['confirmation','billingDate','postedBalanceCents','remainingBalanceCents']),{remainingBalanceCents:0});
});

test('a wrongly typed outcome field finishes the episode instead of failing it as an environment error',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'billworld-run-test-'));
  try{
    const {results}=await run({split:'released',only:['task_h2'],out:join(dir,'out'),dbPath:':memory:',log:()=>{},
      agentCmd:`${JSON.stringify(process.execPath)} -e "console.log(JSON.stringify({billingDate:123}))"`});
    assert.equal(results.trials[0].termination,'completed');assert.equal(results.trials[0].success,false);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('the runner settles when the agent exits, reaps what it left running and keeps the stdout tail',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'billworld-run-test-'));
  try{
    // The background sleep holds stdout open; 'close' would wait for it, and the run would time out.
    const pidFile=join(dir,'bg.pid'),started=Date.now();
    const {results}=await run({split:'billpay_core_10',only:['task_m1'],out:join(dir,'out'),dbPath:':memory:',log:()=>{},
      agentCmd:`sleep 30 & echo $! > ${JSON.stringify(pidFile)}; ${JSON.stringify(process.execPath)} -e "process.stdout.write('x'.repeat(1.5*2**20)+'\\n{}\\n')"`});
    assert.equal(results.trials[0].termination,'completed');assert.ok(Date.now()-started<20000);
    const pid=Number(readFileSync(pidFile,'utf8'));
    assert.throws(()=>process.kill(pid,0),'the background process outlived the trial');
  }finally{rmSync(dir,{recursive:true,force:true});}
});

const results=trials=>({billworldCommit:'0'.repeat(40),split:'billpay_core_10',cohort:'agent',agent:{name:'a',version:'1',model:null},
  assistance:'none',runAt:'2026-10-28T00:00:00.000Z',trials});
const trial=(referenceId,taskId,seed,success,extra={})=>({referenceId,taskId,seed,taskVersion:1,environmentRevision:'0.50.0',attempt:1,success,termination:'completed',...extra});

test('score counts split tasks without a trial as failures and checks task versions',()=>{
  const report=score(results([trial('task_m1','juneau-pay-current-no-fee-v1',1,true)]),undefined,{commitTasks:()=>null});
  assert.deepEqual(report.errors,[]);
  const core=report.splits.billpay_core_10;
  assert.deepEqual([core.passed,core.total,core.missing,core.rate],[1,10,9,0.1]);
  assert.ok(core.low>0&&core.low<0.1&&core.high>0.1&&core.high<0.5);
  assert.deepEqual(Object.keys(report.categories),['payment']);
  assert.ok(report.warnings.some(warning=>/not in this checkout/.test(warning)));
  assert.match(score(results([trial('task_m1','juneau-pay-current-no-fee-v1',1,true,{taskVersion:2})]),undefined,{commitTasks:()=>null}).errors[0],/taskVersion 2/);
  assert.match(score(results([trial('task_m2','juneau-enable-autopay-v1',2,true)]),undefined,{commitTasks:()=>null}).errors[0],/not in split/);
  assert.ok(score({...results([]),extra:1}).errors.some(error=>/unexpected extra/.test(error)));
  const [low,high]=wilson(0,10);assert.equal(low,0);assert.ok(Math.abs(high-0.2775)<0.001);
});

test('the runner and scorer take the held-out split',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'billworld-run-test-'));
  try{
    const {results}=await run({split:'held_out',only:['task_m2'],out:join(dir,'out'),dbPath:':memory:',log:()=>{},
      agentCmd:`${JSON.stringify(process.execPath)} -e "console.log('{}')"`});
    assert.equal(results.split,'held_out');assert.equal(results.trials[0].seed,released.indexOf('task_m2')+1);assert.equal(results.trials[0].success,false);
    const report=score(results,undefined,{commitTasks:()=>null});
    assert.deepEqual(report.errors,[]);
    assert.deepEqual(Object.keys(report.splits),['held_out']);
    assert.deepEqual([report.splits.held_out.passed,report.splits.held_out.total,report.splits.held_out.missing],[0,35,34]);
  }finally{rmSync(dir,{recursive:true,force:true});}
  // A core task is not in the held-out split, and a released run is scored on both.
  assert.match(score({...results([trial('task_m1','juneau-pay-current-no-fee-v1',1,true)]),split:'held_out'},undefined,{commitTasks:()=>null}).errors[0],/not in split held_out/);
  const all=score({...results([trial('task_m1','juneau-pay-current-no-fee-v1',1,true)]),split:'released'},undefined,{commitTasks:()=>null});
  assert.deepEqual(Object.keys(all.splits),['released','billpay_core_10','held_out']);
});
