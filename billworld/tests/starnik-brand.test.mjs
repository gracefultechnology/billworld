import test from 'node:test';
import assert from 'node:assert/strict';
import {World} from '../engine.mjs';
import {sites} from '../registry.mjs';
import {starnikBrand} from '../starnik-brand.mjs';
const site=sites.get('greater-minnesota-gas');
function setup(fn){const original={name:site.name,runtime:site.runtime},w=new World(':memory:',{construction:true});try{site.name='Example Water & Sewer';site.runtime={...site.runtime,mail_display_name:'Example Water',payment_confirmation_prefix:'BW-EXAMPLE',autopay_confirmation_prefix:'BWEXAMPLEAP'};const id=w.create({siteId:site.id,taskId:'gmg-saved-bank-payment-v1'}).episodeId,session=w.starnikLogin(id,{username:'alex.morgan',password:'Billworld-2026!'}).session;fn({w,id,session});}finally{Object.assign(site,original);w.close();}}
test('Brand configuration is explicit and rejects missing or malformed names and prefixes',()=>{
 assert.equal(starnikBrand(site).mailName,'GMG');
 for(const value of [undefined,'','\nOther',42])assert.throws(()=>starnikBrand({...site,runtime:{...site.runtime,mail_display_name:value}}),/branding unavailable/);
 for(const value of [undefined,'','bad prefix','../path','X\n'])assert.throws(()=>starnikBrand({...site,runtime:{...site.runtime,payment_confirmation_prefix:value}}),/prefix unavailable/);
});
test('Alternate branding reaches account, receipt and private grader without changing billing',()=>setup(({w,id,session})=>{
 assert.equal(w.starnikAccount(id,session).siteName,'Example Water & Sewer');
 assert.equal(w.state(id).mail[0].subject,'Your local Example Water & Sewer account');
 w.starnikPaymentOptions(id,session);const q=w.starnikPaymentPrepare(id,session,{methodId:'gmg-bank-1048',amountCents:8432});w.starnikPaymentReview(id,session,q.token);const r=w.starnikPaymentPay(id,session,q.token,{authorize:true});assert.match(r.confirmation,/^BW-EXAMPLE-/);w.starnikPaymentReview(id,session,q.token,true);w.starnikPaymentOptions(id,session);assert.equal(w.evaluate(id).success,true);
 assert.ok(w.state(id).mail.some(m=>m.subject==='Your local Example Water payment receipt'));assert.equal(w.state(id).mail.some(m=>m.subject.includes('GMG')),false);
}));
test('Recovery and scheduled AutoPay mail use the configured tenant name',()=>setup(({w,id,session})=>{
 w.starnikRecoveryRequest(id,{kind:'username',email:'alex@billworld.test'});w.starnikRecoveryRequest(id,{kind:'password',username:'alex.morgan'});
 const q=w.starnikAutoPayPrepare(id,session,{methodId:'gmg-bank-1048'});w.starnikAutoPayReview(id,session,q.token);w.starnikAutoPayEnable(id,session,q.token,{agreedToTerms:true,confirmed:true,acknowledgeTextPay:true,acknowledgeAch:true});
 const before=w.state(id),at=Date.parse(before.invoices.find(i=>i.id==='inv-current').dueDate+'T00:00:00Z')-3*86400000;w.advance(id,at-before.now);
 const s=w.state(id);for(const subject of ['Your local Example Water username','Reset your local Example Water password','Your local Example Water AutoPay settings changed','Your local Example Water AutoPay confirmation'])assert.ok(s.mail.some(m=>m.subject===subject),subject);
 assert.match(s.payments.at(-1).confirmation,/^BWEXAMPLEAP-/);assert.equal(s.mail.some(m=>m.subject.includes('GMG')),false);
}));
