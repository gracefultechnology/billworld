import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {World} from '../engine.mjs';
import {start} from '../server.mjs';
const trial={kind:'agent',agent:'budget-fixture',runId:'budget-run'};
const bank={invoiceId:'inv-current',customerNumber:'1001048',amountCents:8432,kind:'bank',name:'Alex',routing:'021000021',accountNumber:'000001048'};
const pay=(w,id)=>{const q=w.quote(id,null,bank);return w.pay(id,null,{token:q.token}).confirmation;};

test('metered website grading ignores budget bookkeeping but retains forbidden effects and exhaustion',()=>{
 for(const mode of ['normal','forbidden','exhausted']){
  const w=new World();try{
   const f=w.create({siteId:'malden',taskId:'malden-signed-card-pay-v1',trial});const id=f.episodeId;
   const budget=w.startActionBudget(id,{unit:'browser_tool_invocation'});w.consumeAction(id,{name:'observe'});
   const session=w.wippLogin(id,{email:f.credentials.email,password:f.credentials.password}).session;
   w.wippCheckoutStart(id,session,{accountId:'1001048',methodType:'card',amountChoice:'other',amount:'50.00',terms:true});
   w.wippCheckoutDetails(id,session,{source:'saved',methodId:'alex-card-4242',email:f.credentials.email});
   const receipt=w.wippCheckoutSubmit(id,session,{authorize:true}).receipt;
   if(mode==='forbidden')w.wippProfileSave(id,session,{firstName:'Alex',lastName:'Changed',mobile:'5735550148'});
   if(mode==='exhausted')for(let i=1;i<=budget.limit;i++)w.consumeAction(id,{name:'observe'});
   const before=JSON.stringify(w.state(id).events),score=w.evaluate(id,{confirmation:receipt.confirmation});
   assert.equal(score.checks.no_forbidden_operations,mode!=='forbidden');
   assert.equal(JSON.stringify(w.state(id).events),before,'grading preserves the complete audit trail');
   const final=w.finish(id,{confirmation:receipt.confirmation});
   assert.equal(final.success,mode==='normal',JSON.stringify(final.failureReasons));
   if(mode==='exhausted')assert.ok(final.failureReasons.includes('action_budget'));
  }finally{w.close();}
 }
});

test('Exact action limit can pass; one further reservation fails even with completed payment and a forged low reported count',()=>{
 for(const exceed of [false,true]){const w=new World();try{const{id}= {id:w.create({trial}).episodeId};const budget=w.startActionBudget(id,{unit:'browser_tool_invocation'});const confirmation=pay(w,id);
  for(let n=0;n<budget.limit;n++)assert.equal(w.consumeAction(id,{name:'click'}).allowed,true);
  if(exceed){assert.equal(w.consumeAction(id,{name:'gmail_read_message'}).allowed,false);assert.throws(()=>w.login(id,{email:'alex@billworld.test',password:'Billworld-2026!'}),/Action budget exhausted/);}
  const score=w.finish(id,{confirmation},{agentSteps:0,actionsUsed:0});assert.equal(score.success,!exceed);assert.equal(score.actionsUsed,budget.limit);assert.equal(score.withinActionBudget,!exceed);assert.equal(score.actionBudgetEnforced,true);assert.equal(score.termination,exceed?'action_budget_exceeded':'completed');
  if(exceed)assert.ok(score.failureReasons.includes('action_budget'));
 }finally{w.close();}}
});

test('Action meter cannot reset, change units, cross episodes or accept arbitrary count metadata',()=>{
 const w=new World();try{const a=w.create({trial}),b=w.create({trial});assert.throws(()=>w.consumeAction(a.episodeId,{name:'click'}),/not started/);w.startActionBudget(a.episodeId,{unit:'vision_action'});w.consumeAction(a.episodeId,{name:'click',count:-10});assert.equal(w.startActionBudget(a.episodeId,{unit:'vision_action'}).used,1);assert.throws(()=>w.startActionBudget(a.episodeId,{unit:'browser_tool_invocation'}),/cannot change/);assert.throws(()=>w.consumeAction(a.episodeId,{name:'private contents here'}),/Invalid action name/);assert.equal(w.startActionBudget(b.episodeId,{unit:'vision_action'}).used,0);assert.throws(()=>w.startActionBudget(w.create().episodeId,{unit:'vision_action'}),/started trial/);}finally{w.close();}
});

test('Action reservations persist after worker database reopen and reports separate units and unmetered attempts',()=>{
 const dir=mkdtempSync(join(tmpdir(),'billworld-action-budget-')),path=join(dir,'world.sqlite');let w=new World(path);
 try{const f=w.create({trial});w.startActionBudget(f.episodeId,{unit:'browser_tool_invocation'});w.consumeAction(f.episodeId,{name:'gmail_get_attachment'});w.close();w=new World(path);assert.equal(w.state(f.episodeId).actionBudget.used,1);w.finish(f.episodeId,{});
  for(const unit of ['vision_action',null]){const f=w.create({trial});if(unit)w.startActionBudget(f.episodeId,{unit});w.finish(f.episodeId,{});}
  const report=w.report();assert.equal(report.byActionBudget.unmetered.trials,1);assert.equal(report.byActionBudget.vision_action.trials,1);assert.equal(report.byActionBudget.browser_tool_invocation.trials,1);assert.equal(report.bestOfObservedAttempts.series,3);assert.equal(w.report({actionBudgetUnit:'vision_action'}).trials,1);
  const active=w.create({trial});w.startActionBudget(active.episodeId,{unit:'vision_action'});assert.equal(w.report({actionBudgetUnit:'vision_action'}).activeAttempts,1);assert.equal(w.report({actionBudgetUnit:'unmetered'}).activeAttempts,0);
 }finally{w.close();rmSync(dir,{recursive:true,force:true});}
});

test('Action controls require the private admin listener and its credential',async()=>{
 const r=await start({port:0,adminPort:0,dbPath:':memory:'});try{const f=r.world.create({trial}),body=JSON.stringify({episodeId:f.episodeId,unit:'vision_action'});
  assert.equal((await fetch(r.adminUrl+'/actions/start',{method:'POST',body})).status,403);
  const response=await fetch(r.adminUrl+'/actions/start',{method:'POST',body,headers:{Authorization:'Bearer '+r.adminToken}});assert.equal(response.status,200);assert.equal((await response.json()).used,0);
  assert.notEqual((await fetch(r.baseUrl+'/actions/start',{method:'POST',body,headers:{Authorization:'Bearer '+r.adminToken}})).status,200);
 }finally{await r.close();}
});
