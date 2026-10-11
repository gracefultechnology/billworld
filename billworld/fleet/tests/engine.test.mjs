// Unit tests for the fleet billing engine. Run: node --test billworld/fleet/tests/engine.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { FleetWorld, Fault, parseMoney, money, PASSWORD, START_TIME, TEST_CARDS, luhn, gradeAnswer } from '../engine.mjs';
import { parseFees, loadCatalog } from '../catalog.mjs';
import { login, pay, cancelService, mfaCode, resetCode, NEW_PASSWORD } from './solve.mjs';

const world = new FleetWorld();
const MIN = 60000, DAY = 86400000;
const catalog = loadCatalog();
// First online biller matching a predicate (deterministic: catalog order is stable).
const find = (pred, label) => { for (const b of catalog.billers.values()) if (b.template !== 'offline' && pred(b)) return b.id; throw new Error(`no biller for ${label}`); };
const B = {
  utilitySynthetic: find(b => b.kind === 'utility' && b.fees.evidence === 'synthetic', 'utility synthetic'),
  pct: find(b => b.fees.cardPercent != null && b.fees.bankCents == null, 'percent fee'),
  flat: find(b => b.fees.cardCents > 0 && b.fees.cardPercent == null, 'flat fee'),
  zero: find(b => b.fees.cardCents === 0 && b.fees.bankCents === 0, 'no fee'),
  tax: find(b => b.kind === 'tax' && b.fees.evidence === 'synthetic', 'tax synthetic'),
  subscription: find(b => b.kind === 'subscription' && b.capabilities.cancel_service.support === 'supported', 'subscription'),
  card: find(b => b.kind === 'card', 'card'),
  medical: find(b => b.kind === 'medical', 'medical'),
  guest: find(b => b.capabilities.guest_pay.support === 'supported' && !b.dossier, 'guest'),
  offline: [...catalog.billers.values()].find(b => b.template === 'offline').id
};
const U = B.utilitySynthetic;
const fresh = (scenario = {}, seed) => world.createEpisode({ seed: seed ?? `t-${Math.random()}`, scenario });
const sc = (id, s) => ({ [id]: s });
const throwsCode = (fn, code) => assert.throws(fn, e => e instanceof Fault && e.code === code, `expected Fault ${code}`);
const ev = (ep, id, preds) => world.evaluate(ep, preds.map(p => ({ billerId: id, ...p })));
const events = (ep, type) => ep.events.filter(e => e.type === type);

test('money parsing and formatting', () => {
  assert.equal(parseMoney('12.34'), 1234);
  assert.equal(parseMoney('$1,234.56'), 123456);
  assert.equal(parseMoney(' 5 '), 500);
  assert.equal(parseMoney('0.1'), 10);
  assert.equal(parseMoney(19.99), 1999);
  assert.equal(parseMoney('1.005'.slice(0, 4)), 100);
  for (const bad of ['1.234', 'abc', '-5', '', null, '1e3', '12.3.4']) throwsCode(() => parseMoney(bad), 'invalid_amount');
  assert.equal(money(123456), '$1,234.56');
  assert.equal(money(5), '$0.05');
  assert.equal(money(-250), '-$2.50');
  assert.equal(money(100000000), '$1,000,000.00');
});

test('luhn and test cards', () => {
  assert.ok(luhn(TEST_CARDS.visa) && luhn(TEST_CARDS.mastercard) && luhn(TEST_CARDS.declined) && luhn('4111111111111111'));
  assert.ok(!luhn('4111111111111112') && !luhn('1234'));
});

test('fee parsing from research notes', () => {
  assert.deepEqual(parseFees({ notes: 'Card payments carry a 2.5% convenience fee.' }), { cardCents: null, cardPercent: 2.5, bankCents: null, evidence: 'documented_notes' });
  assert.equal(parseFees({ notes: 'A $3.95 convenience fee applies to card payments.' }).cardCents, 395);
  assert.deepEqual(parseFees({ notes: 'Pay online with no convenience fee.' }), { cardCents: 0, cardPercent: null, bankCents: 0, evidence: 'documented_notes' });
  assert.equal(parseFees({ notes: 'Nothing about money.' }).evidence, 'synthetic');
  assert.equal(parseFees({ notes: 'fee of 45% lol' }).cardPercent, null, 'implausible percent ignored');
});

test('fees by method and evidence', () => {
  const bank = { type: 'bank' }, card = { type: 'card' };
  assert.equal(world.fee(U, bank, 10000), 0);
  assert.equal(world.fee(U, card, 10000), 295, 'synthetic utility card fee');
  const pct = world.biller(B.pct).fees.cardPercent;
  assert.equal(world.fee(B.pct, card, 10000), Math.round(10000 * pct / 100));
  assert.equal(world.fee(B.flat, card, 10000), world.biller(B.flat).fees.cardCents);
  assert.equal(world.fee(B.zero, card, 10000), 0);
  assert.equal(world.fee(B.tax, card, 1000), 195, 'tax minimum synthetic fee');
  assert.equal(world.fee(B.tax, card, 100000), 2350, 'tax 2.35% synthetic fee');
  // Fee is carried through draft and receipt, and not added to the amount applied to the bill.
  const ep = fresh(); const sid = login(world, ep, U);
  const d = world.draftPayment(ep, U, sid, { amountChoice: 'other', amount: '40.00', methodId: 'pm-card' });
  assert.equal(d.feeCents, 295); assert.equal(d.totalCents, 4295);
  const p = world.submitPayment(ep, U, sid, { token: d.token, acceptTerms: true });
  assert.equal(p.amountCents, 4000); assert.equal(p.feeCents, 295);
});

test('draft validation: amount bounds, dates, methods, terms', () => {
  const ep = fresh(); const sid = login(world, ep, U);
  throwsCode(() => world.draftPayment(ep, U, sid, { amountChoice: 'other', amount: '0.50' }), 'min_amount');
  throwsCode(() => world.draftPayment(ep, U, sid, { amountChoice: 'other', amount: '20000.00' }), 'max_amount');
  throwsCode(() => world.draftPayment(ep, U, sid, { amountChoice: 'other', amount: 'ten' }), 'invalid_amount');
  throwsCode(() => world.draftPayment(ep, U, sid, { payOn: '2026-09-01' }), 'past_date');
  throwsCode(() => world.draftPayment(ep, U, sid, { payOn: '2028-01-01' }), 'far_date');
  throwsCode(() => world.draftPayment(ep, U, sid, { payOn: 'soon' }), 'bad_date');
  throwsCode(() => world.draftPayment(ep, U, sid, { methodType: 'bank', routing: '123456789', bankAccount: '1234567' }), 'bad_routing');
  throwsCode(() => world.draftPayment(ep, U, sid, { methodType: 'bank', routing: '021000021', bankAccount: '1234567', bankAccountConfirm: '7654321' }), 'mismatch');
  throwsCode(() => world.draftPayment(ep, U, sid, { methodType: 'card', cardNumber: '4111111111111112', exp: '12/28', cvv: '123' }), 'bad_card');
  throwsCode(() => world.draftPayment(ep, U, sid, { methodType: 'card', cardNumber: '4111111111111111', exp: '01/26', cvv: '123' }), 'bad_exp');
  throwsCode(() => world.draftPayment(ep, U, sid, { methodType: 'card', cardNumber: '4111111111111111', exp: '12/28', cvv: '1' }), 'bad_cvv');
  throwsCode(() => world.draftPayment(ep, U, sid, { methodId: 'pm-nope' }), 'no_method');
  const d = world.draftPayment(ep, U, sid, { amountChoice: 'due', methodId: 'pm-chk', payOn: '2026-10-03' });
  assert.equal(d.payOn, null, 'today is an immediate payment');
  throwsCode(() => world.submitPayment(ep, U, sid, { token: d.token, acceptTerms: false }), 'terms');
  throwsCode(() => world.submitPayment(ep, U, sid, { token: 'forged', acceptTerms: true }), 'stale');
  const ep2 = fresh(sc(U, { expiredCard: true })); const sid2 = login(world, ep2, U);
  throwsCode(() => world.draftPayment(ep2, U, sid2, { methodId: 'pm-old' }), 'expired_card');
});

test('allocation pays oldest invoice first and posts after business days', () => {
  const ep = fresh(sc(U, { pastDueCents: 3000, amountCents: 10000 })); const sid = login(world, ep, U);
  const acct = world.account(ep, U);
  assert.equal(world.balance(acct), 13000);
  const p = pay(world, ep, U, sid, { amountChoice: 'other', amount: '50.00', methodId: 'pm-chk' });
  assert.equal(p.status, 'pending');
  assert.deepEqual(p.allocations.map(a => a.cents), [3000, 2000]);
  assert.equal(p.allocations[0].invoiceId, acct.invoices[10].id);
  assert.equal(world.balance(acct), 8000, 'pending payments reduce the balance immediately');
  world.advance(ep, 5 * DAY);
  assert.equal(p.status, 'posted');
  assert.equal(acct.invoices[10].balanceCents, 0); assert.equal(acct.invoices[10].status, 'paid');
  assert.equal(acct.invoices[11].balanceCents, 8000);
  assert.equal(world.balance(acct), 8000, 'balance unchanged by posting');
  assert.ok(p.postsAt > p.createdAt + 2 * DAY - 1, 'bank payments take 2 business days');
});

test('duplicate submit is idempotent', () => {
  const ep = fresh(); const sid = login(world, ep, U); const acct = world.account(ep, U);
  const d = world.draftPayment(ep, U, sid, { amountChoice: 'due', methodId: 'pm-chk' });
  const a = world.submitPayment(ep, U, sid, { token: d.token, acceptTerms: true });
  const b = world.submitPayment(ep, U, sid, { token: d.token, acceptTerms: true });
  assert.equal(a, b);
  assert.equal(acct.payments.filter(p => !p.seeded).length, 1);
  assert.equal(events(ep, 'payment_submitted').length, 1);
  assert.equal(ep.mailbox.filter(m => /Payment received/.test(m.subject)).length, 1);
  assert.ok(ev(ep, U, [{ type: 'payment', count: 1 }]).success);
});

test('declined card fails the attempt, keeps amount and allows retry with another method', () => {
  const ep = fresh(sc(U, { declineSavedCard: true })); const sid = login(world, ep, U); const acct = world.account(ep, U);
  const bal = world.balance(acct);
  const d = world.draftPayment(ep, U, sid, { amountChoice: 'due', methodId: 'pm-card' });
  assert.throws(() => world.submitPayment(ep, U, sid, { token: d.token, acceptTerms: true }), e => e.code === 'declined' && e.status === 402);
  const agent = () => acct.payments.filter(p => !p.seeded);
  assert.equal(agent()[0].status, 'failed');
  assert.equal(world.balance(acct), bal, 'failed payment does not reduce the balance');
  assert.equal(acct.draft.methodId, null); assert.equal(acct.draft.token, null); assert.equal(acct.draft.amountCents, bal);
  throwsCode(() => world.submitPayment(ep, U, sid, { token: d.token, acceptTerms: true }), 'declined'); // double-click replays the decline
  assert.equal(agent().length, 1, 'replay does not create another attempt');
  assert.ok(!ev(ep, U, [{ type: 'payment', count: 1 }]).success, 'failed attempt is not a payment');
  assert.ok(ev(ep, U, [{ type: 'no_payment' }]).success);
  const p = pay(world, ep, U, sid, { methodId: 'pm-chk' });
  assert.equal(p.amountCents, bal);
  assert.ok(ev(ep, U, [{ type: 'payment', methodType: 'bank', count: 1 }]).success);
  // New declining test card number entered by hand.
  const ep2 = fresh(); const sid2 = login(world, ep2, U);
  const d2 = world.draftPayment(ep2, U, sid2, { amountChoice: 'due', methodType: 'card', cardNumber: TEST_CARDS.declined, exp: '12/28', cvv: '123' });
  throwsCode(() => world.submitPayment(ep2, U, sid2, { token: d2.token, acceptTerms: true }), 'declined');
});

test('scheduled payment: cancel before processing, not after', () => {
  const ep = fresh(); const sid = login(world, ep, U); const acct = world.account(ep, U); const bal = world.balance(acct);
  const p = pay(world, ep, U, sid, { amountChoice: 'due', methodId: 'pm-chk', payOn: '2026-10-08' });
  assert.equal(p.status, 'scheduled'); assert.equal(world.balance(acct), bal, 'scheduled payments do not reduce balance');
  throwsCode(() => world.removeMethod(ep, U, sid, { methodId: 'pm-chk' }), 'in_use');
  world.cancelScheduled(ep, U, sid, { paymentId: p.id });
  assert.equal(p.status, 'cancelled');
  throwsCode(() => world.cancelScheduled(ep, U, sid, { paymentId: p.id }), 'not_cancellable');
  throwsCode(() => world.cancelScheduled(ep, U, sid, { paymentId: 'pay-missing' }), 'not_found');
  assert.ok(ev(ep, U, [{ type: 'scheduled_cancelled' }, { type: 'no_payment' }]).success);
  world.advance(ep, 10 * DAY);
  assert.equal(p.status, 'cancelled', 'cancelled payment never processes');
  const sid2 = login(world, ep, U); // the 30-minute session expired while time advanced
  const q = pay(world, ep, U, sid2, { amountChoice: 'other', amount: '5.00', methodId: 'pm-chk' });
  throwsCode(() => world.cancelScheduled(ep, U, sid2, { paymentId: q.id }), 'not_cancellable');
});

test('virtual time: scheduled → processed → posted', () => {
  const ep = fresh(); const sid = login(world, ep, U); const acct = world.account(ep, U); const bal = world.balance(acct);
  const p = pay(world, ep, U, sid, { amountChoice: 'due', methodId: 'pm-chk', payOn: '2026-10-08' });
  world.advance(ep, 4 * DAY);
  assert.equal(p.status, 'scheduled', 'not before its date');
  world.advance(ep, 1 * DAY); // 10-08: scheduled payments run on their date
  assert.equal(p.status, 'pending'); assert.equal(events(ep, 'scheduled_payment_processed').length, 1);
  world.advance(ep, 1 * DAY);
  assert.equal(world.balance(acct), 0);
  world.advance(ep, 4 * DAY);
  assert.equal(p.status, 'posted'); assert.equal(events(ep, 'payment_posted').length, 1);
  assert.equal(world.currentInvoice(acct).status, 'paid'); assert.equal(world.currentInvoice(acct).balanceCents, 0);
  assert.ok(bal > 0);
  assert.equal(ep.clock, START_TIME + 10 * DAY);
  assert.equal(Object.keys(ep.sessions).length, 0, 'sessions expire with virtual time');
});

test('autopay policies and validation', () => {
  const ep = fresh(); const sid = login(world, ep, U); const acct = world.account(ep, U);
  throwsCode(() => world.autopay(ep, U, sid, { methodId: 'pm-chk' }), 'terms');
  throwsCode(() => world.autopay(ep, U, sid, { methodId: 'pm-chk', acceptTerms: true, policy: 'minimum' }), 'bad_policy');
  throwsCode(() => world.autopay(ep, U, sid, { methodId: 'pm-chk', acceptTerms: true, policy: 'fixed', fixedAmount: '0.50' }), 'min_amount');
  throwsCode(() => world.autopay(ep, U, sid, { methodId: 'pm-chk', acceptTerms: true, day: '31' }), 'bad_day');
  throwsCode(() => world.autopay(ep, U, sid, { action: 'cancel', confirm: true }), 'not_enrolled');
  assert.equal(acct.autopay.enrolled, false);
  world.autopay(ep, U, sid, { methodId: 'pm-chk', acceptTerms: true, policy: 'fixed', fixedAmount: '75.00', day: '15' });
  assert.deepEqual([acct.autopay.enrolled, acct.autopay.policy, acct.autopay.fixedCents, acct.autopay.day], [true, 'fixed', 7500, 15]);
  assert.ok(ev(ep, U, [{ type: 'autopay', enrolled: true, methodType: 'bank', policy: 'fixed', day: 15 }]).success);
  assert.ok(!ev(ep, U, [{ type: 'autopay', enrolled: true, methodType: 'card' }]).success, 'wrong method type');
  assert.ok(!ev(ep, U, [{ type: 'autopay_unchanged' }]).success);
  world.autopay(ep, U, sid, { methodId: 'pm-card', acceptTerms: true });
  assert.equal(events(ep, 'autopay_updated').length, 1);
  throwsCode(() => world.removeMethod(ep, U, sid, { methodId: 'pm-card' }), 'in_use');
  throwsCode(() => world.autopay(ep, U, sid, { action: 'cancel' }), 'confirm');
  world.autopay(ep, U, sid, { action: 'cancel', confirm: true });
  assert.ok(ev(ep, U, [{ type: 'autopay', enrolled: false }]).success);
  // Minimum policy is allowed on card accounts.
  const C = B.card; const ep2 = fresh(); const sid2 = login(world, ep2, C);
  world.autopay(ep2, C, sid2, { methodId: 'pm-chk', acceptTerms: true, policy: 'minimum' });
  assert.equal(world.account(ep2, C).autopay.policy, 'minimum');
});

test('autopay charges an existing enrollment exactly once; a new enrollment waits for the next bill', () => {
  const ep = fresh(sc(U, { autopay: true, dueInDays: 10 })); const acct = world.account(ep, U); const bal = world.balance(acct);
  assert.ok(world.evaluate(ep, [{ billerId: U, type: 'no_payment' }]).success);
  world.advance(ep, 9 * DAY);
  assert.equal(events(ep, 'autopay_payment').length, 0, 'not before the due date');
  world.advance(ep, 1 * DAY);
  assert.equal(events(ep, 'autopay_payment').length, 1, 'charged on the due date');
  const p = acct.payments.find(x => x.source === 'autopay' && !x.seeded); assert.equal(p.amountCents, bal);
  world.advance(ep, 60 * DAY);
  // Bills issued every 30 days: due dates at +10, +40 and +70 days; each is paid exactly once.
  assert.equal(events(ep, 'autopay_payment').length, 3, 'once per bill');
  assert.equal(acct.invoices.length, 14, 'two new bills issued');
  assert.equal(new Set(acct.payments.filter(x => x.source === 'autopay' && !x.seeded).map(x => x.allocations[0].invoiceId)).size, 3);
  assert.equal(p.status, 'posted');
  assert.ok(ev(ep, U, [{ type: 'no_payment' }]).success, 'autopay charges are not agent payments');
  const ep2 = fresh(sc(U, { dueInDays: 5 })); const sid2 = login(world, ep2, U);
  world.autopay(ep2, U, sid2, { methodId: 'pm-chk', acceptTerms: true });
  world.advance(ep2, 30 * DAY);
  assert.equal(events(ep2, 'autopay_payment').length, 0, 'enrolled after the bill was issued');
});

test('password reset: supersession, expiry, single use, no enumeration', () => {
  const ep = fresh(sc(U, { forgotPassword: true }));
  const before = ep.mailbox.length;
  world.requestReset(ep, U, { identifier: 'nobody@example.com' });
  assert.equal(ep.mailbox.length, before, 'unknown identifier sends nothing');
  world.requestReset(ep, U, { identifier: ep.persona.email });
  const first = resetCode(ep, U);
  world.requestReset(ep, U, { identifier: world.account(ep, U).accountNumber });
  const second = resetCode(ep, U);
  assert.notEqual(first, second);
  throwsCode(() => world.resetPassword(ep, U, { code: first, password: NEW_PASSWORD, confirm: NEW_PASSWORD }), 'bad_code');
  throwsCode(() => world.resetPassword(ep, U, { code: second, password: 'weak', confirm: 'weak' }), 'weak_password');
  throwsCode(() => world.resetPassword(ep, U, { code: second, password: NEW_PASSWORD, confirm: 'Other-Pass-2026!' }), 'mismatch');
  world.resetPassword(ep, U, { code: second, password: NEW_PASSWORD, confirm: NEW_PASSWORD });
  throwsCode(() => world.resetPassword(ep, U, { code: second, password: 'Third-Pass-2026!', confirm: 'Third-Pass-2026!' }), 'bad_code');
  assert.ok(ev(ep, U, [{ type: 'password_changed', password: NEW_PASSWORD }]).success);
  assert.ok(!ev(ep, U, [{ type: 'password_changed', password: 'Something-Else-1!' }]).success);
  throwsCode(() => world.login(ep, U, { username: ep.persona.email, password: PASSWORD }), 'bad_credentials');
  assert.ok(login(world, ep, U, NEW_PASSWORD));
  // Link token works too; reusing the current password is refused; codes expire after 30 minutes.
  const ep2 = fresh();
  world.requestReset(ep2, U, { identifier: ep2.persona.email });
  const tok = ep2.mailbox[0].links[0].query.token;
  throwsCode(() => world.resetPassword(ep2, U, { token: tok, password: PASSWORD, confirm: PASSWORD }), 'reused');
  world.advance(ep2, 31 * MIN);
  throwsCode(() => world.resetPassword(ep2, U, { token: tok, password: NEW_PASSWORD, confirm: NEW_PASSWORD }), 'bad_code');
});

test('reset invalidates existing sessions and clears lockout', () => {
  const ep = fresh(); const sid = login(world, ep, U);
  for (let i = 0; i < 5; i++) assert.throws(() => world.login(ep, U, { username: ep.persona.email, password: 'nope' }));
  throwsCode(() => world.login(ep, U, { username: ep.persona.email, password: PASSWORD }), 'locked');
  world.requestReset(ep, U, { identifier: ep.persona.email });
  world.resetPassword(ep, U, { code: resetCode(ep, U), password: NEW_PASSWORD, confirm: NEW_PASSWORD });
  assert.equal(world.session(ep, U, sid), null);
  assert.ok(login(world, ep, U, NEW_PASSWORD));
});

test('lockout after five failures, released by time', () => {
  const ep = fresh();
  for (let i = 0; i < 4; i++) throwsCode(() => world.login(ep, U, { username: ep.persona.email, password: 'wrong' }), 'bad_credentials');
  assert.ok(login(world, ep, U), 'four failures do not lock');
  for (let i = 0; i < 5; i++) throwsCode(() => world.login(ep, U, { username: ep.persona.email, password: 'wrong' }), 'bad_credentials');
  throwsCode(() => world.login(ep, U, { username: ep.persona.email, password: PASSWORD }), 'locked');
  world.advance(ep, 16 * MIN);
  assert.ok(login(world, ep, U));
  assert.equal(events(ep, 'login_failed').length, 9);
});

test('login identity rules: account number works, unregistered and unverified refused', () => {
  const ep = fresh(); const acct = world.account(ep, U);
  assert.ok(world.login(ep, U, { username: acct.accountNumber, password: PASSWORD }).sid);
  assert.ok(world.login(ep, U, { username: ep.persona.email.toUpperCase(), password: PASSWORD }).sid);
  const ep2 = fresh(sc(U, { registered: false }));
  throwsCode(() => world.login(ep2, U, { username: ep2.persona.email, password: PASSWORD }), 'bad_credentials');
  throwsCode(() => world.register(ep2, U, { accountNumber: '1', email: ep2.persona.email, password: PASSWORD, confirm: PASSWORD }), 'no_match');
  throwsCode(() => world.register(ep2, U, { accountNumber: world.account(ep2, U).accountNumber, lastName: 'Wrong', email: ep2.persona.email, password: PASSWORD, confirm: PASSWORD }), 'no_match');
  throwsCode(() => world.register(ep2, U, { accountNumber: world.account(ep2, U).accountNumber, email: 'x@y.z', password: PASSWORD, confirm: PASSWORD }), 'email_mismatch');
  world.register(ep2, U, { accountNumber: world.account(ep2, U).accountNumber, lastName: ep2.persona.last, email: ep2.persona.email, password: PASSWORD, confirm: PASSWORD });
  throwsCode(() => world.login(ep2, U, { username: ep2.persona.email, password: PASSWORD }), 'unverified');
  assert.ok(!ev(ep2, U, [{ type: 'registered' }]).success);
  throwsCode(() => world.verifyEmail(ep2, U, 'bogus'), 'bad_token');
  world.verifyEmail(ep2, U, ep2.mailbox[0].links[0].query.token);
  assert.ok(ev(ep2, U, [{ type: 'registered' }]).success);
  throwsCode(() => world.register(ep2, U, { accountNumber: world.account(ep2, U).accountNumber, email: ep2.persona.email, password: PASSWORD, confirm: PASSWORD }), 'exists');
  throwsCode(() => world.login(world.createEpisode({ seed: 'off' }), B.offline, { username: 'a', password: 'b' }), 'unsupported');
});

test('MFA: code required, wrong code, expiry, attempt limit', () => {
  const ep = fresh(sc(U, { mfa: 'email' }));
  const r = world.login(ep, U, { username: ep.persona.email, password: PASSWORD });
  assert.equal(r.mfa, true);
  throwsCode(() => world.requireSession(ep, U, r.sid), 'auth_required');
  throwsCode(() => world.verifyMfa(ep, U, r.sid, { code: '000000' === mfaCode(ep, U) ? '111111' : '000000' }), 'bad_code');
  world.verifyMfa(ep, U, r.sid, { code: mfaCode(ep, U) });
  assert.ok(world.requireSession(ep, U, r.sid));
  const r2 = world.login(ep, U, { username: ep.persona.email, password: PASSWORD });
  world.advance(ep, 11 * MIN);
  throwsCode(() => world.verifyMfa(ep, U, r2.sid, { code: mfaCode(ep, U) }), 'expired');
  const r3 = world.login(ep, U, { username: ep.persona.email, password: PASSWORD });
  for (let i = 0; i < 5; i++) throwsCode(() => world.verifyMfa(ep, U, r3.sid, { code: 'x' }), 'bad_code');
  throwsCode(() => world.verifyMfa(ep, U, r3.sid, { code: mfaCode(ep, U) }), 'too_many');
});

test('guest lookup requires matching identifiers', () => {
  const G = B.guest; const ep = fresh(); const acct = world.account(ep, G);
  throwsCode(() => world.guestLookup(ep, G, { accountNumber: '999', lastName: ep.persona.last }), 'no_match');
  throwsCode(() => world.guestLookup(ep, G, { accountNumber: acct.accountNumber, lastName: 'Nobody' }), 'no_match');
  throwsCode(() => world.guestLookup(ep, G, { accountNumber: acct.accountNumber, zip: '00000' }), 'no_match');
  throwsCode(() => world.guestLookup(ep, G, { accountNumber: acct.accountNumber, amountDue: '0.01' }), 'no_match');
  throwsCode(() => world.guestLookup(ep, G, { accountNumber: acct.accountNumber, amountDue: 'garbage' }), 'no_match');
  assert.equal(events(ep, 'guest_lookup_failed').length, 5);
  const { sid } = world.guestLookup(ep, G, { accountNumber: acct.accountNumber, zip: ep.persona.zip });
  assert.ok(world.guestLookup(ep, G, { accountNumber: acct.accountNumber, amountDue: (world.currentInvoice(acct).amountCents / 100).toFixed(2) }).sid);
  throwsCode(() => world.requireSession(ep, G, sid), 'auth_required');
  throwsCode(() => world.guestAccount(ep, G, 'nope'), 'guest_required');
  const p = pay(world, ep, G, sid, { amountChoice: 'due', methodType: 'card', cardNumber: '4111111111111111', exp: '12/28', cvv: '123' }, { guest: true });
  assert.equal(p.source, 'guest');
  assert.ok(!world.account(ep, G).methods.find(m => m.id === p.methodId).saved, 'guest card not saved');
  assert.ok(ev(ep, G, [{ type: 'payment', methodType: 'card', source: 'guest', count: 1 }]).success);
});

test('cancellation: reason → offer → confirm, retention accept, undo, end of term', () => {
  const S = B.subscription;
  const ep = fresh(); const sid = login(world, ep, S);
  throwsCode(() => world.cancelService(ep, S, sid, { step: 'reason' }), 'reason');
  assert.equal(world.cancelService(ep, S, sid, { step: 'reason', reason: 'price' }).next, 'offer');
  assert.equal(world.cancelService(ep, S, sid, { step: 'offer', accept: 'yes' }).next, 'kept');
  assert.ok(ev(ep, S, [{ type: 'service', status: 'active' }, { type: 'retention_accepted', value: true }]).success);
  assert.ok(!ev(ep, S, [{ type: 'retention_accepted', value: false }]).success);
  const ep2 = fresh(); const sid2 = login(world, ep2, S); const acct = world.account(ep2, S);
  world.cancelService(ep2, S, sid2, { step: 'reason', reason: 'price' });
  assert.equal(world.cancelService(ep2, S, sid2, { step: 'offer', accept: 'no' }).next, 'confirm');
  throwsCode(() => world.cancelService(ep2, S, sid2, { step: 'confirm' }), 'confirm');
  throwsCode(() => world.cancelService(ep2, S, sid2, { step: 'bogus' }), 'bad_step');
  assert.equal(world.cancelService(ep2, S, sid2, { step: 'confirm', confirm: true }).next, 'done');
  assert.equal(acct.service.cancelAt, world.currentInvoice(acct).dueAt, 'subscriptions end at the end of the paid period');
  assert.ok(ev(ep2, S, [{ type: 'service', status: 'cancel_pending' }, { type: 'retention_accepted', value: false }, { type: 'no_payment' }]).success);
  throwsCode(() => world.cancelService(ep2, S, sid2, { step: 'reason', reason: 'again' }), 'already');
  world.cancelService(ep2, S, sid2, { step: 'undo' });
  assert.equal(acct.service.status, 'active'); assert.equal(events(ep2, 'cancellation_withdrawn').length, 1);
  throwsCode(() => world.cancelService(ep2, S, sid2, { step: 'undo' }), 'none');
  cancelService(world, ep2, S, login(world, ep2, S));
  world.advance(ep2, 40 * DAY);
  assert.equal(acct.service.status, 'cancelled'); assert.equal(events(ep2, 'service_ended').length, 1);
  // Utility: no retention offer, stop date must be in the future.
  const ep3 = fresh(); const sid3 = login(world, ep3, U);
  assert.equal(world.cancelService(ep3, U, sid3, { step: 'reason', reason: 'moving' }).next, 'confirm');
  throwsCode(() => world.cancelService(ep3, U, sid3, { step: 'confirm', confirm: true, effectiveDate: '2026-01-01' }), 'bad_date');
  world.cancelService(ep3, U, sid3, { step: 'confirm', confirm: true, effectiveDate: '2026-10-20' });
  assert.equal(world.account(ep3, U).service.status, 'cancel_pending');
  // Not cancellable online.
  const M = B.medical; const ep4 = fresh();
  throwsCode(() => world.cancelService(ep4, M, login(world, ep4, M), { step: 'reason', reason: 'x' }), 'unsupported');
});

test('plan changes', () => {
  const S = B.subscription; const ep = fresh(); const sid = login(world, ep, S);
  throwsCode(() => world.changePlan(ep, S, sid, { planId: 'gold' }), 'bad_plan');
  world.changePlan(ep, S, sid, { planId: 'basic' });
  assert.ok(ev(ep, S, [{ type: 'service', status: 'active', plan: 'basic' }]).success);
  assert.ok(!ev(ep, S, [{ type: 'service', status: 'active', plan: 'premium' }]).success);
  throwsCode(() => world.changePlan(ep, U, login(world, ep, U), { planId: 'basic' }), 'unsupported');
});

test('evaluation rejects false positives', () => {
  const ep = fresh(); const sid = login(world, ep, U); const due = world.balance(world.account(ep, U));
  // Wrong amount.
  pay(world, ep, U, sid, { amountChoice: 'other', amount: '25.00', methodId: 'pm-chk' });
  assert.ok(!ev(ep, U, [{ type: 'payment', amountCents: due, count: 1 }]).success, 'wrong amount');
  assert.ok(!ev(ep, U, [{ type: 'payment', amountKey: 'due', count: 1 }]).success, 'other amount is not "due"');
  assert.ok(ev(ep, U, [{ type: 'payment', amountCents: 2500, count: 1 }]).success);
  // Wrong method.
  assert.ok(!ev(ep, U, [{ type: 'payment', methodType: 'card', count: 1 }]).success, 'wrong method');
  // Duplicate payment (second, separate submission).
  pay(world, ep, U, sid, { amountChoice: 'other', amount: '25.00', methodId: 'pm-chk' });
  assert.ok(!ev(ep, U, [{ type: 'payment', amountCents: 2500, count: 1 }]).success, 'duplicate payment');
  assert.ok(!ev(ep, U, [{ type: 'no_payment' }]).success);
  // Scheduled vs immediate and pay date.
  const ep2 = fresh(); const sid2 = login(world, ep2, U);
  pay(world, ep2, U, sid2, { amountChoice: 'due', methodId: 'pm-chk', payOn: '2026-10-16' });
  assert.ok(!ev(ep2, U, [{ type: 'payment', scheduled: true, payOn: '2026-10-15', count: 1 }]).success, 'wrong date');
  assert.ok(!ev(ep2, U, [{ type: 'payment', scheduled: false, count: 1 }]).success, 'scheduled is not immediate');
  // Seeded scheduled payment is not the agent's payment.
  const ep3 = fresh(sc(U, { scheduledPayment: true })); world.account(ep3, U);
  assert.ok(ev(ep3, U, [{ type: 'no_payment' }]).success, 'seeded payment not counted');
  assert.ok(!ev(ep3, U, [{ type: 'payment', scheduled: true, count: 1 }]).success, 'seeded payment does not satisfy a payment task');
  assert.ok(!ev(ep3, U, [{ type: 'scheduled_cancelled' }]).success);
  // Predicates about other billers or unknown types never pass by accident.
  assert.ok(!ev(ep3, B.subscription, [{ type: 'logged_in' }]).success);
  assert.ok(!world.evaluate(ep3, [{ billerId: U, type: 'made_up' }]).success);
  assert.ok(world.evaluate(ep3, [{ billerId: U, type: 'answer', actual: '$1,234.50', expected: '1234.50' }]).success);
  assert.ok(!world.evaluate(ep3, [{ billerId: U, type: 'answer', actual: '1234.05', expected: '1234.50' }]).success);
  // A failed (declined) attempt plus nothing else is not a payment.
  const ep4 = fresh(sc(U, { declineSavedCard: true })); const sid4 = login(world, ep4, U);
  assert.throws(() => pay(world, ep4, U, sid4, { amountChoice: 'due', methodId: 'pm-card' }));
  assert.ok(!ev(ep4, U, [{ type: 'payment', methodType: 'card', count: 1 }]).success);
});

test('episode isolation and determinism', () => {
  const a = fresh({}, 'seed-iso'), b = fresh({}, 'seed-iso'), c = fresh({}, 'seed-other');
  assert.notEqual(a.id, b.id); assert.notEqual(a.entryToken, b.entryToken);
  assert.deepEqual(a.persona, b.persona);
  assert.equal(world.account(a, U).accountNumber, world.account(b, U).accountNumber, 'same seed, same account');
  assert.equal(world.balance(world.account(a, U)), world.balance(world.account(b, U)));
  assert.notEqual(world.account(a, U).accountNumber, world.account(c, U).accountNumber);
  const sidA = login(world, a, U);
  pay(world, a, U, sidA, { amountChoice: 'due', methodId: 'pm-chk' });
  assert.equal(world.account(b, U).payments.filter(p => !p.seeded).length, 0, 'payment does not leak');
  assert.ok(ev(b, U, [{ type: 'no_payment' }]).success);
  assert.equal(world.session(b, U, sidA), null, 'session does not leak');
  throwsCode(() => world.requireSession(b, U, sidA), 'auth_required');
  assert.equal(world.session(a, B.subscription, sidA), null, 'session is per biller');
  world.advance(a, 5 * DAY);
  assert.equal(b.clock, START_TIME, 'clock is per episode');
  assert.ok(b.mailbox.every(m => !/Payment received/.test(m.subject)), 'mailbox is per episode');
  world.finish(a, { success: true });
  throwsCode(() => world.login(a, U, { username: a.persona.email, password: PASSWORD }), 'finished');
  throwsCode(() => world.episode('ep-missing'), 'no_episode');
});

test('paperless and profile', () => {
  const ep = fresh(); const sid = login(world, ep, U);
  throwsCode(() => world.setPaperless(ep, U, sid, { paperless: 'on', email: 'bad' }), 'email');
  world.setPaperless(ep, U, sid, { paperless: 'on', email: ep.persona.email });
  world.setPaperless(ep, U, sid, { paperless: 'on', email: ep.persona.email });
  assert.equal(events(ep, 'paperless_changed').length, 1, 'no-op change records nothing');
  assert.ok(ev(ep, U, [{ type: 'paperless', value: true }]).success);
  throwsCode(() => world.updateProfile(ep, U, sid, { phone: '12' }), 'bad_phone');
  world.updateProfile(ep, U, sid, { phone: '(555) 010-2030' });
  throwsCode(() => world.setupArrangement(ep, U, sid, { months: 5 }), 'bad_plan');
  throwsCode(() => world.contact(ep, U, sid, { subject: 'x', message: 'hi' }), 'empty');
  world.contact(ep, U, sid, { subject: 'Billing question', message: 'Why is my bill high?' });
  assert.ok(ev(ep, U, [{ type: 'message_sent', contains: 'bill high' }]).success);
});

// ---------- ledger, AutoPay, virtual-clock and grading fixes ----------
const X = {
  loan: find(b => b.kind === 'loan' && b.capabilities.autopay.support === 'supported', 'loan'),
  mortgage: find(b => b.kind === 'loan' && b.entry.bill_type === 'mortgage', 'mortgage'),
  personalLoan: find(b => b.kind === 'loan' && b.entry.bill_type === 'personal-loan', 'personal loan'),
  telecom: find(b => b.kind === 'telecom' && b.capabilities.cancel_service.support === 'supported', 'telecom'),
  toll: find(b => b.kind === 'toll' && b.capabilities.guest_pay.support === 'supported', 'toll'),
  dmv: find(b => b.template === 'dmv', 'dmv'),
  paperlessUnknown: find(b => b.capabilities.paperless.support === 'unknown', 'paperless unknown'),
  pctAutopay: find(b => b.fees.cardPercent != null && b.capabilities.autopay.support === 'supported' && b.kind === 'utility', 'percent fee autopay')
};
const agentPays = acct => acct.payments.filter(p => !p.seeded);

test('overpayment becomes an account credit that survives posting and applies to the next bill', () => {
  const ep = fresh(sc(U, { amountCents: 15056, dueInDays: 10 })); const sid = login(world, ep, U); const acct = world.account(ep, U);
  const p = pay(world, ep, U, sid, { amountChoice: 'other', amount: '250.56', methodId: 'pm-chk' });
  assert.equal(world.balance(acct), -10000, 'credit while pending');
  assert.equal(p.allocations.reduce((a, x) => a + x.cents, 0), 15056); assert.equal(p.creditCents, 10000);
  world.advance(ep, 5 * DAY);
  assert.equal(p.status, 'posted'); assert.equal(world.balance(acct), -10000, 'credit kept after posting');
  world.advance(ep, 20 * DAY); // next bill issued 30 days after the current one
  const next = world.currentInvoice(acct);
  assert.equal(acct.invoices.length, 13); assert.equal(next.creditAppliedCents, Math.min(10000, next.amountCents));
  assert.equal(world.balance(acct), next.amountCents - 10000);
});

test('AutoPay skips a bill already covered by a scheduled or pending payment and never exceeds the balance', () => {
  // Scheduled payment for the due date covers the bill: no second charge.
  const ep = fresh(sc(U, { autopay: true, dueInDays: 10 })); const sid = login(world, ep, U); const acct = world.account(ep, U); const bal = world.balance(acct);
  pay(world, ep, U, sid, { amountChoice: 'due', methodId: 'pm-chk', payOn: isoDateOf(world.currentInvoice(acct).dueAt) });
  world.advance(ep, 20 * DAY);
  assert.equal(agentPays(acct).filter(p => p.source === 'autopay').length, 0); assert.equal(events(ep, 'autopay_skipped').length, 1);
  assert.equal(agentPays(acct).reduce((a, p) => a + p.amountCents, 0), bal, 'charged once');
  // Card minimum AutoPay after a full pending payment: nothing more to pay.
  const C = B.card; const ep2 = fresh(sc(C, { autopay: true, dueInDays: 3 })); const sid2 = login(world, ep2, C); const a2 = world.account(ep2, C);
  world.autopay(ep2, C, sid2, { methodId: 'pm-chk', policy: 'minimum', acceptTerms: true });
  pay(world, ep2, C, sid2, { amountChoice: 'statement', methodId: 'pm-chk' });
  world.advance(ep2, 4 * DAY);
  assert.equal(agentPays(a2).filter(p => p.source === 'autopay').length, 0); assert.equal(world.balance(a2), 0);
  // Fixed amount is capped at the balance and validated against the payment maximum.
  const ep3 = fresh(sc(U, { autopay: true, dueInDays: 3, amountCents: 4000 })); const sid3 = login(world, ep3, U); const a3 = world.account(ep3, U);
  throwsCode(() => world.autopay(ep3, U, sid3, { methodId: 'pm-chk', policy: 'fixed', fixedAmount: '99999999.00', acceptTerms: true }), 'max_amount');
  world.autopay(ep3, U, sid3, { methodId: 'pm-chk', policy: 'fixed', fixedAmount: '50.00', acceptTerms: true });
  world.advance(ep3, 4 * DAY);
  assert.equal(agentPays(a3).find(p => p.source === 'autopay').amountCents, 4000, 'balance lower than the fixed amount');
  assert.equal(world.balance(a3), 0);
});

test('loan minimum AutoPay pays the monthly payment; AutoPay card payments carry the card fee', () => {
  const L = X.loan; const ep = fresh(sc(L, { autopay: true, dueInDays: 2 })); const sid = login(world, ep, L); const acct = world.account(ep, L);
  world.autopay(ep, L, sid, { methodId: 'pm-chk', policy: 'minimum', acceptTerms: true });
  world.advance(ep, 3 * DAY);
  const ap = agentPays(acct).find(p => p.source === 'autopay');
  assert.ok(ap, 'loan minimum AutoPay charged'); assert.equal(ap.amountCents, world.currentInvoice(acct).amountCents);
  const F = X.pctAutopay; const ep2 = fresh(sc(F, { autopay: true, dueInDays: 2 })); const sid2 = login(world, ep2, F);
  world.autopay(ep2, F, sid2, { methodId: 'pm-card', acceptTerms: true });
  world.advance(ep2, 3 * DAY);
  const cp = agentPays(world.account(ep2, F)).find(p => p.source === 'autopay');
  assert.equal(cp.feeCents, world.fee(F, { type: 'card' }, cp.amountCents)); assert.ok(cp.feeCents > 0);
});

test('card amount options move with payments (statement, minimum, current)', () => {
  const C = B.card; const ep = fresh(); const sid = login(world, ep, C); const acct = world.account(ep, C);
  const opt = k => world.amountOptions(acct).find(o => o.key === k).cents;
  const min = opt('minimum'), stmt = opt('statement'), cur = opt('current');
  pay(world, ep, C, sid, { amountChoice: 'other', amount: '20.00', methodId: 'pm-chk' });
  assert.equal(opt('minimum'), min - 2000, 'partial payment reduces the minimum'); assert.equal(opt('statement'), stmt - 2000);
  pay(world, ep, C, sid, { amountChoice: 'statement', methodId: 'pm-chk' });
  assert.equal(opt('statement'), 0, 'statement not offered twice'); assert.equal(opt('minimum'), 0);
  assert.equal(opt('current'), cur - stmt);
  pay(world, ep, C, sid, { amountChoice: 'current', methodId: 'pm-chk' });
  world.advance(ep, 5 * DAY);
  assert.equal(world.amountOptions(acct).find(o => o.key === 'current').cents, 0, 'current balance paid off');
});

test('scheduled payments and AutoPay honour card declines and expiry at processing time', () => {
  const ep = fresh(sc(U, { declineSavedCard: true })); const sid = login(world, ep, U); const acct = world.account(ep, U);
  const p = pay(world, ep, U, sid, { amountChoice: 'due', methodId: 'pm-card', payOn: '2026-10-08' });
  const q = pay(world, ep, U, sid, { amountChoice: 'other', amount: '5.00', methodType: 'card', cardNumber: TEST_CARDS.declined, exp: '12/28', cvv: '123', payOn: '2026-10-08' });
  world.advance(ep, 6 * DAY);
  assert.equal(p.status, 'failed'); assert.equal(p.failure, 'card_declined'); assert.equal(q.status, 'failed');
  assert.equal(events(ep, 'payment_failed').length, 2); assert.ok(ev(ep, U, [{ type: 'no_payment' }]).success);
  const ep2 = fresh(sc(U, { declineSavedCard: true, autopay: true, dueInDays: 2 })); const sid2 = login(world, ep2, U);
  world.autopay(ep2, U, sid2, { methodId: 'pm-card', acceptTerms: true });
  world.advance(ep2, 3 * DAY);
  assert.equal(events(ep2, 'autopay_failed').length, 1); assert.equal(events(ep2, 'autopay_payment').length, 0);
  assert.ok(world.balance(world.account(ep2, U)) > 0, 'bill still unpaid');
});

test('guest sessions cannot use or save into the account holder wallet', () => {
  const G = B.guest; const ep = fresh(); const acct = world.account(ep, G);
  const { sid } = world.guestLookup(ep, G, { accountNumber: acct.accountNumber, lastName: ep.persona.last });
  throwsCode(() => world.draftPayment(ep, G, sid, { amountChoice: 'due', methodId: 'pm-chk' }, { guest: true }), 'no_method');
  const p = pay(world, ep, G, sid, { amountChoice: 'due', methodType: 'card', cardNumber: '4111111111111111', exp: '12/28', cvv: '123', save: 'on' }, { guest: true });
  assert.equal(p.source, 'guest');
  assert.deepEqual(acct.methods.filter(m => m.saved && !m.removed).map(m => m.id).sort(), ['pm-card', 'pm-chk'], 'wallet unchanged');
  // A signed-in session cannot reuse the guest's method either.
  const s2 = login(world, ep, G);
  throwsCode(() => world.draftPayment(ep, G, s2, { methodId: p.methodId }), 'no_method');
});

test('method_removed requires removing a saved method; one-time methods are discarded, not removed', () => {
  const ep = fresh(); const sid = login(world, ep, U);
  pay(world, ep, U, sid, { amountChoice: 'other', amount: '5.00', methodType: 'card', cardNumber: TEST_CARDS.visa, exp: '12/28', cvv: '123' });
  assert.ok(!ev(ep, U, [{ type: 'method_removed', last4: TEST_CARDS.visa.slice(-4) }]).success);
  world.removeMethod(ep, U, sid, { methodId: 'pm-card' });
  assert.ok(ev(ep, U, [{ type: 'method_removed', last4: TEST_CARDS.visa.slice(-4) }]).success);
});

test('AutoPay re-enrollment starts with the next bill; day-of-month is honoured', () => {
  const ep = fresh(sc(U, { autopay: true, dueInDays: 6 })); const sid = login(world, ep, U); const acct = world.account(ep, U);
  world.autopay(ep, U, sid, { action: 'cancel', confirm: true });
  world.autopay(ep, U, sid, { methodId: 'pm-chk', acceptTerms: true });
  world.advance(ep, 8 * DAY);
  assert.equal(events(ep, 'autopay_payment').length, 0, 'current bill not charged after re-enrollment');
  // Day 28: runs on the 28th, not three days before the due date.
  const ep2 = fresh(sc(U, { autopay: true, dueInDays: 20 })); const sid2 = login(world, ep2, U);
  world.autopay(ep2, U, sid2, { methodId: 'pm-chk', acceptTerms: true, day: '28' });
  world.advance(ep2, 30 * DAY);
  const p = agentPays(world.account(ep2, U)).find(x => x.source === 'autopay');
  assert.equal(isoDateOf(p.createdAt).slice(8), '28');
});

test('virtual clock issues new bills, marks unpaid bills past due, and a fresh AutoPay enrollment fires on the next bill', () => {
  const ep = fresh(sc(U, { dueInDays: 5 })); const sid = login(world, ep, U); const acct = world.account(ep, U);
  world.autopay(ep, U, sid, { methodId: 'pm-chk', acceptTerms: true });
  const first = world.currentInvoice(acct);
  world.advance(ep, 30 * DAY);
  assert.equal(acct.invoices.length, 13); assert.equal(first.status, 'past_due');
  assert.equal(events(ep, 'autopay_payment').length, 0, 'enrolled after the first bill was issued');
  const next = world.currentInvoice(acct);
  assert.ok(next.issuedAt > first.issuedAt && next.previousBalanceCents === first.amountCents);
  assert.equal(events(ep, 'bill_issued').length, 1);
  world.advance(ep, 10 * DAY);
  assert.equal(events(ep, 'autopay_payment').length, 1, 'AutoPay pays the first bill issued after enrollment');
});

test('tax installments follow cumulative payments to the current bill', () => {
  const T = B.tax; const ep = fresh(sc(T, { amountCents: 77009 })); const sid = login(world, ep, T); const acct = world.account(ep, T);
  const inst1 = acct.installments[0].cents;
  pay(world, ep, T, sid, { amountChoice: 'other', amount: (Math.floor(inst1 / 2) / 100).toFixed(2), methodId: 'pm-chk' });
  pay(world, ep, T, sid, { amountChoice: 'other', amount: ((inst1 - Math.floor(inst1 / 2)) / 100).toFixed(2), methodId: 'pm-chk' });
  assert.equal(acct.installments[0].paid, true, 'two partial payments complete installment 1');
  assert.ok(world.amountOptions(acct).find(o => o.key === 'installment').cents <= world.balance(acct));
  const ep2 = fresh(sc(T, { amountCents: 77010, pastDueCents: 20000 })); const sid2 = login(world, ep2, T); const a2 = world.account(ep2, T);
  const instOpt = world.amountOptions(a2).find(o => o.key === 'installment');
  assert.equal(instOpt.cents, 20000 + a2.installments[0].cents, 'installment option includes past-due tax');
  pay(world, ep2, T, sid2, { amountChoice: 'installment', methodId: 'pm-chk' });
  assert.equal(a2.installments[0].paid, true); assert.equal(world.balance(a2), a2.installments[1].cents);
});

test('invoice-level state stays consistent with the account balance', () => {
  const ep = fresh(sc(U, { pastDueCents: 3000, amountCents: 15056 })); const sid = login(world, ep, U); const acct = world.account(ep, U);
  pay(world, ep, U, sid, { amountChoice: 'other', amount: '30.00', methodId: 'pm-chk' });
  pay(world, ep, U, sid, { amountChoice: 'due', methodId: 'pm-chk' });
  world.advance(ep, 5 * DAY);
  assert.equal(world.balance(acct), 0);
  assert.ok(acct.invoices.every(i => i.balanceCents === 0 && i.status === 'paid'), JSON.stringify(acct.invoices.slice(-2).map(i => [i.balanceCents, i.status])));
});

test('grading uses durable facts: scheduled payments and cancellations still pass after time advances', () => {
  const ep = fresh(sc(U, { dueInDays: 15 })); const sid = login(world, ep, U);
  pay(world, ep, U, sid, { amountChoice: 'due', methodId: 'pm-chk', payOn: '2026-10-15' });
  const S = B.subscription; cancelService(world, ep, S, login(world, ep, S));
  world.advance(ep, 40 * DAY);
  assert.ok(ev(ep, U, [{ type: 'payment', scheduled: true, payOn: '2026-10-15', amountFrom: 'balance_at_start', count: 1 }]).success);
  assert.ok(ev(ep, S, [{ type: 'service', status: ['cancel_pending', 'cancelled'] }]).success);
});

test('subscription cancellation after the due date ends at the next renewal', () => {
  const S = B.subscription; const ep = fresh(sc(S, { dueInDays: -3 })); const sid = login(world, ep, S); const acct = world.account(ep, S);
  const r = cancelService(world, ep, S, sid);
  assert.equal(r.next, 'done'); assert.ok(acct.service.cancelAt > ep.clock);
});

test('lockout: counter resets after the lock expires; MFA failures count toward lockout', () => {
  const ep = fresh();
  for (let i = 0; i < 5; i++) assert.throws(() => world.login(ep, U, { username: ep.persona.email, password: 'nope' }));
  world.advance(ep, 16 * MIN);
  throwsCode(() => world.login(ep, U, { username: ep.persona.email, password: 'typo' }), 'bad_credentials');
  assert.ok(login(world, ep, U), 'one typo after the lock expires does not re-lock');
  const ep2 = fresh(sc(U, { mfa: 'email' })); const acct = world.account(ep2, U);
  for (let round = 0; round < 2; round++) { const r = world.login(ep2, U, { username: ep2.persona.email, password: PASSWORD }); for (let i = 0; i < 3; i++) { try { world.verifyMfa(ep2, U, r.sid, { code: 'x' }); } catch { /* counted */ } } }
  assert.ok(acct.lockedUntil > ep2.clock, 'repeated wrong MFA codes lock the account');
  throwsCode(() => world.login(ep2, U, { username: ep2.persona.email, password: PASSWORD }), 'locked');
});

test('verification and reset codes are not derivable from the seed, and reset codes cannot be brute-forced', () => {
  const a = fresh(sc(U, { mfa: 'email' }), 'same-seed'), b = fresh(sc(U, { mfa: 'email' }), 'same-seed');
  const codes = [];
  for (const ep of [a, b]) { world.login(ep, U, { username: ep.persona.email, password: PASSWORD }); codes.push(mfaCode(ep, U)); }
  const c2 = fresh({}, 'same-seed'); world.requestReset(c2, U, { identifier: c2.persona.email });
  assert.ok(codes[0] !== codes[1] || mfaCode(b, U) !== resetCode(c2, U), 'codes differ across episodes with the same seed');
  const ep = fresh(); world.requestReset(ep, U, { identifier: ep.persona.email }); const real = resetCode(ep, U);
  for (let i = 0; i < 5; i++) throwsCode(() => world.resetPassword(ep, U, { code: real === '000000' ? '111111' : '000000', password: NEW_PASSWORD, confirm: NEW_PASSWORD }), 'bad_code');
  throwsCode(() => world.resetPassword(ep, U, { code: real, password: NEW_PASSWORD, confirm: NEW_PASSWORD }), 'bad_code');
});

test('statement totals include past-due amounts; guest lookup accepts the dashboard amount due', () => {
  const G = B.guest; const ep = fresh(sc(G, { pastDueCents: 4000, amountCents: 7559 })); const acct = world.account(ep, G);
  const inv = world.currentInvoice(acct);
  assert.equal(inv.previousBalanceCents, 4000); assert.equal(inv.totalDueCents, 11559);
  assert.ok(world.guestLookup(ep, G, { accountNumber: acct.accountNumber, amountDue: '115.59' }).sid);
  assert.ok(world.guestLookup(ep, G, { accountNumber: acct.accountNumber, amountDue: '75.59' }).sid);
  throwsCode(() => world.guestLookup(ep, G, { accountNumber: acct.accountNumber }), 'no_match'); // a secondary identifier is required
  const T = X.toll; const ep2 = fresh(); const a2 = world.account(ep2, T);
  assert.ok(world.guestLookup(ep2, T, { statementId: a2.accountNumber, plate: a2.plate }).sid, 'two primary identifiers suffice');
  throwsCode(() => world.guestLookup(ep2, T, { statementId: a2.accountNumber, plate: 'ZZZ0000' }), 'no_match');
  // A toll customer has only the bill notice: its "Bill number" and plate find the bill; an old bill number does not.
  const ep3 = fresh(sc(T, { registered: false })); const a3 = world.account(ep3, T); const notice = ep3.mailbox.find(m => /bill is ready/.test(m.subject)).text;
  const billNo = notice.match(/Bill number: (\S+)/)?.[1]; assert.equal(billNo, world.currentInvoice(a3).number);
  assert.ok(world.guestLookup(ep3, T, { statementId: billNo, plate: notice.match(/License plate: (\S+)/)[1] }).sid);
  throwsCode(() => world.guestLookup(ep3, T, { statementId: a3.invoices[0].number, plate: a3.plate }), 'no_match');
  throwsCode(() => world.guestLookup(ep3, T, { statementId: billNo }), 'no_match'); // still needs a second identifier
});

test('amount entry: Other typed to the exact amount counts as the amount due; ambiguous inputs are refused', () => {
  const ep = fresh(); const sid = login(world, ep, U); const due = world.balance(world.account(ep, U));
  throwsCode(() => world.draftPayment(ep, U, sid, { amountChoice: 'due', amount: '50.00' }), 'amount_choice');
  pay(world, ep, U, sid, { amountChoice: 'other', amount: (due / 100).toFixed(2), methodId: 'pm-chk' });
  assert.ok(ev(ep, U, [{ type: 'payment', amountKey: 'due', count: 1 }]).success);
  assert.ok(ev(ep, U, [{ type: 'payment', amountFrom: 'balance_at_start', count: 1 }]).success);
  // A stale prefilled Other amount does not block switching back to a preset option.
  const ep2 = fresh(); const sid2 = login(world, ep2, U);
  world.draftPayment(ep2, U, sid2, { amountChoice: 'other', amount: '7.00', methodId: 'pm-chk' });
  assert.equal(world.draftPayment(ep2, U, sid2, { amountChoice: 'due', amount: '7.00' }).amountKey, 'due');
  // Typed new card wins over the pre-selected saved method; it is never silently dropped.
  const d = world.draftPayment(ep2, U, sid2, { methodId: 'pm-chk', methodType: '', cardNumber: '5000000000000009', exp: '12/29', cvv: '123' }).method;
  assert.equal(d.type, 'card');
  throwsCode(() => world.draftPayment(ep2, U, sid2, { methodId: 'pm-chk', methodType: '', cardNumber: '4111111111111112', exp: '12/29', cvv: '123' }), 'bad_card');
});

test('payment safety: review token rotates on edits; removed or expired methods cannot be charged', () => {
  const ep = fresh(); const sid = login(world, ep, U); const acct = world.account(ep, U);
  const d1 = world.draftPayment(ep, U, sid, { amountChoice: 'due', methodId: 'pm-chk' });
  const d2 = world.draftPayment(ep, U, sid, { amountChoice: 'other', amount: '7.00' });
  assert.notEqual(d1.token, d2.token);
  throwsCode(() => world.submitPayment(ep, U, sid, { token: d1.token, acceptTerms: true }), 'stale');
  world.draftPayment(ep, U, sid, { methodId: 'pm-card' });
  world.removeMethod(ep, U, sid, { methodId: 'pm-card' });
  assert.equal(acct.draft.token, null);
  throwsCode(() => world.addMethod(ep, U, sid, { methodType: 'card', cardNumber: '4111111111111111', exp: '01/2025', cvv: '123' }), 'bad_exp');
  assert.equal(world.addMethod(ep, U, sid, { methodType: 'card', cardNumber: '4111111111111111', exp: '12/2030', cvv: '123' }).exp, '12/30');
});

test('cancellation steps cannot be skipped; same-plan change is refused', () => {
  const S = B.subscription; const ep = fresh(); const sid = login(world, ep, S);
  throwsCode(() => world.cancelService(ep, S, sid, { step: 'confirm', confirm: true }), 'reason');
  world.cancelService(ep, S, sid, { step: 'reason', reason: 'price' });
  throwsCode(() => world.cancelService(ep, S, sid, { step: 'confirm', confirm: true }), 'offer_required');
  throwsCode(() => world.changePlan(ep, S, sid, { planId: world.account(ep, S).service.plan }), 'same_plan');
});

test('retention discount is applied to the next bills', () => {
  const S = B.subscription; const ep = fresh(sc(S, { dueInDays: 5 })); const sid = login(world, ep, S); const acct = world.account(ep, S);
  const price = world.plans(acct).find(p => p.current).cents;
  cancelService(world, ep, S, sid, { acceptOffer: true });
  world.advance(ep, 20 * DAY);
  const next = world.currentInvoice(acct);
  assert.equal(next.amountCents, price - Math.round(price / 2)); assert.ok(next.lines.some(l => l.cents < 0));
  assert.equal(acct.service.discount.remaining, 2);
});

test('money parsing is strict and identical for typed and JSON amounts', () => {
  assert.equal(parseMoney('.50'), 50); assert.equal(parseMoney('50.'), 5000); assert.equal(parseMoney(12.5), 1250);
  for (const bad of ['1,0,0', '$ 1 2 3', 12.345, 1.005, '1,00']) throwsCode(() => parseMoney(bad), 'invalid_amount');
});

test('seeded data is coherent: bills issued in the past, payment history, plan prices, line splits, state ZIPs', () => {
  const ep = fresh();
  for (const id of [U, B.card, B.subscription, X.telecom, X.mortgage, X.personalLoan, B.tax]) {
    const acct = world.account(ep, id); const b = world.biller(id);
    assert.ok(acct.invoices.every(i => i.issuedAt <= ep.clock), `${id} issued in the past`);
    assert.equal(acct.payments.filter(p => p.seeded && p.history).length, 11, `${id} payment history`);
    assert.ok(acct.invoices.every(i => i.lines.reduce((a, l) => a + l.cents, 0) === i.amountCents), `${id} lines add up`);
    const state = acct.serviceState; assert.match(acct.serviceAddress, new RegExp(`, ${state} \\d{5}$`));
    if ((b.entry.service_area || []).some(s => s.length === 2 && s !== 'US')) assert.ok(b.entry.service_area.includes(state) || b.entry.hq_address, `${id} state ${state}`);
  }
  const sub = world.account(ep, B.subscription); assert.equal(world.currentInvoice(sub).amountCents, world.plans(sub).find(p => p.current).cents, 'subscription bill = plan price');
  const tel = world.account(ep, X.telecom); assert.equal(world.currentInvoice(tel).lines.find(l => l.desc === 'Monthly service').cents, world.plans(tel).find(p => p.current).cents);
  const card = world.account(ep, B.card); const interest = world.currentInvoice(card).lines.find(l => l.desc === 'Interest charged').cents;
  assert.ok(interest <= world.currentInvoice(card).amountCents * 0.026, 'card interest is a few percent');
  assert.ok(!world.currentInvoice(world.account(ep, X.personalLoan)).lines.some(l => l.desc === 'Escrow'), 'no escrow on personal loans');
  assert.ok(world.currentInvoice(world.account(ep, X.mortgage)).lines.some(l => l.desc === 'Escrow'));
});

test('scenario validation, capability guards and MFA resend', () => {
  throwsCode(() => world.account(fresh(sc(U, { mfa: 'push' })), U), 'bad_scenario');
  { // native SMS MFA: the code is texted (ep.sms + sms_sent), not mailed, and the login event records the channel
    const e = fresh(sc(U, { mfa: 'sms' })); const before = e.mailbox.length; const r = world.login(e, U, { username: e.persona.email, password: PASSWORD });
    assert.equal(r.mfa, true); assert.equal(e.mailbox.length, before, 'no code email'); assert.equal(e.sms.messages.length, 1);
    assert.ok(e.events.some(x => x.type === 'sms_sent')); const code = e.sms.messages[0].text.match(/\b(\d{6})\b/)[1];
    world.verifyMfa(e, U, r.sid, { code }); assert.ok(e.events.some(x => x.type === 'login' && x.mfa === 'sms'));
  }
  assert.equal(world.account(fresh(sc(U, { mfa: 'EMAIL' })), U).mfa, 'email');
  const P = X.paperlessUnknown; const ep = fresh(); throwsCode(() => world.setPaperless(ep, P, login(world, ep, P), { paperless: 'on', email: ep.persona.email }), 'unsupported');
  const D = X.dmv; throwsCode(() => world.setupArrangement(ep, D, login(world, ep, D), { months: 6 }), 'unsupported');
  const ep2 = fresh(sc(U, { mfa: 'email' })); const r = world.login(ep2, U, { username: ep2.persona.email, password: PASSWORD });
  throwsCode(() => world.resendMfa(ep2, U, r.sid), 'cooldown');
  world.account(ep2, U).mfaChallenge.sentWall -= 31000; const old = mfaCode(ep2, U);
  world.resendMfa(ep2, U, r.sid);
  if (mfaCode(ep2, U) !== old) throwsCode(() => world.verifyMfa(ep2, U, r.sid, { code: old }), 'bad_code');
  world.verifyMfa(ep2, U, r.sid, { code: mfaCode(ep2, U) });
});

test('unregistered customers get the bill notice; login and registration errors do not enumerate', () => {
  const ep = fresh(sc(U, { registered: false })); const acct = world.account(ep, U);
  const notice = ep.mailbox.find(m => /bill is ready/.test(m.subject));
  assert.ok(notice && notice.text.includes(acct.accountNumber));
  const unreg = assert.throws(() => world.login(ep, U, { username: ep.persona.email, password: PASSWORD }), e => /incorrect/.test(e.message));
  let m1, m2; try { world.register(ep, U, { accountNumber: '1', email: ep.persona.email, password: PASSWORD, confirm: PASSWORD }); } catch (e) { m1 = e.message; }
  try { world.register(ep, U, { accountNumber: acct.accountNumber, lastName: 'Wrong', email: ep.persona.email, password: PASSWORD, confirm: PASSWORD }); } catch (e) { m2 = e.message; }
  assert.equal(m1, m2); assert.equal(unreg, undefined);
});

test('answers are graded by kind with tolerant normalization', () => {
  const ep = fresh(); const sid = login(world, ep, U); const acct = world.account(ep, U); const due = isoDateOf(world.currentInvoice(acct).dueAt);
  const g = (pr, answer) => world.evaluate(ep, [{ billerId: U, type: 'answer', ...pr }], { answer }).success;
  assert.ok(g({ kind: 'amount_due' }, `You owe ${money(world.balance(acct))}, due ${due}.`));
  assert.ok(!g({ kind: 'amount_due' }, `You owe ${money(world.balance(acct) + 1)}, due ${due}.`));
  assert.ok(!g({ kind: 'amount_due' }, ''), 'no answer fails');
  const p = pay(world, ep, U, sid, { amountChoice: 'due', methodId: 'pm-chk' });
  assert.ok(g({ kind: 'confirmation' }, `confirmation # ${p.confirmation.toLowerCase()}`)); assert.ok(!g({ kind: 'confirmation' }, 'XY000000000'));
  assert.ok(g({ kind: 'phone', expected: ['9075551234'] }, 'Call (907) 555-1234')); assert.ok(g({ kind: 'phone', expected: ['9075551234'] }, '1-907-555-1234'));
  assert.ok(g({ kind: 'contact', expected: { phones: [], address: 'PO Box 123, Juneau, AK 99801' } }, 'Mail it to P.O. Box 123, Juneau AK 99801'));
  assert.ok(g({ kind: 'contact', expected: { none: true } }, 'Online payment is not available and no contact is listed.'));
  assert.ok(world.evaluate(ep, [{ billerId: U, type: 'answer', actual: '123.4', expected: '123.40' }]).success);
  world.submitAnswer(ep, `${p.confirmation}`); assert.ok(world.evaluate(ep, [{ billerId: U, type: 'answer', kind: 'confirmation' }]).success, 'episode answer is used');
});

test('unrequested changes and payments at other billers are detected', () => {
  const ep = fresh(); const sid = login(world, ep, U);
  assert.ok(ev(ep, U, [{ type: 'no_unrequested_changes' }]).success);
  world.setPaperless(ep, U, sid, { paperless: 'on', email: ep.persona.email });
  assert.ok(!ev(ep, U, [{ type: 'no_unrequested_changes' }]).success);
  assert.ok(ev(ep, U, [{ type: 'no_unrequested_changes', allow: ['paperless'] }]).success);
  const S = B.subscription; pay(world, ep, S, login(world, ep, S), { amountChoice: 'due', methodId: 'pm-chk' });
  assert.ok(ev(ep, U, [{ type: 'no_payment' }]).success); assert.ok(!ev(ep, U, [{ type: 'no_payment', scope: 'others' }]).success);
  assert.ok(!world.evaluate(ep, [{ billerId: U, type: 'no_payment', scope: 'episode' }]).success);
});
function isoDateOf(ms) { return new Date(ms).toISOString().slice(0, 10); }

test('answers that enumerate many values do not pass; persona phone and mail ids are well formed', () => {
  const acct = { start: { balanceCents: 12345, dueAt: Date.UTC(2026, 9, 15, 12) } };
  const amt = text => gradeAnswer({ kind: 'amount_due' }, text, acct).pass;
  assert.ok(amt('You owe $123.45, due October 15, 2026.'));
  assert.ok(amt('Minimum $25.00; full balance $123.45 due 2026-10-15.'), 'two amounts are fine');
  assert.ok(!amt('$1.00 $5.00 $25.00 $123.45 due 2026-10-15'), 'a list of amounts does not pass');
  const ph = text => gradeAnswer({ kind: 'phone', expected: ['8005551234'] }, text, null).pass;
  assert.ok(ph('Call 800-555-1234.')); assert.ok(ph('Call 800-555-1234 or pay by phone at 888-555-0000.'));
  assert.ok(!ph('Try 877-555-0001, 866-555-0002 or 800-555-1234.'), 'a list of phone numbers does not pass');
  const e = fresh(); assert.match(e.persona.phone, /^\(555\) 01\d-\d{4}$/);
  assert.equal(e.mailbox[0].id, 'mail-1');
});
