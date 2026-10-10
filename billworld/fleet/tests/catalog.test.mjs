// Catalog invariants: every research record becomes one addressable biller with a stable id, a known template
// and a valid capability profile. Run: node --test billworld/fleet/tests/catalog.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { loadCatalog, resolveTemplate, capabilities, slugify, hash, kindFor, OFFLINE_SIGNALS, contactInfo, displayPhone, phoneDigits, resolveBiller, observedResolution, observedCapabilities, profileIndex, loadProfile, RECLASS_KINDS } from '../catalog.mjs';
import { helpArticles, observedExcerpt } from '../help.mjs';
import { helpBody } from '../kit.mjs';
import { extractPage, navLabels, footerLabels, heroHeading, loginFacts, excerptFor } from '../profiles/extract.mjs';
import { DEFAULT_ROUTES } from '../server.mjs';

// generic (fallback) + the 26 portal experiences the catalog resolves to.
export const TEMPLATE_IDS = ['generic', 'smarthub', 'invoicecloud', 'xpress', 'paymentus', 'kubra', 'doxo', 'mychart', 'patient-pay', 'health-plan', 'municipal-portal', 'property-tax', 'income-tax', 'utility-account', 'waste-hauler', 'offline', 'telecom', 'streaming', 'newspaper', 'card-servicer', 'bank-billpay', 'loan-servicer', 'insurance', 'rent-portal', 'invoice-portal', 'dmv', 'toll-account'];
const CANONICAL_PAGES = ['home', 'login', 'loginPassword', 'mfa', 'register', 'verify', 'forgot', 'reset', 'guest', 'guestPay', 'guestReview', 'guestReceipt', 'dashboard', 'bill', 'statements', 'pay', 'payMethod', 'payReview', 'payReceipt', 'history', 'autopay', 'paperless', 'wallet', 'cancel', 'plan', 'arrangement', 'contact', 'profile', 'help', 'helpArticle', 'helpSearch'];
const SUPPORT = new Set(['supported', 'unsupported', 'unknown', 'not_applicable']);
const EVIDENCE = new Set(['documented_link', 'documented_notes', 'documented_notes_negative', 'documented_field', 'inferred_category', 'inferred_from_login', 'inferred_family', 'synthetic_flow', 'not_applicable', 'not_observed', 'unknown', 'observed_public', ...OFFLINE_SIGNALS]);
const CAP_KEYS = ['online_account', 'registration', 'password_reset', 'view_bill', 'statements', 'pay_online', 'guest_pay', 'autopay', 'autopay_cancel', 'scheduled_payment', 'paperless', 'cancel_service', 'payment_assistance', 'payment_arrangement', 'pay_by_phone', 'pay_by_mail', 'google_login'];
const KINDS = new Set(['utility', 'telecom', 'subscription', 'card', 'loan', 'medical', 'tax', 'government', 'toll', 'rent', 'insurance', 'invoice']);
const templatesDir = new URL('../templates/', import.meta.url);
const categoriesDir = new URL('../../../categories/', import.meta.url);

const catalog = loadCatalog();
const billers = [...catalog.billers.values()];
// Family-tier billers: rendered purely from template + record + profile. Dedicated billers (billers/<id>.json dossiers)
// override template/capabilities/fees/brand by design and are covered by tests/dedicated.test.mjs.
const familyBillers = billers.filter(b => b.tier !== 'dedicated');
const records = readdirSync(categoriesDir).filter(f => f.endsWith('.json')).sort().flatMap(f => JSON.parse(readFileSync(new URL(f, categoriesDir))).entries.map((e, i) => ({ file: `categories/${f}`, index: i, entry: e })));

test('template id list: generic + 26 portal experiences, no duplicates', () => {
  assert.equal(TEMPLATE_IDS.length, 27);
  assert.equal(new Set(TEMPLATE_IDS).size, 27);
  assert.deepEqual([...catalog.byTemplate.keys()].sort(), TEMPLATE_IDS.filter(t => t !== 'generic').sort(), 'catalog resolves to exactly the 26 non-generic templates');
});

test('every research record becomes exactly one biller', () => {
  assert.equal(records.length, 59477, 'catalog size changed: update this test and the README deliberately');
  assert.equal(billers.length, records.length);
  assert.equal(catalog.collisions.length, 0, `id collisions: ${catalog.collisions.slice(0, 5)}`);
  const seen = new Set(billers.map(b => `${b.source.file}#${b.source.index}`));
  assert.equal(seen.size, records.length, 'each (file, index) maps to one biller');
  for (const r of records) assert.ok(seen.has(`${r.file}#${r.index}`), `missing ${r.file}#${r.index}`);
  const total = [...catalog.byTemplate.values()].reduce((a, ids) => a + ids.length, 0);
  assert.equal(total, billers.length, 'byTemplate partitions the catalog');
});

test('biller ids are unique, URL-safe and stable', () => {
  const ids = billers.map(b => b.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const b of billers) {
    assert.match(b.id, /^[a-z0-9-]+-[0-9a-f]{6}$/, b.id);
    // Recompute from the documented identity recipe.
    const identity = [b.category, b.entry.name, b.entry.bill_type, (b.entry.service_area || []).join(','), b.entry.service_area_detail || ''].join('|');
    assert.equal(b.id, `${slugify(b.entry.name)}-${hash(identity, 6)}`);
    assert.equal(b.source.record_hash, hash(JSON.stringify(b.entry), 16));
  }
  // Golden ids observed when the fleet was built; these must never change (task ids and episode logs reference them).
  for (const id of ['bank-of-america-credit-cards-8e8b1e', 'city-of-mesa-utilities-mesa-electric-az-dd9a6c', 'gainesville-regional-utilities-gru-4d0df3', 'golden-gate-bridge-tolls-0d8c4c', 'cubesmart-fe3b27', 'nevada-dmv-vehicle-registration-renewal-07bb31', 'michaelstm-credit-card-comenity-147b29']) assert.ok(catalog.billers.has(id), `golden id ${id} missing`);
});

test('ids and resolution do not depend on process state', async () => {
  const fresh = await import(`../catalog.mjs?reload=${Date.now()}`);
  const again = fresh.loadCatalog();
  assert.notEqual(again, catalog, 'a fresh module instance was loaded');
  const fp = c => createHash('sha256').update([...c.billers.keys()].sort().join('\n')).digest('hex');
  assert.equal(fp(again), fp(catalog));
  for (const [id, b] of catalog.billers) { const o = again.billers.get(id); assert.equal(o.template, b.template); assert.deepEqual(o.capabilities, b.capabilities); assert.deepEqual(o.brand, b.brand); }
});

test('every biller resolves to one of the expected templates', () => {
  for (const b of familyBillers) {
    assert.ok(TEMPLATE_IDS.includes(b.template) && b.template !== 'generic', `${b.id}: template ${b.template}`);
    assert.ok(KINDS.has(b.kind), `${b.id} kind ${b.kind}`);
    assert.equal(b.kind, kindFor(b.entry.bill_type, b.entry));
    if (b.family) assert.equal(b.template, b.family, 'family templates are named after their family');
    assert.ok(['processor_or_route', 'category', 'observed_public_domain', ...OFFLINE_SIGNALS].includes(b.signal));
    assert.equal(b.template === 'offline', OFFLINE_SIGNALS.includes(b.signal));
  }
  for (const b of familyBillers.filter((_, i) => i % 7 === 0)) {
    assert.deepEqual(resolveBiller(b.entry, b.id).resolved, { template: b.template, family: b.family, kind: b.kind, signal: b.signal });
    // Without an observed family the research-only resolution stands.
    if (b.signal !== 'observed_public_domain') assert.deepEqual(resolveTemplate(b.entry), { template: b.template, family: b.family, kind: b.kind, signal: b.signal });
  }
});

test('template files: generic exists, no unexpected files, missing ones fall back', t => {
  const present = new Set(readdirSync(templatesDir).filter(f => f.endsWith('.mjs') && !f.startsWith('_')).map(f => f.replace(/\.mjs$/, '')));
  assert.ok(present.has('generic'), 'generic fallback must exist');
  for (const id of present) assert.ok(TEMPLATE_IDS.includes(id), `unexpected template file ${id}.mjs`);
  // Templates may still be in progress; the server renders those billers with generic until the file lands.
  const missing = TEMPLATE_IDS.filter(id => !present.has(id));
  if (missing.length) t.diagnostic(`template files not yet present (generic fallback): ${missing.join(', ')}`);
});

test('template modules honor the contract', async t => {
  for (const id of TEMPLATE_IDS) {
    if (!existsSync(new URL(`${id}.mjs`, templatesDir))) continue;
    await t.test(id, async () => {
      const mod = await import(new URL(`${id}.mjs`, templatesDir).href);
      assert.equal(mod.meta?.id, id, 'meta.id matches file name');
      assert.equal(typeof mod.meta.name, 'string', 'meta.name');
      assert.ok(Array.isArray(mod.meta.families) && Array.isArray(mod.meta.sources), 'meta.families/sources');
      if (id !== 'generic') assert.ok(mod.meta.evidence && ['observed_public', 'documented', 'synthetic'].every(k => Array.isArray(mod.meta.evidence[k])), 'meta.evidence lists');
      assert.equal(typeof mod.render, 'function', 'render()');
      assert.equal(typeof (mod.css ?? ''), 'string', 'css');
      if (mod.js != null) assert.equal(typeof mod.js, 'string', 'js');
      const routes = { ...DEFAULT_ROUTES, ...(mod.routes || {}) };
      for (const page of CANONICAL_PAGES) assert.ok(routes[page]?.startsWith('/'), `route ${page}`);
      for (const [page, param] of [['helpArticle', ':slug'], ['statement', ':id'], ['payReceipt', ':id'], ['guestReceipt', ':id']]) assert.ok(routes[page].includes(param), `${page} keeps ${param}`);
      const paths = Object.values(routes); assert.equal(new Set(paths).size, paths.length, 'route paths unique');
      const flow = mod.flow || {};
      for (const s of [...(flow.paySteps || []), ...(flow.guestSteps || [])]) assert.ok(CANONICAL_PAGES.includes(s), `flow step ${s}`);
      if (flow.paySteps) { assert.equal(flow.paySteps.at(-1), 'payReview', 'pay flow ends at payReview'); assert.equal(new Set(flow.paySteps).size, flow.paySteps.length, 'pay steps unique'); }
      if (flow.loginSteps != null) assert.ok([1, 2].includes(flow.loginSteps), 'loginSteps');
    });
  }
});

test('capability profiles use valid labels and respect offline', () => {
  for (const b of familyBillers) {
    assert.deepEqual(Object.keys(b.capabilities), CAP_KEYS, b.id);
    for (const [k, c] of Object.entries(b.capabilities)) {
      assert.ok(SUPPORT.has(c.support), `${b.id} ${k} support ${c.support}`);
      assert.ok(EVIDENCE.has(c.evidence), `${b.id} ${k} evidence ${c.evidence}`);
    }
    const offline = b.template === 'offline';
    assert.equal(b.capabilities.online_account.support !== 'supported', offline, `${b.id}: online_account tracks offline`);
    // Offline billers make no positive claims; unresearched roster records stay unknown and non-billers not_applicable.
    const offlineSupport = b.signal === 'unresearched_roster' ? 'unknown' : b.signal === 'informational' ? 'not_applicable' : 'unsupported';
    if (offline) for (const k of CAP_KEYS.filter(k => !['pay_by_phone', 'pay_by_mail', 'google_login'].includes(k))) assert.equal(b.capabilities[k].support, offlineSupport, `${b.id} ${k}`);
    else {
      for (const k of ['online_account', 'registration', 'password_reset', 'view_bill', 'statements', 'scheduled_payment']) assert.equal(b.capabilities[k].support, 'supported', `${b.id} ${k}`);
      assert.ok(b.capabilities.pay_online.support === 'supported' || b.capabilities.pay_online.evidence === 'documented_notes_negative', `${b.id} pay_online`);
      if (b.capabilities.cancel_service.support === 'not_applicable') assert.equal(b.capabilities.cancel_service.evidence, 'not_applicable');
    }
    if (b.capabilities.pay_by_phone.support === 'supported') assert.ok(b.entry.phone_pay_by_phone);
    if (b.capabilities.pay_by_mail.support === 'supported') assert.ok(b.entry.mail_payment_address);
    if (b.capabilities.autopay.evidence === 'documented_link') assert.ok(b.entry.links?.autopay_setup);
    assert.deepEqual(resolveBiller(b.entry, b.id).capabilities, b.capabilities);
    assert.deepEqual(observedCapabilities(capabilities(b.entry, { template: b.template, kind: b.kind, signal: b.signal }), b, profileIndex()?.billers?.[b.id]), b.capabilities);
    for (const [k, c] of Object.entries(b.capabilities)) if (c.evidence === 'observed_public') { assert.equal(c.support, 'supported', `${b.id} ${k}`); assert.ok(profileIndex()?.billers?.[b.id]?.o?.includes(k), `${b.id} ${k} observed without an observation`); }
  }
});

test('fees and brands are well formed', () => {
  for (const b of familyBillers) {
    const f = b.fees;
    assert.ok(['synthetic', 'documented_notes'].includes(f.evidence));
    if (f.cardPercent != null) assert.ok(f.cardPercent > 0 && f.cardPercent < 10);
    if (f.cardCents != null) assert.ok(Number.isInteger(f.cardCents) && f.cardCents >= 0 && f.cardCents <= 5000);
    if (f.evidence === 'synthetic') assert.ok(f.cardPercent == null && f.cardCents == null && f.bankCents == null);
    assert.match(b.brand.primary, /^#[0-9a-f]{6}$/); assert.match(b.brand.accent, /^#[0-9a-f]{6}$/);
    assert.ok(b.brand.monogram.length >= 1 && b.brand.monogram.length <= 2, `${b.id} monogram ${b.brand.monogram}`);
    assert.ok(b.brand.shortName.length > 0);
  }
});

test('family resolution: documented hosts first, processor before notes, negations and place names ignored', () => {
  const base = { name: 'Test Utility', bill_type: 'water', entity_type: 'municipal', tier: 'detailed', website: 'https://example.gov', login_url: null, links: {}, payment_processor: null, notes: '' };
  const r = e => resolveTemplate({ ...base, ...e });
  assert.equal(r({ links: { pay_bill: 'https://acme.smarthub.coop/' } }).template, 'smarthub', 'host rule on a documented pay link');
  assert.equal(r({ links: { pay_bill: 'https://acme.epayub.com/' } }).template, 'municipal-portal');
  assert.equal(r({ payment_processor: 'Xpress Bill Pay (returned from Invoice Cloud; Invoice Cloud ended 2025)' }).template, 'xpress', 'earliest processor mention wins');
  assert.equal(r({ notes: 'The city replaced xpress bill pay in 2026.' }).template, 'municipal-portal', 'negated mention ignored');
  assert.equal(r({ bill_type: 'electric', entity_type: 'cooperative', notes: 'Members are warned that doxo is a third-party payer and not affiliated.' }).template, 'utility-account', 'doxo warning is not a doxo signal');
  assert.equal(r({ name: 'Cedar Park Utility Billing', notes: 'Serves cedar park, tx.' }).template, 'municipal-portal', 'place names are not Cedar');
  assert.equal(r({ name: 'Collins Community Credit Union', bill_type: 'credit-union', entity_type: 'credit union', notes: 'HQ Cedar Rapids IA.' }).template, 'bank-billpay');
  assert.equal(r({ name: 'Iowa County Treasurer', bill_type: 'property-tax', entity_type: 'county', payment_processor: 'Iowa Tax and Tags' }).template, 'property-tax', 'income-tax family only for income tax');
  assert.equal(r({ name: 'Ally Auto', bill_type: 'auto-loan', entity_type: 'private', payment_processor: 'in-house; ACI Pay (phone payments)' }).template, 'loan-servicer');
  assert.equal(r({ name: 'Audibel', bill_type: 'hearing', entity_type: 'private', payment_processor: 'CareCredit (Synchrony) for financing' }).template, 'patient-pay', 'financing mention is not a card account');
  assert.equal(r({ name: 'Daily Breeze (Torrance, CA) - newspaper subscription', bill_type: 'subscription', entity_type: 'private' }).template, 'newspaper');
});

test('offline resolution distinguishes unresearched, informational and documented records', () => {
  const base = { name: 'Harmon Hospital', bill_type: 'medical', entity_type: 'private', tier: 'roster', website: null, login_url: null, links: {}, payment_processor: null, notes: 'Use the phone number on the bill.' };
  const unr = resolveTemplate(base); assert.deepEqual([unr.template, unr.signal], ['offline', 'unresearched_roster']);
  assert.equal(capabilities(base, unr).pay_online.support, 'unknown', 'not researched is not a negative claim');
  const linked = resolveTemplate({ ...base, links: { pay_bill: 'https://www.patientportal.me/ComstarBilling' } }); assert.equal(linked.template, 'patient-pay');
  const prog = resolveTemplate({ ...base, name: 'Minnesota LIHEAP - Energy Assistance Program', bill_type: 'other', website: 'https://mn.gov' }); assert.deepEqual([prog.template, prog.signal], ['offline', 'informational']);
  assert.equal(resolveTemplate({ ...base, name: 'Compass Emergency Physicians Psc', website: 'https://x.com' }).signal, 'category', '"Psc" is not a regulator');
  const neg = resolveTemplate({ ...base, tier: 'detailed', website: 'https://x.com', notes: 'There is no online bill pay. No online portal is published.' }); assert.equal(neg.signal, 'documented_no_online');
  const cons = resolveTemplate({ ...base, bill_type: 'electric', entity_type: 'cooperative', website: 'https://4r.coop', login_url: 'https://4r.smarthub.coop', notes: 'Offers consolidated billing.' }); assert.equal(cons.template, 'smarthub', 'own portal beats consolidated wording');
  assert.equal(kindFor('medicare-premium', { name: 'Utah Medicaid Spenddown' }), 'invoice');
  assert.equal(kindFor('home-services', { name: 'BAYADA Home Health Care' }), 'medical');
});

test('contact fields are cleaned for display; research provenance never reaches the site', () => {
  const raw = "800-856-4362 (context: '...11pm Sat: 9am-11pm Sun: Noon-5pm 907-777-4362'); 888-817-4342 (context: '...-11pm Sun')";
  assert.equal(displayPhone(raw), '800-856-4362; 888-817-4342');
  assert.equal(displayPhone('800-382-5465 (tel: link on firsthorizon.com contact-us page, fetched 2026-09-29)'), '800-382-5465');
  assert.equal(displayPhone('1-800-374-9700 (TTY 711)'), '1-800-374-9700 (TTY 711)');
  assert.deepEqual(phoneDigits(raw).slice(0, 2), ['8008564362', '9077774362']);
  const bad = /context:|fetched \d{4}|\bper [a-z0-9.-]+\.(?:com|org|gov)|<[a-z/]/i;
  for (const b of billers) { const c = b.contact; for (const v of [c.phone, c.payPhone, c.mailAddress, c.serviceArea]) if (v) assert.ok(!bad.test(v), `${b.id}: ${v}`); }
  assert.deepEqual(contactInfo({ phone_customer_service: null, service_area: ['NC'], service_area_detail: 'HQ Charlotte, NC; bank card issuer' }).serviceArea, 'NC');
});

// ---------- observed public profiles (profiles/, built from research-data captures) ----------
const index = profileIndex();
const PROFILE_KINDS = new Set(['pay_bill', 'view_bill', 'statements_history', 'autopay_setup', 'autopay_cancel', 'paperless', 'payment_assistance', 'help_center']);
const FIELD_KINDS = new Set(['password', 'email', 'account', 'username', 'phone', 'zip', 'last_name', 'date_of_birth', 'text']);
const strList = (v, max) => Array.isArray(v) && v.length <= max && v.every(x => typeof x === 'string' && x.length > 0);

test('profiles: shipped files load, ids join to fleet billers, coverage is reported', t => {
  if (!index) return t.skip('profiles/index.json not built');
  assert.equal(index.source, 'research-data');
  const stats = JSON.parse(readFileSync(new URL('../profiles/stats.json', import.meta.url)));
  assert.equal(stats.joined, 59477, 'every fleet biller joins to a research-data biller');
  assert.equal(stats.unmatched, 0);
  assert.ok(stats.profiles >= 30000, `profiles ${stats.profiles}`);
  for (const id of Object.keys(index.billers)) assert.ok(catalog.billers.has(id), `index id ${id} is not a fleet biller`);
  assert.ok(statSync(new URL('../profiles/profiles.jsonl.gz', import.meta.url)).size < 50 * 1024 * 1024, 'profiles file stays under 50 MB');
});

test('profiles: biller.profile honors the shared contract, lazily and non-enumerably', t => {
  if (!index) return t.skip('profiles/index.json not built');
  let checked = 0, nulls = 0;
  for (const [i, b] of billers.entries()) {
    if (i % 4) continue;
    assert.ok(!Object.keys(b).includes('profile'), 'profile is not enumerable');
    const p = b.profile;
    if (!index.billers[b.id]) { assert.equal(p, null); nulls++; continue; }
    checked++;
    assert.equal(p.source, 'research-data'); assert.equal(p.evidence, 'observed_public');
    assert.ok(Object.isFrozen(p), 'profiles are immutable');
    if (p.website) {
      assert.match(p.website.finalUrl, /^https?:\/\//);
      assert.ok(strList(p.website.navLabels, 12) && strList(p.website.footerLabels, 16));
      for (const k of ['title', 'description', 'themeColor', 'heroHeading']) assert.ok(p.website[k] == null || typeof p.website[k] === 'string', k);
    }
    if (p.login) {
      assert.ok(p.login.fields.every(f => FIELD_KINDS.has(f)), `${b.id} fields ${p.login.fields}`);
      assert.ok(strList(p.login.buttons, 6)); assert.ok(p.login.socialProviders.every(s => ['google', 'apple', 'facebook', 'microsoft', 'amazon', 'paypal', 'twitter'].includes(s)));
      for (const k of ['hasRegisterLink', 'hasForgotLink', 'hasGuestPay']) assert.equal(typeof p.login[k], 'boolean');
      if (b.tier !== 'dedicated') assert.equal(p.login.socialProviders.includes('google'), b.template !== 'offline' && b.capabilities.google_login.support === 'supported' || b.template === 'offline' && p.login.socialProviders.includes('google'));
    }
    for (const h of p.help) { assert.ok(PROFILE_KINDS.has(h.kind)); assert.ok(h.excerpt.length > 0 && h.excerpt.length <= 600, `${b.id} excerpt length`); assert.ok(!/<[a-z/]|https?:\/\//i.test(h.excerpt), `${b.id} excerpt markup`); }
    assert.ok(p.familySignals.every(f => TEMPLATE_IDS.includes(f)), `${b.id} families ${p.familySignals}`);
    assert.ok(Array.isArray(p.observedDomains));
  }
  assert.ok(checked > 5000 && nulls > 1000, `checked ${checked}, nulls ${nulls}`);
  assert.equal(loadProfile('no-such-biller-000000'), null);
});

test('profiles: observed family reclassification is gated by kind, tier and offline', () => {
  const base = { name: 'Town of Example', bill_type: 'water', entity_type: 'municipal', tier: 'detailed', website: 'https://example.gov', login_url: null, links: {}, payment_processor: null, notes: '' };
  const res = (e, f) => observedResolution({ ...base, ...e }, resolveTemplate({ ...base, ...e }), f ? { f } : null);
  assert.deepEqual(res({}, ['invoicecloud', 2]), { template: 'invoicecloud', family: 'invoicecloud', kind: 'utility', signal: 'observed_public_domain' }, 'category -> observed family');
  assert.equal(res({ name: 'City of Example - ambulance', bill_type: 'medical' }, ['xpress', 2]).template, 'patient-pay', 'a city utility portal does not move an ambulance bill');
  assert.equal(res({ bill_type: 'electric' }, ['waste-hauler', 3]).template, 'municipal-portal', 'waste-hauler only for trash');
  assert.equal(res({ payment_processor: 'Paymentus' }, ['xpress', 3]).template, 'paymentus', 'processor-field family is never overridden');
  assert.equal(res({ notes: 'Customers pay through Paymentus.' }, ['xpress', 2]).template, 'paymentus', 'notes family yields only to strength 3');
  assert.equal(res({ notes: 'Customers pay through Paymentus.' }, ['xpress', 3]).template, 'xpress');
  assert.equal(res({ website: null, tier: 'roster' }, ['paymentus', 3]).template, 'offline', 'offline billers are untouched');
  assert.deepEqual(res({}, null), resolveTemplate(base), 'no observation: research-only resolution');
  for (const [fam, kinds] of Object.entries(RECLASS_KINDS)) { assert.ok(TEMPLATE_IDS.includes(fam), fam); for (const k of kinds) assert.ok(KINDS.has(k), `${fam} ${k}`); }
  for (const b of billers) if (b.signal === 'observed_public_domain') { assert.equal(b.template, b.family); assert.ok(RECLASS_KINDS[b.family].includes(b.kind), `${b.id} ${b.family} ${b.kind}`); assert.ok(b.profile?.familySignals.includes(b.family), `${b.id} has no ${b.family} signal`); }
});

test('profiles: observed capabilities upgrade evidence but never override negatives or invent online accounts', () => {
  const caps = {
    online_account: { support: 'supported', evidence: 'documented_link' }, registration: { support: 'supported', evidence: 'inferred_from_login' },
    autopay: { support: 'unknown', evidence: 'documented_notes_negative' }, autopay_cancel: { support: 'unknown', evidence: 'documented_notes_negative' },
    paperless: { support: 'unknown', evidence: 'inferred_category' }, cancel_service: { support: 'not_applicable', evidence: 'not_applicable' },
    payment_arrangement: { support: 'unsupported', evidence: 'inferred_category' }, google_login: { support: 'unknown', evidence: 'not_observed' }, guest_pay: { support: 'unknown', evidence: 'inferred_family' }
  };
  const out = observedCapabilities(caps, { template: 'utility-account' }, { o: ['online_account', 'autopay', 'autopay_cancel', 'paperless', 'google_login', 'cancel_service', 'payment_arrangement', 'guest_pay'] });
  assert.deepEqual(out.online_account, { support: 'supported', evidence: 'observed_public' });
  assert.deepEqual(out.registration, caps.registration, 'not observed: unchanged');
  assert.deepEqual(out.autopay, caps.autopay, 'negative notes win'); assert.deepEqual(out.autopay_cancel, caps.autopay_cancel);
  assert.deepEqual(out.paperless, { support: 'supported', evidence: 'observed_public' });
  assert.deepEqual(out.google_login, { support: 'supported', evidence: 'observed_public' });
  assert.deepEqual(out.guest_pay, { support: 'supported', evidence: 'observed_public' });
  assert.deepEqual(out.cancel_service, caps.cancel_service); assert.deepEqual(out.payment_arrangement, caps.payment_arrangement);
  assert.deepEqual(observedCapabilities(caps, { template: 'offline' }, { o: ['paperless'] }), caps, 'offline untouched');
  assert.notEqual(caps.paperless.evidence, 'observed_public', 'input not mutated');
});

test('profiles: extractor reads nav, login form, social sign-in and on-topic help text from raw HTML', () => {
  const page = `<html><head><title>Acme Water &amp; Sewer</title><meta name="description" content="Pay &quot;online&quot;"><meta name="theme-color" content="#004488"></head><body>
    <header><nav class="main-nav"><a href="#main">Skip to content</a><ul><li><a href="/pay">Pay My Bill</a><ul><li><a href="/pay/auto">AutoPay</a></li></ul></li><li><a href="/start">Start/Stop Service</a></li><li><a href="/rates">Rates</a></li><li><a href="/contact">Contact Us</a></li></ul></nav></header>
    <main><h1>Welcome to Acme</h1><p>Our <a href="/autopay">AutoPay program</a> pays your bill automatically on the due date from your bank account. Call 555-0100 or visit https://example.com for more.</p>
    <p>There is no fee to enroll in automatic payments.</p><script>var x = "<p>Pay with autopay injected text.</p>";</script></main>
    <form action="https://acme.example/login" method="post"><label for="u">Email address</label><input id="u" name="UserName" type="text"><input name="Password" type="password"><input type="hidden" name="t" value="x"><button>Sign In</button></form>
    <a href="https://accounts.google.com/o/oauth2/auth">Sign in with Google</a><a href="/register">Create an account</a><a href="/forgot">Forgot password?</a><a href="/guest">Pay as Guest</a>
    <footer><a href="/privacy">Privacy Policy</a><a href="/ada">Accessibility</a></footer></body></html>`;
  const f = extractPage(page, 'https://acme.example/');
  assert.equal(f.title, 'Acme Water & Sewer'); assert.equal(f.description, 'Pay "online"'); assert.equal(f.themeColor, '#004488');
  assert.deepEqual(navLabels(f), ['Pay My Bill', 'Start/Stop Service', 'Rates', 'Contact Us'], 'top-level items only, skip link dropped');
  assert.deepEqual(footerLabels(f), ['Privacy Policy', 'Accessibility']);
  assert.equal(heroHeading(f), 'Welcome to Acme');
  const L = loginFacts(f);
  assert.deepEqual(L.fields, ['email', 'password']); assert.deepEqual(L.buttons, ['Sign In']); assert.deepEqual(L.socialProviders, ['google']);
  assert.ok(L.hasRegisterLink && L.hasForgotLink && L.hasGuestPay && L.formObserved);
  const ex = excerptFor(f, 'autopay_setup');
  assert.match(ex, /^Our AutoPay program pays your bill automatically/, 'inline link text stays in its sentence');
  assert.ok(!/injected|https?:/.test(ex), 'scripts and URL sentences are excluded');
  assert.equal(loginFacts(extractPage('<a class="btn btn-google" href="https://play.google.com/store">Get it on Google Play</a>', 'https://x.example/')).socialProviders.length, 0, 'app-store badges are not social sign-in');
});

test('profiles: help merges observed excerpts as observed_public, filtered and escaped', t => {
  const contact = { phones: ['8005551234'], payPhones: [] };
  assert.equal(observedExcerpt('Call 800-555-1234 for help paying your bill. Or call 907-555-0000 after hours to pay.', contact), 'Call 800-555-1234 for help paying your bill.');
  assert.equal(observedExcerpt('A convenience fee of $2.95 applies to card payments. Pay online any time from your account.', contact), 'Pay online any time from your account.');
  assert.equal(observedExcerpt('Visit https://pay.example.com to pay your bill online today.', contact), '');
  const withHelp = billers.filter(b => b.template !== 'offline' && b.profile?.help?.length).slice(0, 400);
  if (!withHelp.length) return t.skip('no profiles built');
  let merged = 0;
  for (const b of withHelp) {
    const arts = helpArticles(b);
    assert.equal(new Set(arts.map(a => a.slug)).size, arts.length, `${b.id} duplicate slugs`);
    for (const a of arts.filter(a => a.evidence === 'observed_public')) {
      merged++;
      assert.ok(a.observed?.length, `${b.id} ${a.slug} observed record`);
      for (const o of a.observed) { const digits = phoneDigits(o.excerpt); assert.ok(digits.every(d => b.contact.phones.includes(d) || b.contact.payPhones.includes(d)), `${b.id} unknown phone in excerpt`); }
    }
  }
  assert.ok(merged > 100, `merged ${merged}`);
  const body = String(helpBody({ paragraphs: ['From the X website: “<script>alert(1)</script> & more”'], steps: null }));
  assert.ok(!body.includes('<script>') && body.includes('&lt;script&gt;'), 'help text is HTML-escaped');
});
