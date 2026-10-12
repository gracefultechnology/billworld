// Fleet gap closures (2026-10-11): pattern answers, accepted card networks, compact capability notices,
// clearer register / reset / MFA / guest feedback, kind-aware wording.
// Run: node --test billworld/fleet/tests/gaps.test.mjs
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadCatalog } from '../catalog.mjs';
import { validateDossier } from '../billers/schema.mjs';
import { applyDossier } from '../billers/load.mjs';
import { FleetWorld, gradeAnswer, cardBrandOf, testCardFor, TEST_CARDS, luhn, PASSWORD } from '../engine.mjs';
import { generateTasks } from '../tasks.mjs';
import { helpArticles } from '../help.mjs';
import { solverFor, login } from './solve.mjs';
import { start, RESEARCH_NOTE } from '../server.mjs';
import { mfaSent } from '../templates/_profile-parts.mjs';
import { withdrawnView } from '../templates/_withdrawn.mjs';

const catalog = loadCatalog();
const base = { status: 'dedicated', sources: [{ url: 'https://www.example.com/pay', title: 'Pay', fetchedAt: '2026-10-05', kind: 'pay' }] };
const S = base.sources[0].url;
const pick = pred => [...catalog.billers.values()].find(b => b.tier === 'family' && pred(b));
function dedicate(from, id, dossier) {
  const b = { ...from, id, entry: { ...from.entry, website: 'https://www.example.com/' }, capabilities: { ...from.capabilities }, brand: { ...from.brand }, fees: { ...from.fees } };
  const d = { ...base, id, ...dossier };
  const errs = validateDossier(d, { biller: b }); assert.deepEqual(errs, [], `synthetic dossier invalid: ${errs.join('; ')}`);
  applyDossier(b, d); catalog.billers.set(id, b); (catalog.byTemplate.get(b.template) || []).push(id);
  return b;
}
const util = pick(b => b.template === 'utility-account' && b.capabilities.guest_pay.support === 'supported' && b.capabilities.autopay.support === 'supported' && b.capabilities.autopay_cancel?.support === 'supported');
// Mastercard and Discover only (no Visa), one pattern-answer task, a phone sign-in, an offline capability with a note.
const MC = dedicate(util, 'zz-gaps-mcdisc-000001', {
  auth: { identifier: 'phone', loginSteps: 1, mfa: 'email' },
  billing: { cardBrands: ['mastercard', 'discover'] },
  capabilities: { cancel_service: { support: 'unsupported', evidence: 'documented_official', source: S, note: 'To stop service, call us at least three business days ahead.', channel: 'phone' } },
  tasks: { extra: [{ slug: 'cutoff-question', intent: `Find out how many business days ahead you must call ${util.brand.shortName} to stop service, and report it. Do not change anything.`, predicates: [{ type: 'no_payment' }, { type: 'answer', kind: 'pattern', expected: ['\\b(?:three|3)\\s+business\\s+days\\b'] }], answer: { kind: 'pattern' }, tags: ['help'], solution: [{ op: 'answer', text: 'Call at least 3 business days ahead.' }] }] }
});

let server;
before(async () => { server = await start({ port: 0, adminPort: 0, dataDir: mkdtempSync(join(tmpdir(), 'fleet-gaps-')), quiet: true }); });
after(() => server?.close());

test('pattern answers: regex alternatives, default case-insensitive, whitespace collapsed; schema checks the patterns', () => {
  const pr = { kind: 'pattern', expected: ['\\b(?:three|3)\\s+business\\s+days\\b', 'by phone only'] };
  assert.ok(gradeAnswer(pr, 'You need to call THREE\n business days ahead.').pass);
  assert.ok(gradeAnswer(pr, 'It can be done By Phone Only.').pass);
  assert.ok(!gradeAnswer(pr, 'Call 5 business days ahead.').pass);
  assert.ok(!gradeAnswer({ ...pr, flags: '' }, 'BY PHONE ONLY').pass, 'explicit flags override the default i');
  assert.ok(!gradeAnswer(pr, '').pass);
  const errs = expected => validateDossier({ ...base, id: 'x', tasks: { extra: [{ slug: 'q-one', intent: 'Find the answer on the website and report it here.', predicates: [{ type: 'answer', kind: 'pattern', expected }], tags: ['help'], solution: [{ op: 'answer', text: 'x' }] }] } }).join('\n');
  assert.match(errs(['(unclosed']), /valid regular expression/);
  assert.match(errs(['.*']), /matches an empty answer/);
  assert.match(errs([]), /regular expression source/);
  assert.equal(errs(['three']), '');
});

test('card networks: brand detection, test cards, schema', () => {
  assert.equal(cardBrandOf('4111111111111111'), 'visa'); assert.equal(cardBrandOf(TEST_CARDS.mastercard), 'mastercard');
  assert.equal(cardBrandOf(TEST_CARDS.amex), 'amex'); assert.equal(cardBrandOf(TEST_CARDS.discover), 'discover'); assert.equal(cardBrandOf('2221000000000009'), 'mastercard');
  for (const n of [TEST_CARDS.amex, TEST_CARDS.discover, testCardFor(MC, '1111'), testCardFor(MC, '4321')]) assert.ok(luhn(n), n);
  assert.equal(testCardFor(MC, '1111').slice(-4), '1111'); assert.equal(cardBrandOf(testCardFor(MC)), 'mastercard');
  assert.equal(testCardFor(util, '1111'), '4111111111111111', 'family billers keep the classic Visa');
  const errs = b => validateDossier({ ...base, id: 'x', billing: b }).join('\n');
  assert.match(errs({ cardBrands: ['visa', 'diners'] }), /cardBrands/);
  assert.match(errs({ cardBrands: [] }), /cardBrands/);
  assert.match(errs({ methods: ['bank'], cardBrands: ['visa'] }), /only where cards are accepted/);
  assert.equal(errs({ cardBrands: ['amex', 'visa'] }), '');
});

test('card networks: engine refuses other brands, seeds an accepted saved card; tasks name it and stay solvable', () => {
  const w = new FleetWorld(); const id = MC.id;
  const ep = w.createEpisode({ seed: 'gaps-mc', scenario: { [id]: { expiredCard: true } } }); const a = w.account(ep, id);
  const saved = a.methods.find(m => m.id === 'pm-card'); assert.equal(saved.brand, 'Mastercard'); assert.equal(a.methods.find(m => m.id === 'pm-old').brand, 'Mastercard');
  const sid = login(w, ep, id);
  assert.throws(() => w.draftPayment(ep, id, sid, { amountChoice: 'other', amount: '25.00', methodType: 'card', cardNumber: '4111111111111111', exp: '12/29', cvv: '123' }), e => e.code === 'card_brand_not_accepted' && /Visa is not accepted\. We accept Mastercard and Discover\./.test(e.message));
  assert.throws(() => w.draftPayment(ep, id, sid, { amountChoice: 'other', amount: '25.00', methodType: 'card', cardNumber: TEST_CARDS.amex, exp: '12/29', cvv: '1234' }), e => e.code === 'card_brand_not_accepted');
  assert.equal(w.draftPayment(ep, id, sid, { amountChoice: 'other', amount: '25.00', methodType: 'card', cardNumber: TEST_CARDS.discover, exp: '12/29', cvv: '123' }).method.label, 'Discover');
  const tasks = generateTasks(MC);
  assert.match(tasks.find(t => t.id.endsWith(':pay-partial-card')).intent, /saved Mastercard card/);
  assert.match(tasks.find(t => t.id.endsWith(':remove-old-card')).intent, /expired Mastercard ending in 4444/);
  assert.ok(!tasks.some(t => /Visa/.test(t.intent)), 'no task mentions a Visa the biller does not take');
  for (const t of tasks) {
    if (t.id.endsWith(':google-login-pay')) continue;
    const e2 = w.createEpisode({ seed: `gaps:${t.id}`, scenario: t.scenario }); w.account(e2, id);
    solverFor(t)(w, e2, id, {}); const r = w.evaluate(e2, t.predicates); assert.ok(r.success, `${t.id}: ${JSON.stringify(r.results.filter(x => !x.pass))}`);
  }
  assert.ok(helpArticles(MC).find(x => x.slug === 'pay-your-bill').paragraphs.includes('Cards accepted online: Mastercard and Discover.'));
});

// Minimal cookie client against the running server.
async function session(id, scenario = {}) {
  const ep = await server.admin('/episodes', { seed: `gaps-${id}-${Math.random()}`, billerId: id, scenario: { [id]: scenario } });
  const jar = new Map(); const t = server.templateFor(server.world.biller(id));
  const req = async (path, form) => {
    const r = await fetch(server.baseUrl + path, { method: form ? 'POST' : 'GET', redirect: 'manual', headers: { cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '), origin: server.baseUrl, ...(form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) }, body: form ? new URLSearchParams(form) : undefined });
    for (const sc of r.headers.getSetCookie()) { const [kv] = sc.split(';'); const i = kv.indexOf('='); const k = kv.slice(0, i), v = kv.slice(i + 1); if (/Max-Age=0\b/.test(sc) || v === '') jar.delete(k); else jar.set(k, v); }
    const body = await r.text(); return { status: r.status, location: r.headers.get('location'), body, csrf: body.match(/name="_csrf" value="([^"]*)"/)?.[1] };
  };
  const u = new URL(ep.entryUrl); await req(u.pathname + u.search);
  const url = (pg, q) => server.urlFor(t, id, pg, {}, q);
  const post = async (pg, form) => { const g = await req(url(pg)); return req(url(pg), { _csrf: g.csrf, ...form }); };
  const follow = async r => { let x = r; for (let i = 0; i < 4 && x.location; i++) x = await req(x.location); return x; };
  return { ep, req, url, post, follow, t };
}
const textOf = h => h.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/&#39;/g, "'").replace(/\s+/g, ' ');

test('home shows a compact "Ways to manage your account" notice linking to help; the card field names accepted cards', async () => {
  const s = await session(MC.id);
  const home = await s.req(s.url('home'));
  const block = home.body.match(/<aside class="bwf-capnotes bwf-compact"[\s\S]*?<\/aside>/)?.[0];
  assert.ok(block, 'compact notice on home'); assert.match(block, /Ways to manage your account/);
  assert.match(textOf(block), /To stop service, call us at least three business days ahead\./);
  assert.ok(block.includes(`href="${server.urlFor(s.t, MC.id, 'helpArticle', { slug: 'cancel-service' })}">Learn more`), 'links to the help article that explains it');
  const cancelPage = await s.req(s.url('cancel'));
  assert.doesNotMatch(cancelPage.body, /bwf-compact/, 'feature pages keep the full notice');
  // Pay page (signed in): the card number field says which cards are accepted.
  const li = await s.post('login', { username: s.ep.persona.phone, password: PASSWORD });
  assert.equal(li.status, 303, textOf(li.body).slice(0, 300));
  const pay = await s.req(s.url('wallet'));
  assert.match(pay.body, /name="cardNumber"/); assert.match(textOf(pay.body), /We accept Mastercard and Discover\./);
});

test('research-style notes never render; MFA, reset and register messages name the masked destination', async () => {
  assert.ok(RESEARCH_NOTE.test('Turning it off there is inferred.') && RESEARCH_NOTE.test('Cancel steps are not published.'));
  assert.ok(!RESEARCH_NOTE.test('To stop service, call 1-800-555-0100.'));
  assert.equal(mfaSent({ mfaChannel: 'email', mfaDestination: 'j•••@mail.test' }, 'We sent a 6-digit code to the email address on your account.'), 'We sent a 6-digit code to j•••@mail.test.');
  assert.equal(mfaSent({ mfaChannel: 'email', mfaDestination: 'j•••@mail.test' }, 'Enter the code.'), 'Enter the code. We sent it to j•••@mail.test.');
  // Reset by the biller's own sign-in identifier (phone) sends the code; the flash names the masked inbox.
  const w = new FleetWorld(); const ep = w.createEpisode({ seed: 'gaps-reset' }); const a = w.account(ep, MC.id);
  const r = w.requestReset(ep, MC.id, { identifier: ep.persona.phone }); assert.equal(r.sent, true); assert.match(r.to, /^.•••@/);
  assert.equal(a.resetChallenges.length, 1);
  assert.equal(w.requestReset(ep, MC.id, { identifier: 'nobody@example.com' }).sent, false);
  const s = await session(MC.id, { forgotPassword: true });
  const f = await s.follow(await s.post('forgot', { identifier: s.ep.persona.email }));
  assert.match(textOf(f.body), /We sent a verification code and a reset link to .•••@/);
});

test('register: missing dossier fields are named; guest lookup names missing required fields', () => {
  const reg = dedicate(util, 'zz-gaps-reg-000002', { auth: { registrationFields: ['zip', 'phone'] } });
  const w = new FleetWorld(); const ep = w.createEpisode({ seed: 'gaps-reg', scenario: { [reg.id]: { registered: false } } }); const a = w.account(ep, reg.id);
  assert.throws(() => w.register(ep, reg.id, { accountNumber: a.accountNumber, email: ep.persona.email, zip: a.zip, password: PASSWORD, confirm: PASSWORD }), e => e.code === 'missing' && /missing: phone number/.test(e.message));
  assert.throws(() => w.guestLookup(ep, reg.id, { accountNumber: a.accountNumber, lastName: ep.persona.last }, { required: ['zip'] }), e => e.code === 'no_match' && /Enter your ZIP code/.test(e.message));
  assert.throws(() => w.guestLookup(ep, reg.id, { accountNumber: '1', lastName: ep.persona.last }), e => e.code === 'no_match' && /exactly as it appears/.test(e.message));
});

test('withdrawn cancellation wording follows the kind', () => {
  const vm = kind => ({ biller: { kind }, url: () => '/x' });
  assert.match(String(withdrawnView(vm('subscription'))), /cancellation request was withdrawn\. Your membership/);
  assert.match(String(withdrawnView(vm('rent'))), /Your lease will continue/);
  assert.match(String(withdrawnView(vm('utility'))), /stop-service request was withdrawn\. Your service/);
});
