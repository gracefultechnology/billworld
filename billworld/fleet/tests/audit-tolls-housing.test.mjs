// Regression tests for the blind-agent audit of vehicle-tolls and housing (DMV renewal history and partial-payment
// receipt, toll AutoPay and payment-plan pages, observed-excerpt cleanup, rent-portal AutoPay day, hero, Google
// button, locality, footer links, registration notes, agentlab newtab).
// Run: node --test billworld/fleet/tests/audit-tolls-housing.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { start } from '../server.mjs';
import { tidyExcerpt, mapLabel } from '../templates/_observed.mjs';
import { login, pay } from './solve.mjs';

const CA_DMV = 'california-dmv-vehicle-registration-renewal-9ee819', NY_DMV = 'new-york-dmv-vehicle-registration-renewal-851201';
const EZVA = 'e-zpass-virginia-vdot-and-toll-roads-in-virginia-80f2bf', HCTRA = 'hctra-ez-tag-harris-county-toll-road-authority-8310a6';
const NTTA = 'ntta-tolltag-and-zipcash-north-texas-tollway-aut-66b85a', GREYSTAR = 'greystar-cce6ab';
const LAGUNA = 'laguna-woods-village-village-management-services-17790b', TRICON = 'tricon-residential-tricon-homes-e30f16';
const NYCHA = 'new-york-city-housing-authority-nycha-ef5816', AVALON = 'avalonbay-communities-avalon-ava-eaves-kanso-f8e046';
const DAY = 86400e3;

let s;
before(async () => { s = await start({ port: 0, adminPort: 0, quiet: true, google: true, googlePort: 0 }); });
after(async () => { await s.close(); });
const text = h => h.replace(/<(script|style)[\s\S]*?<\/\1>/g, '').replace(/<[^>]+>/g, ' ').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');
async function episode(id, scenario) { return s.world.episode((await s.admin('/episodes', { billerId: id, seed: `audit-th:${id}`, ...(scenario ? { scenario: { [id]: scenario } } : {}) })).episodeId); }
async function get(ep, id, pg, { sid, params, path } = {}) {
  const port = new URL(s.baseUrl).port;
  const url = s.baseUrl + (path || s.urlFor(s.templateFor(s.world.biller(id)), id, pg, params || {}));
  return (await fetch(url, { headers: { cookie: `bwf_ep_${port}=${ep.id}; bwf_at_${port}=${ep.entryToken}${sid ? `; bwf_sid=${sid}` : ''}` }, redirect: 'manual' })).text();
}

test('vehicle registration: yearly renewal history, not monthly fee notices', async () => {
  for (const id of [CA_DMV, NY_DMV]) {
    const ep = await episode(id); const a = s.world.account(ep, id);
    assert.equal(a.invoices.length, 4, 'four yearly renewal notices');
    for (let i = 1; i < a.invoices.length; i++) assert.ok(Math.abs(a.invoices[i].dueAt - a.invoices[i - 1].dueAt - 365 * DAY) < 2 * DAY, 'one year apart');
    assert.equal(a.payments.filter(p => p.history).length, 3, 'one posted renewal per prior year');
    const notices = text(await get(ep, id, 'statements', { sid: login(s.world, ep, id) }));
    assert.doesNotMatch(notices, /Fee notice/); assert.equal((notices.match(/Renewal notice \d+/g) || []).length, 4);
  }
});

test('DMV partial payment: confirmation says fees are still due, no proof-of-renewal text', async () => {
  const ep = await episode(NY_DMV); const sid = login(s.world, ep, NY_DMV);
  const p = pay(s.world, ep, NY_DMV, sid, { amountChoice: 'other', amount: '25.00', methodId: 'pm-card' });
  const page = text(await get(ep, NY_DMV, 'payReceipt', { sid, params: { id: p.payment?.id || p.id } }));
  assert.match(page, /Partial payment received; \$[\d,.]+ still due before your registration can be renewed/);
  assert.doesNotMatch(page, /proof of renewal|Renewal submitted/);
  const ep2 = await episode(NY_DMV); const sid2 = login(s.world, ep2, NY_DMV);
  const full = pay(s.world, ep2, NY_DMV, sid2, { amountChoice: 'due', methodId: 'pm-card' });
  const page2 = text(await get(ep2, NY_DMV, 'payReceipt', { sid: sid2, params: { id: full.payment?.id || full.id } }));
  assert.match(page2, /Renewal submitted/); assert.match(page2, /proof of renewal/); assert.doesNotMatch(page2, /Partial payment/);
});

test('toll AutoPay without a fixed-amount option has no fixed-amount box', async () => {
  const ep = await episode(EZVA, { autopay: true });
  const h = await get(ep, EZVA, 'autopay', { sid: login(s.world, ep, EZVA) });
  assert.doesNotMatch(h, /name="fixedAmount"/); assert.doesNotMatch(h, /<option value="fixed"/);
});

test('payment plans not offered online: no "split your balance" teaser (toll and utility families)', async () => {
  const ep = await episode(HCTRA);
  const h = text(await get(ep, HCTRA, 'arrangement', { sid: login(s.world, ep, HCTRA) }));
  assert.doesNotMatch(h, /Split unpaid tolls/); assert.match(h, /281-875/);
  const help = text(await get(ep, HCTRA, 'helpArticle', { params: { slug: 'payment-assistance' } }));
  assert.match(help, /does not describe an online payment plan/);
});

test('observed excerpts: repeated run-on sentences, dropped list lead-ins and trailing FAQ questions are removed', async () => {
  assert.equal(tidyExcerpt('If you are not ready for a TollTag, you can sign up for ZipCash automatic payments and save on roads. Avoid late fees by scheduling a recurring reminder to pay your bill online or sign up for automatic payments and save on roads. Avoid late fees by scheduling a recurring reminder to pay your bill online or signing up for a monthly automatic payment. Can I get a discount?'),
    'If you are not ready for a TollTag, you can sign up for ZipCash automatic payments and save on roads. Avoid late fees by scheduling a recurring reminder to pay your bill online or signing up for a monthly automatic payment.');
  assert.equal(tidyExcerpt('Help is available. These groups may offer assistance with rent, deposits, and food: St. Visit the state housing department for more.'), 'Help is available. Visit the state housing department for more.');
  assert.equal(tidyExcerpt('How do I pay?'), 'How do I pay?', 'a lone question stays');
  const ep = await episode(NTTA);
  const h = text(await get(ep, NTTA, 'helpArticle', { params: { slug: 'autopay' } }));
  assert.equal((h.match(/Avoid late fees by scheduling/g) || []).length, 1);
  assert.doesNotMatch(h, /Can I get a discount on my ZipCash tolls/);
});

test('rent portal: AutoPay edit form shows the enrolled day (due date), summary agrees', async () => {
  const ep = await episode(GREYSTAR, { autopay: true });
  const h = await get(ep, GREYSTAR, 'autopay', { sid: login(s.world, ep, GREYSTAR) });
  const day = h.match(/<select[^>]*name="day"[^>]*>([\s\S]*?)<\/select>/)[1];
  assert.match(day, /<option value="" selected>On the due date<\/option>/);
  assert.match(text(h), /Day of month On the due date/);
});

test('rent portal home: AutoPay and method bullets follow the dossier; locality and Google sign-in', async () => {
  const ep = await episode(LAGUNA);
  const h = text(await get(ep, LAGUNA, 'home'));
  assert.doesNotMatch(h, /set up auto-pay|Recurring auto-pay|eCheck/); assert.match(h, /Pay by credit\/debit card/);
  const a = s.world.account(ep, LAGUNA); assert.equal(a.serviceCity, 'Laguna Woods'); assert.equal(a.zip, '92637');
  const ep2 = await episode(NYCHA); const n = s.world.account(ep2, NYCHA);
  assert.equal(n.serviceCity, 'New York'); assert.match(n.zip, /^100\d\d$/);
  const ep3 = await episode(TRICON);
  assert.match(await get(ep3, TRICON, 'home'), /data-social-login="google"/, 'home sign-in card offers Google');
});

test('resident registration: one password hint, civic footer links are not portal links, notes match the form', async () => {
  for (const id of [NYCHA, AVALON]) {
    const ep = await episode(id, { registered: false });
    const h = await get(ep, id, 'register'); const t = text(h);
    assert.equal((t.match(/characters with upper and lower case letters/g) || []).length, 1, `${id}: single password hint`);
    assert.doesNotMatch(h, /<a [^>]*>(?:Register to vote|nyc\.gov home)<\/a>/);
    if (!/name="community"/.test(h)) assert.doesNotMatch(t, /your community and/);
  }
  const vm = { url: p => `/${p}`, has: () => true, biller: { capabilities: {} }, template: 'rent-portal', help: [] };
  assert.equal(mapLabel(vm, 'Register to vote'), null); assert.equal(mapLabel(vm, 'nyc.gov home'), null); assert.equal(mapLabel(vm, 'Home'), '/home');
});

test('agentlab: newtab command exists and is listed in help', () => {
  const src = readFileSync(new URL('../agentlab/session.mjs', import.meta.url), 'utf8');
  assert.match(src, /async newtab\(/); assert.match(src, /'goto', 'newtab'/); assert.match(src, /newtab \[url\|\/path\]/);
  assert.match(src, /filter\(t => String\(t \|\| ''\)\.trim\(\)\)/, 'no empty Messages header');
});
