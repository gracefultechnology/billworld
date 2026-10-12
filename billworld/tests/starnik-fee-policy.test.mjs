import test from 'node:test';
import assert from 'node:assert/strict';
import {starnikFee,starnikFeeDisclosure} from '../starnik-payment.mjs';
import {sites} from '../registry.mjs';
import {World} from '../engine.mjs';
const gmg={bank_fee_cents:0,card_fee_basis_points:275,card_fee_minimum_cents:150};
// Operator FAQ example only; this does not register or certify an Inframark tenant.
const operator={bank_fee_cents:100,card_fee_basis_points:300,card_fee_minimum_cents:0};
test('Different tenant policies produce distinct disclosures and exact rounded charges',()=>{
 assert.equal(starnikFeeDisclosure(gmg),'Bank payments have no fee. Card payments have a 2.75% fee, minimum $1.50.');
 assert.equal(starnikFeeDisclosure(operator),'Bank payments have a $1.00 fee. Card payments have a 3% fee.');
 assert.equal(starnikFee('bank',8432,operator),100);
 assert.equal(starnikFee('card',8432,operator),253);
 assert.equal(starnikFee('card',2000,gmg),150);
 assert.equal(starnikFee('card',8432,gmg),232);
 assert.equal(starnikFee('card',50,{...operator,card_fee_basis_points:100}),1);
 assert.equal(starnikFee('card',Number.MAX_SAFE_INTEGER,{...operator,card_fee_basis_points:10000}),Number.MAX_SAFE_INTEGER);
});
test('Unknown or malformed policy and unsafe amounts cannot silently become a fee',()=>{
 for(const p of [undefined,{},...Object.keys(gmg).flatMap(k=>[undefined,null,-1,1.5,'0',NaN,Infinity].map(v=>({...gmg,[k]:v})))]){
  assert.throws(()=>starnikFee('bank',100,p),/policy unavailable/);
  assert.throws(()=>starnikFeeDisclosure(p),/policy unavailable/);
 }
 for(const amount of [0,-1,1.5,'100',NaN,Infinity])assert.throws(()=>starnikFee('card',amount,gmg),/amount/);
 assert.throws(()=>starnikFee('unknown',100,gmg),/method unavailable/);
 assert.throws(()=>starnikFee('card',Number.MAX_SAFE_INTEGER,{...gmg,card_fee_basis_points:10001}),/construction limit/);
});
test('Signed checkout and AutoPay disclose the configured tenant policy',()=>{
 const site=sites.get('greater-minnesota-gas'),original=site.documented_policy;
 const w=new World(':memory:',{construction:true});
 try{
  site.documented_policy={...original,...operator};
  const id=w.create({siteId:site.id,taskId:'gmg-saved-bank-payment-v1'}).episodeId;
  const session=w.starnikLogin(id,{username:'alex.morgan',password:'Billworld-2026!'}).session;
  const options=w.starnikPaymentOptions(id,session);
  assert.equal(options.feeDisclosure,starnikFeeDisclosure(operator));
  const methodId=options.methods.find(m=>m.kind==='bank').id;
  const q=w.starnikPaymentPrepare(id,session,{methodId,amountCents:8432});
  assert.equal(w.starnikPaymentReview(id,session,q.token).feeCents,100);
  const a=w.starnikAutoPayPrepare(id,session,{methodId});
  assert.equal(w.starnikAutoPayReview(id,session,a.token).feeDisclosure,options.feeDisclosure);
  assert.equal(w.starnikPaymentPay(id,session,q.token,{authorize:true}).feeCents,100);
 }finally{site.documented_policy=original;w.close();}
});

test('Explicit unverified policy preserves account reads but prevents quotes and AutoPay enrollment',()=>{
 const site=sites.get('greater-minnesota-gas'),original=site.documented_policy,w=new World(':memory:',{construction:true});
 try{
 site.documented_policy={payment_fee_status:'unverified',autopay_days_before_due:3};
 const id=w.create({siteId:site.id,taskId:'gmg-saved-bank-payment-v1'}).episodeId,session=w.starnikLogin(id,{username:'alex.morgan',password:'Billworld-2026!'}).session;
 assert.equal(w.starnikAccount(id,session).account.id,'acct-primary');const options=w.starnikPaymentOptions(id,session);assert.equal(options.paymentAvailable,false);assert.equal(options.feeDisclosure,null);assert.equal(w.starnikAutoPay(id,session).enrollmentAvailable,false);
 const guest=w.starnikGuestLookup(id,{securityCode:'GMG1048',serviceZip:'56001'}).token;assert.equal(w.starnikGuestAccount(id,guest).paymentAvailable,false);
 const before=JSON.stringify(w.state(id));assert.throws(()=>w.starnikPaymentPrepare(id,session,{methodId:'gmg-bank-1048',amountCents:8432}),/fee policy unavailable/);assert.throws(()=>w.starnikAutoPayPrepare(id,session,{methodId:'gmg-bank-1048'}),/fee policy unavailable/);assert.equal(JSON.stringify(w.state(id)),before);
 }finally{site.documented_policy=original;w.close();}
});
test('Unverified policy cannot reuse an old signed quote; completed receipts remain idempotent',()=>{
 const site=sites.get('greater-minnesota-gas'),original=site.documented_policy,w=new World(':memory:',{construction:true});
 try{for(const posted of [false,true]){
 site.documented_policy=original;const id=w.create({siteId:site.id,taskId:'gmg-saved-bank-payment-v1'}).episodeId,session=w.starnikLogin(id,{username:'alex.morgan',password:'Billworld-2026!'}).session,q=w.starnikPaymentPrepare(id,session,{methodId:'gmg-bank-1048',amountCents:8432});w.starnikPaymentReview(id,session,q.token);const receipt=posted?w.starnikPaymentPay(id,session,q.token,{authorize:true}):null;
 site.documented_policy={payment_fee_status:'unverified'};const before=JSON.stringify(w.state(id));if(posted)assert.deepEqual(w.starnikPaymentPay(id,session,q.token,{authorize:true}),receipt);else assert.throws(()=>w.starnikPaymentPay(id,session,q.token,{authorize:true}),/fee policy unavailable/);assert.equal(JSON.stringify(w.state(id)),before);
 }}finally{site.documented_policy=original;w.close();}
});

test('Unverified fees reject guest payment and pending AutoPay activation without state changes',()=>{
 const site=sites.get('greater-minnesota-gas'),original=site.documented_policy,w=new World(':memory:',{construction:true});
 try{
 const id=w.create({siteId:site.id,taskId:'gmg-saved-bank-payment-v1'}).episodeId,session=w.starnikLogin(id,{username:'alex.morgan',password:'Billworld-2026!'}).session,guest=w.starnikGuestLookup(id,{securityCode:'GMG1048',serviceZip:'56001'}).token;
 const input={kind:'bank',amountCents:8432,name:'Alex Morgan',bankName:'Test Bank',accountType:'Checking',routing:'021000021',confirmRouting:'021000021',accountNumber:'1234561048',confirmAccountNumber:'1234561048',firstName:'Alex',lastName:'Morgan',address:'1 Test Street',city:'Mankato',state:'MN',zip:'56001',country:'United States',email:'alex@billworld.test'};
 const q=w.starnikGuestQuote(id,guest,input);w.starnikGuestReview(id,guest,q.token);const a=w.starnikAutoPayPrepare(id,session,{methodId:'gmg-bank-1048'});w.starnikAutoPayReview(id,session,a.token);
 site.documented_policy={payment_fee_status:'unverified',autopay_days_before_due:3};const before=JSON.stringify(w.state(id));
 assert.throws(()=>w.starnikGuestQuote(id,guest,input),/fee policy unavailable/);assert.throws(()=>w.starnikGuestPay(id,guest,q.token,{authorize:true}),/fee policy unavailable/);assert.throws(()=>w.starnikAutoPayEnable(id,session,a.token,{agreedToTerms:true,confirmed:true,acknowledgeTextPay:true,acknowledgeAch:true}),/fee policy unavailable/);assert.equal(JSON.stringify(w.state(id)),before);
 }finally{site.documented_policy=original;w.close();}
});
