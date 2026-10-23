// Read-only evidence triage. Passing these checks is a candidate for review,
// never independent proof of runtime authenticity or complete catalog coverage.
import {readFile,readdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const counts=(items,key)=>Object.fromEntries([...new Set(items.map(x=>x[key]).filter(x=>typeof x==='string'))].sort().map(k=>[k,items.filter(x=>x[key]===k).length]));
export function assessInstalledEvidence({report,agent,verification,variant}){
 const final=report?.finished,observation=report?.observations?.at(-1),record=verification?.variants?.find(x=>x.variant===variant);
 const checks={
  finalClosed:report?.phase==='closed', finalAccepted:report?.completed===true,
  provenanceUnchanged:report?.buildUnchanged===true,
  hostCleanup:Array.isArray(report?.cleanupErrors)&&report.cleanupErrors.length===0,
  authoritativeFinish:final?.success===true&&final?.termination==='completed',
  budgets:final?.actionBudgetEnforced===true&&final?.withinTimeBudget===true&&final?.withinActionBudget===true,
  episodeBinding:typeof report?.episodeId==='string'&&report.episodeId===agent?.episodeId,
  runBinding:typeof report?.runId==='string'&&report.runId===final?.runId,
  buildBinding:typeof report?.environmentBuildId==='string'&&report.environmentBuildId===final?.environmentBuildId&&typeof report?.evaluatorBuildId==='string'&&report.evaluatorBuildId===final?.evaluatorBuildId,
  agentCompleted:agent?.passed===true, packagedRuntime:agent?.packagedRuntime===true,
  liveInference:agent?.liveInference===true,
  finalGrade:observation?.grade?.success===true,
  deviceCleanup:verification?.cleaned===true&&verification?.homeUnchanged===true&&verification?.cleanupDeferred===false&&Array.isArray(verification?.cleanupErrors)&&verification.cleanupErrors.length===0,
  instrumentation:!verification?.failure&&record?.billworldGradePassed===true,
  apkIdentity:/^[a-f0-9]{64}$/.test(record?.appSha256??'')&&/^[a-f0-9]{64}$/.test(record?.testSha256??''),
 };
 // Payment tasks are recognized from their private evaluator, not task naming.
 if(Object.hasOwn(observation?.grade?.checks??{},'exactly_one_payment'))checks.paymentReceipt=observation?.paymentCount===1&&observation?.confirmationMatchesPayment===true&&typeof agent?.outcome?.confirmation==='string'&&agent.outcome.confirmation===observation?.reportedConfirmation;
 const calls=Array.isArray(agent?.calls)?agent.calls:[],events=agent?.events?.events??[];
 return {declaredControlledWebsite:agent?.controlledWebsite??null,candidateForReview:Object.values(checks).every(Boolean),checks,failedChecks:Object.keys(checks).filter(k=>!checks[k]),termination:report?.termination??null,paymentCount:observation?.paymentCount??null,actionsUsed:final?.actionsUsed??null,methodCounts:counts(calls,'method'),actionCounts:counts(calls,'action'),eventKinds:counts(events,'kind'),scope:'Retained evidence consistency only; not independent installed-agent certification'};
}
export async function auditInstalledDirectory(directory){
 const inputs=[];const read=async file=>{try{const bytes=await readFile(file);inputs.push({file,sha256:createHash('sha256').update(bytes).digest('hex')});return JSON.parse(bytes);}catch(error){if(error.code==='ENOENT')return null;throw error;}};
 const verification=await read(join(directory,'verification.json')),results=[];
 for(const name of (await readdir(directory)).filter(n=>n.endsWith('-episodes')).sort()){
  const variant=name.slice(0,-9),agent=await read(join(directory,variant+'-agent.json'));
  for(const run of (await readdir(join(directory,name))).sort()){
   const report=await read(join(directory,name,run,'private-report.json'));
   results.push({variant,run,...assessInstalledEvidence({report,agent,verification,variant})});
  }
 }
 return {directory,inputs,results,candidateForReview:results.length>0&&results.every(r=>r.candidateForReview)};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 if(process.argv.length!==3)throw Error('Usage: node billworld/integration/audit-grace-installed.mjs RUN_DIRECTORY');
 const result=await auditInstalledDirectory(resolve(process.argv[2]));console.log(JSON.stringify(result,null,2));if(!result.candidateForReview)process.exitCode=1;
}
