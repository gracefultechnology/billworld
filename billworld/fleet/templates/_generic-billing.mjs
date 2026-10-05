// Template-local billing helpers shared by the smarthub, invoicecloud, xpress, paymentus, kubra, doxo and generic
// templates. They only read the view model; wording and markup stay template-owned (each caller picks labels/classes).
//  - balanceBreakdown(): statement total vs. past-due, posted, pending and the real account balance (vm.balanceCents)
//  - payNotice(): warns on pay pages when a scheduled payment, processing payment or AutoPay already covers the bill
//  - fmtPayOn()/payDate()/payRows(): scheduled-payment dates formatted like every other date
//  - scrollTable(): wraps a kit table in a keyboard-scrollable region so wide tables never widen the page on phones
import { html, table, paymentRows, money, fmtDate } from '../kit.mjs';

const DAY = 86400000;
export const fmtPayOn = iso => iso ? fmtDate(Date.parse(`${iso}T17:00:00Z`)) : '';
export const payDate = p => p.payOn ? fmtPayOn(p.payOn) : fmtDate(p.createdAt);
// kit.paymentRows with the date column formatted (rows come back in the same order as payments.slice().reverse()).
export function payRows(vm, opts) {
  const ps = vm.account.payments.slice().reverse();
  return paymentRows(vm, opts).map((r, i) => [payDate(ps[i]), ...r.slice(1)]);
}
export const scrollTable = (label, headers, rows, cls) => html`<div class="table-scroll" role="region" tabindex="0" aria-label="${label}">${table(headers, rows, cls)}</div>`;
export const scrollWrap = (label, inner) => html`<div class="table-scroll" role="region" tabindex="0" aria-label="${label}">${inner}</div>`;

// The current invoice's total is not the balance: earlier unpaid bills, posted and in-flight payments change it.
export function balanceBreakdown(vm) {
  const inv = vm.invoice;
  const pastDueCents = vm.invoices.filter(i => i.id !== inv.id).reduce((a, i) => a + Math.max(0, i.balanceCents), 0);
  const postedCents = Math.max(0, inv.amountCents - inv.balanceCents);
  const pendingCents = vm.pendingPayments.reduce((a, p) => a + p.amountCents, 0);
  const scheduledCents = vm.scheduled.reduce((a, p) => a + p.amountCents, 0);
  return { statementCents: inv.amountCents, pastDueCents, postedCents, pendingCents, scheduledCents, balanceCents: vm.balanceCents };
}
// [label, amount-text] rows: statement total, then adjustments, ending with the balance. Labels are overridable.
export function balanceRows(vm, labels = {}) {
  const b = balanceBreakdown(vm);
  const L = { statement: 'Current statement total', pastDue: 'Previous balance (past due)', posted: 'Payments received', pending: 'Payments processing', balance: 'Account balance', ...labels };
  return [
    [L.statement, money(b.statementCents)],
    ...(b.pastDueCents ? [[L.pastDue, money(b.pastDueCents)]] : []),
    ...(b.postedCents ? [[L.posted, `-${money(b.postedCents)}`]] : []),
    ...(b.pendingCents ? [[L.pending, `-${money(b.pendingCents)}`]] : []),
    [L.balance, money(b.balanceCents)]
  ];
}
// AutoPay timing mirrors engine.advance(): it pays the open invoice from 3 days before the due date, and only for
// invoices issued after the (first) enrollment.
export function autopayPlan(vm) {
  const ap = vm.autopay, inv = vm.invoice;
  if (!ap?.enrolled) return null;
  const enrolledAt = ap.history?.find(h => h.action === 'enrolled')?.at ?? 0;
  if (inv.autopaid || inv.balanceCents <= 0) return { covered: false, next: true };
  if (enrolledAt >= inv.issuedAt) return { covered: false, next: true };
  const cents = ap.policy === 'fixed' ? ap.fixedCents : ap.policy === 'minimum' ? vm.account.minimumDueCents : Math.max(0, vm.balanceCents);
  return { covered: true, cents, at: Math.max(vm.now, inv.dueAt - 3 * DAY) };
}
// Notice for the first pay step. Returns '' when nothing is already arranged. cls lets each template style it.
export function payNotice(vm, { cls = 'pay-notice', autopayName = 'AutoPay' } = {}) {
  if (!vm.account) return '';
  const items = [];
  for (const p of vm.scheduled) items.push(`You have a payment of ${money(p.amountCents)} scheduled for ${fmtPayOn(p.payOn)} (confirmation ${p.confirmation}).`);
  for (const p of vm.pendingPayments) items.push(`A payment of ${money(p.amountCents)} made ${fmtDate(p.createdAt)} is processing and is already subtracted from the amount due.`);
  const ap = autopayPlan(vm);
  if (ap?.covered && ap.cents > 0) items.push(`${autopayName} is on and will pay ${money(ap.cents)} on or about ${fmtDate(ap.at)}.`);
  else if (ap) items.push(`${autopayName} is on and will start with your next bill.`);
  if (!items.length) return '';
  const arranged = vm.scheduled.reduce((a, p) => a + p.amountCents, 0) + (ap?.covered ? ap.cents || 0 : 0);
  const warn = arranged > 0 && arranged >= vm.balanceCents ? 'Paying now as well may result in a duplicate payment.' : '';
  return html`<div class="${cls}" role="note"><strong>Before you pay</strong><ul>${items.map(t => html`<li>${t}</li>`)}</ul>${warn ? html`<p>${warn}</p>` : ''}</div>`;
}

// Shared CSS for the helpers above; templates append it to their own stylesheet and may override colours.
export const billingCss = `.table-scroll{max-width:100%;overflow-x:auto;contain:inline-size;-webkit-overflow-scrolling:touch;margin:0 0 12px}.table-scroll>table{margin-bottom:0}.table-scroll:focus-visible{outline:2px solid var(--brand);outline-offset:2px}
.pay-notice{border:1px solid #e8c46a;background:#fff8e1;color:#3d3000;border-radius:4px;padding:10px 14px;margin:0 0 14px;font-size:14px}.pay-notice ul{margin:6px 0 0;padding-left:18px}.pay-notice li{margin:2px 0}.pay-notice p{margin:6px 0 0;font-weight:600}
.bal-table{width:100%;border-collapse:collapse;margin:10px 0}.bal-table th,.bal-table td{text-align:left;padding:6px 8px;border-bottom:1px solid #e6e9ec;font-weight:400}.bal-table td{text-align:right;white-space:nowrap}.bal-table tr:last-child th,.bal-table tr:last-child td{font-weight:700;border-top:2px solid #555;border-bottom:0}
img,svg,video{max-width:100%}`;
// Balance summary as a two-column table with row headers (screen readers announce label + amount).
export const balanceTable = (vm, labels, caption = 'Account balance summary') => html`<table class="bal-table"><caption class="sr-only">${caption}</caption><tbody>${balanceRows(vm, labels).map(([l, v]) => html`<tr><th scope="row">${l}</th><td>${v}</td></tr>`)}</tbody></table>`;
