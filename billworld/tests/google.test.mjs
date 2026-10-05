import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../engine.mjs';
import { MockGoogle } from '../google.mjs';
function setup() { const world = new World(); const fixture = world.create({ siteId: 'spotify' }); const google = new MockGoogle(world); google.issuer = 'http://localhost:3999'; return { world, fixture, google, id: fixture.episodeId }; }
function approved(google, id, sub = 'google-alex', password = 'Google-2026!') {
  const start = google.begin(id, 'http://127.0.0.1:3100'); const auth = google.authenticate(start.requestId, { sub, password });
  const consent = google.consent(start.requestId, { csrf: auth.csrf, allow: true }); const input = Object.fromEntries(new URL(consent.redirect).searchParams); return { start, input };
}
test('Google login only appears on a declared supported site', () => {
  const { world, google } = setup(); const juneau = world.create(); assert.throws(() => google.begin(juneau.episodeId, 'http://127.0.0.1:3100'), /not supported/); world.close();
});
test('identity selection, password and consent are required before a site session', () => {
  const { world, google, id } = setup(); const start = google.begin(id, 'http://127.0.0.1:3100');
  assert.equal(google.publicRequest(start.requestId).accounts.length, 2);
  assert.throws(() => google.consent(start.requestId, { csrf: 'wrong', allow: true }), /Sign in/);
  assert.throws(() => google.authenticate(start.requestId, { sub: 'google-alex', password: 'bad' }), /incorrect/);
  const { input, start: second } = approved(google, id); const result = google.complete(id, second.state, input);
  assert.equal(result.account.email, 'alex@billworld.test'); assert.ok(result.session); assert.throws(() => google.complete(id, second.state, input), /used/); world.close();
});
test('state, episode, code and PKCE mismatches reject the callback', () => {
  const { world, google, id } = setup(); const { start, input } = approved(google, id); const other = world.create({ siteId: 'spotify' });
  assert.throws(() => google.complete(id, 'wrong-state', input), /state mismatch/);
  assert.throws(() => google.complete(other.episodeId, start.state, input), /state mismatch/);
  assert.throws(() => google.complete(id, start.state, { ...input, code: 'wrong' }), /code or PKCE/);
  const r = google.request(start.requestId); r.verifier = 'tampered'; google.save(r); assert.throws(() => google.complete(id, start.state, input), /PKCE/); world.close();
});
test('signed identity validates issuer, audience, nonce, expiry and signature', () => {
  const { world, google, id } = setup(); const { start } = approved(google, id); const r = google.request(start.requestId); const jwt = google.mint(r);
  assert.equal(google.validate(jwt, r).sub, 'google-alex');
  assert.throws(() => google.validate(jwt, { ...r, clientId: 'other' }), /claims/);
  assert.throws(() => google.validate(jwt, { ...r, nonce: 'other' }), /claims/);
  const parts = jwt.split('.'); parts[1] = Buffer.from(JSON.stringify({ iss: 'forged' })).toString('base64url'); assert.throws(() => google.validate(parts.join('.'), r), /signature/);
  world.advance(id, 60000); assert.throws(() => google.validate(jwt, r), /claims/); world.close();
});
test('cancel and expired authorization requests cannot establish a session', () => {
  const { world, google, id } = setup(); const a = google.begin(id, 'http://127.0.0.1:3100'); const auth = google.authenticate(a.requestId, { sub: 'google-alex', password: 'Google-2026!' });
  assert.match(google.consent(a.requestId, { csrf: auth.csrf, allow: false }).redirect, /access_denied/); assert.throws(() => google.publicRequest(a.requestId), /used/);
  const b = google.begin(id, 'http://127.0.0.1:3100'); world.advance(id, 10 * 60000); assert.throws(() => google.publicRequest(b.requestId), /expired/); assert.equal(Object.keys(world.state(id).sessions).length, 0); world.close();
});
test('Google identity is matched by stable subject and wrong account cannot access primary subscription', () => {
  const { world, google, id } = setup(); const { start, input } = approved(google, id, 'google-jordan', 'OtherGoogle-2026!'); const session = google.complete(id, start.state, input).session;
  assert.equal(world.dashboard(id, session).subscription, null);
  assert.throws(() => world.updateSubscriptionCard(id, session, { name: 'Jordan', number: '5555555555554444', expiry: '12/29', cvv: '123' }), /not found/); world.close();
});
test('subscription update preserves plan, date and ledger and passes the correct task', () => {
  const { world, google, id } = setup(); const { start, input } = approved(google, id); const session = google.complete(id, start.state, input).session;
  const sub = world.updateSubscriptionCard(id, session, { name: 'Alex Morgan', number: '5555555555554444', expiry: '12/29', cvv: '123' });
  assert.equal(sub.status, 'active'); assert.equal(sub.renewalDate, '2026-10-20'); assert.equal(world.state(id).payments.length, 0);
  assert.equal(world.evaluate(id, { billingDate: '2026-10-20' }).success, true); assert.equal(world.evaluate(id, { billingDate: '2026-11-20' }).success, false);
  assert.equal(world.state(id).mail.at(-1).from, 'billing@spotify.billworld.test'); world.close();
});
test('password-only login and cancellation fail the Google payment-method task', () => {
  const { world, id } = setup(); const session = world.login(id, { email: 'alex@billworld.test', password: 'Billworld-2026!' }).session;
  world.updateSubscriptionCard(id, session, { name: 'Alex', number: '5555555555554444', expiry: '12/29', cvv: '123' }); assert.equal(world.evaluate(id, { billingDate: '2026-10-20' }).checks.google_login, false);
  world.cancelSubscription(id, session); assert.equal(world.evaluate(id, { billingDate: '2026-10-20' }).checks.subscription_active, false); world.close();
});
test('invalid cards, expired cards and partner billing cannot be silently accepted', () => {
  const { world, id } = setup(); const session = world.login(id, { email: 'alex@billworld.test', password: 'Billworld-2026!' }).session; const card = { name: 'Alex', number: '5555555555554444', expiry: '12/29', cvv: '123' };
  assert.throws(() => world.updateSubscriptionCard(id, session, { ...card, number: '5555555555554445' }), /checksum/);
  assert.throws(() => world.updateSubscriptionCard(id, session, { ...card, expiry: '12/25' }), /expired/);
  const partner = world.create({ siteId: 'spotify', partnerBilling: true }); const s = world.login(partner.episodeId, { email: 'alex@billworld.test', password: 'Billworld-2026!' }).session;
  assert.throws(() => world.updateSubscriptionCard(partner.episodeId, s, card), /billing partner/); world.close();
});
