import test from 'node:test';import assert from 'node:assert/strict';import {World} from '../engine.mjs';
const identity={accountNumber:'123001048',zipCode:'56007',dateOfBirth:'04/12/1985'},bank={kind:'bank',name:'Alex Morgan',routing:'021000021',accountNumber:'000001048',confirmAccountNumber:'000001048'};
const input=type=>({...bank,type,invoiceIds:['inv-current','inv-second'],amountCents:type==='recurring'?20932:10000,initialCents:0,cycles:2,recurrence:'Monthly',firstDate:type==='recurring'?'2026-10-10':'2026-10-07'});
function make(type){const w=new World(),f=w.create({siteId:'western-dental',taskId:`western-dental-${type}-plan-v1`}),id=f.episodeId,session=w.personaPayLogin(id,identity).session;return{w,id,session};}
function enroll(w,id,session,type,extra={}){const q=w.personaPayPlanQuote(id,session,{...input(type),...extra});return w.personaPayPlanEnroll(id,session,{token:q.token,authorize:true});}
test('Recurring and future enrollment tasks require a real consented plan and reported confirmation',()=>{
 for(const type of ['recurring','future']){const {w,id,session}=make(type);try{assert.equal(w.evaluate(id,{}).success,false);const p=enroll(w,id,session,type);assert.equal(w.evaluate(id,{confirmation:p.confirmation}).success,true);assert.equal(w.evaluate(id,{confirmation:'invented'}).success,false);}finally{w.close();}}
});
test('A valid plan with the wrong date, cadence, type, instrument or initial payment does not satisfy enrollment',()=>{
 for(const extra of [{firstDate:'2026-10-09'},{recurrence:'Weekly'},{type:'future',firstDate:'2026-10-07'},{accountNumber:'999991048',confirmAccountNumber:'999991048'},{initialCents:10000,cycles:1}]){
  const {w,id,session}=make('recurring');try{const p=enroll(w,id,session,'recurring',extra);assert.equal(w.evaluate(id,{confirmation:p.confirmation}).success,false);}finally{w.close();}
 }
});
test('Cancellation, completed payments, extra plans and unrelated account changes fail the enrollment goal',()=>{
 const mutations=[s=>s.dentalPlans[0].status='cancelled',s=>s.dentalPlans.push({...s.dentalPlans[0],id:'extra'}),s=>s.invoices.find(i=>i.id==='inv-other').amountCents=0,s=>s.accounts[1].autopay.enabled=true,s=>s.events=s.events.filter(e=>e.type!=='personapay_identity_verified')];
 for(const mutate of mutations){const {w,id,session}=make('recurring');try{const p=enroll(w,id,session,'recurring');w.transact(id,mutate);assert.equal(w.evaluate(id,{confirmation:p.confirmation}).success,false);}finally{w.close();}}
 const {w,id,session}=make('recurring');try{const p=enroll(w,id,session,'recurring');w.advance(id,7*86400000);assert.equal(w.evaluate(id,{confirmation:p.confirmation}).checks.no_payments,false);}finally{w.close();}
});
