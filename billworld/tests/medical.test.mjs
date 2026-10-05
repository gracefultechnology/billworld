import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../engine.mjs';
import { sites, tasks } from '../registry.mjs';

// Independent domain fixture; no production manifest changes during tests.
const siteId = 'medical-domain-fixture';
const taskId = 'medical-domain-fixture-v1';
sites.set(siteId, { id: siteId, name: 'Medical construction fixture', default_task_id: taskId,
  runtime: { kind: 'medical', mail_sender_slug: 'medical' }, billing_policy: { fee_cents: 0 } });
tasks.set(taskId, { id: taskId, site_id: siteId, evidence_cohort: 'documented_and_synthetic', budget: { seconds: 300 },
  goal: { invoice_id: 'inv-current', account_id: 'acct-primary', amount_cents: 8432, method_kind: 'bank', method_last4: '1048', fee_cents: 0, status: 'posted', autopay_enabled: false, maximum_new_payments: 1, guest_payment_required: true } });
test.after(() => { sites.delete(siteId); tasks.delete(taskId); });
const make = options => { const w = new World(); const f = w.create({ siteId, ...options }); return { w, f, id: f.episodeId }; };
const lookup = (w,id,accountNumber='100104801') => w.medicalLookup(id,{ accountNumber,lastName:'Morgan',captcha:true });
const quote = (w,id,lookupToken,extra={}) => w.quote(id,null,{ invoiceId:'inv-current',customerNumber:'1001048',lookupToken,amountCents:8432,kind:'bank',name:'Alex Morgan',routing:'021000021',accountNumber:'000001048',...extra });

test('Medical review and receipt capabilities cannot cross episodes or outlive their stage', () => {
  const {w,id}=make();try {
    const r=lookup(w,id),q=quote(w,id,r.lookupToken),other=w.create({siteId}).episodeId;
    assert.equal(w.medicalReview(id,null,q.token).invoice.visitAccountNumber,'100104801');
    assert.throws(()=>w.medicalReview(other,null,q.token),/expired/);
    assert.throws(()=>w.medicalReceipt(id,q.token),/unavailable/);
    const p=w.pay(id,null,{token:q.token});
    assert.throws(()=>w.medicalReview(id,null,q.token),/already submitted/);
    assert.equal(w.medicalReceipt(id,q.token).payment.confirmation,p.confirmation);
    assert.throws(()=>w.medicalReceipt(other,q.token),/unavailable/);
    w.advance(id,61*60000);assert.throws(()=>w.medicalReceipt(id,q.token),/expired/);
  } finally {w.close();}
});

test('Signed medical review requires its original live session', () => {
  const {w,id}=make();try {
    const sign=()=>w.login(id,{username:'alex.morgan',password:'Billworld-2026!',identityChallenge:w.medicalIdentityBegin(id,{username:'alex.morgan'}).challenge}).session;
    const session=sign(),q=w.quote(id,session,{invoiceId:'inv-current',amountCents:8432,kind:'bank',name:'Alex Morgan',routing:'021000021',accountNumber:'000001048'});
    assert.throws(()=>w.medicalReview(id,null,q.token),/sign in/i);
    assert.throws(()=>w.medicalReview(id,sign(),q.token),/session changed/);
    assert.equal(w.medicalReview(id,session,q.token).guest,false);
    w.advance(id,11*60000);assert.throws(()=>w.medicalReview(id,session,q.token),/expired/);
  } finally {w.close();}
});

test('Medical lookup distinguishes guarantor, patient and visit account', () => {
  const {w,id}=make();try {
    const visit=lookup(w,id);assert.equal(visit.scope,'visit');assert.equal(visit.invoices.length,1);assert.equal(visit.invoices[0].patientName,'Taylor Morgan');assert.equal(visit.account.name,'Alex Morgan');
    const guarantor=lookup(w,id,'1001048');assert.equal(guarantor.scope,'guarantor');assert.deepEqual(guarantor.invoices.map(i=>i.id),['inv-current','inv-second','inv-old']);
    assert.equal(guarantor.invoices.find(i=>i.id==='inv-old').remainingCents,0);
    assert.equal(w.smartGuestDashboard(id,visit.lookupToken).invoices.length,1);
    assert.throws(()=>w.search(id,'2002099',null,guarantor.lookupToken),/Look up/);
  } finally {w.close();}
});
test('Medical lookup requires local CAPTCHA and exact permitted identifiers', () => {
  const {w,id}=make();try {
    for(const input of [{captcha:false},{captcha:'true'},{accountNumber:'A100104801'},{accountNumber:100104801},{accountNumber:'999999'},{lastName:'Lee'},{lastName:''}])assert.throws(()=>w.medicalLookup(id,{accountNumber:'100104801',lastName:'Morgan',captcha:true,...input}));
    assert.throws(()=>w.smartLookup(id,{customerNumber:'1001048',lastName:'Morgan'}),/medical/);
    assert.equal(lookup(w,id,'100104801').invoices.length,1);
  } finally {w.close();}
});
test('Visit grants cannot authorize another visit or another guarantor at checkout', () => {
  const {w,id}=make();try {
    const r=lookup(w,id);assert.throws(()=>quote(w,id,r.lookupToken,{invoiceId:'inv-second',amountCents:12500}),/visit was not authorized/);
    assert.throws(()=>quote(w,id,r.lookupToken,{invoiceId:'inv-other',customerNumber:'2002099',amountCents:5190}),/Look up/);
    assert.throws(()=>quote(w,id,r.lookupToken,{methodId:'bank-1048'}),/Sign in/);
    assert.throws(()=>quote(w,id,r.lookupToken,{amountCents:20932}),/unpaid/);
  } finally {w.close();}
});
test('Medical payment is idempotent and leaves other visit balances unchanged', () => {
  const {w,id,f}=make();try {
    const r=lookup(w,id),q=quote(w,id,r.lookupToken),second=quote(w,id,r.lookupToken),p=w.pay(id,null,{token:q.token});
    assert.equal(w.pay(id,null,{token:q.token}).confirmation,p.confirmation);assert.throws(()=>w.pay(id,null,{token:second.token}),/balance changed/);
    assert.equal(w.evaluate(id,{confirmation:p.confirmation}).success,true);assert.equal(w.evaluate(id,{confirmation:'invented'}).success,false);
    const visits=lookup(w,id,'1001048').invoices;assert.equal(visits.find(i=>i.id==='inv-current').remainingCents,0);assert.equal(visits.find(i=>i.id==='inv-second').remainingCents,12500);
    const mail=w.messages(id,f.connectorToken,'subject:medical');assert.equal(mail.filter(m=>m.subject==='Your medical payment confirmation').length,1);
    assert.equal(JSON.stringify(w.state(id)).includes('000001048'),false);
  } finally {w.close();}
});
test('Medical grants and quotes are episode-bound and independently expire', () => {
  const {w,id}=make();try {
    const r=lookup(w,id),other=w.create({siteId}).episodeId,q=quote(w,id,r.lookupToken);
    assert.throws(()=>quote(w,other,r.lookupToken),/Look up/);assert.throws(()=>w.smartGuestDashboard(other,r.lookupToken),/Look up/);assert.throws(()=>w.pay(other,null,{token:q.token}),/review|Review/);
    w.advance(id,11*60000);assert.throws(()=>w.pay(id,null,{token:q.token}),/expired/);w.advance(id,5*60000);assert.throws(()=>quote(w,id,r.lookupToken),/Look up/);
  } finally {w.close();}
});
test('Paying another visit cannot satisfy the requested medical task', () => {
  const {w,id}=make();try {
    const r=lookup(w,id,'1001048'),q=quote(w,id,r.lookupToken,{invoiceId:'inv-second',amountCents:12500}),p=w.pay(id,null,{token:q.token});
    const result=w.evaluate(id,{confirmation:p.confirmation});assert.equal(result.success,false);assert.equal(result.checks.correct_invoice,false);assert.equal(result.checks.other_visit_balances_unchanged,false);
  } finally {w.close();}
});
test('Medical billing never inherits utility recurrence and pending is not posted', () => {
  const {w,id}=make({pending:true});try {
    const r=lookup(w,id),q=quote(w,id,r.lookupToken),p=w.pay(id,null,{token:q.token});assert.equal(w.evaluate(id,{confirmation:p.confirmation}).success,false);
    w.settle(id);assert.equal(w.evaluate(id,{confirmation:p.confirmation}).success,true);
    const identity=w.medicalIdentityBegin(id,{username:'alex.morgan'});const session=w.login(id,{username:'alex.morgan',password:'Billworld-2026!',identityChallenge:identity.challenge}).session;
    assert.throws(()=>w.autopay(id,session,{enabled:true,methodId:'bank-1048'}),/not implemented/);assert.throws(()=>w.schedule(id,session,{token:q.token,date:'2026-11-01'}),/not implemented/);
    w.advance(id,45*86400000);assert.equal(w.state(id).invoices.length,4);assert.equal(w.state(id).payments.filter(p=>!p.initial).length,1);
  } finally {w.close();}
});

test('Medical login requires the username-first sequence and idle activity renews a session',()=>{const {w,id}=make();try{assert.throws(()=>w.login(id,{email:'alex@billworld.test',password:'Billworld-2026!'}),/username/);const r=w.medicalIdentityBegin(id,{username:'alex.morgan'});assert.throws(()=>w.login(id,{username:'jordan.lee',password:'Billworld-2026!',identityChallenge:r.challenge}),/username/);const auth=w.login(id,{username:'alex.morgan',password:'Billworld-2026!',identityChallenge:r.challenge});assert.throws(()=>w.login(id,{username:'alex.morgan',password:'Billworld-2026!',identityChallenge:r.challenge}),/username/);w.advance(id,9*60000);w.medicalActivity(id,auth.session);w.advance(id,9*60000);assert.equal(w.dashboard(id,auth.session).invoices.length,3);w.advance(id,60000);assert.throws(()=>w.dashboard(id,auth.session),/sign in/);}finally{w.close();}});
