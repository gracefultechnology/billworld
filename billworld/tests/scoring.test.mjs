import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../engine.mjs';
test('finalization freezes episodes and repeated finish cannot revise the score', () => {
  const world = new World(); const f = world.create(); const result = world.finish(f.episodeId, {}, { kind: 'agent', agent: 'fixture-failure' });
  assert.equal(result.success, false); assert.deepEqual(world.finish(f.episodeId, { confirmation: 'different' }, { kind: 'agent', agent: 'changed' }), result);
  assert.throws(() => world.resetRequest(f.episodeId, { email: f.credentials.email }), /finished/); assert.equal(world.report().trials, 1); world.close();
});
test('strict successful trial and explicit failures are counted with separate reference cohorts', () => {
  const world = new World(); const good = world.create(); const q = world.quote(good.episodeId, null, { invoiceId: 'inv-current', customerNumber: '1001048', amountCents: 8432, kind: 'bank', routing: '021000021', accountNumber: '000001048', name: 'Alex' });
  const payment = world.pay(good.episodeId, null, { token: q.token }); world.finish(good.episodeId, { confirmation: payment.confirmation }, { kind: 'agent', agent: 'test-double' });
  const bad = world.create({ siteId: 'spotify' }); world.finish(bad.episodeId, {}, { kind: 'agent', agent: 'test-double' });
  const ref = world.create(); world.finish(ref.episodeId, {}, { kind: 'reference_script', agent: 'reference' });
  const report = world.report(); assert.equal(report.trials, 2); assert.equal(report.successes, 1); assert.equal(report.successRate, 0.5); assert.equal(report.siteMacroSuccessRate, 0.5);
  assert.equal(report.bySite.spotify.successRate, 0); assert.equal(world.report({ kind: 'reference_script' }).trials, 1); world.close();
});
test('no scored trials is unavailable, not a zero success rate', () => {
  const world = new World(); world.create(); assert.equal(world.report().successRate, null); assert.equal(world.report().trials, 0); world.close();
});
test('expired wall-clock budget cannot be converted into a successful late finish', () => {
  const world = new World(); const f = world.create(); world.transact(f.episodeId, s => { s.createdAt = Date.now() - 301000; });
  const r = world.finish(f.episodeId, {}, { kind: 'agent', agent: 'slow' }); assert.equal(r.withinTimeBudget, false); assert.equal(r.success, false); world.close();
});
test('recovery score requires the requested password, subsequent login and no payment', () => {
  const world = new World(); const f = world.create({ taskId: 'juneau-recover-password-v1' });
  assert.equal(world.evaluate(f.episodeId).success, false);
  world.resetRequest(f.episodeId, { email: f.credentials.email });
  const token = world.messages(f.episodeId, f.connectorToken, 'subject:Reset')[0].text.match(/token=([\w-]+)/)[1];
  world.resetPassword(f.episodeId, { token, password: 'Restored-2026!' });
  assert.equal(world.evaluate(f.episodeId).checks.signed_in_after_reset, false);
  world.login(f.episodeId, { email: f.credentials.email, password: 'Restored-2026!' });
  assert.equal(world.evaluate(f.episodeId).success, true);
  const q = world.quote(f.episodeId, null, { invoiceId: 'inv-current', customerNumber: '1001048', amountCents: 8432, kind: 'bank', routing: '021000021', accountNumber: '000001048', name: 'Alex' });
  world.pay(f.episodeId, null, { token: q.token }); assert.equal(world.evaluate(f.episodeId).checks.no_payments, false); world.close();
});
test('MFA task rejects a guest shortcut even when MFA is completed afterward', () => {
  const world = new World(); const f = world.create({ taskId: 'juneau-pay-email-mfa-v1' });
  const q = world.quote(f.episodeId, null, { invoiceId: 'inv-current', customerNumber: '1001048', amountCents: 8432, kind: 'bank', routing: '021000021', accountNumber: '000001048', name: 'Alex' });
  const p = world.pay(f.episodeId, null, { token: q.token });
  const auth = world.login(f.episodeId, f.credentials);
  const code = world.messages(f.episodeId, f.connectorToken, 'subject:verification')[0].text.match(/code is (\d{6})/)[1];
  world.verifyOtp(f.episodeId, { challenge: auth.challenge, code });
  const score = world.evaluate(f.episodeId, { confirmation: p.confirmation });
  assert.equal(score.success, false); assert.equal(score.checks.authenticated_payment, false); assert.equal(score.checks.email_mfa_completed_before_payment, false); world.close();
});
test('MFA task accepts verified sign-in followed by the correct payment', () => {
  const world = new World(); const f = world.create({ taskId: 'juneau-pay-email-mfa-v1' });
  const auth = world.login(f.episodeId, f.credentials);
  const code = world.messages(f.episodeId, f.connectorToken, 'subject:verification')[0].text.match(/code is (\d{6})/)[1];
  const { session } = world.verifyOtp(f.episodeId, { challenge: auth.challenge, code });
  const q = world.quote(f.episodeId, session, { invoiceId: 'inv-current', amountCents: 8432, methodId: 'bank-1048' });
  const p = world.pay(f.episodeId, session, { token: q.token });
  assert.equal(world.evaluate(f.episodeId, { confirmation: p.confirmation }).success, true); world.close();
});
test('browser-only and connector trials have separate success-rate denominators', () => {
  const world = new World();
  for (const accessMode of ['browser_only', 'browser_and_email_connector']) {
    const f = world.create(); world.finish(f.episodeId, {}, { kind: 'agent', agent: 'same-agent', accessMode });
  }
  assert.equal(world.report().trials, 1); assert.equal(world.report({ accessMode: 'browser_and_email_connector' }).trials, 1);
  assert.equal(world.report().trialsDetail[0].accessMode, 'browser_only'); world.close();
});
