// Dedicated tier (billers/<id>.json dossiers): schema, catalog merge, engine rules, tasks and rendering.
// Run: node --test billworld/fleet/tests/dedicated.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadCatalog } from '../catalog.mjs';
import { validateDossier, contrastWithWhite, PREDICATE_TYPES, LABEL_KEYS } from '../billers/schema.mjs';
import { applyDossier, EVIDENCE_LABEL } from '../billers/load.mjs';
import { FleetWorld, PASSWORD } from '../engine.mjs';
import { generateTasks } from '../tasks.mjs';
import { helpArticles } from '../help.mjs';
import { L, navList } from '../kit.mjs';
import { KNOWN_PREDICATES, solverFor, taskShapeErrors, login } from './solve.mjs';
import { start } from '../server.mjs';

const catalog = loadCatalog();
const CONED = 'consolidated-edison-company-of-new-york-con-edis-1ac80c';
const coned = JSON.parse(readFileSync(new URL(`../billers/${CONED}.json`, import.meta.url)));
const pick = pred => [...catalog.billers.values()].find(b => b.tier === 'family' && pred(b));
const base = { id: 'x', status: 'dedicated', sources: [{ url: 'https://www.example.com/pay', title: 'Pay', fetchedAt: '2026-10-05', kind: 'pay' }] };
const S = base.sources[0].url;

// A synthetic dedicated biller cloned from a family biller (registered in the shared catalog for engine/server tests).
function dedicate(from, id, dossier) {
  const b = { ...from, id, entry: { ...from.entry, website: 'https://www.example.com/' }, capabilities: { ...from.capabilities }, brand: { ...from.brand }, fees: { ...from.fees } };
  const d = { ...base, id, ...dossier };
  const errs = validateDossier(d, { biller: b }); assert.deepEqual(errs, [], `synthetic dossier invalid: ${errs.join('; ')}`);
  applyDossier(b, d);
  catalog.billers.set(id, b); (catalog.byTemplate.get(b.template) || []).push(id);
  return b;
}
const util = pick(b => b.template === 'utility-account' && b.capabilities.guest_pay.support === 'supported' && b.contact?.phones?.length);
const STRICT = dedicate(util, 'zz-dedicated-strict-000001', {
  labels: { payBill: 'Make a Payment Now', autopay: 'Auto-Draft', amountDue: 'Balance Owed', signIn: 'Member Login' },
  nav: { public: [{ label: 'Member Login', page: 'login' }, { label: 'Ways to pay', helpSlug: 'pay-your-bill' }], account: [{ label: 'Overview', page: 'dashboard' }, { label: 'Make a Payment Now', page: 'pay' }] },
  auth: { identifier: 'account', loginSteps: 2, mfa: 'none', lockoutAttempts: 3, passwordRule: { pattern: '^(?=.*\\d)(?=.*[A-Z]).{12,}$', message: 'Use 12 or more characters with a capital letter and a number.' }, registrationFields: ['zip', 'lastName'], guestLookupFields: ['accountNumber', 'lastName'] },
  capabilities: { cancel_service: { support: 'unsupported', evidence: 'documented_official', source: S, note: 'To stop service, call customer service.', channel: 'phone' }, scheduled_payment: { support: 'unsupported', evidence: 'documented_official', source: S, note: 'Payments are processed the day you make them.' } },
  billing: { fees: { bankCents: 0, cardPercent: 2.5, evidence: 'documented_official', source: S }, methods: ['bank'], guestMethods: ['bank'], autopay: { policies: ['full'], days: [5, 15], methodTypes: ['bank'] }, minPaymentCents: 500, maxPaymentCents: 900000, scheduled: { maxDaysAhead: 0 }, lateFeePercent: 1.5 },
  help: [{ slug: 'pay-your-bill', title: 'Paying your bill', paragraphs: ['Pay from a checking account online.'], source: S }],
  tasks: { suppress: ['send-message'], extra: [{ slug: 'fee-question', intent: `Find out the card fee percentage on the ${util.brand.shortName} website and report it. Do not pay.`, predicates: [{ type: 'no_payment' }, { type: 'answer', kind: 'contains', expected: ['2.5%'] }], answer: { kind: 'contains', expected: ['2.5%'] }, tags: ['help'], solution: [{ op: 'answer', text: 'The card fee is 2.5%.' }] }] }
});
const tel = pick(b => b.template === 'telecom' && b.kind === 'telecom' && b.capabilities.pay_online.support === 'supported');
const PLANS = dedicate(tel, 'zz-dedicated-plans-000002', {
  billing: { plans: [{ id: 'lite', name: 'Lite 300', cents: 3500 }, { id: 'fast', name: 'Fast 1 Gig', cents: 7000, current: true }, { id: 'max', name: 'Max 5 Gig', cents: 11000 }] },
  auth: { mfa: 'sms', socialProviders: [] }
});

test('schema: the pilot dossier is valid; mistakes give clear errors', () => {
  assert.deepEqual(validateDossier(coned, { biller: catalog.billers.get(CONED), fileId: CONED }), []);
  assert.deepEqual([...KNOWN_PREDICATES].sort(), [...PREDICATE_TYPES].sort(), 'schema and solver agree on predicate types');
  const errs = d => validateDossier({ ...base, ...d }).join('\n');
  assert.match(errs({ status: 'family' }), /status/);
  assert.match(errs({ sources: [{ url: 'http://www.example.com/', title: 't', fetchedAt: '2026-10-05', kind: 'pay' }] }), /https/);
  assert.match(errs({ labels: { payBil: 'Pay' } }), /unknown label key/);
  assert.match(errs({ labels: { payBill: '' } }), /labels.payBill/);
  assert.match(errs({ brand: { primary: '#ffcc00' } }), /contrast/);
  assert.ok(contrastWithWhite('#006eb7') >= 4.5);
  assert.match(errs({ capabilities: { cancel_service: { support: 'unsupported', evidence: 'documented_official', source: S } } }), /note: required/);
  assert.match(errs({ capabilities: { teleport: { support: 'supported', evidence: 'inferred' } } }), /unknown capability/);
  assert.match(errs({ capabilities: { autopay: { support: 'supported', evidence: 'documented_official', source: 'https://elsewhere.example.org/' } } }), /sources\[\]\.url/);
  assert.match(errs({ auth: { passwordRule: { pattern: '^\\d{4}$', message: 'PIN' } } }), /must accept the fleet test password/);
  assert.match(errs({ tasks: { extra: [{ slug: 'x-y-z', intent: 'Do something long enough here.', predicates: [{ type: 'teleported' }], tags: ['a'], solver: 'pay-bank' }] } }), /known predicate type/);
  assert.match(errs({ tasks: { extra: [{ slug: 'x-y-z', intent: 'Do something long enough here.', predicates: [{ type: 'no_payment' }], tags: ['a'] }] } }), /solver/);
  assert.match(errs({ nav: { public: [{ label: 'Bills', page: 'bill' }] } }), /public nav may only use/);
  assert.equal(errs({ billing: { methods: ['card'] } }), '', 'card-only billers are allowed');
  assert.match(errs({ billing: { methods: [] } }), /non-empty subset/);
  assert.match(validateDossier({ ...base, id: CONED }, { biller: catalog.billers.get(CONED) }).join('\n'), /not the biller's own domain/);
  assert.equal(Object.keys(LABEL_KEYS).length > 20, true);
});

test('catalog: dossiers make billers dedicated; every other biller stays on the family tier', () => {
  const b = catalog.billers.get(CONED);
  assert.equal(b.tier, 'dedicated'); assert.equal(b.dossier.id, CONED); assert.equal(b.brand.shortName, 'Con Edison');
  assert.equal(b.fees.evidence, EVIDENCE_LABEL[b.dossier.billing.fees.evidence]); assert.equal(b.capabilities.guest_pay.evidence, 'documented_official');
  assert.ok(catalog.dedicated.includes(CONED)); assert.deepEqual(catalog.dossierErrors, {});
  assert.equal(Object.keys(b).includes('dossier'), false, 'the dossier is non-enumerable (biller JSON stays compact)');
  const ded = new Set(catalog.dedicated);
  const fam = [...catalog.billers.values()].filter(x => !x.id.startsWith('zz-') && !ded.has(x.id));
  assert.ok(fam.length > 59000 && fam.every(x => x.tier === 'family' && !x.dossier));
  assert.ok(catalog.dedicated.every(id => catalog.billers.get(id)?.tier === 'dedicated' && catalog.billers.get(id).dossier?.id === id));
});

test('engine: identifier, lockout, password rule, methods, AutoPay options, limits, scheduling and late fees follow the dossier', () => {
  const w = new FleetWorld(); const id = STRICT.id;
  const ep = w.createEpisode({ seed: 'strict', scenario: { [id]: { pastDueCents: 2000 } } });
  const acct = w.account(ep, id);
  assert.throws(() => w.login(ep, id, { username: ep.persona.email, password: PASSWORD }), /incorrect/, 'account-number sign-in refuses the email');
  const sid = w.login(ep, id, { username: acct.accountNumber, password: PASSWORD }).sid; assert.ok(sid);
  assert.ok(acct.invoices.at(-1).lines.some(l => l.desc === 'Late payment charge' && l.cents === 30), '1.5% late charge on the $20.00 past-due balance');
  assert.equal(acct.methods.some(m => m.type === 'card'), false, 'no saved card where cards are not accepted');
  assert.throws(() => w.draftPayment(ep, id, sid, { amountChoice: 'other', amount: '25.00', methodType: 'card', cardNumber: '4111111111111111', exp: '12/29', cvv: '123' }), e => e.code === 'method_not_accepted');
  assert.throws(() => w.draftPayment(ep, id, sid, { amountChoice: 'other', amount: '4.00', methodId: 'pm-chk' }), e => e.code === 'min_amount');
  assert.throws(() => w.draftPayment(ep, id, sid, { amountChoice: 'due', methodId: 'pm-chk', payOn: '2026-10-10' }), e => e.code === 'unsupported');
  assert.throws(() => w.autopay(ep, id, sid, { methodId: 'pm-chk', policy: 'fixed', fixedAmount: '50', acceptTerms: true }), e => e.code === 'bad_policy');
  assert.throws(() => w.autopay(ep, id, sid, { methodId: 'pm-chk', policy: 'full', day: '9', acceptTerms: true }), e => e.code === 'bad_day');
  assert.equal(w.autopay(ep, id, sid, { methodId: 'pm-chk', policy: 'full', day: '15', acceptTerms: true }).day, 15);
  assert.throws(() => w.cancelService(ep, id, sid, { step: 'reason', reason: 'moving' }), e => e.code === 'unsupported');
  const ep2 = w.createEpisode({ seed: 'strict2' }); const a2 = w.account(ep2, id);
  for (let i = 0; i < 3; i++) assert.throws(() => w.login(ep2, id, { username: a2.accountNumber, password: 'nope' }));
  assert.throws(() => w.login(ep2, id, { username: a2.accountNumber, password: PASSWORD }), e => e.code === 'locked', 'three failures lock');
  w.requestReset(ep2, id, { identifier: a2.accountNumber });
  const code = ep2.mailbox.find(m => /^Reset your/.test(m.subject)).text.match(/Verification code: (\d{6})/)[1];
  assert.throws(() => w.resetPassword(ep2, id, { code, password: 'Short-1a!', confirm: 'Short-1a!' }), /12 or more characters/);
  w.resetPassword(ep2, id, { code, password: 'Renewed-Pass-2026!', confirm: 'Renewed-Pass-2026!' });
  // Plans and SMS-only MFA.
  const ep3 = w.createEpisode({ seed: 'plans', scenario: { [PLANS.id]: { mfa: 'default' } } }); const a3 = w.account(ep3, PLANS.id);
  assert.equal(a3.service.plan, 'fast'); assert.equal(a3.mfa, 'sms'); assert.deepEqual(w.plans(a3).map(p => p.name), ['Lite 300', 'Fast 1 Gig', 'Max 5 Gig']);
  const s3 = login(w, ep3, PLANS.id); w.changePlan(ep3, PLANS.id, s3, { planId: 'lite' }); assert.equal(a3.service.plan, 'lite');
});

test('tasks: limitation tasks, suppression, dossier tasks, method/MFA filtering; every task is solvable and not a no-op', () => {
  const slugs = b => generateTasks(b).map(t => t.id.slice(b.id.length + 1));
  const s = slugs(STRICT);
  assert.ok(s.includes('cancel-service-limitation') && s.includes('schedule-limitation') && s.includes('fee-question'));
  for (const x of ['send-message', 'cancel-service', 'pay-partial-card', 'declined-retry', 'remove-old-card', 'autopay-switch-to-card', 'mfa-pay', 'sms-mfa-pay', 'schedule-payment']) assert.ok(!s.includes(x), `${x} not generated`);
  const p = slugs(PLANS); assert.ok(p.includes('sms-mfa-pay') && !p.includes('mfa-pay') && p.includes('downgrade-plan'));
  assert.equal(generateTasks(PLANS).find(t => t.id.endsWith(':downgrade-plan')).predicates.find(x => x.type === 'service').plan, 'lite');
  const lim = generateTasks(STRICT).find(t => t.id.endsWith(':cancel-service-limitation'));
  assert.deepEqual(lim.answer.expected.phones, STRICT.contact.phones.concat(STRICT.contact.payPhones || []).filter((v, i, a) => a.indexOf(v) === i));
  assert.ok(generateTasks(STRICT).filter(t => t.predicates.some(x => x.type === 'logged_in' || x.type === 'payment')).every(t => t.scenario[STRICT.id].billNotice && /account number/.test(t.intent)), 'account-number sign-in tasks carry the bill notice');
  const w = new FleetWorld();
  for (const b of [STRICT, PLANS, catalog.billers.get(CONED)]) for (const t of generateTasks(b)) {
    if (t.id.endsWith(':google-login-pay')) continue;
    assert.deepEqual(taskShapeErrors(t, b), [], t.id);
    const idle = w.createEpisode({ seed: `idle:${t.id}`, scenario: t.scenario }); w.account(idle, b.id);
    assert.equal(w.evaluate(idle, t.predicates).success, false, `${t.id} passes without action`);
    const ep = w.createEpisode({ seed: `solve:${t.id}`, scenario: t.scenario }); w.account(ep, b.id);
    solverFor(t)(w, ep, b.id, {}); const r = w.evaluate(ep, t.predicates);
    assert.ok(r.success, `${t.id}: ${JSON.stringify(r.results.filter(x => !x.pass))}`);
  }
});

test('help and kit: dossier wording and articles; family billers are unchanged', () => {
  const h = helpArticles(STRICT);
  assert.deepEqual(h.find(a => a.slug === 'pay-your-bill').paragraphs.slice(0, 1), ['Pay from a checking account online.']);
  assert.ok(h.find(a => a.slug === 'cancel-service').paragraphs.includes('To stop service, call customer service.'));
  assert.ok(h.find(a => a.slug === 'pay-your-bill').paragraphs.some(x => /late payment charge of 1.5%/.test(x)));
  assert.equal(String(L({ labels: {} }, 'pay', 'Pay Bill')), 'Pay Bill');
  assert.equal(L({ labels: { payBill: 'Pay Now' } }, 'pay', 'Pay Bill'), 'Pay Now');
  assert.equal(L({ labels: { signIn: 'Log In' } }, 'login', 'Sign in'), 'Log In');
  const vm = { labels: {}, nav: { account: [{ label: 'Bills', page: 'bill' }] }, has: () => true, help: [] };
  assert.deepEqual(navList(vm, 'account', [['dashboard', 'Home'], ['bill', 'View bill']]).map(x => String(x[1])), ['Bills', 'Home']);
  assert.ok(helpArticles(util).every(a => !a.dossier && a.evidence !== 'documented_official'), 'no dossier, no dossier content');
});

test('server: labels, dossier nav, sign-in steps, required fields and capability notes render; family pages carry none of it', async () => {
  const s = await start({ port: 0, adminPort: 0, quiet: true, google: false });
  try {
    const get = async (id, pg, sid, params) => {
      const ep = s.world.episode((await s.admin('/episodes', { billerId: id, seed: `r:${pg}` })).episodeId); const port = new URL(s.baseUrl).port;
      const sess = sid ? `; bwf_sid=${sid(ep)}` : '';
      return (await fetch(s.baseUrl + s.urlFor(s.templateFor(s.world.biller(id)), id, pg, params || {}), { headers: { cookie: `bwf_ep_${port}=${ep.id}; bwf_at_${port}=${ep.entryToken}${sess}` }, redirect: 'manual' })).text();
    };
    const home = await get(STRICT.id, 'home');
    assert.match(home, /data-dossier-nav="public"/); assert.match(home, /Member Login/); assert.match(home, /To stop service, call customer service\./);
    const loginPage = await get(STRICT.id, 'login');
    assert.match(loginPage, /Account number/); assert.doesNotMatch(loginPage, /name="password"/, 'two-step sign-in: no password on the first step');
    assert.match(await get(STRICT.id, 'register'), /name="zip"/);
    const authed = ep => s.world.login(ep, STRICT.id, { username: s.world.account(ep, STRICT.id).accountNumber, password: PASSWORD }).sid;
    const dash = await get(STRICT.id, 'dashboard', authed);
    assert.match(dash, /data-dossier-nav="account"/); assert.match(dash, /Make a Payment Now/); assert.match(dash, /Balance Owed/);
    const pay = await get(STRICT.id, 'pay', authed); assert.doesNotMatch(pay, /name="cardNumber"/, 'cards not offered');
    const ap = await get(STRICT.id, 'autopay', authed); assert.doesNotMatch(ap, /name="policy" value="fixed"/);
    assert.match(await get(STRICT.id, 'cancel', authed), /To stop service, call customer service\./);
    // A family biller of the same template: no dossier markup at all.
    const fam = await get(util.id, 'home');
    assert.doesNotMatch(fam, /data-dossier-nav|data-capnotes|bwf-capnotes/);
    const pilot = await get(CONED, 'home'); assert.match(pilot, /Pay as Guest/); assert.match(pilot, /Payment Plans &amp; Assistance/);
  } finally { await s.close(); }
});

// Integrated cross-owner requests: rules a dossier can now state (late charge floor, full balance only, pending cap,
// phone-only guest lookup, offline plan changes, contact override, card AutoPay and guest fees).
const RULES = dedicate(tel, 'zz-dedicated-rules-000003', {
  contact: { phone: '800-555-0199', source: S },
  auth: { guestLookupFields: ['phone'], guestLookupExact: true },
  capabilities: { change_plan: { support: 'unsupported', evidence: 'documented_official', source: S, note: 'Plan changes are made by phone.', channel: 'phone' }, guest_pay: { support: 'supported', evidence: 'documented_official', source: S }, scheduled_payment: { support: 'supported', evidence: 'documented_official', source: S } },
  billing: { fullBalanceOnly: true, lateFeePercent: 1, lateFeeMinCents: 3500, scheduled: { maxPending: 1 }, fees: { bankCents: 0, cardCents: 0, autopayCardCents: 350, guestCardCents: 495, notes: ['A fee applies to payments made with an agent.'], evidence: 'documented_official', source: S },
    plans: [{ id: 'lite', name: 'Lite', cents: 3000 }, { id: 'plus', name: 'Plus', cents: 6000, current: true }] }
});
test('engine, tasks and help follow the integrated dossier rules', () => {
  const w = new FleetWorld(); const id = RULES.id;
  assert.equal(RULES.contact.phone, '800-555-0199'); assert.equal(RULES.contact.phones[0], '8005550199');
  const ep = w.createEpisode({ seed: 'rules', scenario: { [id]: { pastDueCents: 2000, scheduledPayment: true } } });
  const acct = w.account(ep, id);
  assert.ok(acct.invoices.at(-1).lines.some(l => l.desc === 'Late payment charge' && l.cents === 3500), 'greater of 1% or $35.00');
  const sid = login(w, ep, id);
  assert.throws(() => w.draftPayment(ep, id, sid, { amountChoice: 'other', amount: '25.00', methodId: 'pm-chk' }), e => e.code === 'full_balance_only');
  assert.throws(() => w.draftPayment(ep, id, sid, { amountChoice: 'due', methodId: 'pm-chk', payOn: '2026-10-20' }), e => e.code === 'max_pending');
  assert.throws(() => w.changePlan(ep, id, sid, { planId: 'lite' }), e => e.code === 'unsupported');
  assert.throws(() => w.setupArrangement(ep, id, sid, { months: 6 }), e => e.code === 'unsupported');
  assert.equal(w.fee(id, { type: 'card' }, 10000, { autopay: true }), 350); assert.equal(w.fee(id, { type: 'card', guestSid: 'g' }, 10000), 495); assert.equal(w.fee(id, { type: 'card' }, 10000), 0);
  const ep2 = w.createEpisode({ seed: 'rules2' });
  assert.throws(() => w.guestLookup(ep2, id, { phone: '555-000-0000' }), e => e.code === 'no_match');
  assert.ok(w.guestLookup(ep2, id, { phone: ep2.persona.phone }).sid, 'phone alone finds the bill when the lookup is exact');
  const slugs = generateTasks(RULES).map(t => t.id.slice(id.length + 1));
  assert.ok(slugs.includes('plan-change-limitation') && !slugs.includes('downgrade-plan'));
  assert.ok(!slugs.some(s => ['pay-minimum', 'pay-partial-card', 'setup-payment-plan'].includes(s)));
  const pay = helpArticles(RULES).find(a => a.slug === 'pay-your-bill').paragraphs.join(' ');
  assert.match(pay, /whichever is greater/); assert.match(pay, /full balance/); assert.match(pay, /agent/);
});

// Card-only billers: no saved checking account; generated tasks use the saved Visa and every one is solvable.
const CARDONLY = dedicate(pick(b => b.template === 'streaming' && b.capabilities.pay_online.support === 'supported' && b.capabilities.autopay.support === 'supported'), 'zz-dedicated-cardonly-000004', { billing: { methods: ['card'] } });
test('card-only dossier: Visa is the primary method; tasks switch to it and stay solvable', () => {
  const w = new FleetWorld(); const id = CARDONLY.id;
  const ep0 = w.createEpisode({ seed: 'card0', scenario: { [id]: { autopay: true, scheduledPayment: true } } }); const a0 = w.account(ep0, id);
  assert.equal(a0.methods.some(m => m.type === 'bank'), false, 'no checking account seeded');
  assert.equal(a0.autopay.methodId, 'pm-card'); assert.ok(a0.payments.every(p => p.methodType === 'card'));
  const tasks = generateTasks(CARDONLY); const slugs = tasks.map(t => t.id.slice(id.length + 1));
  assert.ok(!slugs.includes('declined-retry') && !slugs.includes('register-and-pay') && !slugs.includes('autopay-switch-to-card'));
  const payBank = tasks.find(t => t.id.endsWith(':pay-bank')); assert.match(payBank.intent, /saved Visa card/); assert.equal(payBank.exportable, false);
  for (const t of tasks) {
    if (t.id.endsWith(':google-login-pay')) continue;
    assert.ok(!JSON.stringify(t.predicates).includes('pm-chk'), `${t.id} uses no checking account`);
    const ep = w.createEpisode({ seed: `card:${t.id}`, scenario: t.scenario }); w.account(ep, id);
    solverFor(t)(w, ep, id, {}); const r = w.evaluate(ep, t.predicates);
    assert.ok(r.success, `${t.id}: ${JSON.stringify(r.results.filter(x => !x.pass))}`);
  }
});
