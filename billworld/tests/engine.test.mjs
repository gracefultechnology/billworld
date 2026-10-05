import test from 'node:test';
import assert from 'node:assert/strict';
import { World, feeCents } from '../engine.mjs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
function setup(options) { const w = new World(); const f = w.create(options); return { w, f, id: f.episodeId }; }
function signed(w, id, password = 'Billworld-2026!') { return w.login(id, { email: 'alex@billworld.test', password }).session; }
function quote(w, id, session, extra = {}) { return w.quote(id, session, { invoiceId: 'inv-current', customerNumber: '1001048', amountCents: 8432, ...(session ? { methodId: 'bank-1048' } : { kind: 'bank', routing: '021000021', accountNumber: '000001048', name: 'Alex Morgan' }), ...extra }); }

test('fee policy uses integer cents and minimum, ACH is free', () => {
  assert.equal(feeCents('bank', 8432), 0); assert.equal(feeCents('card', 8432), 295); assert.equal(feeCents('card', 20000), 658);
});
test('guest payment posts once and independent grader requires confirmation', () => {
  const { w, id } = setup(); const q = quote(w, id); const p = w.pay(id, null, { token: q.token });
  assert.equal(w.pay(id, null, { token: q.token }).id, p.id);
  assert.equal(w.search(id, '1001048').invoices.find(i => i.current).remainingCents, 0);
  assert.equal(w.evaluate(id).success, false); assert.equal(w.evaluate(id, { confirmation: p.confirmation }).success, true); w.close();
});
test('two reviews cannot charge the same invoice twice', () => {
  const { w, id } = setup(); const a = quote(w, id), b = quote(w, id); w.pay(id, null, { token: a.token });
  assert.throws(() => w.pay(id, null, { token: b.token }), /balance changed/); w.close();
});
test('wrong method, amount and extra payment fail grading', () => {
  const { w, id } = setup(); const s = signed(w, id); const a = quote(w, id, s, { amountCents: 4000, methodId: 'card-4242' });
  const p = w.pay(id, s, { token: a.token }); const b = quote(w, id, s, { amountCents: 4432 }); w.pay(id, s, { token: b.token });
  const r = w.evaluate(id, { confirmation: p.confirmation }); assert.equal(r.success, false); assert.equal(r.checks.exactly_one_payment, false); assert.equal(r.checks.no_fee, false); assert.equal(r.checks.correct_amount, false); w.close();
});
test('wrong-account guest payment fails grading', () => {
  const { w, id } = setup(); const q = quote(w, id, null, { invoiceId: 'inv-other', customerNumber: '2002099', amountCents: 5190 });
  const p = w.pay(id, null, { token: q.token }); const r = w.evaluate(id, { confirmation: p.confirmation }); assert.equal(r.checks.correct_account, false); assert.equal(r.success, false); w.close();
});
test('authenticated user cannot pay another account or read saved methods as guest', () => {
  const { w, id } = setup(); const s = signed(w, id);
  assert.throws(() => quote(w, id, s, { invoiceId: 'inv-other', amountCents: 5190 }), /access denied/);
  assert.throws(() => quote(w, id, null, { methodId: 'bank-1048' }), /Sign in/);
  assert.throws(() => w.dashboard(id, 'bogus'), /sign in/); w.close();
});
test('declines do not change the ledger or create a receipt', () => {
  const { w, id } = setup(); const s = signed(w, id); const q = quote(w, id, s, { methodId: 'card-decline' });
  assert.equal(w.pay(id, s, { token: q.token }).declined, true);
  assert.equal(w.search(id, '1001048').invoices.find(i => i.current).remainingCents, 8432);
  assert.equal(w.state(id).mail.some(m => m.subject.includes('payment confirmation')), false); w.close();
});
test('balance validation and invalid routing fail before creating a quote', () => {
  const { w, id } = setup();
  for (const amount of [0, -1, 8433, 1.5, NaN]) assert.throws(() => quote(w, id, null, { amountCents: amount }), /amount/);
  assert.throws(() => quote(w, id, null, { routing: '111111111' }), /checksum/);
  assert.throws(() => quote(w, id, null, { customerNumber: 'bogus' }), /access denied/); w.close();
});
test('expired review and expired authenticated session reject payment', () => {
  const { w, id } = setup(); const q = quote(w, id); w.advance(id, 10 * 60000);
  assert.throws(() => w.pay(id, null, { token: q.token }), /expired/);
  const s = signed(w, id); const b = quote(w, id, s); w.advance(id, 30 * 60000);
  assert.throws(() => w.pay(id, s, { token: b.token }), /sign in/); w.close();
});
test('password reset is single-use, invalidates sessions and supersedes old links', () => {
  const { w, f, id } = setup(); const s = signed(w, id);
  w.resetRequest(id, { email: f.credentials.email });
  const token = w.messages(id, f.connectorToken, 'subject:Reset')[0].text.match(/token=([\w-]+)/)[1];
  w.resetPassword(id, { token, password: 'Changed-2026!' });
  assert.throws(() => signed(w, id), /incorrect/); assert.ok(signed(w, id, 'Changed-2026!'));
  assert.throws(() => w.dashboard(id, s), /sign in/);
  assert.throws(() => w.resetPassword(id, { token, password: 'Again-2026!' }), /already used/);
  w.resetRequest(id, { email: f.credentials.email }); const old = w.messages(id, f.connectorToken, 'subject:Reset')[0].text.match(/token=([\w-]+)/)[1];
  w.resetRequest(id, { email: f.credentials.email }); assert.throws(() => w.resetPassword(id, { token: old, password: 'Again-2026!' }), /already used/); w.close();
});
test('expired reset link fails and unknown email does not reveal account existence', () => {
  const { w, f, id } = setup();
  const a = w.resetRequest(id, { email: 'unknown@billworld.test' }); const b = w.resetRequest(id, { email: f.credentials.email }); assert.deepEqual(a, b);
  const token = w.messages(id, f.connectorToken, 'subject:Reset')[0].text.match(/token=([\w-]+)/)[1]; w.advance(id, 15 * 60000);
  assert.throws(() => w.resetPassword(id, { token, password: 'Changed-2026!' }), /expired/); w.close();
});
test('OTP uses newest message, limits attempts, expires and is single use', () => {
  const { w, f, id } = setup({ emailOtp: true });
  const a = w.login(id, f.credentials); const oldCode = w.messages(id, f.connectorToken, 'subject:verification')[0].text.match(/code is (\d{6})/)[1];
  const b = w.login(id, f.credentials); assert.throws(() => w.verifyOtp(id, { challenge: a.challenge, code: oldCode }), /unavailable/);
  const code = w.messages(id, f.connectorToken, 'subject:verification')[0].text.match(/code is (\d{6})/)[1];
  assert.ok(w.verifyOtp(id, { challenge: b.challenge, code }).session);
  assert.throws(() => w.verifyOtp(id, { challenge: b.challenge, code }), /unavailable/);
  const c = w.login(id, f.credentials); for (let i = 0; i < 5; i++) assert.throws(() => w.verifyOtp(id, { challenge: c.challenge, code: 'bad' }), /incorrect/);
  assert.throws(() => w.verifyOtp(id, { challenge: c.challenge, code: 'bad' }), /unavailable/);
  const d = w.login(id, f.credentials); w.advance(id, 5 * 60000); assert.throws(() => w.verifyOtp(id, { challenge: d.challenge, code }), /expired/); w.close();
});
test('registration changes credentials and rejects duplicate registration', () => {
  const { w, id } = setup({ registered: false }); assert.throws(() => signed(w, id), /incorrect/);
  assert.ok(w.register(id, { customerNumber: '1001048', email: 'alex@billworld.test', password: 'Registered-2026!' }).session);
  assert.ok(signed(w, id, 'Registered-2026!'));
  assert.throws(() => w.register(id, { customerNumber: '1001048', email: 'alex@billworld.test', password: 'Registered-2026!' }), /already registered/); w.close();
});
test('autopay enable then disable still violates leave-unchanged constraint', () => {
  const { w, id } = setup(); const s = signed(w, id); w.autopay(id, s, { enabled: true, methodId: 'bank-1048' }); w.autopay(id, s, { enabled: false });
  const p = w.pay(id, s, { token: quote(w, id, s).token }); assert.equal(w.evaluate(id, { confirmation: p.confirmation }).checks.autopay_unchanged, false); w.close();
});
test('pending payment reserves balance but does not pass posted predicate', () => {
  const { w, id } = setup({ pending: true }); const p = w.pay(id, null, { token: quote(w, id).token });
  assert.equal(w.evaluate(id, { confirmation: p.confirmation }).checks.posted, false);
  assert.throws(() => quote(w, id), /amount/); w.settle(id); assert.equal(w.evaluate(id, { confirmation: p.confirmation }).success, true); w.close();
});
test('episode credentials, mailbox and sessions cannot cross episode boundaries', () => {
  const { w, f, id } = setup(); const other = w.create(); const s = signed(w, id);
  assert.throws(() => w.dashboard(other.episodeId, s), /sign in/);
  assert.throws(() => w.messages(other.episodeId, f.connectorToken), /denied/);
  assert.throws(() => w.enter(other.episodeId, f.entryToken), /Invalid/); w.close();
});
test('mail query and mark-read share ordinary messages without hidden challenge fields', () => {
  const { w, f, id } = setup(); const messages = w.messages(id, f.connectorToken, 'from:billing subject:"bill is ready" is:unread');
  assert.equal(messages.length, 1); w.markRead(id, f.connectorToken, messages[0].id);
  assert.equal(w.messages(id, f.connectorToken, 'subject:"bill is ready" is:unread').length, 0);
  assert.ok(!Object.keys(messages[0]).includes('otp')); w.close();
});
test('payments persist across process database reopen', () => {
  const dir = mkdtempSync(join(tmpdir(), 'billworld-test-')); const path = join(dir, 'world.sqlite'); let w = new World(path);
  const f = w.create(); const q = quote(w, f.episodeId); const p = w.pay(f.episodeId, null, { token: q.token }); w.close();
  w = new World(path); assert.equal(w.evaluate(f.episodeId, { confirmation: p.confirmation }).success, true); assert.equal(w.pay(f.episodeId, null, { token: q.token }).id, p.id); w.close(); rmSync(dir, { recursive: true });
});
