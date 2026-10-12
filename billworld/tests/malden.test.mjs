import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../engine.mjs';
import { wippAutoPayCutoff } from '../wipp.mjs';
import { tasks } from '../registry.mjs';

const DAY = 86400000;
const setup = (taskId) => { const w = new World(':memory:'); const f = w.create({ siteId: 'malden', taskId }); return { w, id: f.episodeId, f }; };
const login = (w, id, password = 'Billworld-2026!') => w.wippLogin(id, { email: 'alex@billworld.test', password }).session;
const lastMail = (w, id) => w.state(id).mail.at(-1).text;
const bank = { source: 'new', name: 'Alex Morgan', routing: '021000021', accountNumber: '000001048', confirmAccountNumber: '000001048', accountType: 'checking', ownership: 'personal', zip: '63863', email: 'alex@billworld.test' };
function guestPay(w, id, details = bank, amount) {
  w.wippLookup(id, { by: 'accountId', value: '1001048' }); w.wippLookupConfirm(id, { accountId: '1001048' });
  w.wippCheckoutStart(id, null, { accountId: '1001048', methodType: details.cardNumber ? 'card' : 'echeck', amountChoice: amount ? 'other' : 'bill', amount, terms: true });
  w.wippCheckoutDetails(id, null, details); return w.wippCheckoutSubmit(id, null, { authorize: true }).receipt;
}
const finish = (w, id, outcome = {}) => w.finish(id, outcome, { kind: 'grader_validation', agent: 'malden-test' });

test('Malden is a released first slice with nine tasks and grader goals', () => {
  const mine = [...tasks.values()].filter(t => t.site_id === 'malden');
  assert.equal(mine.length, 9);
  for (const t of mine) assert.match(t.goal.type, /^wipp_/);
});

test('Seed: balances, linked accounts, documented zero fee and policy', () => {
  const { w, id } = setup('malden-guest-pay-v1'); const s = login(w, id);
  const sum = w.wippSummary(id, s);
  assert.deepEqual(sum.accounts.map(a => [a.id, a.balanceCents, a.directWithdrawal]), [['1001048', 8432, false], ['1001050', 4610, true]]);
  assert.equal(w.state(id).wipp.accounts.find(a => a.id === '3003075').disconnected, true);
});

test('Guest eCheck payment passes strictly; wrong confirmation, extra payment and login shortcuts fail', () => {
  let { w, id } = setup('malden-guest-pay-v1');
  const r = guestPay(w, id); assert.equal(r.feeCents, 0); assert.match(lastMail(w, id), new RegExp(r.confirmation));
  assert.equal(w.evaluate(id, { confirmation: 'MCPW-WRONG' }).success, false);
  assert.equal(finish(w, id, { confirmation: r.confirmation }).success, true);
  ({ w, id } = setup('malden-guest-pay-v1'));
  const a = guestPay(w, id, bank, '40.00'), b = guestPay(w, id, bank, '44.32');
  assert.equal(w.evaluate(id, { confirmation: b.confirmation }).success, false);
  ({ w, id } = setup('malden-guest-pay-v1'));
  login(w, id); const g = guestPay(w, id); const res = w.evaluate(id, { confirmation: g.confirmation });
  assert.equal(res.checks.ordered_flow, false); assert.ok(a);
  ({ w, id } = setup('malden-guest-pay-v1'));
  const other = guestPay(w, id, { ...bank, routing: '011000015', accountNumber: '12345678', confirmAccountNumber: '12345678' });
  assert.equal(w.evaluate(id, { confirmation: other.confirmation }).checks.exact_method, false);
});

test('Checkout validation: disconnected accounts, unconfirmed lookup, overpayment, guest scheduling, decline', () => {
  const { w, id } = setup('malden-guest-pay-v1');
  assert.throws(() => w.wippCheckoutStart(id, null, { accountId: '1001048', methodType: 'echeck', amountChoice: 'bill', terms: true }), /Lookup your account/);
  w.wippLookupConfirm(id, { accountId: '3003075' });
  assert.throws(() => w.wippCheckoutStart(id, null, { accountId: '3003075', methodType: 'echeck', amountChoice: 'bill', terms: true }), /Online payments cannot be accepted/);
  w.wippLookupConfirm(id, { accountId: '1001048' });
  assert.throws(() => w.wippCheckoutStart(id, null, { accountId: '1001048', methodType: 'echeck', amountChoice: 'other', amount: '100.00', terms: true }), /between/);
  assert.throws(() => w.wippCheckoutStart(id, null, { accountId: '1001048', methodType: 'echeck', amountChoice: 'bill', terms: false }), /Terms/);
  assert.throws(() => w.wippCheckoutStart(id, null, { accountId: '1001048', methodType: 'echeck', amountChoice: 'bill', date: '2026-10-08', terms: true }), /Log in/);
  w.wippCheckoutStart(id, null, { accountId: '1001048', methodType: 'card', amountChoice: 'bill', terms: true });
  assert.throws(() => w.wippCheckoutDetails(id, null, { source: 'new', name: 'Alex Morgan', cardNumber: '4242424242424241', expiry: '12/29', cvv: '123', zip: '63863', email: 'alex@billworld.test' }), /Card Number/);
  assert.throws(() => w.wippCheckoutSubmit(id, null, { authorize: true }), /payment information/);
  w.wippCheckoutDetails(id, null, { source: 'new', name: 'Alex Morgan', cardNumber: '4000000000000002', expiry: '12/29', cvv: '123', zip: '63863', email: 'alex@billworld.test' });
  assert.throws(() => w.wippCheckoutSubmit(id, null, { authorize: true }), /problem processing/);
  const s = w.state(id); assert.equal(s.wipp.payments.filter(p => p.status === 'posted').length, 1); assert.equal(s.wipp.checkout.stage, 'details');
  assert.throws(() => w.wippCheckoutSubmit(id, null, { authorize: true }), /payment information/);
});

test('Signed partial card payment grader requires the saved Visa and login', () => {
  const { w, id } = setup('malden-signed-card-pay-v1'); const s = login(w, id);
  w.wippCheckoutStart(id, s, { accountId: '1001048', methodType: 'card', amountChoice: 'other', amount: '50.00', terms: true });
  w.wippCheckoutDetails(id, s, { source: 'saved', methodId: 'alex-card-4242' });
  const c = w.wippCheckoutSubmit(id, s, { authorize: true });
  assert.equal(w.wippCheckoutSubmit(id, s, { authorize: true }).receipt.confirmation, c.receipt.confirmation, 'submit is idempotent');
  assert.equal(finish(w, id, { confirmation: c.receipt.confirmation }).success, true);
  const x = setup('malden-signed-card-pay-v1'), s2 = login(x.w, x.id);
  x.w.wippCheckoutStart(x.id, s2, { accountId: '1001048', methodType: 'card', amountChoice: 'other', amount: '50.00', terms: true });
  x.w.wippCheckoutDetails(x.id, s2, { source: 'new', name: 'Alex Morgan', cardNumber: '4242424242424242', expiry: '12/29', cvv: '123', zip: '63863' });
  const c2 = x.w.wippCheckoutSubmit(x.id, s2, { authorize: true });
  assert.equal(x.w.evaluate(x.id, { confirmation: c2.receipt.confirmation }).checks.exact_method, false, 'new card entry is not the saved eWallet method');
});

test('Registration requires emailed code, password rules and balance-verified link; grader checks eBilling', () => {
  const { w, id } = setup('malden-register-ebill-v1');
  const base = { firstName: 'Alex', lastName: 'Morgan', email: 'alex@billworld.test', confirmEmail: 'alex@billworld.test', mobile: '(573) 555-0148' };
  assert.throws(() => w.wippRegister(id, { ...base, password: 'Registered2026', confirmPassword: 'Registered2026' }), /Special/);
  assert.throws(() => w.wippRegister(id, { ...base, confirmEmail: 'x@billworld.test', password: 'Registered-2026!', confirmPassword: 'Registered-2026!' }), /E-Mails must match/);
  w.wippRegister(id, { ...base, password: 'Registered-2026!', confirmPassword: 'Registered-2026!' });
  assert.equal(w.wippState(id, null).pending.registration.email, 'alex@billworld.test');
  const first = lastMail(w, id).match(/code is (\d{6})/)[1];
  w.wippRegisterResend(id); const code = lastMail(w, id).match(/code is (\d{6})/)[1];
  if (first !== code) assert.throws(() => w.wippRegisterVerify(id, { code: first }), /valid verification code/);
  const session = w.wippRegisterVerify(id, { code }).session;
  assert.throws(() => w.wippAddAccount(id, session, { type: 'utility', accountId: '1001048', balance: '84.00' }), /No Results Found/);
  w.wippAddAccount(id, session, { type: 'utility', accountId: '1001048', balance: '$84.32' });
  assert.throws(() => w.wippEBillingSave(id, session, { accountId: '1001048', enrolled: true }), /not linked/);
  w.wippConfirmAccount(id, session, { accountId: '1001048' });
  w.wippEBillingSave(id, session, { accountId: '1001048', enrolled: true, printed: true });
  assert.equal(w.evaluate(id).checks.ebilling_exact, false);
  w.wippEBillingSave(id, session, { accountId: '1001048', enrolled: true, printed: false });
  assert.equal(finish(w, id).success, true);
  const y = setup('malden-register-ebill-v1');
  assert.throws(() => y.w.wippRegister(y.id, { ...base, email: 'someone@else.test', confirmEmail: 'someone@else.test', password: 'Registered-2026!', confirmPassword: 'Registered-2026!' }), /problem creating/);
});

test('Recovery: temporary password forces reset, previous passwords rejected, grader requires post-reset login', () => {
  const { w, id } = setup('malden-recover-login-v1');
  w.wippPasswordRequest(id, { email: 'alex@billworld.test' });
  const temp = lastMail(w, id).match(/password is: (\S+) \(/)[1];
  assert.deepEqual(w.wippLogin(id, { email: 'alex@billworld.test', password: temp }), { resetRequired: true, email: 'alex@billworld.test' });
  assert.throws(() => w.wippPasswordReset(id, { email: 'alex@billworld.test', tempPassword: 'nope', password: 'Restored-2026!', confirmPassword: 'Restored-2026!' }), /Temporary Password/);
  assert.throws(() => w.wippPasswordReset(id, { email: 'alex@billworld.test', tempPassword: temp, password: 'Billworld-2026!', confirmPassword: 'Billworld-2026!' }), /Previous passwords/);
  w.wippPasswordReset(id, { email: 'alex@billworld.test', tempPassword: temp, password: 'Restored-2026!', confirmPassword: 'Restored-2026!' });
  assert.equal(w.evaluate(id).checks.login_after_reset, false);
  const s = login(w, id, 'Restored-2026!'); w.wippSummary(id, s);
  assert.equal(finish(w, id).success, true);
  const u = setup('malden-recover-login-v1'); const r = u.w.wippPasswordRequest(u.id, { email: 'nobody@billworld.test' });
  assert.equal(r.sent, true, 'unknown e-mails get the same response');
});

test('Scheduled payments: grader, edit, saved-method requirement and execution on the virtual clock', () => {
  const { w, id } = setup('malden-schedule-payment-v1'); const s = login(w, id);
  w.wippScheduleDelete(id, s, { scheduleId: 'wipp-sched-seed' });
  w.wippCheckoutStart(id, s, { accountId: '1001048', methodType: 'echeck', amountChoice: 'bill', date: '2026-10-09', terms: true });
  assert.throws(() => w.wippCheckoutDetails(id, s, bank), /saved eWallet/);
  w.wippCheckoutDetails(id, s, { source: 'saved', methodId: 'alex-bank-1048' }); w.wippCheckoutSubmit(id, s, { authorize: true });
  assert.equal(w.evaluate(id, { scheduledDate: '2026-10-10' }).success, false);
  assert.equal(w.evaluate(id, { scheduledDate: '2026-10-09' }).success, true);
  const e = setup('malden-schedule-payment-v1'), s2 = login(e.w, e.id);
  e.w.wippScheduleEdit(e.id, s2, { scheduleId: 'wipp-sched-seed', amount: '84.32', date: '2026-10-09' });
  assert.equal(e.w.evaluate(e.id, { scheduledDate: '2026-10-09' }).success, false, 'editing the seed is not the requested delete-and-create');
  e.w.advance(e.id, 7 * DAY);
  const st = e.w.state(e.id); assert.equal(st.wipp.scheduled[0].status, 'executed'); assert.equal(st.wipp.payments.find(p => p.scheduleId === 'wipp-sched-seed').amountCents, 8432);
});

test('AutoPay enroll/change/cancel graders and Direct Withdrawal / other-user conflicts', () => {
  const { w, id } = setup('malden-autopay-enroll-v1'); const s = login(w, id);
  w.wippAutoPay(id, s);
  assert.throws(() => w.wippAutoPayEnroll(id, s, { accountId: '1001050', methodId: 'alex-bank-1048' }), /Direct Withdrawal/);
  assert.throws(() => w.wippAutoPayEnroll(id, s, { accountId: '2002099', methodId: 'alex-bank-1048' }), /not linked/);
  w.wippAutoPayEnroll(id, s, { accountId: '1001048', methodId: 'alex-bank-1048' });
  assert.equal(w.evaluate(id).checks.final_status_view, false);
  w.wippAutoPay(id, s); assert.equal(finish(w, id).success, true);
  const c = setup('malden-autopay-change-v1'), sc = login(c.w, c.id); c.w.wippAutoPay(c.id, sc);
  c.w.wippAutoPayUnenroll(c.id, sc, { accountId: '1001048', confirm: true }); c.w.wippAutoPayEnroll(c.id, sc, { accountId: '1001048', methodId: 'alex-card-4242' }); c.w.wippAutoPay(c.id, sc);
  assert.equal(c.w.evaluate(c.id).success, false, 'unenroll + re-enroll is not a method change');
  const d = setup('malden-autopay-change-v1'), sd = login(d.w, d.id); d.w.wippAutoPay(d.id, sd);
  assert.throws(() => d.w.wippWalletDelete(d.id, sd, { methodId: 'alex-bank-1048' }), /Unable to Delete/);
  d.w.wippAutoPayEnroll(d.id, sd, { accountId: '1001048', methodId: 'alex-card-4242' }); d.w.wippAutoPay(d.id, sd);
  assert.equal(d.w.evaluate(d.id).success, true);
  const x = setup('malden-autopay-cancel-v1'), sx = login(x.w, x.id); x.w.wippAutoPay(x.id, sx);
  assert.throws(() => x.w.wippAutoPayUnenroll(x.id, sx, { accountId: '1001048' }), /Confirm Unenroll/);
  x.w.wippAutoPayUnenroll(x.id, sx, { accountId: '1001048', confirm: true }); x.w.wippAutoPay(x.id, sx);
  assert.equal(x.w.evaluate(x.id).success, true);
});

test('AutoPay cutoff locks the amount: payment after the lock still debits (documented warning); before the lock it does not', () => {
  assert.equal(new Date(wippAutoPayCutoff('2026-10-10')).toISOString(), '2026-10-08T00:00:00.000Z');
  const after = setup('malden-autopay-change-v1'); after.w.advance(after.id, 5 * DAY); // Oct 8 16:00, locked
  const sa = login(after.w, after.id);
  after.w.wippCheckoutStart(after.id, sa, { accountId: '1001048', methodType: 'echeck', amountChoice: 'bill', terms: true });
  after.w.wippCheckoutDetails(after.id, sa, { source: 'saved', methodId: 'alex-bank-1048' }); after.w.wippCheckoutSubmit(after.id, sa, { authorize: true });
  after.w.advance(after.id, 3 * DAY);
  assert.equal(after.w.wippAccount(after.id, login(after.w, after.id), '1001048').creditCents, 8432);
  const before = setup('malden-autopay-change-v1'); const sb = login(before.w, before.id);
  before.w.wippCheckoutStart(before.id, sb, { accountId: '1001048', methodType: 'echeck', amountChoice: 'bill', terms: true });
  before.w.wippCheckoutDetails(before.id, sb, { source: 'saved', methodId: 'alex-bank-1048' }); before.w.wippCheckoutSubmit(before.id, sb, { authorize: true });
  before.w.advance(before.id, 8 * DAY);
  const acct = before.w.wippAccount(before.id, login(before.w, before.id), '1001048');
  assert.equal(acct.balanceCents, 0); assert.equal(acct.history.filter(p => p.channel === 'autopay').length, 0);
  const late = setup('malden-autopay-enroll-v1'), sl = login(late.w, late.id); late.w.advance(late.id, 5 * DAY);
  const s2 = login(late.w, late.id); late.w.wippAutoPayEnroll(late.id, s2, { accountId: '1001048', methodId: 'alex-bank-1048' }); late.w.advance(late.id, 3 * DAY);
  const la = late.w.wippAccount(late.id, login(late.w, late.id), '1001048');
  assert.equal(la.currentBill.lateFeeCents, 422, 'enrollment after the cutoff does not pay the current bill'); assert.ok(sl);
});

test('Statement grader and read-only protection', () => {
  const { w, id } = setup('malden-view-bill-v1'); const s = login(w, id);
  const b = w.wippStatement(id, s, '1001048'); assert.equal(b.bill.dueDate, '2026-10-10'); assert.equal(b.balanceCents, 8432);
  assert.equal(w.evaluate(id, { billingDate: '2026-10-10', remainingBalanceCents: 8432 }).success, true);
  w.wippEBillingSave(id, s, { accountId: '1001048', enrolled: true, printed: false });
  assert.equal(w.evaluate(id, { billingDate: '2026-10-10', remainingBalanceCents: 8432 }).success, false);
});

test('Profile deletion, wallet and eBilling validation; other sites cannot reach WIPP operations', () => {
  const { w, id } = setup('malden-guest-pay-v1'); const s = login(w, id);
  assert.throws(() => w.wippWalletAdd(id, s, { kind: 'bank', name: 'Alex', routing: '123456789', accountNumber: '1234', confirmAccountNumber: '1234', accountType: 'checking', ownership: 'personal', address: 'x', city: 'y', state: 'MO', zip: '63863' }), /Invalid Routing Number/);
  assert.throws(() => w.wippWalletAdd(id, s, { kind: 'card', name: 'Alex', cardNumber: '4242424242424242', expiry: '12/29', cvv: '123', address: 'x', city: 'y', state: 'MO', zip: '63863' }), /already in your eWallet/);
  w.wippDeleteProfile(id, s, { confirm: true });
  assert.throws(() => w.wippSummary(id, s), /Session Expired/);
  assert.throws(() => w.wippLogin(id, { email: 'alex@billworld.test', password: 'Billworld-2026!' }), /Invalid user credentials/);
  const other = new World(':memory:'); const f = other.create({ siteId: 'juneau-utilities' });
  assert.throws(() => other.wippState(f.episodeId, null), /WIPP operation unavailable/);
});
