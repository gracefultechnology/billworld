import test from 'node:test';
import assert from 'node:assert/strict';
import {World} from '../engine.mjs';
import {start} from '../server.mjs';
import {postingDate, etMs, statementDocument} from '../charlotte.mjs';

const SITE = 'charlotte-county-utilities';
function episode(taskId) {
  const w = new World(':memory:'), f = w.create({siteId: SITE, taskId}), id = f.episodeId;
  const get = (route, session, query = {}) => w.charlotte(id, 'GET', route, {session, query});
  const post = (route, session, input = {}) => w.charlotte(id, 'POST', route, {session, input});
  const login = (password = 'Billworld-2026!') => post('login', null, {email: 'alex@billworld.test', password}).session;
  const pay = (session, input) => { post('pay/quote', session, {accountId: 'acct-primary', amount: '84.32', method: 'saved:bank-1048', ...input}); get('pay/review', session); post('pay/submit', session, {authorize: true}); return get('pay/receipt', session); };
  return {w, f, id, get, post, login, pay, evaluate: answer => w.evaluate(id, answer), state: () => w.state(id)};
}
const bank = {method: 'bank', name: 'Alex Morgan', routing: '021000021', accountNumber: '000001048', confirmAccountNumber: '000001048'};
const card = {method: 'card', name: 'Alex Morgan', cardNumber: '4242424242424242', expiry: '12/29', cvv: '123'};

test('posting follows the documented 8 p.m. Eastern same/next business day rule with county holidays', () => {
  assert.equal(postingDate(Date.parse('2026-10-03T16:00:00Z')), '2026-10-05'); // Saturday noon EDT
  assert.equal(postingDate(Date.parse('2026-10-09T23:59:00Z')), '2026-10-09'); // Friday 19:59 EDT
  assert.equal(postingDate(Date.parse('2026-10-10T00:00:00Z')), '2026-10-12'); // Friday 20:00 EDT
  assert.equal(postingDate(Date.parse('2026-11-25T23:00:00Z')), '2026-11-25'); // Wed 18:00 EST
  assert.equal(postingDate(Date.parse('2026-11-26T01:30:00Z')), '2026-11-30'); // Wed 20:30 EST -> after Thanksgiving holidays
  assert.equal(new Date(etMs('2026-11-02', 6)).toISOString(), '2026-11-02T11:00:00.000Z'); // EST after DST ends
});

test('signed payment: saved checking, $1 fee, review + authorization, idempotent, strict grader', () => {
  const e = episode('charlotte-signed-bank-pay-v1'), s = e.login();
  e.post('pay/quote', s, {accountId: 'acct-primary', amount: '84.32', method: 'saved:bank-1048'});
  assert.throws(() => e.post('pay/submit', s, {authorize: true}), /Review the payment/);
  e.get('pay/review', s);
  assert.throws(() => e.post('pay/submit', s, {authorize: false}), /authorization box/);
  const first = e.post('pay/submit', s, {authorize: true}), again = e.post('pay/submit', s, {authorize: true});
  assert.deepEqual(first, again);
  const r = e.get('pay/receipt', s);
  assert.equal(r.payment.feeCents, 100); assert.equal(r.payment.status, 'pending'); assert.equal(r.payment.postingDate, '2026-10-05');
  assert.equal(e.evaluate({confirmation: r.payment.confirmation}).success, true);
  assert.equal(e.evaluate({confirmation: 'BW-OLD-1048'}).success, false);
  assert.throws(() => e.pay(s, {}), /no balance due|exceed/);
});

test('signed payment grader rejects a new instrument, partial amount or extra changes', () => {
  for (const variant of [{...bank}, {amount: '50.00'}]) {
    const e = episode('charlotte-signed-bank-pay-v1'), s = e.login(), r = e.pay(s, variant);
    assert.equal(e.evaluate({confirmation: r.payment.confirmation}).success, false, JSON.stringify(variant));
  }
  const e = episode('charlotte-signed-bank-pay-v1'), s = e.login(), r = e.pay(s, {});
  e.post('paperless', s, {accountId: 'acct-primary', paperless: true, emailNotify: false, smsNotify: false});
  assert.equal(e.evaluate({confirmation: r.payment.confirmation}).checks.protected_state_unchanged, false);
});

test('quick pay: account number + service ZIP, card fee $2.95, no portal shortcut', () => {
  const e = episode('charlotte-quickpay-card-v1');
  assert.throws(() => e.post('guest/lookup', null, {accountNumber: '01048-021048', zip: '33950'}), /could not find/);
  e.post('guest/lookup', null, {accountNumber: '01048 021048', zip: '33952'});
  assert.equal(e.get('guest/account').balanceCents, 8432);
  assert.throws(() => e.post('guest/quote', null, {amount: '84.32', ...card, cardNumber: '378282246310005', cvv: '1234'}), /Visa, Mastercard and Discover/);
  assert.throws(() => e.post('guest/quote', null, {amount: '84.32', method: 'paypal'}), /not simulated/);
  e.post('guest/quote', null, {amount: '84.32', ...card});
  assert.throws(() => e.post('guest/pay', null, {authorize: true}), /Review/);
  assert.equal(e.get('guest/review').totalCents, 8727);
  e.post('guest/pay', null, {authorize: true});
  const {payment} = e.get('guest/receipt');
  assert.equal(e.evaluate({confirmation: payment.confirmation}).success, true);
  // A signed-in payment cannot satisfy the guest task.
  const e2 = episode('charlotte-quickpay-card-v1'), s = e2.login(), r = e2.pay(s, card);
  assert.equal(e2.evaluate({confirmation: r.payment.confirmation}).success, false);
});

test('registration: legacy eBill login is rejected, re-enrollment links the account, strict payment grading', () => {
  const e = episode('charlotte-register-link-pay-v1');
  assert.throws(() => e.login(), /did not transfer eBill \(Billtrust\) profiles/);
  const reg = {email: 'alex@billworld.test', confirmEmail: 'alex@billworld.test', password: 'Charlotte-2026!', confirmPassword: 'Charlotte-2026!', firstName: 'Alex', lastName: 'Morgan', phone: '941-555-0148', zip: '33952', acceptTerms: true};
  assert.throws(() => e.post('register', null, {...reg, password: 'short', confirmPassword: 'short'}), /8–32/);
  assert.throws(() => e.post('register', null, {...reg, acceptTerms: false}), /Terms/);
  const s = e.post('register', null, reg).session;
  assert.throws(() => e.get('pay/options', s), /Add an account/);
  assert.throws(() => e.post('link/verify', s, {accountNumber: '01048-021048', streetNumber: '1049', paperless: true}), /could not verify/);
  e.post('link/verify', s, {accountNumber: '01048-021048', streetNumber: '1048', paperless: true});
  assert.equal(e.get('link/review', s).serviceAddress, '1048 Harbor Blvd, Port Charlotte, FL 33952');
  assert.throws(() => e.post('link/add', s, {authorize: false}), /Terms/);
  e.post('link/add', s, {authorize: true, emailNotify: false});
  const r = e.pay(s, {...bank});
  assert.equal(e.evaluate({confirmation: r.payment.confirmation}).success, true);
  assert.equal(e.post('login', null, {email: 'alex@billworld.test', password: 'Charlotte-2026!'}).ok, true);
});

test('registration grader rejects paperless off, saved wallet methods and guest payment shortcuts', () => {
  const reg = {email: 'alex@billworld.test', confirmEmail: 'alex@billworld.test', password: 'Charlotte-2026!', confirmPassword: 'Charlotte-2026!', firstName: 'Alex', lastName: 'Morgan', phone: '9415550148', zip: '33952', acceptTerms: true};
  for (const [paperless, saveMethod] of [[false, false], [true, true]]) {
    const e = episode('charlotte-register-link-pay-v1'), s = e.post('register', null, reg).session;
    e.post('link/verify', s, {accountNumber: '01048-021048', streetNumber: '1048', paperless}); e.post('link/add', s, {authorize: true});
    const r = e.pay(s, {...bank, saveMethod});
    assert.equal(e.evaluate({confirmation: r.payment.confirmation}).success, false);
  }
  const e = episode('charlotte-register-link-pay-v1');
  e.post('guest/lookup', null, {accountNumber: '01048-021048', zip: '33952'}); e.post('guest/quote', null, {amount: '84.32', ...bank}); e.get('guest/review'); e.post('guest/pay', null, {authorize: true});
  assert.equal(e.evaluate({confirmation: e.get('guest/receipt').payment.confirmation}).success, false);
});

test('recovery: emailed one-use link, superseded links, session revocation and login required', () => {
  const e = episode('charlotte-recover-login-v1'), old = e.login();
  assert.match(e.post('recover', null, {email: 'nobody@billworld.test'}).message, /If a profile exists/);
  e.post('recover', null, {email: 'alex@billworld.test'}); e.post('recover', null, {email: 'alex@billworld.test'});
  const links = e.state().mail.filter(m => /reset your/i.test(m.subject)).map(m => m.text.match(/token=([A-Za-z0-9_-]+)/)[1]);
  assert.equal(links.length, 2);
  assert.throws(() => e.post('reset', null, {token: links[0], password: 'Restored-2026!', confirmPassword: 'Restored-2026!'}), /invalid or has expired/);
  e.post('reset', null, {token: links[1], password: 'Restored-2026!', confirmPassword: 'Restored-2026!'});
  assert.throws(() => e.post('reset', null, {token: links[1], password: 'Again-2026!', confirmPassword: 'Again-2026!'}), /invalid/);
  assert.throws(() => e.get('accounts', old), /log in again/);
  assert.equal(e.evaluate({}).success, false); // reset alone is not enough
  assert.throws(() => e.login(), /incorrect/);
  const s = e.login('Restored-2026!'); e.get('accounts', s);
  assert.equal(e.evaluate({}).success, true);
});

test('scheduling: future date only, no immediate payment, executes at 06:00 ET and posts', () => {
  const e = episode('charlotte-schedule-payment-v1'), s = e.login();
  assert.throws(() => e.post('pay/quote', s, {accountId: 'acct-primary', amount: '84.32', method: 'saved:bank-1048', date: '2026-10-02'}), /future/);
  assert.throws(() => e.post('pay/quote', s, {accountId: 'acct-primary', amount: '84.32', method: 'saved:bank-1048', date: '2027-03-01'}), /90 days/);
  const r = e.pay(s, {date: '2026-10-16'});
  assert.equal(r.type, 'scheduled');
  assert.equal(e.evaluate({scheduledDate: '2026-10-16'}).success, true);
  assert.equal(e.evaluate({scheduledDate: '2026-10-15'}).success, false);
  e.w.advance(e.id, Date.parse('2026-10-16T09:59:00Z') - e.state().now);
  assert.equal(e.state().payments.length, 1);
  e.w.advance(e.id, 60000);
  assert.equal(e.state().payments.length, 2);
  const p = e.state().payments.at(-1);
  assert.equal(p.source, 'scheduled'); assert.equal(p.status, 'pending'); assert.equal(p.postingDate, '2026-10-16');
  e.w.advance(e.id, 86400000); assert.equal(e.state().payments.at(-1).status, 'posted');
  // An immediate payment instead of a schedule fails the schedule task.
  const e2 = episode('charlotte-schedule-payment-v1'), s2 = e2.login(); e2.pay(s2, {});
  assert.equal(e2.evaluate({scheduledDate: '2026-10-16'}).success, false);
});

test('scheduled payments keep their own method; edit and cancel are strict', () => {
  const e = episode('charlotte-update-scheduled-payment-v1'), s = e.login();
  e.get('scheduled', s);
  assert.throws(() => e.post('scheduled/edit', s, {id: 'sched-1', date: '2026-10-02', amount: '84.32', methodId: 'bank-2210'}), /future/);
  const x = e.post('scheduled/edit', s, {id: 'sched-1', date: '2026-10-15', amount: '84.32', methodId: 'bank-2210'});
  assert.equal(x.feeCents, 100);
  assert.equal(e.evaluate({scheduledDate: '2026-10-15'}).success, true);
  const e2 = episode('charlotte-update-scheduled-payment-v1'), s2 = e2.login(); e2.get('scheduled', s2);
  e2.post('scheduled/edit', s2, {id: 'sched-1', date: '2026-10-15', amount: '80.00', methodId: 'bank-2210'});
  assert.equal(e2.evaluate({scheduledDate: '2026-10-15'}).success, false);
  // Changing AutoPay does not touch the scheduled payment (documented FAQ rule).
  const e3 = episode('charlotte-update-scheduled-payment-v1'), s3 = e3.login();
  e3.post('autopay/quote', s3, {accountId: 'acct-primary', enabled: true, methodId: 'bank-2210'});
  assert.equal(e3.get('autopay/review', s3).scheduledPayments[0].method.label, 'Visa ending 4242');
  e3.post('autopay/confirm', s3, {authorize: true, acknowledgeFee: true});
  assert.equal(e3.state().ccu.scheduled[0].method.id, 'card-4242');
  assert.equal(e3.evaluate({scheduledDate: '2026-10-15'}).success, false);
  const c = episode('charlotte-cancel-scheduled-payment-v1'), sc = c.login(); c.get('scheduled', sc);
  assert.throws(() => c.post('scheduled/cancel', sc, {id: 'sched-1', confirm: false}), /Confirm/);
  c.post('scheduled/cancel', sc, {id: 'sched-1', confirm: true});
  assert.throws(() => c.post('scheduled/cancel', sc, {id: 'sched-1', confirm: true}), /pending/);
  assert.equal(c.evaluate({}).success, true);
  c.w.advance(c.id, 30 * 86400000); assert.equal(c.state().payments.length, 1);
});

test('AutoPay: fee acknowledgement, final view, due-date execution, wallet protection and strict grading', () => {
  const e = episode('charlotte-enroll-autopay-v1'), s = e.login();
  e.get('autopay', s);
  e.post('autopay/quote', s, {accountId: 'acct-primary', enabled: true, methodId: 'bank-1048'});
  e.get('autopay/review', s);
  assert.throws(() => e.post('autopay/confirm', s, {authorize: true}), /\$1\.00 convenience fee/);
  e.post('autopay/confirm', s, {authorize: true, acknowledgeFee: true});
  assert.equal(e.evaluate({}).checks.final_settings_viewed, false);
  e.get('autopay', s);
  assert.equal(e.evaluate({}).success, true);
  assert.throws(() => e.post('wallet/remove', s, {methodId: 'bank-1048', confirm: true}), /used for AutoPay/);
  e.w.advance(e.id, Date.parse('2026-10-20T10:00:00Z') - e.state().now);
  const p = e.state().payments.at(-1); assert.equal(p.source, 'autopay'); assert.equal(p.feeCents, 100); assert.equal(p.amountCents, 8432);
  const change = episode('charlotte-change-autopay-method-v1'), sc = change.login();
  assert.equal(change.get('autopay', sc).accounts[0].feeCents, 295);
  change.post('autopay/quote', sc, {accountId: 'acct-primary', enabled: true, methodId: 'bank-1048'}); change.get('autopay/review', sc); change.post('autopay/confirm', sc, {authorize: true, acknowledgeFee: true}); change.get('autopay', sc);
  assert.equal(change.evaluate({}).success, true);
  // Cancelling then re-enrolling is two changes: rejected even though the final state matches.
  const flip = episode('charlotte-change-autopay-method-v1'), sf = flip.login();
  for (const enabled of [false, true]) { flip.post('autopay/quote', sf, {accountId: 'acct-primary', enabled, methodId: 'bank-1048'}); flip.get('autopay/review', sf); flip.post('autopay/confirm', sf, {authorize: true, acknowledgeFee: true}); }
  flip.get('autopay', sf); assert.equal(flip.evaluate({}).success, false);
  const cancel = episode('charlotte-cancel-autopay-v1'), sx = cancel.login();
  cancel.post('autopay/quote', sx, {accountId: 'acct-primary', enabled: false}); cancel.get('autopay/review', sx); cancel.post('autopay/confirm', sx, {authorize: true}); cancel.get('autopay', sx);
  assert.equal(cancel.evaluate({}).success, true);
  cancel.w.advance(cancel.id, 30 * 86400000); assert.equal(cancel.state().payments.length, 1);
});

test('paperless and alerts: SMS needs a mobile number, exact preferences and final view required', () => {
  const e = episode('charlotte-paperless-email-v1'), s = e.login();
  e.get('paperless', s);
  assert.throws(() => e.post('paperless', s, {accountId: 'acct-primary', paperless: true, emailNotify: true, smsNotify: true, mobile: ''}), /mobile number/);
  e.post('paperless', s, {accountId: 'acct-primary', paperless: true, emailNotify: true, smsNotify: false});
  assert.equal(e.evaluate({}).success, false);
  e.get('paperless', s);
  assert.equal(e.evaluate({}).success, true);
  assert.ok(e.state().mail.some(m => m.subject === 'You are enrolled in paperless billing'));
});

test('statements, history and HTTP routing are scoped and strict', async () => {
  const e = episode('charlotte-download-bill-v1'), s = e.login();
  const bills = e.get('bills', s).bills; assert.equal(bills[0].filename, 'CCU_Bill_01048-021048_2026-09-30.pdf');
  const doc = e.get('statement', s, {invoiceId: 'inv-current'}).download;
  assert.equal(doc.bytes.subarray(0, 5).toString(), '%PDF-');
  assert.deepEqual(doc.bytes, statementDocument(e.state(), e.state().invoices.find(i => i.id === 'inv-current')).bytes);
  assert.throws(() => e.get('statement', s, {invoiceId: 'inv-other'}), /not found/);
  assert.equal(e.evaluate({statementFilename: doc.filename}).success, true);
  e.get('statement', s, {invoiceId: 'inv-old'});
  assert.equal(e.evaluate({statementFilename: doc.filename}).success, false);
  const h = episode('charlotte-read-payment-history-v1'), sh = h.login();
  assert.equal(h.evaluate({confirmation: '7310048216'}).success, false);
  assert.equal(h.get('history', sh).payments[0].confirmation, '7310048216');
  assert.equal(h.evaluate({confirmation: '7310048216'}).success, true);
  const server = await start({port: 0, adminPort: 0, dbPath: ':memory:'});
  try {
    const f = server.world.create({siteId: SITE});
    const enter = await fetch(`${server.baseUrl}/enter/${f.episodeId}/${f.entryToken}`, {redirect: 'manual'});
    const cookie = enter.headers.getSetCookie().map(c => c.split(';')[0]).filter(c => !c.endsWith('=')).join('; ');
    const req = (path, body, origin = server.baseUrl) => fetch(server.baseUrl + path, body ? {method: 'POST', headers: {cookie, origin, 'content-type': 'application/json'}, body: JSON.stringify(body)} : {headers: {cookie}});
    assert.equal((await req('/api/login', {email: 'alex@billworld.test', password: 'Billworld-2026!'})).status, 404);
    assert.equal((await req('/api/ccu/login', {email: 'alex@billworld.test', password: 'Billworld-2026!'}, 'http://evil.test')).status, 403);
    assert.equal((await req('/api/ccu/login', {email: 'alex@billworld.test', password: 'Billworld-2026!'})).status, 200);
    assert.equal((await req('/api/session')).status, 200);
    const home = await (await req('/')).text(); assert.match(home, /Utilities Department/);
    const billing = await (await req('/departments/utilities/billing/')).text(); assert.match(billing, /href="\/cp\/ccfl">www\.charlottecountyfl\.gov\/Paymentus/);
    assert.match(await (await req('/cp/ccfl/accounts')).text(), /ccu\.js/);
    const other = server.world.create({siteId: 'juneau-utilities'});
    const enter2 = await fetch(`${server.baseUrl}/enter/${other.episodeId}/${other.entryToken}`, {redirect: 'manual'});
    const cookie2 = enter2.headers.getSetCookie().map(c => c.split(';')[0]).filter(c => !c.endsWith('=')).join('; ');
    assert.equal((await fetch(server.baseUrl + '/api/ccu/session', {headers: {cookie: cookie2}})).status, 404);
  } finally { await server.close(); }
});

test('expired reset links, stale reviews and foreign accounts are rejected', () => {
  const e = episode('charlotte-recover-login-v1');
  e.post('recover', null, {email: 'alex@billworld.test'});
  const token = e.state().mail.at(-1).text.match(/token=([A-Za-z0-9_-]+)/)[1];
  e.w.advance(e.id, 31 * 60000);
  assert.throws(() => e.get('reset/check', null, {token}), /expired/);
  const p = episode('charlotte-signed-bank-pay-v1'), s = p.login();
  p.post('pay/quote', s, {accountId: 'acct-primary', amount: '84.32', method: 'saved:bank-1048'}); p.get('pay/review', s);
  p.post('guest/lookup', null, {accountNumber: '01048-021048', zip: '33952'}); p.post('guest/quote', null, {amount: '84.32', ...card}); p.get('guest/review'); p.post('guest/pay', null, {authorize: true});
  assert.throws(() => p.post('pay/submit', s, {authorize: true}), /balance changed/);
  assert.equal(p.state().payments.length, 2);
  assert.throws(() => p.post('pay/quote', s, {accountId: 'acct-secondary', amount: '10.00', method: 'saved:bank-1048'}), /Linked account not found/);
  assert.throws(() => p.get('history', s, {accountId: 'acct-secondary'}), /Linked account not found/);
  const fresh = p.login(); assert.throws(() => p.post('pay/submit', fresh, {authorize: true}), /Start a payment/);
});
