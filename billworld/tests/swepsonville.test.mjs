import test from 'node:test';
import assert from 'node:assert/strict';
import {World} from '../engine.mjs';
const make=taskId=>{const w=new World(),f=w.create({siteId:'swepsonville-water',taskId});return {w,f,id:f.episodeId};};
const credentials={email:'alex@billworld.test',password:'Billworld-2026!'};
const registration={customerNumber:'1001048',cid:'C1048',firstName:'Alex',lastName:'Morgan',email:credentials.email,confirmEmail:credentials.email,password:'Registered-2026!',confirmPassword:'Registered-2026!'};
const lookup=(w,id)=>w.smartLookup(id,{customerNumber:'1001048',lastName:'Morgan'});
const payment=(r)=>({customerNumber:'1001048',lookupToken:r.lookupToken,invoiceId:'inv-current',amountCents:8432,kind:'bank',name:'Alex Morgan',routing:'021000021',accountNumber:'000001048'});
test('Swepsonville CID registration validates all identifiers without granting a session; grading requires subsequent login',()=>{
 const {w,id}=make('swepsonville-register-login-v1');try{
  for(const bad of [{cid:'C2099'},{lastName:'Other'},{confirmEmail:'other@billworld.test'},{confirmPassword:'Different-2026!'}])assert.throws(()=>w.register(id,{...registration,...bad}));
  assert.equal(w.state(id).accounts[0].registered,false);
  assert.deepEqual(w.register(id,registration),{registered:true});assert.equal(Object.keys(w.state(id).sessions).length,0);assert.equal(w.evaluate(id).success,false);
  assert.throws(()=>w.login(id,credentials),/incorrect/);w.login(id,{...credentials,password:registration.password});assert.equal(w.evaluate(id).success,true);assert.throws(()=>w.register(id,registration),/already registered/);
 }finally{w.close();}
});
test('AuthorityPay sign-in cannot bypass InvoiceCloud lookup or expose saved payment methods',()=>{
 const {w,id}=make();try{const session=w.login(id,credentials).session,r=lookup(w,id);
  assert.throws(()=>w.quote(id,session,{...payment(r),lookupToken:undefined}),/Look up/);
  assert.throws(()=>w.quote(id,session,{...payment(r),methodId:'bank-1048'}),/saved payment/);
  assert.throws(()=>w.smartLookup(id,{customerNumber:'1001048',lastName:'Wrong'}),/verified/);
  const q=w.quote(id,session,payment(r)),p=w.pay(id,session,{token:q.token});assert.equal(p.authenticated,false);assert.equal(q.feeCents,0);assert.equal(w.pay(id,session,{token:q.token}).confirmation,p.confirmation);assert.equal(w.evaluate(id,{confirmation:p.confirmation}).success,true);
 }finally{w.close();}
});
test('Guest lookup and payment review remain episode-bound, expire, and protect the invoice from duplicate quotes',()=>{
 const {w,id}=make();try{const r=lookup(w,id),other=w.create({siteId:'swepsonville-water'});assert.throws(()=>w.quote(other.episodeId,null,payment(r)),/Look up/);const q=w.quote(id,null,payment(r)),q2=w.quote(id,null,payment(r));w.pay(id,null,{token:q.token});assert.throws(()=>w.pay(id,null,{token:q2.token}),/unpaid|balance|amount/);
  const fresh=w.create({siteId:'swepsonville-water'}),r2=lookup(w,fresh.episodeId);w.advance(fresh.episodeId,16*60000);assert.throws(()=>w.quote(fresh.episodeId,null,payment(r2)),/Look up/);
 }finally{w.close();}
});
test('Swepsonville checkout rejects invalid bank and card data and supports non-16-digit valid cards',()=>{
 const {w,id}=make();try{const r=lookup(w,id),input=payment(r);assert.throws(()=>w.quote(id,null,{...input,routing:'021000022'}),/checksum/);const card={...input,kind:'card',cardNumber:'378282246310005',expiry:'12/29',cvv:'1234'};assert.throws(()=>w.quote(id,null,{...card,cardNumber:'378282246310006'}),/checksum/);assert.throws(()=>w.quote(id,null,{...card,expiry:'01/20'}),/expired/);assert.equal(w.quote(id,null,card).feeCents,0);
 }finally{w.close();}
});
test('Direct AutoPay activation and scheduling cannot bypass the municipal bank-draft form',()=>{
 const {w,id}=make();try{const session=w.login(id,credentials).session;assert.throws(()=>w.autopay(id,session,{enabled:true,methodId:'bank-1048',day:1}),/not implemented/);assert.throws(()=>w.schedule(id,session,{token:'none',date:'2026-10-15'}),/not implemented/);assert.equal(w.state(id).accounts[0].autopay.enabled,false);assert.equal(w.state(id).payments.filter(p=>!p.initial).length,0);
 }finally{w.close();}
});
test('Swepsonville recovery uses episode mail, hides unknown identities, invalidates sessions and rejects reused/cross-episode links',()=>{
 const {w,id,f}=make('swepsonville-recover-login-v1');try{const old=w.login(id,credentials).session,n=w.messages(id,f.connectorToken).length;
  const response=w.resetRequest(id,{email:'unknown@billworld.test'});assert.equal(w.messages(id,f.connectorToken).length,n);assert.deepEqual(w.resetRequest(id,{email:credentials.email}),response);
  const text=w.messages(id,f.connectorToken,'subject:reset')[0].text,token=text.match(/token=(\S+) to/)[1],other=w.create({siteId:'swepsonville-water'});assert.throws(()=>w.resetPassword(other.episodeId,{token,password:'Restored-2026!'}),/expired|used/);
  w.resetPassword(id,{token,password:'Restored-2026!'});assert.throws(()=>w.dashboard(id,old),/sign in|expired|session/i);assert.throws(()=>w.resetPassword(id,{token,password:'Other-2026!'}),/expired|used/);assert.throws(()=>w.login(id,credentials),/incorrect/);assert.equal(w.evaluate(id).success,false);w.login(id,{...credentials,password:'Restored-2026!'});assert.equal(w.evaluate(id).success,true);
 }finally{w.close();}
});
const draft={customerNumber:'1001048',customerName:'Alex Morgan',serviceAddress:'1048 River Road, Graham, NC 27253',bankName:'Billworld Test Bank',routing:'021000021',accountNumber:'000001048',accountType:'checking',phone:'3365550148',email:'alex@billworld.test',signature:'Alex Morgan',date:'10/03/2026',creditReportConsent:true};
test('Bank-draft request validates fields and explicit consent without creating a payment or activating drafts',()=>{
 const {w,id,f}=make('swepsonville-bank-draft-request-v1');try{
  for(const bad of [{creditReportConsent:false},{creditReportConsent:'true'},{customerName:'Jordan Lee'},{serviceAddress:'Other Address'},{email:'jordan@billworld.test'},{routing:'021000022'},{accountType:'card'},{date:'02/30/2026'},{signature:''}])assert.throws(()=>w.submitBankDraft(id,{...draft,...bad}));
  assert.equal(w.state(id).bankDraftSubmissions?.length||0,0);const r=w.submitBankDraft(id,draft);assert.equal(r.submission.status,'pending_review');assert.equal(r.submission.active,false);assert.equal(w.evaluate(id,{confirmation:r.submission.confirmation}).success,true);assert.equal(w.messages(id,f.connectorToken,'subject:bank-draft').length,1);
  assert.equal(JSON.stringify(w.state(id)).includes('000001048'),false);assert.equal(JSON.stringify(w.state(id)).includes('021000021'),false);w.advance(id,120*86400000);assert.equal(w.state(id).payments.filter(p=>!p.initial).length,0);assert.equal(w.state(id).accounts[0].autopay.enabled,false);
 }finally{w.close();}
});
test('Bank-draft retries are idempotent, changed details conflict, and receipt grants are episode-bound and expire',()=>{
 const {w,id,f}=make('swepsonville-bank-draft-request-v1');try{const r=w.submitBankDraft(id,draft),again=w.submitBankDraft(id,draft);assert.equal(again.submission.confirmation,r.submission.confirmation);assert.equal(w.state(id).bankDraftSubmissions.length,1);assert.equal(w.messages(id,f.connectorToken,'subject:bank-draft').length,1);assert.throws(()=>w.submitBankDraft(id,{...draft,accountType:'savings'}),/already pending/);
  assert.equal(w.bankDraftReceipt(id,r.submissionToken).submission.confirmation,r.submission.confirmation);const other=w.create({siteId:'swepsonville-water'});assert.throws(()=>w.bankDraftReceipt(other.episodeId,r.submissionToken),/expired/);assert.throws(()=>w.bankDraftReceipt(id,'wrong'),/expired/);w.advance(id,61*60000);assert.throws(()=>w.bankDraftReceipt(id,r.submissionToken),/expired/);
 }finally{w.close();}
});
test('Request grading rejects the wrong bank type, signature, bank name or confirmation and does not infer active AutoPay',()=>{
 for(const bad of [{accountType:'savings'},{signature:'Someone Else'},{bankName:'Other Bank'}]){const {w,id}=make('swepsonville-bank-draft-request-v1');try{const r=w.submitBankDraft(id,{...draft,...bad});assert.equal(w.evaluate(id,{confirmation:r.submission.confirmation}).success,false);}finally{w.close();}}
 const {w,id}=make('swepsonville-bank-draft-request-v1');try{w.submitBankDraft(id,draft);assert.equal(w.evaluate(id,{confirmation:'Wrong'}).success,false);const foreign=w.create({siteId:'juneau-utilities'});assert.throws(()=>w.submitBankDraft(foreign.episodeId,draft),/unavailable/);}finally{w.close();}
});
