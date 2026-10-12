// Regressions from the blind-agent audit of phone-landline + streaming-subscriptions (2026-10-11).
// Run: node --test billworld/fleet/tests/audit-phone-streaming.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { start, templateFor } from '../server.mjs';
import { Client, parseForms } from './httpflows.mjs';
import { login } from './solve.mjs';
import { generateTasks, autopayPeriod } from '../tasks.mjs';
import { noticeLabel, noticeAccountNumber } from '../engine.mjs';

const RITTER = 'ritter-communications-672fe2', YTTV = 'youtube-tv-270942', DOORDASH = 'doordash-dashpass-aa2f3d';
const AARP = 'aarp-membership-includes-aarp-the-magazine-aarp--a8f439', PHILO = 'philo-b47d10', INSTACART = 'instacart-membership-e24ce2';
let server, world, agent;
before(async () => { server = await start({ port: 0, adminPort: 0, quiet: true }); world = server.world; agent = new http.Agent({ keepAlive: true }); });
after(async () => { agent.destroy(); await server.close(); });

const text = html => html.replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
async function pages(id, list, { signedIn = true, scenario = {} } = {}) {
  const ep = world.createEpisode({ seed: `audit-ps-${id}`, kind: 'sweep', scenario: { [id]: scenario } });
  const c = new Client(server.baseUrl, agent); c.cookies.set('bwf_ep', ep.id); c.cookies.set('bwf_at', ep.entryToken);
  if (signedIn) c.cookies.set('bwf_sid', login(world, ep, id));
  const out = {};
  for (const pg of list) { const r = await c.get(server.urlFor(templateFor(world.biller(id)), id, pg)); assert.equal(r.status, 200, `${id} ${pg}`); out[pg] = r.body; }
  world.episodes.delete(ep.id); return { ...out, ep };
}
const task = (id, slug) => generateTasks(world.biller(id)).find(t => t.id === `${id}:${slug}`);
const grade = (ep, t) => world.evaluate(ep, t.predicates);

test('downgrade-plan grades the plan itself: a no-op, a wrong plan and the cheapest plan', () => {
  for (const id of [RITTER, YTTV]) {
    const t = task(id, 'downgrade-plan'); assert.ok(t, `${id} has downgrade-plan`);
    const cheapest = t.predicates.find(p => p.type === 'service').plan;
    assert.ok(t.predicates.some(p => p.type === 'event' && p.event === 'plan_changed' && p.match?.to === cheapest));
    const noop = world.createEpisode({ seed: `noop-${id}` }); world.account(noop, id);
    const r = grade(noop, t); assert.equal(r.success, false, `${id}: no-op must fail`);
    assert.match(r.results.find(p => p.type === 'service').detail, new RegExp(`expected ${cheapest}`));
    const plans = world.plans(world.account(noop, id));
    const other = plans.find(p => p.id !== cheapest && !p.current);
    if (other) { const ep = world.createEpisode({ seed: `wrong-${id}` }); const sid = login(world, ep, id); world.changePlan(ep, id, sid, { planId: other.id }); assert.equal(grade(ep, t).success, false, `${id}: a non-cheapest plan must fail`); }
    const ep = world.createEpisode({ seed: `right-${id}` }); const sid = login(world, ep, id); world.changePlan(ep, id, sid, { planId: cheapest });
    assert.equal(grade(ep, t).success, true, `${id}: cheapest plan passes`);
  }
});

test('autopay-enroll intent follows the billing cadence', () => {
  assert.equal(autopayPeriod(world.biller(INSTACART)), 'each year');
  assert.match(task(INSTACART, 'autopay-enroll').intent, /full balance each year\./);
  assert.match(task(AARP, 'autopay-enroll').intent, /each year\./);
  const monthlySub = [...world.catalog.billers.values()].find(b => b.kind === 'subscription' && !b.dossier && b.template === 'streaming');
  assert.equal(autopayPeriod(monthlySub), 'at each renewal');
  const utility = [...world.catalog.billers.values()].find(b => b.kind === 'utility' && b.template !== 'offline');
  assert.equal(autopayPeriod(utility), 'each month');
});

test('streaming quick links follow the dossier policies (DoorDash DashPass)', async () => {
  const { dashboard, bill, paperless } = await pages(DOORDASH, ['dashboard', 'bill', 'paperless']);
  const d = text(dashboard);
  assert.doesNotMatch(d, /Paper statements by mail|Split a payment|installments/);
  assert.match(d, /Automatic payments Always on/);
  assert.doesNotMatch(text(bill), /Need more time to pay|installments/);
  const p = text(paperless);
  assert.doesNotMatch(p, /You currently receive paper statements/); assert.match(p, /does not mail (?:paper statements|bills)/); // the dossier note says it once (no second template sentence)
  assert.equal(parseForms(paperless).filter(f => f.method === 'post' && f.has('paperless')).length, 0);
  // A family-tier subscription biller (all policies supported) keeps every link.
  const fam = [...world.catalog.billers.values()].find(b => b.template === 'streaming' && !b.dossier && b.capabilities.payment_arrangement.support === 'supported' && b.capabilities.paperless.support === 'supported');
  const f = text((await pages(fam.id, ['dashboard'])).dashboard);
  assert.match(f, /Split a payment/); assert.match(f, /Paper statements by mail/); assert.match(f, /Change plan/);
});

test('AARP renewal without signing in: name + ZIP + date of birth, and the notice uses the membership number term', async () => {
  const { guest, ep } = await pages(AARP, ['guest'], { signedIn: false, scenario: { registered: false, billNotice: true } });
  const form = parseForms(guest).find(f => f.method === 'post' && f.has('zip'));
  assert.ok(form && form.has('lastName') && form.has('dob') && !form.has('accountNumber'), 'guest form asks for last name, ZIP and date of birth');
  assert.doesNotMatch(text(guest), /member number/i);
  const ep2 = world.createEpisode({ seed: 'aarp-guest', scenario: { [AARP]: { registered: false, billNotice: true } } });
  world.account(ep2, AARP);
  const notice = ep2.mailbox.find(m => /bill is ready/.test(m.subject));
  assert.match(notice.subject, /renewal bill is ready/);
  assert.equal(noticeLabel(world.biller(AARP)), 'Membership number (account number)');
  assert.equal(noticeAccountNumber(notice.text), world.account(ep2, AARP).accountNumber);
  const p = ep2.persona;
  assert.throws(() => world.guestLookup(ep2, AARP, { lastName: p.last, zip: p.zip, dob: '1900-01-01' }), e => e.code === 'no_match');
  assert.throws(() => world.guestLookup(ep2, AARP, { lastName: p.last, zip: p.zip }), e => e.code === 'no_match');
  assert.ok(world.guestLookup(ep2, AARP, { lastName: p.last, zip: p.zip, dob: p.dob }).sid);
  assert.deepEqual(task(AARP, 'guest-pay').personaFacts, ['dob']);
  world.episodes.delete(ep.id);
});

test('signup shows one password rule and the bill-notice identifier term (Philo, AARP)', async () => {
  for (const id of [PHILO, AARP]) {
    const { register, reset } = await pages(id, ['register', 'reset'], { signedIn: false });
    for (const [pg, html] of [['register', register], ['reset', reset]]) {
      const n = (text(html).match(/characters/g) || []).length; assert.equal(n, 1, `${id} ${pg}: exactly one password rule (${n})`);
    }
    const rule = world.biller(id).dossier.auth.passwordRule?.message;
    if (rule) assert.ok(text(register).includes(rule), `${id}: the dossier password rule is shown`);
    const word = noticeLabel(world.biller(id)).replace(/ \(account number\)$/, '');
    assert.ok(text(register).includes(word), `${id}: signup label "${word}" matches the bill notice`);
    assert.doesNotMatch(text(register), /Member number/);
  }
});

test('family downgrade-plan targets the cheapest family plan (incl. low-capacity ISP plans)', async () => {
  const { plansFor } = await import('../engine.mjs');
  for (const id of ['snowcloud-services-llc-237213']) {
    const b = world.biller(id); const t = task(id, 'downgrade-plan');
    const cheapest = plansFor(b).slice().sort((x, y) => x[2] - y[2])[0][0];
    assert.equal(t.predicates.find(p => p.type === 'service').plan, cheapest);
    const ep = world.createEpisode({ seed: `lowcap-${id}` }); world.changePlan(ep, id, login(world, ep, id), { planId: cheapest });
    assert.equal(grade(ep, t).success, true);
  }
});
