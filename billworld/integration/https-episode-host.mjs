import {mkdir,mkdtemp,writeFile,readFile,rename} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,X509Certificate,randomUUID} from 'node:crypto';
import {start} from '../server.mjs';
import {fingerprint} from '../build-fingerprint.mjs';
import {localTlsFixture} from '../tests/tls-fixture.mjs';

// Supervisor-only adapter. Pass agentInputs to the agent; retain this object,
// deviceTrust and evidence directory in the host. It never installs device trust.
export async function startHttpsEpisode({siteId='juneau-utilities',taskId,seed=1,
 outputRoot=fileURLToPath(new URL('../artifacts/https-episodes/',import.meta.url)),
 billingPort=0,googlePort=0}={}){
 await mkdir(outputRoot,{recursive:true,mode:0o700});
 const directory=await mkdtemp(join(resolve(outputRoot),'run-'));
 const reportPath=join(directory,'private-report.json');
 let certificates,server,closed=false,closing;
 const report={schemaVersion:1,runId:randomUUID(),startedAt:new Date().toISOString(),phase:'starting',
  qualification:'HTTPS episode host; not installed-agent acceptance',observations:[]};
 const save=async()=>{
  const temporary=reportPath+'.tmp';
  await writeFile(temporary,JSON.stringify(report,null,2)+'\n',{mode:0o600});
  await rename(temporary,reportPath);
 };
 try{
  const build=fingerprint();report.environmentBuildId=build.environmentBuildId;
  report.evaluatorBuildId=build.evaluatorBuildId;
  report.adapterSha256=createHash('sha256').update(await readFile(fileURLToPath(import.meta.url))).digest('hex');
  certificates=await localTlsFixture();
  server=await start({port:billingPort,googlePort,adminPort:0,dbPath:join(directory,'world.sqlite'),tls:certificates.tls});
  const fixture=server.world.create({siteId,taskId,seed});
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
  report.certificateHelperSha256=createHash('sha256').update(await readFile(new URL('../tests/tls-fixture.mjs',import.meta.url))).digest('hex');
  await save();
  const deviceTrust={runId:report.runId,episodeId:fixture.episodeId,caPath:certificates.caPath,caSubjectHash:certificates.caSubjectHash,
   caSha256:createHash('sha256').update(certificates.ca).digest('hex'),expiresAt:authority.validTo,
   billingOrigin:server.baseUrl,googleOrigin:server.googleUrl,
   reversePorts:[server.publicServer.address().port,server.googleServer.address().port],
   cleanupOrder:'Remove owned device CA and reverse mappings before close(); close deletes temporary certificates.'};
  let operations=Promise.resolve();
  const grade=(outcome={})=>{
   if(closed)return Promise.reject(Error('HTTPS episode host is closed'));
   // Serialize private observations and their evidence writes. Grading is read-only
   // with respect to billing; an interrupted answer can be recovered in this episode.
   const next=operations.then(async()=>{
    const grade=server.world.evaluate(fixture.episodeId,outcome);
    const payments=server.world.state(fixture.episodeId).payments.filter(payment=>!payment.initial);
    const observation={observedAt:new Date().toISOString(),grade,
     paymentCount:payments.length,exactlyOnePayment:payments.length===1,
     reportedConfirmation:typeof outcome.confirmation==='string'?outcome.confirmation:null,
     confirmationMatchesPayment:typeof outcome.confirmation==='string'&&payments.some(payment=>payment.confirmation===outcome.confirmation)};
    report.observations.push(observation);await save();return structuredClone(observation);
   });operations=next.catch(()=>{});return next;
  };
  const close=({reason='interrupted'}={})=>{
   if(closing)return closing;
   if(!['completed','interrupted','cancelled','agent_error','environment_error'].includes(reason))return Promise.reject(Error('Invalid terminal close reason'));
   closed=true;
   closing=(async()=>{
    await operations;
    const errors=[];
    try{await server.close();}catch(error){errors.push(error.message);}
    try{await certificates.close();}catch(error){errors.push(error.message);}
    try{report.buildUnchanged=fingerprint().environmentBuildId===report.environmentBuildId;}catch(error){errors.push(error.message);}
    report.termination=errors.length?'environment_error':reason;
    report.completed=reason==='completed'&&errors.length===0&&report.buildUnchanged===true&&report.observations.at(-1)?.grade.success===true;
    report.phase=errors.length?'cleanup_failed':'closed';report.finishedAt=new Date().toISOString();report.cleanupErrors=errors;
    await save();if(errors.length)throw new AggregateError(errors.map(message=>Error(message)),'HTTPS episode cleanup failed');
    return {reportPath,phase:report.phase};
   })();return closing;
  };
  return {agentInputs:structuredClone(agentInputs),deviceTrust,reportPath,grade,close};
 }catch(error){
  const cleanupErrors=[];
  try{await server?.close();}catch(failure){cleanupErrors.push(failure.message);}
  try{await certificates?.close();}catch(failure){cleanupErrors.push(failure.message);}
  report.phase='startup_failed';report.termination='environment_error';report.completed=false;report.error=error.message;report.cleanupErrors=cleanupErrors;report.finishedAt=new Date().toISOString();
  await save();throw error;
 }
}
