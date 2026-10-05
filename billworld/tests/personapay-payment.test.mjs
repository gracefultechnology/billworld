import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../engine.mjs';
import { sites,tasks } from '../registry.mjs';
import { personaPayDistribution } from '../personapay.mjs';
const siteId='dental-payment-fixture',taskId='dental-payment-fixture-v1';
sites.set(siteId,{id:siteId,name:'Dental payment fixture',default_task_id:taskId,runtime:{kind:'personapay',mail_sender_slug:'dental'},billing_policy:{fee_cents:0}});
tasks.set(taskId,{id:taskId,site_id:siteId,evidence_cohort:'public_config_and_synthetic_checkout',budget:{seconds:300},goal:{}});
test.after(()=>{sites.delete(siteId);tasks.delete(taskId);});
const identity={accountNumber:'123001048',zipCode:'56007',dateOfBirth:'04/12/1985'};
const bank={kind:'bank',name:'Alex Morgan',routing:'021000021',accountNumber:'000001048',confirmAccountNumber:'000001048'};
const card={kind:'card',name:'Alex Morgan',cardNumber:'4242424242424242',expiry:'12/29',cvv:'123'};
const create=options=>{const w=new World(),f=w.create({siteId,...options}),session=w.personaPayLogin(f.episodeId,identity).session;return{w,f,id:f.episodeId,session};};
test('Weighted allocation conserves cents, handles ties and uses exact arithmetic at configured limits',()=>{
  const lines=[{invoiceId:'a',balanceCents:10000},{invoiceId:'b',balanceCents:10000}];
  assert.deepEqual(personaPayDistribution(lines,301).allocations,[{invoiceId:'a',amountCents:151},{invoiceId:'b',amountCents:150}]);
  const large=personaPayDistribution([{invoiceId:'a',balanceCents:100000000},{invoiceId:'b',balanceCents:100000000}],199999999);
  assert.equal(large.allocations.reduce((n,x)=>n+x.amountCents,0),199999999);assert.equal(large.creditCents,0);
  assert.throws(()=>personaPayDistribution(lines,100),/Each charge/);
  for(const amount of [0,99,200000001,NaN,1.5,'10000'])assert.throws(()=>personaPayDistribution(lines,amount));
  assert.throws(()=>personaPayDistribution([{invoiceId:'a',balanceCents:100000001}],100000001),/Each charge/);
});
test('Partial account payment allocates once across charges and leaves the other account untouched',()=>{
  const {w,id,session,f}=create();try{
    assert.equal(w.personaPayStatement(id,session).balanceCents,20932);
    const q=w.personaPayQuote(id,session,{...bank,amountCents:10000});assert.equal(q.feeCents,0);assert.equal(q.creditCents,0);
    assert.equal(q.allocations.reduce((n,x)=>n+x.amountCents,0),10000);
    assert.equal(w.personaPayReview(id,session,q.token).amountCents,10000);
    const p=w.personaPayPay(id,session,{token:q.token});assert.equal(p.status,'posted');
    assert.equal(w.personaPayPay(id,session,{token:q.token}).confirmation,p.confirmation);
    assert.equal(w.personaPayReceipt(id,session,q.token).confirmation,p.confirmation);
    assert.throws(()=>w.personaPayReview(id,session,q.token),/unavailable/);
    const s=w.personaPayStatement(id,session);assert.equal(s.balanceCents,10932);assert.equal(s.creditCents,0);
    assert.equal(w.search(id,identity.accountNumber,session).invoices.reduce((n,i)=>n+i.remainingCents,0),10932);
    assert.equal(w.state(id).invoices.find(i=>i.id==='inv-other').amountCents,5190);
    assert.equal(w.state(id).payments.filter(p=>!p.initial).length,1);
    assert.equal(w.messages(id,f.connectorToken,'subject:dental').filter(m=>m.subject==='Your local dental payment confirmation').length,1);
    const serialized=JSON.stringify(w.state(id));assert.equal(serialized.includes(bank.accountNumber),false);assert.equal(serialized.includes(bank.routing),false);
  }finally{w.close();}
});
test('Overpayment pays selected balances and records the excess as explicit synthetic credit',()=>{
  const {w,id,session}=create();try{
    const q=w.personaPayQuote(id,session,{...card,amountCents:30000});assert.equal(q.creditCents,9068);
    assert.equal(q.allocations.reduce((n,x)=>n+x.amountCents,0),20932);
    w.personaPayPay(id,session,{token:q.token});const s=w.personaPayStatement(id,session);
    assert.equal(s.balanceCents,0);assert.equal(s.creditCents,9068);assert.ok(s.invoices.every(i=>i.remainingCents===0));
    assert.throws(()=>w.personaPayQuote(id,session,{...card,amountCents:100}),/Select unpaid/);
    assert.equal(JSON.stringify(w.state(id)).includes(card.cardNumber),false);
  }finally{w.close();}
});
test('Charge selection and edited allocation enforce ownership, conservation and line limits',()=>{
  const {w,id,session}=create();try{
    for(const invoiceIds of [['inv-other'],['inv-old'],['inv-current','inv-current'],[],['missing']])assert.throws(()=>w.personaPayQuote(id,session,{...bank,amountCents:100,invoiceIds}));
    for(const allocations of [[{invoiceId:'inv-current',amountCents:9999}],[{invoiceId:'inv-other',amountCents:10000}],[{invoiceId:'inv-current',amountCents:8433},{invoiceId:'inv-second',amountCents:1567}],[{invoiceId:'inv-current',amountCents:50},{invoiceId:'inv-second',amountCents:9950}]])assert.throws(()=>w.personaPayQuote(id,session,{...bank,amountCents:10000,allocations}));
    const q=w.personaPayQuote(id,session,{...bank,amountCents:10000,allocations:[{invoiceId:'inv-current',amountCents:8000},{invoiceId:'inv-second',amountCents:2000}]});
    assert.deepEqual(q.allocations,[{invoiceId:'inv-current',amountCents:8000},{invoiceId:'inv-second',amountCents:2000}]);
    const single=w.personaPayQuote(id,session,{...bank,amountCents:8432,invoiceIds:['inv-current']});w.personaPayPay(id,session,{token:single.token});
    assert.equal(w.personaPayStatement(id,session).invoices.find(i=>i.id==='inv-second').remainingCents,12500);
    assert.throws(()=>w.personaPayPay(id,session,{token:q.token}),/balance changed/);
  }finally{w.close();}
});
test('Payment capabilities are bound to the episode, original session, review expiry and live account',()=>{
  const {w,id,session}=create();try{
    const q=w.personaPayQuote(id,session,{...bank,amountCents:10000}),other=w.create({siteId}).episodeId;
    assert.throws(()=>w.personaPayQuote(id,null,{...bank,amountCents:10000}),/sign in/);
    assert.throws(()=>w.personaPayReview(other,session,q.token),/sign in/);
    assert.throws(()=>w.personaPayPay(other,w.personaPayLogin(other,identity).session,{token:q.token}),/unavailable/);
    assert.throws(()=>w.personaPayReceipt(id,session,q.token),/unavailable/);
    const replacement=w.personaPayLogin(id,identity).session;assert.throws(()=>w.personaPayPay(id,replacement,{token:q.token}),/unavailable/);
    w.advance(id,11*60000);assert.throws(()=>w.personaPayPay(id,session,{token:q.token}),/expired/);
    const fresh=w.personaPayQuote(id,replacement,{...bank,amountCents:10000});w.logout(id,replacement);assert.throws(()=>w.personaPayPay(id,replacement,{token:fresh.token}),/sign in/);
    assert.equal(w.state(id).payments.filter(p=>!p.initial).length,0);
  }finally{w.close();}
});
test('Declined, invalid or inherited payment paths cannot post dental payments or store instruments',()=>{
  const {w,id,session}=create();try{
    for(const extra of [{routing:'123456789'},{confirmAccountNumber:'000002099'},{kind:'wallet'},{methodId:'bank-1048'}])assert.throws(()=>w.personaPayQuote(id,session,{...bank,amountCents:10000,...extra}));
    for(const extra of [{expiry:'00/29'},{expiry:'01/20'},{cardNumber:'4242424242424241'},{cvv:'x'}])assert.throws(()=>w.personaPayQuote(id,session,{...card,amountCents:10000,...extra}));
    const q=w.personaPayQuote(id,session,{...card,cardNumber:'4000000000000002',amountCents:10000});assert.equal(w.personaPayPay(id,session,{token:q.token}).declined,true);
    assert.equal(w.personaPayStatement(id,session).balanceCents,20932);assert.equal(w.state(id).payments.filter(p=>!p.initial).length,0);
    assert.throws(()=>w.quote(id,session,{...bank,invoiceId:'inv-current',amountCents:8432}),/account-level/);
    assert.throws(()=>w.pay(id,session,{token:q.token}),/account-level/);
    assert.throws(()=>w.autopay(id,session,{enabled:false}),/separate/);
    assert.throws(()=>w.schedule(id,session,{token:q.token,date:'2026-10-20'}),/separate/);
    assert.deepEqual(w.personaPayStatement(id,session).account.methods,[]);
  }finally{w.close();}
});
test('Pending payment reserves allocated cents and credit without claiming posted settlement',()=>{
  const {w,id,session}=create({pending:true});try{
    const q=w.personaPayQuote(id,session,{...bank,amountCents:30000});assert.equal(w.personaPayPay(id,session,{token:q.token}).status,'pending');
    const s=w.personaPayStatement(id,session);assert.equal(s.balanceCents,0);assert.equal(s.creditCents,0);assert.equal(s.pendingCreditCents,9068);assert.equal(s.payments.filter(p=>!p.initial)[0].status,'pending');
  }finally{w.close();}
});
