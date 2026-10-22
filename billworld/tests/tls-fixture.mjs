import {mkdtemp,writeFile,readFile,rm,chmod} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {X509Certificate,createHash,randomUUID} from 'node:crypto';

// Test-only material. Consumers may temporarily trust caPath in an owned test
// device, but must remove that trust before close(). This helper installs none.
export async function localTlsFixture(){
 const dir=await mkdtemp(join(tmpdir(),'billworld-tls-'));
 const openssl=(...args)=>promisify(execFile)('openssl',args,{cwd:dir});
 try{
  const name=`Billworld temporary test CA ${randomUUID()}`;
  await writeFile(join(dir,'ca.cnf'),`[req]\ndistinguished_name=dn\nx509_extensions=ext\nprompt=no\n[dn]\nCN=${name}\n[ext]\nbasicConstraints=critical,CA:TRUE,pathlen:0\nkeyUsage=critical,keyCertSign,cRLSign\n`);
  await openssl('req','-x509','-newkey','rsa:2048','-nodes','-days','1','-keyout','ca.key','-out','ca.pem','-config','ca.cnf');
  await openssl('req','-new','-newkey','rsa:2048','-nodes','-keyout','leaf.key','-out','leaf.csr','-subj','/CN=localhost');
  await writeFile(join(dir,'leaf.ext'),'subjectAltName=DNS:localhost,IP:127.0.0.1\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n');
  await openssl('x509','-req','-in','leaf.csr','-CA','ca.pem','-CAkey','ca.key','-CAcreateserial','-out','leaf.pem','-days','1','-extfile','leaf.ext');
  await Promise.all(['ca.key','leaf.key'].map(name=>chmod(join(dir,name),0o600)));
  const caPath=join(dir,'ca.pem');
  const [key,cert,ca]=await Promise.all([readFile(join(dir,'leaf.key')),readFile(join(dir,'leaf.pem')),readFile(caPath)]);
  const caSubjectHash=(await openssl('x509','-subject_hash_old','-noout','-in','ca.pem')).stdout.trim();
  if(!/^[0-9a-f]{8}$/.test(caSubjectHash))throw Error('Invalid test CA subject hash');
  const spki=createHash('sha256').update(new X509Certificate(cert).publicKey.export({type:'spki',format:'der'})).digest('base64');
  return {tls:{key,cert},ca,caPath,caSubjectHash,spki,close:()=>rm(dir,{recursive:true,force:true})};
 }catch(error){await rm(dir,{recursive:true,force:true});throw error;}
}
