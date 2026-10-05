// Template-local helpers shared by the paymentus, kubra and doxo templates (processor / aggregator families).
// Only wording and markup live here; all state changes go through the standard form field names.
import { html, raw, form, field, select, checkbox, button, hidden, dateField, money, fmtDate } from '../kit.mjs';

export const isOffline = vm => vm.biller.capabilities.online_account.support === 'unsupported';
export const guestOn = vm => vm.biller.capabilities.guest_pay.support !== 'unsupported';
export const can = (vm, cap) => vm.biller.capabilities[cap]?.support === 'supported';

// Fee estimates mirror engine.fee() so the disclosure shown before review matches what is charged.
export function cardFee(vm, cents) {
  const f = vm.biller.fees, kind = vm.biller.kind;
  if (f.cardPercent != null) return Math.round(cents * f.cardPercent / 100);
  if (f.cardCents != null) return f.cardCents;
  return ['tax', 'government', 'medical'].includes(kind) ? Math.max(195, Math.round(cents * 0.0235)) : kind === 'utility' ? 295 : 0;
}
export const bankFee = vm => vm.biller.fees.bankCents ?? 0;
export function feeText(vm, type, cents = vm.balanceCents || 0) {
  const f = vm.biller.fees;
  if (type === 'bank') { const b = bankFee(vm); return b ? money(b) : 'No fee'; }
  if (f.cardPercent != null) return `${f.cardPercent}% of the payment amount${cents ? ` (${money(cardFee(vm, cents))} on ${money(cents)})` : ''}`;
  const c = cardFee(vm, cents); return c ? money(c) : 'No fee';
}

// Bank / card detail groups shown by a radio tile choice (methodType). CSS :has() reveals the matching group;
// without CSS support both groups simply stay visible.
export function methodTiles(vm, { save = true, labels = {}, hLevel = 3 } = {}) {
  const H = t => hLevel === 2 ? html`<h2 class="h3">${t}</h2>` : html`<h3>${t}</h3>`;
  const t = vm.values.methodType || '';
  const tile = (value, title, sub) => html`<label class="tile"><input type="radio" name="methodType" value="${value}"${t === value ? raw(' checked') : ''}> <span class="tile-t">${title}</span><small>${sub}</small></label>`;
  return html`<div class="tiles" role="radiogroup" aria-label="${labels.group || 'Payment type'}">${tile('card', labels.card || 'Credit / Debit Card', `Fee: ${feeText(vm, 'card')}`)}${tile('bank', labels.bank || 'eCheck / Bank Account', `Fee: ${feeText(vm, 'bank')}`)}</div>
<div class="pm-fields"><div class="card-fields">${H(labels.cardHead || 'Card information')}${field(vm, { name: 'holder', label: 'Name on card', required: false, autocomplete: 'cc-name' })}${field(vm, { name: 'cardNumber', label: 'Card number', required: false, autocomplete: 'cc-number', inputmode: 'numeric' })}<div class="row2">${field(vm, { name: 'exp', label: 'Expiration date (MM/YY)', required: false, autocomplete: 'cc-exp', placeholder: 'MM/YY' })}${field(vm, { name: 'cvv', label: 'CVV', required: false, autocomplete: 'cc-csc', inputmode: 'numeric', maxlength: 4 })}</div></div>
<div class="bank-fields">${H(labels.bankHead || 'Bank account information')}${select(vm, { name: 'accountType', label: 'Account type', options: [['checking', 'Checking'], ['savings', 'Savings']] })}${field(vm, { name: 'routing', label: 'Routing number', required: false, inputmode: 'numeric', maxlength: 9 })}${field(vm, { name: 'bankAccount', label: 'Bank account number', required: false, inputmode: 'numeric' })}${field(vm, { name: 'bankAccountConfirm', label: 'Re-enter bank account number', required: false, inputmode: 'numeric' })}</div></div>${save ? checkbox(vm, { name: 'save', label: labels.save || 'Save this payment method to my wallet' }) : ''}`;
}

// Cancellation / stop-service wizard (step names are the engine contract: reason → offer → confirm → done|kept).
export function cancelBody(vm, { h1, wordsFor = {} } = {}) {
  const kind = vm.biller.kind, noun = kind === 'subscription' ? 'membership' : kind === 'utility' ? 'service' : 'account';
  const H = t => h1 ? h1(t) : html`<h1>${t}</h1>`;
  if (vm.service.status !== 'active' && vm.step !== 'done') return html`${H(wordsFor.statusTitle || 'Service status')}<p>Your ${noun} ${vm.service.status === 'cancel_pending' ? `is scheduled to end on ${fmtDate(vm.service.cancelAt)}` : 'is cancelled'}.</p>${vm.service.status === 'cancel_pending' ? form(vm, 'cancel', html`${hidden('step', 'undo')}${button(`Keep my ${noun}`)}`) : ''}`;
  const steps = {
    reason: html`${H(wordsFor.title || (kind === 'utility' ? 'Stop service request' : `Cancel your ${noun}`))}<p class="muted">Step 1 of 2 · Tell us why</p>${form(vm, 'cancel', html`${hidden('step', 'reason')}${select(vm, { name: 'reason', label: 'Reason for request', options: [['', 'Select a reason'], ['moving', 'Moving out of the service area'], ['cost', 'Too expensive'], ['not_using', 'No longer needed'], ['switching', 'Switching providers'], ['other', 'Other']] })}${button('Continue')}`)}`,
    offer: html`${H('Before you go')}<div class="card offer"><h2>Stay and get 50% off for 3 months</h2><p>Keep your ${noun} at half price for your next three bills.</p>${form(vm, 'cancel', html`${hidden('step', 'offer')}${button('Accept offer', { name: 'accept', value: 'yes' })} ${button('No thanks, continue', { cls: 'btn btn-secondary', name: 'accept', value: 'no' })}`)}</div>`,
    confirm: html`${H('Confirm your request')}<p class="muted">Step 2 of 2 · Confirm</p><p>${kind === 'subscription' ? `Your ${noun} will end on ${vm.dueText}, the end of your billing period.` : 'Choose the date service should end. A final bill will be sent to you.'}</p>${form(vm, 'cancel', html`${hidden('step', 'confirm')}${kind !== 'subscription' ? dateField(vm, { name: 'effectiveDate', label: 'Stop date' }) : ''}${checkbox(vm, { name: 'confirm', label: `Yes, end my ${noun}.` })}${button(wordsFor.submit || `Submit request`, { cls: 'btn btn-danger' })}`)}`,
    done: html`${H('Request received')}<p>Your ${noun} will end on <strong>${vm.service.cancelAt ? fmtDate(vm.service.cancelAt) : ''}</strong>. Confirmation number <strong>${vm.service.confirmation || ''}</strong>.</p>`,
    kept: html`${H('Thanks for staying')}<p>Your discount has been applied.</p>`
  };
  return steps[vm.step] || steps.reason;
}

export const planBody = vm => vm.plans.length ? form(vm, 'plan', html`<fieldset><legend>Choose a plan</legend>${vm.plans.map(p => html`<label class="radio"><input type="radio" name="planId" value="${p.id}"${p.current ? raw(' checked') : ''}> ${p.name}${p.cents ? ` – ${money(p.cents)}/mo` : ''}${p.current ? ' (current)' : ''}</label>`)}</fieldset>${button('Change plan')}`) : html`<p>Plan changes are not available online for this account.</p>`;
export const arrangementBody = vm => vm.account.arrangement ? html`<p>You're paying ${money(vm.account.arrangement.monthlyCents)} per month for ${vm.account.arrangement.months} months.</p>` : form(vm, 'arrangement', html`<p>Spread your balance of <strong>${money(vm.balanceCents)}</strong> over monthly installments.</p>${select(vm, { name: 'months', label: 'Number of installments', options: [['3', '3 months'], ['6', '6 months'], ['12', '12 months']] })}${button('Request arrangement')}`);
export const contactBody = (vm, { send = 'Send message' } = {}) => html`${vm.account.messages.length ? html`<ul class="msgs">${vm.account.messages.map(m => html`<li>${fmtDate(m.at)} – ${m.subject} <span class="pill">${m.status}</span></li>`)}</ul>` : ''}${form(vm, 'contact', html`${field(vm, { name: 'subject', label: 'Subject' })}<div class="field"><label for="f-message">Message</label><textarea id="f-message" name="message" rows="5" required>${vm.values.message || ''}</textarea></div>${button(send)}`)}`;
