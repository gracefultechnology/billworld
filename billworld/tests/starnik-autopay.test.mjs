import test from 'node:test';
import assert from 'node:assert/strict';
import {World} from '../engine.mjs';
const bank={kind:'bank',name:'Alex Morgan',bankName:'Test Bank',accountType:'Checking',routing:'021000021',confirmRouting:'021000021',accountNumber:'1234561048',confirmAccountNumber:'1234561048',firstName:'Alex',lastName:'Morgan',address:'1 Test Street',city:'Mankato',state:'MN',zip:'56001',country:'United States',email:'alex@billworld.test'};
const card={...bank,kind:'card',cardType:'Visa',cardNumber:'4242424242424242',cvv:'123',expiry:'12/30'};
function setup(input=bank){const w=new World(':memory:',{construction:true}),id=w.create({siteId:'greater-minnesota-gas',taskId:'gmg-username-login-v1'}).episodeId,session=w.starnikLogin(id,{username:'alex.morgan',password:'Billworld-2026!'}).session;const q=w.starnikWalletPrepare(id,session,input);w.starnikWalletReview(id,session,q.token);const {methodId}=w.starnikWalletSave(id,session,q.token,{authorize:true});return{w,id,session,methodId};}
const consent={agreedToTerms:true,confirmed:true};
function enroll(x){const {token}=x.w.starnikAutoPayPrepare(x.id,x.session,{methodId:x.methodId});x.w.starnikAutoPayReview(x.id,x.session,token);x.w.starnikAutoPayEnable(x.id,x.session,token,consent);return token;}
test('Enrollment needs review and consent, is scoped, disables TextPay only with acknowledgment and preserves separate ACH',()=>{
 const x=setup(),{w,id,session,methodId}=x;try{
  w.transact(id,s=>{s.accounts[0].starnikTextPay=true;s.accounts[0].starnikAch=true;});const before=w.state(id),{token}=w.starnikAutoPayPrepare(id,session,{methodId});
  assert.throws(()=>w.starnikAutoPayEnable(id,session,token,consent),/Review/);
  const v=w.starnikAutoPayReview(id,session,token);assert.equal(v.textPayEnabled,true);assert.equal(v.achEnabled,true);
  assert.throws(()=>w.starnikAutoPayEnable(id,session,token,{...consent,agreedToTerms:false}),/terms/);
  assert.throws(()=>w.starnikAutoPayEnable(id,session,token,consent),/TextPay/);
  assert.throws(()=>w.starnikAutoPayEnable(id,session,token,{...consent,acknowledgeTextPay:true}),/ACH/);
  const c={...consent,acknowledgeTextPay:true,acknowledgeAch:true};w.starnikAutoPayEnable(id,session,token,c);assert.equal(w.starnikAutoPayEnable(id,session,token,c).idempotent,true);
  const after=w.state(id);assert.equal(after.accounts[0].starnikTextPay,false);assert.equal(after.accounts[0].starnikAch,true);assert.deepEqual(after.accounts[1],before.accounts[1]);for(const k of ['invoices','payments','scheduledPayments'])assert.deepEqual(after[k],before[k]);
  assert.throws(()=>w.starnikWalletRemove(id,session,{methodId,authorize:true}),/Disable AutoPay/);assert.throws(()=>w.starnikAutoPayDisable(id,session,{confirmed:false}),/Confirm/);w.starnikAutoPayDisable(id,session,{confirmed:true});assert.throws(()=>w.starnikAutoPayEnable(id,session,token,c),/changed/);assert.equal(w.starnikAutoPay(id,session).enrollment.enabled,false);
 }finally{w.close();}
});
test('Enrollment rejects foreign, guest, cross-session and expired review capabilities',()=>{const{w,id,session,methodId}=setup();try{
 const {token}=w.starnikAutoPayPrepare(id,session,{methodId}),second=w.starnikLogin(id,{username:'alex.morgan',password:'Billworld-2026!'}).session,other=w.starnikLogin(id,{username:'jordan.lee',password:'Other-2026!'}).session;
 assert.throws(()=>w.starnikAutoPayPrepare(id,other,{methodId}),/saved/);assert.throws(()=>w.starnikAutoPayReview(id,second,token),/unavailable/);assert.throws(()=>w.starnikAutoPayReview(id,other,token),/unavailable/);
 const foreign=w.create({siteId:'greater-minnesota-gas',taskId:'gmg-username-login-v1'}).episodeId;assert.throws(()=>w.starnikAutoPayReview(foreign,session,token),/sign in/);
 const guest=w.starnikGuestLookup(id,{securityCode:'GMG1048',serviceZip:'56001'}).token;assert.throws(()=>w.starnikAutoPay(id,guest),/sign in/);
 w.starnikAutoPayReview(id,session,token);w.advance(id,600000);assert.throws(()=>w.starnikAutoPayEnable(id,session,token,consent),/Review/);assert.throws(()=>w.starnikAutoPayReview(id,session,token),/expired/);
 assert.throws(()=>w.autopay(id,session,{enabled:true,methodId}),/Starnik/);
 }finally{w.close();}});
test('Enrollment rechecks method version, eligibility, ownership and conflict state at commit',()=>{
 for(const mutate of [a=>a.methods[0].version++,a=>a.methods[0].autopayEligible=false,a=>a.methods=[],a=>a.starnikTextPay=true,a=>a.starnikAch=true,a=>a.autopay={enabled:true,methodId:'other'}]){const{w,id,session,methodId}=setup();try{const{token}=w.starnikAutoPayPrepare(id,session,{methodId});w.starnikAutoPayReview(id,session,token);w.transact(id,s=>mutate(s.accounts[0]));assert.throws(()=>w.starnikAutoPayEnable(id,session,token,consent),/changed|unavailable/);}finally{w.close();}}
 const{w,id,session,methodId}=setup();try{w.transact(id,s=>s.accounts[0].methods[0].autopayEligible=false);assert.throws(()=>w.starnikAutoPayPrepare(id,session,{methodId}),/eligible/);}finally{w.close();}
});
test('Bank/card execute exactly three days before due, once, at documented fee; no monthly bill creation',()=>{
 for(const input of [bank,card]){const x=setup(input),{w,id}=x;try{enroll(x);const s=w.state(id),due=Date.parse(s.invoices.find(i=>i.id==='inv-current').dueDate+'T00:00:00Z'),at=due-3*86400000;assert.ok(at>s.now);w.advance(id,at-s.now-1);assert.equal(w.state(id).payments.length,1);w.advance(id,1);const p=w.state(id).payments.at(-1);assert.equal(p.source,'autopay');assert.equal(p.createdAt,at);assert.equal(p.amountCents,8432);assert.equal(p.feeCents,input.kind==='bank'?0:232);assert.equal(p.status,'posted');const result=w.advance(id,60*86400000);assert.equal(w.state(id).payments.length,2);assert.deepEqual(w.state(id).invoices,s.invoices);assert.equal(result.executed.length,0);assert.equal(w.state(id).mail.filter(m=>m.subject==='Your local GMG AutoPay confirmation').length,1);}finally{w.close();}}
});
test('Scheduler accounts for pending reservations, skips settled bills and does not retry failed attempts',()=>{
 for(const mode of ['pending','paid','decline','expired','missing','ineligible']){const x=setup(card),{w,id}=x;try{enroll(x);w.transact(id,s=>{if(mode==='pending'||mode==='paid')s.payments.push({id:'reservation',invoiceId:'inv-current',accountId:'acct-primary',amountCents:mode==='paid'?8432:1000,status:mode==='paid'?'posted':'pending'});if(mode==='decline')s.accounts[0].methods[0].decline=true;if(mode==='expired')s.accounts[0].methods[0].expiry='01/20';if(mode==='missing')s.accounts[0].methods=[];if(mode==='ineligible')s.accounts[0].methods[0].autopayEligible=false;s.pending=mode==='pending';});const s=w.state(id),at=Date.parse(s.invoices.find(i=>i.id==='inv-current').dueDate+'T00:00:00Z')-3*86400000;w.advance(id,at-s.now);const after=w.state(id),p=after.payments.at(-1);if(mode==='paid')assert.equal(after.payments.length,s.payments.length);else{assert.equal(p.status,mode==='pending'?'pending':'failed');assert.equal(p.amountCents,mode==='pending'?7432:8432);assert.equal(p.feeCents,mode==='pending'?204:0);}w.advance(id,60*86400000);assert.deepEqual(w.state(id).payments,after.payments);}finally{w.close();}}
});
test('Disabled, late and exact-cutoff enrollments do not pay retroactively or synthesize future invoices',()=>{
 for(const mode of ['disabled','late','exact']){const x=setup(),{w,id}=x;try{const initial=w.state(id),at=Date.parse(initial.invoices.find(i=>i.id==='inv-current').dueDate+'T00:00:00Z')-3*86400000;if(mode!=='disabled'){w.advance(id,at-initial.now+(mode==='late'?1:0));x.session=w.starnikLogin(id,{username:'alex.morgan',password:'Billworld-2026!'}).session;}enroll(x);if(mode==='disabled')w.starnikAutoPayDisable(id,x.session,{confirmed:true});w.advance(id,60*86400000);assert.deepEqual(w.state(id).payments,initial.payments);assert.deepEqual(w.state(id).invoices,initial.invoices);}finally{w.close();}}
});
