import test from 'node:test';
import assert from 'node:assert/strict';
import {World} from '../engine.mjs';
import {tasks} from '../registry.mjs';

const make = taskId => { const w = new World(), f = w.create({siteId: 'tuscaloosa-water', ...(taskId ? {taskId} : {})}); return {w, f, id: f.episodeId}; };
const login = (w, id, password = 'Billworld-2026!') => w.tusLogin(id, {email: 'alex@billworld.test', password}).session;
const pay = (w, id, session, input, guestToken = null) => { const q = w.tusQuote(id, session, guestToken, input); return w.tusPay(id, session, guestToken, q.token, {authorize: true}); };
const card = {kind: 'card', name: 'Alex Morgan', cardNumber: '4111111111111111', expiry: '11/28', cvv: '321', zipCode: '35401'};
const bank = {kind: 'bank', name: 'Alex Morgan', routing: '021000021', accountNumber: '000001048', confirmAccountNumber: '000001048', accountType: 'Checking'};

test('Tuscaloosa is a released first slice with eight tasks that all fail with no action', () => {
  const ids = [...tasks.values()].filter(t => t.site_id === 'tuscaloosa-water').map(t => t.id).sort();
  assert.equal(ids.length, 8);
  for (const taskId of ids) { const {w, id} = make(taskId); try { assert.equal(w.evaluate(id, {}).success, false, taskId); } finally { w.close(); } }
});

test('Signed-in payment: saved checking, no fee, oldest-bill allocation, idempotent submit and strict grading', () => {
  const {w, id} = make('tuscaloosa-pay-current-bank-v1');
  try {
    const s = login(w, id);
    assert.throws(() => w.tusQuote(id, s, null, {serviceAccountId: 'svc-other', amountCents: 5190, methodId: 'bank-1048'}), /not found/);
    assert.throws(() => w.tusQuote(id, s, null, {serviceAccountId: 'svc-home', amountCents: 9000, methodId: 'bank-1048'}), /cannot exceed/);
    assert.throws(() => w.tusQuote(id, s, null, {serviceAccountId: 'svc-home', amountCents: 8432, paymentDate: '2026-10-01', methodId: 'bank-1048'}), /past/);
    const q = w.tusQuote(id, s, null, {serviceAccountId: 'svc-home', amountCents: 8432, methodId: 'bank-1048'});
    assert.equal(q.review.feeCents, 0);
    assert.throws(() => w.tusPay(id, s, null, q.token, {authorize: false}), /authorize/);
    const r = w.tusPay(id, s, null, q.token, {authorize: true}), again = w.tusPay(id, s, null, q.token, {authorize: true});
    assert.equal(r.confirmation, again.confirmation); assert.equal(w.state(id).payments.filter(p => !p.initial).length, 1);
    assert.equal(w.evaluate(id, {confirmation: 'wrong'}).success, false);
    assert.equal(w.evaluate(id, {confirmation: r.confirmation}).success, true);
    assert.throws(() => w.tusQuote(id, s, null, {serviceAccountId: 'svc-home', amountCents: 100, methodId: 'bank-1048'}), /no balance/);
  } finally { w.close(); }
});

test('Payment grader rejects card, partial and scheduled shortcuts', () => {
  for (const [input, failing] of [[{amountCents: 8432, methodId: 'card-4242'}, 'correct_instrument'], [{amountCents: 8000, methodId: 'bank-1048'}, 'correct_amount'], [{amountCents: 8432, methodId: 'bank-1048', paymentDate: '2026-10-10'}, 'exactly_one_payment']]) {
    const {w, id} = make('tuscaloosa-pay-current-bank-v1');
    try { const s = login(w, id), r = pay(w, id, s, {serviceAccountId: 'svc-home', ...input}); const e = w.evaluate(id, {confirmation: r.confirmation}); assert.equal(e.success, false); assert.equal(e.checks[failing], false, failing); } finally { w.close(); }
  }
});

test('Guest payment requires account and customer numbers, masks the address and grades the full card instrument', () => {
  const {w, id} = make('tuscaloosa-guest-card-pay-v1');
  try {
    assert.throws(() => w.tusGuestLookup(id, {accountNumber: '2048106', customerNumber: '2002099'}), /do not match/);
    assert.throws(() => w.tusGuestLookup(id, {accountNumber: '2048106'}), /both/);
    const g = w.tusGuestLookup(id, {accountNumber: '2048-106', customerNumber: ' 1001048 '}).token, view = w.tusGuest(id, g);
    assert.equal(view.account.balanceCents, 8432); assert.match(view.account.serviceAddress, /^\*\*\* Queen City/);
    assert.throws(() => w.tusQuote(id, null, g, {guest: true, amountCents: 5000, email: 'alex@billworld.test', methodId: 'bank-1048'}), /Choose a payment method/);
    assert.throws(() => w.tusQuote(id, null, g, {guest: true, amountCents: 5000, email: 'alex@billworld.test', ...card, cardNumber: '4111111111111112'}), /checksum/);
    assert.throws(() => w.tusQuote(id, null, g, {guest: true, amountCents: 5000, email: 'alex@billworld.test', ...card, expiry: '01/26'}), /expired/);
    assert.throws(() => w.tusQuote(id, null, 'forged', {guest: true, amountCents: 5000, email: 'alex@billworld.test', ...card}), /expired/);
    const other = w.create({siteId: 'tuscaloosa-water'}); assert.throws(() => w.tusQuote(other.episodeId, null, g, {guest: true, amountCents: 5000, email: 'a@b.co', ...card}), /expired/);
    const r = pay(w, id, null, {guest: true, amountCents: 5000, email: 'alex@billworld.test', ...card}, g);
    const p = w.state(id).payments.at(-1); assert.equal(p.authenticated, false); assert.equal(p.method.zipCode, '35401'); assert.equal('cardNumber' in p.method, false);
    assert.equal(w.evaluate(id, {confirmation: r.confirmation}).success, true);
    assert.ok(w.state(id).mail.some(m => m.subject.startsWith('Payment confirmation') && m.text.includes(r.confirmation)));
  } finally { w.close(); }
});

test('Registration, two-step account linking and AutoPay enrollment; grader requires only the home account', () => {
  const run = linkRental => {
    const {w, id} = make('tuscaloosa-register-autopay-v1');
    try {
      assert.throws(() => login(w, id), /incorrect/);
      const base = {email: 'alex@billworld.test', confirmEmail: 'alex@billworld.test', password: 'Tusc-Water-2026', confirmPassword: 'Tusc-Water-2026', firstName: 'Alex', lastName: 'Morgan', phone: '205-555-0148', zipCode: '35401', acceptTerms: true};
      assert.throws(() => w.tusRegister(id, {...base, password: 'short', confirmPassword: 'short'}), /8–64/);
      assert.throws(() => w.tusRegister(id, {...base, acceptTerms: false}), /Terms/);
      const s = w.tusRegister(id, base).session;
      assert.throws(() => w.tusRegister(id, base), /already exists/);
      assert.throws(() => w.tusLinkVerify(id, s, {accountNumber: '2048106', customerNumber: '9999999'}), /do not match/);
      const t = w.tusLinkVerify(id, s, {accountNumber: '2048106', customerNumber: '1001048'}).token;
      assert.equal(w.tusLinkReview(id, s, t).account.serviceAddress, '1048 Queen City Ave, Tuscaloosa, AL 35401');
      assert.throws(() => w.tusLinkConfirm(id, s, t, {acceptTerms: false}), /authorized/);
      w.tusLinkConfirm(id, s, t, {acceptTerms: true}); assert.throws(() => w.tusLinkConfirm(id, s, t, {acceptTerms: true}), /unavailable|expired/);
      if (linkRental) { const t2 = w.tusLinkVerify(id, s, {accountNumber: '2048107', customerNumber: '1001048'}).token; w.tusLinkConfirm(id, s, t2, {acceptTerms: true}); }
      assert.throws(() => w.tusAutoPayQuote(id, s, {serviceAccountId: 'svc-home', enabled: true}), /saved payment method/);
      const m = w.tusWalletAdd(id, s, bank).method;
      const q = w.tusAutoPayQuote(id, s, {serviceAccountId: 'svc-home', enabled: true, methodId: m.id});
      assert.equal(q.review.firstDraftDate, '2026-10-15');
      w.tusAutoPayConfirm(id, s, q.token, {authorize: true});
      return w.evaluate(id, {});
    } finally { w.close(); }
  };
  const ok = run(false); assert.equal(ok.success, true, JSON.stringify(ok.checks));
  const extra = run(true); assert.equal(extra.success, false); assert.equal(extra.checks.linked_only_requested_account, false);
});

test('Password recovery uses a one-use, superseding email link and revokes sessions', () => {
  const {w, id} = make('tuscaloosa-recover-login-v1');
  try {
    const old = login(w, id);
    assert.match(w.tusRecoveryRequest(id, {email: 'nobody@billworld.test'}).message, /If a profile exists/);
    w.tusRecoveryRequest(id, {email: 'alex@billworld.test'});
    const first = w.state(id).mail.at(-1).text.match(/token=([A-Za-z0-9_-]+)/)[1];
    w.tusRecoveryRequest(id, {email: 'alex@billworld.test'});
    const token = w.state(id).mail.at(-1).text.match(/token=([A-Za-z0-9_-]+)/)[1];
    assert.throws(() => w.tusRecoveryGrant(id, first), /expired or was already used/);
    w.tusRecoveryGrant(id, token, true);
    assert.throws(() => w.tusRecoveryComplete(id, token, {password: 'Restored-Tusc-2026', confirmPassword: 'nope'}), /do not match/);
    w.tusRecoveryComplete(id, token, {password: 'Restored-Tusc-2026', confirmPassword: 'Restored-Tusc-2026'});
    assert.throws(() => w.tusAccounts(id, old), /sign in/);
    assert.throws(() => w.tusRecoveryComplete(id, token, {password: 'Other-Pass-2026', confirmPassword: 'Other-Pass-2026'}), /expired/);
    assert.equal(w.evaluate(id, {}).success, false, 'must sign in and open accounts after reset');
    const s = login(w, id, 'Restored-Tusc-2026'); w.tusAccounts(id, s);
    assert.equal(w.evaluate(id, {}).success, true);
  } finally { w.close(); }
});

test('Scheduled payments: edit/cancel ownership, validation, execution, skip when paid and grading', () => {
  const {w, id} = make('tuscaloosa-edit-scheduled-v1');
  try {
    const s = login(w, id);
    assert.throws(() => w.tusScheduleEdit(id, s, {scheduleId: 'sch-1', amountCents: 8432, date: '2026-10-03', methodId: 'bank-1048'}), /future/);
    assert.throws(() => w.tusScheduleEdit(id, s, {scheduleId: 'sch-1', amountCents: 8432, date: '2027-01-30', methodId: 'bank-1048'}), /60 days/);
    assert.throws(() => w.tusScheduleEdit(id, s, {scheduleId: 'sch-1', amountCents: 8432, date: '2026-10-12', methodId: 'nope'}), /saved payment/);
    w.tusScheduleCancel(id, s, {scheduleId: 'sch-2'}); assert.throws(() => w.tusScheduleCancel(id, s, {scheduleId: 'sch-2'}), /Only scheduled/);
    w.tusScheduleEdit(id, s, {scheduleId: 'sch-1', amountCents: 8432, date: '2026-10-12', methodId: 'bank-1048'});
    assert.equal(w.evaluate(id, {scheduledDate: '2026-10-14'}).success, false);
    assert.equal(w.evaluate(id, {scheduledDate: '2026-10-12'}).success, true);
    const ran = w.advance(id, 10 * 86400000).executed; assert.deepEqual(ran.map(x => x.status), ['posted']);
    const p = w.state(id).payments.at(-1); assert.equal(p.paymentDate, '2026-10-12'); assert.equal(p.method.last4, '1048'); assert.equal(p.source, 'scheduled');
  } finally { w.close(); }
  const other = make('tuscaloosa-edit-scheduled-v1');
  try {
    const jordan = other.w.tusLogin(other.id, {email: 'jordan@billworld.test', password: 'Other-2026!'}).session;
    assert.throws(() => other.w.tusScheduleCancel(other.id, jordan, {scheduleId: 'sch-1'}), /not found/);
    const s = login(other.w, other.id); pay(other.w, other.id, s, {serviceAccountId: 'svc-home', amountCents: 8432, methodId: 'bank-1048'});
    const ran = other.w.advance(other.id, 12 * 86400000).executed; assert.deepEqual(ran.map(x => x.status).sort(), ['skipped', 'skipped']);
  } finally { other.w.close(); }
});

test('AutoPay: due-date drafts of the remaining balance, change keeps enrollment, cancel stops drafts, NSF assesses $30', () => {
  const {w, id} = make('tuscaloosa-change-cancel-autopay-v1');
  try {
    const s = login(w, id);
    assert.throws(() => w.tusAutoPayQuote(id, s, {serviceAccountId: 'svc-home', enabled: true, methodId: 'card-4242'}), /already uses/);
    const q = w.tusAutoPayQuote(id, s, {serviceAccountId: 'svc-home', enabled: true, methodId: 'bank-1048'});
    const stale = w.tusAutoPayQuote(id, s, {serviceAccountId: 'svc-rental', enabled: false});
    assert.throws(() => w.tusAutoPayConfirm(id, s, q.token, {authorize: true}), /expired/, 'a newer review supersedes the older one');
    const q1 = w.tusAutoPayQuote(id, s, {serviceAccountId: 'svc-home', enabled: true, methodId: 'bank-1048'}); w.tusAutoPayConfirm(id, s, q1.token, {authorize: true});
    assert.equal(w.evaluate(id, {}).success, false);
    const q2 = w.tusAutoPayQuote(id, s, {serviceAccountId: 'svc-rental', enabled: false}); w.tusAutoPayConfirm(id, s, q2.token, {authorize: true});
    const e = w.evaluate(id, {}); assert.equal(e.success, true, JSON.stringify(e.checks)); void stale;
    pay(w, id, s, {serviceAccountId: 'svc-home', amountCents: 2000, methodId: 'card-4242'});
    const ran = w.advance(id, 13 * 86400000).executed; assert.equal(ran.length, 1);
    const draft = w.state(id).payments.at(-1); assert.equal(draft.source, 'autopay'); assert.equal(draft.amountCents, 6432); assert.equal(draft.paymentDate, '2026-10-15');
  } finally { w.close(); }
  const nsf = make('tuscaloosa-register-autopay-v1');
  try {
    const s = nsf.w.tusRegister(nsf.id, {email: 'alex@billworld.test', confirmEmail: 'alex@billworld.test', password: 'Tusc-Water-2026', confirmPassword: 'Tusc-Water-2026', firstName: 'Alex', lastName: 'Morgan', phone: '2055550148', zipCode: '35401', acceptTerms: true}).session;
    const t = nsf.w.tusLinkVerify(nsf.id, s, {accountNumber: '2048106', customerNumber: '1001048'}).token; nsf.w.tusLinkConfirm(nsf.id, s, t, {acceptTerms: true});
    const m = nsf.w.tusWalletAdd(nsf.id, s, {...bank, accountNumber: '000000009', confirmAccountNumber: '000000009'}).method;
    const q = nsf.w.tusAutoPayQuote(nsf.id, s, {serviceAccountId: 'svc-home', enabled: true, methodId: m.id}); nsf.w.tusAutoPayConfirm(nsf.id, s, q.token, {authorize: true});
    nsf.w.advance(nsf.id, 13 * 86400000);
    const st = nsf.w.state(nsf.id); assert.equal(st.payments.at(-1).status, 'returned');
    const fee = st.invoices.find(i => i.purpose === 'nsf_fee'); assert.equal(fee.amountCents, 3000);
    assert.equal(nsf.w.tusAccounts(nsf.id, login(nsf.w, nsf.id, 'Tusc-Water-2026')).accounts[0].balanceCents, 8432 + 3000, 'sessions expire on the simulated clock; sign in again');
    assert.ok(st.mail.some(x => x.subject === 'Payment returned for insufficient funds'));
  } finally { nsf.w.close(); }
});

test('eBill: city form needs both numbers and the holder name; enroll, update and unsubscribe; grader rejects portal use', () => {
  const {w, id} = make('tuscaloosa-ebill-enroll-v1');
  try {
    const input = {action: 'enroll', accountNumber: '2048106', customerNumber: '1001048', name: 'Alex Morgan', email: 'alex@billworld.test', confirmEmail: 'alex@billworld.test', acceptTerms: true};
    assert.throws(() => w.tusEBill(id, {...input, acceptTerms: false}), /terms/);
    assert.throws(() => w.tusEBill(id, {...input, customerNumber: '2002099'}), /do not match/);
    assert.throws(() => w.tusEBill(id, {...input, action: 'update'}), /not enrolled/);
    const r = w.tusEBill(id, input); assert.match(r.reference, /^EB-0001-8106$/);
    assert.throws(() => w.tusEBill(id, input), /already enrolled/);
    assert.equal(w.evaluate(id, {}).success, true);
    login(w, id); assert.equal(w.evaluate(id, {}).checks.portal_untouched, false);
    w.tusEBill(id, {...input, action: 'unsubscribe'}); assert.equal(w.state(id).tusServiceAccounts[0].ebill.status, 'paper');
  } finally { w.close(); }
});

test('Bill history shows the past 12 bills; statements are linked-account scoped deterministic PDFs', () => {
  const {w, id} = make('tuscaloosa-download-bill-v1');
  try {
    const s = login(w, id), bills = w.tusBills(id, s, 'svc-home').bills;
    assert.equal(bills.length, 12); assert.equal(bills[0].id, 'inv-current'); assert.equal(bills[0].gallons, Math.round(52 * 74.8));
    assert.throws(() => w.tusStatement(id, s, 'inv-other'), /not found/);
    const a = w.tusStatement(id, s, 'inv-old'), b = w.tusStatement(id, s, 'inv-old');
    assert.equal(a.sha256, b.sha256); assert.equal(a.bytes.subarray(0, 5).toString(), '%PDF-');
    assert.equal(w.evaluate(id, {statementFilename: 'tuscaloosa-water-2048106-2026-09-30.pdf'}).success, false);
    assert.equal(w.evaluate(id, {statementFilename: a.filename}).success, true);
  } finally { w.close(); }
});

test('Wallet: duplicate prevention and removal guards for AutoPay and scheduled payments', () => {
  const {w, id} = make('tuscaloosa-edit-scheduled-v1');
  try {
    const s = login(w, id);
    assert.throws(() => w.tusWalletAdd(id, s, bank), /already in your wallet/);
    assert.throws(() => w.tusWalletRemove(id, s, {methodId: 'card-4242'}), /AutoPay|scheduled/);
    const m = w.tusWalletAdd(id, s, card).method; w.tusWalletRemove(id, s, {methodId: m.id});
    assert.equal(w.tusWallet(id, s).methods.length, 2);
  } finally { w.close(); }
});
