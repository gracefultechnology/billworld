// Regressions from the blind-agent audit of property-tax + government (2026-10-11).
// Run: node --test billworld/fleet/tests/audit-ptgov.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { start, templateFor } from '../server.mjs';
import { Client } from './httpflows.mjs';
import { login, billNotice } from './solve.mjs';
import { CAPITALS } from '../places.mjs';
import { taxDueDates } from '../engine.mjs';
import { labeledPhoneText } from '../help.mjs';

const BEXAR = 'bexar-county-tax-assessor-collector-ef7e3c', PHILLY = 'city-of-philadelphia-department-of-revenue-real--3cb945';
const BROWARD = 'broward-county-tax-collector-e02ab4', MIAMI = 'miami-dade-county-tax-collector-002f07', LA = 'los-angeles-county-treasurer-and-tax-collector-74bc17';
const ORANGE = 'orange-county-treasurer-tax-collector-8a181b', SANTA_CLARA = 'santa-clara-county-department-of-tax-and-collect-6fc7f5', MARICOPA = 'maricopa-county-treasurer-f2a159';
const NYC = 'nyc-department-of-finance-property-tax-9dabd3', OHIO = 'ohio-department-of-taxation-individual-and-schoo-542635', OKLAHOMA = 'oklahoma-tax-commission-individual-income-tax-ebe7bd';
const VIRGINIA = 'virginia-tax-virginia-department-of-taxation-ind-5851ea', SC = 'south-carolina-department-of-revenue-scdor-indiv-56a438', PA = 'pennsylvania-department-of-revenue-personal-inco-4d7129';
const DAY = 86400000;

let server, world, agent;
before(async () => { server = await start({ port: 0, adminPort: 0, quiet: true }); world = server.world; agent = new http.Agent({ keepAlive: true }); });
after(async () => { agent.destroy(); await server.close(); });

const text = html => html.replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/\s+/g, ' ');
async function pages(id, list, { signedIn = false, scenario = {}, seed = `audit-ptgov-${id}` } = {}) {
  const ep = world.createEpisode({ seed, kind: 'sweep', scenario: { [id]: scenario } });
  const c = new Client(server.baseUrl, agent); c.cookies.set('bwf_ep', ep.id); c.cookies.set('bwf_at', ep.entryToken);
  if (signedIn) c.cookies.set('bwf_sid', login(world, ep, id));
  const out = {};
  for (const pg of list) { const [page, slug] = pg.split(':'); const r = await c.get(server.urlFor(templateFor(world.biller(id)), id, page, slug ? { slug } : {})); assert.equal(r.status, 200, `${id} ${pg}`); out[pg] = text(r.body); }
  return { ...out, ep };
}

test('county billers: the service address is in the county, not a random city or the state capital', () => {
  const ep = world.createEpisode({ seed: 'audit-ptgov-loc' });
  const city = id => world.account(ep, id).serviceCity;
  assert.equal(city(BEXAR), 'San Antonio');
  assert.equal(city(PHILLY), 'Philadelphia');
  assert.equal(city(BROWARD), 'Fort Lauderdale');
  assert.equal(city(ORANGE), 'Santa Ana');
  assert.equal(city(SANTA_CLARA), 'San Jose');
  // No dedicated property-tax biller lands in its state capital unless the capital is in its county (Phoenix, Austin).
  for (const b of world.catalog.billers.values()) {
    if (!b.dossier || b.entry.bill_type !== 'property-tax') continue;
    const loc = world.serviceLocation(ep, b);
    if (CAPITALS[loc.state]?.[0] === loc.city) assert.ok(new RegExp(loc.city).test(`${b.contact?.serviceArea} ${b.entry.name}`), `${b.id} placed in the capital ${loc.city}`);
  }
});

test('tax bills are yearly: four yearly statements and three prior yearly payments, not monthly', () => {
  const ep = world.createEpisode({ seed: 'audit-ptgov-annual' });
  for (const id of [PHILLY, OHIO]) {
    const a = world.account(ep, id);
    assert.equal(a.invoices.length, 4, `${id} statements`);
    assert.ok(a.invoices.slice(1).every((inv, i) => Math.abs(inv.dueAt - a.invoices[i].dueAt - 365 * DAY) < DAY), `${id} statements a year apart`);
    assert.equal(a.payments.filter(p => p.status === 'posted').length, 3, `${id} prior payments`);
  }
});

test('property-tax calendar from the dossier: California two installments, Florida one annual bill with discounts', async () => {
  const ep = world.createEpisode({ seed: 'audit-ptgov-cal' });
  const iso = t => new Date(t).toISOString().slice(0, 10);
  const la = world.account(ep, LA);
  assert.deepEqual(la.installments.map(i => [i.label, iso(i.dueAt)]), [['First installment', '2026-12-10'], ['Second installment', '2027-04-10']]);
  assert.equal(la.invoices.at(-1).dueAt, la.installments[0].dueAt, 'the open bill is due on the first installment date');
  const mia = world.account(ep, MIAMI);
  assert.deepEqual(mia.installments.map(i => [i.label, iso(i.dueAt)]), [['Annual tax bill', '2027-03-31']]);
  assert.ok(!world.amountOptions(mia).some(o => o.key === 'installment'), 'a single annual bill has no separate installment amount');
  assert.deepEqual(world.account(ep, MARICOPA).installments.map(i => iso(i.dueAt)), ['2026-11-02', '2027-05-01']);
  assert.equal(world.account(ep, PHILLY).taxYear, 2027, 'Philadelphia Real Estate Tax is billed for the year it is due');
  // A scenario due date moves the whole calendar and keeps its gap.
  const ep2 = world.createEpisode({ seed: 'audit-ptgov-cal2', scenario: { [LA]: { dueInDays: 10 } } });
  const la2 = world.account(ep2, LA);
  assert.equal(la2.installments[0].dueAt, ep2.clock + 10 * DAY);
  assert.equal(la2.installments[1].dueAt - la2.installments[0].dueAt, la.installments[1].dueAt - la.installments[0].dueAt);
  // Never due within the first week.
  assert.ok(taxDueDates(world.biller(MIAMI), Date.parse('2027-03-28T16:00:00Z'))[0] > Date.parse('2027-04-01T00:00:00Z'));

  const m = await pages(MIAMI, ['home', 'dashboard'], { signedIn: true });
  assert.match(m.home, /Important dates .*4% in November, 3% in December/);
  assert.doesNotMatch(m.home, /first half|second half/i);
  assert.match(m.dashboard, /Due Mar 31, 2027/);
  assert.doesNotMatch(m.dashboard, /First half|Second half/);
  const b = await pages(BROWARD, ['home'], {});
  assert.match(b.home, /mailed by November 1/);
  assert.doesNotMatch(b.home, /first half|second half/i);
  const l = await pages(LA, ['home', 'pay'], { signedIn: true });
  assert.match(l.home, /delinquent after 5 p\.m\. on December 10/);
  assert.match(l.pay, /First installment \$/);
});

test('NYC property tax: no e-statements link where paperless is unsupported; autopay note names the real page', async () => {
  const p = await pages(NYC, ['dashboard', 'autopay'], { signedIn: true });
  assert.doesNotMatch(p.dashboard, /E-statements –/);
  assert.match(p.autopay, /open Autopay \(the Edit a Property page in NYCePay\)/);
});

test('income tax: scheduled payments are listed with Cancel on the Scheduled Payments page', async () => {
  const p = await pages(OKLAHOMA, ['dashboard', 'autopay'], { signedIn: true, scenario: { scheduledPayment: true } });
  assert.doesNotMatch(p.dashboard, /Scheduled payments:? None/i);
  assert.match(p.autopay, /Cancel/);
  const acct = p.ep.accounts[OKLAHOMA]; const sched = acct.payments.find(x => x.status === 'scheduled');
  assert.ok(sched && p.autopay.includes(sched.confirmation), 'the scheduled payment is listed');
});

test('income tax: bill line, bill notice and payment-assistance wording fit an income-tax account', async () => {
  const v = await pages(VIRGINIA, ['bill'], { signedIn: true });
  assert.doesNotMatch(v.bill, /Municipal income tax/i);
  const ep = world.createEpisode({ seed: 'audit-ptgov-notice', scenario: { [SC]: { billNotice: true } } }); world.account(ep, SC);
  const mail = ep.mailbox.find(m => m.billerId === SC && /bill is ready/.test(m.subject));
  assert.ok(mail, 'bill notice sent');
  assert.doesNotMatch(mail.text, /Parcel number|Service ZIP code/);
  assert.ok(billNotice(ep, SC).accountNumber);
  const o = await pages(OHIO, ['helpArticle:payment-assistance']);
  assert.doesNotMatch(o['helpArticle:payment-assistance'], /budget billing/i);
});

test('tax guest pages ask for what the form takes: no SSN / ITIN in the guest note', async () => {
  for (const id of [SC, VIRGINIA, 'colorado-department-of-revenue-taxation-individu-97a575', 'michigan-department-of-treasury-individual-incom-02410e', 'georgia-department-of-revenue-individual-income--b2776e']) {
    const p = await pages(id, ['guest']);
    assert.doesNotMatch(p.guest, /\bSSN\b|\bITIN\b|Social Security/, id);
  }
});

test('contact-us: several customer-service numbers are labeled, not a bare list', async () => {
  const p = await pages(PA, ['helpArticle:contact-us']);
  assert.match(p['helpArticle:contact-us'], /Customer service: 717-787-8201 \(Personal Income Tax\)\. Other numbers: Delinquent collections \(individuals\): 717-783-3000/);
  assert.equal(labeledPhoneText('800-111-2222; 800-333-4444', '800-111-2222; 800-333-4444'), null, 'unlabeled lists stay as they are');
  assert.equal(labeledPhoneText("800-856-4362 (context: '...'); 888-817-4342", 'x; y'), null, 'provenance records stay as they are');
});
