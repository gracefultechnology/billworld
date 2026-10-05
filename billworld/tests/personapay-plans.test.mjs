import test from 'node:test';import assert from 'node:assert/strict';import {World} from '../engine.mjs';import {dentalPlanSchedule,dentalMonth} from '../personapay-plans.mjs';
const identity={accountNumber:'123001048',zipCode:'56007',dateOfBirth:'04/12/1985'},bank={kind:'bank',name:'Alex Morgan',routing:'021000021',accountNumber:'000001048',confirmAccountNumber:'000001048'},card={kind:'card',name:'Alex Morgan',cardNumber:'4000000000000002',expiry:'12/29',cvv:'123'};
const base={...bank,type:'recurring',invoiceIds:['inv-current','inv-second'],amountCents:20932,initialCents:0,cycles:2,recurrence:'Monthly',firstDate:'2026-10-10'};
function make(){const w=new World(),f=w.create({siteId:'western-dental'}),id=f.episodeId,session=w.personaPayLogin(id,identity).session;return{w,id,session};}
const enroll=(w,id,session,extra={})=>w.personaPayPlanEnroll(id,session,{token:w.personaPayPlanQuote(id,session,{...base,...extra}).token,authorize:true});
const advance=(w,id,date)=>w.advance(id,Date.parse(date)-w.state(id).now);
test('Calendar anchors, cadence, first-date limits, minimum installment and horizon are enforced',()=>{
 assert.equal(dentalMonth('2026-01-31',1),'2026-02-28');assert.equal(dentalMonth('2026-01-31',2),'2026-03-31');
 const now=Date.parse('2026-10-03T16:00:00Z'),lines=[{invoiceId:'a',balanceCents:500000}];
 for(const recurrence of ['Monthly','BiWeekly','Weekly']){const s=dentalPlanSchedule({...base,recurrence,amountCents:500001-1,cycles:3},lines,now);assert.equal(s.installments.reduce((n,i)=>n+i.amountCents,0),500000);assert.equal(s.installments[1].date,recurrence==='Monthly'?'2026-11-10':recurrence==='BiWeekly'?'2026-10-24':'2026-10-17');}
 for(const extra of [{firstDate:'2026-10-11'},{firstDate:'2026-10-02'},{firstDate:'2026-02-30'},{cycles:3},{amountCents:9999},{initialCents:-1},{initialCents:20932},{recurrence:'Daily'}])assert.throws(()=>dentalPlanSchedule({...base,...extra},[{invoiceId:'a',balanceCents:20932}],now));
 assert.throws(()=>dentalPlanSchedule({...base,amountCents:500000,cycles:40},lines,now),/36 months/);
 assert.throws(()=>dentalPlanSchedule({...base,type:'future',firstDate:'2026-10-08'},lines,now),/4 days/);
});
test('Plan enrollment is consented, idempotent and leaves utility AutoPay and saved wallet unchanged',()=>{
 const {w,id,session}=make();try{
  const q=w.personaPayPlanQuote(id,session,base);assert.throws(()=>w.personaPayPlanEnroll(id,session,{token:q.token,authorize:'true'}),/Authorize/);
  const p=w.personaPayPlanEnroll(id,session,{token:q.token,authorize:true});assert.equal(p.status,'active');assert.deepEqual(p.installments.map(i=>i.amountCents),[10466,10466]);
  assert.equal(w.personaPayPlanEnroll(id,session,{token:q.token,authorize:true}).id,p.id);assert.equal(w.personaPayPlans(id,session).length,1);
  assert.equal(w.state(id).payments.filter(p=>!p.initial).length,0);assert.equal(w.state(id).accounts[0].autopay.enabled,false);assert.deepEqual(w.state(id).accounts[0].methods,[]);
  assert.throws(()=>w.personaPayPlanQuote(id,session,base),/already exists/);assert.equal(JSON.stringify(w.state(id)).includes(bank.accountNumber),false);
 }finally{w.close();}
});
test('Scheduled installments execute exactly once, preserve cents and never generate utility invoices',()=>{
 const {w,id,session}=make();try{
  const p=enroll(w,id,session);advance(w,id,'2026-10-10T00:00:00Z');assert.equal(w.state(id).payments.filter(p=>!p.initial).length,1);
  w.advance(id,0);assert.equal(w.state(id).payments.filter(p=>!p.initial).length,1);
  advance(w,id,'2026-11-10T00:00:00Z');const s=w.state(id);assert.equal(s.payments.filter(p=>!p.initial).length,2);assert.equal(s.dentalPlans[0].status,'completed');assert.equal(s.invoices.length,4);
  assert.equal(s.invoices.find(i=>i.id==='inv-other').amountCents,5190);assert.ok(!s.mail.some(m=>/water\/sewer|water bill/.test(m.subject)));assert.ok(!s.events.some(e=>e.type==='invoice_created'));
  const newSession=w.personaPayLogin(id,identity).session;assert.equal(w.personaPayStatement(id,newSession).balanceCents,0);assert.equal(w.personaPayPlans(id,newSession)[0].confirmation,p.confirmation);
 }finally{w.close();}
});
test('Cancellation is authorized and idempotent; future installments stop without refunding posted payments',()=>{
 const {w,id,session}=make();try{
  const p=enroll(w,id,session),other=w.create({siteId:'western-dental'}).episodeId,otherSession=w.personaPayLogin(other,identity).session;
  assert.throws(()=>w.personaPayPlanCancel(other,otherSession,{planId:p.id}),/unavailable/);
  advance(w,id,'2026-10-10T00:00:00Z');const signed=w.personaPayLogin(id,identity).session;
  assert.equal(w.personaPayPlanCancel(id,signed,{planId:p.id}).status,'cancelled');w.personaPayPlanCancel(id,signed,{planId:p.id});
  advance(w,id,'2026-12-10T00:00:00Z');assert.equal(w.state(id).payments.filter(p=>!p.initial).length,1);assert.equal(w.state(id).events.filter(e=>e.type==='dental_plan_cancelled').length,1);
 }finally{w.close();}
});
test('One-time payments remain available while the plan is open; installments cap to remaining selected debt',()=>{
 const {w,id,session}=make();try{
  enroll(w,id,session);const q=w.personaPayQuote(id,session,{...bank,amountCents:20832});w.personaPayPay(id,session,{token:q.token});
  advance(w,id,'2026-11-10T00:00:00Z');const payments=w.state(id).payments.filter(p=>!p.initial);assert.equal(payments.reduce((n,p)=>n+(p.status==='posted'?p.amountCents:0),0),20932);assert.equal(payments.filter(p=>p.source==='dental_plan').length,1);
  assert.equal(w.state(id).dentalPlans[0].installments[0].actualAmountCents,100);assert.equal(w.state(id).dentalPlans[0].installments[1].status,'skipped');assert.equal(w.state(id).payments.some(p=>p.creditCents>0),false);
 }finally{w.close();}
});
test('Initial decline closes the recurring plan; scheduled decline does not retry or falsely complete it',()=>{
 const {w,id,session}=make();try{
  const closed=enroll(w,id,session,{...card,initialCents:10000,cycles:1});assert.equal(closed.status,'closed_initial_decline');assert.equal(w.state(id).payments.filter(p=>!p.initial)[0].status,'failed');
  const active=enroll(w,id,session,{...card});assert.equal(active.status,'active');advance(w,id,'2026-11-10T00:00:00Z');assert.equal(w.state(id).dentalPlans[1].status,'needs_attention');const count=w.state(id).payments.length;w.advance(id,0);assert.equal(w.state(id).payments.length,count);
  assert.equal(w.state(id).payments.some(p=>!p.initial&&p.status==='posted'),false);
 }finally{w.close();}
});
test('Future payment executes within four days with no initial installment or new recurring invoice',()=>{
 const {w,id,session}=make();try{
  const p=enroll(w,id,session,{type:'future',amountCents:10000,firstDate:'2026-10-07'});assert.equal(p.installments.length,1);assert.equal(p.recurrence,null);
  advance(w,id,'2026-10-07T00:00:00Z');assert.equal(w.state(id).dentalPlans[0].status,'completed');assert.equal(w.state(id).payments.filter(p=>!p.initial).length,1);
 }finally{w.close();}
});
test('Reviews cannot cross sessions/episodes, survive expiry or enroll against changed charge balances',()=>{
 const {w,id,session}=make();try{
  const q=w.personaPayPlanQuote(id,session,base),other=w.create({siteId:'western-dental'}).episodeId;
  assert.throws(()=>w.personaPayPlanEnroll(other,w.personaPayLogin(other,identity).session,{token:q.token,authorize:true}),/unavailable/);
  assert.throws(()=>w.personaPayPlanEnroll(id,w.personaPayLogin(id,identity).session,{token:q.token,authorize:true}),/unavailable/);
  const pay=w.personaPayQuote(id,session,{...bank,amountCents:10000});w.personaPayPay(id,session,{token:pay.token});assert.throws(()=>w.personaPayPlanEnroll(id,session,{token:q.token,authorize:true}),/balance changed/);
  const fresh=w.personaPayPlanQuote(id,session,{...base,amountCents:10932,cycles:1});w.advance(id,11*60000);assert.throws(()=>w.personaPayPlanEnroll(id,session,{token:fresh.token,authorize:true}),/expired/);
 }finally{w.close();}
});
test('Card expiry is checked at each installment, not only at enrollment',()=>{
 const {w,id,session}=make();try{
  enroll(w,id,session,{...card,cardNumber:'4242424242424242',expiry:'10/26'});advance(w,id,'2026-11-10T00:00:00Z');
  const payments=w.state(id).payments.filter(p=>!p.initial);assert.equal(payments[0].status,'posted');assert.equal(payments[1].status,'failed');assert.equal(payments[1].failureReason,'card_expired');assert.equal(w.state(id).dentalPlans[0].status,'needs_attention');
 }finally{w.close();}
});
test('Future schedules coexist with a recurring plan and cannot double-charge settled debt',()=>{
 const {w,id,session}=make();try{
  enroll(w,id,session);enroll(w,id,session,{type:'future',firstDate:'2026-10-07',amountCents:20932});advance(w,id,'2026-11-10T00:00:00Z');
  assert.equal(w.state(id).payments.filter(p=>!p.initial).length,1);assert.equal(w.state(id).dentalPlans[0].installments.every(i=>i.status==='skipped'),true);
 }finally{w.close();}
});
