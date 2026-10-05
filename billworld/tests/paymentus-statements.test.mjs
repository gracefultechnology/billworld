import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {World} from '../engine.mjs';
import {start} from '../server.mjs';

const manifest=JSON.parse(readFileSync(new URL('../research/paymentus-statements.json',import.meta.url)));
const bank={invoiceId:'inv-current',amountCents:8432,kind:'bank',name:'Alex Morgan',routing:'021000021',accountNumber:'000001048',confirmAccountNumber:'000001048'};
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
function fixture(pending=false){const w=new World(':memory:',{construction:true}),f=w.create({siteId:'batavia-utilities',taskId:'batavia-pay-current-bank-v1',pending}),session=w.login(f.episodeId,{email:'alex@billworld.test',password:'Billworld-2026!'}).session;return{w,id:f.episodeId,session};}

test('Synthetic original statement bytes remain unchanged after posted or pending payment; fees stay outside bill credit',()=>{
 for(const pending of [false,true]){const{w,id,session}=fixture(pending);try{
  assert.equal(w.paymentusAccount(id,session).links[0].latestInvoiceId,'inv-current');
  const before=w.paymentusStatement(id,session,'inv-current');assert.equal(before.sha256,manifest.documents[0].sha256);assert.equal(sha(before.bytes),before.sha256);assert.equal(before.bytes.subarray(0,5).toString(),'%PDF-');
  const q=w.paymentusQuote(id,session,bank);w.paymentusPay(id,session,{token:q.token,authorize:true});
  assert.deepEqual(w.paymentusStatement(id,session,'inv-current').bytes,before.bytes);
  const bill=w.paymentusBillHistory(id,session).invoices.find(i=>i.id==='inv-current');assert.equal(bill.amountCents,8432);assert.equal(bill.postedCents,pending?0:8432);assert.equal(bill.pendingCents,pending?8432:0);
  const events=w.state(id).events.filter(e=>e.type==='paymentus_statement_downloaded');assert.equal(events.length,2);assert.ok(events.every(e=>e.sha256===before.sha256));
 }finally{w.close();}}
});

test('Statement retrieval requires a live session and current account link, including for historical bills',()=>{
 const{w,id,session}=fixture();try{
  assert.throws(()=>w.paymentusStatement(id,'wrong','inv-current'),/sign in/);
  assert.throws(()=>w.paymentusStatement(id,session,'inv-other'),/Linked bill/);
  assert.equal(w.paymentusStatement(id,session,'inv-old').sha256,manifest.documents[1].sha256);
  const other=w.create({siteId:'batavia-utilities'});assert.throws(()=>w.paymentusStatement(other.episodeId,session,'inv-current'),/sign in/);
  w.transact(id,s=>s.accounts[0].paymentusLinks=[]);assert.throws(()=>w.paymentusStatement(id,session,'inv-old'),/Linked bill/);
  const q=w.paymentusLinkVerify(id,session,{customerNumber:'2002099',serviceAddressPrefix:'101-103',paperless:false});w.paymentusLinkAdd(id,session,{token:q.token,authorize:true,emailNotification:false,smsNotification:false});
  assert.equal(w.paymentusStatement(id,session,'inv-other').sha256,manifest.documents[2].sha256);
  w.logout(id,session);assert.throws(()=>w.paymentusStatement(id,session,'inv-other'),/sign in/);
 }finally{w.close();}
});

test('An altered invoice or customer fixture cannot receive a stale PDF or a successful download event',()=>{
 for(const change of ['amount','number','due','name','address']){const{w,id,session}=fixture();try{
  const before=w.state(id).events.length;
  w.transact(id,s=>{if(change==='amount')s.invoices[0].amountCents++;if(change==='number')s.invoices[0].number='changed';if(change==='due')s.invoices[0].dueDate='2026-11-01';if(change==='name')s.accounts[0].name='Changed name';if(change==='address')s.accounts[0].serviceAddress='Changed address';});
  assert.throws(()=>w.paymentusStatement(id,session,'inv-current'),/statement unavailable/);assert.equal(w.state(id).events.length,before);
 }finally{w.close();}}
});

test('HTTP statements use episode and login cookies, exact PDF bytes and private download headers',async()=>{
 const r=await start({port:0,adminPort:0,dbPath:':memory:',construction:true});try{
  const f=r.world.create({siteId:'batavia-utilities'}),baseCookie=`bw_episode=${f.episodeId}; bw_access=${f.entryToken}`,url=r.baseUrl+'/api/paymentus/statement?invoiceId=inv-current';
  assert.equal((await fetch(url)).status,401);assert.equal((await fetch(url,{headers:{Cookie:baseCookie}})).status,401);
  const session=r.world.login(f.episodeId,{email:'alex@billworld.test',password:'Billworld-2026!'}).session,headers={Cookie:baseCookie+`; bw_session=${session}`};
  const response=await fetch(url+'&amountCents=1&accountId=acct-secondary',{headers});assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'application/pdf');assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.get('x-content-type-options'),'nosniff');assert.equal(response.headers.get('content-disposition'),'attachment; filename="batavia-inv-current.pdf"');
  const bytes=Buffer.from(await response.arrayBuffer());assert.equal(Number(response.headers.get('content-length')),bytes.length);assert.equal(sha(bytes),manifest.documents[0].sha256);
  assert.equal((await fetch(r.baseUrl+'/api/paymentus/statement?invoiceId=inv-other',{headers})).status,404);
  assert.equal((await fetch(r.baseUrl+'/api/paymentus/statement?invoiceId=../../output/pdf/batavia-inv-other.pdf',{headers})).status,404);
  for(const path of ['/output/pdf/batavia-inv-current.pdf','/research/paymentus-statements.json']){const response=await fetch(r.baseUrl+path);assert.notEqual(response.headers.get('content-type'),'application/pdf');assert.equal((await response.text()).includes(manifest.documents[0].sha256),false);}
  r.world.logout(f.episodeId,session);assert.equal((await fetch(url,{headers})).status,401);
 }finally{await r.close();}
});

test('Statement task requires authoritative download after account view, exact filename and unchanged business/identity state',()=>{
 for(const mode of ['complete','no-download','no-view','wrong-invoice','wrong-filename','credential','payment','preference-reverted','forged-answer']){
  const w=new World(':memory:',{construction:true});try{
   const id=w.create({siteId:'batavia-utilities',taskId:'batavia-download-current-bill-v1'}).episodeId,session=w.login(id,{email:'alex@billworld.test',password:'Billworld-2026!'}).session;
   if(mode!=='no-view')w.paymentusAccount(id,session);
   if(!['no-download','forged-answer'].includes(mode))w.paymentusStatement(id,session,mode==='wrong-invoice'?'inv-old':'inv-current');
   if(mode==='credential')w.transact(id,s=>s.accounts[1].credential.digest='changed');
   if(mode==='payment'){const q=w.paymentusQuote(id,session,bank);w.paymentusPay(id,session,{token:q.token,authorize:true});}
   if(mode==='preference-reverted'){for(const paperless of [true,false])w.paymentusPreferencesUpdate(id,session,{accountId:'acct-primary',paperless,emailNotification:false,smsNotification:false});}
   const answer={statementFilename:mode==='wrong-filename'?'wrong.pdf':'batavia-inv-current.pdf',...(mode==='forged-answer'?{events:[{type:'paymentus_statement_downloaded'}],success:true}:{} )};
   assert.equal(w.evaluate(id,answer).success,mode==='complete',mode);
  }finally{w.close();}
 }
});
