// Regressions from the blind-agent audit of water-sewer + trash (2026-10-11).
// Run: node --test billworld/fleet/tests/audit-water-trash.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { start, templateFor } from '../server.mjs';
import { Client } from './httpflows.mjs';
import { login, billNotice, latestMail } from './solve.mjs';
import { generateTasks } from '../tasks.mjs';
import { contactInfo, displayParent } from '../catalog.mjs';
import { CAPITALS, cityIn } from '../places.mjs';

const SCWA = 'suffolk-county-water-authority-scwa-dacc59', EBMUD = 'east-bay-municipal-utility-district-ebmud-03de72';
const CHICAGO = 'city-of-chicago-department-of-finance-utility-bi-bc14cc', LADWP = 'los-angeles-department-of-water-and-power-ladwp-290b02';
const JEA = 'jea-62e687', NYC = 'nyc-department-of-environmental-protection-nyc-w-0b3b06', BALTIMORE = 'baltimore-city-department-of-public-works-water--dd688d';
const CITIZENS = 'citizens-energy-group-citizens-water-indianapoli-0c16d7', CLEVELAND = 'cleveland-water-city-of-cleveland-division-of-wa-a71bb6';
const MERIDIAN = 'meridian-waste-solutions-b62611', TDS = 'texas-disposal-systems-4baf18', BURRTEC = 'burrtec-waste-industries-9d6d9a';
const RECOLOGY = 'recology-788ad4', ATHENS = 'athens-services-cfbc97', DENVER = 'denver-solid-waste-management-denver-utilities-o-ee0ab4';
const RUMPKE = 'rumpke-waste-recycling-6d01d9', GFL = 'gfl-environmental-c86e5f', MIAMI = 'miami-dade-county-department-of-solid-waste-mana-355515';

let server, world, agent;
before(async () => { server = await start({ port: 0, adminPort: 0, quiet: true }); world = server.world; agent = new http.Agent({ keepAlive: true }); });
after(async () => { agent.destroy(); await server.close(); });

const text = html => html.replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/\s+/g, ' ');
async function pages(id, list, { signedIn = false, scenario = {} } = {}) {
  const ep = world.createEpisode({ seed: `audit-wt-${id}`, kind: 'sweep', scenario: { [id]: scenario } });
  const c = new Client(server.baseUrl, agent); c.cookies.set('bwf_ep', ep.id); c.cookies.set('bwf_at', ep.entryToken);
  if (signedIn) c.cookies.set('bwf_sid', login(world, ep, id));
  const out = {};
  for (const pg of list) { const r = await c.get(server.urlFor(templateFor(world.biller(id)), id, pg)); assert.equal(r.status, 200, `${id} ${pg}`); out[pg] = r.body; }
  return { ...out, ep, c };
}
const task = (id, slug) => generateTasks(world.biller(id)).find(t => t.id === `${id}:${slug}`);

test('service area: EPA SDWIS / population research suffixes never reach customer text', async () => {
  assert.equal(contactInfo({ service_area: ['IL'], service_area_detail: 'Chicago, IL - EPA SDWIS PWSID IL0316000, population served 2,721,308' }).serviceArea, 'Chicago, IL');
  assert.equal(contactInfo({ service_area: ['FL'], service_area_detail: 'Jacksonville, FL | EPA SDWIS PWSID FL2161328; population served ~826,664' }).serviceArea, 'Jacksonville, FL');
  assert.equal(contactInfo({ service_area: ['CA'], service_area_detail: 'Population 218,455 (Census 2024 estimate)' }).serviceArea, 'CA');
  let leaks = 0; for (const b of world.catalog.billers.values()) if (/SDWIS|PWSID|population served/i.test(b.contact?.serviceArea || '')) leaks++;
  assert.equal(leaks, 0, 'no biller shows SDWIS/PWSID/population in its service area');
  for (const [id, pg] of [[CHICAGO, 'home'], [CLEVELAND, 'home'], [CITIZENS, 'home']]) {
    const t = text((await pages(id, [pg]))[pg]);
    assert.doesNotMatch(t, /SDWIS|PWSID|population served/i, `${id} ${pg}`);
  }
});

test('service address: a city the biller serves with that city\'s own ZIP (not the state capital with a random ZIP)', () => {
  const want = { [SCWA]: ['Hauppauge', /^11788$/], [EBMUD]: ['Oakland', /^946\d\d$/], [CHICAGO]: ['Chicago', /^606\d\d$/], [LADWP]: ['Los Angeles', /^900\d\d$/], [JEA]: ['Jacksonville', /^322\d\d$/],
    [NYC]: ['New York', /^100\d\d$/], [BALTIMORE]: ['Baltimore', /^212\d\d$/], [CITIZENS]: ['Indianapolis', /^462\d\d$/], [CLEVELAND]: ['Cleveland', /^441\d\d$/], [TDS]: ['Austin', /^787\d\d$/],
    [RECOLOGY]: ['San Francisco', /^941\d\d$/], [MIAMI]: ['Miami', /^331\d\d$/], [DENVER]: ['Denver', /^802\d\d$/], [RUMPKE]: ['Cincinnati', /^452\d\d$/] };
  for (const [id, [city, zip]] of Object.entries(want)) {
    for (const seed of ['a', 'b', 'c']) {
      const ep = world.createEpisode({ seed: `addr-${seed}` }); const a = world.account(ep, id);
      assert.equal(a.serviceCity, city, `${id} city`); assert.match(a.zip, zip, `${id} ZIP ${a.zip}`);
      assert.ok(a.serviceAddress.endsWith(`${city}, ${a.serviceState} ${a.zip}`), a.serviceAddress);
    }
  }
  // State fallback: every capital ZIP range is five digits and ordered; city patterns stay inside their state.
  for (const [st, [city, lo, hi]] of Object.entries(CAPITALS)) { assert.ok(city && lo <= hi && hi < 100000, st); }
  assert.equal(cityIn('AL', ['Cleveland, AL']), null, 'Cleveland, OH never matches an Alabama biller');
  assert.equal(cityIn('OH', ['Cleveland, OH']).city, 'Cleveland');
});

test('footers: parent-company research notes and repeats of the biller name are not shown', async () => {
  assert.equal(displayParent('Meridian Waste Solutions (Warburg Pincus-backed)', 'Meridian Waste Solutions'), null);
  assert.equal(displayParent('Citizens Energy Group (public charitable trust)', 'Citizens Energy Group - Citizens Water (Indianapolis)'), null);
  assert.equal(displayParent('Recology Inc. (employee-owned)', 'Recology'), 'Recology Inc.');
  assert.equal(displayParent('Member-owned cooperative', 'Some Electric'), null);
  assert.equal(displayParent('City of Baltimore', 'Baltimore City DPW'), 'City of Baltimore');
  for (const id of [MERIDIAN, BURRTEC, RECOLOGY, ATHENS, RUMPKE, CITIZENS]) {
    const t = text((await pages(id, ['home'])).home);
    assert.doesNotMatch(t, /Warburg|family-owned|employee-owned|Arakelian|charitable trust|-backed/i, id);
  }
  const cz = text((await pages(CITIZENS, ['home'])).home);
  assert.doesNotMatch(cz, /Citizens Energy Group · Citizens Energy Group/);
});

test('dedicated footers list only working links; cookie-banner leftovers are dropped', async () => {
  for (const id of [MERIDIAN, ATHENS, GFL]) {
    const h = (await pages(id, ['home'])).home;
    assert.doesNotMatch(h, /class="obs-plain"/, `${id}: unlinked footer labels`);
    assert.doesNotMatch(text(h), /SAVE & ACCEPT/i, id);
  }
});

test('page titles: doubled or cut-off captured titles are tidied; no orphan OR divider', async () => {
  const chi = await pages(CHICAGO, ['login']);
  assert.match(chi.login, /<title>City of Chicago Utility Payments<\/title>/);
  assert.doesNotMatch(chi.login, /class="or"/, 'no OR divider without another sign-in option');
  const eb = await pages(EBMUD, ['login']);
  assert.doesNotMatch(eb.login.match(/<title>([^<]*)<\/title>/)[1], /Login Ca\b/);
});

test('KUBRA one-time payment label reads "One-Time"', async () => {
  for (const id of [SCWA, RUMPKE]) { const t = text((await pages(id, ['home'])).home); assert.doesNotMatch(t, /OneTime/, id); assert.match(t, /One-Time Payment/, id); }
});

test('Rumpke avoid-convenience-fee needs both halves: the fee and auto-pay', () => {
  const t = task(RUMPKE, 'avoid-convenience-fee'); assert.ok(t);
  const run = answer => { const ep = world.createEpisode({ seed: `rumpke-${answer.length}` }); world.account(ep, RUMPKE); world.submitAnswer(ep, answer); return world.evaluate(ep, t.predicates).success; };
  assert.equal(run('The fee is $2.95.'), false);
  assert.equal(run('Enroll in auto-pay.'), false);
  assert.equal(run('It is $2.95; enroll in auto-pay to avoid it.'), true);
  assert.equal(run('$2.95 per payment, avoided with AutoPay'), true);
});

test('setup-payment-plan seeds a past-due balance the plan rules cover (e.g. Baltimore PromisePay $250+ past due)', () => {
  const t = task(BALTIMORE, 'setup-payment-plan'); assert.ok(t);
  const ep = world.createEpisode({ seed: 'plan-bal', scenario: t.scenario }); const a = world.account(ep, BALTIMORE);
  const pastDue = a.invoices.filter(i => i.status === 'past_due').reduce((s, i) => s + i.balanceCents, 0);
  assert.ok(pastDue >= 25000, `past due ${pastDue}`);
});

test('declined card: the method step comes back with the amount kept', async () => {
  const id = NYC; const t = templateFor(world.biller(id));
  if (t.flow.paySteps.length < 3) return; // single-page checkout: nothing to skip
  const { c, ep } = await pages(id, ['dashboard'], { signedIn: true, scenario: { declineSavedCard: true } });
  const sid = c.cookies.get('bwf_sid');
  world.draftPayment(ep, id, sid, { amountChoice: 'due' });
  const d = world.draftPayment(ep, id, sid, { methodId: 'pm-card' });
  const form = await c.get(server.urlFor(t, id, 'payReview'));
  const csrf = form.body.match(/name="_csrf" value="([^"]+)"/)[1];
  const r = await c.post(server.urlFor(t, id, 'payReview'), new URLSearchParams({ _csrf: csrf, token: d.token, acceptTerms: 'on' }).toString());
  assert.match(text(r.body), /declined/i);
  assert.ok(r.body.includes(`action="${server.urlFor(t, id, t.flow.paySteps[1])}`), 'the method step form is shown');
  assert.ok(world.account(ep, id).draft.amountCents > 0, 'amount kept');
});

test('TDS registration asks for the access code printed on the bill', async () => {
  const ep = world.createEpisode({ seed: 'tds-reg', scenario: { [TDS]: { registered: false } } }); const a = world.account(ep, TDS);
  assert.match(a.accessCode, /^[A-Z2-9]{8}$/);
  const n = billNotice(ep, TDS); assert.equal(n.accessCode, a.accessCode);
  const base = { accountNumber: a.accountNumber, email: ep.persona.email, password: 'Fresh-Start-2026!', confirm: 'Fresh-Start-2026!' };
  assert.throws(() => world.register(ep, TDS, base), e => e.code === 'missing' && /access code/.test(e.message));
  assert.throws(() => world.register(ep, TDS, { ...base, accessCode: 'WRONG123' }), e => e.code === 'no_match');
  assert.ok(world.register(ep, TDS, { ...base, accessCode: a.accessCode.toLowerCase() }).ok);
  const reg = text((await pages(TDS, ['register'], { scenario: { registered: false } })).register);
  assert.match(reg, /Access code/);
  // Billers that do not ask for one get none.
  const ep2 = world.createEpisode({ seed: 'no-code' }); assert.equal(world.account(ep2, RECOLOGY).accessCode, undefined);
});

test('Recology: the bill notice names the statement number the guest form asks for', async () => {
  const ep = world.createEpisode({ seed: 'rec-guest', scenario: { [RECOLOGY]: { registered: false } } }); world.account(ep, RECOLOGY);
  const mail = latestMail(ep, RECOLOGY, /bill is ready/);
  assert.match(mail.text, /Statement number: \d+/);
  assert.doesNotMatch(mail.text, /Bill number:/);
  const g = text((await pages(RECOLOGY, ['guest'], { scenario: { registered: false } })).guest);
  assert.match(g, /Statement number/);
  const h = (await pages(RECOLOGY, ['home'])).home;
  assert.ok(!/href="[^"]*\/pay-bill"[^>]*>Pay My Bill</.test(h), 'the guest-pay entry is not also called "Pay My Bill" (that label signs in)');
});

test('Denver: payment methods are reachable from the dashboard; Miami-Dade sign-up copy skips features it lacks', async () => {
  const d = await pages(DENVER, ['dashboard'], { signedIn: true });
  assert.ok(d.dashboard.includes(`href="${server.urlFor(templateFor(world.biller(DENVER)), DENVER, 'wallet')}"`));
  const m = text((await pages(MIAMI, ['home'])).home);
  const b = world.biller(MIAMI).capabilities;
  if (b.paperless.support !== 'supported') assert.doesNotMatch(m, /Create an account[^.]*e-Billing/);
  if (b.autopay.support !== 'supported') assert.doesNotMatch(m, /Create an account[^.]*autopay/i);
});
