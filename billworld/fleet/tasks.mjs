// Benchmark task generator: every biller gets the tasks its capability profile supports.
// Each task = natural-language intent + scenario seed + independent predicates (and expected answers).
// Predicates grade on durable facts: amounts are compared in cents against the balance at episode start, the payment
// method and source are pinned, unrequested changes fail the task, and reported answers are graded (the runner passes
// the agent's final answer to /evaluate or /finish as `answer`).
import { labelsFor } from './help.mjs';
import { formatPhone, AUTOPAY_BANK_ONLY } from './catalog.mjs';

// Evidence cohorts for scoring: report each separately. observed_public (research captures of the real site) is its own
// cohort next to documented_* (catalog research) and inferred_* (family/category); limitation = offline signals.
export function evidenceCohort(label) {
  if (/^documented/.test(label || '')) return 'documented';
  if (/^inferred/.test(label || '')) return 'inferred';
  if (/^observed/.test(label || '')) return 'observed';
  if (label === 'synthetic_flow') return 'synthetic';
  return 'limitation'; // unresearched_roster, no_public_website, consolidated_billing, informational, unknown
}
const supported = (b, cap) => b.capabilities[cap]?.support === 'supported';
const SAVED_CHECKING = { methodType: 'bank', methodId: 'pm-chk' };
const SAVED_VISA = { methodType: 'card', methodId: 'pm-card' };
const NEW_CHECKING = { methodType: 'bank', methodLast4: '6789', methodLabel: 'Checking' };
const GUEST_CARD = { methodType: 'card', methodLast4: '1111', source: 'guest' };
const noChanges = (allow = []) => ({ type: 'no_unrequested_changes', allow });
const noOtherPayments = { type: 'no_payment', scope: 'others' };

// The noun for "cancel your X" by kind and template.
function cancelWording(b) {
  switch (b.kind) {
    case 'subscription': return b.template === 'newspaper' ? 'newspaper subscription' : 'membership';
    case 'telecom': return 'service';
    case 'utility': return 'service (you are moving out)';
    case 'insurance': return 'policy';
    case 'toll': return 'toll account';
    case 'rent': return 'lease (give notice to vacate)';
    case 'card': return 'credit card account';
    default: return 'account';
  }
}

// opts.google: whether this host renders Sign in with Google for the biller (default: the observed google_login capability).
export function generateTasks(b, opts = {}) {
  const id = b.id, n = b.brand.shortName, tasks = [];
  const L = labelsFor(b);
  const add = (slug, intent, { scenario = {}, predicates, answer = null, tags = [], evidence }) => tasks.push({ id: `${id}:${slug}`, billerId: id, template: b.template, family: b.family, kind: b.kind, intent, scenario: { [id]: scenario }, predicates: [...predicates, noOtherPayments].map(p => ({ billerId: id, ...p })), answer, tags, evidence: evidence || b.capabilities.pay_online?.evidence, cohort: evidenceCohort(evidence || b.capabilities.pay_online?.evidence) });
  const contact = b.contact || {};
  if (b.template === 'offline') {
    if (b.signal === 'informational') {
      add('not-a-biller', `Find out how to pay your current ${n} bill. If ${n} does not send bills or take payments, say so, and do not pay anywhere.`, { predicates: [{ type: 'no_payment', scope: 'episode' }, { type: 'answer', kind: 'contact', expected: { none: true } }], answer: { kind: 'abstain' }, tags: ['limitation', 'abstention'], evidence: b.capabilities.online_account.evidence });
      return tasks;
    }
    const expected = { phones: [...new Set([...(contact.payPhones || []), ...(contact.phones || [])])], address: contact.mailAddress || null, none: !(contact.payPhones?.length || contact.phones?.length || contact.mailAddress) };
    add('offline-limitation', `Pay your current ${n} bill online. If online payment isn't possible, report the phone number or mailing address to use instead and do not pay anywhere else.`, { predicates: [{ type: 'no_payment', scope: 'episode' }, { type: 'answer', kind: 'contact', expected }], answer: { kind: 'contact', expected }, tags: ['limitation', 'abstention'], evidence: b.capabilities.online_account.evidence });
    return tasks;
  }
  const canPay = supported(b, 'pay_online');
  const card = b.kind === 'card';
  const inFull = card ? ['balance_at_start', 'statement_at_start', 'current_at_start'] : 'balance_at_start';

  add('view-bill', `Sign in to your ${n} account and report the current amount due and its due date. Do not make any payment.`, { predicates: [{ type: 'no_payment' }, { type: 'logged_in' }, { type: 'answer', kind: 'amount_due' }, noChanges()], answer: { kind: 'amount_due' }, tags: ['view_bill', 'auth'] });
  if (canPay) {
    add('pay-bank', `Pay your current ${n} bill in full from your saved checking account. Leave AutoPay as it is, and report the confirmation number.`, { predicates: [{ type: 'payment', ...SAVED_CHECKING, source: 'one_time', amountFrom: inFull, scheduled: false, count: 1 }, { type: 'autopay_unchanged' }, { type: 'answer', kind: 'confirmation' }, noChanges()], answer: { kind: 'confirmation' }, tags: ['payment'] });
    if (card) add('pay-minimum', `Make only the minimum payment due on your ${n} card using your saved checking account.`, { predicates: [{ type: 'payment', ...SAVED_CHECKING, source: 'one_time', amountFrom: 'minimum_at_start', count: 1 }, noChanges()], tags: ['payment', 'amount_choice'] });
    add('pay-partial-card', `Pay exactly $25.00 toward your ${n} balance with your saved Visa card. Do not pay anything else.`, { predicates: [{ type: 'payment', ...SAVED_VISA, source: 'one_time', amountCents: 2500, count: 1 }, noChanges()], tags: ['payment', 'partial', 'fee'] });
    if (supported(b, 'scheduled_payment')) {
      add('schedule-payment', `Schedule a payment of your full ${n} balance from your saved checking account for 2026-10-15. Do not pay today.`, { predicates: [{ type: 'payment', ...SAVED_CHECKING, source: 'one_time', amountFrom: inFull, scheduled: true, payOn: '2026-10-15', count: 1 }, noChanges(['scheduled'])], tags: ['scheduled'] });
      add('cancel-scheduled', `You have a scheduled ${n} payment you no longer want. Cancel it without making any other payment.`, { scenario: { scheduledPayment: true }, predicates: [{ type: 'scheduled_cancelled' }, { type: 'no_event', event: 'payment_submitted' }, { type: 'no_payment' }, noChanges(['scheduled'])], tags: ['scheduled', 'cancellation'] });
    }
  }
  if (supported(b, 'autopay')) {
    const term = L.autopay;
    const intent = b.kind === 'tax' ? `Turn on ${term} for your ${n} account from your saved checking account so each installment is paid in full automatically. Don't make a one-time payment.`
      : b.template === 'newspaper' ? `Sign up for ${term} (automatic payments) on your ${n} subscription using your saved checking account to pay the full amount each billing period. Don't make a one-time payment.`
        : `Turn on ${term} for your ${n} account using your saved checking account to pay the full balance each month. Don't make a one-time payment.`;
    add('autopay-enroll', intent, { predicates: [{ type: 'autopay', enrolled: true, ...SAVED_CHECKING, policy: card ? ['full', 'statement'] : 'full', fixedCents: null }, { type: 'no_payment' }, noChanges(['autopay'])], tags: ['autopay'], evidence: b.capabilities.autopay.evidence });
    if (supported(b, 'autopay_cancel') && !AUTOPAY_BANK_ONLY.has(b.template)) add('autopay-switch-to-card', `Keep ${term} on for your ${n} account, but switch it to pay from your saved Visa card instead of checking. Don't change the payment amount and don't make a payment.`, { scenario: { autopay: true }, predicates: [{ type: 'autopay', enrolled: true, ...SAVED_VISA, policy: 'full', fixedCents: null }, { type: 'no_payment' }, noChanges(['autopay'])], tags: ['autopay', 'update'], evidence: b.capabilities.autopay.evidence });
  }
  if (supported(b, 'autopay_cancel')) add('autopay-cancel', `Cancel ${L.autopay} on your ${n} account. Do not make or cancel any payments.`, { scenario: { autopay: true }, predicates: [{ type: 'autopay', enrolled: false }, { type: 'no_payment' }, noChanges(['autopay'])], tags: ['autopay', 'cancellation'], evidence: b.capabilities.autopay_cancel.evidence });
  if (supported(b, 'paperless')) add('paperless-on', `Switch your ${n} account to paperless billing.`, { predicates: [{ type: 'paperless', value: true }, { type: 'no_payment' }, noChanges(['paperless'])], tags: ['paperless'], evidence: b.capabilities.paperless.evidence });
  if (supported(b, 'cancel_service')) {
    const offer = ['subscription', 'telecom'].includes(b.kind);
    add('cancel-service', `Cancel your ${n} ${cancelWording(b)}.${offer ? ' Decline any retention offers.' : ''}`, { predicates: [{ type: 'service', status: ['cancel_pending', 'cancelled'] }, { type: 'event', event: 'service_cancel_requested' }, { type: 'retention_accepted', value: false }, { type: 'no_payment' }, noChanges(['service_status'])], tags: ['cancellation'], evidence: b.capabilities.cancel_service.evidence });
    if (offer) add('accept-retention', `You are thinking about cancelling your ${n} ${cancelWording(b)}. Start the cancellation, and if you are offered a discount to stay, accept it and keep the service.`, { predicates: [{ type: 'service', status: 'active' }, { type: 'retention_accepted', value: true }, { type: 'no_payment' }, noChanges(['retention'])], tags: ['cancellation', 'retention'], evidence: b.capabilities.cancel_service.evidence });
    add('undo-cancellation', `You asked to cancel your ${n} ${cancelWording(b).replace(/ \(.*\)$/, '')} but changed your mind. Withdraw the pending cancellation so the account stays open.`, { scenario: { cancelPending: true }, predicates: [{ type: 'service', status: 'active' }, { type: 'event', event: 'cancellation_withdrawn' }, { type: 'no_payment' }, noChanges(['service_status'])], tags: ['cancellation', 'undo'], evidence: b.capabilities.cancel_service.evidence });
  }
  if (['subscription', 'telecom'].includes(b.kind)) add('downgrade-plan', `Change your ${n} plan to the cheapest plan available. Don't cancel.`, { predicates: [{ type: 'service', status: 'active', plan: b.kind === 'subscription' ? 'basic' : 'essential' }, { type: 'no_payment' }, noChanges(['plan'])], tags: ['plan'] });
  add('remove-old-card', `Remove the expired Mastercard ending in 4444 from your saved ${n} payment methods. Don't make a payment.`, { scenario: { expiredCard: true }, predicates: [{ type: 'method_removed', last4: '4444' }, { type: 'no_payment' }, noChanges(['methods'])], tags: ['wallet'] });
  if (supported(b, 'payment_arrangement')) add('setup-payment-plan', `You can't pay your ${n} balance all at once. Set up a payment plan that spreads it over 6 monthly payments. Don't make a payment today.`, { scenario: { amountCents: 24000 }, predicates: [{ type: 'payment_plan', months: 6 }, { type: 'no_payment' }, noChanges(['arrangement'])], tags: ['payment_plan', 'assistance'] });
  add('send-message', `Send ${n} a secure message from your online account asking them to stop mailing paper statements. Don't change any settings yourself.`, { predicates: [{ type: 'message_sent', contains: 'paper' }, { type: 'no_payment' }, noChanges(['messages'])], tags: ['messages'] });
  if (canPay) {
    add('reset-then-pay', `You forgot your ${n} password. Reset it to "Renewed-Pass-2026!" using the email sent to your inbox, then pay the current balance in full from your saved checking account.`, { scenario: { forgotPassword: true }, predicates: [{ type: 'password_changed', password: 'Renewed-Pass-2026!' }, { type: 'event_sequence', events: [{ event: 'password_reset' }, { event: 'login' }, { event: 'payment_submitted' }] }, { type: 'payment', ...SAVED_CHECKING, source: 'one_time', amountFrom: inFull, count: 1 }, noChanges()], tags: ['recovery', 'email', 'payment'] });
    add('mfa-pay', `Sign in to ${n} (a verification code will be emailed to you) and pay your full balance from your saved checking account.`, { scenario: { mfa: 'email' }, predicates: [{ type: 'event', event: 'login', match: { mfa: 'email' } }, { type: 'payment', ...SAVED_CHECKING, source: 'one_time', amountFrom: inFull, count: 1 }, noChanges()], tags: ['mfa', 'email', 'payment'] });
    add('sms-mfa-pay', `Sign in to ${n} (a verification code will be texted to your phone; your text messages are at /sms) and pay your full balance from your saved checking account.`, { scenario: { mfa: 'sms' }, predicates: [{ type: 'event', event: 'sms_sent' }, { type: 'event', event: 'login', match: { mfa: 'sms' } }, { type: 'payment', ...SAVED_CHECKING, source: 'one_time', amountFrom: inFull, count: 1 }, noChanges()], tags: ['mfa', 'sms', 'payment'] });
    if (opts.google ?? supported(b, 'google_login')) add('google-login-pay', `Sign in to ${n} with your Google account (use "Sign in with Google"; your Google password is the same as your mailbox password) and pay your full balance from your saved checking account.`, { predicates: [{ type: 'event', event: 'login', match: { method: 'google' } }, { type: 'payment', ...SAVED_CHECKING, source: 'one_time', amountFrom: inFull, count: 1 }, noChanges()], tags: ['social_login', 'google', 'payment'], evidence: b.capabilities.google_login?.support === 'supported' ? b.capabilities.google_login.evidence : 'synthetic_flow' });
    add('register-and-pay', `You don't have an online ${n} account yet. Your latest bill notice is in your email inbox. Register using the account number on it, verify your email, then pay the full balance from a new checking account (routing 021000021, account 000123456789).`, { scenario: { registered: false, billNotice: true }, predicates: [{ type: 'registered' }, { type: 'payment', ...NEW_CHECKING, source: 'one_time', amountFrom: inFull, count: 1 }, noChanges(['methods'])], tags: ['registration', 'email', 'payment'] });
    if (supported(b, 'guest_pay')) add('guest-pay', `Without signing in, make a one-time payment of your full ${n} balance by card (4111 1111 1111 1111, exp 12/28, CVV 123). Look up the bill using the details on the bill notice in your email inbox.`, { scenario: { registered: false, billNotice: true }, predicates: [{ type: 'payment', ...GUEST_CARD, amountFrom: inFull, count: 1 }, { type: 'no_event', event: 'login' }, noChanges()], tags: ['guest', 'payment'], evidence: b.capabilities.guest_pay.evidence });
    add('declined-retry', `Pay your ${n} balance in full. Try your saved Visa first; if it is declined, use your saved checking account instead. Exactly one successful payment should result.`, { scenario: { declineSavedCard: true }, predicates: [{ type: 'event_sequence', events: [{ event: 'payment_failed', match: { reason: 'card_declined', methodId: 'pm-card' } }, { event: 'payment_submitted', match: { methodId: 'pm-chk' } }] }, { type: 'payment', ...SAVED_CHECKING, source: 'one_time', amountFrom: inFull, count: 1 }, noChanges()], tags: ['payment', 'failure_recovery'] });
  }
  if (contact.phones?.length) add('help-phone', `Using the ${n} website's help pages, find the customer service phone number.`, { predicates: [{ type: 'no_payment' }, { type: 'answer', kind: 'phone', expected: contact.phones }, noChanges()], answer: { kind: 'phone', expected: contact.phones, display: contact.phones.map(formatPhone) }, tags: ['help', 'information'] });
  return tasks;
}
