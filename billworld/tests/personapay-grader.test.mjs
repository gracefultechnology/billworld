import test from 'node:test';import assert from 'node:assert/strict';import {World} from '../engine.mjs';
const identity={accountNumber:'123001048',zipCode:'56007',dateOfBirth:'04/12/1985'},bank={kind:'bank',name:'Alex Morgan',routing:'021000021',accountNumber:'000001048',confirmAccountNumber:'000001048'},card={kind:'card',name:'Alex Morgan',cardNumber:'4242424242424242',expiry:'12/29',cvv:'123'};
function make(type='full',pending=false){const w=new World(),f=w.create({siteId:'western-dental',taskId:`western-dental-${type}-pay-v1`,pending}),id=f.episodeId,session=w.personaPayLogin(id,identity).session;return{w,id,session};}
function pay(w,id,session,type='full',extra={}){const q=w.personaPayQuote(id,session,{...(type==='overpay'?card:bank),amountCents:type==='full'?20932:type==='partial'?10000:30000,...(type==='partial'?{allocations:[{invoiceId:'inv-current',amountCents:8000},{invoiceId:'inv-second',amountCents:2000}]}:{}),...extra});return w.personaPayPay(id,session,{token:q.token});}
test('Each dental task passes only after its declared payment and real confirmation',()=>{
 for(const type of ['full','partial','overpay']){const {w,id,session}=make(type);try{assert.equal(w.evaluate(id,{}).success,false);const p=pay(w,id,session,type);assert.equal(w.evaluate(id,{confirmation:p.confirmation}).success,true);assert.equal(w.evaluate(id,{confirmation:'invented'}).success,false);}finally{w.close();}}
});
test('Correct total with wrong allocation, selected charge, method or pending status fails',()=>{
 for(const [type,extra,pending]of [['partial',{},false],['full',{amountCents:8432,invoiceIds:['inv-current']},false],['full',{...card},false],['full',{},true]]){
  const {w,id,session}=make(type,pending);try{const p=type==='partial'?w.personaPayPay(id,session,{token:w.personaPayQuote(id,session,{...bank,amountCents:10000}).token}):pay(w,id,session,type,extra);assert.equal(w.evaluate(id,{confirmation:p.confirmation}).success,false);}finally{w.close();}
 }
});
test('Authoritative grader rejects corrupted credit, allocation, fee, identity order and other-account effects',()=>{
 const mutations=[s=>s.payments.find(p=>!p.initial).creditCents=1,s=>s.payments.find(p=>!p.initial).feeCents=100,s=>s.payments.find(p=>!p.initial).allocations[0].amountCents--,s=>s.events=s.events.filter(e=>e.type!=='personapay_identity_verified'),s=>s.accounts[1].autopay.enabled=true,s=>s.accounts[0].methods.push({kind:'bank'}),s=>s.invoices.find(i=>i.id==='inv-other').amountCents=0,s=>s.events.push({type:'password_reset',sequence:999,accountId:'acct-primary'})];
 for(const mutate of mutations){const {w,id,session}=make();try{const p=pay(w,id,session);w.transact(id,mutate);assert.equal(w.evaluate(id,{confirmation:p.confirmation}).success,false);}finally{w.close();}}
});
test('Extra payments cannot satisfy the single-payment task even if the declared amount is paid',()=>{
 const {w,id,session}=make();try{const first=pay(w,id,session,'full',{amountCents:10000}),second=pay(w,id,session,'full',{amountCents:20932});assert.equal(w.evaluate(id,{confirmation:second.confirmation}).success,false);assert.equal(w.evaluate(id,{confirmation:first.confirmation}).checks.exactly_one_payment,false);}finally{w.close();}
});
test('An enrolled dental plan violates the one-time task even after the exact payment succeeds',()=>{
 const {w,id,session}=make();try{
  const q=w.personaPayPlanQuote(id,session,{...bank,type:'recurring',invoiceIds:['inv-current','inv-second'],amountCents:20932,cycles:2,initialCents:0,recurrence:'Monthly',firstDate:'2026-10-10'});w.personaPayPlanEnroll(id,session,{token:q.token,authorize:true});
  const p=pay(w,id,session);assert.equal(w.evaluate(id,{confirmation:p.confirmation}).checks.no_dental_plans,false);
 }finally{w.close();}
});
