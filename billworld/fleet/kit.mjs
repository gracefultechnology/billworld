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
export const field = (vm, { name, label, type = 'text', autocomplete, required = true, placeholder, help, value, cls = 'field', inputmode, maxlength }) => html`<div class="${cls}"><label for="f-${name}">${label}</label><input id="f-${name}" name="${name}" type="${type}"${autocomplete ? raw(` autocomplete="${esc(autocomplete)}"`) : ''}${required ? raw(' required') : ''}${placeholder ? raw(` placeholder="${esc(placeholder)}"`) : ''}${inputmode ? raw(` inputmode="${esc(inputmode)}"`) : ''}${maxlength ? raw(` maxlength="${maxlength}"`) : ''} value="${value ?? (type === 'password' ? '' : vm.values[name] ?? '')}">${help ? html`<small class="help">${help}</small>` : ''}</div>`;
export const select = (vm, { name, label, options, value, cls = 'field' }) => html`<div class="${cls}"><label for="f-${name}">${label}</label><select id="f-${name}" name="${name}">${options.map(([v, t]) => html`<option value="${v}"${String(value ?? vm.values[name] ?? '') === String(v) ? raw(' selected') : ''}>${t}</option>`)}</select></div>`;
export const checkbox = (vm, { name, label, value = 'on', checked, required }) => html`<label class="check"><input type="checkbox" name="${name}" value="${value}"${checked ?? vm.values[name] ? raw(' checked') : ''}${required ? raw(' required') : ''}> <span>${label}</span></label>`;
export const radio = (vm, { name, value, label, checked, extra = '' }) => html`<label class="radio"><input type="radio" name="${name}" value="${value}"${checked ? raw(' checked') : ''}> <span>${label}</span>${extra}</label>`;
export const button = (label, { cls = 'btn btn-primary', name, value } = {}) => html`<button type="submit" class="${cls}"${name ? raw(` name="${esc(name)}" value="${esc(value)}"`) : ''}>${label}</button>`;

// Amount choices: radio list with an "other amount" input (name=amountChoice, amount).
export function amountChooser(vm, { labels = {} } = {}) {
  const sel = vm.values.amountChoice || vm.draft?.amountKey || 'due';
  return html`<fieldset class="amounts"><legend>${labels.legend || 'Payment amount'}</legend>${vm.amountOptions.map(o => radio(vm, { name: 'amountChoice', value: o.key, checked: sel === o.key, label: labels[o.key] || o.label, extra: o.cents != null ? html` <strong class="amt">${money(o.cents)}</strong>` : html` <input class="other-amount" name="amount" inputmode="decimal" aria-label="Other amount" placeholder="0.00" value="${vm.values.amount ?? (vm.draft?.amountKey === 'other' ? (vm.draft.amountCents / 100).toFixed(2) : '')}">` }))}</fieldset>`;
}
const methodText = m => `${m.type === 'bank' ? `${m.label} account` : m.brand} ending in ${m.last4}${m.expired ? ' (expired)' : ''}`;
export { methodText };
// Saved methods (name=methodId) plus "new bank" / "new card" fields (methodType + details).
export function methodChooser(vm, { allowNew = true, title = 'Payment method', allowCard = true, allowBank = true } = {}) {
  const methods = vm.methods.filter(m => (allowCard || m.type !== 'card') && (allowBank || m.type !== 'bank'));
  const sel = vm.values.methodId || vm.draft?.methodId || methods.find(m => !m.expired)?.id || '';
  return html`<fieldset class="methods"><legend>${title}</legend>${methods.map(m => radio(vm, { name: 'methodId', value: m.id, checked: sel === m.id, label: methodText(m) }))}${allowNew ? html`<details class="new-method"${!methods.length ? raw(' open') : ''}><summary>Use a new payment method</summary>${newMethodFields(vm, { allowCard, allowBank })}</details>` : ''}</fieldset>`;
}
export const newMethodFields = (vm, { allowCard = true, allowBank = true } = {}) => html`${select(vm, { name: 'methodType', label: 'Method type', options: [['', 'Select…'], ...(allowBank ? [['bank', 'Bank account (checking/savings)']] : []), ...(allowCard ? [['card', 'Debit or credit card']] : [])] })}
${allowBank ? html`<div class="bank-fields">${select(vm, { name: 'accountType', label: 'Account type', options: [['checking', 'Checking'], ['savings', 'Savings']] })}${field(vm, { name: 'routing', label: 'Routing number', required: false, inputmode: 'numeric', maxlength: 9 })}${field(vm, { name: 'bankAccount', label: 'Account number', required: false, inputmode: 'numeric' })}${field(vm, { name: 'bankAccountConfirm', label: 'Confirm account number', required: false, inputmode: 'numeric' })}</div>` : ''}
${allowCard ? html`<div class="card-fields">${field(vm, { name: 'cardNumber', label: 'Card number', required: false, autocomplete: 'cc-number', inputmode: 'numeric' })}${field(vm, { name: 'exp', label: 'Expiration (MM/YY)', required: false, autocomplete: 'cc-exp', placeholder: 'MM/YY' })}${field(vm, { name: 'cvv', label: 'Security code', required: false, autocomplete: 'cc-csc', inputmode: 'numeric', maxlength: 4 })}${field(vm, { name: 'holder', label: 'Name on card', required: false, autocomplete: 'cc-name' })}</div>` : ''}${checkbox(vm, { name: 'save', label: 'Save this method for future payments' })}`;
export const dateField = (vm, { name = 'payOn', label = 'Payment date' } = {}) => html`<div class="field"><label for="f-${name}">${label}</label><input id="f-${name}" type="date" name="${name}" min="${vm.today}" value="${vm.values[name] || vm.draft?.payOn || vm.today}"></div>`;

// A small, accessible table helper.
export const table = (headers, rows, cls = 'table') => html`<table class="${cls}"><thead><tr>${headers.map(h => html`<th scope="col">${h}</th>`)}</tr></thead><tbody>${rows.length ? rows.map(r => html`<tr>${r.map(c => html`<td>${c}</td>`)}</tr>`) : html`<tr><td colspan="${headers.length}" class="empty">No records found.</td></tr>`}</tbody></table>`;
export const statusLabel = s => ({ scheduled: 'Scheduled', processing: 'Processing', pending: 'Pending', posted: 'Posted', cancelled: 'Cancelled', failed: 'Failed' }[s] || s);
export const paymentRows = (vm, { cancel = true } = {}) => vm.account.payments.slice().reverse().map(p => [p.payOn ? p.payOn : fmtDate(p.createdAt), money(p.amountCents), `${p.methodType === 'bank' ? 'Bank' : 'Card'} ****${p.methodLast4}`, p.confirmation, statusLabel(p.status), p.status === 'scheduled' && cancel ? form(vm, 'history', html`${hidden('paymentId', p.id)}${button('Cancel payment', { cls: 'btn btn-link', name: 'op', value: 'cancel' })}`) : '']);

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
