import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../engine.mjs';
const make = options => { const w = new World(); const f = w.create({ siteId: 'avec-electric', ...options }); return { w, f, id: f.episodeId }; };
const bank = { invoiceId: 'inv-current', customerNumber: '1001048', amountCents: 8432, kind: 'bank', routing: '021000021', accountNumber: '000001048', name: 'Alex Morgan' };
test('SmartHub guest lookup requires surname, scopes access and expires', () => {
  const { w, id } = make(); assert.throws(() => w.smartLookup(id, { customerNumber: '1001048', lastName: 'Lee' }), /verified/);
  assert.throws(() => w.search(id, '1001048'), /Look up/); assert.throws(() => w.quote(id, null, bank), /Look up/);
  const lookup = w.smartLookup(id, { customerNumber: '1001048', lastName: ' morgan ' });
  assert.equal(w.search(id, '1001048', null, lookup.lookupToken).account.name, 'Alex Morgan');
  assert.throws(() => w.search(id, '2002099', null, lookup.lookupToken), /Look up/);
  const q = w.quote(id, null, { ...bank, lookupToken: lookup.lookupToken }); const p = w.pay(id, null, { token: q.token });
  assert.equal(w.evaluate(id, { confirmation: p.confirmation }).success, true);
  w.advance(id, 16 * 60000); assert.throws(() => w.search(id, '1001048', null, lookup.lookupToken), /Look up/); w.close();
});
test('registration requires the first-step token and matching synthetic SSN and phone', () => {
  const { w, f, id } = make({ registered: false }); const data = { customerNumber: '1001048', email: f.credentials.email, password: 'Registered-2026!', ssnLast4: '1048', phone: '(907) 555-0148' };
  assert.throws(() => w.register(id, data), /expired/);
  const flow = w.smartLookup(id, { ...data, lastName: 'Morgan', confirmEmail: data.email, registration: true });
  assert.throws(() => w.register(id, { ...data, ...flow, ssnLast4: '9999' }), /do not match/);
  const other = w.create({ siteId: 'avec-electric', registered: false }); assert.throws(() => w.register(other.episodeId, { ...data, ...flow }), /expired/);
  const result = w.register(id, { ...data, ...flow }); assert.ok(result.session);
  assert.equal(w.state(id).events.filter(e => e.type === 'registered').length, 1); assert.throws(() => w.register(id, { ...data, ...flow }), /already/); w.close();
});
test('recovery validates account and surname before delivering a normal reset email', () => {
  const { w, f, id } = make(); const data = { email: f.credentials.email, customerNumber: '1001048', lastName: 'Lee' };
  const bad = w.resetRequest(id, data); assert.equal(w.messages(id, f.connectorToken, 'subject:Reset').length, 0);
  const good = w.resetRequest(id, { ...data, lastName: 'Morgan' }); assert.deepEqual(good, bad);
  const token = w.messages(id, f.connectorToken, 'subject:Reset')[0].text.match(/token=([\w-]+)/)[1]; w.resetPassword(id, { token, password: 'Restored-2026!' });
  assert.ok(w.login(id, { email: data.email, password: 'Restored-2026!' }).session);
  const count = w.state(id).mail.length; w.recoverRegisteredEmail(id, { customerNumber: '1001048', lastName: 'Morgan' }); assert.equal(w.state(id).mail.length, count + 1); w.close();
});
test('AVEC recurring day executes on the chosen day and uses its synthetic fee policy', () => {
  const { w, f, id } = make(); const session = w.login(id, f.credentials).session;
  w.autopay(id, session, { enabled: true, methodId: 'card-4242', day: 15 });
  w.advance(id, Date.parse('2026-10-15T00:00:00Z') - w.state(id).now);
  const p = w.state(id).payments.filter(p => !p.initial); assert.equal(p.length, 1); assert.equal(p[0].feeCents, 0);
  assert.equal(p[0].createdAt, Date.parse('2026-10-15T00:00:00Z')); w.advance(id, 8 * 86400000); assert.equal(w.state(id).payments.filter(p => !p.initial).length, 1); w.close();
});
test('AVEC day 31 clamps to February end without creating a March debit', () => {
  const { w, f, id } = make(); const session = w.login(id, f.credentials).session;
  w.autopay(id, session, { enabled: true, methodId: 'bank-1048', day: 31 }); w.advance(id, Date.parse('2027-02-28T00:00:00Z') - w.state(id).now);
  assert.ok(w.state(id).payments.some(p => p.source === 'autopay' && p.createdAt === Date.parse('2027-02-28T00:00:00Z'))); w.close();
});
