import test from 'node:test';import assert from 'node:assert/strict';
import {World} from '../engine.mjs';import {sites,tasks} from '../registry.mjs';
const LOCKWOOD=['lockwood-username-login-v1','lockwood-recover-login-v1','lockwood-pay-current-card-v1','lockwood-register-login-v1','lockwood-echeck-link-pay-v1','lockwood-schedule-draft-v1','lockwood-manage-drafts-v1','lockwood-autopay-enroll-v1','lockwood-autopay-change-v1','lockwood-autopay-cancel-v1','lockwood-paperless-v1'];
function fixture(taskId){const w=new World(':memory:'),f=w.create({siteId:'lockwood',taskId}),id=f.episodeId,{session}=w.cusiLogin(id,{username:'alex.morgan',password:'Billworld-2026!'}),P=(op,i={},t)=>w.cusiPortal(id,session,op,i,t);return{w,id,session,P,s:()=>w.state(id)};}
const BANK={name:'Alex Morgan',routing:'021000021',accountNumber:'000001048',confirmAccountNumber:'000001048',accountType:'Checking',email:'alex@billworld.test',consent:true};
const CARD={name:'Alex Morgan',cardNumber:'4242424242424242',expiry:'12/29',cvv:'123'};
function pay(P,input){const q=P('payment/quote',input);P('payment/review',{},q.token);return{token:q.token,result:P('payment/confirm',{authorize:true},q.token)};}

test('Lockwood is a released first slice with eleven released tasks',()=>{assert.equal(sites.get('lockwood')?.implementation_status,'first_slice');for(const id of LOCKWOOD)assert.equal(tasks.get(id)?.site_id,'lockwood',id);});

test('E-Check task: linked verified bank, reviewed payment and later history read are all required',()=>{
 const{w,id,P}=fixture('lockwood-echeck-link-pay-v1');P('bill',{invoiceId:'inv-current'});
 assert.throws(()=>P('payment/quote',{invoiceId:'inv-current',option:'echeck',amountCents:8432}),/saved payment method/);
 assert.throws(()=>P('wallet/bank',{...BANK,consent:false}),/Authorize/);const m=P('wallet/bank',BANK).method;assert.equal(m.status,'Verified');assert.throws(()=>P('wallet/bank',BANK),/already linked/);
 const q=P('payment/quote',{invoiceId:'inv-current',option:'echeck',amountCents:8432,methodId:m.id});assert.throws(()=>P('payment/confirm',{authorize:true},q.token),/Review the payment/);
 P('payment/review',{},q.token);assert.throws(()=>P('payment/confirm',{authorize:false},q.token),/Authorize/);const p=P('payment/confirm',{authorize:true},q.token).payment;assert.equal(p.feeCents,0);
 assert.equal(P('payment/confirm',{authorize:true},q.token).payment.id,p.id,'idempotent commit');
 let r=w.evaluate(id,{confirmation:p.confirmation});assert.equal(r.success,false);assert.equal(r.checks.history_after_payment,false);
 P('history');r=w.evaluate(id,{confirmation:p.confirmation});assert.equal(r.success,true,JSON.stringify(r.checks));
 P('preferences/save',{version:1,paperless:false,email:true,phoneCall:true,printed:true});assert.equal(w.evaluate(id,{confirmation:p.confirmation}).checks.protected_state_unchanged,false);
});
test('E-Check grader rejects card payments, wrong bank and a second payment',()=>{
 {const{w,id,P}=fixture('lockwood-echeck-link-pay-v1');P('bill',{invoiceId:'inv-current'});P('wallet/bank',BANK);const{result}=pay(P,{invoiceId:'inv-current',option:'card',amountCents:8432,...CARD});P('history');assert.equal(w.evaluate(id,{confirmation:result.payment.confirmation}).success,false);}
 {const{w,id,P}=fixture('lockwood-echeck-link-pay-v1');P('bill',{invoiceId:'inv-current'});const m=P('wallet/bank',{...BANK,routing:'011000015',accountNumber:'12345678',confirmAccountNumber:'12345678'}).method;const{result}=pay(P,{invoiceId:'inv-current',option:'echeck',amountCents:8432,methodId:m.id});P('history');const r=w.evaluate(id,{confirmation:result.payment.confirmation});assert.equal(r.checks.one_linked_bank,false);}
 {const{w,id,P}=fixture('lockwood-echeck-link-pay-v1');P('bill',{invoiceId:'inv-current'});const m=P('wallet/bank',BANK).method;pay(P,{invoiceId:'inv-current',option:'echeck',amountCents:4000,methodId:m.id});const{result}=pay(P,{invoiceId:'inv-current',option:'echeck',amountCents:4432,methodId:m.id});P('history');assert.equal(w.evaluate(id,{confirmation:result.payment.confirmation}).checks.one_exact_payment,false);}
});
test('Scheduled bank draft enforces future date, late acknowledgement, disconnect cutoff and verified bank',()=>{
 const{w,id,P,s}=fixture('lockwood-schedule-draft-v1');const base={invoiceId:'inv-current',option:'draft',amountCents:8432,methodId:'cusi-bank-1048'};
 assert.throws(()=>P('payment/quote',{...base,date:'2026-10-03'}),/future/);assert.throws(()=>P('payment/quote',{...base,date:'2026-10-18'}),/late penalty/);assert.throws(()=>P('payment/quote',{...base,date:'2026-10-26',acknowledgeLate:true}),/discontinued/);
 assert.throws(()=>P('payment/quote',{...base,methodId:'cusi-card-4242',date:'2026-10-14'}),/linked bank/);assert.throws(()=>P('payment/quote',{...base,amountCents:9000,date:'2026-10-14'}),/exceeds/);
 const{token,result}=pay(P,{...base,date:'2026-10-14'});assert.equal(result.kind,'draft');assert.equal(s().payments.filter(p=>!p.initial).length,0);
 let r=w.evaluate(id,{scheduledDate:'2026-10-14'});assert.equal(r.checks.receipt_viewed,false);P('payment/receipt',{},token);r=w.evaluate(id,{scheduledDate:'2026-10-14'});assert.equal(r.success,true,JSON.stringify(r.checks));
 assert.equal(w.evaluate(id,{scheduledDate:'2026-10-15'}).success,false);
 w.advance(id,11*86400000);const p=s().payments.at(-1);assert.equal(p.source,'scheduled_bank_draft');assert.equal(p.amountCents,8432);assert.equal(s().scheduledPayments[0].status,'processed');
});
test('Wrong scheduled date or an immediate payment fails the schedule task',()=>{
 {const{w,id,P}=fixture('lockwood-schedule-draft-v1');const{token}=pay(P,{invoiceId:'inv-current',option:'draft',amountCents:8432,methodId:'cusi-bank-1048',date:'2026-10-13'});P('payment/receipt',{},token);assert.equal(w.evaluate(id,{scheduledDate:'2026-10-13'}).checks.one_exact_draft,false);}
 {const{w,id,P}=fixture('lockwood-schedule-draft-v1');pay(P,{invoiceId:'inv-current',option:'echeck',amountCents:8432,methodId:'cusi-bank-1048'});assert.equal(w.evaluate(id,{scheduledDate:'2026-10-14'}).success,false);}
});
test('Draft management grades exact reschedule and cancellation; cancelled and underfunded drafts never pay',()=>{
 const{w,id,P,s}=fixture('lockwood-manage-drafts-v1');
 assert.throws(()=>P('scheduled/update',{scheduleId:'draft-1',version:9,date:'2026-10-09',amountCents:8432}),/changed/);assert.throws(()=>P('scheduled/cancel',{scheduleId:'draft-2'}),/Confirm/);
 P('scheduled/update',{scheduleId:'draft-1',version:1,date:'2026-10-09',amountCents:8432});P('scheduled/cancel',{scheduleId:'draft-2',confirm:true});assert.throws(()=>P('scheduled/cancel',{scheduleId:'draft-2',confirm:true}),/not found/);
 let r=w.evaluate(id);assert.equal(r.checks.final_read_after_changes,false);P('history');r=w.evaluate(id);assert.equal(r.success,true,JSON.stringify(r.checks));
 w.advance(id,10*86400000);assert.equal(s().payments.filter(p=>!p.initial).length,1);assert.equal(s().scheduledPayments[1].status,'cancelled');
 const other=fixture('lockwood-manage-drafts-v1');other.P('scheduled/cancel',{scheduleId:'draft-1',confirm:true});other.P('scheduled/cancel',{scheduleId:'draft-2',confirm:true});other.P('history');assert.equal(other.w.evaluate(other.id).success,false);
 const both=fixture('lockwood-manage-drafts-v1');both.w.advance(both.id,11*86400000);const st=both.s();assert.deepEqual(st.scheduledPayments.map(d=>d.status),['failed','processed']);assert.equal(st.scheduledPayments[0].failureReason,'balance_changed');
});
test('AutoPay enrollment, change and cancellation are reviewed, versioned and graded exactly',()=>{
 {const{w,id,P,s}=fixture('lockwood-autopay-enroll-v1');P('autopay');assert.throws(()=>P('autopay/quote',{option:'weekly',amountCents:15000,...CARD}),/Payment Option/);
  const q=P('autopay/quote',{option:'maximum',amountCents:15000,...CARD});assert.throws(()=>P('autopay/confirm',{authorize:true},q.token),/review/i);P('autopay/review',{},q.token);P('autopay/confirm',{authorize:true},q.token);
  assert.equal(P('autopay/confirm',{authorize:true},q.token).idempotent,true);let r=w.evaluate(id);assert.equal(r.checks.final_read_after_change,false);P('autopay');r=w.evaluate(id);assert.equal(r.success,true,JSON.stringify(r.checks));
  w.advance(id,12*86400000);assert.equal(s().payments.at(-1).source,'autopay');}
 {const{w,id,P}=fixture('lockwood-autopay-enroll-v1');P('autopay');const q=P('autopay/quote',{option:'fixed',amountCents:15000,...CARD});P('autopay/review',{},q.token);P('autopay/confirm',{authorize:true},q.token);P('autopay');assert.equal(w.evaluate(id).checks.exact_enrollment,false);}
 {const{w,id,P}=fixture('lockwood-autopay-change-v1');P('autopay');assert.throws(()=>P('wallet/remove',{methodId:'cusi-card-4242'}),/AutoPay/);const q=P('autopay/quote',{option:'maximum',amountCents:20000,methodId:'cusi-bank-1048'});P('autopay/review',{},q.token);P('autopay/confirm',{authorize:true},q.token);P('autopay');const r=w.evaluate(id);assert.equal(r.success,true,JSON.stringify(r.checks));}
 {const{w,id,P}=fixture('lockwood-autopay-cancel-v1');P('autopay');assert.throws(()=>P('autopay/cancel',{confirm:true,version:1}),/changed/);P('autopay/cancel',{confirm:true,version:2});P('autopay');assert.equal(w.evaluate(id).success,true);}
 {const{w,id,P}=fixture('lockwood-autopay-cancel-v1');P('autopay');P('autopay/cancel',{confirm:true,version:2});P('wallet/remove',{methodId:'cusi-card-4242'});P('autopay');assert.equal(w.evaluate(id).success,false);}
});
test('AutoPay Maximum Amount skips a larger bill; Fixed Amount pays only up to the unpaid balance',()=>{
 const{w,id,P,s}=fixture('lockwood-autopay-enroll-v1');const q=P('autopay/quote',{option:'maximum',amountCents:5000,...CARD});P('autopay/review',{},q.token);P('autopay/confirm',{authorize:true},q.token);
 w.advance(id,12*86400000);assert.equal(s().payments.filter(p=>!p.initial).length,0);assert.ok(s().events.some(e=>e.type==='autopay_skipped'&&e.reason==='exceeds_maximum'));
 const b=fixture('lockwood-autopay-change-v1');b.w.advance(b.id,12*86400000);const p=b.s().payments.at(-1);assert.equal(p.amountCents,5000);assert.equal(p.feeCents,250);
});
test('Preferences enforce paperless rules and the documented penalty applies after the 15th',()=>{
 const{w,id,P,s}=fixture('lockwood-paperless-v1');P('preferences');assert.throws(()=>P('preferences/save',{version:1,paperless:true,email:false,phoneCall:true,printed:false}),/Email/);assert.throws(()=>P('preferences/save',{version:1,paperless:true,email:true,phoneCall:false,printed:true}),/Printed/);
 P('preferences/save',{version:1,paperless:true,email:true,phoneCall:true,printed:false});P('preferences');assert.equal(w.evaluate(id).success,true);
 w.advance(id,13*86400000);const pen=s().invoices.find(i=>i.penalty);assert.equal(pen.amountCents,843);assert.equal(pen.parentInvoiceId,'inv-current');assert.ok(s().mail.some(m=>m.subject==='Lockwood late penalty notice'));
});
test('Portal operations require a session and cannot read or pay another account',()=>{
 const{w,id,P,session}=fixture('lockwood-pay-current-card-v1');assert.throws(()=>w.cusiPortal(id,'nope','overview'),/sign in/);assert.throws(()=>P('bill',{invoiceId:'inv-other'}),/not found/);assert.throws(()=>P('payment/quote',{invoiceId:'inv-other',option:'card',amountCents:100,...CARD}),/not found/);
 const q=P('payment/quote',{invoiceId:'inv-current',option:'card',amountCents:8432,...CARD});const other=w.cusiLogin(id,{username:'jordan.lee',password:'Other-2026!'}).session;assert.throws(()=>w.cusiPortal(id,other,'payment/review',{},q.token),/not found/);
 P('bill',{invoiceId:'inv-current'});P('payment/review',{},q.token);const p=P('payment/confirm',{authorize:true},q.token).payment;assert.equal(w.evaluate(id,{confirmation:p.confirmation}).success,true);void session;
});
