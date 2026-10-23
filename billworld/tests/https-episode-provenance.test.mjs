import test from 'node:test';
import assert from 'node:assert/strict';
import {cp,mkdtemp,writeFile,readFile,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

// Real source edits happen only in this temporary copy, in a fresh child process
// per case. No mocks of fingerprints, shared-checkout edits or restored hashes.
const probe=String.raw`
import assert from 'node:assert/strict';
import {appendFile,readFile,readdir} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {startHttpsEpisode} from './billworld/integration/https-episode-host.mjs';
import {World} from './billworld/engine.mjs';
const [mode,target]=process.argv.slice(2);
const outputRoot=join(process.cwd(),'.probe-runs');
const change=()=>appendFile(target,target.endsWith('.py')?'\n# provenance regression\n':'\n// provenance regression\n');
if(mode==='before-start'){
 await change();
 await assert.rejects(startHttpsEpisode({outputRoot}),error=>error.code==='SOURCE_CHANGED_SINCE_IMPORT');
 const runs=await readdir(outputRoot);const report=JSON.parse(await readFile(join(outputRoot,runs.at(-1),'private-report.json')));
 assert.equal(report.phase,'startup_failed');assert.equal(report.completed,false);
 console.log(JSON.stringify({mode,target,checks:report.startupProvenanceChecks}));
}else{
 let host;
 try{
  host=await startHttpsEpisode({outputRoot});
  const world=new World(join(dirname(host.reportPath),'world.sqlite'));
  let confirmation;
  try{
   const id=host.agentInputs.episodeId;
   const session=world.login(id,host.agentInputs.persona.credentials).session;
   const quote=world.quote(id,session,{invoiceId:'inv-current',amountCents:8432,methodId:'bank-1048'});
   confirmation=world.pay(id,session,{token:quote.token}).confirmation;
   if(mode==='episode-build'){
    const state=world.state(id);state.buildProvenance.evaluatorBuildId='0'.repeat(64);world.save(state);
   }
  }finally{world.close();}
  const observed=await host.grade({confirmation});assert.equal(observed.grade.success,true,'Start with a genuinely successful private grade');
  if(mode==='during-episode')await change();
  await host.close({reason:'completed'});
  const report=JSON.parse(await readFile(host.reportPath));
  assert.equal(report.completed,false);assert.equal(report.buildUnchanged,false);assert.equal(report.termination,'environment_error');assert.deepEqual(report.cleanupErrors,[]);
  if(mode==='episode-build')assert.equal(observed.gradeBuildMatchesStart,false);
  console.log(JSON.stringify({mode,target,checks:report.closeProvenanceChecks,gradeBuildMatchesStart:observed.gradeBuildMatchesStart}));
 }finally{await host?.close();}
}
`;

test('temporary source tree rejects stale imports and changed completion provenance',async t=>{
 const source=fileURLToPath(new URL('../../',import.meta.url));
 const directory=await mkdtemp(join(tmpdir(),'billworld-provenance-'));
 const tree=join(directory,'source');
 try{
  await cp(source,tree,{recursive:true,filter:path=>{
   const name=relative(source,path).replaceAll('\\','/');
   return !['.git','node_modules','.probe-runs','billworld/artifacts','billworld/data'].some(prefix=>name===prefix||name.startsWith(prefix+'/'));
  }});
  await symlink(join(source,'node_modules'),join(tree,'node_modules'),'dir');
  await writeFile(join(tree,'provenance-probe.mjs'),probe);
  const files=['billworld/infinity/app/verify.py','billworld/tests/tls-fixture.mjs','billworld/integration/https-episode-host.mjs'];
  const cases=[...files.map(file=>['during-episode',file]),['during-episode','billworld/server.mjs'],...files.map(file=>['before-start',file]),['before-start','billworld/server.mjs'],['episode-build','']];
  for(const [mode,target]of cases)await t.test(`${mode}: ${target||'episode evaluator ID'}`,async()=>{
   const original=target?await readFile(join(tree,target)):null;
   try{
    const result=await promisify(execFile)(process.execPath,['provenance-probe.mjs',mode,target],{cwd:tree,timeout:30000,maxBuffer:1024*1024});
    const observed=JSON.parse(result.stdout.trim());
    if(target)assert.ok(Object.values(observed.checks).some(value=>value===false));
    else assert.equal(observed.gradeBuildMatchesStart,false);
   }finally{if(target)await writeFile(join(tree,target),original);await rm(join(tree,'.probe-runs'),{recursive:true,force:true});}
  });
 }finally{await rm(directory,{recursive:true,force:true});}
});
