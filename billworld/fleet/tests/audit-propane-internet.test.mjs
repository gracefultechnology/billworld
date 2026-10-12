// Regressions from the blind-agent audit of the propane-heating-oil and internet dedicated billers.
// Run: node --test billworld/fleet/tests/audit-propane-internet.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCatalog } from '../catalog.mjs';
import { FleetWorld, plansFor, defaultPlan, lowCapacityIsp, retentionOfferFor } from '../engine.mjs';
import { generateTasks } from '../tasks.mjs';
import { addBusinessDays, earliestStopDate } from '../kit.mjs';
import { login, cancelService } from './solve.mjs';
import { start } from '../server.mjs';

const catalog = loadCatalog();
const BLOSSMAN = 'blossman-gas-a01c99', SUPERIOR = 'superior-plus-propane-0ca7f2', PINNACLE = 'pinnacle-propane-0eed17', BLUERIDGE = 'blue-ridge-energy-propane-fuels-6741e2';
const IRVING = 'irving-energy-us-home-heating-18d2af', SHARP = 'sharp-energy-b8d482', MEDIACOM = 'mediacom-mediacom-xtream-eaace5';
const HUGHES = 'hughesnet-hughes-satellite-internet-5db325', STARLINK = 'starlink-spacex-satellite-internet-6f2c0a';

test('seeded scheduled payments use the biller monogram, like its posted payments', () => {
  for (const id of [PINNACLE, BLUERIDGE, MEDIACOM]) {
    const w = new FleetWorld(); const ep = w.createEpisode({ seed: `sp:${id}`, scenario: { [id]: { scheduledPayment: true } } });
    const a = w.account(ep, id); const mono = w.biller(id).brand.monogram;
    const sched = a.payments.find(p => p.status === 'scheduled');
    assert.ok(sched, `${id}: a seeded scheduled payment`);
    assert.ok(sched.confirmation.startsWith(mono) && /^\d{9}$/.test(sched.confirmation.slice(mono.length)), `${id}: ${sched.confirmation} starts with ${mono}`);
  }
});

test('stop-service dates honour the 3-business-day notice', () => {
  assert.equal(addBusinessDays('2026-10-03', 3), '2026-10-07'); // Saturday + 3 business days
  assert.equal(addBusinessDays('2026-10-05', 3), '2026-10-08');
  const vm = { biller: catalog.billers.get(IRVING), today: '2026-10-03' };
  assert.equal(earliestStopDate(vm), '2026-10-07');
  const w = new FleetWorld(); const ep = w.createEpisode({ seed: 'irv' }); const sid = login(w, ep, IRVING);
  w.cancelService(ep, IRVING, sid, { step: 'reason', reason: 'moving' });
  const today = new Date(ep.clock).toISOString().slice(0, 10);
  assert.throws(() => w.cancelService(ep, IRVING, sid, { step: 'confirm', confirm: true, effectiveDate: today }), 'a same-day stop is refused');
});

test('a seeded AutoPay enrollment on a fixed-draft-day biller has the first dossier day', () => {
  const w = new FleetWorld(); const ep = w.createEpisode({ seed: 'sharp', scenario: { [SHARP]: { autopay: true } } });
  assert.equal(w.account(ep, SHARP).autopay.day, 5);
  const ep2 = w.createEpisode({ seed: 'med', scenario: { [MEDIACOM]: { autopay: true } } });
  assert.equal(w.account(ep2, MEDIACOM).autopay.day, null, "Mediacom drafts on the due date ('due_date'), not a fixed day");
});

test('satellite internet plans: real Hughesnet tiers, no gigabit family plans on satellite', () => {
  const hn = catalog.billers.get(HUGHES);
  assert.deepEqual(plansFor(hn).map(p => p[1]), ['Hughesnet Lite', 'Hughesnet Select', 'Hughesnet Elite', 'Hughesnet Fusion']);
  assert.equal(defaultPlan(hn), 'select');
  const t = generateTasks(hn).find(x => x.id.endsWith(':downgrade-plan'));
  assert.equal(t.predicates.find(p => p.type === 'service').plan, 'lite');
  // Family-tier satellite / fixed-wireless ISPs: capacity-appropriate plans, not "Gigabit".
  const sats = [...catalog.billers.values()].filter(b => !b.dossier && lowCapacityIsp(b));
  assert.ok(sats.length > 0, 'some family-tier satellite/fixed-wireless ISPs exist');
  for (const b of sats) { assert.ok(!plansFor(b).some(p => /gig/i.test(p[1])), b.id); assert.equal(defaultPlan(b), 'plus'); }
  assert.ok(!lowCapacityIsp(catalog.billers.get('xfinity-comcast-internet-6edfd9')), 'cable ISPs keep the regular plans');
});

test('Starlink: no retention offer, no accept-retention task, cancel goes reason -> confirm', () => {
  const sl = catalog.billers.get(STARLINK);
  assert.equal(retentionOfferFor(sl), false);
  assert.equal(retentionOfferFor(catalog.billers.get(MEDIACOM)), true, 'other telecom billers keep the offer');
  const ids = generateTasks(sl).map(t => t.id);
  assert.ok(ids.some(i => i.endsWith(':cancel-service')) && !ids.some(i => i.endsWith(':accept-retention')));
  assert.doesNotMatch(generateTasks(sl).find(t => t.id.endsWith(':cancel-service')).intent, /retention/);
  const w = new FleetWorld(); const ep = w.createEpisode({ seed: 'sl' }); const sid = login(w, ep, STARLINK);
  assert.equal(w.cancelService(ep, STARLINK, sid, { step: 'reason', reason: 'moving' }).next, 'confirm');
  assert.throws(() => w.cancelService(ep, STARLINK, sid, { step: 'offer', accept: 'yes' }), e => e.code === 'no_offer');
  const ep2 = w.createEpisode({ seed: 'sl2' }); cancelService(w, ep2, STARLINK, login(w, ep2, STARLINK));
  assert.equal(w.account(ep2, STARLINK).service.status, 'cancel_pending');
  const help = sl.dossier.help.find(h => h.slug === 'cancel-service');
  assert.ok(sl.dossier.nav.account.some(n => n.label === 'Your Subscription' && n.page === 'plan'), 'Your Subscription nav, as the help steps say');
  assert.ok(help.steps.some(s => /Your Subscription/.test(s)));
});

test('rendered pages: method toggle, formatted pay date, draft-day preselect, stop date min, Starlink cancel/overview', async () => {
  const s = await start({ port: 0, adminPort: 0, quiet: true, persist: false });
  try {
    const port = new URL(s.baseUrl).port;
    const get = async (id, pg, { scenario, query = '', setup } = {}) => {
      const ep = s.world.episode((await s.admin('/episodes', { billerId: id, seed: `apr:${id}:${pg}`, ...(scenario ? { scenario: { [id]: scenario } } : {}) })).episodeId);
      const sid = login(s.world, ep, id); if (setup) setup(ep, sid);
      return (await fetch(s.baseUrl + s.urlFor(s.templateFor(s.world.biller(id)), id, pg, {}) + query, { headers: { cookie: `bwf_ep_${port}=${ep.id}; bwf_at_${port}=${ep.entryToken}; bwf_sid=${sid}` }, redirect: 'manual' })).text();
    };
    // Blossman: choosing a method type hides the other type's fields (CSS :has rule, nonce'd style).
    const wallet = await get(BLOSSMAN, 'wallet');
    assert.match(wallet, /<div class="bank-fields">/); assert.match(wallet, /<div class="card-fields">/);
    assert.match(wallet, /<style nonce="[^"]+">[^<]*option\[value=bank\]:checked\)>\.card-fields/);
    // Superior Plus: the scheduled date is formatted on the method and review steps.
    const sched = (ep, sid) => s.world.draftPayment(ep, SUPERIOR, sid, { amountChoice: 'due', payOn: '2026-10-15' });
    const method = await get(SUPERIOR, 'payMethod', { setup: sched });
    assert.match(method, /Payment date <strong>Oct 15, 2026<\/strong>/); assert.doesNotMatch(method, /2026-10-15<\/strong>/);
    const review = await get(SUPERIOR, 'payReview', { setup: (ep, sid) => { const d = sched(ep, sid); s.world.draftPayment(ep, SUPERIOR, sid, { token: d.token, methodId: 'pm-chk' }); } });
    assert.match(review, /<dt>Payment date<\/dt><dd>Oct 15, 2026<\/dd>/);
    // Sharp Energy: the draft-day select shows the enrolled day.
    const ap = await get(SHARP, 'autopay', { scenario: { autopay: true } });
    assert.match(ap, /day 5 of each month/); assert.match(ap, /<option value="5" selected>/);
    // Irving: the stop date defaults to, and cannot precede, 3 business days out.
    const stop = await get(IRVING, 'cancel', { query: '?step=confirm', setup: (ep, sid) => s.world.cancelService(ep, IRVING, sid, { step: 'reason', reason: 'moving' }) });
    const input = stop.match(/<input[^>]*name="effectiveDate"[^>]*>/)?.[0] || '';
    const min = input.match(/min="([^"]+)"/)?.[1]; assert.ok(min, input);
    assert.ok(input.includes(`value="${min}"`), 'the default is the earliest allowed date');
    // Starlink: no Offers step, no equipment-return copy, no payment-arrangement link.
    const slConfirm = await get(STARLINK, 'cancel', { query: '?step=confirm', setup: (ep, sid) => s.world.cancelService(ep, STARLINK, sid, { step: 'reason', reason: 'moving' }) });
    assert.doesNotMatch(slConfirm, />Offers</); assert.doesNotMatch(slConfirm, /gateways|Equipment return/);
    const slDash = await get(STARLINK, 'dashboard');
    assert.ok(!slDash.includes('/billing/payment-arrangement"'), 'no payment-arrangement link'); assert.ok(slDash.includes('>Your Subscription<'));
    const FAMILY = 'teleguam-holdings-llc-f884fa'; // family-tier telecom ISP: the offer and the equipment copy stay
    const mcConfirm = await get(FAMILY, 'cancel', { query: '?step=confirm', setup: (ep, sid) => { s.world.cancelService(ep, FAMILY, sid, { step: 'reason', reason: 'moving' }); s.world.cancelService(ep, FAMILY, sid, { step: 'offer', accept: 'no' }); } });
    assert.match(mcConfirm, />Offers</); assert.match(mcConfirm, /Equipment return/);
    const hnPlan = await get(HUGHES, 'plan');
    assert.match(hnPlan, /Hughesnet Fusion/); assert.doesNotMatch(hnPlan, /Gigabit/);
  } finally { await s.close(); }
});
