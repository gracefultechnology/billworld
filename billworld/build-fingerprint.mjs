import {createHash} from 'node:crypto';
import {existsSync,readdirSync,readFileSync,lstatSync} from 'node:fs';
import {resolve,relative,sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const root=fileURLToPath(new URL('../',import.meta.url));
function collect(base,directory,predicate,recursive=false){
 const path=resolve(base,directory);if(!existsSync(path))return [];
 if(lstatSync(path).isSymbolicLink())throw Error('Fingerprint directory must not be a symlink');
 const files=[];
 for(const entry of readdirSync(path,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){
  const name=directory+'/'+entry.name;
  if(entry.isSymbolicLink())throw Error('Fingerprint input must not be a symlink');
  if(entry.isDirectory()&&recursive)files.push(...collect(base,name,predicate,true));
  else if(entry.isFile()&&predicate(entry.name))files.push(name);
 }
 return files;
}
function entries(base,files){return [...new Set(files)].sort().map(name=>{
 const path=resolve(base,name);if(!path.startsWith(resolve(base)+sep))throw Error('Fingerprint input escapes root');
 if(lstatSync(path).isSymbolicLink())throw Error('Fingerprint input must not be a symlink');
 const bytes=readFileSync(path);return{file:relative(base,path).split(sep).join('/'),sha256:hash(bytes),bytes:bytes.length};
});}
export function fingerprint(base=root){
 const files=['package.json','package-lock.json','billworld/research/wvu-documents.json','billworld/research/paymentus-statements.json','billworld/research/starnik-statements.json'].filter(x=>existsSync(resolve(base,x)));
 files.push(...collect(base,'billworld/output/pdf',x=>/^(?:batavia|gmg)-inv-[a-z]+\.pdf$/.test(x)));
 files.push(...collect(base,'billworld',x=>x.endsWith('.mjs')));
 const snapshotRoot=resolve(base,'billworld/public/reference-pages');
 if(existsSync(snapshotRoot)){
  if(lstatSync(snapshotRoot).isSymbolicLink())throw Error('Fingerprint directory must not be a symlink');
  for(const entry of readdirSync(snapshotRoot,{withFileTypes:true})){
   if(entry.isSymbolicLink())throw Error('Fingerprint input must not be a symlink');
   const name='billworld/public/reference-pages/'+entry.name+'/manifest.json';
   if(entry.isDirectory()&&existsSync(resolve(base,name)))files.push(name);
  }
 }
 files.push(...collect(base,'billworld/sites',x=>x.endsWith('.json')),...collect(base,'billworld/tasks',x=>x.endsWith('.json')),
  ...collect(base,'billworld/public',x=>/\.(js|css|html)$/.test(x)),...collect(base,'billworld/public/gmail',x=>/\.(js|css|html)$/.test(x),true));
 // Snapshot manifests bind declared body hashes. Body verification remains the
 // cold-read/audit responsibility; hashing all catalog bytes at startup would
 // undo lazy loading. This identifier is not an integrity certification.
 const environmentInputs=entries(base,files);
 const evaluatorFiles=['billworld/engine.mjs','billworld/registry.mjs','billworld/build-fingerprint.mjs','billworld/infinity/app/harness.py','billworld/infinity/app/tasks.json','billworld/infinity/app/verify.py','billworld/infinity/app/server.py','billworld/infinity/worker.mjs','billworld/infinity/readiness.py',
  ...['tasks.py','agents.py','vision_agents.py','run_eval_parallel.py','report.py'].map(x=>'.upstream/webarena-infinity/evaluation/'+x),'.upstream/webarena-infinity/pyproject.toml','.upstream/webarena-infinity/uv.lock'];
 evaluatorFiles.push(...collect(base,'billworld/tasks',x=>x.endsWith('.json')));
 for(const app of ['billworld','billworld-construction']){
  evaluatorFiles.push(...collect(base,'.upstream/webarena-infinity/apps/'+app,x=>x.endsWith('.py')||x==='tasks.json'),
   ...collect(base,'.upstream/webarena-infinity/apps/'+app+'/tasks',x=>x.endsWith('.json')));
 }
 const evaluatorInputs=entries(base,evaluatorFiles.filter(x=>existsSync(resolve(base,x))));
 const schema=1,environmentBuildId=hash(JSON.stringify({schema,inputs:environmentInputs})),evaluatorBuildId=hash(JSON.stringify({schema,inputs:evaluatorInputs}));
 return {schema,environmentBuildId,evaluatorBuildId,environmentInputs,evaluatorInputs,
  snapshotPolicy:'Manifest-declared assets; bodies require cold-read verification and independent audit',
  limits:['Filesystem bytes at process import; not a hermetic image, loaded-module attestation or immutable deployment','External runtimes, OS/browser binaries and provider/model versions require separate recording']};
}
export const PROCESS_BUILD=fingerprint();
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(PROCESS_BUILD,null,2));
