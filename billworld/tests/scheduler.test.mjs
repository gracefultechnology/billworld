import test from 'node:test';
import assert from 'node:assert/strict';
import { World, autopayTask, scheduleTask } from '../engine.mjs';
import { utcDay, nextMonth } from '../scheduler.mjs';
function setup(options) { const w = new World(); const f = w.create(options); const id = f.episodeId; const session = w.login(id, f.credentials).session; return { w, id, session }; }
const quote = (w, id, session, extra = {}) => w.quote(id, session, { invoiceId: 'inv-current', amountCents: 8432, methodId: 'bank-1048', ...extra });
const advanceTo = (w, id, date) => w.advance(id, utcDay(date) - w.state(id).now);

test('AutoPay runs on the 20th and subsequent monthly invoices are charged once', () => {
  const { w, id, session } = setup({ taskId: autopayTask.id }); w.autopay(id, session, { enabled: true, methodId: 'bank-1048' });
  assert.equal(w.evaluate(id).success, true); advanceTo(w, id, '2026-10-19'); assert.equal(w.state(id).payments.filter(p => !p.initial).length, 0);
  advanceTo(w, id, '2026-10-20'); assert.equal(w.state(id).payments.filter(p => !p.initial).length, 1); w.advance(id, 0); assert.equal(w.state(id).payments.filter(p => !p.initial).length, 1);
  advanceTo(w, id, '2026-11-20'); const payments = w.state(id).payments.filter(p => !p.initial); assert.equal(payments.length, 2); assert.ok(payments.every(p => p.source === 'autopay' && p.feeCents === 0));
  assert.equal(w.state(id).invoices.find(i => i.id === 'inv-2026-11').amountCents, 8432); w.close();
});
test('manual or pending payment prevents a second AutoPay debit', () => {
  for (const pending of [false, true]) {
    const { w, id, session } = setup({ pending }); w.autopay(id, session, { enabled: true, methodId: 'bank-1048' }); w.pay(id, session, { token: quote(w, id, session).token }); advanceTo(w, id, '2026-10-20');
    assert.equal(w.state(id).payments.filter(p => !p.initial).length, 1); assert.ok(w.state(id).events.some(e => e.type === 'autopay_skipped')); w.close();
  }
});
test('AutoPay cancellation stops future debits but leaves existing scheduled payment intact', () => {
  const { w, id, session } = setup(); w.autopay(id, session, { enabled: true, methodId: 'bank-1048' }); const q = quote(w, id, session); w.schedule(id, session, { token: q.token, date: '2026-10-15' }); w.autopay(id, session, { enabled: false });
  advanceTo(w, id, '2026-10-20'); assert.equal(w.state(id).payments.filter(p => !p.initial).length, 1); assert.equal(w.state(id).payments.at(-1).source, 'scheduled'); w.close();
});
test('scheduled date can be edited or cancelled and one-time processing cannot reuse that review', () => {
  const { w, id, session } = setup({ taskId: scheduleTask.id }); const q = quote(w, id, session); const item = w.schedule(id, session, { token: q.token, date: '2026-10-15' });
  assert.equal(w.evaluate(id, { scheduledDate: '2026-10-15' }).success, true); assert.equal(w.schedule(id, session, { token: q.token, date: '2026-10-15' }).id, item.id);
  assert.throws(() => w.pay(id, session, { token: q.token }), /scheduled/);
  w.editSchedule(id, session, { scheduleId: item.id, date: '2026-10-16' }); advanceTo(w, id, '2026-10-15'); assert.equal(w.state(id).payments.filter(p => !p.initial).length, 0);
  w.editSchedule(id, w.login(id, { email: 'alex@billworld.test', password: 'Billworld-2026!' }).session, { scheduleId: item.id, cancel: true }); advanceTo(w, id, '2026-10-20'); assert.equal(w.state(id).payments.filter(p => !p.initial).length, 0); w.close();
});
test('scheduled payment executes at its date and balance changes produce failure rather than overpayment', () => {
  for (const earlierPayment of [false, true]) {
    const { w, id, session } = setup(); w.schedule(id, session, { token: quote(w, id, session).token, date: '2026-10-15' });
    if (earlierPayment) w.pay(id, session, { token: quote(w, id, session).token }); advanceTo(w, id, '2026-10-15');
    assert.equal(w.state(id).payments.filter(p => !p.initial).length, 1); assert.equal(w.state(id).scheduledPayments[0].status, earlierPayment ? 'failed' : 'processed'); w.close();
  }
});
test('declined automatic debit is recorded once and does not reduce unpaid balance', () => {
  const { w, id, session } = setup(); w.autopay(id, session, { enabled: true, methodId: 'card-decline' }); advanceTo(w, id, '2026-10-20');
  assert.equal(w.state(id).payments.at(-1).status, 'failed'); assert.equal(w.search(id, '1001048').invoices.find(i => i.id === 'inv-current').remainingCents, 8432); w.advance(id, 0); assert.equal(w.state(id).payments.filter(p => !p.initial).length, 1); w.close();
});
test('subscription renewals charge the replacement method and cancellation expires without another charge', () => {
  const { w, id, session } = setup({ siteId: 'spotify' }); w.updateSubscriptionCard(id, session, { name: 'Alex', number: '5555555555554444', expiry: '12/29', cvv: '123' }); advanceTo(w, id, '2026-10-20');
  assert.equal(w.state(id).payments[0].method.last4, '4444'); assert.equal(w.state(id).subscription.renewalDate, '2026-11-20');
  const nextSession = w.login(id, { email: 'alex@billworld.test', password: 'Billworld-2026!' }).session; w.cancelSubscription(id, nextSession); advanceTo(w, id, '2026-11-20');
  assert.equal(w.state(id).payments.length, 1); assert.equal(w.state(id).subscription.status, 'free'); w.close();
});
test('partner billing never invents a local subscription charge', () => {
  const { w, id } = setup({ siteId: 'spotify', partnerBilling: true }); advanceTo(w, id, '2026-12-20'); assert.equal(w.state(id).payments.length, 0); w.close();
});
test('date validation rejects impossible or past dates and month advance clamps leap days', () => {
  assert.ok(Number.isNaN(utcDay('2026-02-30'))); assert.equal(nextMonth('2028-01-31'), '2028-02-29');
  const { w, id, session } = setup(); const q = quote(w, id, session); for (const date of ['2026-02-30', '2026-10-01']) assert.throws(() => w.schedule(id, session, { token: q.token, date }), /future date/); w.close();
});
