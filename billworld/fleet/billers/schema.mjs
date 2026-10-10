// Dedicated-biller dossier format: billworld/fleet/billers/<billerId>.json.
// A dossier is researched, biller-specific DATA that makes one catalog biller's mock site and tasks behave like the
// real biller. Everything a dossier can say is applied generically by catalog/engine/server/kit/help/tasks and every
// template, so builders only ever write dossier JSON (plus biller-specific test expectations inside it).
// validateDossier(d, { biller? }) returns a list of human-readable errors (empty = valid).

export const DOSSIER_VERSION = 1;
export const SOURCE_KINDS = ['login', 'pay', 'autopay', 'cancel', 'help', 'fees', 'plans', 'other'];
export const EVIDENCE = ['observed_public', 'documented_official', 'inferred', 'synthetic'];
// Canonical concepts a dossier may rename. Keys that are also page names (autopay, paperless, ...) label the page
// and every link to it; the others label text the templates show (amountDue, dueDate, ...).
export const LABEL_KEYS = {
  payBill: 'Pay the bill (page and links)', viewBill: 'Current bill page', autopay: 'Automatic payments', paperless: 'Paperless billing',
  history: 'Payment history / activity', wallet: 'Saved payment methods', cancel: 'Stop / cancel service', plan: 'Plan or rate change',
  help: 'Help center', signIn: 'Sign in', signOut: 'Sign out', register: 'Create an online account', forgot: 'Forgot password link',
  guestPay: 'Pay without signing in', dashboard: 'Signed-in account home', statements: 'Statements / bill history', contact: 'Contact / secure messages',
  profile: 'Profile settings', arrangement: 'Payment arrangement / agreement', amountDue: 'Amount due', dueDate: 'Due date',
  accountNumber: 'Account number', accountName: 'Name of the billed account or product (e.g. Auto Loan)', username: 'Sign-in identifier field label', password: 'Password field label', home: 'Public home'
};
// Template page -> label key (pages missing here have no dossier label).
export const PAGE_LABEL = {
  pay: 'payBill', payMethod: 'payBill', payReview: 'payBill', bill: 'viewBill', autopay: 'autopay', paperless: 'paperless', history: 'history', wallet: 'wallet',
  cancel: 'cancel', plan: 'plan', help: 'help', login: 'signIn', loginPassword: 'signIn', logout: 'signOut', register: 'register', forgot: 'forgot',
  guest: 'guestPay', dashboard: 'dashboard', statements: 'statements', contact: 'contact', profile: 'profile', arrangement: 'arrangement', home: 'home'
};
export const NAV_PAGES = ['home', 'login', 'register', 'guest', 'help', 'dashboard', 'bill', 'statements', 'pay', 'history', 'autopay', 'paperless', 'wallet', 'cancel', 'plan', 'arrangement', 'contact', 'profile'];
export const PUBLIC_NAV_PAGES = new Set(['home', 'login', 'register', 'guest', 'help']);
export const CAPABILITY_KEYS = ['online_account', 'registration', 'password_reset', 'view_bill', 'statements', 'pay_online', 'guest_pay', 'autopay', 'autopay_cancel', 'scheduled_payment', 'paperless', 'cancel_service', 'payment_assistance', 'payment_arrangement', 'pay_by_phone', 'pay_by_mail', 'google_login', 'change_plan'];
export const SUPPORT = ['supported', 'unsupported', 'unknown', 'not_applicable'];
export const IDENTIFIERS = ['email', 'username', 'account', 'phone', 'email_or_username', 'email_or_account'];
export const MFA = ['none', 'email', 'sms', 'email_or_sms'];
export const REG_FIELDS = ['accountNumber', 'lastName', 'zip', 'email', 'phone'];
export const GUEST_FIELDS = ['accountNumber', 'statementId', 'parcelId', 'plate', 'phone', 'lastName', 'zip', 'amountDue', 'dob'];
export const GUEST_PRIMARY = ['accountNumber', 'statementId', 'parcelId', 'plate', 'phone'];
export const METHOD_TYPES = ['bank', 'card'];
export const AUTOPAY_POLICIES = ['full', 'minimum', 'statement', 'fixed'];
export const PREDICATE_TYPES = ['payment', 'no_payment', 'autopay', 'autopay_unchanged', 'paperless', 'service', 'retention_accepted', 'scheduled_cancelled', 'password_changed', 'logged_in', 'registered', 'method_removed', 'payment_plan', 'message_sent', 'answer', 'no_event', 'event', 'event_sequence', 'no_unrequested_changes'];
export const ANSWER_KINDS = ['amount_due', 'confirmation', 'phone', 'contact', 'contains', 'abstain', 'text'];
// Reference-solution steps for dossier tasks (tests/solve.mjs runs them against the engine).
export const SOLUTION_OPS = ['login', 'pay', 'autopay', 'cancelAutopay', 'paperless', 'cancelService', 'changePlan', 'arrangement', 'contact', 'answer', 'reset', 'removeMethod'];
// Built-in task slugs (tasks.mjs) a dossier may suppress or reuse as a solver.
export const BUILTIN_TASKS = ['view-bill', 'pay-bank', 'pay-minimum', 'pay-partial-card', 'schedule-payment', 'cancel-scheduled', 'autopay-enroll', 'autopay-switch-to-card', 'autopay-cancel', 'paperless-on', 'cancel-service', 'accept-retention', 'undo-cancellation', 'downgrade-plan', 'remove-old-card', 'setup-payment-plan', 'send-message', 'reset-then-pay', 'mfa-pay', 'sms-mfa-pay', 'google-login-pay', 'register-and-pay', 'guest-pay', 'declined-retry', 'help-phone'];
// Passwords the generated tasks and browser flows use: a dossier password rule must accept all of them.
export const REQUIRED_PASSWORDS = ['Billworld-2026!', 'Renewed-Pass-2026!', 'Fresh-Start-2026!'];
const TOP = ['$schema', 'id', 'version', 'status', 'name', 'category', 'reviewedAt', 'sources', 'notes', 'template', 'brand', 'labels', 'nav', 'auth', 'capabilities', 'billing', 'help', 'tasks', 'testExpectations', 'officialDomains', 'contact'];

const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
const str = (v, max = 400) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
const HEX = /^#[0-9a-f]{6}$/i;
const lum = hex => { const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(x => x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
export const contrastWithWhite = hex => 1.05 / (lum(hex) + 0.05);
const officialUrl = u => { try { const x = new URL(u); return x.protocol === 'https:' && !!x.hostname && !/^(localhost|127\.|\[)/.test(x.hostname); } catch { return false; } };
const sanitizeLabel = s => typeof s === 'string' && s.trim() && s.length <= 48 && !/[<>{}]|https?:|www\./i.test(s);

// Validate one dossier. biller (optional) is the catalog record for cross-checks (template routes, contact phones).
export function validateDossier(d, { biller = null, templateIds = null, fileId = null } = {}) {
  const errs = [];
  const e = (path, msg) => errs.push(`${path}: ${msg}`);
  if (!isObj(d)) return ['dossier: must be a JSON object'];
  for (const k of Object.keys(d)) if (!TOP.includes(k)) e(k, `unknown field (allowed: ${TOP.join(', ')})`);
  if (!str(d.id, 120) || !/^[a-z0-9-]+$/.test(d.id)) e('id', 'required: the fleet billerId (lowercase slug-hash)');
  if (fileId && d.id !== fileId) e('id', `must match the file name (${fileId}.json)`);
  if (d.status !== 'dedicated') e('status', "required: 'dedicated'");
  if (d.reviewedAt != null && !/^\d{4}-\d{2}-\d{2}$/.test(String(d.reviewedAt))) e('reviewedAt', 'YYYY-MM-DD');
  if (d.notes != null && typeof d.notes !== 'string') e('notes', 'string');
  if (d.officialDomains != null && (!Array.isArray(d.officialDomains) || d.officialDomains.some(x => !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(x)))) e('officialDomains', 'array of host names (the biller\'s own domains and its official payment vendor\'s, e.g. "coned.com")');
  // sources
  if (!Array.isArray(d.sources) || !d.sources.length) e('sources', 'required: at least one official https source');
  else d.sources.forEach((s, i) => {
    if (!isObj(s)) return e(`sources[${i}]`, 'object');
    if (!officialUrl(s.url)) e(`sources[${i}].url`, 'must be an https URL of the biller\'s public site');
    if (!str(s.title, 200)) e(`sources[${i}].title`, 'required');
    if (!/^\d{4}-\d{2}-\d{2}/.test(String(s.fetchedAt || ''))) e(`sources[${i}].fetchedAt`, 'required date YYYY-MM-DD');
    if (!SOURCE_KINDS.includes(s.kind)) e(`sources[${i}].kind`, `one of ${SOURCE_KINDS.join('|')}`);
  });
  const sourceUrls = new Set((d.sources || []).map(s => s?.url));
  const checkSource = (path, src) => { if (src != null && !sourceUrls.has(src)) e(path, 'must be one of the dossier sources[].url'); };
  if (d.template != null && (typeof d.template !== 'string' || (templateIds && !templateIds.includes(d.template)) || d.template === 'offline')) e('template', `an online template id${templateIds ? ` (${templateIds.filter(t => t !== 'offline').join(', ')})` : ''}`);
  // brand
  if (d.brand != null) {
    if (!isObj(d.brand)) e('brand', 'object');
    else {
      for (const k of Object.keys(d.brand)) if (!['displayName', 'shortName', 'primary', 'accent', 'monogram'].includes(k)) e(`brand.${k}`, 'unknown field');
      for (const k of ['displayName', 'shortName']) if (d.brand[k] != null && !str(d.brand[k], 80)) e(`brand.${k}`, 'non-empty string ≤ 80');
      if (d.brand.monogram != null && !/^[A-Z0-9]{1,2}$/.test(d.brand.monogram)) e('brand.monogram', '1-2 capital letters/digits');
      for (const k of ['primary', 'accent']) if (d.brand[k] != null) {
        if (!HEX.test(d.brand[k])) e(`brand.${k}`, '#rrggbb'); else if (contrastWithWhite(d.brand[k]) < 4.5) e(`brand.${k}`, `contrast with white is ${contrastWithWhite(d.brand[k]).toFixed(2)}:1; needs ≥ 4.5:1 (use a darker shade)`);
      }
    }
  }
  // labels
  if (d.labels != null) {
    if (!isObj(d.labels)) e('labels', 'object');
    else for (const [k, v] of Object.entries(d.labels)) { if (!LABEL_KEYS[k]) e(`labels.${k}`, `unknown label key (known: ${Object.keys(LABEL_KEYS).join(', ')})`); else if (!sanitizeLabel(v)) e(`labels.${k}`, 'non-empty plain text ≤ 48 chars, no markup or URLs'); }
  }
  // nav
  if (d.nav != null) {
    if (!isObj(d.nav)) e('nav', 'object {public, account}');
    else for (const [area, list] of Object.entries(d.nav)) {
      if (!['public', 'account'].includes(area)) { e(`nav.${area}`, 'only public and account'); continue; }
      if (!Array.isArray(list) || !list.length || list.length > 12) { e(`nav.${area}`, '1-12 items'); continue; }
      list.forEach((it, i) => {
        const p = `nav.${area}[${i}]`;
        if (!isObj(it)) return e(p, 'object {label, page|helpSlug}');
        if (!sanitizeLabel(it.label)) e(`${p}.label`, 'non-empty plain text ≤ 48 chars');
        if ((it.page == null) === (it.helpSlug == null)) e(p, 'exactly one of page or helpSlug');
        if (it.page != null && !NAV_PAGES.includes(it.page)) e(`${p}.page`, `canonical page (${NAV_PAGES.join(', ')})`);
        if (it.page != null && area === 'public' && !PUBLIC_NAV_PAGES.has(it.page)) e(`${p}.page`, `public nav may only use ${[...PUBLIC_NAV_PAGES].join(', ')} (signed-in pages redirect to sign-in)`);
        if (it.helpSlug != null && !/^[a-z0-9-]{2,60}$/.test(it.helpSlug)) e(`${p}.helpSlug`, 'help article slug');
      });
    }
  }
  // auth
  if (d.auth != null) {
    const a = d.auth;
    if (!isObj(a)) e('auth', 'object');
    else {
      for (const k of Object.keys(a)) if (!['identifier', 'loginSteps', 'mfa', 'socialProviders', 'passwordRule', 'lockoutAttempts', 'registrationFields', 'guestLookupFields', 'guestLookupExact', 'source', 'evidence'].includes(k)) e(`auth.${k}`, 'unknown field');
      if (a.guestLookupExact != null && (typeof a.guestLookupExact !== 'boolean' || !a.guestLookupFields)) e('auth.guestLookupExact', 'boolean, with guestLookupFields (the guest form asks for exactly those fields)');
      if (a.identifier != null && !IDENTIFIERS.includes(a.identifier)) e('auth.identifier', IDENTIFIERS.join('|'));
      if (a.loginSteps != null && ![1, 2].includes(a.loginSteps)) e('auth.loginSteps', '1 or 2');
      if (a.mfa != null && !MFA.includes(a.mfa)) e('auth.mfa', MFA.join('|'));
      if (a.socialProviders != null && (!Array.isArray(a.socialProviders) || a.socialProviders.some(p => !['google', 'apple', 'facebook', 'microsoft'].includes(p)))) e('auth.socialProviders', 'array of google|apple|facebook|microsoft');
      if (a.passwordRule != null) {
        if (!isObj(a.passwordRule) || !str(a.passwordRule.pattern, 300) || !str(a.passwordRule.message, 200)) e('auth.passwordRule', '{pattern, message}');
        else { let re = null; try { re = new RegExp(a.passwordRule.pattern); } catch (x) { e('auth.passwordRule.pattern', `invalid regex: ${x.message}`); }
          if (re) for (const pw of REQUIRED_PASSWORDS) if (!re.test(pw)) e('auth.passwordRule.pattern', `must accept the fleet test password "${pw}"`); }
      }
      if (a.lockoutAttempts != null && !(Number.isInteger(a.lockoutAttempts) && a.lockoutAttempts >= 3 && a.lockoutAttempts <= 10)) e('auth.lockoutAttempts', 'integer 3-10');
      if (a.registrationFields != null && (!Array.isArray(a.registrationFields) || a.registrationFields.some(f => !REG_FIELDS.includes(f)))) e('auth.registrationFields', `subset of ${REG_FIELDS.join(', ')} (accountNumber and email are always required)`);
      if (a.guestLookupFields != null) {
        if (!Array.isArray(a.guestLookupFields) || a.guestLookupFields.some(f => !GUEST_FIELDS.includes(f))) e('auth.guestLookupFields', `subset of ${GUEST_FIELDS.join(', ')}`);
        else if (!a.guestLookupFields.some(f => GUEST_PRIMARY.includes(f))) e('auth.guestLookupFields', `needs one primary identifier (${GUEST_PRIMARY.join(', ')})`);
      }
      checkSource('auth.source', a.source);
    }
  }
  // contact: customer-service / pay-by-phone numbers that replace the catalog's (e.g. a catalog number that is really tech support)
  if (d.contact != null) {
    const c = d.contact;
    if (!isObj(c)) e('contact', 'object {phone, payPhone, source}');
    else {
      for (const k of Object.keys(c)) if (!['phone', 'payPhone', 'source', 'evidence'].includes(k)) e(`contact.${k}`, 'unknown field');
      for (const k of ['phone', 'payPhone']) if (c[k] != null && String(c[k]).replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '').length !== 10) e(`contact.${k}`, '10-digit US phone');
      if (!c.source) e('contact.source', 'required'); checkSource('contact.source', c.source);
    }
  }
  // capabilities
  if (d.capabilities != null) {
    if (!isObj(d.capabilities)) e('capabilities', 'object');
    else for (const [k, c] of Object.entries(d.capabilities)) {
      const p = `capabilities.${k}`;
      if (!CAPABILITY_KEYS.includes(k)) { e(p, `unknown capability (known: ${CAPABILITY_KEYS.join(', ')})`); continue; }
      if (!isObj(c)) { e(p, 'object {support, evidence, source, note}'); continue; }
      for (const f of Object.keys(c)) if (!['support', 'evidence', 'source', 'note', 'channel', 'phone'].includes(f)) e(`${p}.${f}`, 'unknown field');
      if (!SUPPORT.includes(c.support)) e(`${p}.support`, SUPPORT.join('|'));
      if (!EVIDENCE.includes(c.evidence)) e(`${p}.evidence`, EVIDENCE.join('|'));
      if (['observed_public', 'documented_official'].includes(c.evidence) && !c.source) e(`${p}.source`, `required for ${c.evidence}`);
      checkSource(`${p}.source`, c.source);
      if (c.note != null && !str(c.note, 300)) e(`${p}.note`, 'string ≤ 300');
      if (c.support === 'unsupported' && !c.note) e(`${p}.note`, 'required when unsupported online: say how customers do it instead (shown on the site)');
      if (c.channel != null && !['phone', 'mail', 'in_person', 'app', 'none'].includes(c.channel)) e(`${p}.channel`, 'phone|mail|in_person|app|none');
      if (c.phone != null && String(c.phone).replace(/\D/g, '').replace(/^1/, '').length !== 10) e(`${p}.phone`, '10-digit US phone');
      if (k === 'online_account' && c.support !== 'supported') e(p, 'dedicated billers must have online accounts (use the offline tier instead)');
    }
  }
  // billing
  if (d.billing != null) {
    const b = d.billing;
    if (!isObj(b)) e('billing', 'object');
    else {
      for (const k of Object.keys(b)) if (!['fees', 'methods', 'guestMethods', 'autopay', 'scheduled', 'minPaymentCents', 'maxPaymentCents', 'plans', 'cardMinimum', 'lateFeeCents', 'lateFeePercent', 'lateFeeMinCents', 'fullBalanceOnly', 'maxPaymentBalance', 'source'].includes(k)) e(`billing.${k}`, 'unknown field');
      for (const k of ['maxPaymentBalance']) if (b[k] != null && typeof b[k] !== 'boolean') e(`billing.${k}`, 'boolean');
      if (b.fullBalanceOnly != null && typeof b.fullBalanceOnly !== 'boolean') e('billing.fullBalanceOnly', 'boolean (online payments must be the full balance; no payment plans)');
      if (b.lateFeeMinCents != null && b.lateFeePercent == null) e('billing.lateFeeMinCents', 'needs lateFeePercent (the charge is the greater of the two)');
      checkSource('billing.source', b.source);
      const cents = (path, v, max = 10000000) => { if (v != null && !(Number.isInteger(v) && v >= 0 && v <= max)) e(path, `integer cents 0-${max}`); };
      if (b.fees != null) {
        if (!isObj(b.fees)) e('billing.fees', 'object');
        else {
          for (const k of Object.keys(b.fees)) if (!['bankCents', 'cardCents', 'cardPercent', 'cardMinCents', 'autopayCardCents', 'autopayCardPercent', 'guestBankCents', 'guestCardCents', 'notes', 'evidence', 'source'].includes(k)) e(`billing.fees.${k}`, 'unknown field');
          if (b.fees.cardMinCents != null && b.fees.cardPercent == null) e('billing.fees.cardMinCents', 'only with cardPercent (the minimum of a percentage fee)');
          for (const k of ['bankCents', 'cardCents', 'cardMinCents', 'autopayCardCents', 'guestBankCents', 'guestCardCents']) cents(`billing.fees.${k}`, b.fees[k], 5000);
          for (const k of ['cardPercent', 'autopayCardPercent']) if (b.fees[k] != null && !(typeof b.fees[k] === 'number' && b.fees[k] >= 0 && b.fees[k] < 10)) e(`billing.fees.${k}`, 'number 0-10');
          if (b.fees.notes != null && (!Array.isArray(b.fees.notes) || b.fees.notes.length > 6 || b.fees.notes.some(n => !str(n, 300)))) e('billing.fees.notes', 'up to 6 strings ≤ 300 (fees that exist but whose amount is not published; shown in help)');
          if (!EVIDENCE.includes(b.fees.evidence)) e('billing.fees.evidence', EVIDENCE.join('|'));
          if (b.fees.evidence !== 'synthetic' && !b.fees.source) e('billing.fees.source', 'required unless synthetic');
          checkSource('billing.fees.source', b.fees.source);
        }
      }
      for (const k of ['methods', 'guestMethods']) if (b[k] != null && (!Array.isArray(b[k]) || !b[k].length || b[k].some(m => !METHOD_TYPES.includes(m)))) e(`billing.${k}`, 'non-empty subset of bank, card');
      if (b.autopay != null) {
        const ap = b.autopay;
        if (!isObj(ap)) e('billing.autopay', 'object');
        else {
          if (ap.policies != null && (!Array.isArray(ap.policies) || !ap.policies.length || ap.policies.some(p => !AUTOPAY_POLICIES.includes(p)))) e('billing.autopay.policies', `non-empty subset of ${AUTOPAY_POLICIES.join(', ')}`);
          if (ap.policies && !ap.policies.includes('full') && !ap.policies.includes('statement')) e('billing.autopay.policies', "must include 'full' or 'statement' (the generated AutoPay tasks pay the full balance)");
          if (ap.days != null && ap.days !== 'due_date' && !(Array.isArray(ap.days) && ap.days.length && ap.days.every(x => Number.isInteger(x) && x >= 1 && x <= 28))) e('billing.autopay.days', "'due_date' or array of days 1-28");
          if (ap.leadDays != null && !(Number.isInteger(ap.leadDays) && ap.leadDays >= 0 && ap.leadDays <= 15)) e('billing.autopay.leadDays', 'integer 0-15');
          if (ap.daysAfterBill != null && !(Number.isInteger(ap.daysAfterBill) && ap.daysAfterBill >= 0 && ap.daysAfterBill <= 28)) e('billing.autopay.daysAfterBill', 'integer 0-28 (days after the bill date; never later than the due date)');
          if (ap.daysAfterBill != null && (ap.leadDays != null || ap.days === 'due_date')) e('billing.autopay.daysAfterBill', 'not with leadDays or days: due_date');
          if (ap.methodTypes != null && (!Array.isArray(ap.methodTypes) || !ap.methodTypes.length || ap.methodTypes.some(m => !METHOD_TYPES.includes(m)))) e('billing.autopay.methodTypes', 'non-empty subset of bank, card');
        }
      }
      // Card-only billers (methods without 'bank'): no saved checking account is seeded; generated tasks use the saved Visa.
      if (b.scheduled != null && (!isObj(b.scheduled) || Object.keys(b.scheduled).some(k => !['maxDaysAhead', 'maxPending'].includes(k)) || (b.scheduled.maxDaysAhead != null && !(Number.isInteger(b.scheduled.maxDaysAhead) && b.scheduled.maxDaysAhead >= 0 && b.scheduled.maxDaysAhead <= 365)) || (b.scheduled.maxPending != null && !(Number.isInteger(b.scheduled.maxPending) && b.scheduled.maxPending >= 1 && b.scheduled.maxPending <= 30)))) e('billing.scheduled', '{maxDaysAhead?: 0-365 (0 = no future-dated payments), maxPending?: 1-30 scheduled payments at once}');
      cents('billing.minPaymentCents', b.minPaymentCents, 100000); cents('billing.maxPaymentCents', b.maxPaymentCents, 100000000); cents('billing.lateFeeCents', b.lateFeeCents, 100000); cents('billing.lateFeeMinCents', b.lateFeeMinCents, 100000);
      if (b.minPaymentCents != null && b.minPaymentCents > 2500) e('billing.minPaymentCents', 'at most 2500 (generated tasks pay $25.00)');
      if (b.maxPaymentCents != null && b.maxPaymentCents < 500000) e('billing.maxPaymentCents', 'at least 500000 (bills must stay payable in full)');
      if (b.lateFeePercent != null && !(typeof b.lateFeePercent === 'number' && b.lateFeePercent > 0 && b.lateFeePercent <= 10)) e('billing.lateFeePercent', 'number 0-10');
      if (b.cardMinimum != null && (!isObj(b.cardMinimum) || !(typeof b.cardMinimum.percent === 'number' && b.cardMinimum.percent > 0 && b.cardMinimum.percent <= 10) || !(Number.isInteger(b.cardMinimum.floorCents) && b.cardMinimum.floorCents >= 0 && b.cardMinimum.floorCents <= 10000))) e('billing.cardMinimum', '{percent: 0-10, floorCents: 0-10000, plusInterest?: boolean}');
      if (b.plans != null) {
        if (!Array.isArray(b.plans) || b.plans.length < 2 || b.plans.length > 8) e('billing.plans', '2-8 plans');
        else { const ids = new Set(); b.plans.forEach((p, i) => { if (!isObj(p) || !/^[a-z0-9-]{2,30}$/.test(p.id || '') || !str(p.name, 60) || !(Number.isInteger(p.cents) && p.cents >= 0 && p.cents <= 100000)) e(`billing.plans[${i}]`, '{id: slug, name, cents}'); if (ids.has(p?.id)) e(`billing.plans[${i}].id`, 'duplicate'); ids.add(p?.id); if (p?.current != null && typeof p.current !== 'boolean') e(`billing.plans[${i}].current`, 'boolean'); }); }
      }
    }
  }
  // help
  if (d.help != null) {
    if (!Array.isArray(d.help)) e('help', 'array');
    else d.help.forEach((h, i) => {
      const p = `help[${i}]`;
      if (!isObj(h)) return e(p, 'object');
      if (!/^[a-z0-9-]{2,60}$/.test(h.slug || '')) e(`${p}.slug`, 'slug');
      if (!str(h.title, 120)) e(`${p}.title`, 'required');
      if (!Array.isArray(h.paragraphs) || !h.paragraphs.length || h.paragraphs.some(x => !str(x, 900) || /https?:\/\/|www\./.test(x))) e(`${p}.paragraphs`, 'non-empty array of paraphrased text (≤ 900 chars each, no URLs)');
      if (h.steps != null && (!Array.isArray(h.steps) || h.steps.some(x => !str(x, 300)))) e(`${p}.steps`, 'array of strings');
      if (!h.source) e(`${p}.source`, 'required (one of sources[].url)'); else checkSource(`${p}.source`, h.source);
      if (h.mode != null && !['replace', 'append'].includes(h.mode)) e(`${p}.mode`, 'replace|append');
      if (h.topic != null && !str(h.topic, 30)) e(`${p}.topic`, 'string');
    });
  }
  // tasks
  if (d.tasks != null) {
    const t = d.tasks;
    if (!isObj(t)) e('tasks', 'object {extra, suppress}');
    else {
      if (t.suppress != null && (!Array.isArray(t.suppress) || t.suppress.some(s => !BUILTIN_TASKS.includes(s) && !/-limitation$/.test(s)))) e('tasks.suppress', `built-in task slugs (${BUILTIN_TASKS.join(', ')}) or *-limitation`);
      if (t.extra != null) {
        if (!Array.isArray(t.extra)) e('tasks.extra', 'array');
        else t.extra.forEach((x, i) => {
          const p = `tasks.extra[${i}]`;
          if (!isObj(x)) return e(p, 'object');
          if (!/^[a-z0-9-]{3,60}$/.test(x.slug || '') || BUILTIN_TASKS.includes(x.slug)) e(`${p}.slug`, 'new slug (not a built-in task)');
          if (!str(x.intent, 600) || x.intent.length < 20) e(`${p}.intent`, 'natural-language instruction ≥ 20 chars');
          if (x.scenario != null && !isObj(x.scenario)) e(`${p}.scenario`, 'object (engine scenario for this biller)');
          if (!Array.isArray(x.predicates) || !x.predicates.length) e(`${p}.predicates`, 'non-empty array');
          else x.predicates.forEach((pr, j) => { if (!isObj(pr) || !PREDICATE_TYPES.includes(pr.type)) e(`${p}.predicates[${j}]`, `known predicate type (${PREDICATE_TYPES.join(', ')})`); else if (pr.type === 'answer' && !ANSWER_KINDS.includes(pr.kind)) e(`${p}.predicates[${j}].kind`, ANSWER_KINDS.join('|')); });
          if (x.answer != null && (!isObj(x.answer) || !ANSWER_KINDS.includes(x.answer.kind))) e(`${p}.answer`, `{kind: ${ANSWER_KINDS.join('|')}}`);
          if (!Array.isArray(x.tags) || !x.tags.length) e(`${p}.tags`, 'non-empty array');
          if (x.evidence != null && !EVIDENCE.includes(x.evidence)) e(`${p}.evidence`, EVIDENCE.join('|'));
          if ((x.solver == null) === (x.solution == null)) e(p, 'exactly one of solver (a built-in slug) or solution (steps) for the reference solver');
          if (x.solver != null && !BUILTIN_TASKS.includes(x.solver)) e(`${p}.solver`, 'built-in task slug');
          if (x.solution != null) { if (!Array.isArray(x.solution) || !x.solution.length) e(`${p}.solution`, 'non-empty array of steps'); else x.solution.forEach((s, j) => { if (!isObj(s) || !SOLUTION_OPS.includes(s.op)) e(`${p}.solution[${j}].op`, SOLUTION_OPS.join('|')); }); }
        });
      }
    }
  }
  // testExpectations
  if (d.testExpectations != null) {
    if (!Array.isArray(d.testExpectations)) e('testExpectations', 'array');
    else d.testExpectations.forEach((x, i) => {
      const p = `testExpectations[${i}]`;
      if (!isObj(x)) return e(p, 'object');
      if (!NAV_PAGES.includes(x.page) && !['helpArticle', 'mfa', 'forgot'].includes(x.page)) e(`${p}.page`, `page to open (${NAV_PAGES.join(', ')}, helpArticle, mfa, forgot)`);
      if (x.page === 'helpArticle' && !x.slug) e(`${p}.slug`, 'required for helpArticle');
      if (x.contains == null && x.notContains == null && x.label == null) e(p, 'one of contains, notContains or label');
      for (const k of ['contains', 'notContains']) if (x[k] != null && !(str(x[k], 200) || (Array.isArray(x[k]) && x[k].every(s => str(s, 200))))) e(`${p}.${k}`, 'string or array of strings');
      if (x.label != null && !LABEL_KEYS[x.label]) e(`${p}.label`, 'a label key: asserts that labels[key] is visible on the page');
      if (x.label != null && !d.labels?.[x.label]) e(`${p}.label`, `labels.${x.label} is not set`);
      if (x.signedIn != null && typeof x.signedIn !== 'boolean') e(`${p}.signedIn`, 'boolean');
    });
  }
  // catalog cross-checks
  if (biller) {
    if (biller.template === 'offline' && !d.template) e('template', 'this biller resolves to the offline template; set template to its real portal family');
    // Sources must be the biller's own public site (or a domain listed in officialDomains, e.g. its payment vendor).
    const reg = h => String(h || '').toLowerCase().replace(/^www\./, '').split('.').slice(-2).join('.');
    const own = new Set([biller.entry?.website, biller.entry?.login_url, biller.entry?.help_center_url, ...Object.values(biller.entry?.links || {})].filter(Boolean).map(u => { try { return reg(new URL(u).hostname); } catch { return null; } }).filter(Boolean));
    for (const x of d.officialDomains || []) own.add(reg(x));
    (d.sources || []).forEach((s, i) => { try { const h = reg(new URL(s.url).hostname); if (!own.has(h)) e(`sources[${i}].url`, `${h} is not the biller's own domain (${[...own].join(', ') || 'none in catalog'}); add it to officialDomains only if it is the biller's official site or payment vendor`); } catch { /* reported above */ } });
    const plans = d.billing?.plans;
    if (Array.isArray(plans) && plans.length >= 2) { const cur = plans.find(p => p.current) || plans[1]; const cheapest = plans.slice().sort((a, b) => a.cents - b.cents)[0]; if (cur && cheapest && cur.id === cheapest.id) e('billing.plans', 'the current plan (current:true, else the 2nd plan) must not be the cheapest one: the downgrade task needs somewhere to go'); }
    if (d.billing?.plans && !['subscription', 'telecom'].includes(biller.kind) && ['toll-account', 'property-tax', 'dmv', 'doxo'].includes(d.template || biller.template)) e('billing.plans', `template ${d.template || biller.template} has no plan page`);
  }
  return errs;
}
