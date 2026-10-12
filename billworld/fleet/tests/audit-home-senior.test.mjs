// Regressions from the blind-agent audit of home-services + senior-services (2026-10-11).
// Run: node --test billworld/fleet/tests/audit-home-senior.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { start, templateFor } from '../server.mjs';
import { Client, parseForms } from './httpflows.mjs';
import { login } from './solve.mjs';
import { helpArticles } from '../help.mjs';
import { generateTasks } from '../tasks.mjs';
import { plannedFlows } from './driver.mjs';

const BLINK = 'blink-subscription-plans-9282e3', RING = 'ring-ring-home-ring-protect-subscriptions-9cc71b', ADT = 'adt-779740';
const CINCH = 'cinch-home-services-c41ddd', GUARDIAN = 'guardian-protection-04cdff', TRUGREEN = 'trugreen-191340', ORKIN = 'orkin-b7b07e';
const LIFEALERT = 'life-alert-2f08d3', GETSAFE = 'getsafe-99345f', ALOE = 'aloe-care-health-f61fb9', GMM = 'guardian-medical-monitoring-7bfd60';
let server, world, agent;
before(async () => { server = await start({ port: 0, adminPort: 0, quiet: true }); world = server.world; agent = new http.Agent({ keepAlive: true }); });
after(async () => { agent.destroy(); await server.close(); });

const text = html => html.replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/\s+/g, ' ');
async function pages(id, list, { signedIn = true } = {}) {
  const ep = world.createEpisode({ seed: `audit-hs-${id}`, kind: 'sweep' });
  const c = new Client(server.baseUrl, agent); c.cookies.set('bwf_ep', ep.id); c.cookies.set('bwf_at', ep.entryToken);
  if (signedIn) c.cookies.set('bwf_sid', login(world, ep, id));
  const out = {};
  for (const pg of list) { const path = pg.startsWith('/') ? pg : server.urlFor(templateFor(world.biller(id)), id, pg); const r = await c.get(path); assert.equal(r.status, 200, `${id} ${pg}`); out[pg] = r.body; }
  world.episodes.delete(ep.id); return out;
}

test('auto-renewing plans: no "Plan plan", no autopay/paper/installment links that the banner rules out (Blink, Ring)', async () => {
  for (const id of [BLINK, RING]) {
    const { dashboard, paperless } = await pages(id, ['dashboard', 'paperless']);
    const d = text(dashboard);
    assert.doesNotMatch(d, /\bPlan plan\b/, id);
    assert.match(d, /Automatic payments (?:Always on|On ›)/, id);
    assert.doesNotMatch(d, /Paper statements by mail|Split a payment|Automatic payments Off/, id);
    assert.doesNotMatch(text(paperless), /ring\.com/i, `${id}: paperless note must not point to an external site`);
  }
  assert.match(text((await pages(BLINK, ['dashboard'])).dashboard), /Plus Plan \$/);
});

test('help articles never quote research digests (ADT paperless)', async () => {
  const arts = helpArticles(world.biller(ADT));
  for (const a of arts) for (const p of a.paragraphs) assert.doesNotMatch(p, /: explains\b|;[^;]*;[^;]*;/, `${a.slug}: ${p.slice(0, 80)}`);
  const t = text((await pages(ADT, ['/b/adt-779740/help/article/paperless'], { signedIn: false }))['/b/adt-779740/help/article/paperless']);
  assert.doesNotMatch(t, /Billing FAQs: explains|&gt;|&quot;/);
  assert.match(t, /1-800-238-ASAP \(800-238-2727\)/);
});

test('sign-up copy: lower-case identifier mid-sentence, one password hint (Cinch, Life Alert)', async () => {
  const c = text((await pages(CINCH, ['register'], { signedIn: false })).register);
  assert.match(c, /using the plan number on your bill/); assert.doesNotMatch(c, /plan Number/);
  for (const id of [CINCH, LIFEALERT]) {
    const r = text((await pages(id, ['register'], { signedIn: false })).register);
    assert.equal((r.match(/8–64 characters|8\+ characters/g) || []).length, 1, `${id}: one password hint`);
  }
  assert.match(text((await pages(LIFEALERT, ['register'], { signedIn: false })).register), /account number on your bill notice email/);
});

test('no paper-statement contradiction when the dossier explains paperless (Guardian Protection)', async () => {
  const { dashboard, paperless } = await pages(GUARDIAN, ['dashboard', 'paperless']);
  assert.doesNotMatch(text(dashboard), /Notifications & paper statements/);
  assert.doesNotMatch(text(paperless), /does not mail paper statements/);
});

test('no self sign-up links when registration is unsupported (GetSafe)', async () => {
  const p = await pages(GETSAFE, ['home', 'login', 'help'], { signedIn: false });
  for (const [pg, body] of Object.entries(p)) { assert.doesNotMatch(body, /href="[^"]*\/signup"/, `${pg} links to sign-up`); assert.doesNotMatch(text(body), /Sign up now|Sign up for GetSafe/, pg); }
  // ...and nothing asks an agent or the scripted driver to sign up there.
  assert.ok(!generateTasks(world.biller(GETSAFE)).some(t => t.id.endsWith(':register-and-pay')));
  assert.ok(!plannedFlows(world.biller(GETSAFE)).some(([f]) => f === 'register_verify'));
  assert.ok(plannedFlows(world.biller(CINCH)).some(([f]) => f === 'register_verify'));
});

test('no "Split a payment" when payment plans are not offered online (Aloe Care)', async () => {
  assert.doesNotMatch(text((await pages(ALOE, ['dashboard'])).dashboard), /Split a payment|installments/);
});

test('guest lookup form, copy and banner agree; lawn and pest invoices have trade line items (TruGreen, Orkin)', async () => {
  const { guest } = await pages(TRUGREEN, ['guest'], { signedIn: false });
  const f = parseForms(guest).find(x => x.method === 'post' && x.has('accountNumber'));
  assert.ok(f && f.has('lastName') && f.has('zip') && !f.has('amountDue'), 'customer number + last name + ZIP, no invoice amount');
  const t = text(guest);
  assert.match(t, /Find your bill with your customer number, last name and ZIP code\./);
  assert.match(t, /Enter your customer number, last name and ZIP code/);
  assert.doesNotMatch(t, /invoice total|phone number/);
  const ep = world.createEpisode({ seed: 'audit-hs-tg-guest' }); const acct = world.account(ep, TRUGREEN);
  assert.ok(world.guestLookup(ep, TRUGREEN, { accountNumber: acct.accountNumber, lastName: ep.persona.last, zip: ep.persona.zip }, { required: ['accountNumber', 'lastName', 'zip'] }).sid);
  for (const [id, re] of [[TRUGREEN, /Lawn care service/], [ORKIN, /Pest control service/]]) {
    const b = text((await pages(id, ['bill'])).bill);
    assert.match(b, re, id); assert.doesNotMatch(b, /\bEquipment\b/, id);
  }
});

test('patient-pay family on a non-clinical biller: no guarantor/insurance wording, payment-plan links follow policy (Guardian Medical Monitoring)', async () => {
  const p = await pages(GMM, ['home', 'dashboard', 'bill', 'profile']);
  for (const [pg, body] of Object.entries(p)) {
    const t = text(body);
    assert.doesNotMatch(t, /Guarantor|insurance|Financial assistance|Patient Billing|Patient responsibility/i, pg);
    assert.doesNotMatch(t, /Set up a payment plan|Payment Plans\b/, pg);
  }
  // A clinical biller on the same family keeps its patient wording and payment plans.
  const med = [...world.catalog.billers.values()].find(b => b.template === 'patient-pay' && b.kind === 'medical' && !b.dossier && b.capabilities.payment_arrangement.support === 'supported');
  const m = await pages(med.id, ['dashboard', 'bill']);
  assert.match(text(m.dashboard), /Guarantor: /); assert.match(text(m.dashboard), /Set up a payment plan/);
  assert.match(text(m.bill), /Patient responsibility/);
});
