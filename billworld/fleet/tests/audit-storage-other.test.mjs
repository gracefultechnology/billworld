// Regression tests for the blind-agent audit of storage-funeral and other (streaming storage sites: hero forgot link,
// offline AutoPay, fixed AutoPay day, no-registration sign-up page, guest copy, identifier input type, StorageMart nav;
// invoice portal: account-number wording, SMS verify heading, payment-plan gating and review step, scheduled payments
// and pending closure on the dashboard, scheduled receipt wording, plan-priced and fixed recurring invoices,
// documented account-number prefix, notice casing; observed footer/nav icon class names and "Vision Statement").
// Run: node --test billworld/fleet/tests/audit-storage-other.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { start } from '../server.mjs';
import { normalize, mapLabel } from '../templates/_observed.mjs';
import { login, pay } from './solve.mjs';
import { PASSWORD } from '../engine.mjs';

const PACKRAT = '1-800-pack-rat-portable-storage-incl-zippy-shell-61309b', MORNINGSTAR = 'morningstar-storage-85b8ee', PODS = 'pods-portable-storage-containers-monthly-storage-ffe35a';
const STORAGEMART = 'storagemart-manhattan-mini-storage-cd52e6', DEVON = 'devon-self-storage-4f396c', UHAUL = 'u-haul-self-storage-373e16';
const GOSTOREIT = 'go-store-it-self-storage-bc2e53', STORESPACE = 'store-space-self-storage-7ece59', SAFEGUARD = 'safeguard-self-storage-3983e1';
const DIGNITY = 'dignity-memorial-service-corporation-internation-20f6ef', ASURION = 'asurion-device-appliance-tech-protection-general-bc49d4';
const APPLECARE = 'applecare-applecare-one-monthly-or-annual-825e85', PALMETTO = 'palmetto-palmetto-solar-llc-lightreach-palmetto--26354c';
const USPS = 'usps-po-box-rental-7e9faa', TRUEACCORD = 'trueaccord-76d8a1', SUNNOVA = 'sunnova-accounts-now-serviced-by-sunstrong-manag-8f9007';
const TESLA = 'tesla-energy-solar-leaseppa-billing-tesla-inc-53dd56', MIDLAND = 'midland-credit-management-midland-funding-encore-005127';
const AFF = 'american-first-finance-aff-ab313c', DTE = 'dte-home-protection-plus-hpp-1461bd';

let s;
before(async () => { s = await start({ port: 0, adminPort: 0, quiet: true }); });
after(async () => { await s.close(); });
const text = h => h.replace(/<(script|style)[\s\S]*?<\/\1>/g, '').replace(/<[^>]+>/g, ' ').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');
async function episode(id, scenario) { return s.world.episode((await s.admin('/episodes', { billerId: id, seed: `audit-so:${id}`, ...(scenario ? { scenario: { [id]: scenario } } : {}) })).episodeId); }
async function get(ep, id, pg, { sid, params, query = '' } = {}) {
  const port = new URL(s.baseUrl).port;
  const url = s.baseUrl + s.urlFor(s.templateFor(s.world.biller(id)), id, pg, params || {}) + query;
  return (await fetch(url, { headers: { cookie: `bwf_ep_${port}=${ep.id}; bwf_at_${port}=${ep.entryToken}${sid ? `; bwf_sid=${sid}` : ''}` }, redirect: 'manual' })).text();
}
const signedIn = async (id, pg, scenario, opts = {}) => { const ep = await episode(id, scenario); const sid = login(s.world, ep, id); return { ep, sid, html: await get(ep, id, pg, { sid, ...opts }) }; };

// ---------- streaming (storage) ----------
test('storage home sign-in widget links to Forgot password (Pack-Rat)', async () => {
  const ep = await episode(PACKRAT); const h = await get(ep, PACKRAT, 'home');
  assert.ok(h.includes(`href="${s.urlFor(s.templateFor(s.world.biller(PACKRAT)), PACKRAT, 'forgot', {})}"`), 'forgot link on the home page');
});

test('AutoPay set up by phone/associate: no "Off" or "Always on" quick link, explanation page (Morningstar, PODS)', async () => {
  for (const id of [MORNINGSTAR, PODS]) {
    const { ep, sid, html } = await signedIn(id, 'dashboard');
    const t = text(html); assert.match(t, /Automatic payments Not set up online/); assert.doesNotMatch(t, /Automatic payments Off|Always on: renewals/);
    const ap = text(await get(ep, id, 'autopay', { sid }));
    assert.match(ap, /Automatic payments can't be turned on online/); assert.doesNotMatch(ap, /Renewals are charged automatically/);
  }
});

test('no "Split a payment" quick link when payment plans are not offered (Safeguard, PODS)', async () => {
  for (const id of [SAFEGUARD, PODS]) assert.doesNotMatch(text((await signedIn(id, 'dashboard')).html), /Split a payment/);
});

test('StorageMart nav: "My Units" is not the AutoPay page', async () => {
  const { html } = await signedIn(STORAGEMART, 'dashboard');
  const units = html.match(/<a href="([^"]+)"[^>]*>My Units<\/a>/); assert.ok(units, 'My Units link');
  assert.doesNotMatch(units[1], /autopay/);
});

test('no online registration: /signup explains and points to Forgot password, no sign-up form (Devon)', async () => {
  const ep = await episode(DEVON); const h = await get(ep, DEVON, 'register');
  assert.doesNotMatch(h, /name="confirm"/); assert.match(text(h), /There is no online sign-up form/);
  assert.match(h, /\/loginhelp"/);
});

test('"Phone or Email" identifier inputs are type=text (U-Haul)', async () => {
  const ep = await episode(UHAUL); const h = await get(ep, UHAUL, 'home');
  const input = h.match(/<input id="hero-email"[^>]*>/)[0]; assert.match(input, /type="text"/);
});

test('guest-pay intro names the actual lookup fields (Go Store It)', async () => {
  const ep = await episode(GOSTOREIT); const t = text(await get(ep, GOSTOREIT, 'guest'));
  assert.match(t, /Enter your unit number and last name/); assert.doesNotMatch(t, /member number|billing ZIP|membership/);
});

test('AutoPay on a fixed draft day says so instead of the due date (Store Space)', async () => {
  const t = text((await signedIn(STORESPACE, 'autopay', { autopay: true })).html);
  assert.match(t, /on the 1st of each month/); assert.doesNotMatch(t, /Next charge \$[\d.]+ on/);
});

// ---------- invoice portal ----------
test('account-number wording follows the dossier on sign-up, guest pay and summaries (Dignity, Sunnova)', async () => {
  const ep = await episode(DIGNITY); const reg = text(await get(ep, DIGNITY, 'register'));
  assert.match(reg, /Your account or contract number is printed/); assert.doesNotMatch(reg, /customer number/i);
  const ep2 = await episode(SUNNOVA); const g = await get(ep2, SUNNOVA, 'guest');
  assert.doesNotMatch(text(g), /Customer number/);
});

test('SMS verification heading says phone, not email (Palmetto)', async () => {
  const ep = await episode(PALMETTO, { mfa: 'sms' });
  const r = s.world.login(ep, PALMETTO, { username: ep.persona.email, password: PASSWORD });
  const t = text(await get(ep, PALMETTO, 'mfa', { sid: r.sid }));
  assert.match(t, /Check your phone/); assert.doesNotMatch(t, /Check your email/);
});

test('observed footer labels: icon class names dropped, "Vision Statement" is not a bill link', async () => {
  const o = normalize({ website: { footerLabels: ['smrt-icon smrt-icon-x', 'icomoon--Facebook', 'Vision Statement', 'Pay My Bill'], navLabels: ['fa fa-twitter', 'Billing'] } });
  assert.deepEqual(o.footer, ['Vision Statement', 'Pay My Bill']); assert.deepEqual(o.nav, ['Billing']);
  const vm = { biller: s.world.biller(PALMETTO), url: p => `/${p}`, has: () => true, help: [] };
  assert.equal(mapLabel(vm, 'Vision Statement'), null); assert.equal(mapLabel(vm, 'Billing Statements'), '/bill');
});

test('payment-plan link only where plans are offered online (Asurion, USPS, DTE HPP)', async () => {
  for (const id of [ASURION, USPS, DTE]) assert.doesNotMatch(text((await signedIn(id, 'dashboard', { amountCents: 24000 })).html), /Request a payment plan|· Payment plan/, id);
  assert.match(text((await signedIn(MIDLAND, 'dashboard', { amountCents: 24000 })).html), /Payment Plan/);
});

test('payment plan has a review step with schedule and consent before it is created (Midland)', async () => {
  const { ep, sid, html } = await signedIn(MIDLAND, 'arrangement', { amountCents: 24000 });
  assert.match(html, /<form method="get"/); assert.equal(s.world.account(ep, MIDLAND).arrangement, null);
  const rv = await get(ep, MIDLAND, 'arrangement', { sid, query: '?review=1&months=6' });
  const t = text(rv); assert.match(t, /Review your payment plan/); assert.match(t, /6 monthly payments of about \$40\.00/); assert.match(t, /Installment 6/);
  assert.match(rv, /name="planConsent"[^>]*required/); assert.match(rv, /name="months" value="6"/);
  assert.equal(s.world.account(ep, MIDLAND).arrangement, null, 'nothing created by viewing the review');
});

test('dashboard shows scheduled payments (American First Finance)', async () => {
  const t = text((await signedIn(AFF, 'dashboard', { scheduledPayment: true })).html);
  assert.match(t, /1 payment scheduled \(next [A-Z][a-z]{2} \d+, 2026, \$[\d,.]+\) · View or cancel/); assert.doesNotMatch(t, /No payments processing/);
});

test('pending closure: dashboard and Service page offer "Keep my account open" (USPS)', async () => {
  const { ep, sid, html } = await signedIn(USPS, 'dashboard', { cancelPending: true });
  assert.match(text(html), /Your account is closing on [A-Z][a-z]{2} \d+, 2026 ?\. Keep my account open/);
  const svc = await get(ep, USPS, 'plan', { sid }); assert.match(text(svc), /Closing on [A-Z][a-z]{2} \d+, 2026 Changed your mind\? Keep my account open/);
  assert.match(svc, /name="step" value="undo"/);
});

test('scheduled payment receipt says "Amount scheduled" (Tesla Energy)', async () => {
  const ep = await episode(TESLA); const sid = login(s.world, ep, TESLA);
  const p = pay(s.world, ep, TESLA, sid, { amountChoice: 'due', methodId: 'pm-chk', payOn: '2026-10-15' });
  const t = text(await get(ep, TESLA, 'payReceipt', { sid, params: { id: p.id } }));
  assert.match(t, /Amount scheduled/); assert.doesNotMatch(t, /Amount paid/);
});

test('protection plans bill the plan price every month (AppleCare One Family $49.99, Asurion Home+ $34.99)', async () => {
  for (const [id, cents, line] of [[APPLECARE, 4999, 'AppleCare One Family'], [ASURION, 3499, 'Monthly plan charge']]) {
    const ep = await episode(id); const a = s.world.account(ep, id);
    assert.ok(a.invoices.every(i => i.amountCents === cents), `${id}: every invoice ${cents}`); assert.equal(a.invoices.at(-1).lines[0].desc, line);
    s.world.advance(ep, 31 * 86400e3); assert.equal(s.world.account(ep, id).invoices.at(-1).amountCents, cents, 'next cycle too');
  }
});

test('documented account-number format: TrueAccord numbers start with 47', async () => {
  for (const seed of ['a', 'b', 'c']) { const ep = s.world.createEpisode({ seed: `audit-so-ta-${seed}` }); assert.match(s.world.account(ep, TRUEACCORD).accountNumber, /^47\d{8}$/); }
});

test('bill notice keeps the acronym in the account label (MCM account number)', async () => {
  const ep = await episode(MIDLAND, { registered: false });
  const m = ep.mailbox.find(x => x.billerId === MIDLAND && /bill is ready/.test(x.subject));
  assert.match(m.text, /you need your MCM account number/);
});
