// Benchmark task generator: every biller gets the tasks its capability profile supports.
// Each task = natural-language intent + scenario seed + independent predicates (and expected answers).
// Predicates grade on durable facts: amounts are compared in cents against the balance at episode start, the payment
// method and source are pinned, unrequested changes fail the task, and reported answers are graded (the runner passes
// the agent's final answer to /evaluate or /finish as `answer`).
import { labelsFor } from './help.mjs';
import { formatPhone, AUTOPAY_BANK_ONLY } from './catalog.mjs';
import { methodTypesFor, plansFor, defaultPlan, CARD_BRANDS, savedCardBrand, expiredCardBrand, retentionOfferFor } from './engine.mjs';

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
const GUEST_BANK = { methodType: 'bank', methodLast4: '6789', source: 'guest' };
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

// How often AutoPay charges, in the biller's own cadence: annual plans renew each year and memberships / subscriptions
// without a known cadence (e.g. annual dues) at each renewal; everything else bills monthly.
export function autopayPeriod(b) {
  const plan = b.dossier?.billing?.plans?.find(p => p.id === defaultPlan(b));
  return plan?.interval === 'year' ? 'each year' : b.kind === 'subscription' ? 'at each renewal' : 'each month';
}
// opts.google: whether this host renders Sign in with Google for the biller (default: the observed google_login capability).
export function generateTasks(b, opts = {}) {
  const tasks = familyTasks(b, opts);
  return b.dossier ? dedicatedTasks(b, tasks) : tasks;
}
function familyTasks(b, opts = {}) {
  const id = b.id, n = b.brand.shortName, tasks = [];
  const L = labelsFor(b);
  const d = b.dossier || null;
  const cards = methodTypesFor(b).includes('card'), apCards = methodTypesFor(b, { autopay: true }).includes('card');
  // Card-only billers (dossier): the saved Visa stands where the family tasks use the saved checking account.
  const banks = methodTypesFor(b).includes('bank'), apBanks = methodTypesFor(b, { autopay: true }).includes('bank');
  const visa = CARD_BRANDS[savedCardBrand(b)], oldCard = CARD_BRANDS[expiredCardBrand(b)]; // seeded saved / expired card brands (dossier billing.cardBrands)
  const cardSlugs = new Set(); // tasks switched to the saved Visa: the Infinity reference pays from checking, so they are not exported
  const mfa = d?.auth?.mfa; // the biller's own second factor: none | email | sms | email_or_sms (no dossier: both tasks)
  const add = (slug, intent, { scenario = {}, predicates, answer = null, tags = [], evidence }) => {
    if (!cards && ['pay-partial-card', 'declined-retry', 'remove-old-card', 'autopay-switch-to-card'].includes(slug)) return;
    if (!apCards && slug === 'autopay-switch-to-card') return;
    if ((!banks && ['declined-retry', 'register-and-pay'].includes(slug)) || (!apBanks && slug === 'autopay-switch-to-card')) return;
    if (!banks || !apBanks) {
      const toCard = (slug.startsWith('autopay') ? !apBanks : !banks);
      if (toCard) { cardSlugs.add(slug); intent = intent.replace(/saved checking account/g, `saved ${visa} card`).replace(/from checking\b/g, 'from the card'); predicates = predicates.map(p => p.methodId === 'pm-chk' ? { ...p, methodId: 'pm-card', methodType: 'card' } : p); }
    }
    if (mfa && ((slug === 'mfa-pay' && !['email', 'email_or_sms'].includes(mfa)) || (slug === 'sms-mfa-pay' && !['sms', 'email_or_sms'].includes(mfa)))) return;
    pushTask(slug, intent, { scenario, predicates, answer, tags, evidence });
  };
  const pushTask = (slug, intent, { scenario = {}, predicates, answer = null, tags = [], evidence }) => tasks.push({ id: `${id}:${slug}`, billerId: id, template: b.template, family: b.family, kind: b.kind, intent, scenario: { [id]: scenario }, predicates: [...predicates, noOtherPayments].map(p => ({ billerId: id, ...p })), answer, tags, evidence: evidence || b.capabilities.pay_online?.evidence, cohort: evidenceCohort(evidence || b.capabilities.pay_online?.evidence) });
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
  // Loans: the site shows both the payment due and the remaining principal; the graded amount is the payment due.
  const loan = b.kind === 'loan';
  const fullBal = loan ? `the current ${n} amount due in full` : `your full ${n} balance`;
  const fullBalShort = loan ? 'the current amount due in full' : 'your full balance';

  add('view-bill', `Sign in to your ${n} account and report the current amount due and its due date. Do not make any payment.`, { predicates: [{ type: 'no_payment' }, { type: 'logged_in' }, { type: 'answer', kind: 'amount_due' }, noChanges()], answer: { kind: 'amount_due' }, tags: ['view_bill', 'auth'] });
  if (canPay) {
    add('pay-bank', `Pay your current ${n} bill in full from your saved checking account. Leave AutoPay as it is, and report the confirmation number.`, { predicates: [{ type: 'payment', ...SAVED_CHECKING, source: 'one_time', amountFrom: inFull, scheduled: false, count: 1 }, { type: 'autopay_unchanged' }, { type: 'answer', kind: 'confirmation' }, noChanges()], answer: { kind: 'confirmation' }, tags: ['payment'] });
    if (card) add('pay-minimum', `Make only the minimum payment due on your ${n} card using your saved checking account.`, { predicates: [{ type: 'payment', ...SAVED_CHECKING, source: 'one_time', amountFrom: 'minimum_at_start', count: 1 }, noChanges()], tags: ['payment', 'amount_choice'] });
    add('pay-partial-card', `Pay exactly $25.00 toward your ${n} balance with your saved ${visa} card. Do not pay anything else.`, { predicates: [{ type: 'payment', ...SAVED_VISA, source: 'one_time', amountCents: 2500, count: 1 }, noChanges()], tags: ['payment', 'partial', 'fee'] });
    if (supported(b, 'scheduled_payment')) {
      add('schedule-payment', `Schedule a payment of ${fullBal} from your saved checking account for 2026-10-15. Do not pay today.`, { scenario: { dueInDays: 17 }, predicates: [{ type: 'payment', ...SAVED_CHECKING, source: 'one_time', amountFrom: inFull, scheduled: true, payOn: '2026-10-15', count: 1 }, noChanges(['scheduled'])], tags: ['scheduled'] });
      add('cancel-scheduled', `You have a scheduled ${n} payment you no longer want. Cancel it without making any other payment.`, { scenario: { scheduledPayment: true }, predicates: [{ type: 'scheduled_cancelled' }, { type: 'no_event', event: 'payment_submitted' }, { type: 'no_payment' }, noChanges(['scheduled'])], tags: ['scheduled', 'cancellation'] });
    }
  }
  if (supported(b, 'autopay')) {
    const term = L.autopay;
    const intent = b.kind === 'tax' ? `Turn on ${term} for your ${n} account from your saved checking account so each installment is paid in full automatically. Don't make a one-time payment.`
      : b.template === 'newspaper' ? `Sign up for ${term} (automatic payments) on your ${n} subscription using your saved checking account to pay the full amount each billing period. Don't make a one-time payment.`
        : `Turn on ${term} for your ${n} account using your saved checking account to pay the full balance ${autopayPeriod(b)}. Don't make a one-time payment.`;
    add('autopay-enroll', intent, { predicates: [{ type: 'autopay', enrolled: true, ...SAVED_CHECKING, policy: card || (d?.billing?.autopay?.policies && !d.billing.autopay.policies.includes('full')) ? ['full', 'statement'] : 'full', fixedCents: null }, { type: 'no_payment' }, noChanges(['autopay'])], tags: ['autopay'], evidence: b.capabilities.autopay.evidence });
    if (supported(b, 'autopay_cancel') && !AUTOPAY_BANK_ONLY.has(b.template)) add('autopay-switch-to-card', `Keep ${term} on for your ${n} account, but switch it to pay from your saved ${visa} card instead of checking. Don't change the payment amount and don't make a payment.`, { scenario: { autopay: true }, predicates: [{ type: 'autopay', enrolled: true, ...SAVED_VISA, policy: 'full', fixedCents: null }, { type: 'no_payment' }, noChanges(['autopay'])], tags: ['autopay', 'update'], evidence: b.capabilities.autopay.evidence });
  }
  if (supported(b, 'autopay_cancel')) add('autopay-cancel', `Cancel ${L.autopay} on your ${n} account. Do not make or cancel any payments.`, { scenario: { autopay: true }, predicates: [{ type: 'autopay', enrolled: false }, { type: 'no_payment' }, noChanges(['autopay'])], tags: ['autopay', 'cancellation'], evidence: b.capabilities.autopay_cancel.evidence });
  if (supported(b, 'paperless')) add('paperless-on', `Switch your ${n} account to paperless billing.`, { predicates: [{ type: 'paperless', value: true }, { type: 'no_payment' }, noChanges(['paperless'])], tags: ['paperless'], evidence: b.capabilities.paperless.evidence });
  if (supported(b, 'cancel_service')) {
    const offer = retentionOfferFor(b);
    add('cancel-service', `Cancel your ${n} ${cancelWording(b)}.${offer ? ' Decline any retention offers.' : ''}`, { predicates: [{ type: 'service', status: ['cancel_pending', 'cancelled'] }, { type: 'event', event: 'service_cancel_requested' }, { type: 'retention_accepted', value: false }, { type: 'no_payment' }, noChanges(['service_status'])], tags: ['cancellation'], evidence: b.capabilities.cancel_service.evidence });
    if (offer) add('accept-retention', `You are thinking about cancelling your ${n} ${cancelWording(b)}. Start the cancellation, and if you are offered a discount to stay, accept it and keep the service.`, { predicates: [{ type: 'service', status: 'active' }, { type: 'retention_accepted', value: true }, { type: 'no_payment' }, noChanges(['retention'])], tags: ['cancellation', 'retention'], evidence: b.capabilities.cancel_service.evidence });
    add('undo-cancellation', `You asked to cancel your ${n} ${cancelWording(b).replace(/ \(.*\)$/, '')} but changed your mind. Withdraw the pending cancellation so the account stays open.`, { scenario: { cancelPending: true }, predicates: [{ type: 'service', status: 'active' }, { type: 'event', event: 'cancellation_withdrawn' }, { type: 'no_payment' }, noChanges(['service_status'])], tags: ['cancellation', 'undo'], evidence: b.capabilities.cancel_service.evidence });
  }
  if (d?.billing?.plans) { const cheapest = plansFor(b).slice().sort((x, y) => x[2] - y[2])[0][0]; add('downgrade-plan', `Change your ${n} plan to the cheapest plan available. Don't cancel.`, { predicates: [{ type: 'service', status: 'active', plan: cheapest }, { type: 'event', event: 'plan_changed', match: { to: cheapest } }, { type: 'no_payment' }, noChanges(['plan'])], tags: ['plan'], evidence: d.billing.source ? 'documented_official' : undefined }); }
  else if (['subscription', 'telecom'].includes(b.kind) && plansFor(b)) add('downgrade-plan', `Change your ${n} plan to the cheapest plan available. Don't cancel.`, { predicates: [{ type: 'service', status: 'active', plan: plansFor(b).slice().sort((x, y) => x[2] - y[2])[0][0] }, { type: 'event', event: 'plan_changed', match: { to: plansFor(b).slice().sort((x, y) => x[2] - y[2])[0][0] } }, { type: 'no_payment' }, noChanges(['plan'])], tags: ['plan'] });
  add('remove-old-card', `Remove the expired ${oldCard} ending in 4444 from your saved ${n} payment methods. Don't make a payment.`, { scenario: { expiredCard: true }, predicates: [{ type: 'method_removed', last4: '4444' }, { type: 'no_payment' }, noChanges(['methods'])], tags: ['wallet'] });
  if (supported(b, 'payment_arrangement')) add('setup-payment-plan', `You can't pay your ${n} balance all at once. Set up a payment plan that spreads it over 6 monthly payments. Don't make a payment today.`, { scenario: { amountCents: 14000, pastDueCents: 26000 /* past due: real plans ("past-due balances of $250 to $5,000") are for overdue accounts */ }, predicates: [{ type: 'payment_plan', months: 6 }, { type: 'no_payment' }, noChanges(['arrangement'])], tags: ['payment_plan', 'assistance'] });
  // Billers that never mail bills (dossier: paperless not applicable / unsupported) get a different topic.
  const noPaper = d && ['not_applicable', 'unsupported'].includes(b.capabilities.paperless?.support);
  add('send-message', noPaper ? `Send ${n} a secure message from your online account asking for a copy of your payment history. Don't change any settings yourself.` : `Send ${n} a secure message from your online account asking them to stop mailing paper statements. Don't change any settings yourself.`, { predicates: [{ type: 'message_sent', contains: noPaper ? 'history' : 'paper' }, { type: 'no_payment' }, noChanges(['messages'])], tags: ['messages'] });
  if (canPay) {
    add('reset-then-pay', `You forgot your ${n} password. Reset it to "Renewed-Pass-2026!" using the site's forgot-password flow (the reset email will arrive in your inbox), then pay ${loan ? 'the current amount due' : 'the current balance'} in full from your saved checking account.`, { scenario: { forgotPassword: true }, predicates: [{ type: 'password_changed', password: 'Renewed-Pass-2026!' }, { type: 'event_sequence', events: [{ event: 'password_reset' }, { event: 'login' }, { event: 'payment_submitted' }] }, { type: 'payment', ...SAVED_CHECKING, source: 'one_time', amountFrom: inFull, count: 1 }, noChanges()], tags: ['recovery', 'email', 'payment'] });
    add('mfa-pay', `Sign in to ${n} (a verification code will be emailed to you) and pay ${fullBalShort} from your saved checking account.`, { scenario: { mfa: 'email' }, predicates: [{ type: 'event', event: 'login', match: { mfa: 'email' } }, { type: 'payment', ...SAVED_CHECKING, source: 'one_time', amountFrom: inFull, count: 1 }, noChanges()], tags: ['mfa', 'email', 'payment'] });
    add('sms-mfa-pay', `Sign in to ${n} (a verification code will be texted to your phone; your text messages are at /sms) and pay ${fullBalShort} from your saved checking account.`, { scenario: { mfa: 'sms' }, predicates: [{ type: 'event', event: 'sms_sent' }, { type: 'event', event: 'login', match: { mfa: 'sms' } }, { type: 'payment', ...SAVED_CHECKING, source: 'one_time', amountFrom: inFull, count: 1 }, noChanges()], tags: ['mfa', 'sms', 'payment'] });
    if (opts.google ?? supported(b, 'google_login')) add('google-login-pay', `Sign in to ${n} with your Google account (use "Sign in with Google"; your Google password is the same as your mailbox password) and pay ${fullBalShort} from your saved checking account.`, { predicates: [{ type: 'event', event: 'login', match: { method: 'google' } }, { type: 'payment', ...SAVED_CHECKING, source: 'one_time', amountFrom: inFull, count: 1 }, noChanges()], tags: ['social_login', 'google', 'payment'], evidence: b.capabilities.google_login?.support === 'supported' ? b.capabilities.google_login.evidence : 'synthetic_flow' });
    add('register-and-pay', `You don't have an online ${n} account yet. Your latest bill notice is in your email inbox. Register using the account number on it, verify your email, then pay ${loan ? 'the current amount due in full' : 'the full balance'} from a new checking account (routing 021000021, account 000123456789).`, { scenario: { registered: false, billNotice: true }, predicates: [{ type: 'registered' }, { type: 'payment', ...NEW_CHECKING, source: 'one_time', amountFrom: inFull, count: 1 }, noChanges(['methods'])], tags: ['registration', 'email', 'payment'] });
    const guestCard = methodTypesFor(b, { guest: true }).includes('card');
    if (supported(b, 'guest_pay')) add('guest-pay', guestCard ? `Without signing in, make a one-time payment of ${fullBal} by card (4111 1111 1111 1111, exp 12/28, CVV 123). Look up the bill using the details on the bill notice in your email inbox.` : `Without signing in, make a one-time payment of ${fullBal} from your checking account (routing 021000021, account 000123456789). Look up the bill using the details on the bill notice in your email inbox.`, { scenario: { registered: false, billNotice: true }, predicates: [{ type: 'payment', ...(guestCard ? GUEST_CARD : GUEST_BANK), amountFrom: inFull, count: 1 }, { type: 'no_event', event: 'login' }, noChanges()], tags: ['guest', 'payment'], evidence: b.capabilities.guest_pay.evidence });
    add('declined-retry', `Pay ${loan ? `the current ${n} amount due` : `your ${n} balance`} in full. Try your saved ${visa} first; if it is declined, use your saved checking account instead. Exactly one successful payment should result.`, { scenario: { declineSavedCard: true }, predicates: [{ type: 'event_sequence', events: [{ event: 'payment_failed', match: { reason: 'card_declined', methodId: 'pm-card' } }, { event: 'payment_submitted', match: { methodId: 'pm-chk' } }] }, { type: 'payment', ...SAVED_CHECKING, source: 'one_time', amountFrom: inFull, count: 1 }, noChanges()], tags: ['payment', 'failure_recovery'] });
  }
  if (contact.phones?.length) add('help-phone', `Using the ${n} website's help pages, find the customer service phone number.`, { predicates: [{ type: 'no_payment' }, { type: 'answer', kind: 'phone', expected: contact.phones }, noChanges()], answer: { kind: 'phone', expected: contact.phones, display: contact.phones.map(formatPhone) }, tags: ['help', 'information'] });
  for (const t of tasks) if (cardSlugs.has(t.id.slice(id.length + 1))) t.exportable = false;
  return tasks;
}

// ---------- dedicated tier (billers/<id>.json) ----------
// Limitation tasks: a capability the dossier marks unsupported online (with a note saying how it is done instead).
// The agent must not change anything and must report the offline route (phone, or an explicit "not possible online").
const LIMITATION = {
  cancel_service: (n, b) => [`cancel-service-limitation`, `Cancel your ${n} ${cancelWording(b)} online. If that cannot be done online, do not change anything; report how to do it instead (for example the phone number to call).`, ['service_status']],
  autopay: n => ['autopay-limitation', `Turn on automatic payments for your ${n} account online. If that is not possible online, do not change anything; report how to set it up instead.`, ['autopay']],
  autopay_cancel: n => ['autopay-cancel-limitation', `Turn off automatic payments on your ${n} account online. If that is not possible online, do not change anything; report how to do it instead.`, ['autopay']],
  paperless: n => ['paperless-limitation', `Switch your ${n} account to paperless billing online. If that is not possible online, do not change anything; report how to do it instead.`, ['paperless']],
  payment_arrangement: n => ['payment-plan-limitation', `Set up a payment plan for your ${n} balance online. If that is not possible online, do not change anything; report how to arrange one instead.`, ['arrangement']],
  scheduled_payment: n => ['schedule-limitation', `Schedule a future-dated payment of your ${n} balance for 2026-10-15 online. If future-dated payments are not possible online, do not pay; report that instead.`, ['scheduled']],
  change_plan: n => ['plan-change-limitation', `Change your ${n} plan to the cheapest plan available online. If plan changes cannot be made online, do not change anything; report how to do it instead.`, ['plan']],
  guest_pay: n => ['guest-pay-limitation', `Pay your ${n} bill without signing in or creating an account. If that is not possible, do not pay; report what you would need to do instead.`, []]
};
export const limitationExpected = (b, c) => {
  // Every 10-digit number the note itself names is a valid route (e.g. one line for digital phone, another for landline).
  const inNote = [...String(c.note || '').matchAll(/(?:\+?1[\s.-]?)?\(?\b(\d{3})\)?[\s.-]?(\d{3})[\s.-](\d{4})\b/g)].map(m => m[1] + m[2] + m[3]);
  const phones = c.phone ? [...new Set([c.phone, ...inNote])] : c.channel === 'phone' || !c.channel ? [...new Set([...(b.contact?.phones || []), ...(b.contact?.payPhones || [])])] : [];
  // Where no route is published, pointing to the biller's own customer-service line is still an honest answer.
  const okPhones = [...new Set([...(b.contact?.phones || []), ...(b.contact?.payPhones || []), ...inNote, ...(b.dossier?.contact?.phone ? [String(b.dossier.contact.phone).replace(/\D/g, '').slice(-10)] : [])])];
  return phones.length ? { phones, address: null, none: false } : { phones: [], address: null, none: true, okPhones };
};
function dedicatedTasks(b, family) {
  const d = b.dossier, id = b.id, n = b.brand.shortName;
  const suppress = new Set(d.tasks?.suppress || []);
  // Rules the dossier states make some family tasks impossible: full-balance-only billers take no partial payments or
  // plans; billers whose plans change only offline get a limitation task instead of downgrade-plan.
  if (d.billing?.fullBalanceOnly) for (const s of ['pay-minimum', 'pay-partial-card', 'setup-payment-plan']) suppress.add(s);
  if (['unsupported', 'not_applicable'].includes(b.capabilities.change_plan?.support)) suppress.add('downgrade-plan');
  // Accounts the biller sets up itself (registration unsupported): the site shows no sign-up link, so no sign-up task.
  if (b.capabilities.registration?.support === 'unsupported') suppress.add('register-and-pay');
  const out = family.filter(t => !suppress.has(t.id.slice(id.length + 1))).map(t => ({ ...t, tier: 'dedicated' }));
  const base = (slug, intent, x) => ({ id: `${id}:${slug}`, billerId: id, template: b.template, family: b.family, kind: b.kind, intent, tier: 'dedicated', exportable: false, ...x });
  for (const [cap, c] of Object.entries(b.capabilities)) {
    if (!c.dossier || c.support !== 'unsupported' || !c.note || !LIMITATION[cap]) continue;
    const [slug, intent, unchanged] = LIMITATION[cap](n, b);
    if (suppress.has(slug)) continue;
    const expected = limitationExpected(b, c);
    out.push(base(slug, intent, { scenario: { [id]: cap === 'autopay_cancel' ? { autopay: true } : {} }, predicates: [{ type: 'no_payment', scope: 'episode' }, { type: 'answer', kind: 'contact', expected }, { type: 'no_unrequested_changes', allow: [] }].map(p => ({ billerId: id, ...p })), answer: { kind: 'contact', expected, display: expected.phones.map(formatPhone) }, tags: ['limitation', cap], evidence: c.evidence, cohort: evidenceCohort(c.evidence), limitation: cap, note: c.note }));
  }
  for (const x of d.tasks?.extra || []) {
    const evidence = { observed_public: 'observed_public', documented_official: 'documented_official', inferred: 'inferred_dossier', synthetic: 'synthetic_flow' }[x.evidence || 'documented_official'];
    out.push(base(x.slug, x.intent, { scenario: { [id]: x.scenario || {} }, predicates: [...x.predicates, { type: 'no_payment', scope: 'others' }].map(p => ({ billerId: id, ...p })), answer: x.answer || null, tags: x.tags, evidence, cohort: evidenceCohort(evidence), ...(x.solver ? { solver: x.solver } : {}), ...(x.solution ? { solution: x.solution } : {}) }));
  }
  // The Infinity reference fills the family forms only: dossier-required registration / guest fields stay out of exports.
  for (const t of out) if ((d.auth?.registrationFields?.length && t.id.endsWith(':register-and-pay')) || (d.auth?.guestLookupFields?.length && t.id.endsWith(':guest-pay'))) t.exportable = false;
  // Lookup / registration fields only the customer knows (phone, date of birth): the instruction states them
  // (infinity/export.mjs instructionFor reads task.personaFacts and prints the persona's values).
  const FACTS = ['phone', 'dob'];
  for (const t of out) {
    const fields = t.id.endsWith(':guest-pay') ? d.auth?.guestLookupFields : t.id.endsWith(':register-and-pay') ? d.auth?.registrationFields : null;
    const facts = (fields || []).filter(f => FACTS.includes(f));
    if (facts.length) t.personaFacts = facts;
  }
  // A sign-in secret the site does not call a password ("Account PIN", "Passcode"): the instruction names it the site's way.
  const pwLabel = d.labels?.password;
  if (pwLabel && !/password/i.test(pwLabel)) for (const t of out) t.passwordLabel = pwLabel;
  // Sign-in by account number or phone: generated intents tell the agent where its identifier is.
  const ident = d.auth?.identifier;
  if (ident === 'account' || ident === 'phone') for (const t of out) {
    if (!t.predicates.some(p => ['logged_in', 'payment', 'autopay', 'paperless', 'service', 'method_removed', 'payment_plan', 'message_sent', 'password_changed', 'event', 'scheduled_cancelled', 'registered'].includes(p.type)) || /limitation$/.test(t.id) || t.id.endsWith(':guest-pay')) continue;
    t.exportable = false;
    if (ident === 'account') { t.scenario = { [id]: { ...t.scenario[id], billNotice: true } }; t.intent += ' You sign in with your account number, which is on the bill notice in your inbox.'; }
    else t.intent += ' You sign in with your mobile phone number.';
  }
  return out;
}
