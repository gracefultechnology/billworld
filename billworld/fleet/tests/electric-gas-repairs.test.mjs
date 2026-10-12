// Regressions from the electric + gas blind-agent audit: wallet "Remove …?" confirmation, utility stop-service
// notice (3 business days, client and server), reset-link page copy, InvoiceCloud AutoPay unenroll wording,
// signed-in municipal Contact us, stricter dossier number answers and sample.mjs covering every dossier biller.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { start } from '../server.mjs';
import { Fault, gradeAnswer, isoDate } from '../engine.mjs';
import { addBusinessDays } from '../kit.mjs';
import { Client, parseForms, encodeForm } from './httpflows.mjs';
import { login } from './solve.mjs';

const CONED = 'consolidated-edison-company-of-new-york-con-edis-1ac80c'; // utility-account
const DTE = 'dte-energy-dte-electric-335ab9';
const COLUMBIA = 'columbia-gas-of-ohio-19107b'; // paymentus
const NFG = 'national-fuel-gas-distribution-5c3f22'; // invoicecloud
const PGW = 'philadelphia-gas-works-pgw-31bfd0'; // municipal-portal
const XCEL = 'xcel-energy-colorado-public-service-company-of-c-0e5158';

let server, agent;
before(async () => { server = await start({ port: 0, adminPort: 0, quiet: true }); agent = new http.Agent({ keepAlive: true, maxSockets: 4 }); });
after(async () => { agent.destroy(); await server.close(); });

// A signed-in HTTP client for one biller (session made through the engine, then used through the site's own pages).
function signedIn(id, scenario = {}) {
  const world = server.world;
  const ep = world.createEpisode({ seed: `eg-repairs-${id}-${Math.random()}`, scenario: { [id]: scenario } });
  const sid = login(world, ep, id);
  const client = new Client(server.baseUrl, agent);
  client.cookies.set('bwf_ep', ep.id); client.cookies.set('bwf_at', ep.entryToken); client.cookies.set('bwf_sid', sid);
  const b = world.biller(id), t = server.templateFor(b);
  const url = (pg, params = {}, q = null) => server.urlFor(t, id, pg, params, q);
  return { world, ep, sid, client, b, t, url, acct: () => world.account(ep, id) };
}
const text = body => body.replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&#39;|&apos;/g, "'").replace(/\s+/g, ' ');

test('wallet Remove asks "Remove … ending in 4444?" first; only the confirmation removes', async () => {
  for (const id of [CONED, DTE, COLUMBIA, NFG, PGW]) {
    const s = signedIn(id, { expiredCard: true });
    const old = s.acct().methods.find(m => m.last4 === '4444' && m.saved); assert.ok(old, `${id}: expired card seeded`);
    const page = await s.client.get(s.url('wallet'));
    const rm = parseForms(page.body).find(f => f.valuesOf('methodId').includes(old.id) && f.valuesOf('op').includes('remove'));
    assert.ok(rm, `${id}: Remove control for the 4444 card`);
    const first = await s.client.post(rm.action, encodeForm(rm));
    assert.equal(first.status, 303, `${id}: Remove -> ${first.status}`);
    assert.ok(!s.acct().methods.find(m => m.id === old.id).removed, `${id}: removed without confirmation`);
    const ask = await s.client.get(first.headers.location);
    assert.match(text(ask.body), /Remove \w[\w ]* ending in 4444\?/, `${id}: confirmation question`);
    const yes = parseForms(ask.body).find(f => f.valuesOf('confirmRemove').includes('yes'));
    assert.ok(yes && yes.valuesOf('methodId').includes(old.id), `${id}: confirmation form for that method`);
    assert.match(ask.body, new RegExp(`href="${s.url('wallet').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*>Cancel<`), `${id}: Cancel keeps the method`);
    const done = await s.client.post(yes.action, encodeForm(yes));
    assert.equal(done.status, 303); assert.ok(s.acct().methods.find(m => m.id === old.id).removed, `${id}: confirmed remove removes`);
    // A method AutoPay uses is refused at the first step (no confirmation offered for it).
    const s2 = signedIn(id, { autopay: true }); const apId = s2.acct().autopay.methodId;
    const p2 = await s2.client.get(s2.url('wallet'));
    const rm2 = parseForms(p2.body).find(f => f.valuesOf('methodId').includes(apId) && f.valuesOf('op').includes('remove'));
    if (rm2) { const r = await s2.client.post(rm2.action, encodeForm(rm2)); assert.ok([400, 409].includes(r.status) && /autopay/i.test(text(r.body)), `${id}: AutoPay method refused (${r.status})`); }
  }
});

test('engine: removeMethod check mode validates without removing', () => {
  const s = signedIn(DTE, { expiredCard: true, autopay: true });
  const old = s.acct().methods.find(m => m.last4 === '4444');
  assert.equal(s.world.removeMethod(s.ep, DTE, s.sid, { methodId: old.id, check: true }).ok, true);
  assert.ok(!old.removed);
  assert.throws(() => s.world.removeMethod(s.ep, DTE, s.sid, { methodId: s.acct().autopay.methodId, check: true }), e => e instanceof Fault && e.code === 'in_use');
});

test('utility stop service: 3 business days notice on the page and in the engine', async () => {
  for (const id of [CONED, XCEL, PGW]) {
    const s = signedIn(id); const today = isoDate(s.ep.clock); const earliest = addBusinessDays(today, 3);
    assert.equal(s.b.kind, 'utility');
    // The engine refuses an earlier date (today, and the last day before the notice window) with the earliest allowed date.
    s.world.cancelService(s.ep, id, s.sid, { step: 'reason', reason: 'moving' });
    if (s.world.account(s.ep, id).service.cancelFlow && !s.world.account(s.ep, id).service.cancelFlow.offered) { try { s.world.cancelService(s.ep, id, s.sid, { step: 'offer', accept: 'no' }); } catch {} }
    for (const d of [today, addBusinessDays(today, 2)]) assert.throws(() => s.world.cancelService(s.ep, id, s.sid, { step: 'confirm', confirm: true, effectiveDate: d }), e => e instanceof Fault && e.code === 'bad_date' && /3 business days/.test(e.message), `${id}: ${d} refused`);
    // The stop page's date input defaults to and cannot go below the earliest date.
    const page = await s.client.get(s.url('cancel', {}, { step: 'confirm' }));
    const m = page.body.match(/<input[^>]*name="effectiveDate"[^>]*>/);
    assert.ok(m, `${id}: stop date input on the confirm step`); { assert.match(m[0], new RegExp(`min="${earliest}"`), `${id}: min ${m[0]}`); assert.match(m[0], new RegExp(`value="${earliest}"`), `${id}: default ${m[0]}`); }
    assert.ok(!/forwarding address/i.test(page.body), `${id}: no forwarding-address promise without a field`);
    const r = s.world.cancelService(s.ep, id, s.sid, { step: 'confirm', confirm: true, effectiveDate: earliest });
    assert.equal(r.next, 'done'); assert.equal(isoDate(r.service.cancelAt), earliest);
  }
  // Without a date the stop defaults to the earliest allowed date.
  const s = signedIn(CONED); s.world.cancelService(s.ep, CONED, s.sid, { step: 'reason', reason: 'moving' });
  const r = s.world.cancelService(s.ep, CONED, s.sid, { step: 'confirm', confirm: true });
  assert.equal(isoDate(r.service.cancelAt), addBusinessDays(isoDate(s.ep.clock), 3));
});

test('reset page opened from the emailed link says "Choose a new password", not "enter the code"', async () => {
  for (const id of [CONED, COLUMBIA]) {
    const s = signedIn(id); const c = new Client(server.baseUrl, agent); c.cookies.set('bwf_ep', s.ep.id); c.cookies.set('bwf_at', s.ep.entryToken);
    const withToken = await c.get(s.url('reset', {}, { token: 'x'.repeat(24) }));
    assert.ok(!/name="code"/.test(withToken.body)); assert.match(text(withToken.body), /Choose a new password/); assert.ok(!/Enter the verification code/i.test(text(withToken.body)), `${id}: code copy with a token`);
    const noToken = await c.get(s.url('reset'));
    assert.match(noToken.body, /name="code"/); assert.match(text(noToken.body), /Enter the verification code/i);
  }
});

test('InvoiceCloud AutoPay: the control is "Unenroll from AutoPay", as the help text says', async () => {
  const s = signedIn(NFG, { autopay: true });
  const page = text((await s.client.get(s.url('autopay'))).body);
  assert.match(page, /Manage AutoPay/); assert.match(page, /Unenroll from AutoPay/);
  assert.ok(!/Stop AutoPay for this account/.test(page));
});

test('municipal portal: signed in, Contact us opens the secure message form', async () => {
  const s = signedIn(PGW);
  const dash = (await s.client.get(s.url('dashboard'))).body;
  assert.ok(dash.includes(`href="${s.url('contact')}"`), 'signed-in page links the message form');
  assert.ok(/<nav aria-label="Footer">[\s\S]*?href="[^"]*contact-us"[^>]*>Contact us</.test(dash) && !dash.includes('faqs/contact-us">Contact us'), 'footer Contact us is the message form when signed in');
});

test('dossier number answers need the unit: a stray "11" does not pass', () => {
  const sce = server.world.biller('southern-california-edison-sce-c8af8e').dossier.tasks.extra.find(x => x.slug === 'autopay-draft-timing');
  const p = sce.predicates.find(x => x.type === 'answer');
  const g = t => gradeAnswer(p, t, null).pass;
  assert.ok(g('Auto Pay withdraws the payment 11 days before the due date.'));
  assert.ok(g('eleven days before it is due'));
  assert.ok(!g('Your balance is $111.40, due Nov 11.'));
  assert.ok(!g('It is withdrawn 5 days before the due date (account ending 1111).'));
});

test('sample.mjs: a category sample includes every dossier biller by default', () => {
  const out = execFileSync(process.execPath, [fileURLToPath(new URL('../agentlab/sample.mjs', import.meta.url)), '--category', 'gas', '--per-biller', '1'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000 });
  const ids = new Set(JSON.parse(out).map(x => x.billerId));
  const ded = server.world.catalog.dedicated.filter(id => server.world.biller(id).category === 'gas');
  assert.ok(ded.length > 20); for (const id of ded) assert.ok(ids.has(id), `${id} sampled`);
});
