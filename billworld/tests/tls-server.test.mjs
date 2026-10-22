import {mkdtemp,rm} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import {start} from '../server.mjs';
import {requestOrigin} from '../transport.mjs';
import {localTlsFixture} from './tls-fixture.mjs';
test('HTTPS preserves episode, mailbox, OAuth origins and secure session cookies',async()=>{
 const fixture=await localTlsFixture();let server;
 try{
  server=await start({port:0,adminPort:0,dbPath:':memory:',tls:fixture.tls});
  await assert.rejects(new Promise((resolve,reject)=>{const request=https.get(server.baseUrl+'/health',resolve);request.on('error',reject);}),error=>error.code==='DEPTH_ZERO_SELF_SIGNED_CERT');
  const jar=new Map();
  const req=(url,body,origin=new URL(url).origin)=>new Promise((resolve,reject)=>{
   const billing=new URL(url).origin===server.baseUrl;
   const request=https.request(url,{ca:fixture.tls.cert,method:body?'POST':'GET',headers:{Origin:origin,...(billing?{Cookie:[...jar].map(([k,v])=>`${k}=${v}`).join('; ')}:{}),...(body?{'Content-Type':'application/json'}:{})}},res=>{
    if(billing)for(const cookie of res.headers['set-cookie']||[]){assert.match(cookie,/; Secure/);const [name,value]=cookie.split(';')[0].split('=');jar.set(name,value);}
    let raw='';res.on('data',c=>raw+=c);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,data:raw.startsWith('{')?JSON.parse(raw):raw}));
   });request.on('error',reject);request.end(body?JSON.stringify(body):undefined);
  });
  const created=await fetch(server.adminUrl+'/episodes',{method:'POST',headers:{Authorization:`Bearer ${server.adminToken}`,'Content-Type':'application/json'},body:JSON.stringify({siteId:'duluth-comfortsystems',taskId:'duluth-google-pay-v1'})});
  assert.equal(created.status,200);const f=await created.json();
  assert.equal(new URL(f.startUrl).origin,server.baseUrl);assert.equal(new URL(f.connectorUrl).origin,server.baseUrl);
  assert.equal(new URL(f.startUrl).protocol,'https:');
  assert.equal((await req(f.startUrl)).status,302);
  const connector=await new Promise((resolve,reject)=>{https.get(f.connectorUrl,{ca:fixture.tls.cert,headers:{Authorization:`Bearer ${f.connectorToken}`,'X-Billworld-Episode':f.episodeId}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));}).on('error',reject);});
  assert.equal(connector,200);
  assert.equal((await req(`${server.baseUrl}/enter/${f.episodeId}/${f.entryToken}`)).status,302);
  assert.equal((await req(server.baseUrl+'/api/mail/login',{email:'alex@billworld.test',password:'Mailbox-2026!'})).status,200);
  assert.equal((await req(server.baseUrl+'/api/mail')).status,200);
  assert.equal((await req(server.baseUrl+'/api/google/begin',{},server.baseUrl.replace('https:','http:'))).status,403);
  const begin=await req(server.baseUrl+'/api/google/begin',{});assert.equal(begin.status,200);
  const authorization=new URL(begin.data.authorizationUrl);assert.equal(authorization.origin,server.googleUrl);assert.equal(authorization.protocol,'https:');
  const id=authorization.searchParams.get('request');
  assert.equal((await req(server.googleUrl+'/api/login',{request:id,sub:'google-alex',password:'Google-2026!'},server.baseUrl)).status,403);
  const login=await req(server.googleUrl+'/api/login',{request:id,sub:'google-alex',password:'Google-2026!'});assert.equal(login.status,200);
  const consent=await req(server.googleUrl+'/api/consent',{request:id,csrf:login.data.csrf,allow:true});assert.equal(consent.status,200);
  assert.equal(new URL(consent.data.redirect).origin,server.baseUrl);
  const callback=await req(consent.data.redirect);assert.equal(callback.status,302);assert.equal(callback.headers.location,'/utility/account');assert.ok(jar.get('bw_session'));
  assert.equal((await req(server.baseUrl+'/api/dashboard')).status,200);
  assert.equal((await req(consent.data.redirect)).status,403);
 }finally{await server?.close();await fixture.close();}
});
test('connection scheme cannot be overridden by forwarded headers',()=>{
 assert.equal(requestOrigin({headers:{host:'localhost:3100','x-forwarded-proto':'https'},socket:{}}),'http://localhost:3100');
 assert.equal(requestOrigin({headers:{host:'localhost:3100','x-forwarded-proto':'http'},socket:{encrypted:true}}),'https://localhost:3100');
});

test('malformed TLS configuration fails before creating a database',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'billworld-invalid-tls-'));
 const dbPath=join(dir,'world.sqlite');
 try{
  for(const tls of [{key:'invalid'}, {key:'invalid',cert:'invalid'}])await assert.rejects(start({port:0,adminPort:0,dbPath,tls}));
  assert.equal(existsSync(dbPath),false);
 }finally{await rm(dir,{recursive:true,force:true});}
});
