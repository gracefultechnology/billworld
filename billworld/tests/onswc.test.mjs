import test from 'node:test';import assert from 'node:assert/strict';import{World}from'../engine.mjs';
test('ONSWC uses its own identity and explicit unknown fees, without borrowed statements or AutoPay timing',()=>{
 const w=new World(':memory:',{construction:true});try{const id=w.create({siteId:'onswc'}).episodeId;assert.throws(()=>w.starnikLogin(id,{username:'alex.inframark',password:'Inframark-2026!'}));const session=w.starnikLogin(id,{username:'alex.onswc',password:'ONSWC-2026!'}).session;const a=w.starnikAccount(id,session);assert.equal(a.siteName,'Old North State Water Company');assert.equal(w.evaluate(id).success,true);assert.ok(a.invoices.every(i=>!i.statementAvailable));const p=w.starnikPaymentOptions(id,session);assert.equal(p.paymentAvailable,false);assert.equal(p.feeDisclosure,null);assert.equal(w.starnikAutoPay(id,session).enrollmentAvailable,false);assert.throws(()=>w.starnikStatement(id,session,'inv-current'),/unavailable/);
 }finally{w.close();}
});
