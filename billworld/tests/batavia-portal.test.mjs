import test from 'node:test';
import assert from 'node:assert/strict';
import {World} from '../engine.mjs';
const P='Billworld-2026!';
function fixture(taskId,opts={}){const w=new World(':memory:',{construction:true}),id=w.create({siteId:'batavia-utilities',taskId,...opts}).episodeId,session=w.login(id,{email:'alex@billworld.test',password:P}).session;return{w,id,session,call:(name,input={},tokens={},method='POST')=>w.paymentusPortal(id,session,name,input,tokens,method)};}
const allTrue=r=>Object.entries(r.checks).filter(([,v])=>!v).map(([k])=>k);
const s=f=>f.w.state(f.id);

test('My Profile edits validate fields, record changed fields and pass the exact grader',()=>{const f=fixture('batavia-update-profile-v1');try{
 assert.equal(f.w.evaluate(f.id).success,false);
 const view=f.call('profile',{},{},'GET').result;assert.deepEqual([view.firstName,view.lastName,view.phone,view.zipCode],['Alex','Morgan','6305550148','60510']);
 for(const bad of [{firstName:'',lastName:'Morgan',phone:'6305550199',zipCode:'60510'},{firstName:'Alex',lastName:'Morgan',phone:'555',zipCode:'60510'},{firstName:'Alex',lastName:'Morgan',phone:'6305550199',zipCode:'6051'},{firstName:'Alex',lastName:'Morgan',phone:'6305550199',zipCode:'60510',email:'x@y.z'}])assert.throws(()=>f.call('profile',bad));
 assert.equal(f.call('profile',{firstName:'Alex',lastName:'Morgan',phone:'(630) 555-0199',zipCode:'60510'}).result.changed,true);
 assert.equal(f.call('profile',{firstName:'Alex',lastName:'Morgan',phone:'6305550199',zipCode:'60510'}).result.changed,false);
 assert.equal(f.w.evaluate(f.id).checks.reloaded_after_change,false);f.call('profile',{},{},'GET');assert.deepEqual(allTrue(f.w.evaluate(f.id)),[]);
 f.call('profile',{firstName:'Alexander',lastName:'Morgan',phone:'6305550199',zipCode:'60510'});f.call('profile',{},{},'GET');assert.equal(f.w.evaluate(f.id).success,false);
}finally{f.w.close();}});

test('Password change requires the current password, revokes other sessions and grades the relogin',()=>{const f=fixture('batavia-change-password-v1');try{
 const other=f.w.login(f.id,{email:'alex@billworld.test',password:P}).session;f.call('profile',{},{},'GET');
 assert.throws(()=>f.call('password',{currentPassword:'wrong-password',password:'Batavia-Secure-2026!',confirmPassword:'Batavia-Secure-2026!'}),/Current password/);
 assert.throws(()=>f.call('password',{currentPassword:P,password:'short',confirmPassword:'short'}));
 assert.throws(()=>f.call('password',{currentPassword:P,password:'Batavia-Secure-2026!',confirmPassword:'Batavia-Secure-2027!'}));
 assert.throws(()=>f.call('password',{currentPassword:P,password:P,confirmPassword:P}));
 assert.equal(f.call('password',{currentPassword:P,password:'Batavia-Secure-2026!',confirmPassword:'Batavia-Secure-2026!'}).result.revokedSessions,1);
 assert.equal(s(f).sessions[other],undefined);assert.ok(s(f).sessions[f.session]);assert.throws(()=>f.w.login(f.id,{email:'alex@billworld.test',password:P}));
 assert.equal(f.w.evaluate(f.id).checks.signed_in_with_new_password,false);
 f.w.logout(f.id,f.session);const fresh=f.w.login(f.id,{email:'alex@billworld.test',password:'Batavia-Secure-2026!'}).session;f.w.paymentusAccount(f.id,fresh);assert.deepEqual(allTrue(f.w.evaluate(f.id)),[]);
 assert.ok(s(f).mail.some(m=>m.subject==='Your local Batavia portal password changed'));
}finally{f.w.close();}});

test('Profile task rejects a password change shortcut and password task rejects profile edits',()=>{
 const a=fixture('batavia-update-profile-v1');try{a.call('profile',{},{},'GET');a.call('profile',{firstName:'Alex',lastName:'Morgan',phone:'6305550199',zipCode:'60510'});a.call('password',{currentPassword:P,password:'Batavia-Secure-2026!',confirmPassword:'Batavia-Secure-2026!'});a.call('profile',{},{},'GET');const r=a.w.evaluate(a.id);assert.equal(r.success,false);assert.equal(r.checks.credentials_unchanged,false);}finally{a.w.close();}
 const b=fixture('batavia-change-password-v1');try{b.call('profile',{},{},'GET');b.call('profile',{firstName:'Alex',lastName:'Morgan',phone:'6305550111',zipCode:'60510'});b.call('password',{currentPassword:P,password:'Batavia-Secure-2026!',confirmPassword:'Batavia-Secure-2026!'});const x=b.w.login(b.id,{email:'alex@billworld.test',password:'Batavia-Secure-2026!'}).session;b.w.paymentusAccount(b.id,x);const r=b.w.evaluate(b.id);assert.equal(r.success,false);assert.equal(r.checks.protected_business_unchanged,false);}finally{b.w.close();}
});

function scheduleQuote(f,amountCents=8432,input={methodId:'bank-1048'}){f.w.paymentusBills(f.id,f.session);return f.w.paymentusQuote(f.id,f.session,{invoiceId:'inv-current',amountCents,...input});}
test('Scheduling validates dates/consent, never pays immediately and grades the exact schedule',()=>{const f=fixture('batavia-schedule-payment-v1');try{
 const q=scheduleQuote(f);
 for(const date of ['2026-10-03','2026-10-02','2026-10-21','2026-13-01','10/15/2026'])assert.throws(()=>f.call('schedule',{authorize:true,date},{quote:q.token}));
 assert.throws(()=>f.call('schedule',{authorize:false,date:'2026-10-15'},{quote:q.token}));assert.throws(()=>f.call('schedule',{authorize:true,date:'2026-10-15'},{quote:'nope'}));
 const item=f.call('schedule',{authorize:true,date:'2026-10-15'},{quote:q.token}).result;assert.equal(item.status,'scheduled');assert.equal(item.method.instrumentHash,undefined);
 assert.deepEqual(f.call('schedule',{authorize:true,date:'2026-10-15'},{quote:q.token}).result,item);assert.throws(()=>f.call('schedule',{authorize:true,date:'2026-10-16'},{quote:q.token}));
 assert.throws(()=>f.w.paymentusPay(f.id,f.session,{token:q.token,authorize:true}),/scheduled/);
 assert.equal(s(f).payments.filter(p=>!p.initial).length,0);
 const r=f.w.evaluate(f.id,{confirmation:item.confirmation});assert.deepEqual(allTrue(r),[]);
 assert.equal(f.w.evaluate(f.id,{confirmation:'wrong'}).success,false);
 const q2=scheduleQuote(f,100);assert.throws(()=>f.call('schedule',{authorize:true,date:'2026-10-16'},{quote:q2.token}),/exceed/);
 const list=f.call('scheduled',{},{},'GET').result.scheduled;assert.equal(list.length,1);
}finally{f.w.close();}});

test('Schedule grader rejects wrong date, new instrument and immediate payment shortcuts',()=>{
 for(const variant of ['date','instrument','immediate']){const f=fixture('batavia-schedule-payment-v1');try{
  const q=scheduleQuote(f,8432,variant==='instrument'?{kind:'bank',name:'Alex Morgan',routing:'021000021',accountNumber:'000001048',confirmAccountNumber:'000001048'}:{methodId:'bank-1048'});
  let confirmation;if(variant==='immediate')confirmation=f.w.paymentusPay(f.id,f.session,{token:q.token,authorize:true}).confirmation;else confirmation=f.call('schedule',{authorize:true,date:variant==='date'?'2026-10-16':'2026-10-15'},{quote:q.token}).result.confirmation;
  assert.equal(f.w.evaluate(f.id,{confirmation}).success,false,variant);}finally{f.w.close();}}
});

test('Scheduled payments execute at 00:00 UTC before same-day AutoPay and recheck balance and method',()=>{
 const f=fixture('batavia-schedule-payment-v1');try{
  const item=f.call('schedule',{authorize:true,date:'2026-10-15'},{quote:scheduleQuote(f,5000).token}).result;
  f.w.advance(f.id,Date.parse('2026-10-14T23:59:00Z')-s(f).now);assert.equal(s(f).payments.filter(p=>!p.initial).length,0);
  f.w.advance(f.id,60000);const p=s(f).payments.find(p=>p.source==='scheduled');assert.equal(p.amountCents,5000);assert.equal(p.feeCents,350);assert.equal(p.status,'posted');assert.equal(p.confirmation,item.confirmation);assert.equal(p.createdAt,Date.parse('2026-10-15T00:00:00Z'));
  assert.equal(s(f).scheduledPayments.find(x=>x.id===item.id).status,'processed');const h=f.w.paymentusHistory(f.id,f.w.login(f.id,{email:'alex@billworld.test',password:P}).session).payments;assert.ok(h.some(x=>x.confirmation===item.confirmation));
  f.w.advance(f.id,86400000*30);assert.equal(s(f).payments.filter(p=>p.source==='scheduled').length,1);
 }finally{f.w.close();}
 const g=fixture('batavia-schedule-payment-v1');try{
  g.call('schedule',{authorize:true,date:'2026-10-20'},{quote:scheduleQuote(g,3000).token});
  g.w.transact(g.id,st=>{st.accounts[0].autopay={enabled:true,methodId:'card-4242',profileId:'acct-primary',rule:'invoice_due_date',timezone:'UTC',enrolledAt:st.now};});
  g.w.advance(g.id,Date.parse('2026-10-20T00:00:00Z')-s(g).now);const added=s(g).payments.filter(p=>!p.initial);
  assert.deepEqual(added.map(p=>[p.source,p.amountCents]),[['scheduled',3000],['autopay',5432]]);
 }finally{g.w.close();}
 const h=fixture('batavia-schedule-payment-v1');try{
  h.call('schedule',{authorize:true,date:'2026-10-15'},{quote:scheduleQuote(h,8432).token});const q=scheduleQuote(h,8432,{kind:'card',name:'Alex Morgan',cardNumber:'4242424242424242',expiry:'12/29',cvv:'123'});h.w.paymentusPay(h.id,h.session,{token:q.token,authorize:true});
  h.w.advance(h.id,Date.parse('2026-10-16T00:00:00Z')-s(h).now);const item=s(h).scheduledPayments[0];assert.equal(item.status,'failed');assert.equal(item.failureReason,'balance_changed');assert.equal(s(h).payments.filter(p=>p.source==='scheduled').length,0);assert.ok(s(h).mail.some(m=>m.subject==='Your local Batavia scheduled payment was not processed'));
 }finally{h.w.close();}
 const k=fixture('batavia-schedule-payment-v1');try{
  k.call('schedule',{authorize:true,date:'2026-10-15'},{quote:scheduleQuote(k,1000).token});k.w.wallet(k.id,k.session,'edit',{methodId:'bank-1048',name:'Alex M Morgan'});
  k.w.advance(k.id,Date.parse('2026-10-16T00:00:00Z')-s(k).now);assert.equal(s(k).scheduledPayments[0].failureReason,'method_unavailable');
 }finally{k.w.close();}
});

test('Seeded scheduled payment edit and cancel use versions, stay scoped and grade exactly',()=>{
 const f=fixture('batavia-edit-scheduled-payment-v1');try{
  const list=f.call('scheduled',{},{},'GET').result.scheduled;assert.equal(list.length,1);const p=list[0];assert.equal(p.confirmation,'BWS-SEED-1048');
  assert.throws(()=>f.call('scheduled-edit',{scheduleId:p.id,version:p.version+1,date:'2026-10-12',amountCents:6000}),/changed/);
  for(const bad of [{date:'2026-10-03',amountCents:6000},{date:'2026-10-21',amountCents:6000},{date:'2026-10-12',amountCents:0},{date:'2026-10-12',amountCents:8433},{date:'2026-10-12',amountCents:'6000'}])assert.throws(()=>f.call('scheduled-edit',{scheduleId:p.id,version:p.version,...bad}));
  assert.throws(()=>f.call('scheduled-edit',{scheduleId:'pms-other',version:1,date:'2026-10-12',amountCents:6000}),/not found/);
  const other=f.w.login(f.id,{email:'jordan@billworld.test',password:'Other-2026!'}).session;assert.throws(()=>f.w.paymentusPortal(f.id,other,'scheduled-cancel',{scheduleId:p.id,version:1,confirm:true},{},'POST'),/not found/);
  const edited=f.call('scheduled-edit',{scheduleId:p.id,version:p.version,date:'2026-10-12',amountCents:6000}).result;assert.equal(edited.version,2);assert.equal(f.w.evaluate(f.id).checks.reloaded_after_change,false);
  f.call('scheduled',{},{},'GET');assert.deepEqual(allTrue(f.w.evaluate(f.id)),[]);
  f.call('scheduled-edit',{scheduleId:p.id,version:2,date:'2026-10-13',amountCents:6000});f.call('scheduled',{},{},'GET');assert.equal(f.w.evaluate(f.id).success,false);
 }finally{f.w.close();}
 const c=fixture('batavia-cancel-scheduled-payment-v1');try{
  const p=c.call('scheduled',{},{},'GET').result.scheduled[0];assert.throws(()=>c.call('scheduled-cancel',{scheduleId:p.id,version:1,confirm:false}));
  assert.equal(c.call('scheduled-cancel',{scheduleId:p.id,version:1,confirm:true}).result.status,'cancelled');assert.throws(()=>c.call('scheduled-cancel',{scheduleId:p.id,version:2,confirm:true}),/Only a scheduled/);
  c.call('scheduled',{},{},'GET');assert.deepEqual(allTrue(c.w.evaluate(c.id)),[]);
  c.w.advance(c.id,30*86400000);assert.equal(c.w.state(c.id).payments.filter(p=>!p.initial).length,0);
 }finally{c.w.close();}
 const d=fixture('batavia-cancel-scheduled-payment-v1');try{const p=d.call('scheduled',{},{},'GET').result.scheduled[0];d.call('scheduled-edit',{scheduleId:p.id,version:1,date:'2026-10-12',amountCents:100});d.call('scheduled-cancel',{scheduleId:p.id,version:2,confirm:true});d.call('scheduled',{},{},'GET');assert.equal(d.w.evaluate(d.id).success,false);}finally{d.w.close();}
 const e=fixture('batavia-cancel-scheduled-payment-v1');try{const p=e.call('scheduled',{},{},'GET').result.scheduled[0];e.call('scheduled-cancel',{scheduleId:p.id,version:1,confirm:true});e.call('scheduled',{},{},'GET');const q=scheduleQuote(e,8432,{methodId:'bank-1048'});e.w.paymentusPay(e.id,e.session,{token:q.token,authorize:true});assert.equal(e.w.evaluate(e.id).success,false);}finally{e.w.close();}
});

test('Multi-account payment allocates one grouped payment with one fee and grades exactly',()=>{const f=fixture('batavia-pay-multiple-accounts-v1');try{
 const view=f.call('multi',{},{},'GET').result;assert.deepEqual(view.bills.map(b=>[b.id,b.remainingCents]),[['inv-current',8432],['inv-wilson',4115]]);
 const acct=f.w.paymentusAccount(f.id,f.session);assert.equal(acct.links.length,2);
 for(const bad of [{allocations:[{invoiceId:'inv-current',amountCents:8432}],methodId:'bank-1048'},{allocations:[{invoiceId:'inv-current',amountCents:8432},{invoiceId:'inv-other',amountCents:5190}],methodId:'bank-1048'},{allocations:[{invoiceId:'inv-current',amountCents:8433},{invoiceId:'inv-wilson',amountCents:4115}],methodId:'bank-1048'},{allocations:[{invoiceId:'inv-current',amountCents:8432},{invoiceId:'inv-current',amountCents:1}],methodId:'bank-1048'},{allocations:[{invoiceId:'inv-current',amountCents:8432},{invoiceId:'inv-wilson',amountCents:4115}],methodId:'bank-1048',extra:true}])assert.throws(()=>f.call('multi-quote',bad));
 const q=f.call('multi-quote',{allocations:[{invoiceId:'inv-current',amountCents:8432},{invoiceId:'inv-wilson',amountCents:4115}],methodId:'bank-1048'});assert.equal(q.cookie.name,'bw_paymentus_quote');assert.equal(q.result.totalCents,12897);
 assert.equal(f.call('multi-review',{},{quote:q.cookie.value},'GET').result.feeCents,350);assert.throws(()=>f.call('multi-receipt',{},{quote:q.cookie.value},'GET'));
 assert.throws(()=>f.call('multi-pay',{authorize:false},{quote:q.cookie.value}));assert.throws(()=>f.w.paymentusPay(f.id,f.session,{token:q.cookie.value,authorize:true}));
 const paid=f.call('multi-pay',{authorize:true},{quote:q.cookie.value}).result;assert.match(paid.confirmation,/^BWM-/);assert.deepEqual(f.call('multi-pay',{authorize:true},{quote:q.cookie.value}).result,paid);
 const added=s(f).payments.filter(p=>!p.initial);assert.deepEqual(added.map(p=>[p.invoiceId,p.amountCents,p.feeCents]),[['inv-current',8432,350],['inv-wilson',4115,0]]);
 assert.equal(f.w.evaluate(f.id,{confirmation:paid.confirmation}).checks.view_review_pay_receipt_order,false);
 f.call('multi-receipt',{},{quote:q.cookie.value},'GET');assert.deepEqual(allTrue(f.w.evaluate(f.id,{confirmation:paid.confirmation})),[]);
 assert.equal(f.w.evaluate(f.id,{confirmation:'BWM-wrong'}).success,false);
 const summary=f.w.paymentusAccount(f.id,f.session).links;assert.ok(summary.every(l=>l.availableCents===0));
 const history=f.w.paymentusHistory(f.id,f.session).payments.filter(p=>p.confirmation===paid.confirmation);assert.equal(history.length,2);
 assert.ok(s(f).mail.some(m=>m.text.includes(paid.confirmation)&&m.text.includes('$128.97')));
}finally{f.w.close();}});

test('Multi-account grader rejects separate payments, card shortcut and limit overflow',()=>{
 const f=fixture('batavia-pay-multiple-accounts-v1');try{f.call('multi',{},{},'GET');let last;for(const inv of ['inv-current','inv-wilson']){f.w.paymentusBills(f.id,f.session);const q=f.w.paymentusQuote(f.id,f.session,{invoiceId:inv,amountCents:inv==='inv-current'?8432:4115,methodId:'bank-1048'});last=f.w.paymentusPay(f.id,f.session,{token:q.token,authorize:true});}assert.equal(f.w.evaluate(f.id,{confirmation:last.confirmation}).success,false);}finally{f.w.close();}
 const g=fixture('batavia-pay-multiple-accounts-v1');try{g.call('multi',{},{},'GET');const q=g.call('multi-quote',{allocations:[{invoiceId:'inv-current',amountCents:8432},{invoiceId:'inv-wilson',amountCents:4115}],methodId:'card-4242'});const r=g.call('multi-pay',{authorize:true},{quote:q.cookie.value}).result;g.call('multi-receipt',{},{quote:q.cookie.value},'GET');assert.equal(g.w.evaluate(g.id,{confirmation:r.confirmation}).success,false);}finally{g.w.close();}
 const h=fixture('batavia-pay-multiple-accounts-v1');try{h.w.transact(h.id,st=>{st.invoices.find(i=>i.id==='inv-wilson').amountCents=45000;});assert.throws(()=>h.call('multi-quote',{allocations:[{invoiceId:'inv-current',amountCents:8432},{invoiceId:'inv-wilson',amountCents:45000}],methodId:'bank-1048'}),/at most \$500/);}finally{h.w.close();}
 const d=fixture('batavia-pay-multiple-accounts-v1');try{const q=d.call('multi-quote',{allocations:[{invoiceId:'inv-current',amountCents:8432},{invoiceId:'inv-wilson',amountCents:4115}],methodId:'card-decline'});assert.equal(d.call('multi-pay',{authorize:true},{quote:q.cookie.value}).result.declined,true);assert.equal(d.w.state(d.id).payments.filter(p=>!p.initial).length,0);}finally{d.w.close();}
});

test('Existing Batavia graders reject the new portal mutations',()=>{
 const f=fixture('batavia-email-login-v1');try{f.w.paymentusAccount(f.id,f.session);assert.equal(f.w.evaluate(f.id).success,true);f.call('password',{currentPassword:P,password:'Batavia-Secure-2026!',confirmPassword:'Batavia-Secure-2026!'});assert.equal(f.w.evaluate(f.id).success,false);}finally{f.w.close();}
 const g=fixture('batavia-email-login-v1');try{g.w.paymentusAccount(g.id,g.session);g.call('schedule',{authorize:true,date:'2026-10-15'},{quote:scheduleQuote(g,100).token});assert.equal(g.w.evaluate(g.id).success,false);}finally{g.w.close();}
 const h=fixture('batavia-email-login-v1');try{assert.throws(()=>h.call('multi-quote',{allocations:[{invoiceId:'inv-current',amountCents:8432},{invoiceId:'inv-other',amountCents:5190}],methodId:'bank-1048'}),/Linked bill/);assert.throws(()=>h.call('unknown',{}),/unavailable/);}finally{h.w.close();}
});
