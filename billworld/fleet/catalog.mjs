// Fleet catalog: every record in categories/*.json becomes an addressable mock biller.
// A biller resolves to one portal template (shared family experience or category experience)
// plus a capability profile whose evidence labels come from the research record.
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { loadDossiers, applyDossier } from './billers/load.mjs';
import { validateDossier } from './billers/schema.mjs';

const categoriesDir = new URL('../../categories/', import.meta.url);

export const hash = (text, length = 8) => createHash('sha256').update(text).digest('hex').slice(0, length);
export const slugify = text => String(text).normalize('NFKD').toLowerCase().replace(/[^\w\s-]/g, '').replace(/[\s_-]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'biller';

// Account kind drives the billing domain model (what a "bill" is, what can be cancelled).
const KIND_BY_BILL_TYPE = {
  electric: 'utility', gas: 'utility', water: 'utility', sewer: 'utility', trash: 'utility', propane: 'utility', 'heating-oil': 'utility', 'home-services': 'utility',
  internet: 'telecom', landline: 'telecom', wireless: 'telecom', 'cable-tv': 'telecom', 'satellite-tv': 'telecom',
  streaming: 'subscription', subscription: 'subscription', membership: 'subscription', 'home-security': 'subscription', 'medical-alert': 'subscription', storage: 'subscription',
  'credit-card': 'card',
  bank: 'loan', 'credit-union': 'loan', mortgage: 'loan', heloc: 'loan', 'reverse-mortgage': 'loan', 'auto-loan': 'loan', 'personal-loan': 'loan', 'student-loan': 'loan',
  medical: 'medical', pharmacy: 'medical', dental: 'medical', vision: 'medical', hearing: 'medical',
  'property-tax': 'tax', 'income-tax': 'tax',
  'vehicle-registration': 'government', toll: 'toll',
  rent: 'rent', hoa: 'rent', 'senior-living': 'rent',
  funeral: 'invoice', other: 'invoice'
};
// State Medicaid buy-in / spend-down / pharmacy-assistance programs filed under medicare-premium are state agency invoices, not Medicare plans.
const MEDICAID_PROGRAM = /medicaid|medi-cal|masshealth|ahcccs|apple health|spend ?-?down|buy-in|workers with disabilities|prescription|\bRx\b|\bPAAD\b|\bPACE \//i;
// Home-care / home-health agencies filed under home-services bill like medical providers, not utilities.
const HOME_CARE = /home ?care|home health|hospice|nursing|nurses?\b|caregiver|in-home|private duty|home instead|visiting nurse/i;
// kindFor(billType) keeps the bill-type mapping; passing the entry also applies name-based corrections.
export const kindFor = (billType, entry = null) => {
  if (entry?.name && billType === 'medicare-premium' && MEDICAID_PROGRAM.test(entry.name)) return 'invoice';
  if (entry?.name && billType === 'home-services' && HOME_CARE.test(entry.name)) return 'medical';
  return KIND_BY_BILL_TYPE[billType] || (billType?.startsWith('insurance') || billType?.startsWith('medicare') ? 'insurance' : 'invoice');
};

// ---------- family signals ----------
// Three tiers, strongest first: (1) a documented URL on a known family host, (2) the payment_processor field
// (earliest non-negated mention wins), (3) the login URL and notes (non-negated, generic tokens excluded).
export const HOST_RULES = [
  ['smarthub', /(?:^|\.)smarthub\.coop$/],
  ['invoicecloud', /(?:^|\.)invoicecloud\.(?:com|net)$/],
  ['paymentus', /(?:^|\.)paymentus\.com$/],
  ['xpress', /(?:^|\.)xpressbillpay\.com$/],
  ['municipal-portal', /(?:^|\.)(?:municipalonlinepayments\.com|munisselfservice\.com|bsaonline\.com|edmundsassoc\.com|edmundsgovtech\.cloud|epayub\.com)$/],
  ['mychart', /(?:^|\.)mychart\.|mychart/],
  ['patient-pay', /(?:^|\.)(?:personapay\.com|patientportal\.me|pay\.amr\.net|patientpay\.com|healow\.com)$/],
  ['kubra', /(?:^|\.)(?:speedpay\.com|kubra\.io|kubra\.com)$/],
  ['doxo', /(?:^|\.)doxo\.com$/]
];
// [family, pattern usable anywhere (processor, login URL, notes), pattern trusted only in processor / login URL]
export const FAMILY_RULES = [
  ['smarthub', /smarthub|\bnisc\b/, null],
  ['invoicecloud', /invoice ?cloud/, null],
  ['paymentus', /paymentus/, null],
  ['xpress', /xpress ?bill ?pay|xpressbillpay/, null],
  ['mychart', /mychart|\bepic\)/, /\bepic\b/],
  ['patient-pay', /personapay|comstar|pay\.amr\.net|parallon|hca epay|patientpay|healow|athenahealth|cedar\.com|\bcedar (?:health|pay)\b/, /\bamr\b|\bgmr\b|\bcedar\b(?! rapids| park| city| hill| crest| valley| lake| falls| knolls| county| grove| creek| point| springs| bluff| ridge| key| mill| run| village)|patient (?:billing|portal)/],
  ['income-tax', /\brita\b|regional income tax/, null],
  ['municipal-portal', /municipal ?online|municipalonline|tyler (?:technologies|munis|municipal)|\bmunis\b|bs&a|bsaonline|edmunds|\bwipp\b|epay ?utilities|epayub|citizenserve|eonlinebill|starnik|inframark|utilitydistrict|firstbilling|sienv/, null],
  ['card-servicer', /synchrony|comenity|bread financial|mysynchrony/, null],
  ['newspaper', /gannett|usa today network|lee enterprises|subscriber services|tribune publishing|medianews|digital first media|advance local|mcclatchy/, null],
  ['waste-hauler', /republic services|waste connections|waste management|(?:^|[/.])wm\.com/, null],
  ['rent-portal', /rentcafe|pha-web|appfolio|buildium|rent ?manager/, /yardi|resident portal/],
  ['doxo', null, /\bdoxo\b/],
  ['kubra', /kubra|speedpay|\baci\b/, null]
];
// A family may only serve the kinds its portal actually bills.
const FAMILY_KINDS = { mychart: ['medical'], 'patient-pay': ['medical', 'subscription'], 'card-servicer': ['card', 'loan'], 'income-tax': ['tax'], kubra: ['utility', 'telecom', 'insurance', 'invoice', 'toll', 'rent', 'loan', 'card', 'subscription'] };
const NEGATED_BEFORE = /\b(?:not|no longer|formerly|previously|replaced|ended|legacy|moved from|warns?|against|beware|instead of|rather than|discontinued|retired|unaffiliated)\b[^.;]*$/i;
const DOXO_WARNING = /\bnot\b|warn|against|beware|unaffiliated|unauthori|third[- ]party/i;
const hostOf = url => { try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ''); } catch { return null; } };

// Earliest non-negated match of `pattern` in `text`, or -1.
function firstMatch(text, pattern, { family } = {}) {
  if (!pattern || !text) return -1;
  const re = new RegExp(pattern.source, 'gi');
  for (let m; (m = re.exec(text));) {
    const before = text.slice(Math.max(0, m.index - 40), m.index);
    if (NEGATED_BEFORE.test(before)) continue;
    if (family === 'doxo' && DOXO_WARNING.test(text.slice(Math.max(0, m.index - 60), m.index + m[0].length + 60))) continue;
    return m.index;
  }
  return -1;
}
const allowed = (family, kind, entry) => {
  if (FAMILY_KINDS[family] && !FAMILY_KINDS[family].includes(kind)) return false;
  if (family === 'income-tax' && entry.bill_type !== 'income-tax') return false;
  return true;
};
export function familyFor(entry, kind) {
  const l = entry.links || {};
  // (1) documented URLs on a known family host.
  for (const url of [entry.login_url, l.pay_bill, l.view_bill, l.autopay_setup]) {
    const host = hostOf(url); if (!host) continue;
    for (const [family, re] of HOST_RULES) if (re.test(host) && allowed(family, kind, entry)) return { family, tier: 'host' };
  }
  const processor = String(entry.payment_processor || '').toLowerCase();
  const inHouse = /^in-house/.test(processor);
  const candidates = (text, trusted) => FAMILY_RULES.map(([family, anywhere, trustedOnly]) => {
    if (!allowed(family, kind, entry)) return null;
    if (family === 'kubra' && inHouse) return null; // in-house servicers use ACI/Speedpay only as a phone or card channel
    const idx = [firstMatch(text, anywhere, { family }), trusted ? firstMatch(text, trustedOnly, { family }) : -1].filter(i => i >= 0);
    return idx.length ? { family, index: Math.min(...idx) } : null;
  }).filter(Boolean).sort((a, b) => a.index - b.index)[0] || null;
  // (2) the payment_processor field: earliest mention wins.
  const p = candidates(processor, true); if (p) return { family: p.family, tier: 'processor' };
  // (3) login URL text, then notes (generic tokens are not trusted in notes).
  const lg = candidates(String(entry.login_url || '').toLowerCase(), true); if (lg) return { family: lg.family, tier: 'login' };
  const n = candidates(String(entry.notes || '').toLowerCase(), false); if (n) return { family: n.family, tier: 'notes' };
  return null;
}

// Category experience when no family signal exists.
const TEMPLATE_BY_KIND = {
  utility: 'utility-account', telecom: 'telecom', subscription: 'streaming', card: 'card-servicer', loan: 'loan-servicer',
  medical: 'patient-pay', tax: 'property-tax', government: 'dmv', toll: 'toll-account', rent: 'rent-portal', insurance: 'insurance', invoice: 'invoice-portal'
};
const templateOverride = (entry, kind) => {
  if (kind === 'tax' && entry.bill_type === 'income-tax') return 'income-tax';
  if (kind === 'loan' && ['bank', 'credit-union'].includes(entry.bill_type)) return 'bank-billpay';
  if (kind === 'insurance' && (entry.bill_type.startsWith('medicare') || entry.bill_type === 'insurance-health' && /medicare/i.test(entry.name))) return 'health-plan';
  if (kind === 'subscription' && /newspaper subscription|\bnewspaper\b/i.test(entry.name)) return 'newspaper';
  if (kind === 'utility' && /municipal|city|county|district|authority|borough|village|town/i.test(entry.entity_type || '')) return 'municipal-portal';
  return null;
};

// Records that issue no bill at all: regulators, assistance programs and payment vendors / platforms.
const INFORMATIONAL_NAME = /LIHEAP|Weatherization|Energy Assistance|consumer complaints|shutoff protections|Lifeline \(federal|Public (?:Utilities|Utility|Service) Commission/i;
const INFORMATIONAL_ACRONYM = /\b(?:PUC|PSC|CPUC)\b/; // case-sensitive: "Psc" is a professional service corporation, not a regulator
const INFORMATIONAL_ENTITY = /payment processor|payment platform|bill-?pay (?:platform|network|service provider)|software vendor|billing software|money transmitter|data api|payments? vendor|fintech platform/i;
export const informational = entry => INFORMATIONAL_NAME.test(entry.name || '') || INFORMATIONAL_ACRONYM.test(entry.name || '') || INFORMATIONAL_ENTITY.test(entry.entity_type || '');

// Charges placed on another entity's bill. A biller with its own login, or whose "consolidated" bill is its own bill type, is not.
const CONSOLIDATED = /consolidated billing|billed (?:on|with|through) (?:your|the) (?:\w+ )?(water|electric|utility|tax|property)|appears? on (?:your|the) (?:\w+ )?(utility|electric|gas|water|tax) bill/i;
const OWN_TYPES = { water: ['water', 'sewer'], electric: ['electric'], gas: ['gas'], tax: ['property-tax', 'income-tax'], property: ['property-tax'], utility: ['electric', 'gas', 'water', 'sewer'] };
export const consolidated = entry => {
  if (entry.login_url) return false;
  const m = `${entry.payment_processor || ''} ${entry.notes || ''}`.match(CONSOLIDATED);
  if (!m) return false;
  const target = (m[1] || m[2] || '').toLowerCase();
  return !(target && OWN_TYPES[target]?.includes(entry.bill_type));
};

// Negative statements in the research notes. They lower a capability to unknown; they never invent support.
export const NEGATIVE = {
  pay_online: /\bno online (?:bill[- ]?)?pay(?:ment)?s?\b|not accept(?:ed)? online|pay(?:ments?)? by (?:mail|check) only|in[- ]person only|there is no online (?:bill[- ]?)?pay|with no online bill[- ]?pay|no online bill-?pay (?:page|portal|link)/i,
  autopay: /\bno (?:autopay|auto-pay|automatic payments?|recurring payments?)\b|(?:autopay|auto-pay|automatic payments?) (?:is |are )?not (?:offered|available|described)|\bno\b[^.;]{0,60}\bor (?:autopay|auto-pay)\b/i,
  paperless: /\bno (?:paperless|e-?bill(?:ing)?|electronic (?:statements?|billing))\b|paperless (?:is )?not (?:offered|available)/i,
  online_account: /\bno online account\b|publishes no online account|\bno online (?:account )?portal\b|no (?:online |customer |patient )?portal is published|no online account view|no customer portal/i
};
const negatives = entry => Object.fromEntries(Object.entries(NEGATIVE).map(([k, re]) => [k, re.test(entry.notes || '')]));
const NO_WEBSITE_NOTE = /\bno (?:public )?(?:website|web ?site|online presence)\b/i;

export function resolveTemplate(entry) {
  const kind = kindFor(entry.bill_type, entry);
  const l = entry.links || {};
  if (informational(entry)) return { template: 'offline', family: null, kind, signal: 'informational' };
  if (!entry.website && !entry.login_url && !l.pay_bill && !l.view_bill) {
    const anyLink = Object.values(l).some(Boolean) || entry.help_center_url;
    const unresearched = entry.tier === 'roster' && !anyLink && !NO_WEBSITE_NOTE.test(entry.notes || '');
    return { template: 'offline', family: null, kind, signal: unresearched ? 'unresearched_roster' : 'no_public_website' };
  }
  if (consolidated(entry)) return { template: 'offline', family: null, kind, signal: 'consolidated_billing' };
  const neg = negatives(entry);
  if (neg.online_account && neg.pay_online) return { template: 'offline', family: null, kind, signal: 'documented_no_online' };
  const fam = familyFor(entry, kind);
  if (fam) return { template: fam.family, family: fam.family, kind, signal: 'processor_or_route' };
  return { template: templateOverride(entry, kind) || TEMPLATE_BY_KIND[kind], family: null, kind, signal: 'category' };
}
// ---------- observed public profiles ----------
// profiles/build-profiles.mjs turns research-data captures (public pages fetched without signing in) into
//   profiles/index.json        eager, compact: {f: [family, strength], o: [observed capability keys], s: [social providers]}
//   profiles/profiles.jsonl.gz lazy: the full per-biller profile (website, login, help excerpts, observed domains)
// Set FLEET_PROFILES=0 to resolve from the research record alone (the profile build itself does this).
const profilesDir = new URL('./profiles/', import.meta.url);
const profilesOn = () => process.env.FLEET_PROFILES !== '0';
let profileIndexCache;
export function profileIndex() {
  if (profileIndexCache === undefined) {
    profileIndexCache = null;
    const file = new URL('index.json', profilesDir);
    if (profilesOn() && existsSync(file)) { try { profileIndexCache = JSON.parse(readFileSync(file, 'utf8')); } catch { profileIndexCache = null; } }
  }
  return profileIndexCache;
}
let profileStore; // { buf, offsets: Map(id -> [start, end]) }
const parsedProfiles = new Map(); const PARSED_MAX = 2000;
const deepFreeze = o => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const v of Object.values(o)) deepFreeze(v); } return o; };
// The full observed profile for a fleet biller id, or null when no capture exists. Loaded on first use; parsed per biller.
export function loadProfile(id) {
  if (!profilesOn()) return null;
  if (!profileStore) {
    profileStore = { buf: null, offsets: new Map() };
    const file = new URL('profiles.jsonl.gz', profilesDir);
    if (existsSync(file)) {
      try {
        const buf = gunzipSync(readFileSync(file)); profileStore.buf = buf;
        for (let start = 0; start < buf.length;) {
          let end = buf.indexOf(10, start); if (end < 0) end = buf.length;
          const head = buf.toString('utf8', start, Math.min(end, start + 200)).match(/^\{"id":"([^"]+)"/);
          if (head) profileStore.offsets.set(head[1], [start, end]);
          start = end + 1;
        }
      } catch { profileStore = { buf: null, offsets: new Map() }; }
    }
  }
  if (parsedProfiles.has(id)) return parsedProfiles.get(id);
  const at = profileStore.offsets.get(id);
  if (!at) return null;
  const { id: _, ...profile } = JSON.parse(profileStore.buf.toString('utf8', at[0], at[1]));
  if (parsedProfiles.size >= PARSED_MAX) parsedProfiles.delete(parsedProfiles.keys().next().value);
  parsedProfiles.set(id, deepFreeze(profile));
  return parsedProfiles.get(id);
}
// Families a vendor domain may move a biller into, by account kind: a city website linking to its utility portal says
// nothing about the city's ambulance bill, and a hospital's PersonaPay link does not make a nursing home rent a patient bill.
export const RECLASS_KINDS = {
  smarthub: ['utility', 'telecom'], invoicecloud: ['utility', 'tax', 'invoice', 'government', 'rent', 'insurance'], xpress: ['utility', 'tax', 'invoice', 'government'],
  paymentus: ['utility', 'telecom', 'insurance', 'invoice', 'tax', 'government', 'toll', 'loan', 'card', 'subscription', 'rent'], 'municipal-portal': ['utility', 'tax', 'government', 'invoice', 'toll'],
  mychart: ['medical'], 'patient-pay': ['medical'], kubra: ['utility', 'telecom', 'insurance', 'invoice', 'toll', 'loan', 'card'], doxo: ['utility', 'telecom', 'rent', 'insurance', 'invoice', 'subscription'],
  'card-servicer': ['card'], 'rent-portal': ['rent'], 'income-tax': ['tax'], 'waste-hauler': ['utility']
};
// Apply an observed vendor-domain family to a research-only resolution. Category-resolved billers move to the observed
// family; a family taken from notes text yields only to a strength-3 observation (a route lands on, or a form posts to, the vendor).
export function observedResolution(entry, base, ix) {
  if (!ix?.f || base.template === 'offline') return base;
  const [family, strength] = ix.f;
  if (base.family === family) return base;
  if (!RECLASS_KINDS[family]?.includes(base.kind) || !allowed(family, base.kind, entry)) return base;
  if (family === 'waste-hauler' && entry.bill_type !== 'trash') return base;
  if (base.family) { const tier = familyFor(entry, base.kind)?.tier; if (!(tier === 'notes' && strength >= 3)) return base; }
  return { template: family, family, kind: base.kind, signal: 'observed_public_domain' };
}
// Capabilities a captured public page proves. Supported claims gain the observed_public label; unknown ones that the page
// demonstrates (a guest-pay link, an AutoPay page, a Google sign-in button) become supported. Negative notes and
// unsupported / not_applicable values are never overridden, and offline billers are untouched.
const OBSERVED_CAN_ADD = new Set(['guest_pay', 'autopay', 'autopay_cancel', 'paperless', 'payment_assistance', 'google_login']);
export function observedCapabilities(caps, resolved, ix) {
  if (!ix?.o?.length || resolved.template === 'offline') return caps;
  const out = { ...caps };
  for (const k of ['online_account', 'registration', 'password_reset', 'view_bill', 'statements', 'pay_online', 'guest_pay', 'autopay', 'autopay_cancel', 'paperless', 'payment_assistance', 'google_login']) {
    if (!ix.o.includes(k) || !out[k]) continue;
    const c = out[k];
    if (k === 'autopay_cancel' && out.autopay.support !== 'supported') continue;
    if (c.support === 'supported') out[k] = { support: 'supported', evidence: 'observed_public' };
    else if (c.support === 'unknown' && c.evidence !== 'documented_notes_negative' && OBSERVED_CAN_ADD.has(k)) out[k] = { support: 'supported', evidence: 'observed_public' };
  }
  return out;
}
// Research-only resolution plus the observed profile overlay: what loadCatalog stores for each biller.
export function resolveBiller(entry, id) {
  const ix = profileIndex()?.billers?.[id] || null;
  const resolved = observedResolution(entry, resolveTemplate(entry), ix);
  return { resolved, capabilities: observedCapabilities(capabilities(entry, resolved), resolved, ix), indexEntry: ix };
}

// Templates whose AutoPay drafts from a bank account only (rent and loan servicers: recurring ACH). The engine refuses a
// card there and tasks.mjs does not ask for one.
export const AUTOPAY_BANK_ONLY = new Set(['rent-portal', 'loan-servicer']);
export const OFFLINE_SIGNALS = ['no_public_website', 'unresearched_roster', 'consolidated_billing', 'informational', 'documented_no_online'];

// Parse fees stated in research notes. Unstated fees stay synthetic and are labeled as such.
export function parseFees(entry) {
  const text = `${entry.notes || ''} ${entry.payment_processor || ''}`;
  const fee = { cardCents: null, cardPercent: null, bankCents: null, evidence: 'synthetic' };
  const pct = text.match(/(\d+(?:\.\d+)?)\s?%[^.]{0,40}(?:convenience|service|processing|card)?\s*fee|fee[^.]{0,30}?(\d+(?:\.\d+)?)\s?%/i);
  const flat = text.match(/\$\s?(\d{1,2}(?:\.\d\d)?)[^.$]{0,40}(?:convenience|service|processing|transaction)\s*fee|(?:convenience|service|processing|transaction)\s*fee[^.$]{0,30}?\$\s?(\d{1,2}(?:\.\d\d)?)/i);
  if (pct) { const value = Number(pct[1] || pct[2]); if (value > 0 && value < 10) { fee.cardPercent = value; fee.evidence = 'documented_notes'; } }
  if (flat) { const value = Math.round(Number(flat[1] || flat[2]) * 100); if (value > 0 && value <= 5000) { fee.cardCents = value; fee.evidence = 'documented_notes'; } }
  if (/no (?:convenience |processing |service )?fee|free of charge|no charge/i.test(text) && fee.evidence === 'synthetic') { fee.cardCents = 0; fee.bankCents = 0; fee.evidence = 'documented_notes'; }
  return fee;
}

const label = (url, documented) => url ? 'documented_link' : documented ? 'documented_notes' : 'inferred_category';
const NOT_CANCELLABLE_NAME = /medicare|medicaid|social security|\bSSA\b|IRMAA|child support|court|fines?\b|citation/i;
export function capabilities(entry, resolved) {
  const notes = (entry.notes || '').toLowerCase();
  const offline = resolved.template === 'offline';
  // Records never researched (or that issue no bill) make no claim either way: unknown, not unsupported.
  const offlineSupport = resolved.signal === 'unresearched_roster' ? 'unknown' : resolved.signal === 'informational' ? 'not_applicable' : 'unsupported';
  const l = entry.links || {};
  const neg = offline ? {} : negatives(entry);
  const cap = (supported, evidence, key) => offline ? { support: offlineSupport, evidence: resolved.signal }
    : neg[key] && supported === 'supported' && !(key === 'pay_online' && l.pay_bill) ? { support: 'unknown', evidence: 'documented_notes_negative' }
    : { support: supported, evidence };
  const cancellable = ['subscription', 'telecom', 'utility', 'rent', 'insurance', 'card', 'toll'].includes(resolved.kind) && !NOT_CANCELLABLE_NAME.test(entry.name || '');
  return {
    online_account: cap('supported', entry.login_url ? 'documented_link' : 'inferred_category'), // a "no account" note alone only matters with "no online pay" (then the biller is offline)
    registration: cap('supported', entry.login_url ? 'inferred_from_login' : 'inferred_category'),
    password_reset: cap('supported', 'synthetic_flow'),
    view_bill: cap('supported', label(l.view_bill)),
    statements: cap('supported', label(l.statements_history)),
    pay_online: cap('supported', label(l.pay_bill, /pay online|online payment|pay your bill online/.test(notes)), 'pay_online'),
    guest_pay: cap(/guest|one-time payment without|quick ?pay|without (?:an account|logging in|registering)/.test(notes) || ['mychart', 'patient-pay', 'paymentus', 'invoicecloud', 'income-tax', 'property-tax', 'dmv', 'municipal-portal', 'toll-account'].includes(resolved.template) ? 'supported' : 'unknown', /guest|quick ?pay/.test(notes) ? 'documented_notes' : 'inferred_family'),
    autopay: cap(['tax', 'government'].includes(resolved.kind) && !l.autopay_setup ? 'unknown' : 'supported', label(l.autopay_setup, /autopay|auto pay|automatic payment/.test(notes)), 'autopay'),
    autopay_cancel: cap(['tax', 'government'].includes(resolved.kind) && !l.autopay_cancel ? 'unknown' : 'supported', label(l.autopay_cancel, /cancel|stop|turn off/.test(notes) && /autopay|automatic/.test(notes)), 'autopay'),
    scheduled_payment: cap('supported', 'inferred_category'),
    paperless: cap(['tax', 'government', 'toll'].includes(resolved.kind) && !l.paperless ? 'unknown' : 'supported', label(l.paperless, /paperless|e-?bill|ebill/.test(notes)), 'paperless'),
    cancel_service: cap(cancellable ? 'supported' : 'not_applicable', cancellable ? (/cancel/.test(notes) ? 'documented_notes' : 'inferred_category') : 'not_applicable'),
    payment_assistance: cap(l.payment_assistance || entry.senior_programs ? 'supported' : 'unknown', label(l.payment_assistance, !!entry.senior_programs)),
    payment_arrangement: cap(resolved.template === 'dmv' ? 'unsupported' : 'supported', resolved.template === 'dmv' ? 'inferred_category' : 'synthetic_flow'), // the DMV portal states installment plans are not offered
    pay_by_phone: { support: entry.phone_pay_by_phone ? 'supported' : 'unknown', evidence: entry.phone_pay_by_phone ? 'documented_field' : 'unknown' },
    pay_by_mail: { support: entry.mail_payment_address ? 'supported' : 'unknown', evidence: entry.mail_payment_address ? 'documented_field' : 'unknown' },
    google_login: { support: 'unknown', evidence: 'not_observed' }
  };
}

// ---------- contact fields for display ----------
// Research contact fields can carry scrape provenance ("(context: '...')", "fetched 2026-09-29", "per x.com", HTML).
// Sites and graders use the cleaned values; the raw strings stay in biller.entry for private/admin use.
const PHONE_RE = /(?:\+?1[\s.-]?)?\(?([2-9]\d{2})\)?[\s.-]?([2-9]\d{2})[\s.-]?(\d{4})\b/g;
export const phoneDigits = text => { const out = []; for (const m of String(text || '').matchAll(PHONE_RE)) { const d = m[1] + m[2] + m[3]; if (!out.includes(d)) out.push(d); } return out; };
export const formatPhone = d => `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
const PROVENANCE = /context:|fetched|\bper [a-z0-9.-]+\.(?:com|org|gov|net|us|edu|coop)|snippet|metadata|not verified|tel: ?link|source:|https?:\/\/|<[a-z/]/i;
export function cleanContactText(raw) {
  if (!raw) return null;
  let s = String(raw);
  s = s.replace(/\(context: '.*?'\)/g, '').replace(/<[^>]*>/g, ' ').replace(/&[a-z]+;/g, ' ');
  // Drop parentheticals that are research provenance; keep short descriptive ones like "(TTY 711)".
  for (let i = 0; i < 3; i++) s = s.replace(/\([^()]*\)/g, m => PROVENANCE.test(m) ? '' : m);
  s = s.replace(/\s*;\s*(?=;|$)/g, '').replace(/\s{2,}/g, ' ').replace(/\s+([;,.])/g, '$1').replace(/^[\s;,]+|[\s;,]+$/g, '').trim();
  return s || null;
}
export function displayPhone(raw) {
  const text = cleanContactText(raw); const phones = phoneDigits(raw);
  if (!text) return phones.length ? phones.map(formatPhone).join('; ') : null;
  if (PROVENANCE.test(text) || text.length > 90) return phones.length ? phones.slice(0, 3).map(formatPhone).join('; ') : null;
  return text.replace(/^customer service:?\s*/i, '');
}
const RESEARCHY_AREA = /\bHQ\b|;|\bmostly\b|\bissuer\b|research|\bper\b|fetched|\(|\bcustomers?\b/i;
export function contactInfo(entry) {
  const phone = displayPhone(entry.phone_customer_service), payPhone = displayPhone(entry.phone_pay_by_phone);
  const mailAddress = cleanContactText(entry.mail_payment_address);
  const detail = entry.service_area_detail;
  const serviceArea = detail && !RESEARCHY_AREA.test(detail) && detail.length <= 80 ? detail : (entry.service_area || []).filter(s => s && s !== 'US').join(', ') || null;
  return { phone, payPhone, mailAddress: mailAddress && !PROVENANCE.test(mailAddress) ? mailAddress : mailAddress?.replace(PROVENANCE, '').trim() || null, serviceArea, phones: phoneDigits(entry.phone_customer_service), payPhones: phoneDigits(entry.phone_pay_by_phone) };
}

// Deterministic brand. Real logos are not redistributed; a monogram stands in.
const PALETTE = ['#0b5394', '#00695c', '#6a1b9a', '#b71c1c', '#1a237e', '#004d40', '#e65100', '#283593', '#2e7d32', '#37474f', '#ad1457', '#005f73', '#3d5a80', '#7b2d26', '#1d3557', '#5f0f40'];
export function brand(entry, id) {
  const h = parseInt(hash(id, 6), 16);
  const words = entry.name.replace(/\(.*?\)/g, '').split(/\s+/).map(w => w.replace(/[^A-Za-z0-9]/g, '')).filter(w => /^[A-Za-z]/.test(w) && !/^(of|the|and|inc|llc|co)$/i.test(w)); // letters only: monograms appear in confirmation numbers
  const monogram = (words.length > 1 ? words[0][0] + words[1][0] : (words[0] || entry.name).slice(0, 2)).toUpperCase();
  const domain = (() => { try { return new URL(entry.website || entry.login_url).hostname.replace(/^www\./, ''); } catch { return null; } })();
  return { primary: PALETTE[h % PALETTE.length], accent: PALETTE[(h >> 4) % PALETTE.length], monogram, domain, shortName: entry.name.replace(/\s*\(.*?\)\s*/g, ' ').trim() };
}

let cache;
export function loadCatalog() {
  if (cache) return cache;
  const billers = new Map(); const byTemplate = new Map(); const collisions = [];
  for (const file of readdirSync(categoriesDir).filter(f => f.endsWith('.json')).sort()) {
    const data = JSON.parse(readFileSync(new URL(file, categoriesDir)));
    data.entries.forEach((entry, index) => {
      const identity = [data.category, entry.name, entry.bill_type, (entry.service_area || []).join(','), entry.service_area_detail || ''].join('|');
      let id = `${slugify(entry.name)}-${hash(identity, 6)}`;
      if (billers.has(id)) { collisions.push(id); id = `${slugify(entry.name)}-${hash(identity + index, 10)}`; }
      const { resolved, capabilities: caps, indexEntry } = resolveBiller(entry, id);
      const biller = {
        id, category: data.category, source: { file: `categories/${file}`, index, record_hash: hash(JSON.stringify(entry), 16) },
        entry, ...resolved, fees: parseFees(entry), brand: brand(entry, id), contact: contactInfo(entry)
      };
      biller.capabilities = caps; biller.tier = 'family';
      // biller.profile: the observed public profile (null without a capture). Lazy and non-enumerable, so serializing a
      // biller does not load or embed it.
      Object.defineProperty(biller, 'profile', { get: () => indexEntry?.p ? loadProfile(id) : null, enumerable: false, configurable: true });
      billers.set(id, biller);
      if (!byTemplate.has(resolved.template)) byTemplate.set(resolved.template, []);
      byTemplate.get(resolved.template).push(id);
    });
  }
  // Dedicated tier: researched per-biller dossiers (billers/<id>.json) override the family rendering of that biller.
  const { dossiers, errors: dossierErrors } = loadDossiers();
  const dedicated = [];
  for (const [id, d] of dossiers) {
    const b = billers.get(id);
    if (!b) { dossierErrors[id] = [...(dossierErrors[id] || []), `id: no catalog biller with id ${id}`]; continue; }
    const cross = validateDossier(d, { biller: b, fileId: id }); // catalog cross-checks (sources' domains, plans, offline)
    if (cross.length) { dossierErrors[id] = cross; continue; }
    const before = b.template;
    applyDossier(b, d, { recompute: (entry, resolved) => observedCapabilities(capabilities(entry, resolved), resolved, profileIndex()?.billers?.[id] || null) });
    if (b.template !== before) { byTemplate.get(before).splice(byTemplate.get(before).indexOf(id), 1); if (!byTemplate.has(b.template)) byTemplate.set(b.template, []); byTemplate.get(b.template).push(id); }
    dedicated.push(id);
  }
  cache = { billers, byTemplate, collisions, dedicated, dossierErrors };
  return cache;
}

export function search(query, { limit = 25 } = {}) {
  const q = String(query || '').toLowerCase().trim();
  const out = [];
  if (!q) return out;
  for (const biller of loadCatalog().billers.values()) {
    if (biller.entry.name.toLowerCase().includes(q) || biller.id.includes(q) || biller.brand.domain?.includes(q)) out.push(biller);
    if (out.length >= limit) break;
  }
  return out;
}
