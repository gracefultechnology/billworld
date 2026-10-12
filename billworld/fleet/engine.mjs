// Fleet billing engine: authoritative state for every mock biller in an episode.
// Money is integer cents. Every mutation appends an event; graders read state + events, never page text.
import { randomBytes, randomInt, createHash } from 'node:crypto';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { loadCatalog, hash, phoneDigits, AUTOPAY_BANK_ONLY } from './catalog.mjs';
import { cityIn, placeIn } from './places.mjs';

export const FLEET_REVISION = 'fleet-0.2.0';
export const START_TIME = Date.parse('2026-10-03T16:00:00Z'); // 12:00 America/New_York
const DAY = 86400000;
const MINUTE = 60000;
export class Fault extends Error { constructor(message, status = 400, code = 'invalid') { super(message); this.status = status; this.code = code; } }

export const PASSWORD = 'Billworld-2026!';
export const MAIL_PASSWORD = 'Mailbox-2026!';
const PERSONAS = [
  ['Alex', 'Morgan'], ['Jordan', 'Rivera'], ['Taylor', 'Nguyen'], ['Casey', 'Patel'], ['Riley', 'Johnson'], ['Morgan', 'Lee'], ['Avery', 'Garcia'], ['Quinn', 'Brooks']
];
const STREETS = ['Maple Ave', 'Oak St', 'Cedar Ln', 'Pine Rd', 'Elm St', 'Birch Dr', 'Willow Way', 'Lakeview Blvd'];
// Service-address city and ZIP prefix range per state (capital city; first three ZIP digits).
const STATES = {
  AL: ['Montgomery', 350, 369], AK: ['Juneau', 995, 999], AZ: ['Phoenix', 850, 865], AR: ['Little Rock', 716, 729], CA: ['Sacramento', 900, 961], CO: ['Denver', 800, 816], CT: ['Hartford', 60, 69], DE: ['Dover', 197, 199], DC: ['Washington', 200, 205],
  FL: ['Tallahassee', 320, 349], GA: ['Atlanta', 300, 319], HI: ['Honolulu', 967, 968], ID: ['Boise', 832, 838], IL: ['Springfield', 600, 629], IN: ['Indianapolis', 460, 479], IA: ['Des Moines', 500, 528], KS: ['Topeka', 660, 679], KY: ['Frankfort', 400, 427],
  LA: ['Baton Rouge', 700, 714], ME: ['Augusta', 39, 49], MD: ['Annapolis', 206, 219], MA: ['Boston', 10, 27], MI: ['Lansing', 480, 499], MN: ['Saint Paul', 550, 567], MS: ['Jackson', 386, 397], MO: ['Jefferson City', 630, 658], MT: ['Helena', 590, 599],
  NE: ['Lincoln', 680, 693], NV: ['Carson City', 889, 898], NH: ['Concord', 30, 38], NJ: ['Trenton', 70, 89], NM: ['Santa Fe', 870, 884], NY: ['Albany', 100, 149], NC: ['Raleigh', 270, 289], ND: ['Bismarck', 580, 588], OH: ['Columbus', 430, 458],
  OK: ['Oklahoma City', 730, 749], OR: ['Salem', 970, 979], PA: ['Harrisburg', 150, 196], RI: ['Providence', 28, 29], SC: ['Columbia', 290, 299], SD: ['Pierre', 570, 577], TN: ['Nashville', 370, 385], TX: ['Austin', 750, 799], UT: ['Salt Lake City', 840, 847],
  VT: ['Montpelier', 50, 59], VA: ['Richmond', 220, 246], WA: ['Olympia', 980, 994], WV: ['Charleston', 247, 268], WI: ['Madison', 530, 549], WY: ['Cheyenne', 820, 831], PR: ['San Juan', 6, 9],
  GU: ['Hagåtña', 969, 969], VI: ['Charlotte Amalie', 8, 8], AS: ['Pago Pago', 967, 967], MP: ['Saipan', 969, 969]
};

export function rng(seedText) {
  let a = parseInt(createHash('sha256').update(String(seedText)).digest('hex').slice(0, 8), 16) >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
const pick = (r, list) => list[Math.floor(r() * list.length)];
const between = (r, lo, hi) => lo + Math.floor(r() * (hi - lo + 1));
export const money = cents => `${cents < 0 ? '-' : ''}$${(Math.abs(cents) / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
// One validator for typed and JSON amounts: digits with optional thousands commas, at most two decimals.
export function parseMoney(value) {
  const raw = typeof value === 'number' ? (Number.isFinite(value) ? String(value) : '') : String(value ?? '');
  const text = raw.trim().replace(/^\$\s*/, '');
  if (!/^(?:\d{1,3}(?:,\d{3})+|\d*)(?:\.\d{0,2})?$/.test(text) || !/\d/.test(text)) throw new Fault('Enter a valid dollar amount', 400, 'invalid_amount');
  const [whole, frac = ''] = text.replace(/,/g, '').split('.');
  return Number(whole || 0) * 100 + Number((frac + '00').slice(0, 2));
}
export const isoDate = ms => new Date(ms).toISOString().slice(0, 10);
// ISO date `n` business days (Mon–Fri) after the ISO date `from` (same rule as kit.addBusinessDays).
const addBusinessDaysIso = (from, n) => { const d = new Date(`${from}T12:00:00Z`); while (n > 0) { d.setUTCDate(d.getUTCDate() + 1); if (d.getUTCDay() % 6) n--; } return d.toISOString().slice(0, 10); };
const DATE_FMT = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric' });
export const fmtDate = ms => DATE_FMT.format(new Date(ms)); // cached formatter: toLocaleDateString builds one per call (~0.1ms)
const token = (n = 18) => randomBytes(n).toString('base64url');
const code6 = () => String(randomInt(100000, 1000000)); // verification codes are never derivable from the episode seed
const digits = (r, n) => Array.from({ length: n }, () => Math.floor(r() * 10)).join('');
const filled = v => v != null && String(v).trim() !== '';
const GUEST_WORD = { accountNumber: 'account number', statementId: 'statement number', parcelId: 'parcel number', plate: 'license plate', phone: 'phone number', lastName: 'last name', zip: 'ZIP code', amountDue: 'amount due', dob: 'date of birth' };
const REG_WORD = { accountNumber: 'account number', lastName: 'last name', zip: 'ZIP code', email: 'email address', phone: 'phone number', accessCode: 'access code' };
export const maskEmail = e => String(e || '').replace(/^(.)[^@]*/, '$1•••');
const luhnCard = (prefix, len) => { let s = prefix; while (s.length < len - 1) s += '4'; let sum = 0; for (let i = 0; i < s.length; i++) { let d = +s[s.length - 1 - i]; if (i % 2 === 0) { d *= 2; if (d > 9) d -= 9; } sum += d; } return s + ((10 - sum % 10) % 10); };
export const luhn = number => { const s = String(number).replace(/\D/g, ''); if (s.length < 13) return false; let sum = 0; for (let i = 0; i < s.length; i++) { let d = +s[s.length - 1 - i]; if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; } sum += d; } return sum % 10 === 0; };
export const TEST_CARDS = { visa: luhnCard('4', 16), mastercard: luhnCard('5', 16), amex: luhnCard('37', 15), discover: luhnCard('6011', 16), declined: '4000000000000002' };
// Card networks. A dossier's billing.cardBrands lists the networks the biller accepts online (default: all four).
export const CARD_BRANDS = { visa: 'Visa', mastercard: 'Mastercard', amex: 'American Express', discover: 'Discover' };
export const cardBrandOf = number => { const s = String(number || '').replace(/\D/g, ''); return /^4/.test(s) ? 'visa' : /^3[47]/.test(s) ? 'amex' : /^(?:5|2[2-7])/.test(s) ? 'mastercard' : /^6/.test(s) ? 'discover' : /^3/.test(s) ? 'amex' : null; };
export const cardBrandsFor = b => b?.dossier?.billing?.cardBrands || null;
export const brandList = keys => { const w = keys.map(k => CARD_BRANDS[k]); return w.length > 1 ? `${w.slice(0, -1).join(', ')}${w.length > 2 ? ',' : ''} and ${w.at(-1)}` : w[0]; };
// The brand of the seeded saved card (Visa unless the biller does not take Visa) and a typeable test number for it.
export const savedCardBrand = b => { const l = cardBrandsFor(b); return !l || l.includes('visa') ? 'visa' : ['mastercard', 'discover', 'amex'].find(k => l.includes(k)); };
export const expiredCardBrand = b => { const l = cardBrandsFor(b); return !l || l.includes('mastercard') ? 'mastercard' : l.find(k => k !== savedCardBrand(b)) || savedCardBrand(b); };
// A Luhn-valid test number of the biller's first accepted brand, optionally ending in `last4` (e.g. '1111', '4321').
const VISA_CLASSIC = { 1111: '4111111111111111', 4321: '4000056655064321' };
const BRAND_PREFIX = { visa: ['4', 16], mastercard: ['5', 16], amex: ['37', 15], discover: ['6011', 16] };
export const testCardFor = (b, last4 = null) => {
  const brand = savedCardBrand(b); if (!last4) return TEST_CARDS[brand];
  if (brand === 'visa' && VISA_CLASSIC[last4]) return VISA_CLASSIC[last4];
  const [pre, len] = BRAND_PREFIX[brand];
  for (let d = 0; d < 10; d++) { const n = `${pre}${'0'.repeat(len - pre.length - 5)}${d}${last4}`; if (luhn(n)) return n; }
  return TEST_CARDS[brand];
};
// MM/YY (or MM/YYYY) → { mm, year } or null.
const parseExp = exp => { const m = String(exp || '').trim().match(/^(\d{1,2})\s*\/\s*(\d{2}|\d{4})$/); if (!m) return null; const mm = +m[1]; const year = m[2].length === 4 ? +m[2] : 2000 + +m[2]; return mm >= 1 && mm <= 12 ? { mm, year } : null; };
const monthIndex = ms => new Date(ms).getUTCFullYear() * 12 + new Date(ms).getUTCMonth() + 1;
export const isExpired = (m, clock) => { if (m.expired) return true; if (m.type !== 'card') return false; const e = parseExp(m.exp); return !!e && e.year * 12 + e.mm < monthIndex(clock); };

// Per-kind bill model. Line items and plans make each kind read like its real counterpart.
const LINES = {
  utility: { electric: ['Customer charge', 'Energy charge', 'Delivery charge', 'Fuel cost adjustment'], gas: ['Customer charge', 'Gas supply', 'Distribution charge'], water: ['Water base charge', 'Water usage', 'Sewer charge'], sewer: ['Sewer base charge', 'Sewer usage'], trash: ['Refuse collection', 'Recycling'], propane: ['Propane delivery', 'Tank rental'], 'heating-oil': ['Heating oil delivery', 'Service plan'], 'home-services': ['Service plan', 'Equipment'] },
  telecom: ['Monthly service', 'Equipment rental', 'Taxes, fees & surcharges'],
  subscription: ['Membership'], card: ['Purchases', 'Interest charged'], loan: ['Principal', 'Interest', 'Escrow'], medical: ['Office visit', 'Laboratory', 'Insurance adjustment'],
  tax: ['Tax due'], government: ['Registration fee', 'County fee'], toll: ['Toll transactions', 'Account replenishment'], rent: ['Rent', 'Utilities', 'Amenity fee'], insurance: ['Premium'], invoice: ['Services rendered']
};
// Home-services billers whose name says the trade get that trade's two line items (same count as the default pair,
// so the generated amounts do not change); security, warranty and other plans keep 'Service plan' + 'Equipment'.
const HOME_LINES = [
  [/lawn|turf|landscap|tree care|weed|tru ?green|lawn doctor|weed man/i, ['Lawn care service', 'Additional treatments']],
  [/pest|termite|exterminat|orkin|terminix|mosquito|rodent|bug\b/i, ['Pest control service', 'Additional treatments']],
  [/\bpools?\b|\bspa\b/i, ['Pool service', 'Chemicals & supplies']],
  [/clean|maid|janitor|carpet/i, ['Cleaning service', 'Supplies']]
];
const homeLines = b => HOME_LINES.find(([re]) => re.test(`${b.name || ''} ${b.brand?.shortName || ''}`))?.[1];
const PLANS = {
  subscription: [['basic', 'Basic', 799], ['standard', 'Standard', 1549], ['premium', 'Premium', 2299]],
  telecom: [['essential', 'Essential 100', 4999], ['plus', 'Plus 500', 6999], ['gig', 'Gigabit', 8999]],
  insurance: [['monthly', 'Monthly installments', 0], ['quarterly', 'Quarterly', 0], ['annual', 'Pay in full', 0]]
};
const BASE = { utility: [4500, 22000], telecom: [5500, 18000], subscription: [799, 2299], card: [12000, 240000], loan: [18000, 210000], medical: [2500, 95000], tax: [40000, 480000], government: [4500, 32000], toll: [1500, 9000], rent: [85000, 260000], insurance: [6500, 42000], invoice: [3500, 60000] };
const MFA_MODES = ['none', 'email', 'sms'];
// Dedicated-tier dossier (billers/<id>.json) accessors. Every default below is the family behavior.
const dossier = b => b?.dossier || null;
// Satellite and fixed-wireless ISPs cannot sell gigabit tiers: they get capacity-appropriate family plans.
const LOW_CAPACITY_PLANS = [['standard', 'Standard 25 Mbps', 4999], ['plus', 'Plus 50 Mbps', 6999], ['max', 'Max 100 Mbps', 8999]];
export const lowCapacityIsp = b => b?.kind === 'telecom' && b.category === 'internet' && /satellite|fixed[- ]wireless/i.test(`${b.entry?.name || ''} ${b.entry?.service_area_detail || ''}`) && !/fiber|fios|cable/i.test(b.entry?.name || '');
const familyPlans = b => lowCapacityIsp(b) ? LOW_CAPACITY_PLANS : PLANS[b?.kind];
export function plansFor(b) { const d = dossier(b)?.billing?.plans; return d ? d.map(p => [p.id, p.name, p.cents]) : familyPlans(b) || null; }
export function defaultPlan(b) { const d = dossier(b)?.billing?.plans; if (d) return (d.find(p => p.current) || d[1] || d[0]).id; const l = familyPlans(b); return l ? l[1][0] : null; }
// The cancel flow's "stay and save" step: subscription/telecom kinds, unless the dossier says the biller has none.
export const retentionOfferFor = b => ['subscription', 'telecom'].includes(b?.kind) && dossier(b)?.billing?.retentionOffer !== false;
export function methodTypesFor(b, { guest = false, autopay = false } = {}) {
  const bl = dossier(b)?.billing || {};
  if (autopay) { if (bl.autopay?.methodTypes) return bl.autopay.methodTypes; const def = AUTOPAY_BANK_ONLY.has(b?.template) ? ['bank'] : ['bank', 'card']; const both = bl.methods ? def.filter(t => bl.methods.includes(t)) : def; return both.length ? both : bl.methods; }
  return (guest && bl.guestMethods) || bl.methods || ['bank', 'card'];
}
// The saved method generated tasks and reference solutions use: the checking account, or the Visa for card-only billers.
// Bills that renew yearly rather than monthly (vehicle registration, property and income tax): seeded history is
// yearly renewal notices or tax bills, each paid once, not twelve monthly bills.
export const annualBill = b => b.entry?.bill_type === 'vehicle-registration' || b.kind === 'tax';
// Next dates of a dossier tax calendar (billing.taxSchedule.installments [{due: 'MM-DD'}]) after `clock`, in order, at
// the clock's time of day. The first is at least 7 days out, so the open bill is never due today. null without a schedule.
export function taxDueDates(b, clock) {
  const list = dossier(b)?.billing?.taxSchedule?.installments; if (!list?.length) return null;
  const c = new Date(clock); const out = []; let prev = clock + 6 * DAY;
  for (const { due } of list) {
    const [mm, dd] = String(due).split('-').map(Number); let y = new Date(prev).getUTCFullYear();
    let t = Date.UTC(y, mm - 1, dd, c.getUTCHours(), c.getUTCMinutes());
    while (t <= prev) t = Date.UTC(++y, mm - 1, dd, c.getUTCHours(), c.getUTCMinutes());
    out.push(t); prev = t;
  }
  return out;
}
export const hasBank = b => methodTypesFor(b).includes('bank') || methodTypesFor(b, { autopay: true }).includes('bank');
export const primaryMethodId = (b, { autopay = false } = {}) => methodTypesFor(b, { autopay }).includes('bank') ? 'pm-chk' : 'pm-card';
// When AutoPay drafts, in words (no chosen day): the dossier's daysAfterBill / leadDays, else the due date.
export function autopayTimingText(b) { const ap = dossier(b)?.billing?.autopay || {}; return ap.daysAfterBill != null ? (ap.daysAfterBill ? `${ap.daysAfterBill} days after each bill date` : 'on each bill date') : ap.leadDays ? `${ap.leadDays} day${ap.leadDays === 1 ? '' : 's'} before each due date` : 'on each due date'; }
export function autopayPoliciesFor(b) { return dossier(b)?.billing?.autopay?.policies || null; }
export function paymentLimits(b) { const bl = dossier(b)?.billing || {}; return { minCents: bl.minPaymentCents ?? 100, maxCents: bl.maxPaymentCents ?? MAX_PAYMENT_CENTS, maxDaysAhead: bl.scheduled?.maxDaysAhead ?? 365, maxPending: bl.scheduled?.maxPending ?? null, fullBalanceOnly: !!bl.fullBalanceOnly, maxPaymentBalance: !!bl.maxPaymentBalance }; }
export const lockoutAttempts = b => dossier(b)?.auth?.lockoutAttempts ?? 5;
// mfa scenario 'default' (or true) means "the biller's own second factor" from its dossier (email unless it texts).
// The bill notice names the account number with the biller's own word for it (dossier labels.accountNumber), keeping
// "account number" in the line so either label is recognizable.
export const noticeLabel = b => { const l = String(b?.dossier?.labels?.accountNumber || '').trim(); if (!l || l.length > 40 || /^(?:account (?:number|#|no\.?)|acct\.?)$/i.test(l) || /guarantor|statement/i.test(l)) return 'Account number'; return /account number/i.test(l) ? l : `${l} (account number)`; };
// Reads the account number back from a bill notice whatever the biller calls it.
export const noticeAccountNumber = text => String(text || '').match(/^[^\n:]*account number[^\n:]*: *(\S+)/im)?.[1] || null;
const mfaDefault = b => { const m = dossier(b)?.auth?.mfa; return m === 'sms' ? 'sms' : m === 'none' ? 'none' : 'email'; };
// SMS short code a biller texts from (same value sms.mjs shows on the /sms phone page).
export const smsShortCode = billerId => String(20000 + (parseInt(createHash('sha256').update(String(billerId)).digest('hex').slice(0, 8), 16) % 79999));
const MAX_PAYMENT_CENTS = 1000000;
const lim2 = b => paymentLimits(b);
// Fields compared by the no_unrequested_changes predicate.
export const SIDE_EFFECT_FIELDS = ['autopay', 'paperless', 'service_status', 'plan', 'retention', 'methods', 'messages', 'arrangement', 'scheduled', 'profile'];

export class FleetWorld {
  constructor({ dataDir = null } = {}) {
    this.catalog = loadCatalog();
    this.episodes = new Map();
    this.dataDir = dataDir;
    if (dataDir) mkdirSync(dataDir, { recursive: true });
  }

  biller(id) { const b = this.catalog.billers.get(id); if (!b) throw new Fault('Biller not found', 404, 'not_found'); return b; }
  isOffline(b) { return b.template === 'offline' || b.capabilities.online_account.support === 'unsupported'; }

  // ---------- episodes ----------
  createEpisode({ seed = token(6), scenario = {}, kind = 'interactive', persist = true } = {}) {
    const r = rng(`persona:${seed}`);
    const [first, last] = pick(r, PERSONAS);
    const ep = {
      id: `ep-${token(12)}`, entryToken: token(18), seed: String(seed), kind, revision: FLEET_REVISION, createdAt: Date.now(), clock: START_TIME,
      persona: { first, last, name: `${first} ${last}`, email: `${first}.${last}@billworld.test`.toLowerCase(), phone: `(555) 01${digits(r, 2).slice(1)}-${digits(r, 4)}`, address: `${between(r, 100, 9899)} ${pick(r, STREETS)}`, zip: `${between(r, 10001, 98999)}`, dob: '1961-04-18', ssnLast4: digits(r, 4) },
      mailPassword: MAIL_PASSWORD, mailToken: token(18), scenario, accounts: {}, mailbox: [], events: [], sessions: {}, answer: null, finished: null
    };
    this.episodes.set(ep.id, ep);
    this.mail(ep, null, { from: 'Billworld Mail <welcome@mail.billworld.test>', subject: 'Welcome to your inbox', text: `Hi ${first},\n\nThis inbox receives verification codes, receipts and notices from your billers.` });
    if (persist) this.persist(ep);
    return ep;
  }
  episode(id) {
    let ep = this.episodes.get(id);
    if (!ep && this.dataDir && /^ep-[\w-]+$/.test(id || '') && existsSync(`${this.dataDir}/${id}.json`)) { ep = JSON.parse(readFileSync(`${this.dataDir}/${id}.json`)); this.episodes.set(id, ep); }
    if (!ep) throw new Fault('Episode not found', 404, 'no_episode');
    return ep;
  }
  persist(ep) { if (this.dataDir) writeFileSync(`${this.dataDir}/${ep.id}.json`, JSON.stringify(ep)); }
  event(ep, billerId, type, data = {}) { ep.events.push({ seq: ep.events.length + 1, at: ep.clock, billerId, type, ...data }); }
  guard(ep) { if (ep.finished) throw new Fault('This episode has finished', 409, 'finished'); }
  // The agent's final reported answer (runner-supplied). Graded by 'answer' predicates.
  submitAnswer(ep, text) { this.guard(ep); ep.answer = { text: String(text ?? '').slice(0, 4000), at: ep.clock }; this.event(ep, null, 'answer_submitted'); this.persist(ep); return ep.answer; }

  // ---------- bill model ----------
  planPrice(b, planId) { return (plansFor(b) || []).find(p => p[0] === planId)?.[2] ?? null; }
  // Card minimum payment: the dossier's model (percent of the statement balance, floor, optional interest) or 3% / $35.
  cardMinimum(b, statement, interest = 0) { const m = dossier(b)?.billing?.cardMinimum; const base = m ? Math.max(m.floorCents, Math.round(statement * m.percent / 100) + (m.plusInterest ? interest : 0)) : Math.max(3500, Math.round(statement * 0.03)); return Math.min(statement, base); }
  lateFee(b, unpaidCents) { const bl = dossier(b)?.billing || {}; if (bl.lateFeeCents != null) return bl.lateFeeCents; if (bl.lateFeePercent != null) return Math.max(Math.round(unpaidCents * bl.lateFeePercent / 100), bl.lateFeeMinCents || 0); return 0; } // "greater of N% or $X" when lateFeeMinCents is set
  // Kind-specific, internally consistent line items for one bill of `cents`.
  billLines(b, kind, cents, r, ctx = {}) {
    if (kind === 'subscription' && ctx.planCents === cents) return [{ desc: 'Membership', cents }];
    if (kind === 'invoice' && ctx.planLine && ctx.planCents === cents) return [{ desc: ctx.planLine, cents }];
    if (kind === 'telecom' && ctx.telecom) { const { service, equipment, taxes } = ctx.telecom; return [{ desc: 'Monthly service', cents: service }, { desc: 'Equipment rental', cents: equipment }, { desc: 'Taxes, fees & surcharges', cents: taxes }]; }
    if (kind === 'card') { const interest = ctx.interestCents ?? Math.round(cents * between(r, 15, 25) / 1000); return [{ desc: 'Purchases', cents: cents - interest }, { desc: 'Interest charged', cents: interest }]; }
    if (kind === 'loan') {
      const escrow = ctx.escrowCents || 0; const pi = cents - escrow; const interest = Math.round(pi * (ctx.interestShare ?? 0.4));
      return [{ desc: 'Principal', cents: pi - interest }, { desc: 'Interest', cents: interest }, ...(escrow ? [{ desc: 'Escrow', cents: escrow }] : [])];
    }
    const names = kind === 'utility' ? ((b.entry.bill_type === 'home-services' && homeLines(b)) || LINES.utility[b.entry.bill_type] || LINES.utility.water) : LINES[kind] || LINES.invoice;
    const parts = names.map(() => 1 + r() * 3); const total = parts.reduce((a, c) => a + c, 0); const out = parts.map(p => Math.floor(cents * p / total)); out[0] += cents - out.reduce((a, c) => a + c, 0);
    return names.map((desc, i) => ({ desc, cents: out[i] }));
  }
  telecomBill(planCents, r) { const equipment = between(r, 0, 3) * 500; const taxes = Math.round((planCents + equipment) * between(r, 6, 14) / 100); return { service: planCents, equipment, taxes, total: planCents + equipment + taxes }; }
  // Service address in the biller's state: the biller's own city/ZIP when its HQ is in that state, else a city it serves, else the capital (real ZIPs).
  serviceLocation(ep, b) {
    const r = rng(`${ep.seed}:${b.id}:addr`);
    const lo = b.dossier?.contact?.locality; // dossier: the biller's real locality (city and its ZIPs)
    if (lo) return { city: lo.city, state: lo.state, zip: String(lo.zips[between(r, 0, lo.zips.length - 1)]) };
    const hq = String(b.entry.hq_address || '').match(/,\s*([A-Za-z .'-]+?),?\s+([A-Z]{2})\s+(\d{5})\b/);
    const area = (b.entry.service_area || []).find(s => STATES[s]);
    const state = area || (hq && STATES[hq[2]] ? hq[2] : null) || 'OH';
    if (hq && hq[2] === state) return { city: hq[1].trim(), state, zip: hq[3] };
    // A municipal service area that names one city ("City of Philadelphia"): the customer lives in that city.
    const town = String(b.contact?.serviceArea || '').match(/^(?:the )?(?:City|Town|Village|Borough) of ([A-Z][A-Za-z.' -]{1,40})$/);
    // A city this biller names (service area, name, raw research area): that city's own ZIPs (places.mjs).
    const named = cityIn(state, [b.contact?.serviceArea, b.entry.name, b.entry.service_area_detail]);
    if (named) return { city: named.city, state, ...placeIn(state, [named.city], r) };
    if (town && STATES[state]) { const [, lo, hi] = STATES[state]; return { city: town[1].trim(), state, zip: `${String(between(r, lo, hi)).padStart(3, '0')}${digits(r, 2)}` }; }
    return { state, ...placeIn(state, [], r) }; // the state capital with one of its own ZIPs
  }

  // ---------- account seeding (lazy, deterministic per seed + biller) ----------
  account(ep, billerId) {
    if (ep.accounts[billerId]) return ep.accounts[billerId];
    const b = this.biller(billerId); const r = rng(`${ep.seed}:${billerId}`); const sc = { ...(ep.scenario.default || {}), ...(ep.scenario[billerId] || {}) };
    const mfa = sc.mfa == null ? 'none' : sc.mfa === true || String(sc.mfa).toLowerCase() === 'default' ? mfaDefault(b) : String(sc.mfa).toLowerCase();
    if (!MFA_MODES.includes(mfa)) throw new Fault(`Unsupported MFA scenario "${sc.mfa}". Supported: ${MFA_MODES.join(', ')}.`, 400, 'bad_scenario');
    const kind = b.kind;
    const planList = plansFor(b);
    const plan = planList ? (sc.plan || defaultPlan(b)) : null;
    if (plan && !planList.some(p => p[0] === plan)) throw new Fault(`Unknown plan "${plan}" for this biller.`, 400, 'bad_scenario');
    const planCents = this.planPrice(b, plan);
    const base = BASE[kind] || BASE.invoice;
    let amount = sc.amountCents ?? between(r, base[0], base[1]);
    let telecom = null;
    if (sc.amountCents == null && kind === 'subscription' && planCents) amount = planCents; // the bill is the plan price
    // Protection plans and other invoice billers with dossier plan prices (AppleCare One, Asurion Home+) bill the plan price.
    const invoicePlan = kind === 'invoice' && !!planCents && !!dossier(b)?.billing?.plans;
    if (sc.amountCents == null && invoicePlan) amount = planCents;
    // A documented fixed recurring charge without plan tiers (dossier billing.recurringCents, e.g. Asurion Home+ $34.99/mo).
    const recurring = !planCents && sc.amountCents == null ? dossier(b)?.billing?.recurringCents || null : null;
    if (recurring) amount = recurring;
    if (sc.amountCents == null && kind === 'telecom' && planCents) { telecom = this.telecomBill(planCents, r); amount = telecom.total; }
    const escrowCents = kind === 'loan' && b.entry.bill_type === 'mortgage' ? Math.round(amount * 0.28) : 0;
    const rateBps = between(r, 299, 899); const interestShare = between(r, 20, 65) / 100;
    const lineCtx = { planCents, telecom, escrowCents, interestShare, planLine: invoicePlan ? planList.find(p => p[0] === plan)?.[1] : recurring && kind === 'invoice' ? 'Monthly plan charge' : null, ...(recurring ? { planCents: recurring } : {}) };
    // A tax biller with a documented calendar (dossier billing.taxSchedule) is due on its real installment dates;
    // the rolled offset is still drawn so every other seeded value stays the same.
    const taxDues = kind === 'tax' ? taxDueDates(b, ep.clock) : null;
    const dueOffset = sc.dueInDays ?? (rolled => taxDues ? Math.round((taxDues[0] - ep.clock) / DAY) : rolled)(between(r, 6, 19));
    const invoices = [];
    // Vehicle registrations renew once a year: four yearly renewal notices instead of twelve monthly bills.
    const annual = annualBill(b); const cycleDays = annual ? 365 : 30;
    for (let m = annual ? 3 : 11; m >= 0; m--) {
      const due = ep.clock + dueOffset * DAY - m * cycleDays * DAY;
      const fixed = ['subscription', 'telecom', 'loan'].includes(kind) || (invoicePlan && sc.amountCents == null) || !!recurring; // plan prices and loan payments do not drift month to month
      const cents = m === 0 || fixed ? amount : Math.max(100, Math.round(amount * (annual ? 0.94 + r() * 0.08 : 0.8 + r() * 0.4)));
      const issuedAt = m === 0 ? Math.min(due - 20 * DAY, ep.clock - DAY) : due - 20 * DAY; // a current bill is never issued in the future
      invoices.push({ id: `inv-${hash(`${billerId}:${m}:${ep.seed}`, 8)}`, number: `${digits(r, 7)}`, period: `${fmtDate(issuedAt - cycleDays * DAY)} – ${fmtDate(issuedAt)}`, issuedAt, dueAt: due, amountCents: cents, balanceCents: m === 0 ? cents : 0, lines: this.billLines(b, kind, cents, r, lineCtx), status: m === 0 ? 'open' : 'paid', previousBalanceCents: 0, totalDueCents: m === 0 ? cents : cents });
    }
    const cur = invoices.at(-1), prior = invoices.at(-2);
    if (sc.pastDueCents) {
      prior.balanceCents = sc.pastDueCents; prior.status = 'past_due'; cur.previousBalanceCents = sc.pastDueCents;
      const late = this.lateFee(b, sc.pastDueCents); // dossier late payment charge on the unpaid prior balance
      if (late) { cur.lines.push({ desc: 'Late payment charge', cents: late }); cur.amountCents += late; cur.balanceCents += late; }
      cur.totalDueCents = cur.amountCents + sc.pastDueCents;
    }
    const loc = this.serviceLocation(ep, b);
    const acct = {
      billerId, kind, template: b.template, accountNumber: sc.accountNumber || `${digits(r, 3)}${digits(r, 4)}${digits(r, 3)}`,
      serviceAddress: `${ep.persona.address}, ${loc.city}, ${loc.state} ${loc.zip}`, serviceCity: loc.city, serviceState: loc.state, zip: loc.zip,
      username: ep.persona.email, password: PASSWORD, registered: sc.registered ?? true, emailVerified: sc.registered ?? true, mfa, failedLogins: 0, lockedUntil: 0,
      invoices, methods: [], payments: [], creditCents: 0, autopay: { enrolled: !!sc.autopay, methodId: null, policy: 'full', fixedCents: null, day: null, enrolledAt: null, history: [] }, paperless: sc.paperless ?? false,
      service: { status: 'active', plan: null, cancelAt: null, reason: null, retentionOffered: false, discount: null }, draft: null, resetChallenges: [], resetRequests: [], verification: null, messages: [], arrangement: null
    };
    // Card-only billers (dossier billing.methods without 'bank') get no saved checking account: the saved Visa is primary.
    if (hasBank(b)) acct.methods.push({ id: 'pm-chk', type: 'bank', label: 'Checking', bankName: 'Billworld Federal Credit Union', last4: digits(r, 4), routing: '021000021', holder: ep.persona.name, saved: true, nickname: 'Everyday checking' });
    const sb = CARD_BRANDS[savedCardBrand(b)], xb = CARD_BRANDS[expiredCardBrand(b)];
    if ((sc.savedCard !== false || !hasBank(b)) && methodTypesFor(b).includes('card')) acct.methods.push({ id: 'pm-card', type: 'card', label: sb, brand: sb, last4: TEST_CARDS[savedCardBrand(b)].slice(-4), exp: '09/29', holder: ep.persona.name, saved: true, nickname: `${sb === 'American Express' ? 'Amex' : sb} rewards` });
    if (sc.expiredCard && methodTypesFor(b).includes('card')) acct.methods.push({ id: 'pm-old', type: 'card', label: xb, brand: xb, last4: '4444', exp: '01/26', holder: ep.persona.name, saved: true, expired: true });
    if (sc.forgotPassword) acct.password = `Forgotten-${token(6)}!1a`;
    if (sc.declineSavedCard) { const card = acct.methods.find(m => m.id === 'pm-card'); if (card) card.declines = true; }
    // A biller that drafts only on fixed days of the month (dossier billing.autopay.days, offered as a draft-day choice by
    // these templates) has its seeded enrollment on the first of them, so the AutoPay form shows the day it already uses.
    if (acct.autopay.enrolled) { const apDays = b.dossier?.billing?.autopay?.days; if (Array.isArray(apDays) && apDays.length && ['utility-account', 'rent-portal'].includes(b.template)) acct.autopay.day = apDays[0]; acct.autopay.methodId = primaryMethodId(b, { autopay: true }); acct.autopay.enrolledAt = ep.clock - 90 * DAY; acct.autopay.history.push({ at: ep.clock - 90 * DAY, action: 'enrolled' }); }
    // Payment history: each paid prior bill has the posted payment that paid it (seeded: never counted as the agent's).
    const chk = acct.methods[0];
    invoices.slice(0, -1).forEach((inv, i) => {
      const cents = inv.amountCents - inv.balanceCents; if (cents <= 0) return;
      const at = inv.dueAt - between(r, 1, 6) * DAY; const auto = acct.autopay.enrolled;
      acct.payments.push({ id: `pay-h${hash(`${billerId}:${i}:${ep.seed}`, 6)}`, confirmation: `${auto ? 'AP' : b.brand.monogram}${digits(r, 9)}`, idempotencyKey: null, amountCents: cents, feeCents: 0, methodId: chk.id, methodType: chk.type, methodLast4: chk.last4, methodLabel: chk.label, source: auto ? 'autopay' : 'one_time', createdAt: at, appliedAt: at, postedAt: at + 2 * DAY, payOn: null, status: 'posted', amountKey: 'due', allocations: [{ invoiceId: inv.id, cents }], seeded: true, history: true });
    });
    if (sc.scheduledPayment) acct.payments.push({ id: `pay-${hash(`${billerId}:sched:${ep.seed}`, 6)}`, confirmation: `${b.brand.monogram}${digits(r, 9)}`, idempotencyKey: null, amountCents: amount, feeCents: 0, methodId: chk.id, methodType: chk.type, methodLast4: chk.last4, methodLabel: chk.label, source: 'one_time', createdAt: ep.clock - 2 * DAY, payOn: isoDate(ep.clock + 5 * DAY), wasScheduled: true, status: 'scheduled', amountKey: 'due', seeded: true });
    // No online account yet (register / guest tasks): the earlier payments were made offline, and the new online
    // account starts with an empty wallet.
    if (sc.registered === false && !sc.autopay && !sc.scheduledPayment) acct.methods = [];
    if (planList) acct.service.plan = plan;
    // Account numbers with a documented prefix (dossier billing.accountNumberPrefix, e.g. TrueAccord's 47-XXXX-XXXX).
    const prefix = dossier(b)?.billing?.accountNumberPrefix; if (prefix && !sc.accountNumber) acct.accountNumber = `${prefix}${acct.accountNumber.slice(String(prefix).length)}`;
    if (sc.cancelPending && b.capabilities.cancel_service.support === 'supported') Object.assign(acct.service, { status: 'cancel_pending', cancelAt: ep.clock + 12 * DAY, reason: 'moving', requestedAt: ep.clock - 2 * DAY, confirmation: `CX${digits(r, 8)}` });
    if (kind === 'card') {
      const minimumDueCents = this.cardMinimum(b, amount, cur.lines.find(l => l.desc === 'Interest charged')?.cents || 0);
      Object.assign(acct, { creditLimitCents: amount * 4, statementBalanceCents: amount, minimumDueCents, currentBalanceCents: amount + between(r, 0, 9000), statementIssuedAt: cur.issuedAt, aprBps: between(r, 1799, 2999) });
    }
    if (kind === 'loan') { const interest = cur.lines.find(l => l.desc === 'Interest')?.cents || 0; Object.assign(acct, { principalCents: Math.max(amount * 12, Math.round(interest * 12 * 10000 / rateBps)), escrowCents, rateBps, minimumDueCents: amount }); }
    if (kind === 'medical') Object.assign(acct, { guarantorId: `G${digits(r, 7)}`, statementId: `S${digits(r, 9)}`, visits: [{ date: fmtDate(ep.clock - 40 * DAY), provider: 'Outpatient services', cents: amount }] });
    if (kind === 'tax') {
      const sched = dossier(b)?.billing?.taxSchedule?.installments;
      const first = ep.clock + dueOffset * DAY; // scenario dueInDays moves the whole calendar, keeping its gaps
      const dues = taxDues ? taxDues.map(t => t - taxDues[0] + first) : [first, first + 120 * DAY];
      const each = Math.round(amount / dues.length);
      Object.assign(acct, { parcelId: `${digits(r, 2)}-${digits(r, 3)}-${digits(r, 2)}-${digits(r, 3)}.000`, taxYear: dossier(b)?.billing?.taxSchedule?.calendarYear ? new Date(dues[0]).getUTCFullYear() : 2026, installments: dues.map((dueAt, i) => ({ n: i + 1, ...(sched ? { label: sched[i].label } : {}), dueAt, cents: i === dues.length - 1 ? amount - each * i : each, paid: false })) });
    }
    if (kind === 'toll' || kind === 'government') Object.assign(acct, { plate: `${pick(r, ['BWL', 'KXT', 'MNR', 'TQA'])}${digits(r, 4)}`, vehicles: [{ plate: null, year: 2019, make: pick(r, ['Toyota', 'Honda', 'Ford', 'Subaru']) }] });
    if (kind === 'rent') Object.assign(acct, { unit: `Unit ${between(r, 101, 940)}`, leaseEnds: fmtDate(ep.clock + 200 * DAY) });
    if (kind === 'insurance') Object.assign(acct, { policyNumber: `${pick(r, ['HP', 'AU', 'MA', 'LF'])}${digits(r, 8)}` });
    // A biller whose sign-up asks for the access code printed on the bill (dossier auth.registrationFields): seed one (own rng: other seeded values do not move).
    if (dossier(b)?.auth?.registrationFields?.includes('accessCode')) { const ra = rng(`${ep.seed}:${billerId}:access`); acct.accessCode = Array.from({ length: 8 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(ra() * 32)]).join(''); }
    ep.accounts[billerId] = acct;
    // Snapshots for grading: amounts and settings at episode start, before the agent acts.
    const opts = this.amountOptions(acct); const opt = k => opts.find(o => o.key === k)?.cents ?? null;
    acct.start = { at: ep.clock, balanceCents: this.balance(acct), dueAt: cur.dueAt, minimumCents: opt('minimum') ?? (kind === 'loan' ? Math.min(amount, this.balance(acct)) : null), statementCents: opt('statement'), currentCents: opt('current'), installmentCents: opt('installment') };
    acct.baseline = this.sideEffectState(acct);
    // A customer without online access (or a guest-pay task) has the paper bill: its identifiers are in the inbox.
    if (sc.billNotice || sc.registered === false) this.billNotice(ep, b, acct);
    return acct;
  }
  billNotice(ep, b, acct) {
    const inv = this.currentInvoice(acct);
    const ids = [`${noticeLabel(b)}: ${acct.accountNumber}`, acct.statementId && `Statement ID: ${acct.statementId}`, acct.guarantorId && `Guarantor ID: ${acct.guarantorId}`, acct.parcelId && b.template !== 'income-tax' && `Parcel number: ${acct.parcelId}`, acct.plate && `License plate: ${acct.plate}`, acct.policyNumber && `Policy number: ${acct.policyNumber}`, acct.accessCode && `Access code (for online registration): ${acct.accessCode}`, !acct.statementId && `${dossier(b)?.auth?.guestLookupFields?.includes('statementId') ? String(dossier(b).labels?.statementId || 'Statement number') : /bill number/i.test(noticeLabel(b)) ? 'Invoice number' : 'Bill number'}: ${inv.number}`, `${acct.kind === 'tax' ? 'ZIP code' : 'Service ZIP code'}: ${acct.zip}`,
      // Phone-number lookups / sign-in (dossier guestLookupFields or identifier 'phone'): the notice carries the number too.
      (b.dossier?.auth?.guestLookupFields?.includes('phone') || b.dossier?.auth?.identifier === 'phone') && `${/wireless|mobile|cell/i.test(`${b.entry?.bill_type || ''} ${b.category || ''}`) ? 'Mobile number' : 'Phone number'}: ${ep.persona.phone}`].filter(Boolean);
    // Subscriptions and memberships bill per renewal, not as monthly statements (the subject keeps "bill is ready" for solvers).
    this.mail(ep, b.id, { subject: `Your ${b.brand.shortName} ${b.kind === 'subscription' ? 'renewal ' : ''}bill is ready`, text: `Hi ${ep.persona.first},\n\nYour ${b.kind === 'subscription' ? 'renewal bill' : 'statement'} dated ${fmtDate(inv.issuedAt)} is ready.\n\n${ids.join('\n')}\nAmount due: ${money(Math.max(0, this.balance(acct)))}\nDue date: ${fmtDate(inv.dueAt)}\n\nPay online: {{link:home}}\nKeep this notice: you need your ${noticeLabel(b).replace(/\b[A-Z](?=[a-z])/g, c => c.toLowerCase())} ${b.capabilities.guest_pay?.support === 'supported' ? 'to register or to pay without signing in' : 'to register for online access'}.`, links: [{ key: 'home', page: 'home', query: null }] });
  }
  balance(acct) { return acct.invoices.reduce((a, i) => a + i.balanceCents, 0) - (acct.creditCents || 0); }
  currentInvoice(acct) { return acct.invoices[acct.invoices.length - 1]; }
  // Agent-visible state compared by the no_unrequested_changes predicate.
  sideEffectState(acct) {
    const ap = acct.autopay;
    return {
      autopay: JSON.stringify([ap.enrolled, ap.enrolled ? ap.methodId : null, ap.enrolled ? ap.policy : null, ap.enrolled ? ap.fixedCents : null, ap.enrolled ? ap.day : null]), paperless: !!acct.paperless, service_status: acct.service.status, plan: acct.service.plan,
      retention: !!acct.service.retentionAccepted, methods: acct.methods.filter(m => m.saved && !m.removed).map(m => m.id).sort().join(','), messages: acct.messages.length, arrangement: JSON.stringify(acct.arrangement && [acct.arrangement.months, acct.arrangement.monthlyCents]),
      scheduled: acct.payments.filter(p => p.status === 'scheduled').map(p => p.id).sort().join(','), profile: acct.phone || null
    };
  }

  // ---------- mail ----------
  mail(ep, billerId, { from, subject, text, links = [] }) {
    const b = billerId ? this.biller(billerId) : null;
    // Ids are monotonic per episode (mail-1, mail-2, ...): stable across replays of the same actions.
    const msg = { id: `mail-${ep.mailSeq = (ep.mailSeq || 0) + 1}`, threadId: `thr-${hash(`${billerId}:${subject}`, 10)}`, billerId, from: from || `${b.brand.shortName} <no-reply@${b.brand.domain || `${b.id}.billworld.test`}>`, to: ep.persona.email, subject, text, links, receivedAt: ep.clock, unread: true, starred: false, labels: ['INBOX'] };
    ep.mailbox.unshift(msg); return msg;
  }
  searchMail(ep, q = '') {
    const terms = String(q).toLowerCase().match(/(?:[^\s"]+|"[^"]*")+/g) || [];
    return ep.mailbox.filter(m => !m.labels.includes('TRASH')).filter(m => terms.every(t => {
      const [k, v] = t.includes(':') ? [t.split(':')[0], t.slice(t.indexOf(':') + 1).replace(/"/g, '')] : [null, t.replace(/"/g, '')];
      if (k === 'from') return m.from.toLowerCase().includes(v);
      if (k === 'subject') return m.subject.toLowerCase().includes(v);
      if (k === 'is') return v === 'unread' ? m.unread : v === 'starred' ? m.starred : true;
      return `${m.from} ${m.subject} ${m.text}`.toLowerCase().includes(v);
    }));
  }

  // ---------- auth ----------
  session(ep, billerId, sid) { const s = sid && ep.sessions[sid]; return s && s.billerId === billerId && s.expiresAt > ep.clock ? s : null; }
  requireSession(ep, billerId, sid) { const s = this.session(ep, billerId, sid); if (!s || !s.authenticated) throw new Fault('Please sign in to continue', 401, 'auth_required'); return this.account(ep, billerId); }
  startSession(ep, billerId, authenticated) { const sid = token(16); ep.sessions[sid] = { billerId, authenticated, createdAt: ep.clock, expiresAt: ep.clock + 30 * MINUTE }; return sid; }
  // Five failures (passwords or MFA codes) lock the account for 15 minutes; the counter starts over once a lock expires.
  releaseLock(ep, acct) { if (acct.lockedUntil && acct.lockedUntil <= ep.clock) { acct.lockedUntil = 0; acct.failedLogins = 0; } }
  countFailure(ep, acct) { acct.failedLogins++; if (acct.failedLogins >= lockoutAttempts(this.catalog.billers.get(acct.billerId))) acct.lockedUntil = ep.clock + 15 * MINUTE; }
  sendMfa(ep, billerId, acct) {
    const code = code6();
    acct.mfaChallenge = { code, expiresAt: ep.clock + 10 * MINUTE, attempts: 0, sentWall: Date.now(), resends: acct.mfaChallenge?.resends || 0 };
    const name = this.biller(billerId).brand.shortName;
    if (acct.mfa === 'sms') { this.sms(ep, billerId, `${name}: ${code} is your verification code. It expires in 10 minutes. Don't share this code with anyone.`); acct.mfaChannel = 'sms'; return; }
    this.mail(ep, billerId, { subject: `${code} is your ${name} verification code`, text: `Your one-time verification code is ${code}. It expires in 10 minutes. If you did not try to sign in, ignore this message.` });
  }
  // Text message to the persona's phone: ep.sms = { seq, messages } (read by the /sms page and the connector).
  // A host may route delivery itself by setting world.onSms(ep, billerId, text).
  sms(ep, billerId, text) {
    if (typeof this.onSms === 'function') return this.onSms(ep, billerId, text);
    const s = ep.sms || (ep.sms = { seq: 0, messages: [] }); const b = billerId ? this.biller(billerId) : null;
    const msg = { id: `sms-${++s.seq}`, from: b ? smsShortCode(b.id) : '22000', sender: b?.brand.shortName || 'Billworld', to: ep.persona.phone, billerId: billerId || null, text: String(text).slice(0, 640), receivedAt: ep.clock, unread: true };
    s.messages.push(msg); this.event(ep, billerId, 'sms_sent', { smsId: msg.id }); return msg;
  }

  login(ep, billerId, { username, password }) {
    this.guard(ep); const b = this.biller(billerId);
    if (this.isOffline(b)) throw new Fault('Online accounts are not available for this biller', 400, 'unsupported');
    const acct = this.account(ep, billerId);
    this.releaseLock(ep, acct);
    if (acct.lockedUntil > ep.clock) throw new Fault('Your account is temporarily locked after too many attempts. Reset your password or try again later.', 423, 'locked');
    if (!filled(password)) throw new Fault('Enter your password.', 400, 'missing'); // a missing field is not a failed attempt
    const idOk = this.identifierMatches(b, ep, acct, username);
    if (!acct.registered || !idOk || password !== acct.password) {
      this.countFailure(ep, acct);
      this.event(ep, billerId, 'login_failed', { reason: !acct.registered ? 'not_registered' : 'bad_credentials' }); this.persist(ep);
      throw new Fault('The user ID or password you entered is incorrect. If you have not created an online account yet, register first.', 401, 'bad_credentials'); // one message: no account enumeration
    }
    if (!acct.emailVerified) throw new Fault('Please verify your email address before signing in. Check your inbox for the verification link.', 403, 'unverified');
    if (acct.mfa === 'email' || acct.mfa === 'sms') {
      acct.mfaChallenge = null; this.sendMfa(ep, billerId, acct);
      const sid = this.startSession(ep, billerId, false); ep.sessions[sid].pendingMfa = true;
      this.event(ep, billerId, 'mfa_challenge_sent'); this.persist(ep); return { sid, mfa: true };
    }
    acct.failedLogins = 0;
    const sid = this.startSession(ep, billerId, true); this.event(ep, billerId, 'login'); this.persist(ep); return { sid, mfa: false };
  }
  verifyMfa(ep, billerId, sid, { code }) {
    this.guard(ep); const s = this.session(ep, billerId, sid); const acct = this.account(ep, billerId);
    if (!s?.pendingMfa || !acct.mfaChallenge) throw new Fault('Your verification session expired. Sign in again.', 401, 'auth_required');
    const ch = acct.mfaChallenge;
    if (ch.expiresAt < ep.clock) throw new Fault('That code has expired. Sign in again to get a new code.', 400, 'expired');
    if (++ch.attempts > 5) throw new Fault('Too many attempts. Sign in again.', 429, 'too_many');
    this.releaseLock(ep, acct);
    if (acct.lockedUntil > ep.clock) throw new Fault('Your account is temporarily locked after too many attempts. Reset your password or try again later.', 423, 'locked');
    if (String(code || '').trim() !== ch.code) { this.countFailure(ep, acct); this.event(ep, billerId, 'mfa_failed'); this.persist(ep); throw new Fault('That code is incorrect.', 400, 'bad_code'); }
    acct.mfaChallenge = null; acct.failedLogins = 0; s.pendingMfa = false; s.authenticated = true; this.event(ep, billerId, 'login', { mfa: acct.mfa === 'sms' ? 'sms' : 'email' }); this.persist(ep); return { sid };
  }
  // New code for a pending MFA sign-in; supersedes the old one. 30-second (wall clock) cooldown, five resends per sign-in.
  resendMfa(ep, billerId, sid) {
    this.guard(ep); const s = this.session(ep, billerId, sid); const acct = this.account(ep, billerId);
    if (!s?.pendingMfa || !acct.mfaChallenge) throw new Fault('Your verification session expired. Sign in again.', 401, 'auth_required');
    const ch = acct.mfaChallenge;
    if (Date.now() - ch.sentWall < 30000) throw new Fault('Please wait 30 seconds before requesting another code.', 429, 'cooldown');
    if (ch.resends >= 5) throw new Fault('Too many codes requested. Sign in again.', 429, 'too_many');
    acct.mfaChallenge.resends = ch.resends + 1; this.sendMfa(ep, billerId, acct);
    this.event(ep, billerId, 'mfa_challenge_sent', { resend: true }); this.persist(ep); return { ok: true };
  }
  logout(ep, sid) { delete ep.sessions[sid]; }
  // Which sign-in identifiers a biller accepts: its dossier's auth.identifier, else the email or the account number.
  identifierMatches(b, ep, acct, value) {
    const v = String(value || '').trim().toLowerCase();
    switch (dossier(b)?.auth?.identifier) {
      case 'email': case 'username': case 'email_or_username': return v === acct.username.toLowerCase();
      case 'account': return v.replace(/[\s-]/g, '') === acct.accountNumber;
      case 'email_or_account': return v === acct.username.toLowerCase() || v.replace(/[\s-]/g, '') === acct.accountNumber;
      case 'phone': { const d = v.replace(/\D/g, '').replace(/^1(?=\d{10}$)/, ''); return (d.length === 10 && d === ep.persona.phone.replace(/\D/g, '')) || v === acct.username.toLowerCase(); }
      default: return [acct.username.toLowerCase(), acct.accountNumber].includes(v);
    }
  }

  register(ep, billerId, input) {
    this.guard(ep); const acct = this.account(ep, billerId);
    if (acct.registered && acct.emailVerified) throw new Fault('An online account already exists for this account number. Sign in or reset your password.', 409, 'exists');
    const noMatch = code => new Fault('We could not match that information to an account. Check the details on your bill and try again.', 400, code); // one message for every identity mismatch
    if (String(input.accountNumber || '').replace(/\D/g, '') !== acct.accountNumber) throw noMatch('no_match');
    if (input.lastName != null && String(input.lastName).trim().toLowerCase() !== ep.persona.last.toLowerCase()) throw noMatch('no_match');
    if (input.zip != null && ![ep.persona.zip, acct.zip].includes(String(input.zip).trim())) throw noMatch('no_match');
    if (String(input.email || '').trim().toLowerCase() !== ep.persona.email) throw noMatch('email_mismatch');
    const missing = (dossier(this.biller(billerId))?.auth?.registrationFields || []).filter(f => !filled(input[f]));
    if (missing.length) throw new Fault(`Complete every required field (missing: ${missing.map(f => REG_WORD[f] || f).join(', ')}).`, 400, 'missing');
    if (input.phone != null && filled(input.phone) && String(input.phone).replace(/\D/g, '').slice(-10) !== ep.persona.phone.replace(/\D/g, '')) throw noMatch('no_match');
    if (acct.accessCode && String(input.accessCode || '').replace(/[\s-]/g, '').toUpperCase() !== acct.accessCode) throw noMatch('no_match');
    this.checkPassword(input.password, input.confirm, this.biller(billerId));
    acct.registered = true; acct.emailVerified = false; acct.password = input.password; acct.username = ep.persona.email;
    acct.verification = { token: token(12), expiresAt: ep.clock + DAY };
    this.mail(ep, billerId, { subject: `Verify your email for ${this.biller(billerId).brand.shortName}`, text: `Thanks for registering. Confirm your email address to activate online access:\n\n{{link:verify}}\n\nThis link expires in 24 hours.`, links: [{ key: 'verify', page: 'verify', query: { token: acct.verification.token } }] });
    this.event(ep, billerId, 'registered'); this.persist(ep); return { ok: true };
  }
  verifyEmail(ep, billerId, tokenValue) {
    this.guard(ep); const acct = this.account(ep, billerId);
    if (!acct.verification || acct.verification.token !== tokenValue || acct.verification.expiresAt < ep.clock) throw new Fault('This verification link is invalid or has expired.', 400, 'bad_token');
    acct.emailVerified = true; acct.verification = null; this.event(ep, billerId, 'email_verified'); this.persist(ep); return { ok: true };
  }
  checkPassword(password, confirm, b = null) {
    if (confirm != null && password !== confirm) throw new Fault('Passwords do not match.', 400, 'mismatch');
    const rule = dossier(b)?.auth?.passwordRule;
    if (rule) { if (!new RegExp(rule.pattern).test(String(password || '')) || String(password || '').length > 128) throw new Fault(rule.message, 400, 'weak_password'); return; }
    if (!/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^\w\s]).{8,64}$/.test(String(password || ''))) throw new Fault('Password must be 8–64 characters with upper and lower case letters, a number and a symbol.', 400, 'weak_password');
  }
  requestReset(ep, billerId, { identifier }) {
    this.guard(ep); const acct = this.account(ep, billerId);
    const id = String(identifier || '').trim().toLowerCase();
    this.event(ep, billerId, 'reset_requested');
    // Any identifier the biller signs in with (email, account number, username, phone) finds the account.
    if (acct.registered && ([acct.username.toLowerCase(), acct.accountNumber].includes(id) || this.identifierMatches(this.biller(billerId), ep, acct, id))) {
      const now = Date.now(); acct.resetRequests = (acct.resetRequests || []).filter(t => now - t < 3600000);
      if (acct.resetRequests.length >= 10) { this.event(ep, billerId, 'reset_throttled'); this.persist(ep); return { ok: true, sent: false }; } // silently throttled: same response
      acct.resetRequests.push(now);
      acct.resetChallenges.forEach(c => { c.superseded = true; });
      const code = code6();
      const ch = { code, token: token(12), expiresAt: ep.clock + 30 * MINUTE, issuedWall: now, attempts: 0, used: false, superseded: false };
      acct.resetChallenges.push(ch);
      this.mail(ep, billerId, { subject: `Reset your ${this.biller(billerId).brand.shortName} password`, text: `We received a request to reset your password.\n\nVerification code: ${code}\n\nOr open this link: {{link:reset}}\n\nThe code expires in 30 minutes. If you didn't request this, you can ignore this email.`, links: [{ key: 'reset', page: 'reset', query: { token: ch.token } }] });
      this.persist(ep); return { ok: true, sent: true, to: maskEmail(acct.username) };
    }
    this.persist(ep); return { ok: true, sent: false }; // The page says the same either way: no account enumeration.
  }
  resetPassword(ep, billerId, { code, token: tok, password, confirm }) {
    this.guard(ep); const acct = this.account(ep, billerId);
    const ch = acct.resetChallenges.find(c => (code && c.code === String(code).trim()) || (tok && c.token === tok));
    const expired = c => c.expiresAt < ep.clock || (c.issuedWall && Date.now() - c.issuedWall > 30 * MINUTE);
    if (!ch || ch.used || ch.superseded || expired(ch)) {
      // Five wrong codes burn the outstanding challenge: the 6-digit space cannot be searched.
      for (const c of acct.resetChallenges.filter(c => !c.used && !c.superseded)) if (++c.attempts >= 5) c.superseded = true;
      this.event(ep, billerId, 'reset_failed'); this.persist(ep);
      throw new Fault('That reset code is invalid or has expired. Request a new one.', 400, 'bad_code');
    }
    this.checkPassword(password, confirm, this.biller(billerId));
    if (password === acct.password) throw new Fault('Choose a password you have not used before.', 400, 'reused');
    ch.used = true; acct.password = password; acct.lockedUntil = 0; acct.failedLogins = 0;
    for (const [sid, s] of Object.entries(ep.sessions)) if (s.billerId === billerId) delete ep.sessions[sid];
    this.mail(ep, billerId, { subject: 'Your password was changed', text: 'The password for your online account was just changed. If this wasn\'t you, contact customer service.' });
    this.event(ep, billerId, 'password_reset'); this.persist(ep); return { ok: true };
  }

  // ---------- payment methods ----------
  // A saved method (methodId) or new details. Typed card/bank details always win over a pre-selected saved method.
  // Guests may only use methods they entered in their own guest session, and never save into the account wallet.
  methodFromInput(ep, acct, input, { guest = false, sid = null } = {}) {
    const hasCard = filled(input.cardNumber), hasBank = filled(input.routing) || filled(input.bankAccount);
    let type = ['bank', 'card'].includes(input.methodType) ? input.methodType : null;
    if (!type && hasCard && hasBank) throw new Fault('Enter either a bank account or a card, not both.', 400, 'ambiguous_method');
    if (!type && (hasCard || hasBank)) type = hasCard ? 'card' : 'bank';
    if (type && input.methodId && !(type === 'card' ? hasCard : hasBank) && !filled(input.exp) && !filled(input.cvv)) type = null; // type picker touched but no details typed
    const allowed = methodTypesFor(this.catalog.billers.get(acct.billerId), { guest });
    const refuse = t => { if (!allowed.includes(t)) throw new Fault(t === 'card' ? 'Card payments are not accepted online for this account. Pay from a bank account.' : 'Bank account payments are not accepted online for this account. Pay by card.', 400, 'method_not_accepted'); };
    if (type) refuse(type);
    if (!type) {
      const m = input.methodId && acct.methods.find(x => x.id === input.methodId && !x.removed && !x.discarded);
      if (!m || (guest ? m.guestSid !== sid : !!m.guestSid)) throw new Fault('Select a payment method.', 400, 'no_method');
      if (isExpired(m, ep.clock)) throw new Fault('This card has expired. Update it or choose another method.', 400, 'expired_card');
      refuse(m.type);
      return m;
    }
    const save = !guest && !!input.save && input.save !== 'false';
    if (type === 'bank') {
      const routing = String(input.routing || '').replace(/\D/g, ''); const account = String(input.bankAccount || '').replace(/\D/g, '');
      if (!/^\d{9}$/.test(routing) || !this.abaValid(routing)) throw new Fault('Enter a valid 9-digit routing number.', 400, 'bad_routing');
      if (!/^\d{4,17}$/.test(account)) throw new Fault('Enter a valid bank account number.', 400, 'bad_account');
      if (input.bankAccountConfirm != null && String(input.bankAccountConfirm).replace(/\D/g, '') !== account) throw new Fault('Account numbers do not match.', 400, 'mismatch');
      const m = { id: `pm-${token(5)}`, type: 'bank', label: input.accountType === 'savings' ? 'Savings' : 'Checking', bankName: 'Bank account', last4: account.slice(-4), routing, holder: input.holder || ep.persona.name, saved: save, nickname: null, ...(guest ? { guestSid: sid } : {}) };
      acct.methods.push(m); return m;
    }
    const number = String(input.cardNumber || '').replace(/\D/g, '');
    if (!luhn(number)) throw new Fault('Enter a valid card number.', 400, 'bad_card');
    const e = parseExp(input.exp); const nowYear = new Date(ep.clock).getUTCFullYear();
    if (!e || e.year * 12 + e.mm < monthIndex(ep.clock) || e.year > nowYear + 20) throw new Fault('Enter a valid, unexpired expiration date (MM/YY).', 400, 'bad_exp');
    if (!/^\d{3,4}$/.test(String(input.cvv || ''))) throw new Fault('Enter the security code.', 400, 'bad_cvv');
    const brand = cardBrandOf(number), accepted = cardBrandsFor(this.catalog.billers.get(acct.billerId));
    if (accepted && !accepted.includes(brand)) throw new Fault(`${brand ? CARD_BRANDS[brand] : 'This card'} is not accepted. We accept ${brandList(accepted)}.`, 400, 'card_brand_not_accepted');
    const m = { id: `pm-${token(5)}`, type: 'card', label: brand ? CARD_BRANDS[brand] : 'Card', brand: null, last4: number.slice(-4), exp: `${String(e.mm).padStart(2, '0')}/${String(e.year % 100).padStart(2, '0')}`, holder: input.holder || ep.persona.name, saved: save, declines: number === TEST_CARDS.declined, ...(guest ? { guestSid: sid } : {}) };
    m.brand = m.label; acct.methods.push(m); return m;
  }
  abaValid(r) { const d = r.split('').map(Number); return (3 * (d[0] + d[3] + d[6]) + 7 * (d[1] + d[4] + d[7]) + (d[2] + d[5] + d[8])) % 10 === 0; }
  addMethod(ep, billerId, sid, input) { this.guard(ep); const acct = this.requireSession(ep, billerId, sid); const m = this.methodFromInput(ep, acct, { ...input, methodId: null, save: true }); m.saved = true; if (input.nickname) m.nickname = String(input.nickname).slice(0, 40); this.event(ep, billerId, 'method_added', { methodId: m.id, type: m.type }); this.persist(ep); return m; }
  // check: true validates the removal (method exists, not used by AutoPay or a scheduled payment) without removing it,
  // so the site can ask "Remove … ?" first and still refuse an AutoPay method at once.
  removeMethod(ep, billerId, sid, { methodId, check = false }) {
    this.guard(ep); const acct = this.requireSession(ep, billerId, sid); const m = acct.methods.find(x => x.id === methodId && !x.removed && x.saved);
    if (!m) throw new Fault('Payment method not found.', 404, 'no_method');
    if (acct.autopay.enrolled && acct.autopay.methodId === methodId) throw new Fault('This method is used for AutoPay. Change or cancel AutoPay before removing it.', 409, 'in_use');
    if (acct.payments.some(p => p.status === 'scheduled' && p.methodId === methodId)) throw new Fault('This method has a scheduled payment. Cancel the payment before removing it.', 409, 'in_use');
    if (check) return { ok: true, method: m };
    m.removed = true; m.saved = false;
    if (acct.draft?.methodId === methodId) Object.assign(acct.draft, { methodId: null, token: null, feeCents: 0, sig: null });
    this.event(ep, billerId, 'method_removed', { methodId, last4: m.last4 }); this.persist(ep); return { ok: true };
  }
  fee(billerId, method, cents, { autopay = false } = {}) {
    const f = this.biller(billerId).fees;
    if (method.guestSid && method.type === 'bank' && f.guestBankCents != null) return f.guestBankCents;
    if (method.guestSid && method.type === 'card' && f.guestCardCents != null) return f.guestCardCents;
    if (autopay && method.type === 'card' && f.autopayCardPercent != null) return Math.round(cents * f.autopayCardPercent / 100);
    if (autopay && method.type === 'card' && f.autopayCardCents != null) return f.autopayCardCents;
    if (method.type === 'bank') return f.bankCents ?? 0;
    if (f.cardPercent != null) return Math.max(f.cardMinCents || 0, Math.round(cents * f.cardPercent / 100)); // cardMinCents: "3% (minimum $1.50)"
    if (f.cardCents != null) return f.cardCents;
    return ['tax', 'government', 'medical'].includes(this.biller(billerId).kind) ? Math.max(195, Math.round(cents * 0.0235)) : ['utility'].includes(this.biller(billerId).kind) ? 295 : 0; // synthetic defaults
  }

  // ---------- payments ----------
  paidSince(acct, since) { return acct.payments.filter(p => p.appliedAt != null && p.appliedAt >= since && !['failed', 'cancelled'].includes(p.status)).reduce((a, p) => a + p.amountCents, 0); }
  // Card figures move with payments: remaining statement balance, remaining minimum and current balance.
  cardFigures(acct) {
    const bal = this.balance(acct); const paid = this.paidSince(acct, acct.statementIssuedAt ?? this.currentInvoice(acct).issuedAt);
    const unbilled = Math.max(0, (acct.currentBalanceCents || 0) - (acct.statementBalanceCents || 0));
    return { statement: Math.max(0, bal), minimum: Math.max(0, Math.min((acct.minimumDueCents || 0) - paid, bal)), current: Math.max(0, bal + unbilled) };
  }
  loanMinimum(acct) { const cur = this.currentInvoice(acct); return Math.max(0, Math.min((acct.minimumDueCents ?? cur.amountCents) - this.paidSince(acct, cur.issuedAt), this.balance(acct))); }
  amountOptions(acct) {
    const bal = Math.max(0, this.balance(acct));
    const opts = [{ key: 'due', label: 'Amount due', cents: bal }];
    if (acct.kind === 'card') { const f = this.cardFigures(acct); opts.push({ key: 'minimum', label: 'Minimum payment due', cents: f.minimum }, { key: 'statement', label: 'Statement balance', cents: f.statement }, { key: 'current', label: 'Current balance', cents: f.current }); }
    if (acct.kind === 'tax') {
      const inst = acct.installments.find(i => !i.paid);
      if (inst && acct.installments.length > 1) { // a single annual bill has no separate installment amount
        const cur = this.currentInvoice(acct); const paid = cur.amountCents - Math.max(0, cur.balanceCents);
        const cumulative = acct.installments.filter(i => i.n <= inst.n).reduce((a, i) => a + i.cents, 0);
        const pastDue = acct.invoices.slice(0, -1).reduce((a, i) => a + Math.max(0, i.balanceCents), 0);
        opts.push({ key: 'installment', label: inst.label || `Installment ${inst.n}`, cents: Math.min(bal, pastDue + Math.max(0, cumulative - paid)) });
      }
    }
    // fullBalanceOnly: no "other amount" while there is a balance to pay (the engine would refuse it anyway).
    if (!(paymentLimits(this.catalog.billers.get(acct.billerId)).fullBalanceOnly && bal > 0)) opts.push({ key: 'other', label: 'Other amount', cents: null });
    return opts;
  }
  syncInstallments(acct) {
    if (acct.kind !== 'tax' || !acct.installments) return;
    const cur = this.currentInvoice(acct); const paid = cur.amountCents - Math.max(0, cur.balanceCents); let cumulative = 0;
    for (const i of acct.installments) { cumulative += i.cents; i.paid = paid >= cumulative; }
  }
  // A draft collects amount, method and date across however many pages a template uses.
  draftPayment(ep, billerId, sid, input, { guest = false } = {}) {
    this.guard(ep); const acct = guest ? this.guestAccount(ep, billerId, sid) : this.requireSession(ep, billerId, sid); const b = this.biller(billerId);
    if (['unsupported', 'not_applicable'].includes(b.capabilities.pay_online.support)) throw new Fault('Online payments are not available for this account.', 400, 'unsupported');
    const d = acct.draft && acct.draft.sid === sid ? acct.draft : (acct.draft = { sid, guest, amountCents: null, amountKey: null, methodId: null, payOn: null, token: null });
    if (input.amountChoice || filled(input.amount)) {
      const opts = this.amountOptions(acct);
      const choice = input.amountChoice || 'other';
      const opt = opts.find(o => o.key === choice) || (filled(input.amount) ? opts.find(o => o.key === 'other') : null);
      if (!opt && paymentLimits(b).fullBalanceOnly && this.balance(acct) > 0) throw new Fault(`Online payments must be for the full balance of ${money(this.balance(acct))}.`, 400, 'full_balance_only');
      if (!opt) throw new Fault('Choose a payment amount.', 400, 'bad_amount_choice');
      let cents;
      if (opt.cents != null) {
        if (filled(input.amount)) { // a typed amount with a preset choice still selected is ambiguous: never silently ignore it
          let typed = null; try { typed = parseMoney(input.amount); } catch { /* reported below */ }
          const stalePrefill = d.amountKey === 'other' && typed === d.amountCents;
          if (typed !== opt.cents && !stalePrefill) throw new Fault('To pay a different amount, select “Other amount” and enter it there.', 400, 'amount_choice');
        }
        cents = opt.cents;
      } else cents = parseMoney(input.amount);
      const lim = paymentLimits(b);
      if (cents < lim.minCents) throw new Fault(`The minimum payment is ${money(lim.minCents)}.`, 400, 'min_amount');
      if (lim.fullBalanceOnly && this.balance(acct) > 0 && cents !== this.balance(acct)) throw new Fault(`Online payments must be for the full balance of ${money(this.balance(acct))}.`, 400, 'full_balance_only');
      // Cards: the cap is the current balance the site offers (cardFigures().current), not the statement balance.
      const capCents = Math.max(0, acct.kind === 'card' ? this.cardFigures(acct).current : this.balance(acct));
      if (lim.maxPaymentBalance && cents > capCents) throw new Fault(`Online payments cannot exceed your current balance of ${money(capCents)}.`, 400, 'amount_over_balance');
      if (cents > lim.maxCents || (acct.kind !== 'card' && acct.kind !== 'toll' && cents > Math.max(this.balance(acct), 0) + 500000)) throw new Fault('That amount exceeds the maximum allowed for a single payment.', 400, 'max_amount');
      d.amountCents = cents; d.amountKey = opt.key;
      d.amountMatches = opts.filter(o => o.cents === cents).map(o => o.key); // "Other" typed to exactly the amount due still counts as the amount due
    }
    if (input.methodId || input.methodType || filled(input.cardNumber) || filled(input.routing) || filled(input.bankAccount)) d.methodId = this.methodFromInput(ep, acct, input, { guest, sid }).id;
    if (input.payOn) {
      const when = Date.parse(`${input.payOn}T17:00:00Z`);
      if (!Number.isFinite(when)) throw new Fault('Enter a valid payment date.', 400, 'bad_date');
      if (when < Date.parse(`${isoDate(ep.clock)}T00:00:00Z`)) throw new Fault('The payment date cannot be in the past.', 400, 'past_date');
      const future = isoDate(when) !== isoDate(ep.clock);
      const ahead = paymentLimits(b).maxDaysAhead;
      if (future && ahead === 0) throw new Fault('Future-dated payments are not available online. Pay today instead.', 400, 'unsupported');
      if (future && lim2(b).maxPending && acct.payments.filter(p => p.status === 'scheduled').length >= lim2(b).maxPending) throw new Fault(`You can have up to ${lim2(b).maxPending} scheduled payment${lim2(b).maxPending === 1 ? '' : 's'} at a time.`, 400, 'max_pending');
      if (future && when > ep.clock + ahead * DAY) throw new Fault(ahead >= 365 ? 'Payments can be scheduled up to one year in advance.' : `Payments can be scheduled up to ${ahead} days in advance.`, 400, 'far_date');
      if (future && b.capabilities.scheduled_payment.support !== 'supported') throw new Fault('Future-dated payments are not available online.', 400, 'unsupported');
      d.payOn = future ? isoDate(when) : null;
    }
    if (d.amountCents && d.methodId) {
      const m = acct.methods.find(x => x.id === d.methodId);
      d.feeCents = this.fee(billerId, m, d.amountCents);
      // The review token is bound to what the review page shows: any change issues a new token, so a stale review cannot charge a different amount.
      const sig = `${d.amountCents}|${d.methodId}|${d.payOn || ''}|${d.feeCents}`;
      if (!d.token || d.sig !== sig) { d.token = token(12); d.sig = sig; }
    }
    this.persist(ep);
    return this.draftView(acct);
  }
  draftView(acct) { const d = acct.draft; if (!d) return null; const m = acct.methods.find(x => x.id === d.methodId); return { ...d, method: m || null, totalCents: (d.amountCents || 0) + (d.feeCents || 0), complete: !!(d.amountCents && d.methodId && d.token) }; }
  submitPayment(ep, billerId, sid, { token: tok, acceptTerms }, { guest = false } = {}) {
    this.guard(ep); const acct = guest ? this.guestAccount(ep, billerId, sid) : this.requireSession(ep, billerId, sid);
    const prior = acct.payments.find(p => p.idempotencyKey && p.idempotencyKey === tok);
    if (prior) { if (prior.status === 'failed') throw new Fault('Your card was declined. Choose another payment method.', 402, 'declined'); return prior; } // duplicate submit replays the original outcome
    const d = acct.draft;
    if (!d || d.sid !== sid || !d.token || d.token !== tok) throw new Fault('Your payment details changed or your session expired. Review the payment again.', 409, 'stale');
    if (!acceptTerms) throw new Fault('You must agree to the payment terms to continue.', 400, 'terms');
    const m = acct.methods.find(x => x.id === d.methodId);
    const unusable = !m || m.removed || (guest ? m.guestSid !== sid : !!m.guestSid);
    if (unusable || isExpired(m, ep.clock)) { Object.assign(d, { methodId: null, token: null, feeCents: 0, sig: null }); this.persist(ep); throw unusable ? new Fault('That payment method is no longer available. Choose another method.', 409, 'no_method') : new Fault('This card has expired. Update it or choose another method.', 400, 'expired_card'); }
    const conf = `${this.biller(billerId).brand.monogram}${digits(rng(`${tok}`), 9)}`;
    const p = { id: `pay-${token(6)}`, confirmation: conf, idempotencyKey: tok, amountCents: d.amountCents, feeCents: d.feeCents || 0, methodId: m.id, methodType: m.type, methodLast4: m.last4, methodLabel: m.label, methodSaved: !!m.saved, source: guest ? 'guest' : 'one_time', createdAt: ep.clock, payOn: d.payOn, wasScheduled: !!d.payOn, status: d.payOn ? 'scheduled' : 'processing', amountKey: d.amountKey, amountMatches: d.amountMatches || [d.amountKey] };
    if (!d.payOn && m.declines) {
      p.status = 'failed'; p.failure = 'card_declined'; acct.payments.push(p); if (!m.saved) m.discarded = true;
      Object.assign(d, { methodId: null, token: null, feeCents: 0, sig: null });
      this.event(ep, billerId, 'payment_failed', { paymentId: p.id, reason: 'card_declined', methodId: m.id, methodType: m.type }); this.persist(ep);
      throw new Fault('Your card was declined. Choose another payment method.', 402, 'declined');
    }
    acct.payments.push(p); acct.draft = null;
    if (!m.saved) m.discarded = true; // one-time methods are not retained (they are not "removed" from a wallet)
    if (!d.payOn) this.applyPayment(acct, p, ep.clock);
    this.event(ep, billerId, d.payOn ? 'payment_scheduled' : 'payment_submitted', { paymentId: p.id, amountCents: p.amountCents, feeCents: p.feeCents, methodId: m.id, methodType: m.type, payOn: p.payOn, guest, source: p.source });
    this.mail(ep, billerId, { subject: d.payOn ? `Payment scheduled – confirmation ${conf}` : `Payment received – confirmation ${conf}`, text: `${d.payOn ? 'Your payment is scheduled' : 'Thank you for your payment'}.\n\nAmount: ${money(p.amountCents)}${p.feeCents ? `\nConvenience fee: ${money(p.feeCents)}` : ''}\nPayment method: ${m.label} ending in ${m.last4}\n${d.payOn ? `Scheduled for: ${d.payOn}` : `Date: ${isoDate(ep.clock)}`}\nConfirmation number: ${conf}\nAccount: ****${acct.accountNumber.slice(-4)}` });
    this.persist(ep); return p;
  }
  // Applied payments reduce invoice balances immediately (oldest first); any remainder is an account credit.
  applyPayment(acct, p, at) {
    p.status = 'pending'; p.appliedAt = at ?? p.createdAt; p.postsAt = this.addBusinessDays(p.payOn ? Date.parse(`${p.payOn}T17:00:00Z`) : p.createdAt, p.methodType === 'bank' ? 2 : 1);
    let left = p.amountCents; p.allocations = [];
    for (const inv of acct.invoices.filter(i => i.balanceCents > 0).sort((a, b) => a.dueAt - b.dueAt)) { const take = Math.min(left, inv.balanceCents); if (take <= 0) break; inv.balanceCents -= take; p.allocations.push({ invoiceId: inv.id, cents: take }); left -= take; }
    if (left > 0) { acct.creditCents = (acct.creditCents || 0) + left; p.creditCents = left; }
    this.syncInstallments(acct);
  }
  addBusinessDays(ms, n) { let t = ms; while (n > 0) { t += DAY; const wd = new Date(t).getUTCDay(); if (wd !== 0 && wd !== 6) n--; } return t; }
  cancelScheduled(ep, billerId, sid, { paymentId }) {
    this.guard(ep); const acct = this.requireSession(ep, billerId, sid); const p = acct.payments.find(x => x.id === paymentId);
    if (!p) throw new Fault('Payment not found.', 404, 'not_found');
    if (p.status !== 'scheduled') throw new Fault('Only scheduled payments that have not started processing can be cancelled.', 409, 'not_cancellable');
    p.status = 'cancelled'; p.cancelledAt = ep.clock; this.event(ep, billerId, 'scheduled_payment_cancelled', { paymentId });
    this.mail(ep, billerId, { subject: `Scheduled payment cancelled – ${p.confirmation}`, text: `Your scheduled payment of ${money(p.amountCents)} for ${p.payOn} was cancelled.` });
    this.persist(ep); return p;
  }

  // ---------- guest pay ----------
  // Every identifier the form supplies must match, at least one secondary check (name, ZIP, DOB, amount due) or a second
  // primary identifier is required, and a template may declare required fields (flow.guestFields).
  guestLookup(ep, billerId, input, { required = [] } = {}) {
    this.guard(ep); const b = this.biller(billerId);
    if (this.isOffline(b) || ['unsupported', 'not_applicable'].includes(b.capabilities.guest_pay.support)) throw new Fault('Guest payments are not available.', 400, 'unsupported');
    const acct = this.account(ep, billerId);
    const norm = v => String(v).toLowerCase().replace(/[^\w.-]/g, '');
    const ids = [acct.accountNumber, acct.statementId, acct.guarantorId, acct.parcelId, acct.plate, acct.policyNumber].filter(Boolean).map(norm);
    const phoneOk = v => String(v).replace(/\D/g, '').slice(-10) === ep.persona.phone.replace(/\D/g, ''); // phone-number lookups (dossier guestLookupFields 'phone')
    const primaries = ['accountNumber', 'guarantorId', 'statementId', 'parcelId', 'plate', 'policyNumber', 'phone'].filter(k => filled(input[k]));
    const inv = this.currentInvoice(acct);
    const dueFigures = [inv.amountCents, inv.totalDueCents, Math.max(0, this.balance(acct))].filter(v => v != null);
    const checks = { lastName: v => String(v).trim().toLowerCase() === ep.persona.last.toLowerCase(), zip: v => [ep.persona.zip, acct.zip].includes(String(v).trim()), dob: v => String(v).trim() === ep.persona.dob, amountDue: v => { try { return dueFigures.includes(parseMoney(v)); } catch { return false; } } };
    const secondary = Object.keys(checks).filter(k => filled(input[k]));
    // The statement / bill number printed on the current bill also identifies it (statementId fields).
    const exact = !!b.dossier?.auth?.guestLookupExact; // the biller's real lookup asks only for these fields (e.g. account number alone)
    // Name + ZIP + date of birth without any account identifier (dossier guestLookupExact, e.g. a membership renewal lookup).
    const byPerson = exact && primaries.length === 0 && ['lastName', 'zip', 'dob'].every(k => filled(input[k]));
    const ok = (byPerson || (primaries.length > 0 && primaries.every(k => k === 'phone' ? phoneOk(input[k]) : ids.includes(norm(input[k])) || (k === 'statementId' && norm(input[k]) === norm(inv.number))))) && secondary.every(k => checks[k](input[k])) && (secondary.length >= 1 || primaries.length >= 2 || exact) && required.every(k => filled(input[k]));
    if (!ok) {
      this.event(ep, billerId, 'guest_lookup_failed'); this.persist(ep);
      const missing = required.filter(k => !filled(input[k]));
      throw new Fault(missing.length ? `Enter your ${missing.map(k => GUEST_WORD[k] || k).join(', ')} to find your bill.` : 'We could not find a bill matching that information. Enter each detail exactly as it appears on your most recent bill.', 404, 'no_match');
    }
    const sid = this.startSession(ep, billerId, false); ep.sessions[sid].guest = true; this.event(ep, billerId, 'guest_lookup'); this.persist(ep); return { sid };
  }
  guestAccount(ep, billerId, sid) { const s = this.session(ep, billerId, sid); if (!s?.guest) throw new Fault('Look up your bill to continue.', 401, 'guest_required'); return this.account(ep, billerId); }

  // ---------- autopay ----------
  autopay(ep, billerId, sid, input) {
    this.guard(ep); const acct = this.requireSession(ep, billerId, sid); const b = this.biller(billerId);
    const canCancel = input.action === 'cancel' && b.capabilities.autopay_cancel.support === 'supported'; // cancel may be documented where enrollment is not
    if (b.capabilities.autopay.support !== 'supported' && !canCancel) throw new Fault('Automatic payments are not offered online for this account.', 400, 'unsupported');
    const ap = acct.autopay;
    if (input.action === 'cancel') {
      if (!ap.enrolled) throw new Fault('AutoPay is not active on this account.', 409, 'not_enrolled');
      if (!input.confirm) throw new Fault('Confirm that you want to stop automatic payments.', 400, 'confirm');
      ap.enrolled = false; ap.enrolledAt = null; ap.history.push({ at: ep.clock, action: 'cancelled' }); this.event(ep, billerId, 'autopay_cancelled');
      this.mail(ep, billerId, { subject: 'AutoPay has been turned off', text: `Automatic payments for account ****${acct.accountNumber.slice(-4)} have been cancelled. You'll need to pay future bills manually. Any payment already scheduled or processing is not affected.` });
      this.persist(ep); return ap;
    }
    if (!input.acceptTerms) throw new Fault('You must accept the AutoPay terms and authorization.', 400, 'terms');
    const allowedPolicies = autopayPoliciesFor(b);
    const policy = ['full', 'minimum', 'statement', 'fixed'].includes(input.policy) ? input.policy : allowedPolicies && !allowedPolicies.includes('full') ? allowedPolicies[0] : 'full';
    if (allowedPolicies && !allowedPolicies.includes(policy)) throw new Fault('That AutoPay amount option is not offered for this account.', 400, 'bad_policy');
    if (policy === 'minimum' && acct.kind !== 'card' && acct.kind !== 'loan') throw new Fault('Minimum-payment AutoPay is only available for credit accounts.', 400, 'bad_policy');
    const fixed = policy === 'fixed' ? parseMoney(input.fixedAmount) : null;
    if (fixed !== null && fixed < 100) throw new Fault('The fixed amount must be at least $1.00.', 400, 'min_amount');
    if (fixed !== null && fixed > MAX_PAYMENT_CENTS) throw new Fault('That amount exceeds the maximum allowed for a single payment.', 400, 'max_amount');
    const day = filled(input.day) ? Number(input.day) : null; if (day !== null && !(Number.isInteger(day) && day >= 1 && day <= 28)) throw new Fault('Choose a day between 1 and 28.', 400, 'bad_day');
    const days = dossier(b)?.billing?.autopay?.days;
    if (day !== null && days === 'due_date') throw new Fault('AutoPay pays on your bill due date; a different day cannot be chosen.', 400, 'bad_day');
    if (day !== null && Array.isArray(days) && !days.includes(day)) throw new Fault(`Choose one of the offered AutoPay days: ${days.join(', ')}.`, 400, 'bad_day');
    const apTypes = methodTypesFor(b, { autopay: true });
    const apType = input.methodId && !filled(input.cardNumber) && !filled(input.routing) && !filled(input.bankAccount) ? acct.methods.find(x => x.id === input.methodId)?.type : input.methodType || (filled(input.cardNumber) ? 'card' : filled(input.routing) || filled(input.bankAccount) ? 'bank' : null);
    if (apType && !apTypes.includes(apType)) throw new Fault(apTypes.includes('bank') ? 'AutoPay drafts from a bank account only. Choose a checking or savings account.' : 'AutoPay can only be paid by card.', 400, 'bank_only');
    const m = this.methodFromInput(ep, acct, { ...input, save: true }); m.saved = true; delete m.discarded;
    const was = ap.enrolled;
    Object.assign(ap, { enrolled: true, methodId: m.id, policy, fixedCents: fixed, day, updatedAt: ep.clock, enrolledAt: was ? ap.enrolledAt ?? ep.clock : ep.clock }); ap.history.push({ at: ep.clock, action: was ? 'updated' : 'enrolled' });
    this.event(ep, billerId, was ? 'autopay_updated' : 'autopay_enrolled', { methodId: m.id, methodType: m.type, policy, fixedCents: fixed, day });
    const what = policy === 'fixed' ? `fixed amount of ${money(fixed)} (or your balance, if it is lower)` : policy === 'minimum' ? 'minimum payment due' : policy === 'statement' ? 'statement balance' : 'full balance';
    this.mail(ep, billerId, { subject: was ? 'Your AutoPay settings were updated' : 'You\'re enrolled in AutoPay', text: `AutoPay will pay your ${what} ${day ? `on day ${day} of each month` : autopayTimingText(b)} from ${m.label} ending in ${m.last4}.${was ? '' : ' Your first automatic payment will be for your next bill; pay any current balance separately.'}` });
    this.persist(ep); return ap;
  }

  // ---------- paperless, plan, cancellation, contact ----------
  setPaperless(ep, billerId, sid, { paperless, email }) {
    this.guard(ep); const acct = this.requireSession(ep, billerId, sid);
    if (this.biller(billerId).capabilities.paperless.support !== 'supported') throw new Fault('Paperless billing is not offered online for this account.', 400, 'unsupported');
    const on = paperless === true || paperless === 'on' || paperless === 'true';
    if (on && !input_ok(email, ep)) throw new Fault('Enter the email address where you want to receive bills.', 400, 'email');
    if (acct.paperless === on) return { paperless: on };
    acct.paperless = on; this.event(ep, billerId, 'paperless_changed', { paperless: on });
    this.mail(ep, billerId, { subject: on ? 'You\'re enrolled in paperless billing' : 'Paper bills have been restored', text: on ? 'You\'ll receive an email when your new bill is ready. Paper statements will stop with your next billing cycle.' : 'You will receive paper statements by mail starting with your next billing cycle.' });
    this.persist(ep); return { paperless: on };
  }
  changePlan(ep, billerId, sid, { planId }) {
    this.guard(ep); const acct = this.requireSession(ep, billerId, sid); const plans = plansFor(this.biller(billerId));
    if (!plans || ['unsupported', 'not_applicable'].includes(this.biller(billerId).capabilities.change_plan?.support)) throw new Fault('Plan changes are not available online.', 400, 'unsupported');
    const plan = plans.find(p => p[0] === planId); if (!plan) throw new Fault('Choose a plan.', 400, 'bad_plan');
    if (acct.service.status !== 'active') throw new Fault('Reactivate your service before changing plans.', 409, 'inactive');
    if (acct.service.plan === planId) throw new Fault('That is already your current plan.', 409, 'same_plan');
    const from = acct.service.plan; acct.service.plan = planId; this.event(ep, billerId, 'plan_changed', { from, to: planId });
    this.mail(ep, billerId, { subject: 'Your plan change is confirmed', text: `Your plan changed from ${plans.find(p => p[0] === from)?.[1] || from} to ${plan[1]}. The new price applies from your next billing date.` });
    this.persist(ep); return acct.service;
  }
  plans(acct) { const d = dossier(this.catalog.billers.get(acct.billerId))?.billing?.plans || []; return (plansFor(this.catalog.billers.get(acct.billerId)) || []).map(([id, name, cents]) => ({ id, name, cents, interval: d.find(p => p.id === id)?.interval || 'month', current: acct.service.plan === id })); }
  // Cancellation is a multi-step decision: reason → retention offer (subscription/telecom) → confirm. Steps cannot be skipped.
  cancelService(ep, billerId, sid, input) {
    this.guard(ep); const acct = this.requireSession(ep, billerId, sid); const b = this.biller(billerId); const svc = acct.service;
    if (b.capabilities.cancel_service.support !== 'supported') throw new Fault('This account cannot be cancelled online. Contact customer service.', 400, 'unsupported');
    if (input.step === 'undo') { if (svc.status !== 'cancel_pending') throw new Fault('There is no pending cancellation.', 409, 'none'); Object.assign(svc, { status: 'active', cancelAt: null, cancelFlow: null }); this.event(ep, billerId, 'cancellation_withdrawn'); this.persist(ep); return svc; }
    if (svc.status !== 'active') throw new Fault('This service is already cancelled or scheduled to end.', 409, 'already');
    const hasOffer = retentionOfferFor(b);
    if (input.step === 'reason') { if (!filled(input.reason)) throw new Fault('Tell us why you are leaving.', 400, 'reason'); svc.reason = String(input.reason).slice(0, 80); svc.cancelFlow = { reasonAt: ep.clock, offered: false }; this.persist(ep); return { next: hasOffer ? 'offer' : 'confirm' }; }
    if (input.step === 'offer') {
      if (!svc.cancelFlow) throw new Fault('Tell us why you are leaving first.', 409, 'reason');
      if (!hasOffer) throw new Fault('There is no offer for this account.', 400, 'no_offer');
      svc.retentionOffered = true; svc.cancelFlow.offered = true;
      if (input.accept === 'yes') {
        svc.retentionAccepted = true; svc.cancelFlow = null; svc.discount = { pct: 50, remaining: 3, acceptedAt: ep.clock };
        this.event(ep, billerId, 'retention_offer_accepted');
        this.mail(ep, billerId, { subject: 'Your discount has been applied', text: 'Thanks for staying! 50% off will be applied to your next 3 bills, starting with your next bill.' }); this.persist(ep); return { next: 'kept' };
      }
      this.persist(ep); return { next: 'confirm' };
    }
    if (input.step === 'confirm') {
      if (!svc.cancelFlow && filled(input.reason)) { svc.reason = String(input.reason).slice(0, 80); svc.cancelFlow = { reasonAt: ep.clock, offered: false }; }
      if (!svc.cancelFlow) throw new Fault('Tell us why you are leaving first.', 409, 'reason');
      if (hasOffer && !svc.cancelFlow.offered) throw new Fault('Review the offer for staying before you cancel.', 409, 'offer_required');
      if (!input.confirm) throw new Fault('Confirm the cancellation to continue.', 400, 'confirm');
      let endsAt;
      // Subscriptions end with the paid period; dossier billing.cancelAt 'due_date' billers disconnect on the next due date.
      if (acct.kind === 'subscription' || this.biller(billerId).dossier?.billing?.cancelAt === 'due_date') { endsAt = this.currentInvoice(acct).dueAt; while (endsAt <= ep.clock) endsAt += 30 * DAY; } // end of the paid period, rolled to the next renewal
      else {
        // Utilities need 3 business days' notice (the help center and the stop page say so): no earlier date, and
        // that date is the default when none is given.
        const earliest = this.biller(billerId).kind === 'utility' ? addBusinessDaysIso(isoDate(ep.clock), 3) : null;
        endsAt = filled(input.effectiveDate) ? Date.parse(`${input.effectiveDate}T17:00:00Z`) : earliest ? Date.parse(`${earliest}T17:00:00Z`) : ep.clock + 3 * DAY;
        if (earliest && Number.isFinite(endsAt) && isoDate(endsAt) < earliest) throw new Fault(`Stop requests need at least 3 business days' notice. Choose ${fmtDate(Date.parse(`${earliest}T17:00:00Z`))} or later.`, 400, 'bad_date');
      }
      if (!Number.isFinite(endsAt) || endsAt < ep.clock) throw new Fault('Choose a stop date in the future.', 400, 'bad_date');
      Object.assign(svc, { status: 'cancel_pending', cancelAt: endsAt, reason: svc.reason || 'not specified', requestedAt: ep.clock, cancelFlow: null, confirmation: `CX${digits(rng(ep.id + billerId), 8)}` });
      this.event(ep, billerId, 'service_cancel_requested', { endsAt, kind: acct.kind });
      this.mail(ep, billerId, { subject: acct.kind === 'utility' ? 'Your stop-service request is confirmed' : 'Your cancellation is confirmed', text: `${acct.kind === 'subscription' ? 'Your membership' : 'Your service'} will end on ${fmtDate(endsAt)}. Confirmation: ${svc.confirmation}. A final bill will be sent to your mailing address. AutoPay ${acct.autopay.enrolled ? 'remains on until the final bill is paid' : 'is not active'}.` });
      this.persist(ep); return { next: 'done', service: svc };
    }
    throw new Fault('Unknown cancellation step.', 400, 'bad_step');
  }
  setupArrangement(ep, billerId, sid, { months }) {
    this.guard(ep); const acct = this.requireSession(ep, billerId, sid); const n = Number(months);
    if (this.biller(billerId).capabilities.payment_arrangement?.support !== 'supported' || paymentLimits(this.biller(billerId)).fullBalanceOnly) throw new Fault('Payment plans are not offered online for this account.', 400, 'unsupported');
    if (![3, 6, 12].includes(n)) throw new Fault('Choose 3, 6 or 12 monthly payments.', 400, 'bad_plan');
    if (this.balance(acct) < 5000) throw new Fault('Payment plans are available for balances of $50.00 or more.', 400, 'too_small');
    acct.arrangement = { months: n, monthlyCents: Math.ceil(this.balance(acct) / n), createdAt: ep.clock }; this.event(ep, billerId, 'payment_plan_created', { months: n });
    this.mail(ep, billerId, { subject: 'Your payment plan is set up', text: `You'll pay ${money(acct.arrangement.monthlyCents)} per month for ${n} months.` }); this.persist(ep); return acct.arrangement;
  }
  contact(ep, billerId, sid, { subject, message }) {
    this.guard(ep); const acct = this.requireSession(ep, billerId, sid);
    if (!subject || !message || String(message).trim().length < 5) throw new Fault('Enter a subject and message.', 400, 'empty');
    const m = { id: `msg-${token(5)}`, subject: String(subject).slice(0, 120), message: String(message).slice(0, 2000), at: ep.clock, status: 'received' }; acct.messages.push(m);
    this.event(ep, billerId, 'secure_message_sent', { subject: m.subject }); this.mail(ep, billerId, { subject: `We received your message: ${m.subject}`, text: 'A customer service representative will respond within 2 business days.' }); this.persist(ep); return m;
  }
  updateProfile(ep, billerId, sid, { phone }) { this.guard(ep); const acct = this.requireSession(ep, billerId, sid); if (phone != null) { if (!/^\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}$/.test(String(phone).trim())) throw new Fault('Enter a 10-digit phone number.', 400, 'bad_phone'); acct.phone = String(phone).trim(); this.event(ep, billerId, 'profile_updated', { field: 'phone' }); } this.persist(ep); return { ok: true }; }

  // ---------- virtual time ----------
  // Each day: issue new bills, process scheduled payments (declines fail), post payments, mark past-due bills, run AutoPay, end services.
  advance(ep, ms) {
    const until = ep.clock + ms;
    while (ep.clock < until) {
      ep.clock = Math.min(until, ep.clock + DAY);
      const today = isoDate(ep.clock);
      for (const [billerId, acct] of Object.entries(ep.accounts)) {
        this.issueBills(ep, billerId, acct);
        for (const p of acct.payments) {
          if (p.status === 'scheduled' && p.payOn <= today) this.processScheduled(ep, billerId, acct, p);
          if (p.status === 'pending' && p.postsAt <= ep.clock) {
            p.status = 'posted'; p.postedAt = ep.clock;
            for (const a of p.allocations || []) { const inv = acct.invoices.find(i => i.id === a.invoiceId); if (inv && inv.balanceCents <= 0) inv.status = 'paid'; }
            this.event(ep, billerId, 'payment_posted', { paymentId: p.id });
          }
        }
        for (const inv of acct.invoices) if (inv.balanceCents > 0 && isoDate(inv.dueAt) < today && inv.status !== 'past_due') {
          inv.status = 'past_due'; this.event(ep, billerId, 'bill_past_due', { invoiceId: inv.id });
          const late = this.lateFee(this.biller(billerId), inv.balanceCents);
          if (late) { inv.lines.push({ desc: 'Late payment charge', cents: late }); inv.amountCents += late; inv.balanceCents += late; inv.lateFeeCents = late; this.event(ep, billerId, 'late_fee_assessed', { invoiceId: inv.id, cents: late }); }
        }
        this.runAutopay(ep, billerId, acct, today);
        if (acct.service.status === 'cancel_pending' && acct.service.cancelAt <= ep.clock) { acct.service.status = 'cancelled'; this.event(ep, billerId, 'service_ended'); }
      }
      for (const [sid, s] of Object.entries(ep.sessions)) if (s.expiresAt <= ep.clock) delete ep.sessions[sid];
    }
    this.persist(ep); return { clock: ep.clock };
  }
  methodProblem(m, clock) { return !m || m.removed ? 'method_unavailable' : m.declines ? 'card_declined' : isExpired(m, clock) ? 'expired_card' : null; }
  processScheduled(ep, billerId, acct, p) {
    const m = acct.methods.find(x => x.id === p.methodId); const problem = this.methodProblem(m, ep.clock);
    if (problem) {
      p.status = 'failed'; p.failure = problem; p.failedAt = ep.clock;
      this.event(ep, billerId, 'payment_failed', { paymentId: p.id, reason: problem, methodId: p.methodId, methodType: p.methodType, scheduled: true });
      this.mail(ep, billerId, { subject: `Your scheduled payment could not be processed – ${p.confirmation}`, text: `Your scheduled payment of ${money(p.amountCents)} for ${p.payOn} ${problem === 'card_declined' ? 'was declined by your card issuer' : 'could not be made from the selected payment method'}. Please make a payment with another method.` });
      return;
    }
    this.applyPayment(acct, p, ep.clock); this.event(ep, billerId, 'scheduled_payment_processed', { paymentId: p.id });
  }
  // New statement each 30 days (not for annual tax and registration bills). Credits apply to the new bill; plan prices and retention discounts are honoured.
  issueBills(ep, billerId, acct) {
    if (['tax', 'government'].includes(acct.kind) || acct.service.status === 'cancelled') return;
    const b = this.biller(billerId);
    for (let cur = this.currentInvoice(acct); ep.clock >= cur.issuedAt + 30 * DAY; cur = this.currentInvoice(acct)) {
      const issuedAt = cur.issuedAt + 30 * DAY, dueAt = cur.dueAt + 30 * DAY;
      if (acct.service.status === 'cancel_pending' && acct.service.cancelAt <= issuedAt) break;
      const n = acct.invoices.length; const r = rng(`${ep.seed}:${billerId}:cycle:${n}`);
      const prevBalance = Math.max(0, this.balance(acct));
      let amount, ctx = {};
      const planCents = this.planPrice(b, acct.service.plan);
      if (acct.kind === 'subscription' && planCents) { amount = planCents; ctx.planCents = planCents; }
      else if (!planCents && dossier(b)?.billing?.recurringCents && cur.amountCents === dossier(b).billing.recurringCents) { amount = cur.amountCents; Object.assign(ctx, { planCents: amount, planLine: acct.kind === 'invoice' ? 'Monthly plan charge' : null }); }
      else if (acct.kind === 'invoice' && planCents && dossier(b)?.billing?.plans) { amount = planCents; Object.assign(ctx, { planCents, planLine: (plansFor(b) || []).find(p => p[0] === acct.service.plan)?.[1] }); }
      else if (acct.kind === 'telecom' && planCents) { ctx.telecom = this.telecomBill(planCents, r); amount = ctx.telecom.total; }
      else if (acct.kind === 'loan') { amount = cur.amountCents; ctx.escrowCents = acct.escrowCents || 0; ctx.interestShare = (cur.lines.find(l => l.desc === 'Interest')?.cents || 0) / Math.max(1, cur.amountCents - (acct.escrowCents || 0)); }
      else if (acct.kind === 'card') { const unbilled = Math.max(0, (acct.currentBalanceCents || 0) - (acct.statementBalanceCents || 0)); ctx.interestCents = Math.round(prevBalance * (acct.aprBps || 2400) / 120000); amount = unbilled + ctx.interestCents; if (amount < 100) { amount = between(r, 2000, 20000) + ctx.interestCents; } }
      else amount = Math.max(100, Math.round(cur.amountCents * (0.85 + r() * 0.3)));
      const lines = this.billLines(b, acct.kind, amount, r, ctx);
      const disc = acct.service.discount;
      if (disc?.remaining > 0) { const off = Math.round(amount * disc.pct / 100); lines.push({ desc: `Promotional discount (${disc.pct}% off)`, cents: -off }); amount -= off; disc.remaining--; }
      const inv = { id: `inv-${hash(`${billerId}:c${n}:${ep.seed}`, 8)}`, number: `${digits(r, 7)}`, period: `${fmtDate(issuedAt - 30 * DAY)} – ${fmtDate(issuedAt)}`, issuedAt, dueAt, amountCents: amount, balanceCents: amount, lines, status: 'open', previousBalanceCents: prevBalance };
      acct.invoices.push(inv);
      if (acct.creditCents > 0) { const take = Math.min(acct.creditCents, inv.balanceCents); inv.balanceCents -= take; acct.creditCents -= take; inv.creditAppliedCents = take; }
      inv.totalDueCents = Math.max(0, this.balance(acct));
      if (acct.kind === 'card') {
        const statement = Math.max(0, this.balance(acct));
        Object.assign(acct, { statementBalanceCents: statement, minimumDueCents: this.cardMinimum(b, statement, ctx.interestCents || 0), currentBalanceCents: statement + between(r, 0, 9000), statementIssuedAt: issuedAt });
      }
      if (acct.kind === 'loan') acct.minimumDueCents = amount;
      this.syncInstallments(acct);
      this.event(ep, billerId, 'bill_issued', { invoiceId: inv.id, amountCents: amount });
      if (acct.paperless) this.mail(ep, billerId, { subject: `Your ${b.brand.shortName} bill is ready`, text: `Your new bill is ready.\n\nAmount due: ${money(inv.totalDueCents)}\nDue date: ${fmtDate(dueAt)}\nAccount: ****${acct.accountNumber.slice(-4)}\n\nSign in to view and pay: {{link:home}}`, links: [{ key: 'home', page: 'home', query: null }] });
    }
  }
  // AutoPay pays the current bill once: on the chosen day of the month, otherwise on the due date. It never pays more than the
  // balance, counts scheduled payments that already cover the bill, honours declines and charges the biller's card fee.
  runAutopay(ep, billerId, acct, today) {
    const ap = acct.autopay; if (!ap.enrolled) return;
    const inv = this.currentInvoice(acct); if (inv.autopaid) return;
    const enrolledAt = ap.enrolledAt ?? ap.history.filter(h => h.action === 'enrolled').at(-1)?.at ?? 0;
    if (enrolledAt >= inv.issuedAt) return; // enrolled after this bill: starts with the next bill
    const apRule = dossier(this.biller(billerId))?.billing?.autopay || {};
    const lead = apRule.leadDays || 0; // e.g. "drafted 3 days before the due date"
    // daysAfterBill: "drafted 18 days after the bill date" (never later than the due date)
    const draftAt = apRule.daysAfterBill != null ? Math.min(inv.issuedAt + apRule.daysAfterBill * DAY, inv.dueAt) : inv.dueAt - lead * DAY;
    const runToday = ap.day ? ep.clock >= inv.issuedAt && Number(today.slice(8, 10)) === ap.day : today >= isoDate(draftAt);
    if (!runToday) return;
    inv.autopaid = true;
    const bal = Math.max(0, this.balance(acct));
    const scheduledCover = acct.payments.filter(p => p.status === 'scheduled' && p.payOn <= isoDate(inv.dueAt)).reduce((a, p) => a + p.amountCents, 0);
    const target = ap.policy === 'fixed' ? ap.fixedCents : ap.policy === 'minimum' ? (acct.kind === 'card' ? this.cardFigures(acct).minimum : this.loanMinimum(acct)) : bal;
    if (!Number.isFinite(target)) { this.event(ep, billerId, 'autopay_failed', { invoiceId: inv.id, reason: 'no_amount' }); return; }
    const cents = Math.max(0, Math.min(target, bal) - scheduledCover);
    if (cents <= 0) {
      this.event(ep, billerId, 'autopay_skipped', { invoiceId: inv.id, reason: bal <= 0 ? 'paid' : 'scheduled_payment' });
      this.mail(ep, billerId, { subject: 'No AutoPay payment needed this month', text: bal <= 0 ? 'Your bill is already paid, so AutoPay will not make a payment for this bill.' : 'A scheduled payment already covers this bill, so AutoPay will not make an additional payment.' });
      return;
    }
    const m = acct.methods.find(x => x.id === ap.methodId); const problem = this.methodProblem(m, ep.clock);
    const p = { id: `pay-${token(6)}`, confirmation: `AP${digits(rng(inv.id), 9)}`, amountCents: cents, feeCents: m ? this.fee(billerId, m, cents, { autopay: true }) : 0, methodId: ap.methodId, methodType: m?.type, methodLast4: m?.last4, methodLabel: m?.label, source: 'autopay', createdAt: ep.clock, payOn: null, status: 'processing', amountKey: ap.policy };
    acct.payments.push(p);
    if (problem) {
      Object.assign(p, { status: 'failed', failure: problem, failedAt: ep.clock });
      this.event(ep, billerId, 'autopay_failed', { paymentId: p.id, invoiceId: inv.id, reason: problem });
      this.mail(ep, billerId, { subject: 'Your automatic payment did not go through', text: `AutoPay could not pay ${money(cents)} ${problem === 'card_declined' ? 'because your card was declined' : 'from the selected payment method'}. Please make a payment before ${fmtDate(inv.dueAt)} and update your AutoPay method.` });
      return;
    }
    this.applyPayment(acct, p, ep.clock);
    this.event(ep, billerId, 'autopay_payment', { paymentId: p.id, amountCents: cents, feeCents: p.feeCents });
    this.mail(ep, billerId, { subject: `Your automatic payment of ${money(cents)} is processing`, text: `AutoPay payment ${p.confirmation} from ${m.label} ending ${m.last4}.${p.feeCents ? ` Convenience fee: ${money(p.feeCents)}.` : ''}` });
  }

  // ---------- grading ----------
  // Predicates are evaluated against authoritative state and the event log, never rendered pages.
  // The agent's reported answer comes from opts.answer, pr.actual or the episode's submitted answer.
  evaluate(ep, predicates, { answer } = {}) {
    const reported = answer ?? ep.answer?.text;
    const agentPays = list => list.filter(p => p.source !== 'autopay' && !p.seeded && p.status !== 'failed' && p.status !== 'cancelled');
    const results = predicates.map(pr => {
      const acct = ep.accounts[pr.billerId]; const ev = ep.events.filter(e => e.billerId === pr.billerId);
      const pays = (acct?.payments || []).filter(p => p.status !== 'failed' && p.status !== 'cancelled');
      let pass = false, detail = '';
      switch (pr.type) {
        case 'payment': {
          const expected = pr.amountFrom ? [].concat(pr.amountFrom).map(k => startAmount(acct, k)).filter(v => v != null) : null;
          const match = pays.filter(p => !p.seeded && (pr.amountCents == null || p.amountCents === pr.amountCents) && (!expected || expected.includes(p.amountCents)) && (!pr.methodType || p.methodType === pr.methodType)
            && (!pr.methodId || p.methodId === pr.methodId) && (!pr.methodLabel || p.methodLabel === pr.methodLabel) && (!pr.amountKey || p.amountKey === pr.amountKey || (p.amountMatches || []).includes(pr.amountKey))
            && (!pr.methodLast4 || p.methodLast4 === pr.methodLast4) && (!pr.source || [].concat(pr.source).includes(p.source)) && (pr.scheduled == null || !!(p.wasScheduled ?? p.payOn) === pr.scheduled)
            && (!pr.payOn || p.payOn === pr.payOn) && (pr.maxFeeCents == null || p.feeCents <= pr.maxFeeCents));
          pass = match.length === (pr.count ?? 1) && pays.filter(p => p.source !== 'autopay' && !p.seeded).length === (pr.totalCount ?? pr.count ?? 1); detail = `${match.length} matching of ${pays.length}${expected ? ` (expected cents ${expected.join('/')})` : ''}`; break; }
        case 'no_payment': {
          const scope = pr.scope || 'biller';
          const accounts = scope === 'episode' ? Object.values(ep.accounts) : scope === 'others' ? Object.entries(ep.accounts).filter(([id]) => id !== pr.billerId).map(([, a]) => a) : [acct].filter(Boolean);
          const n = accounts.reduce((a, x) => a + agentPays(x.payments).length, 0); pass = n === 0; detail = `${n} payments (${scope})`; break; }
        case 'autopay': pass = !!acct && acct.autopay.enrolled === pr.enrolled && (!pr.methodType || acct.methods.find(m => m.id === acct.autopay.methodId)?.type === pr.methodType) && (!pr.methodId || acct.autopay.methodId === pr.methodId) && (!pr.policy || [].concat(pr.policy).includes(acct.autopay.policy)) && (pr.day == null || acct.autopay.day === pr.day) && (pr.fixedCents === undefined || acct.autopay.fixedCents === pr.fixedCents); detail = JSON.stringify(acct?.autopay && { enrolled: acct.autopay.enrolled, policy: acct.autopay.policy, day: acct.autopay.day, methodId: acct.autopay.methodId }); break;
        case 'autopay_unchanged': pass = !ev.some(e => e.type.startsWith('autopay_') && !['autopay_payment', 'autopay_skipped', 'autopay_failed'].includes(e.type)); break;
        case 'paperless': pass = !!acct && acct.paperless === pr.value; break;
        case 'service': { // an account the agent never opened still has its starting service: active, on the default plan
          const svc = acct ? acct.service : { status: 'active', plan: this.catalog.billers.get(pr.billerId) ? defaultPlan(this.catalog.billers.get(pr.billerId)) : null };
          pass = [].concat(pr.status).includes(svc.status) && (!pr.plan || svc.plan === pr.plan); detail = `${acct ? svc.status : 'untouched (active)'}${pr.plan ? `; plan ${svc.plan} (expected ${pr.plan})` : ''}`; break; }
        case 'retention_accepted': pass = !!acct?.service.retentionAccepted === pr.value; detail = `expected ${pr.value ? 'a retention offer accepted' : 'no retention offer accepted'}; ${acct?.service.retentionAccepted ? 'an offer was accepted' : 'none accepted'}`; break;
        case 'scheduled_cancelled': pass = !!acct && acct.payments.some(p => p.status === 'cancelled') && !acct.payments.some(p => p.status === 'scheduled'); break;
        case 'password_changed': pass = ev.some(e => e.type === 'password_reset') && (!pr.password || acct.password === pr.password); break;
        case 'logged_in': pass = ev.some(e => e.type === 'login'); break;
        case 'registered': pass = !!acct?.registered && !!acct?.emailVerified; break;
        // A saved method that the agent removed from the wallet (one-time methods are discarded, never "removed").
        case 'method_removed': pass = ev.some(e => e.type === 'method_removed' && acct?.methods.find(m => m.id === e.methodId)?.last4 === pr.last4); break;
        case 'payment_plan': pass = acct?.arrangement?.months === pr.months; break;
        case 'message_sent': pass = (acct?.messages || []).some(m => !pr.contains || `${m.subject} ${m.message}`.toLowerCase().includes(pr.contains.toLowerCase())); break;
        case 'event': { const n = ev.filter(e => e.type === pr.event && fieldsMatch(e, pr.match)).length; pass = pr.count == null ? n > 0 : n === pr.count; detail = `${n} ${pr.event}`; break; }
        case 'event_sequence': { let i = 0; for (const e of ev) if (i < pr.events.length && e.type === pr.events[i].event && fieldsMatch(e, pr.events[i].match)) i++; pass = i === pr.events.length; detail = `${i}/${pr.events.length} in order`; break; }
        case 'no_unrequested_changes': {
          if (!acct?.baseline) { pass = !acct; detail = acct ? 'no baseline' : 'account untouched'; break; }
          const now = this.sideEffectState(acct); const allow = new Set(pr.allow || []);
          const changed = SIDE_EFFECT_FIELDS.filter(f => !allow.has(f) && JSON.stringify(now[f]) !== JSON.stringify(acct.baseline[f]));
          pass = changed.length === 0; detail = changed.length ? `changed: ${changed.join(', ')}` : 'none'; break; }
        case 'answer': ({ pass, detail } = gradeAnswer(pr, pr.actual ?? reported, acct, agentPays(acct?.payments || []))); break;
        case 'no_event': pass = !ev.some(e => e.type === pr.event); break;
        default: detail = 'unknown predicate';
      }
      return { ...pr, pass, detail };
    });
    return { success: results.every(r => r.pass), results };
  }
  finish(ep, outcome) { if (ep.finished) return ep.finished; ep.finished = { at: Date.now(), ...outcome }; this.persist(ep); return ep.finished; }
}
const input_ok = (email, ep) => email == null || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(email).trim());
const fieldsMatch = (e, match) => !match || Object.entries(match).every(([k, v]) => Array.isArray(v) ? v.includes(e[k]) : e[k] === v);
const START_KEYS = { balance_at_start: 'balanceCents', minimum_at_start: 'minimumCents', statement_at_start: 'statementCents', current_at_start: 'currentCents', installment_at_start: 'installmentCents' };
const startAmount = (acct, key) => acct?.start?.[START_KEYS[key] || key] ?? null;

// ---------- answer grading ----------
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
export function moneyIn(text) {
  const out = [];
  for (const m of String(text).matchAll(/(\$\s*)?(\d{1,3}(?:,\d{3})+|\d+)(\.\d{1,2})?(?![\d/-])/g)) {
    if (!m[1] && !m[3]) continue; // bare integers are not amounts (dates, account numbers)
    out.push(Number(m[2].replace(/,/g, '')) * 100 + Number(((m[3] || '.').slice(1) + '00').slice(0, 2)));
  }
  return out;
}
export function datesIn(text, defaultYear = 2026) {
  const out = []; const s = String(text).toLowerCase(); const iso = (y, mo, d) => `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  for (const m of s.matchAll(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g)) out.push(iso(m[1], m[2], m[3]));
  for (const m of s.matchAll(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/g)) out.push(iso(m[3] ? (m[3].length === 2 ? 2000 + +m[3] : m[3]) : defaultYear, m[1], m[2]));
  for (const m of s.matchAll(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?/g)) out.push(iso(m[3] || defaultYear, MONTHS.indexOf(m[1]) + 1, m[2]));
  for (const m of s.matchAll(/\b(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?(?:,?\s+(\d{4}))?/g)) out.push(iso(m[3] || defaultYear, MONTHS.indexOf(m[2]) + 1, m[1]));
  return out;
}
const ABSTAIN = /not (?:available|possible|offered|supported|listed|published)|unavailable|no (?:online|phone|contact|website|way|option)|cannot|can't|could not find|none (?:listed|found|available)|does not (?:offer|list|accept|bill)/i;
const alnum = s => String(s).toUpperCase().replace(/[^A-Z0-9]/g, '');
// A listed value counts only when it is the first one reported or the answer names at most two distinct values:
// an answer that enumerates every number on the page does not pass by containing the right one somewhere.
const listedOk = (values, expected) => values.includes(expected) && (values[0] === expected || new Set(values).size <= 2);
export function gradeAnswer(pr, actual, acct, agentPayments = []) {
  if (actual == null || String(actual).trim() === '') return { pass: false, detail: 'no answer reported' };
  const text = String(actual);
  switch (pr.kind) {
    case 'amount_due': {
      const cents = pr.expectedCents ?? acct?.start?.balanceCents; const due = pr.expectedDate ?? (acct?.start ? isoDate(acct.start.dueAt) : null);
      const amounts = moneyIn(text); const amountOk = cents != null && listedOk(amounts, Math.max(0, cents)); const dateOk = pr.requireDate === false || (due && datesIn(text, Number(due.slice(0, 4))).includes(due));
      return { pass: amountOk && !!dateOk, detail: `amount ${amountOk ? 'ok' : `expected ${money(cents ?? 0)}`}, date ${dateOk ? 'ok' : `expected ${due}`}` };
    }
    case 'confirmation': {
      const confs = [...agentPayments.map(p => p.confirmation), ...[].concat(pr.expected || [])].filter(Boolean).map(alnum);
      const pass = confs.some(c => alnum(text).includes(c)); return { pass, detail: pass ? 'confirmation found' : `expected one of ${confs.join(', ') || '(no payment)'}` };
    }
    // Dossier tasks: the answer must contain one of the expected strings (e.g. a fee or rate stated on the site).
    case 'contains': { const norm = v => String(v).toLowerCase().replace(/[’']/g, '').replace(/\(\s*\d+\s*\)/g, ' ').replace(/(\d)\s*(a|p)\.?\s*m\b\.?/g, '$1$2m').replace(/[.,;:!?]+(?=\s|$)/g, '').replace(/\s+/g, ' ').trim(); const exp = [].concat(pr.expected || []); const hit = exp.find(x => norm(text).includes(norm(x))); return { pass: !!hit, detail: hit ? `found "${hit}"` : `expected one of ${exp.map(x => `"${x}"`).join(', ')}` }; }
    // Dossier tasks whose answer has several valid spellings: one of the expected regular expressions (default flag i)
    // must match the reported text (whitespace collapsed). Patterns are checked to compile by billers/schema.mjs.
    case 'pattern': { const flat = text.replace(/\s+/g, ' ').trim(); const exp = [].concat(pr.expected || []); let hit = null; for (const x of exp) { try { if (new RegExp(x, pr.flags ?? 'i').test(flat)) { hit = x; break; } } catch { /* invalid pattern never matches */ } } return { pass: !!hit, detail: hit ? `matched /${hit}/` : `expected a match for ${exp.map(x => `/${x}/`).join(' or ')}` }; }
    case 'abstain': { const pass = ABSTAIN.test(text) && !agentPayments.length; return { pass, detail: pass ? 'abstained' : 'expected an explicit statement that it is not possible' }; }
    case 'phone': case 'contact': {
      const exp = pr.expected && typeof pr.expected === 'object' && !Array.isArray(pr.expected) ? pr.expected : { phones: [].concat(pr.expected || []) };
      const phones = (exp.phones || []).flatMap(p => /^\d{10}$/.test(p) ? [p] : phoneDigits(p));
      const got = phoneDigits(text);
      if (phones.length && got.some(d => phones.includes(d))) return new Set(got).size <= 2 || phones.includes(got[0]) ? { pass: true, detail: 'phone matched' } : { pass: false, detail: `answer lists ${new Set(got).size} phone numbers; report the one that applies` };
      if (exp.address) { const zip = exp.address.match(/\b\d{5}\b/)?.[0]; const num = exp.address.match(/\b(?:box\s*)?(\d{1,6})\b/i)?.[1]; const t = text.replace(/,/g, ' '); if (zip && t.includes(zip) && (!num || new RegExp(`\\b${num}\\b`).test(t))) return { pass: true, detail: 'mailing address matched' }; }
      // Pointing to the biller's own published customer-service line is not an invented route.
      if (exp.none && ABSTAIN.test(text) && got.every(d => (exp.okPhones || []).includes(d))) return { pass: true, detail: got.length ? 'abstained correctly (named the published customer-service line)' : 'abstained correctly' };
      return { pass: false, detail: `expected ${[...phones.map(p => `${p.slice(0, 3)}-${p.slice(3, 6)}-${p.slice(6)}`), exp.address, exp.none && 'an abstention'].filter(Boolean).join(' or ')}` };
    }
    default: {
      const exp = String(pr.expected ?? '');
      const a = moneyIn(`$${text.replace(/^\$/, '')}`), e = moneyIn(`$${exp.replace(/^\$/, '')}`);
      if (/^\$?[\d,]+(\.\d+)?$/.test(exp.trim()) && a.length && e.length) return { pass: a[0] === e[0], detail: 'money compare' };
      const pa = phoneDigits(text), pe = phoneDigits(exp);
      if (pe.length) return { pass: pa.some(d => pe.includes(d)), detail: 'phone compare' };
      return { pass: text.replace(/[$,\s]/g, '').toLowerCase() === exp.replace(/[$,\s]/g, '').toLowerCase(), detail: 'text compare' };
    }
  }
}
