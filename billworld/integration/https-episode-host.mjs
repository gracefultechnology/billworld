import {readFileSync} from 'node:fs';
import {mkdir,mkdtemp,writeFile,rename} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,X509Certificate,randomUUID} from 'node:crypto';
import {start} from '../server.mjs';
import {fingerprint,PROCESS_BUILD} from '../build-fingerprint.mjs';
import {localTlsFixture,TLS_FIXTURE_SOURCE_SHA256} from '../tests/tls-fixture.mjs';
import {passwordLoginFixture} from '../password-login-fixtures.mjs';

const hashFile=url=>createHash('sha256').update(readFileSync(url)).digest('hex');
const ADAPTER_SOURCE_SHA256=hashFile(new URL(import.meta.url));
const sourceChecks=()=>{
 const current=fingerprint();
 return {environmentBuild:current.environmentBuildId===PROCESS_BUILD.environmentBuildId,
  evaluatorBuild:current.evaluatorBuildId===PROCESS_BUILD.evaluatorBuildId,
  adapter:hashFile(new URL(import.meta.url))===ADAPTER_SOURCE_SHA256,
  certificateHelper:hashFile(new URL('../tests/tls-fixture.mjs',import.meta.url))===TLS_FIXTURE_SOURCE_SHA256};
};

// Supervisor-only adapter. Pass agentInputs to the agent; retain this object,
// deviceTrust and evidence directory in the host. It never installs device trust.
export async function startHttpsEpisode({siteId='juneau-utilities',taskId,seed=1,
 outputRoot=fileURLToPath(new URL('../artifacts/https-episodes/',import.meta.url)),
 billingPort=0,googlePort=0,trial,entryPath='/'}={}){
 await mkdir(outputRoot,{recursive:true,mode:0o700});
 const directory=await mkdtemp(join(resolve(outputRoot),'run-'));
 const reportPath=join(directory,'private-report.json');
 let certificates,server,entryEpisodeId,closed=false,closing;
 const report={schemaVersion:1,runId:randomUUID(),startedAt:new Date().toISOString(),phase:'starting',
  qualification:'HTTPS episode host; not installed-agent acceptance',observations:[]};
 const save=async()=>{
  const temporary=reportPath+'.tmp';
  await writeFile(temporary,JSON.stringify(report,null,2)+'\n',{mode:0o600});
  await rename(temporary,reportPath);
 };
 try{
  report.environmentBuildId=PROCESS_BUILD.environmentBuildId;
  report.evaluatorBuildId=PROCESS_BUILD.evaluatorBuildId;
  report.adapterSha256=ADAPTER_SOURCE_SHA256;report.certificateHelperSha256=TLS_FIXTURE_SOURCE_SHA256;
  report.startupProvenanceChecks=sourceChecks();
  if(!Object.values(report.startupProvenanceChecks).every(Boolean))throw Object.assign(Error('Source changed since module import; start a fresh process'),{code:'SOURCE_CHANGED_SINCE_IMPORT'});
  certificates=await localTlsFixture();
  server=await start({port:billingPort,googlePort,adminPort:0,dbPath:join(directory,'world.sqlite'),tls:certificates.tls,
   episodeEntryPath:id=>id===entryEpisodeId?entryPath:'/'});
  if(trial?.runId!==undefined&&trial.runId!==report.runId)throw Error('Adapter owns trial runId; omit it from trial metadata');
  const fixture=server.world.create({siteId,taskId,seed,...(trial?{trial:{...trial,runId:report.runId}}:{})});
  entryEpisodeId=fixture.episodeId;
  report.trial=server.world.state(fixture.episodeId).trial??null;
  report.episodeId=fixture.episodeId;report.taskId=fixture.task.id;report.siteId=siteId;report.seed=seed;
  report.phase='ready';await save();
  const agentInputs={
   runId:report.runId,episodeId:fixture.episodeId,siteId,seed,
   task:{id:fixture.task.id,version:fixture.task.version,prompt:fixture.task.prompt,budget:fixture.task.budget},
   startUrl:`${server.baseUrl}/enter/${fixture.episodeId}/${fixture.entryToken}`,
   mailboxUrl:server.baseUrl+'/mail',googleUrl:server.googleUrl,
   connector:{runId:report.runId,episodeId:fixture.episodeId,url:server.baseUrl+'/connector/messages',headers:{Authorization:`Bearer ${fixture.connectorToken}`,'X-Billworld-Episode':fixture.episodeId}},
   persona:{runId:report.runId,episodeId:fixture.episodeId,credentials:fixture.credentials},
  };
  for(const name of ['googleCredentials','replacementCard','dentalCredentials','cusiCredentials','medicalCredentials','cid'])if(fixture[name]!==undefined)agentInputs.persona[name]=fixture[name];
  const authority=new X509Certificate(certificates.ca);
  report.tls={caSha256:createHash('sha256').update(certificates.ca).digest('hex'),leafSha256:createHash('sha256').update(certificates.tls.cert).digest('hex'),billingOrigin:server.baseUrl,googleOrigin:server.googleUrl};
  await save();
  const deviceTrust={runId:report.runId,episodeId:fixture.episodeId,caPath:certificates.caPath,caSubjectHash:certificates.caSubjectHash,
   caSha256:createHash('sha256').update(certificates.ca).digest('hex'),expiresAt:authority.validTo,
   billingOrigin:server.baseUrl,googleOrigin:server.googleUrl,
   reversePorts:[server.publicServer.address().port,server.googleServer.address().port],
   cleanupOrder:'Remove owned device CA and reverse mappings before close(); close deletes temporary certificates.'};
  let operations=Promise.resolve(),lastOutcome={};
  const enqueue=operation=>{
   if(closed)return Promise.reject(Error('HTTPS episode host is closed'));
   const next=operations.then(operation);operations=next.catch(()=>{});return next;
  };
  const observe=async(outcome={})=>{
    const state=server.world.state(fixture.episodeId);
    const episodeBuild=state.buildProvenance;
    const grade={...server.world.evaluate(fixture.episodeId,outcome),environmentBuildId:episodeBuild?.environmentBuildId??null,evaluatorBuildId:PROCESS_BUILD.evaluatorBuildId};
    const gradeBuildMatchesStart=grade.environmentBuildId===report.environmentBuildId&&grade.evaluatorBuildId===report.evaluatorBuildId&&episodeBuild?.evaluatorBuildId===report.evaluatorBuildId;
    const provenanceChecks=sourceChecks();
    const payments=state.payments.filter(payment=>!payment.initial);
    const observation={observedAt:new Date().toISOString(),grade,episodeBuild,gradeBuildMatchesStart,provenanceChecks,
     paymentCount:payments.length,exactlyOnePayment:payments.length===1,
     reportedConfirmation:typeof outcome.confirmation==='string'?outcome.confirmation:null,
     confirmationMatchesPayment:typeof outcome.confirmation==='string'&&payments.some(payment=>payment.confirmation===outcome.confirmation)};
    report.observations.push(observation);lastOutcome=structuredClone(outcome);await save();return structuredClone(observation);
  };
  // Nonterminal grading permits receipt recovery without replaying a payment.
  const grade=(outcome={})=>enqueue(()=>observe(outcome));
  const startActionBudget=options=>enqueue(async()=>{
   const budget=server.world.startActionBudget(fixture.episodeId,options);
   report.actionBudget=budget;await save();return structuredClone(budget);
  });
  const reserveAction=options=>enqueue(async()=>{
   const reservation=server.world.consumeAction(fixture.episodeId,options);
   report.actionBudget=reservation;await save();return structuredClone(reservation);
  });
  const finish=(outcome={},metadata={})=>enqueue(async()=>{
   if(!report.trial)throw Error('Declare trial metadata at episode creation before finish');
   const state=server.world.state(fixture.episodeId);
   if(!state.finished&&(metadata.termination??'completed')==='completed'&&!state.actionBudget)throw Error('Start action budget before completing a trial');
   if(!state.finished)await observe(outcome);
   report.finished=server.world.finish(fixture.episodeId,outcome,metadata);
   await save();return structuredClone(report.finished);
  });
  const close=({reason='interrupted'}={})=>{
   if(closing)return closing;
   if(!['completed','interrupted','cancelled','agent_error','environment_error','timeout','action_budget_exceeded'].includes(reason))return Promise.reject(Error('Invalid terminal close reason'));
   closed=true;
   closing=(async()=>{
    await operations;
    const errors=[];
    if(report.trial){
     try{report.finished=server.world.finish(fixture.episodeId,lastOutcome,{termination:reason==='interrupted'?'cancelled':reason==='completed'&&!server.world.state(fixture.episodeId).actionBudget?'environment_error':reason});}
     catch(error){errors.push(error.message);}
    }
    try{await server.close();}catch(error){errors.push(error.message);}
    try{await certificates.close();}catch(error){errors.push(error.message);}
    try{
     report.closeProvenanceChecks=sourceChecks();
     report.buildUnchanged=Object.values(report.closeProvenanceChecks).every(Boolean)&&report.observations.every(observation=>observation.gradeBuildMatchesStart&&Object.values(observation.provenanceChecks).every(Boolean));
    }catch(error){report.buildUnchanged=false;errors.push(error.message);}
    report.termination=errors.length||!report.buildUnchanged?'environment_error':report.finished?.termination??reason;
    report.completed=reason==='completed'&&errors.length===0&&report.buildUnchanged===true&&report.observations.at(-1)?.grade.success===true&&(!report.trial||(report.finished?.success===true&&report.finished.actionBudgetEnforced===true));
    report.phase=errors.length?'cleanup_failed':'closed';report.finishedAt=new Date().toISOString();report.cleanupErrors=errors;
    await save();if(errors.length)throw new AggregateError(errors.map(message=>Error(message)),'HTTPS episode cleanup failed');
    return {reportPath,phase:report.phase};
   })();return closing;
  };
  return {agentInputs:structuredClone(agentInputs),deviceTrust,reportPath,grade,startActionBudget,reserveAction,finish,close};
 }catch(error){
  const cleanupErrors=[];
  try{await server?.close();}catch(failure){cleanupErrors.push(failure.message);}
  try{await certificates?.close();}catch(failure){cleanupErrors.push(failure.message);}
  report.phase='startup_failed';report.termination='environment_error';report.completed=false;report.error=error.message;report.errorCode=error.code??null;report.cleanupErrors=cleanupErrors;report.finishedAt=new Date().toISOString();
  await save();throw error;
 }
}

export async function startPasswordLoginEpisode({ siteId = 'batavia-utilities', provision, seed, outputRoot, trial } = {}) {
  const task = passwordLoginFixture(siteId);
  if (!task || typeof provision !== 'function') throw new Error('Choose a supported login fixture and a private provisioning callback');
  const host = await startHttpsEpisode({ siteId, taskId: task.taskId, seed, outputRoot, trial, entryPath: task.entryPath });
  try {
    const { runId, episodeId, persona, startUrl } = host.agentInputs;
    const origin = new URL(startUrl).origin;
    if (origin !== host.deviceTrust.billingOrigin || !/^https:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin)) {
      throw new Error('Invalid billing fixture origin');
    }
    const username = task.identity === 'cusiUsername' ? persona.cusiCredentials?.username : persona.credentials[task.identity];
    const password = persona.credentials.password;
    if (!username || !password) throw new Error('Missing login fixture');
    await provision({
      runId, episodeId, entryUrl: startUrl, deviceTrust: host.deviceTrust,
      login: { label: task.label, origin, username, password },
    });
    return {
      agentInputs: { runId, episodeId, site: task.label, prompt: 'Help me use my saved login to view my account.' },
      grade: host.grade, startActionBudget: host.startActionBudget, reserveAction: host.reserveAction,
      finish: host.finish, close: host.close, reportPath: host.reportPath,
    };
  } catch {
    await host.close({ reason: 'environment_error' });
    throw new Error('Private login fixture provisioning failed');
  }
}
