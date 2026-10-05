// Shared government-portal pieces used by municipal-portal, property-tax and income-tax.
// Only content builders live here (field names follow the kit contract); every page shell, label
// and layout stays in the individual template.
import { html, raw, form, field, select, checkbox, button, hidden, money, fmtDate, methodText, radio } from '../kit.mjs';

export const offline = vm => vm.biller.capabilities.online_account.support === 'unsupported';
export const sup = (vm, k) => vm.biller.capabilities[k]?.support === 'supported';
export const isTax = vm => vm.biller.kind === 'tax';

// Mirrors engine.fee(): documented fees from research notes first, else the synthetic default for the kind.
export function cardFeeText(vm) {
  const f = vm.biller.fees, kind = vm.biller.kind;
  if (f.cardPercent != null) return `${f.cardPercent}% service fee`;
  if (f.cardCents) return `${money(f.cardCents)} service fee`;
  if (f.cardCents === 0) return 'no service fee';
  if (['tax', 'government', 'medical'].includes(kind)) return '2.35% service fee (minimum $1.95)';
  if (kind === 'utility') return '$2.95 convenience fee';
  return 'no service fee';
}
export const bankFeeText = vm => vm.biller.fees.bankCents ? `${money(vm.biller.fees.bankCents)} fee` : 'no fee';

// New-method fields with family-specific labels but the standard names (methodType, routing, bankAccount…).
// CSS (:has) can show only the bank or card block once a type is chosen; without CSS support all show.
export function methodFields(vm, { bankLabel = 'Bank account (e-check)', cardLabel = 'Credit or debit card', typeLabel = 'Payment type', save = true, cardNameLabel = 'Name on card', allowCard = true } = {}) {
  return html`<div class="pm-new">${select(vm, { name: 'methodType', label: typeLabel, options: [['', 'Select…'], ['bank', bankLabel], ...(allowCard ? [['card', cardLabel]] : [])] })}
<div class="bank-fields">${select(vm, { name: 'accountType', label: 'Account type', options: [['checking', 'Checking'], ['savings', 'Savings']] })}${field(vm, { name: 'routing', label: 'Routing number', required: false, inputmode: 'numeric', maxlength: 9, help: '9 digits, bottom left of your check' })}${field(vm, { name: 'bankAccount', label: 'Account number', required: false, inputmode: 'numeric' })}${field(vm, { name: 'bankAccountConfirm', label: 'Re-enter account number', required: false, inputmode: 'numeric' })}</div>
${allowCard ? html`<div class="card-fields">${field(vm, { name: 'cardNumber', label: 'Card number', required: false, autocomplete: 'cc-number', inputmode: 'numeric' })}<div class="row2">${field(vm, { name: 'exp', label: 'Expiration (MM/YY)', required: false, autocomplete: 'cc-exp', placeholder: 'MM/YY' })}${field(vm, { name: 'cvv', label: 'CVV', required: false, autocomplete: 'cc-csc', inputmode: 'numeric', maxlength: 4 })}</div>${field(vm, { name: 'holder', label: cardNameLabel, required: false, autocomplete: 'cc-name' })}</div>` : ''}
${save ? checkbox(vm, { name: 'save', label: 'Save this payment method to my wallet' }) : ''}</div>`;
}

// Saved methods + "add new" disclosure.
export function savedMethods(vm, { legend = 'Payment method', newLabel = 'Use a new payment method', fields = {} } = {}) {
  const sel = vm.values.methodId || vm.draft?.methodId || vm.methods.find(m => !m.expired)?.id || '';
  return html`<fieldset class="methods"><legend>${legend}</legend>${vm.methods.map(m => radio(vm, { name: 'methodId', value: m.id, checked: sel === m.id, label: methodText(m), extra: html` <span class="fee-tag">${m.type === 'bank' ? bankFeeText(vm) : cardFeeText(vm)}</span>` }))}<details class="new-method"${!vm.methods.length ? raw(' open') : ''}><summary>${newLabel}</summary>${methodFields(vm, fields)}</details></fieldset>`;
}

export function amountRadios(vm, labels = {}, legend = 'Payment amount') {
  const sel = vm.values.amountChoice || vm.draft?.amountKey || 'due';
  return html`<fieldset class="amounts"><legend>${legend}</legend>${vm.amountOptions.map(o => radio(vm, { name: 'amountChoice', value: o.key, checked: sel === o.key, label: labels[o.key] || o.label, extra: o.cents != null ? html` <strong class="amt">${money(o.cents)}</strong>` : html` <input class="other-amount" name="amount" inputmode="decimal" aria-label="Other amount" placeholder="0.00" value="${vm.values.amount ?? (vm.draft?.amountKey === 'other' ? (vm.draft.amountCents / 100).toFixed(2) : '')}">` }))}</fieldset>`;
}

export function reviewRows(vm, { amountLabel = 'Payment amount', feeLabel = 'Service fee', totalLabel = 'Total', methodLabel = 'Payment method', dateLabel = 'Payment date', extra = [] } = {}) {
  const d = vm.draft;
  return html`<dl class="review">${extra.map(([k, v]) => html`<dt>${k}</dt><dd>${v}</dd>`)}<dt>${amountLabel}</dt><dd>${money(d.amountCents)}</dd><dt>${feeLabel}</dt><dd>${money(d.feeCents || 0)}</dd><dt>${totalLabel}</dt><dd><strong>${money(d.totalCents)}</strong></dd><dt>${methodLabel}</dt><dd>${d.method ? methodText(d.method) : ''}</dd><dt>${dateLabel}</dt><dd>${d.payOn ? fmtDate(Date.parse(`${d.payOn}T17:00:00Z`)) : `Today, ${vm.nowText}`}</dd></dl>`;
}
export function reviewForm(vm, page, { terms, submit = 'Submit payment', edit = 'Edit payment' } = {}) {
  return html`${form(vm, page, html`${hidden('token', vm.draft.token)}${hidden('op', 'submit')}${checkbox(vm, { name: 'acceptTerms', label: terms })}<div class="actions">${button(submit)}</div>`)}${page === 'payReview' ? form(vm, page, html`${hidden('op', 'edit')}${button(edit, { cls: 'btn btn-link' })}`, { cls: 'edit-form' }) : ''}`;
}
export function receiptRows(vm, { extra = [] } = {}) {
  const p = vm.payment;
  return html`<dl class="review"><dt>Confirmation number</dt><dd><strong class="conf">${p.confirmation}</strong></dd>${extra.map(([k, v]) => html`<dt>${k}</dt><dd>${v}</dd>`)}<dt>Payment amount</dt><dd>${money(p.amountCents)}</dd>${p.feeCents ? html`<dt>Service fee</dt><dd>${money(p.feeCents)}</dd><dt>Total charged</dt><dd>${money(p.amountCents + p.feeCents)}</dd>` : ''}<dt>Paid with</dt><dd>${vm.paymentMethod ? methodText(vm.paymentMethod) : `****${p.methodLast4}`}</dd><dt>Payment date</dt><dd>${p.payOn ? fmtDate(Date.parse(`${p.payOn}T17:00:00Z`)) : fmtDate(p.createdAt)}</dd><dt>Status</dt><dd>${p.status === 'scheduled' ? 'Scheduled' : p.status === 'failed' ? 'Failed' : 'Processing'}</dd></dl><p class="muted">A receipt was emailed to the address on file.</p>`;
}

// Stop-service / close-account steps (reason → [offer] → confirm → done) with the standard names.
export function cancelBody(vm, { noun = 'service', title = 'Stop service', h = t => html`<h1>${t}</h1>`, reasons } = {}) {
  const kind = vm.biller.kind;
  if (vm.service.status !== 'active' && vm.step !== 'done') return html`${h('Service request')}<p>Your ${noun} ${vm.service.status === 'cancel_pending' ? `is scheduled to end on ${fmtDate(vm.service.cancelAt)}` : 'has ended'}.</p>${vm.service.status === 'cancel_pending' ? form(vm, 'cancel', html`${hidden('step', 'undo')}${button(`Keep my ${noun}`)}`) : ''}`;
  const steps = {
    reason: html`${h(title)}<p>Tell us why you are ending ${noun}. A final bill is mailed to your forwarding address.</p>${form(vm, 'cancel', html`${hidden('step', 'reason')}${select(vm, { name: 'reason', label: 'Reason', options: reasons || [['', 'Select a reason'], ['moving', 'Moving out of the service area'], ['selling', 'Selling the property'], ['landlord', 'Tenant moving out (landlord account)'], ['other', 'Other']] })}<div class="actions">${button('Continue')}</div>`)}`,
    offer: html`${h('Before you go')}<div class="card offer"><h2>Stay and save 50% for 3 months</h2><p>Keep your ${noun} at half price for your next three bills.</p>${form(vm, 'cancel', html`${hidden('step', 'offer')}${button('Accept offer', { name: 'accept', value: 'yes' })} ${button('No thanks, continue', { cls: 'btn', name: 'accept', value: 'no' })}`)}</div>`,
    confirm: html`${h('Confirm request')}<p>${kind === 'subscription' ? `Your ${noun} will end on ${vm.dueText}.` : 'Choose the date service should end. Meters are read on the stop date and a final bill is issued.'}</p>${form(vm, 'cancel', html`${hidden('step', 'confirm')}${kind !== 'subscription' ? html`<div class="field"><label for="f-effectiveDate">Stop date</label><input id="f-effectiveDate" type="date" name="effectiveDate" min="${vm.today}" value="${vm.values.effectiveDate || ''}"></div>` : ''}${checkbox(vm, { name: 'confirm', label: `I want to end ${noun} for this account.` })}<div class="actions">${button('Submit request', { cls: 'btn btn-danger' })}</div>`)}`,
    done: html`${h('Request received')}<p>Your ${noun} will end on <strong>${vm.service.cancelAt ? fmtDate(vm.service.cancelAt) : ''}</strong>. Confirmation number <strong>${vm.service.confirmation || ''}</strong>.</p>`,
    kept: html`${h('Thanks for staying')}<p>Your discount has been applied.</p>`
  };
  return steps[vm.step] || steps.reason;
}

export function autopayBody(vm, { h = t => html`<h1>${t}</h1>`, title = 'Autopay', intro, offLabel, methodsBlock, policyOptions } = {}) {
  const ap = vm.autopay;
  if (!sup(vm, 'autopay')) {
    // Enrollment is not offered online, but an existing enrollment (set up by phone or on paper) must still be
    // visible, and cancellable here when the office documents online cancellation.
    const current = ap.enrolled ? html`<div class="card status-on"><p><strong>Automatic payments are on.</strong> We pay the ${ap.policy === 'fixed' ? `fixed amount of ${money(ap.fixedCents)}` : 'full amount due'} ${ap.day ? `on day ${ap.day} of each month` : 'on each due date'} from ${vm.autopayMethod ? methodText(vm.autopayMethod) : 'your bank account on file'}.</p>${sup(vm, 'autopay_cancel') ? form(vm, 'autopay', html`${hidden('action', 'cancel')}${checkbox(vm, { name: 'confirm', label: 'I understand future bills will not be paid automatically.' })}${button('Turn off automatic payments', { cls: 'btn btn-danger' })}`) : html`<p>To stop or change automatic payments, contact the office${vm.biller.phone ? ` at ${vm.biller.phone}` : ''}.</p>`}</div>` : '';
    return html`${h(title)}${current}<p>${ap.enrolled ? 'New automatic payment enrollments are not taken online.' : (offLabel || 'Automatic payments are not offered online for this account.')} You can make a one-time payment or schedule a future-dated payment instead.</p><p><a class="btn btn-primary" href="${vm.url('pay')}">Make a payment</a></p>`;
  }
  return html`${h(title)}${ap.enrolled ? html`<div class="card status-on"><p><strong>Autopay is on.</strong> We pay the ${ap.policy === 'fixed' ? `fixed amount of ${money(ap.fixedCents)}` : 'full amount due'} ${ap.day ? `on day ${ap.day} of each month` : 'on each due date'} from ${vm.autopayMethod ? methodText(vm.autopayMethod) : 'your saved method'}.</p>${form(vm, 'autopay', html`${hidden('action', 'cancel')}${checkbox(vm, { name: 'confirm', label: 'I understand future bills will not be paid automatically.' })}${button('Turn off autopay', { cls: 'btn btn-danger' })}`)}</div><h2>Change autopay</h2>` : html`<p>${intro || 'Autopay is off. Enroll to pay automatically on each due date.'}</p>`}${form(vm, 'autopay', html`${hidden('action', 'enroll')}${methodsBlock || savedMethods(vm, { legend: 'Pay from' })}${select(vm, { name: 'policy', label: 'Amount to pay', options: policyOptions || [['full', 'Full amount due'], ['fixed', 'Fixed amount']] })}${field(vm, { name: 'fixedAmount', label: 'Fixed amount (if selected)', required: false, inputmode: 'decimal' })}${checkbox(vm, { name: 'acceptTerms', label: 'I authorize recurring electronic debits under the autopay terms and conditions.' })}<div class="actions">${button(ap.enrolled ? 'Save changes' : 'Enroll in autopay')}</div>`)}`;
}

// Stepper markup shared by wizards (labels supplied by the template).
export const stepper = (labels, current) => html`<ol class="stepper" aria-label="Progress">${labels.map((l, i) => html`<li class="${i < current ? 'done' : i === current ? 'current' : ''}"${i === current ? raw(' aria-current="step"') : ''}><span class="n">${i + 1}</span> ${l}</li>`)}</ol>`;
