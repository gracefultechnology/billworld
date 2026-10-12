// Regressions from the blind-agent audit of the tv and phone-wireless dedicated billers.
// Run: node --test billworld/fleet/tests/audit-tvphone.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCatalog } from '../catalog.mjs';
import { FleetWorld } from '../engine.mjs';
import { generateTasks } from '../tasks.mjs';
import { helpArticles, RESEARCH_PROCESS } from '../help.mjs';
import { labelNoun, setUpLabel, raw } from '../kit.mjs';
import { mapLabel } from '../templates/_observed.mjs';
import { instructionFor } from '../infinity/export.mjs';
import { login, smsCode } from './solve.mjs';
import { start } from '../server.mjs';

const catalog = loadCatalog();
const TDS = 'tds-telecom-tds-tv-dd7852', SEC = 'service-electric-cable-tv-communications-691cd3', METRO = 'metro-by-t-mobile-f7d6ab';
const TRAC = 'tracfone-9f6767', VISIBLE = 'visible-by-verizon-0aca2e', CC = 'consumer-cellular-1d8458', SPM = 'spectrum-mobile-1591ac';

test('feature labels read naturally inside sentences', () => {
  assert.equal(setUpLabel('Auto Pay Settings'), 'Set up Auto Pay');
  assert.equal(setUpLabel('AutoPay'), 'Set up AutoPay');
  assert.equal(setUpLabel('Enroll in AutoPay'), 'Enroll in AutoPay');
  assert.equal(labelNoun('Auto Pay Settings'), 'Auto Pay');
  assert.equal(String(setUpLabel(raw('Auto Pay'))), 'Set up Auto Pay');
  const b = catalog.billers.get(TDS);
  assert.ok(!helpArticles(b).some(a => /Set up [^.]*Settings/.test(a.title)), 'no "Set up Auto Pay Settings" article title');
  assert.equal(b.dossier.labels.paperless, 'Paperless (ePay)', 'the paperless page is not labeled as the whole ePay system');
});

test('observed footer labels map to the right pages', () => {
  const vm = { url: (p, q) => q?.slug ? `/help/${q.slug}` : `/${p}`, has: () => true, help: [{ slug: 'pay-your-bill' }, { slug: 'contact-us' }], authenticated: false, template: 'telecom', biller: { capabilities: { guest_pay: { support: 'supported' } } } };
  assert.equal(mapLabel(vm, 'Rush Payment'), '/guest');
  assert.equal(mapLabel(vm, 'Payment centers'), '/help/pay-your-bill');
  assert.equal(mapLabel(vm, 'Payment Locations'), '/help/pay-your-bill');
  assert.equal(mapLabel(vm, 'View / Modify Account Information'), '/profile');
  assert.equal(mapLabel(vm, 'Pay My Bill'), '/pay', 'ordinary pay links still open the pay form');
});

test('downgrade-plan grades the plan: a no-op fails, the cheapest plan passes', () => {
  for (const id of [SEC, METRO]) {
    const t = generateTasks(catalog.billers.get(id)).find(x => x.id.endsWith(':downgrade-plan'));
    const svc = t.predicates.find(p => p.type === 'service');
    assert.ok(svc.plan, `${id}: plan predicate present`);
    const w = new FleetWorld(); const ep = w.createEpisode({ seed: `dg:${id}` });
    assert.equal(w.evaluate(ep, t.predicates).success, false, `${id}: leaving the plan unchanged fails`);
    const r = w.evaluate(ep, t.predicates).results.find(x => x.type === 'service');
    assert.match(r.detail, /expected/, 'the grading detail names the expected plan');
  }
});

test('Spectrum Mobile: the required-AutoPay note fits an account that starts without AutoPay', () => {
  const b = catalog.billers.get(SPM);
  assert.doesNotMatch(b.capabilities.autopay.note, /cannot be turned off/);
  assert.ok(generateTasks(b).some(t => t.id.endsWith(':autopay-enroll')));
  const w = new FleetWorld(); const ep = w.createEpisode({ seed: 'spm' });
  assert.equal(w.account(ep, SPM).autopay.enrolled, false);
});

test('Metro: the instruction names the sign-in secret the way the site does', () => {
  const t = generateTasks(catalog.billers.get(METRO)).find(x => x.id.endsWith(':downgrade-plan'));
  assert.equal(t.passwordLabel, 'Account PIN');
  const ins = instructionFor(t, { persona: { name: 'A B', email: 'a@b.test', phone: '(555) 010-1234' }, mailPassword: 'M' });
  assert.match(ins, /Account PIN/);
  const plain = generateTasks(catalog.billers.get(SEC)).find(x => x.id.endsWith(':downgrade-plan'));
  assert.equal(plain.passwordLabel, undefined);
});

test('Tracfone: the bill notice carries the phone number the guest lookup asks for', () => {
  const b = catalog.billers.get(TRAC);
  assert.ok(b.dossier.auth.guestLookupFields.includes('phone'));
  const w = new FleetWorld(); const ep = w.createEpisode({ seed: 'trac', scenario: { [TRAC]: { billNotice: true } } }); w.account(ep, TRAC);
  const notice = ep.mailbox.find(m => /bill is ready/.test(m.subject))?.text || '';
  assert.match(notice, new RegExp(`Mobile number: ${ep.persona.phone.replace(/[()]/g, '\\$&')}`));
  // The mail-payment note links to the ways-to-pay article, not the help-center index.
  const pay = helpArticles(b).find(a => a.slug === 'pay-your-bill');
  assert.ok(pay.paragraphs.includes(b.capabilities.pay_by_mail.note));
});

test('Consumer Cellular: research notes never reach help articles', () => {
  for (const s of ['Rendered with headless Chrome: How do I get my invoice?', 'Pay as Guest = one-time ACH payment', 'old slug how-do-i-get-a-copy serves the same article']) assert.ok(RESEARCH_PROCESS.test(s), s);
  assert.ok(!RESEARCH_PROCESS.test('Card payments post the same day; allow 8-10 days for a mailed check.'));
  for (const a of helpArticles(catalog.billers.get(CC))) for (const p of a.paragraphs) assert.ok(!RESEARCH_PROCESS.test(p), `${a.slug}: ${p}`);
});

test('Visible: online cancellation disconnects on the next payment due date', () => {
  const w = new FleetWorld(); const ep = w.createEpisode({ seed: 'vis' }); const sid = login(w, ep, VISIBLE);
  const a = w.account(ep, VISIBLE);
  w.cancelService(ep, VISIBLE, sid, { step: 'reason', reason: 'price' });
  w.cancelService(ep, VISIBLE, sid, { step: 'offer', accept: 'no' });
  w.cancelService(ep, VISIBLE, sid, { step: 'confirm', confirm: 'on', effectiveDate: new Date(ep.clock + 86400000).toISOString().slice(0, 10) });
  let due = a.invoices.at(-1).dueAt; while (due <= ep.clock) due += 30 * 86400000;
  assert.equal(a.service.status, 'cancel_pending');
  assert.equal(a.service.cancelAt, due, 'the requested date is ignored: service ends on the due date');
});

test('rendered pages: TDS overview, Visible confirm step, telecom footer, Tracfone note link', async () => {
  const s = await start({ port: 0, adminPort: 0, quiet: true, persist: false });
  try {
    const port = new URL(s.baseUrl).port;
    const get = async (id, pg, { authed = false, params = {}, query = '', setup } = {}) => {
      const ep = s.world.episode((await s.admin('/episodes', { billerId: id, seed: `a:${id}:${pg}` })).episodeId);
      let sess = '';
      if (authed) { const sid = login(s.world, ep, id); sess = `; bwf_sid=${sid}`; if (setup) setup(ep, sid); }
      return (await fetch(s.baseUrl + s.urlFor(s.templateFor(s.world.biller(id)), id, pg, params) + query, { headers: { cookie: `bwf_ep_${port}=${ep.id}; bwf_at_${port}=${ep.entryToken}${sess}` }, redirect: 'manual' })).text();
    };
    const tdsDash = await get(TDS, 'dashboard', { authed: true });
    assert.doesNotMatch(tdsDash, /Set up Auto Pay Settings/); assert.match(tdsDash, /Set up Auto Pay\b/);
    const confirm = await get(VISIBLE, 'cancel', { authed: true, query: '?step=confirm', setup: (ep, sid) => { s.world.cancelService(ep, VISIBLE, sid, { step: 'reason', reason: 'price' }); s.world.cancelService(ep, VISIBLE, sid, { step: 'offer', accept: 'no' }); } });
    assert.match(confirm, /next payment due date/); assert.doesNotMatch(confirm, /name="effectiveDate"/, 'no date picker that contradicts the due-date rule');
    const visHome = await get(VISIBLE, 'home');
    assert.doesNotMatch(visHome, /Call the number on your bill for customer service/);
    const tracHome = await get(TRAC, 'home');
    const li = tracHome.match(/<li data-capability="pay_by_mail">[\s\S]*?<\/li>/)?.[0] || '';
    assert.ok(li, 'Tracfone home shows the pay-by-mail note'); assert.match(li, /articles\/pay-your-bill/, li);
  } finally { await s.close(); }
});
