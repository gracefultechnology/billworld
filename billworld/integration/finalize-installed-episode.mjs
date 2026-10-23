import {readFile} from 'node:fs/promises';

// Supervisor-only. Cleanup attempts are independent: failure to remove device
// trust must never leave the simulator listening or its trial unsealed.
export async function finalizeInstalledEpisode({episode,meter,trust,outcome={},termination='interrupted'}){
 const errors=[];
 const attempt=async(stage,operation)=>{try{return await operation();}catch(error){errors.push({stage,message:error.message});return null;}};
 await attempt('meter',()=>meter?.close());
 await attempt('deviceTrust',()=>trust?.close());
 if(!episode)return {accepted:false,errors,report:null,observed:null,finished:null};
 const reportPath=episode.reportPath;
 let reason=errors.length?'environment_error':termination;
 const observed=await attempt('grade',()=>episode.grade(outcome));
 if(errors.length)reason='environment_error';
 const finished=await attempt('finish',()=>episode.finish(outcome,{termination:reason==='interrupted'?'cancelled':reason}));
 if(errors.length)reason='environment_error';
 await attempt('close',()=>episode.close({reason}));
 const report=await attempt('readFinalReport',async()=>JSON.parse(await readFile(reportPath,'utf8')));
 const identity=episode.agentInputs;
 const nonempty=value=>typeof value==='string'&&value.length>0;
 const matches=Boolean(identity&&report&&[identity.episodeId,identity.runId,report.environmentBuildId,report.evaluatorBuildId].every(nonempty)&&report.episodeId===identity.episodeId&&report.runId===identity.runId&&report.finished?.runId===identity.runId&&report.finished?.environmentBuildId===report.environmentBuildId&&report.finished?.evaluatorBuildId===report.evaluatorBuildId);
 const accepted=termination==='completed'&&errors.length===0&&matches&&observed?.grade?.success===true&&finished?.success===true&&report.termination==='completed'&&report.phase==='closed'&&report.completed===true&&report.buildUnchanged===true&&report.finished?.success===true&&report.finished?.actionBudgetEnforced===true&&report.finished?.withinActionBudget===true&&report.finished?.withinTimeBudget===true&&Array.isArray(report.cleanupErrors)&&report.cleanupErrors.length===0;
 return {accepted,errors,reportPath,report,observed,finished};
}
