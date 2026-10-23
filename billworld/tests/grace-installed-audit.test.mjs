import test from 'node:test';
import assert from 'node:assert/strict';
import {assessInstalledEvidence} from '../integration/audit-grace-installed.mjs';
const fixture=()=>({variant:'standalone',report:{phase:'closed',completed:true,buildUnchanged:true,cleanupErrors:[],episodeId:'e',runId:'r',environmentBuildId:'env',evaluatorBuildId:'eval',finished:{kind:'agent',success:true,termination:'completed',actionBudgetEnforced:true,withinTimeBudget:true,withinActionBudget:true,runId:'r',environmentBuildId:'env',evaluatorBuildId:'eval'},observations:[{grade:{success:true,checks:{exactly_one_payment:true}},paymentCount:1,confirmationMatchesPayment:true,reportedConfirmation:'receipt'}]},agent:{passed:true,packagedRuntime:true,liveInference:true,controlledWebsite:true,episodeId:'e',outcome:{confirmation:'receipt'}},verification:{cleaned:true,homeUnchanged:true,cleanupDeferred:false,cleanupErrors:[],variants:[{variant:'standalone',billworldGradePassed:true,appSha256:'a'.repeat(64),testSha256:'b'.repeat(64)}]}});
test('consistent evidence is only a review candidate',()=>assert.equal(assessInstalledEvidence(fixture()).candidateForReview,true));
test('passing intermediate finish cannot override rejected close',()=>{const f=fixture();f.report.completed=false;assert.equal(assessInstalledEvidence(f).candidateForReview,false);});
test('mismatched receipt, episode, budgets, cleanup and missing evidence fail closed',()=>{
 for(const mutate of [f=>f.agent.outcome.confirmation='other',f=>f.agent.episodeId='other',f=>f.report.finished.withinActionBudget=false,f=>f.verification.cleanupErrors=['failed'],f=>delete f.report,f=>delete f.verification,f=>f.report.finished.runId='other']){const f=fixture();mutate(f);assert.equal(assessInstalledEvidence(f).candidateForReview,false);}
});
test('triage exposes action counts without raw arguments or credentials',()=>{const f=fixture();f.agent.calls=[{method:'controlPage',action:'guide',password:'do-not-output'},{method:'controlPage',action:'snapshot'}];const r=assessInstalledEvidence(f);assert.deepEqual(r.actionCounts,{guide:1,snapshot:1});assert.ok(!JSON.stringify(r).includes('do-not-output'));});

test('controlledWebsite is a fixture declaration, not proof of agent action',()=>{const f=fixture();f.agent.controlledWebsite=false;assert.equal(assessInstalledEvidence(f).candidateForReview,true);});

test('native diagnostics distinguish successful validation from failed follow and cleanup',()=>{
 const f=fixture();f.agent.calls=[
  {action:'follow',completed:true,durationMs:7},
  {action:'follow',completed:false,durationMs:24,errorCode:'UNCERTAIN_OUTCOME'},
  {action:'guide',completed:true,durationMs:18},
  {action:'guide',completed:true,durationMs:6},
 ];
 const result=assessInstalledEvidence(f);
 assert.equal(result.nativeCalls.invocations,4);
 assert.equal(result.nativeCalls.completed,3);
 assert.equal(result.nativeCalls.failed,1);
 assert.equal(result.nativeCalls.unreported,0);
 assert.deepEqual(result.nativeCalls.failures,[{index:1,action:'follow',errorCode:'UNCERTAIN_OUTCOME',durationMs:24}]);
 assert.match(result.nativeCalls.scope,/completion does not establish/);
 // Diagnostics cannot override authoritative terminal state in either direction.
 assert.equal(result.candidateForReview,true);
 f.report.completed=false;
 assert.equal(assessInstalledEvidence(f).candidateForReview,false);
});
test('legacy and incomplete native calls remain unreported',()=>{
 const f=fixture();f.agent.calls=[{action:'follow'},{action:'snapshot',completed:'true'}];
 const d=assessInstalledEvidence(f).nativeCalls;
 assert.equal(d.completed,0);assert.equal(d.failed,0);assert.equal(d.unreported,2);
 assert.deepEqual(d.failures,[]);
});
test('failure diagnostics whitelist codes and omit raw errors and arguments',()=>{
 const f=fixture();f.agent.calls=[{action:'follow',completed:false,errorCode:'SECRET_ERROR',error:'SECRET_MESSAGE',args:{password:'SECRET_PASSWORD'},durationMs:-1}];
 const d=assessInstalledEvidence(f).nativeCalls;
 assert.deepEqual(d.failures,[{index:0,action:'follow',errorCode:'OTHER',durationMs:null}]);
 assert.ok(!JSON.stringify(d).includes('SECRET'));
});

test('reference scripts cannot qualify as installed agent evidence',()=>{for(const kind of ['reference_script','grader_validation',undefined]){const f=fixture();f.report.finished.kind=kind;assert.equal(assessInstalledEvidence(f).candidateForReview,false);}});

test('legacy successful evidence has unknown assistance, never autonomous success',()=>{
 const result=assessInstalledEvidence(fixture());
 assert.equal(result.candidateForReview,true);
 assert.equal(result.assistance.classification,'unreported');
 assert.equal(result.autonomousCandidateForReview,false);
 assert.equal(result.assistedCandidateForReview,false);
});
test('only complete episode-bound recording distinguishes autonomous and assisted candidates',()=>{
 const f=fixture();f.agent.assistance={version:1,episodeId:'e',recordingComplete:true,actions:[]};
 assert.equal(assessInstalledEvidence(f).autonomousCandidateForReview,true);
 f.agent.assistance.actions=[{actor:'simulated_person',kind:'protected_entry',value:'SECRET_BANK_NUMBER'},{actor:'person',kind:'payment_submit'}];
 const result=assessInstalledEvidence(f);
 assert.equal(result.autonomousCandidateForReview,false);
 assert.equal(result.assistedCandidateForReview,true);
 assert.deepEqual(result.assistance,{classification:'assisted',handoffCount:2,actorCounts:{person:1,simulated_person:1},kindCounts:{payment_submit:1,protected_entry:1}});
 assert.ok(!JSON.stringify(result).includes('SECRET_BANK_NUMBER'));
 f.report.completed=false;
 assert.equal(assessInstalledEvidence(f).assistedCandidateForReview,false);
});
test('incomplete, foreign-episode or malformed assistance cannot qualify either score',()=>{
 for(const change of [a=>a.recordingComplete=false,a=>delete a.recordingComplete,a=>a.episodeId='other',a=>a.actions=null,a=>a.actions=[null],a=>a.actions=[{actor:'agent',kind:'navigation'}],a=>a.actions=[{actor:'person',kind:'secret arbitrary text'}],a=>a.version=2]){
  const f=fixture();f.agent.assistance={version:1,episodeId:'e',recordingComplete:true,actions:[]};change(f.agent.assistance);
  const result=assessInstalledEvidence(f);
  assert.equal(result.assistance.classification,'unreported');
  assert.equal(result.autonomousCandidateForReview,false);
  assert.equal(result.assistedCandidateForReview,false);
 }
});
