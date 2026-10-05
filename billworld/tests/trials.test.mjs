import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { World } from '../engine.mjs';
import { start } from '../server.mjs';
const metadata={kind:'agent',agent:'trial-fixture',runId:'repeat-1',model:'fixture-model',scaffold:'scripted-test',accessMode:'browser_only',attemptNumber:2};
const bank={invoiceId:'inv-current',customerNumber:'1001048',amountCents:8432,kind:'bank',name:'Alex',routing:'021000021',accountNumber:'000001048'};
test('started trial is visible before completion and declared metadata cannot be reclassified',()=>{
 const w=new World(),f=w.create({trial:metadata});const r=w.report();assert.equal(r.attemptsStarted,1);assert.equal(r.activeAttempts,1);assert.equal(r.trials,0);assert.equal(r.successRate,null);assert.equal(r.terminalFraction,0);
 assert.throws(()=>w.finish(f.episodeId,{}, {...metadata,kind:'reference_script'}),/immutable/);
 const score=w.finish(f.episodeId,{}, {termination:'agent_error',agentSteps:4,agentElapsedMilliseconds:1200});assert.equal(score.runId,'repeat-1');assert.equal(score.attemptNumber,2);assert.equal(score.model,'fixture-model');assert.equal(score.agentSteps,4);assert.equal(score.termination,'agent_error');assert.equal(w.report().activeAttempts,0);assert.equal(w.report().byTermination.agent_error,1);w.close();
});
test('runner crash remains a failure even when billing predicates and reported answer are correct',()=>{
 const w=new World(),f=w.create({trial:metadata});const q=w.quote(f.episodeId,null,bank),p=w.pay(f.episodeId,null,{token:q.token});
 const score=w.finish(f.episodeId,{confirmation:p.confirmation},{termination:'agent_error'});assert.ok(Object.values(score.checks).every(Boolean));assert.equal(score.success,false);assert.deepEqual(score.failureReasons,['agent_error']);assert.throws(()=>w.autopay(f.episodeId,null,{enabled:false}),/finished/);w.close();
});
test('expired trial seals on the next mutation and rejects any late payment',()=>{
 const w=new World(),f=w.create({trial:metadata});const q=w.quote(f.episodeId,null,bank);
 w.transact(f.episodeId,s=>{s.createdAt=Date.now()-301000;s.trial.deadlineAt=Date.now()-1000;});
 assert.throws(()=>w.pay(f.episodeId,null,{token:q.token}),/finished/);const s=w.state(f.episodeId);assert.equal(s.finished.termination,'timeout');assert.equal(s.finished.withinTimeBudget,false);assert.equal(s.payments.filter(p=>!p.initial).length,0);assert.equal(w.report().failureReasons.timeout,1);assert.equal(w.report().terminalFraction,1);w.close();
});
test('pending trials survive a database reopen and recovery seals only declared attempts',()=>{
 const dir=mkdtempSync(join(tmpdir(),'billworld-trial-')),db=join(dir,'world.sqlite');let w=new World(db);const f=w.create({trial:metadata}),demo=w.create();w.close();w=new World(db);
 assert.equal(w.report().activeAttempts,1);const sealed=w.sealActiveTrials();assert.equal(sealed.length,1);assert.equal(sealed[0].episodeId,f.episodeId);assert.equal(sealed[0].termination,'environment_error');assert.equal(w.state(demo.episodeId).finished,undefined);assert.equal(w.sealActiveTrials().length,0);assert.equal(w.report().byTermination.environment_error,1);w.close();rmSync(dir,{recursive:true,force:true});
});
test('deadline monitor finalizes an idle expired attempt without browser activity',async()=>{
 const server=await start({port:0,adminPort:0,dbPath:':memory:'});try{const f=server.world.create({trial:metadata});server.world.transact(f.episodeId,s=>{s.createdAt=Date.now()-301000;s.trial.deadlineAt=Date.now()-1000;});
  await new Promise(resolve=>setTimeout(resolve,1200));assert.equal(server.world.state(f.episodeId).finished.termination,'timeout');assert.equal(server.world.report().activeAttempts,0);
 }finally{await server.close();}
});
test('reports separate terminations, family aggregates and empty cohorts without dropping failures',()=>{
 const w=new World();for(const [siteId,termination]of [['juneau-utilities','agent_error'],['homer-utilities','timeout'],['spotify','environment_error']]){const f=w.create({siteId,trial:metadata});w.finish(f.episodeId,{}, {termination});}
 const r=w.report();assert.equal(r.trials,3);assert.equal(r.attemptsStarted,3);assert.equal(r.successRate,0);assert.equal(r.byTermination.environment_error,1);assert.equal(r.familyMacroSuccessRate,0);assert.equal(Object.keys(r.byFamily).length,3);assert.equal(w.report({agent:'other'}).successRate,null);assert.throws(()=>w.create({trial:{...metadata,attemptNumber:0}}),/attempt number/);w.close();
});
test('first-attempt success and best-of-observed retries use distinct denominators',()=>{
 const w=new World();const first=w.create({trial:{...metadata,attemptNumber:1}});w.finish(first.episodeId,{}, {termination:'agent_error'});
 const retry=w.create({trial:{...metadata,attemptNumber:2}}),q=w.quote(retry.episodeId,null,bank),p=w.pay(retry.episodeId,null,{token:q.token});w.finish(retry.episodeId,{confirmation:p.confirmation},{});
 const r=w.report();assert.equal(r.successRate,.5);assert.equal(r.firstAttempt.trials,1);assert.equal(r.firstAttempt.successRate,0);assert.equal(r.bestOfObservedAttempts.series,1);assert.equal(r.bestOfObservedAttempts.successRate,1);assert.deepEqual(r.bestOfObservedAttempts.attemptsPerSeries,{'2':1});assert.equal(r.bestOfObservedAttempts.seriesMissingFirstAttempt,0);w.close();
});
