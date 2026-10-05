import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../engine.mjs';
const make = options => { const w = new World(); const f = w.create({ siteId: 'homer-utilities', ...options }); return { w, f, id: f.episodeId }; };
const profile = { email: 'alex@billworld.test', password: 'NewProfile-2026!', confirmPassword: 'NewProfile-2026!', accountType: 'personal', acceptTerms: true, firstName: 'Alex', lastName: 'Morgan', phone: '9075550148', address: '1048 Harbor Way', city: 'Homer', region: 'AK', postalCode: '99603' };
const verification = (w, f) => w.messages(f.episodeId, f.connectorToken, 'subject:Verify')[0].text.match(/token=([\w-]+)/)[1];
const verifyAndLogin = (w, f) => { w.registerProfile(f.episodeId, profile); w.verifyProfile(f.episodeId, { token: verification(w, f) }); return w.login(f.episodeId, profile).session; };
const bank = { invoiceId: 'inv-current', amountCents: 8432, kind: 'bank', name: 'Alex Morgan', routing: '021000021', accountNumber: '000001048', confirmAccountNumber: '000001048', billingAddress: '1048 Harbor Way', billingCity: 'Homer', billingRegion: 'AK', billingPostalCode: '99603', contactPhone: '9075550148', receiptEmail: 'alex@billworld.test' };
test('Xpress registration requires current form rules and email verification before login', () => {
  const { w, f, id } = make({ registered: false });
  assert.throws(() => w.register(id, { customerNumber: '1001048', email: profile.email, password: profile.password }), /verify a profile/);
  for (const change of [{password:'lowercase1',confirmPassword:'lowercase1'}, {acceptTerms:false}, {confirmPassword:'Mismatch-2026!'}, {accountType:'business'}, {phone:'123'}]) assert.throws(() => w.registerProfile(id, {...profile,...change}));
  const result = w.registerProfile(id, profile); assert.equal(result.session, undefined);
  assert.throws(() => w.login(id, profile), /incorrect/);
  const token = verification(w, f); const other = w.create({ siteId:'homer-utilities', registered:false });
  assert.throws(() => w.verifyProfile(other.episodeId,{token}), /expired/);
  w.verifyProfile(id,{token}); assert.throws(() => w.verifyProfile(id,{token}), /already used/);
  const signed = w.login(id,profile); assert.equal(signed.account.profileVerified,true); assert.equal(signed.account.billLinked,false); assert.equal(signed.account.customerNumber,null); assert.deepEqual(signed.account.methods,[]); w.close();
});
test('Xpress pending registrations supersede verification links and expired links fail', () => {
  const { w, f, id } = make({registered:false}); w.registerProfile(id,profile); const first=verification(w,f);
  w.registerProfile(id,profile); const second=verification(w,f); assert.notEqual(first,second); assert.throws(()=>w.verifyProfile(id,{token:first}),/expired/);
  w.advance(id,24*3600000); assert.throws(()=>w.verifyProfile(id,{token:second}),/expired/); assert.throws(()=>w.login(id,profile),/incorrect/); w.close();
});
test('Xpress unlinked profiles cannot read invoices, pay, enable AutoPay or link another user', () => {
  const {w,f,id}=make({registered:false}); const session=verifyAndLogin(w,f);
  assert.deepEqual(w.dashboard(id,session).invoices,[]);
  assert.throws(()=>w.search(id,'1001048',session),/link a billing/); assert.throws(()=>w.quote(id,session,bank),/link a billing/);
  assert.throws(()=>w.autopay(id,session,{enabled:true,methodId:'bank-1048'}),/link a billing/);
  assert.throws(()=>w.profileLookup(id,session,{customerNumber:'2002099',lastName:'Lee'}),/verified/);
  const lookup=w.profileLookup(id,session,{customerNumber:'1001048',lastName:'Morgan'});
  const newSession=w.login(id,profile).session; assert.throws(()=>w.linkProfileAccount(id,newSession,{token:lookup.token,paperless:true}),/expired/);
  w.linkProfileAccount(id,session,{token:lookup.token,paperless:true}); assert.throws(()=>w.linkProfileAccount(id,session,{token:lookup.token,paperless:true}),/expired/);
  assert.equal(w.dashboard(id,session).account.paperless,true); assert.equal(w.dashboard(id,session).invoices.length,2); w.close();
});
test('Xpress register/link/pay task checks order, paperless, authoritative receipt and duplicate prevention', () => {
  const {w,f,id}=make({taskId:'homer-register-link-pay-v1'}); const session=verifyAndLogin(w,f);
  const lookup=w.profileLookup(id,session,{customerNumber:'1001048',lastName:'Morgan'}); w.linkProfileAccount(id,session,{token:lookup.token,paperless:true});
  assert.throws(()=>w.quote(id,null,{...bank,customerNumber:'1001048'}),/Look up/);
  assert.throws(()=>w.quote(id,session,{...bank,confirmAccountNumber:'000002099'}),/must match/);
  assert.throws(()=>w.quote(id,session,{...bank,receiptEmail:'jordan@billworld.test'}),/receipt/);
  const q=w.quote(id,session,bank); const payment=w.pay(id,session,{token:q.token}); assert.deepEqual(w.pay(id,session,{token:q.token}),payment);
  assert.equal(w.evaluate(id,{confirmation:payment.confirmation}).success,true);
  assert.match(w.messages(id,f.connectorToken,'subject:confirmation')[0].text,new RegExp(payment.confirmation));
  assert.equal(w.state(id).payments.filter(p=>!p.initial).length,1); w.close();
});
test('Xpress source password rules apply to recovery and existing profiles do not satisfy registration task', () => {
  const {w,f,id}=make(); w.resetRequest(id,{email:profile.email}); const token=w.messages(id,f.connectorToken,'subject:Reset')[0].text.match(/token=([\w-]+)/)[1];
  assert.throws(()=>w.resetPassword(id,{token,password:'lowercase123'}),/uppercase/); w.resetPassword(id,{token,password:profile.password}); assert.ok(w.login(id,profile).session);
  const state=w.state(id); state.taskId='homer-register-link-pay-v1'; w.save(state);
  const session=w.login(id,profile).session; const q=w.quote(id,session,{invoiceId:'inv-current',amountCents:8432,methodId:'bank-1048'}); const p=w.pay(id,session,{token:q.token});
  const score=w.evaluate(id,{confirmation:p.confirmation}); assert.equal(score.checks.profile_verified_then_linked_before_payment,false); assert.equal(score.checks.paperless_enabled,false); assert.equal(score.success,false); w.close();
});
test('Xpress card validation and decline cannot change balance or emit a paid receipt', () => {
  const {w,f,id}=make(); const session=w.login(id,f.credentials).session;
  const card={...bank,kind:'card',cardNumber:'4242424242424242',expiry:'12/29',cvv:'123'};
  assert.throws(()=>w.quote(id,session,{...card,cardNumber:'4242424242424243'}),/checksum/);
  assert.throws(()=>w.quote(id,session,{...card,expiry:'12/25'}),/expired/);
  assert.throws(()=>w.quote(id,session,{...card,expiry:'99/29'}),/expired/);
  const q=w.quote(id,session,{...card,cardNumber:'4000000000000002'}); assert.equal(w.pay(id,session,{token:q.token}).declined,true);
  assert.equal(w.state(id).payments.filter(p=>!p.initial).length,0); assert.equal(w.messages(id,f.connectorToken,'subject:confirmation').length,0);
  assert.equal(w.dashboard(id,session).invoices.find(i=>i.id==='inv-current').remainingCents,8432); w.close();
});
