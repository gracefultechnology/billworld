import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {finalizeInstalledEpisode} from '../integration/finalize-installed-episode.mjs';
async function fixture(run){
 const directory=await mkdtemp(join(tmpdir(),'billworld-finalize-'));const calls=[];
 const report={termination:'completed',phase:'closed',completed:true,buildUnchanged:true,episodeId:'e',runId:'r',environmentBuildId:'env',evaluatorBuildId:'eval',cleanupErrors:[],finished:{runId:'r',environmentBuildId:'env',evaluatorBuildId:'eval',success:true,actionBudgetEnforced:true,withinActionBudget:true,withinTimeBudget:true}};
 const episode={reportPath:join(directory,'report.json'),agentInputs:{episodeId:'e',runId:'r'},grade:async()=>{calls.push('grade');return {grade:{success:true}};},finish:async(_,metadata)=>{calls.push('finish:'+metadata.termination);return {success:true};},close:async({reason})=>{calls.push('close:'+reason);await writeFile(episode.reportPath,JSON.stringify(report));}};
 const input={episode,meter:{close:async()=>{calls.push('meter');}},trust:{close:async()=>{calls.push('trust');}},termination:'completed'};
 try{await run({input,calls,report});}finally{await rm(directory,{recursive:true,force:true});}
}
test('acceptance comes from matching final report after independent cleanup',()=>fixture(async({input,calls})=>{const r=await finalizeInstalledEpisode(input);assert.equal(r.accepted,true);assert.deepEqual(calls,['meter','trust','grade','finish:completed','close:completed']);}));
test('each cleanup failure still attempts all later finalization stages',async()=>{
 for(const stage of ['meter','trust'])await fixture(async({input,calls})=>{input[stage].close=async()=>{calls.push(stage);throw Error('injected');};const r=await finalizeInstalledEpisode(input);assert.equal(r.accepted,false);assert.deepEqual(calls,['meter','trust','grade','finish:environment_error','close:environment_error']);assert.equal(r.errors.length,1);});
});
test('grade and finish failures cannot skip close',async()=>{
 for(const stage of ['grade','finish'])await fixture(async({input,calls})=>{input.episode[stage]=async()=>{calls.push(stage);throw Error('injected');};const r=await finalizeInstalledEpisode(input);assert.equal(r.accepted,false);assert.ok(calls.includes('close:environment_error'));});
});
test('close rejection, changed provenance and identity mismatch reject successful finish',async()=>{
 for(const change of [r=>r.completed=false,r=>r.buildUnchanged=false,r=>r.episodeId='other',r=>r.finished.withinActionBudget=false])await fixture(async({input,report})=>{change(report);assert.equal((await finalizeInstalledEpisode(input)).accepted,false);});
 await fixture(async({input})=>{input.episode.close=async()=>{throw Error('cleanup failure');};const r=await finalizeInstalledEpisode(input);assert.equal(r.accepted,false);assert.deepEqual(r.errors.map(e=>e.stage),['close','readFinalReport']);});
});

test('real HTTPS trial is cancelled and listeners close even when device cleanup fails',async()=>{
 const {startHttpsEpisode}=await import('../integration/https-episode-host.mjs');
 const directory=await mkdtemp(join(tmpdir(),'billworld-finalize-real-'));let episode;
 try{
  episode=await startHttpsEpisode({outputRoot:directory,trial:{kind:'grader_validation',agent:'finalizer-regression'}});
  await episode.startActionBudget({unit:'vision_action'});
  const r=await finalizeInstalledEpisode({episode,trust:{close:async()=>{throw Error('device cleanup injected');}},termination:'completed'});
  assert.equal(r.accepted,false);assert.equal(r.report.phase,'closed');assert.equal(r.report.completed,false);assert.equal(r.report.finished.termination,'environment_error');
  assert.deepEqual(r.errors.map(e=>e.stage),['deviceTrust']);
  await assert.rejects(episode.reserveAction({name:'click'}),/closed/);
 }finally{await episode?.close();await rm(directory,{recursive:true,force:true});}
});


test('later interruption cannot reuse an earlier accepted terminal report',async()=>{
 for(const termination of ['interrupted','cancelled','agent_error','environment_error'])await fixture(async({input})=>{input.termination=termination;assert.equal((await finalizeInstalledEpisode(input)).accepted,false);});
});
test('missing identity or unsuccessful current grade cannot qualify a retained report',async()=>{
 await fixture(async({input,report})=>{delete input.episode.agentInputs.runId;delete report.runId;delete report.finished.runId;assert.equal((await finalizeInstalledEpisode(input)).accepted,false);});
 await fixture(async({input})=>{input.episode.grade=async()=>({grade:{success:false}});assert.equal((await finalizeInstalledEpisode(input)).accepted,false);});
});

test('non-Error cleanup rejections cannot skip later cleanup or close',async()=>{
 for(const rejection of [null,undefined,'rejected'])await fixture(async({input,calls})=>{
  input.meter.close=async()=>{calls.push('meter');throw rejection;};
  const result=await finalizeInstalledEpisode(input);
  assert.equal(result.accepted,false);assert.deepEqual(calls,['meter','trust','grade','finish:environment_error','close:environment_error']);
  assert.equal(result.errors[0].stage,'meter');
 });
});
