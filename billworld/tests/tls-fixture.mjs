import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {X509Certificate,createHash} from 'node:crypto';
export async function localTlsFixture(){
 const dir=await mkdtemp(join(tmpdir(),'billworld-tls-'));
 try{
  await writeFile(join(dir,'openssl.cnf'),'[req]\ndistinguished_name=dn\nx509_extensions=ext\nprompt=no\n[dn]\nCN=Billworld temporary test\n[ext]\nsubjectAltName=DNS:localhost,IP:127.0.0.1\nbasicConstraints=critical,CA:TRUE\nkeyUsage=critical,digitalSignature,keyEncipherment,keyCertSign\nextendedKeyUsage=serverAuth\n');
  await promisify(execFile)('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-keyout',join(dir,'key.pem'),'-out',join(dir,'cert.pem'),'-config',join(dir,'openssl.cnf')]);
  const key=await readFile(join(dir,'key.pem')),cert=await readFile(join(dir,'cert.pem'));
  const spki=createHash('sha256').update(new X509Certificate(cert).publicKey.export({type:'spki',format:'der'})).digest('base64');
  return {tls:{key,cert},spki,close:()=>rm(dir,{recursive:true,force:true})};
 }catch(error){await rm(dir,{recursive:true,force:true});throw error;}
}
