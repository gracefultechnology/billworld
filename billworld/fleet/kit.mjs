// Rendering kit shared by portal templates: escaping, documents, standardized form controls.
// Field NAMES are the contract with the server; labels, layout, order and wording belong to each template.
import { money, fmtDate } from './engine.mjs';
export { money, fmtDate };

export const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Tagged template: interpolations are escaped unless wrapped with raw(). Arrays are joined.
export class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
export const raw = s => new Raw(String(s ?? ''));
const part = v => v instanceof Raw ? v.s : Array.isArray(v) ? v.map(part).join('') : v === false || v == null ? '' : esc(v);
export const html = (strings, ...values) => raw(strings.reduce((out, s, i) => out + s + (i < values.length ? part(values[i]) : ''), ''));

// Full HTML document. css/js are served from the template asset route so CSP stays 'self'.
export function doc(vm, { title, body, bodyClass = '', head = '' }) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title><link rel="icon" href="${vm.asset('favicon.svg')}"><link rel="stylesheet" href="${vm.asset('template.css')}"><style nonce="${vm.nonce}">:root{--brand:${vm.biller.brand.primary};--accent:${vm.biller.brand.accent}}</style>${vm.hasJs ? `<script src="${vm.asset('template.js')}" defer></script>` : ''}${head}</head><body class="${esc(bodyClass)}">${part(body)}</body></html>`;
}
export const logo = (vm, cls = 'logo') => html`<svg class="${cls}" viewBox="0 0 40 40" role="img" aria-label="${vm.biller.brand.shortName} logo"><rect width="40" height="40" rx="8" fill="${vm.biller.brand.primary}"/><text x="20" y="26" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="16" font-weight="700" fill="#fff">${vm.biller.brand.monogram}</text></svg>`;

export const alert = vm => html`${vm.error ? html`<div class="alert alert-error" role="alert">${vm.error}</div>` : ''}${vm.notice ? html`<div class="alert alert-ok" role="status">${vm.notice}</div>` : ''}`;
export const hidden = (name, value) => html`<input type="hidden" name="${name}" value="${value}">`;
// Standard form wrapper: posts to a page route.
export const form = (vm, page, inner, { cls = '', params, id } = {}) => html`<form method="post" action="${vm.url(page, params)}" class="${cls}"${id ? raw(` id="${esc(id)}"`) : ''}>${hidden('_csrf', vm.csrf)}${inner}</form>`;
// Dossier sign-in wording: the identifier field says what the real biller asks for, and a two-step sign-in
// (vm.flow.loginSteps === 2) never shows the password on its first step.
const ID_LABEL = { email: 'Email address', username: 'Username', account: 'Account number', phone: 'Mobile phone number', email_or_username: 'Email or username', email_or_account: 'Email address or account number' };
export const field = (vm, opts) => {
  let o = opts;
  if (o.name === 'password' && vm?.page === 'login' && vm.flow?.loginSteps === 2) return raw('');
  // The biller's own password rule (dossier auth.passwordRule) replaces the family template's generic hint.
  if (o.name === 'password' && ['register', 'reset'].includes(vm?.page) && vm.auth?.passwordRule) o = { ...o, help: vm.auth.passwordRule };
  // No fixed AutoPay amount offered (dossier autopay policies): no "fixed amount (if selected)" box either.
  if (o.name === 'fixedAmount' && vm?.page === 'autopay' && vm.billing?.autopayPolicies && !vm.billing.autopayPolicies.includes('fixed')) return raw('');
  if (o.name === 'username' && (vm?.labels?.username || ID_LABEL[vm?.auth?.identifier])) o = { ...o, label: vm.labels.username || ID_LABEL[vm.auth.identifier], help: undefined, ...(vm.auth?.identifier === 'account' ? { inputmode: 'numeric', autocomplete: 'username' } : vm.auth?.identifier === 'phone' ? { inputmode: 'tel' } : {}) };
  // A non-email sign-in identifier must be typeable: never an email-only input.
  if (o.name === 'username' && vm?.auth?.identifier && vm.auth.identifier !== 'email' && o.type === 'email') o = { ...o, type: vm.auth.identifier === 'phone' ? 'tel' : 'text' };
  if (o.name === 'password' && vm?.labels?.password && !/confirm|new|create/i.test(String(o.label))) o = { ...o, label: vm.labels.password };
  if (o.name === 'accountNumber' && vm?.labels?.accountNumber) o = { ...o, label: vm.labels.accountNumber };
  // Dossier card networks (billing.cardBrands): the card number field says which cards are accepted.
  if (o.name === 'cardNumber' && vm?.cardBrandsText && !o.help) o = { ...o, help: `We accept ${vm.cardBrandsText}.` };
  return fieldHtml(vm, o);
};
const fieldHtml = (vm, { name, label, type = 'text', autocomplete, required = true, placeholder, help, value, cls = 'field', inputmode, maxlength }) => html`<div class="${cls}"><label for="f-${name}">${label}</label><input id="f-${name}" name="${name}" type="${type}"${autocomplete ? raw(` autocomplete="${esc(autocomplete)}"`) : ''}${required ? raw(' required') : ''}${placeholder ? raw(` placeholder="${esc(placeholder)}"`) : ''}${inputmode ? raw(` inputmode="${esc(inputmode)}"`) : ''}${maxlength ? raw(` maxlength="${maxlength}"`) : ''} value="${value ?? (type === 'password' ? '' : vm.values[name] ?? '')}">${help ? html`<small class="help">${help}</small>` : ''}</div>`;
export const select = (vm, { name, label, options, value, cls = 'field' }) => html`<div class="${cls}"><label for="f-${name}">${label}</label><select id="f-${name}" name="${name}">${options.map(([v, t]) => html`<option value="${v}"${String(value ?? vm.values[name] ?? '') === String(v) ? raw(' selected') : ''}>${t}</option>`)}</select></div>`;
export const checkbox = (vm, { name, label, value = 'on', checked, required }) => html`<label class="check"><input type="checkbox" name="${name}" value="${value}"${checked ?? vm.values[name] ? raw(' checked') : ''}${required ? raw(' required') : ''}> <span>${label}</span></label>`;
export const radio = (vm, { name, value, label, checked, extra = '' }) => html`<label class="radio"><input type="radio" name="${name}" value="${value}"${checked ? raw(' checked') : ''}> <span>${label}</span>${extra}</label>`;
export const button = (label, { cls = 'btn btn-primary', name, value } = {}) => html`<button type="submit" class="${cls}"${name ? raw(` name="${esc(name)}" value="${esc(value)}"`) : ''}>${label}</button>`;

// Amount choices: radio list with an "other amount" input (name=amountChoice, amount).
export function amountChooser(vm, { labels = {} } = {}) {
  const sel = vm.values.amountChoice || vm.draft?.amountKey || 'due';
  return html`<fieldset class="amounts"><legend>${labels.legend || 'Payment amount'}</legend>${vm.amountOptions.map(o => radio(vm, { name: 'amountChoice', value: o.key, checked: sel === o.key, label: (o.key === 'due' && vm.labels?.amountDue) || labels[o.key] || o.label, extra: o.cents != null ? html` <strong class="amt">${money(o.cents)}</strong>` : html` <input class="other-amount" name="amount" inputmode="decimal" aria-label="Other amount" placeholder="0.00" value="${vm.values.amount ?? (vm.draft?.amountKey === 'other' ? (vm.draft.amountCents / 100).toFixed(2) : '')}">` }))}</fieldset>`;
}
const methodText = m => `${m.type === 'bank' ? `${m.label} account` : m.brand} ending in ${m.last4}${m.expired ? ' (expired)' : ''}`;
export { methodText };
// Saved methods (name=methodId) plus "new bank" / "new card" fields (methodType + details).
const typeOk = (vm, t) => !Array.isArray(vm?.methodTypes) || vm.methodTypes.includes(t);
export function methodChooser(vm, { allowNew = true, title = 'Payment method', allowCard: ac = true, allowBank: ab = true } = {}) {
  const allowCard = ac && typeOk(vm, 'card'), allowBank = ab && typeOk(vm, 'bank');
  const methods = vm.methods.filter(m => (allowCard || m.type !== 'card') && (allowBank || m.type !== 'bank'));
  const sel = vm.values.methodId || vm.draft?.methodId || methods.find(m => !m.expired)?.id || '';
  return html`<fieldset class="methods"><legend>${title}</legend>${methods.map(m => radio(vm, { name: 'methodId', value: m.id, checked: sel === m.id, label: methodText(m) }))}${allowNew ? html`<details class="new-method"${!methods.length ? raw(' open') : ''}><summary>Use a new payment method</summary>${newMethodFields(vm, { allowCard, allowBank })}</details>` : ''}</fieldset>`;
}
// Guest lookup copy: the fields the biller's form actually asks for (dossier guestLookupFields), else the family text.
const GUEST_WORD = { accountNumber: 'account number', zip: 'ZIP code', phone: 'phone number', lastName: 'last name', dob: 'date of birth', statementId: 'statement number', parcelId: 'parcel number', plate: 'license plate', amountDue: 'amount due' };
export const guestNeeds = (vm, fallback) => { const f = vm?.auth?.guestLookupFields; if (!f?.length) return fallback; const w = f.map(k => k === 'accountNumber' ? String(L(vm, 'accountNumber', 'account number')).replace(/\b[A-Z](?=[a-z])/g, c => c.toLowerCase()) : GUEST_WORD[k] || k); return `your ${w.length > 1 ? `${w.slice(0, -1).join(', ')} and ${w.at(-1)}` : w[0]}`; };
export const newMethodFields = (vm, { allowCard: ac = true, allowBank: ab = true } = {}) => newMethodHtml(vm, { allowCard: ac && typeOk(vm, 'card'), allowBank: ab && typeOk(vm, 'bank') });
// Once a method type is chosen, the other type's fields are hidden (CSS :has, no script); both show until then.
const METHOD_TOGGLE_CSS = ':has(>.field>select[name=methodType] option[value=bank]:checked)>.card-fields,:has(>.field>select[name=methodType] option[value=card]:checked)>.bank-fields{display:none}';
const newMethodHtml = (vm, { allowCard, allowBank }) => html`${allowCard && allowBank ? raw(`<style nonce="${esc(vm.nonce || '')}">${METHOD_TOGGLE_CSS}</style>`) : ''}${select(vm, { name: 'methodType', label: 'Method type', options: [['', 'Select…'], ...(allowBank ? [['bank', 'Bank account (checking/savings)']] : []), ...(allowCard ? [['card', 'Debit or credit card']] : [])] })}
${allowBank ? html`<div class="bank-fields">${select(vm, { name: 'accountType', label: 'Account type', options: [['checking', 'Checking'], ['savings', 'Savings']] })}${field(vm, { name: 'routing', label: 'Routing number', required: false, inputmode: 'numeric', maxlength: 9 })}${field(vm, { name: 'bankAccount', label: 'Bank account number', required: false, inputmode: 'numeric' })}${field(vm, { name: 'bankAccountConfirm', label: 'Confirm bank account number', required: false, inputmode: 'numeric' })}</div>` : ''}
${allowCard ? html`<div class="card-fields">${field(vm, { name: 'cardNumber', label: 'Card number', required: false, autocomplete: 'cc-number', inputmode: 'numeric' })}${field(vm, { name: 'exp', label: 'Expiration (MM/YY)', required: false, autocomplete: 'cc-exp', placeholder: 'MM/YY' })}${field(vm, { name: 'cvv', label: 'Security code', required: false, autocomplete: 'cc-csc', inputmode: 'numeric', maxlength: 4 })}${field(vm, { name: 'holder', label: 'Name on card', required: false, autocomplete: 'cc-name' })}</div>` : ''}${vm.authenticated === false ? '' : checkbox(vm, { name: 'save', label: 'Save this method for future payments' })}`;
// A utility stop-service date (name effectiveDate) defaults to, and cannot be before, the earliest allowed stop date
// (3 business days ahead, the notice the help center states; the engine enforces the same rule). Only the payment
// date falls back to the payment draft's date.
export const dateField = (vm, { name = 'payOn', label = 'Payment date', min } = {}) => { min ||= name === 'effectiveDate' ? earliestStopDate(vm) : vm.today; return html`<div class="field"><label for="f-${name}">${label}</label><input id="f-${name}" type="date" name="${name}" min="${min}" value="${vm.values[name] || (name === 'payOn' ? vm.draft?.payOn : '') || min}"></div>`; };
// ISO date `n` business days (Mon–Fri) after the ISO date `from`.
export const addBusinessDays = (from, n) => { const d = new Date(`${from}T12:00:00Z`); while (n > 0) { d.setUTCDate(d.getUTCDate() + 1); if (d.getUTCDay() % 6) n--; } return d.toISOString().slice(0, 10); };
export const STOP_NOTICE_BUSINESS_DAYS = 3;
export const earliestStopDate = vm => vm?.biller?.kind === 'utility' ? addBusinessDays(vm.today, STOP_NOTICE_BUSINESS_DAYS) : vm.today;

// A small, accessible table helper.
export const table = (headers, rows, cls = 'table') => html`<table class="${cls}"><thead><tr>${headers.map(h => html`<th scope="col">${h}</th>`)}</tr></thead><tbody>${rows.length ? rows.map(r => html`<tr>${r.map(c => html`<td>${c}</td>`)}</tr>`) : html`<tr><td colspan="${headers.length}" class="empty">No records found.</td></tr>`}</tbody></table>`;
export const statusLabel = s => ({ scheduled: 'Scheduled', processing: 'Processing', pending: 'Pending', posted: 'Posted', cancelled: 'Cancelled', failed: 'Failed' }[s] || s);
// Scheduled payments show their date like posted ones ("Oct 15, 2026"), not as an ISO string.
export const payDate = p => p.payOn ? fmtDate(Date.parse(`${p.payOn}T17:00:00Z`)) : fmtDate(p.createdAt);
export const paymentRows = (vm, { cancel = true } = {}) => vm.account.payments.slice().reverse().map(p => [payDate(p), money(p.amountCents), `${p.methodType === 'bank' ? 'Bank' : 'Card'} ****${p.methodLast4}`, p.confirmation, statusLabel(p.status), p.status === 'scheduled' && cancel ? form(vm, 'history', html`${hidden('paymentId', p.id)}${button('Cancel payment', { cls: 'btn btn-link', name: 'op', value: 'cancel' })}`) : '']);

// Help center pieces.
export const helpList = (vm, articles = vm.help) => html`<ul class="help-list">${articles.map(a => html`<li><a href="${vm.url('helpArticle', { slug: a.slug })}">${a.title}</a></li>`)}</ul>`;
export const helpBody = a => html`${a.paragraphs.map(p => html`<p>${p}</p>`)}${a.steps ? html`<ol class="steps">${a.steps.map(s => html`<li>${s}</li>`)}</ol>` : ''}`;
export const helpSearchForm = (vm, { placeholder = 'Search help' } = {}) => html`<form method="get" action="${vm.url('helpSearch')}" class="help-search" role="search"><label class="sr-only" for="help-q">${placeholder}</label><input id="help-q" name="q" type="search" placeholder="${placeholder}" value="${vm.query.q || ''}"><button type="submit" class="btn">Search</button></form>`;

// "Sign in with Google" (and future providers): rendered only for providers the server actually implements for this
// biller (vm.socialProviders, from research evidence or template meta). Self-styled with the page nonce so any template
// can drop it in; data-social-login marks it so the server never injects a second copy.
const SOCIAL_LABEL = { google: 'Sign in with Google' };
export function socialButtons(vm, { divider = 'or', labels = {} } = {}) {
  const providers = (Array.isArray(vm.socialProviders) ? vm.socialProviders : []).filter(p => SOCIAL_LABEL[p] && vm.socialUrls?.[p]);
  if (!providers.length) return raw('');
  return html`<div class="bwf-social" data-social-login="${providers.join(' ')}"><style nonce="${vm.nonce}">.bwf-social{margin:16px 0;max-width:420px}.bwf-social .bwf-or{display:flex;align-items:center;gap:10px;color:#5f6368;font-size:13px;margin:0 0 12px}.bwf-social .bwf-or::before,.bwf-social .bwf-or::after{content:"";flex:1;border-top:1px solid #dadce0}.bwf-social a.bwf-sso{display:flex;align-items:center;justify-content:center;gap:10px;min-height:40px;padding:8px 14px;border:1px solid #747775;border-radius:4px;background:#fff;color:#1f1f1f;font:500 14px/1.2 Roboto,Arial,Helvetica,sans-serif;text-decoration:none}.bwf-social a.bwf-sso:hover{background:#f8f9fa}.bwf-social a.bwf-sso:focus-visible{outline:2px solid #0b57d0;outline-offset:2px}.bwf-social .bwf-g{font-weight:700;color:#4285f4;font-size:16px}</style>${divider ? html`<p class="bwf-or">${divider}</p>` : ''}${providers.map(p => html`<a class="bwf-sso bwf-sso-${p}" href="${vm.socialUrls[p]}"><span class="bwf-g" aria-hidden="true">G</span><span>${labels[p] || SOCIAL_LABEL[p]}</span></a>`)}</div>`;
}

// ---------- dedicated tier (billers/<id>.json dossiers) ----------
// L(vm, key, fallback): the biller's own wording for a canonical concept or page, else the template's fallback.
// key is a label key (payBill, autopay, amountDue, ...) or a template page name (pay, bill, login, guest, ...).
// Without a dossier vm.labels is empty, so every template renders exactly its family wording.
const PAGE_KEY = { pay: 'payBill', payMethod: 'payBill', payReview: 'payBill', bill: 'viewBill', login: 'signIn', loginPassword: 'signIn', logout: 'signOut', guest: 'guestPay', guestPay: 'guestPay' };
export const labelKey = key => PAGE_KEY[key] || key;
// The fallback is the template's own literal: returned so that it renders byte-for-byte as before (& < > " escaped,
// apostrophes kept), while dossier labels are fully escaped by the html tag.
export function L(vm, key, fallback) {
  const v = vm?.labels?.[labelKey(key)];
  if (typeof v === 'string' && v) return v;
  return typeof fallback === 'string' ? new Raw(fallback.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')) : fallback;
}
// Feature names inside sentences: dossier labels are often menu names ("Auto Pay Settings", "Paperless Options"),
// so "Set up <label>" / "<label> is on" would read "Set up Auto Pay Settings". labelNoun drops a trailing
// settings-style word; setUpLabel adds "Set up" only when the label does not already start with a verb.
const SETTINGS_TAIL = /\s+(?:settings|preferences|options|program|management|enrollment|information|info)$/i;
const VERB_HEAD = /^(?:set ?up|enroll|sign up|manage|turn on|start|activate|schedule|add|edit|change|update)\b/i;
export function labelNoun(label) { const r = label instanceof Raw; const s = String(label ?? ''); const t = s.replace(SETTINGS_TAIL, '') || s; return r ? new Raw(t) : t; }
export function setUpLabel(label) { const r = label instanceof Raw; const s = String(label ?? ''); const t = VERB_HEAD.test(s) ? s : `Set up ${labelNoun(s)}`; return r ? new Raw(t) : t; }
// Ordered navigation for an area ('public' | 'account'): the dossier's nav when present, else `defaults`
// ([page, label] or [page, label, params] tuples). Dossier items come first in their order; default pages the
// dossier leaves out follow, so no flow loses its visible link. Items are [page, label, params].
export function navList(vm, area, defaults = []) {
  const d = vm?.nav?.[area];
  const norm = defaults.filter(Boolean).map(([p, l, params]) => [p, L(vm, p, l), params]);
  if (!Array.isArray(d) || !d.length) return norm;
  const out = d.filter(i => i.page ? vm.has(i.page) : true).map(i => i.page ? [i.page, i.label, undefined] : ['helpArticle', i.label, { slug: i.helpSlug }]);
  const seen = new Set(out.map(([p, , q]) => p === 'helpArticle' ? `h:${q.slug}` : p));
  for (const [p, l, params] of norm) if (!seen.has(p === 'helpArticle' ? `h:${params?.slug}` : p)) out.push([p, l, params]);
  return out;
}
export const hasDossierNav = (vm, area) => Array.isArray(vm?.nav?.[area]) && vm.nav[area].length > 0;
// Links for navList items (helpArticle items whose article does not exist fall back to the help home).
export const navHref = (vm, [page, , params]) => page === 'helpArticle' ? (vm.help?.some(a => a.slug === params?.slug) ? vm.url('helpArticle', params) : vm.url('help')) : vm.url(page, params || {});
// The dossier's navigation bar for an area. Dossier items come first, in order; canonical pages the dossier leaves
// out (that this template routes and this biller supports) follow under "More", so no flow loses its visible link.
const AREA_DEFAULTS = {
  public: [['home', 'Home'], ['login', 'Sign in'], ['register', 'Register'], ['guest', 'Pay as guest', 'guest_pay'], ['help', 'Help']],
  account: [['dashboard', 'Account home'], ['bill', 'View bill'], ['pay', 'Pay bill', 'pay_online'], ['statements', 'Statements'], ['history', 'Payment history'], ['autopay', 'AutoPay', 'autopay'], ['paperless', 'Paperless billing', 'paperless'], ['wallet', 'Payment methods'], ['plan', 'Plan'], ['arrangement', 'Payment arrangement', 'payment_arrangement'], ['cancel', 'Stop service', 'cancel_service'], ['contact', 'Messages'], ['profile', 'Profile'], ['help', 'Help']]
};
const DNAV_CSS = '.bwf-dnav{display:flex;flex-wrap:wrap;align-items:center;gap:4px 14px;padding:8px 16px;position:relative;min-width:0}.bwf-dnav a,.bwf-dnav summary{text-transform:none;letter-spacing:normal}.bwf-dnav a{color:var(--brand);font-weight:600;text-decoration:none;padding:4px 2px;overflow-wrap:anywhere}.bwf-dnav a[aria-current]{text-decoration:underline}.bwf-dnav a:hover{text-decoration:underline}.bwf-dnav a:focus-visible,.bwf-dnav summary:focus-visible{outline:2px solid var(--brand);outline-offset:2px}.bwf-dnav details{position:relative}.bwf-dnav summary{cursor:pointer;color:var(--brand);font-weight:600;padding:4px 2px}.bwf-dnav details[open]>div{position:absolute;z-index:20;background:#fff;border:1px solid #d9dee4;border-radius:6px;padding:6px 10px;display:flex;flex-direction:column;min-width:200px;box-shadow:0 4px 14px rgba(0,0,0,.12)}.bwf-dark .bwf-dnav a,.bwf-dark .bwf-dnav summary{color:#fff}.bwf-dark .bwf-dnav details[open]>div a{color:var(--brand)}@media(max-width:600px){.bwf-dnav details[open]>div{position:static;box-shadow:none;min-width:0}}';
export function dossierNavInner(vm, area) {
  if (!hasDossierNav(vm, area)) return raw('');
  const capOk = c => !c || vm.biller.capabilities?.[c]?.support === 'supported' || (c === 'autopay' && vm.biller.capabilities?.autopay_cancel?.support === 'supported');
  const items = navList(vm, area, []);
  const seen = new Set(items.map(i => i[0]));
  const more = AREA_DEFAULTS[area].filter(([p, , c]) => !seen.has(p) && vm.has(p) && capOk(c) && !(p === 'plan' && !vm.plans?.length) && !(p === 'register' && vm.biller.capabilities?.registration?.support === 'unsupported')).map(([p, l]) => [p, L(vm, p, l)]);
  const cur = p => vm.page === p || (p === 'pay' && ['payMethod', 'payReview', 'payReceipt'].includes(vm.page)) ? raw(' aria-current="page"') : '';
  return html`<style nonce="${vm.nonce}">${raw(DNAV_CSS)}</style><div class="bwf-dnav">${items.map(i => html`<a href="${navHref(vm, i)}"${cur(i[0])}>${i[1]}</a>`)}${more.length ? html`<details><summary>More</summary><div>${more.map(i => html`<a href="${navHref(vm, i)}"${cur(i[0])}>${i[1]}</a>`)}</div></details>` : ''}</div>`;
}
export const dossierNavBar = (vm, area, { label = area === 'account' ? 'My account' : 'Main' } = {}) => hasDossierNav(vm, area) ? html`<nav class="bwf-dnav-bar" aria-label="${label}" data-dossier-nav="${area}"><style nonce="${vm.nonce}">.bwf-dnav-bar{background:#fff;border-bottom:1px solid #d9dee4}</style>${dossierNavInner(vm, area)}</nav>` : raw('');
// Template hook: the dossier nav bar for `area` when the dossier defines one, else the template's own nav.
export const DN = (vm, area, fallback) => hasDossierNav(vm, area) ? dossierNavBar(vm, area) : (typeof fallback === 'function' ? fallback() : fallback);
// Notes for capabilities the dossier marks unsupported online (e.g. "Stop service by calling ..."). `keys` limits
// which capabilities to show; data-capnotes marks the block so the server never injects a second copy.
// Home and account overview (compact: true): one small "Ways to manage your account" notice, each item linking to the
// help article that explains it (or the help center), the same on every template.
const CAPNOTE_CSS = '.bwf-capnotes{border:1px solid #c9d3dd;border-left:4px solid var(--brand);background:#f6f8fa;border-radius:6px;padding:10px 14px;margin:0 0 16px;color:#1f2a36}.bwf-capnotes p{margin:4px 0}.bwf-capnotes.bwf-compact{font-size:14px;line-height:1.4;padding:8px 12px}.bwf-capnotes.bwf-compact h2{font-size:15px;margin:0 0 4px;color:#1f2a36}.bwf-capnotes.bwf-compact ul{margin:0;padding:0 0 0 18px}.bwf-capnotes.bwf-compact li{margin:2px 0}.bwf-capnotes.bwf-compact a{color:var(--brand);font-weight:600;white-space:nowrap}.bwf-capnotes .sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}@media(max-width:600px){.bwf-capnotes{max-height:38vh;overflow:auto}}';
export const capNoteHelpHref = (vm, n) => { const a = (vm?.help || []).find(x => (x.paragraphs || []).includes(n.note)); return a ? vm.url('helpArticle', { slug: a.slug }) : vm.url('help'); };
export function capabilityNotes(vm, keys = null, { compact = false } = {}) {
  const notes = (vm?.capabilityNotes || []).filter(n => !keys || keys.includes(n.capability));
  if (!notes.length) return raw('');
  if (compact) return html`<aside class="bwf-capnotes bwf-compact" role="note" aria-labelledby="bwf-capnotes-h" data-capnotes="1"><style nonce="${vm.nonce}">${raw(CAPNOTE_CSS)}</style><h2 id="bwf-capnotes-h">Ways to manage your account</h2><ul>${notes.map(n => html`<li data-capability="${n.capability}"><strong>${n.title}:</strong> ${n.note} <a href="${capNoteHelpHref(vm, n)}">Learn more<span class="sr-only"> about ${String(n.title).toLowerCase()}</span></a></li>`)}</ul></aside>`;
  return html`<aside class="bwf-capnotes" role="note" data-capnotes="1"><style nonce="${vm.nonce}">${raw(CAPNOTE_CSS)}</style>${notes.map(n => html`<p data-capability="${n.capability}"><strong>${n.title}:</strong> ${n.note}</p>`)}</aside>`;
}
