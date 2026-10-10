import test from 'node:test';
import assert from 'node:assert/strict';
import {World} from '../engine.mjs';
import {constructionSites} from '../registry.mjs';
import {starnikAutoPayDays,starnikAutoPayTiming} from '../starnik-autopay.mjs';
const site=constructionSites.get('greater-minnesota-gas');
function scenario(days,fn){const original=site.documented_policy,w=new World(':memory:',{construction:true});try{site.documented_policy={...original,autopay_days_before_due:days};const id=w.create({siteId:site.id,taskId:'gmg-saved-bank-payment-v1'}).episodeId,session=w.starnikLogin(id,{username:'alex.morgan',password:'Billworld-2026!'}).session,methodId=w.starnikPaymentOptions(id,session).methods.find(m=>m.kind==='bank').id;fn({w,id,session,methodId});}finally{site.documented_policy=original;w.close();}}
function prepare(x){const q=x.w.starnikAutoPayPrepare(x.id,x.session,{methodId:x.methodId});x.w.starnikAutoPayReview(x.id,x.session,q.token);return q.token;}
const consent={agreedToTerms:true,confirmed:true,acknowledgeTextPay:true,acknowledgeAch:true};
test('Timing is explicit, with no implicit GMG fallback',()=>{
 assert.equal(starnikAutoPayTiming({autopay_days_before_due:0}),'on the due date');
 assert.equal(starnikAutoPayTiming({autopay_days_before_due:1}),'1 day before the due date');
 assert.equal(starnikAutoPayTiming({autopay_days_before_due:5}),'5 days before the due date');
 for(const days of [undefined,null,-1,1.5,'3',NaN,Infinity,366])assert.throws(()=>starnikAutoPayDays({autopay_days_before_due:days}),/timing unavailable/);
});
test('Alternate day offsets bind consent, email and exact scheduler execution',()=>{
 for(const days of [0,1,5])scenario(days,x=>{const{w,id,session}=x;const token=prepare(x);w.starnikAutoPayEnable(id,session,token,consent);const s=w.state(id);assert.equal(s.accounts[0].autopay.daysBeforeDue,days);assert.ok(s.mail.some(m=>m.text.includes('AutoPay is enabled '+starnikAutoPayTiming(site.documented_policy))));
 const at=Date.parse(s.invoices.find(i=>i.id==='inv-current').dueDate+'T00:00:00Z')-days*86400000;
 w.advance(id,at-s.now-1);assert.equal(w.state(id).payments.length,s.payments.length);w.advance(id,1);assert.equal(w.state(id).payments.at(-1).createdAt,at);assert.equal(w.state(id).payments.at(-1).amountCents,8432);assert.ok(w.state(id).mail.some(m=>m.text.includes('simulated attempt '+starnikAutoPayTiming(site.documented_policy))));w.advance(id,86400000);assert.equal(w.state(id).payments.length,s.payments.length+1);
 });
});
test('Missing timing disables enrollment without blocking other account operations',()=>scenario(undefined,x=>{
 const{w,id,session,methodId}=x;const v=w.starnikAutoPay(id,session);assert.equal(v.enrollmentAvailable,false);assert.equal(v.daysBeforeDue,null);assert.throws(()=>w.starnikAutoPayPrepare(id,session,{methodId}),/timing unavailable/);assert.equal(w.starnikPaymentOptions(id,session).balanceCents,8432);const before=w.state(id).payments;w.advance(id,86400000);assert.deepEqual(w.state(id).payments,before);
}));
test('Policy changes invalidate uncommitted reviews and cannot silently reschedule active enrollment',()=>{
 for(const stage of ['before-review','before-commit','active'])scenario(3,x=>{const{w,id,session,methodId}=x;const q=w.starnikAutoPayPrepare(id,session,{methodId});if(stage!=='before-review')w.starnikAutoPayReview(id,session,q.token);if(stage==='active')w.starnikAutoPayEnable(id,session,q.token,consent);
 site.documented_policy={...site.documented_policy,autopay_days_before_due:1};const before=w.state(id);
 if(stage==='before-review')assert.throws(()=>w.starnikAutoPayReview(id,session,q.token),/timing changed/);
 if(stage==='before-commit')assert.throws(()=>w.starnikAutoPayEnable(id,session,q.token,consent),/timing changed/);
 if(stage==='active'){assert.throws(()=>w.advance(id,86400000),/timing changed/);assert.deepEqual(w.state(id).payments,before.payments);assert.equal(w.state(id).now,before.now);delete site.documented_policy.autopay_days_before_due;assert.throws(()=>w.advance(id,86400000),/timing unavailable/);w.starnikAutoPayDisable(id,session,{confirmed:true});assert.equal(w.state(id).accounts[0].autopay.enabled,false);w.advance(id,86400000);}
 });
});
