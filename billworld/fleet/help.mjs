// Help-center articles for every biller, built only from its research record.
// Facts come from the catalog (phones, mail address, notes, programs); generic guidance is labeled synthetic.
// Contact values are the cleaned display values (biller.contact): scrape provenance never reaches a page.
import { money } from './engine.mjs';
import { contactInfo, phoneDigits } from './catalog.mjs';

const sentences = text => String(text || '').split(/(?<=[.!?])\s+(?=[A-Z0-9])/).map(s => s.trim()).filter(s => s.length > 12);
// Research notes can contain URLs and scrape fragments; help pages quote only clean sentences.
const clean = s => !/https?:\/\/|www\.|context:|fetched \d{4}|<[a-z/]|\bper [a-z0-9.-]+\.(?:com|org|gov|net)\b/i.test(s);
const about = (notes, re) => sentences(notes).filter(clean).filter(s => re.test(s));

// The navigation labels each portal template actually shows, so help steps name links that exist.
export const TEMPLATE_LABELS = {
  'bank-billpay': { pay: 'Pay a Loan', history: 'Scheduled & History', autopay: 'Automatic Payments', paperless: 'Statement Delivery', wallet: 'External Accounts', statements: 'eStatements', bill: 'Loan Details', cancel: 'Account settings' },
  kubra: { pay: 'Pay Now', history: 'Payment activity', autopay: 'AutoPay', paperless: 'Smart Reminders', wallet: 'Wallet', statements: 'Bill history', bill: 'View bill' },
  'card-servicer': { pay: 'Make a Payment', history: 'Payments', autopay: 'Autopay', paperless: 'Paperless statements', wallet: 'Payment accounts', statements: 'Statements', bill: 'Activity', cancel: 'Close account' },
  paymentus: { pay: 'Make a Payment', history: 'Payment History', autopay: 'Autopay', paperless: 'Paperless', wallet: 'Wallet', statements: 'Bill History', bill: 'View Bill', cancel: 'Stop service' },
  invoicecloud: { pay: 'Pay Invoices', history: 'View Scheduled Payments', autopay: 'AutoPay', paperless: 'Paperless', wallet: 'Payment Methods', statements: 'View Paid or Closed Invoices', bill: 'View or Pay Open Invoices', cancel: 'Stop Service' },
  insurance: { pay: 'Make a payment', history: 'Payment history', autopay: 'Automatic payments (EFT)', paperless: 'Paperless preferences', wallet: 'Payment methods', statements: 'Billing documents', bill: 'Billing summary', cancel: 'Cancel coverage' },
  'patient-pay': { pay: 'Make a Payment', history: 'Payment History', autopay: 'Automatic Payments', paperless: 'Communication Preferences', wallet: 'Payment Methods', statements: 'Statements', bill: 'Statement Detail' },
  mychart: { pay: 'Pay Now', history: 'Payment History', autopay: 'Auto Pay', paperless: 'Paperless Billing', wallet: 'Wallet', statements: 'Statements', bill: 'Billing' },
  'utility-account': { pay: 'Pay My Bill', history: 'Payment Activity', autopay: 'AutoPay', paperless: 'Paperless Billing', wallet: 'Payment Methods', statements: 'Bill History', bill: 'View Bill', cancel: 'Start, Stop or Move' },
  smarthub: { pay: 'Pay My Bill', history: 'Payment History', autopay: 'Auto Pay Program', paperless: 'Paperless Billing', wallet: 'Manage Payment Methods', statements: 'Billing History', bill: 'View Bill', cancel: 'Stop Service' },
  'municipal-portal': { pay: 'Make a payment', history: 'Payment history', autopay: 'Autopay', paperless: 'e-Billing', wallet: 'Wallet', statements: 'Bills', bill: 'View bill', cancel: 'Stop service' },
  xpress: { pay: 'Make a Payment', history: 'Payment History', autopay: 'Auto Pay', paperless: 'Paperless', wallet: 'Pay Methods', statements: 'Bill History', bill: 'View Bill', cancel: 'Stop Service' },
  doxo: { pay: 'Pay', history: 'Payments', autopay: 'doxoAUTOPAY', paperless: 'Paperless settings', wallet: 'Wallet', statements: 'Bill documents', bill: 'View bill', cancel: 'Stop service' },
  'rent-portal': { pay: 'Make a Payment', history: 'Payment History', autopay: 'Auto-pay', paperless: 'e-Statements', wallet: 'Payment Accounts', statements: 'Documents', bill: 'Ledger', cancel: 'Notice to vacate' },
  'income-tax': { pay: 'Make a Payment', history: 'Payment History', autopay: 'Scheduled Payments', paperless: 'Notice Preferences', wallet: 'Bank Accounts & Cards', statements: 'Statements & Notices', bill: 'Account Balance' },
  streaming: { pay: 'Pay now', history: 'Payment history', autopay: 'Automatic payments', paperless: 'Notifications', wallet: 'Payment methods', statements: 'Receipts', bill: 'Billing details', cancel: 'Cancel service plan' },
  'health-plan': { pay: 'Make a Payment', history: 'Payment History', autopay: 'Automatic Payments (EFT)', paperless: 'Invoice Delivery', wallet: 'Payment Accounts', statements: 'Invoices', bill: 'Premium Summary', cancel: 'Disenroll' },
  telecom: { pay: 'Pay bill', history: 'Payment history', autopay: 'Auto Pay', paperless: 'Go paperless', wallet: 'Payment methods', statements: 'Statements', bill: 'View bill details', cancel: 'Disconnect service' },
  'loan-servicer': { pay: 'Make a Payment', history: 'Payment history', autopay: 'Autopay', paperless: 'Go paperless', wallet: 'Payment accounts', statements: 'Documents', bill: 'Loan Details' },
  'invoice-portal': { pay: 'Pay invoice', history: 'Payment history', autopay: 'Automatic payments', paperless: 'Invoice delivery', wallet: 'Payment methods', statements: 'Invoices & documents', bill: 'Invoice' },
  'property-tax': { pay: 'Pay Taxes', history: 'Payment History', autopay: 'Automatic installment payments', paperless: 'E-statements', wallet: 'Payment Methods', statements: 'Prior years & statements', bill: 'View tax bill' },
  newspaper: { pay: 'Pay bill', history: 'Billing and delivery history', autopay: 'EZ Pay', paperless: 'Billing preferences', wallet: 'Manage payment information', statements: 'Billing statements', bill: 'Current bill', cancel: 'Cancel subscription' },
  'waste-hauler': { pay: 'Pay My Bill', history: 'Payment History', autopay: 'AutoPay', paperless: 'Paperless', wallet: 'Payment Methods', statements: 'Invoice History', bill: 'Invoices', cancel: 'Manage Services' },
  dmv: { pay: 'Renew & Pay Fees', history: 'Transaction History', autopay: 'Automatic renewal', paperless: 'Notices', wallet: 'Payment Options', statements: 'Notices', bill: 'My Vehicles' },
  'toll-account': { pay: 'Make a Payment', history: 'Payment History', autopay: 'Auto-Replenishment', paperless: 'Statements', wallet: 'Payment Methods', statements: 'Statements', bill: 'Current Statement', cancel: 'Close Account' }
};
const DEFAULT_LABELS = { pay: 'Pay Bill', history: 'Payment History', autopay: 'AutoPay', paperless: 'Paperless Billing', wallet: 'Payment Methods', statements: 'Statements', bill: 'View Bill', cancel: 'Account settings' };
export const labelsFor = (biller, overrides = {}) => ({ ...DEFAULT_LABELS, ...(TEMPLATE_LABELS[biller.template] || {}), ...overrides });

// labels: optional per-template nav labels (e.g. from a template's meta.helpLabels) that override the built-in table.
export function helpArticles(biller, labels = {}) {
  const e = biller.entry, cap = biller.capabilities, f = biller.fees, l = e.links || {};
  const L = labelsFor(biller, labels);
  const name = biller.brand.shortName, offline = biller.template === 'offline';
  const c = biller.contact || contactInfo(e);
  const phone = c.phone, payPhone = c.payPhone, mailAddr = c.mailAddress;
  const notes = e.notes;
  const feeText = f.cardPercent != null ? `A convenience fee of ${f.cardPercent}% applies to card payments.` : f.cardCents ? `A convenience fee of ${money(f.cardCents)} applies to card payments.` : f.cardCents === 0 ? 'There is no fee to pay online.' : null;
  const a = [];
  const add = (slug, title, topic, paragraphs, source, steps = null) => a.push({ slug, title, topic, paragraphs: paragraphs.filter(Boolean), steps, source: source || null, evidence: source ? 'documented_link' : 'synthetic_from_catalog' });
  const inPerson = about(notes, /in[- ]person|walk-?in|drop ?box|night drop|at (?:the|our|any) (?:office|branch|front desk|counter)|cash/i)[0];
  const ways = [
    !offline && `Online: sign in to your account and choose ${L.pay}. You can pay with a checking or savings account or with a debit or credit card.`,
    !offline && cap.guest_pay.support === 'supported' && 'Without signing in: use Quick Pay / Guest Pay with your account number to make a one-time payment.',
    payPhone && `By phone: call ${payPhone} to make a payment.`,
    mailAddr && `By mail: send a check or money order payable to ${name} to ${mailAddr}. Include your account number on the check.`,
    offline && (phone ? `Call ${phone} for payment options.` : 'Use the phone number or address printed on your paper bill.'),
    inPerson && `In person: ${inPerson}`
  ];
  add('pay-your-bill', 'Ways to pay your bill', 'payments', [`${name} accepts payments several ways.`, ...about(notes, /pay|payment|fee|check|cash/i).filter(s => s !== inPerson).slice(0, 4), feeText], l.pay_bill, ways.filter(Boolean));
  if (!offline) {
    add('view-your-bill', 'How to view your bill', 'billing', [`Sign in and select ${L.bill} to see your current amount due, due date and itemized charges. Open ${L.statements} to download a PDF copy of a statement.`, ...about(notes, /view|statement|bill (?:is|shows)|due date/i).slice(0, 3)], l.view_bill, ['Sign in to your account.', `Select ${L.bill}.`, 'Review your amount due and due date.', `Open ${L.statements} to download a PDF.`]);
    add('billing-history', 'Payment history and past statements', 'billing', ['Your account shows up to 12 months of statements and payments. Pending payments appear until they post, usually within 1–2 business days.'], l.statements_history, ['Sign in.', `Open ${L.history} or ${L.statements}.`, 'Select a statement to view or download.']);
    if (cap.autopay.support === 'supported') {
      add('autopay', `Set up ${L.autopay}`, 'autopay', [`${L.autopay} pays your bill automatically on the due date (or the day of the month you choose) from a bank account or card you choose.`, ...about(notes, /auto ?pay|automatic|recurring|draft/i).slice(0, 3), 'If you have a balance when you enroll, pay it separately; automatic payments start with your next bill.'], l.autopay_setup, ['Sign in to your account.', `Select ${L.autopay}.`, 'Choose a payment method and amount.', 'Accept the terms and enroll.']);
      add('cancel-autopay', `Change or cancel ${L.autopay}`, 'autopay', [`You can change your ${L.autopay} payment method or turn it off at any time. Changes made before your payment date apply to the current bill.`, 'Cancelling automatic payments does not cancel a payment that is already processing or scheduled.'], l.autopay_cancel || l.autopay_setup, ['Sign in.', `Open ${L.autopay}.`, 'Select Cancel.', 'Confirm the cancellation.']);
    }
    if (cap.paperless.support === 'supported') add('paperless', 'Go paperless', 'billing', ['Paperless billing replaces your mailed statement with an email notice when your bill is ready.', ...about(notes, /paperless|e-?bill/i).slice(0, 2)], l.paperless, ['Sign in.', `Open ${L.paperless}.`, 'Turn on paperless billing and confirm your email.']);
    if (cap.scheduled_payment.support === 'supported') add('scheduled-payments', 'Schedule or cancel a future payment', 'payments', [`Choose a future payment date when you pay. You can cancel a scheduled payment from ${L.history} until it starts processing on its scheduled date.`], null, ['Start a payment.', 'Choose a payment date.', 'Review and submit.', `To cancel, open ${L.history} and select Cancel next to the scheduled payment.`]);
    add('reset-password', 'Forgot your user ID or password', 'account', ['Select Forgot password on the sign-in page and enter your email or account number. We\'ll email a verification code and link that expire in 30 minutes. Only the most recent code works.'], e.login_url, ['Select Forgot password.', 'Enter your email address.', 'Open the email and enter the code.', 'Choose a new password.']);
    add('register', 'Create an online account', 'account', ['You will need your account number from a recent bill and the email address on file. We\'ll email a link to verify your address before you can sign in.'], e.login_url, ['Select Register.', 'Enter your account number and identifying details.', 'Create a password.', 'Verify your email address from the link we send.']);
    if (cap.cancel_service.support === 'supported') {
      const kind = biller.kind;
      const title = kind === 'subscription' ? 'Cancel your membership' : kind === 'utility' ? 'Start, stop or move service' : kind === 'card' ? 'Close your account' : kind === 'rent' ? 'Give notice to vacate' : kind === 'insurance' ? 'Cancel your policy' : 'Cancel service';
      add('cancel-service', title, 'account', [kind === 'subscription' ? 'You can cancel online at any time. Your access continues until the end of the current billing period, and you won\'t be charged again.' : kind === 'utility' ? `To stop service, sign in and choose ${L.cancel} with your requested stop date at least 3 business days ahead. A final bill is sent to your forwarding address.` : `Sign in and choose ${L.cancel}. Any remaining balance must still be paid.`, ...about(notes, /cancel|stop service|close|terminate/i).slice(0, 2)], null, ['Sign in.', `Open ${L.cancel}.`, 'Choose a reason and review any offers.', 'Confirm cancellation.']);
    }
  }
  if (cap.payment_assistance.support === 'supported' || e.senior_programs) add('payment-assistance', 'Payment assistance and senior programs', 'assistance', [e.senior_programs, 'Payment arrangements may be available if you can\'t pay your full balance by the due date. Contact customer service to ask about budget billing or extensions.'], l.payment_assistance);
  add('contact-us', 'Contact us', 'contact', [phone ? `Customer service: ${phone}.` : 'Call the number on your bill.', payPhone && `Pay by phone: ${payPhone}.`, mailAddr && `Payment mailing address: ${mailAddr}.`, e.hq_address && `Office: ${e.hq_address}.`, c.serviceArea && `Service area: ${c.serviceArea}.`], e.help_center_url || e.website);
  const misc = sentences(notes).filter(clean).filter(s => !a.some(x => x.paragraphs.includes(s)) && s !== inPerson);
  if (misc.length) add('faq', 'Frequently asked questions', 'faq', misc.slice(0, 8), e.help_center_url);
  if (!offline) mergeObserved(a, biller, name, c);
  return a;
}

// ---------- observed public help (biller.profile.help, built from research-data captures) ----------
// Each captured help page contributes a short excerpt of its real text to the matching article, labeled observed_public.
// Sentences that could contradict the mock's graded facts are dropped: phone numbers not in the cleaned contact fields,
// dollar amounts and percentages (fees come from biller.fees), URLs and e-mail addresses.
const OBSERVED_ARTICLE = {
  pay_bill: ['pay-your-bill', 'Ways to pay your bill', 'payments'], view_bill: ['view-your-bill', 'How to view your bill', 'billing'],
  statements_history: ['billing-history', 'Payment history and past statements', 'billing'], autopay_setup: ['autopay', 'Automatic payments', 'autopay'],
  autopay_cancel: ['cancel-autopay', 'Change or cancel automatic payments', 'autopay'], paperless: ['paperless', 'Go paperless', 'billing'],
  payment_assistance: ['payment-assistance', 'Payment assistance and senior programs', 'assistance'], help_center: ['website-help', 'Customer help', 'contact']
};
const NEEDS_CAP = { autopay_setup: 'autopay', autopay_cancel: 'autopay_cancel', paperless: 'paperless' };
export function observedExcerpt(text, contact = {}) {
  const known = new Set([...(contact.phones || []), ...(contact.payPhones || [])]);
  return sentences(text).filter(s => {
    if (/https?:\/\/|www\.|\S+@\S+\.[a-z]{2,}|\$\s?\d|\d\s?%|<[a-z/]/i.test(s)) return false;
    const digits = phoneDigits(s);
    return digits.every(d => known.has(d)) && !/\b\d{3}[\s.-]\d{4}\b/.test(s.replace(/(?:\+?1[\s.-]?)?\(?[2-9]\d{2}\)?[\s.-]?[2-9]\d{2}[\s.-]?\d{4}/g, ''));
  }).join(' ').slice(0, 600).trim();
}
function mergeObserved(articles, biller, name, contact) {
  const help = biller.profile?.help;
  if (!Array.isArray(help) || !help.length) return;
  for (const h of help) {
    if (!h || typeof h !== 'object' || typeof h.excerpt !== 'string') continue; // malformed profile entries are skipped, never a 500
    const map = OBSERVED_ARTICLE[h.kind]; if (!map) continue;
    if (NEEDS_CAP[h.kind] && biller.capabilities[NEEDS_CAP[h.kind]]?.support !== 'supported') continue;
    const excerpt = observedExcerpt(h.excerpt, contact);
    if (excerpt.length < 40) continue;
    const quote = `From the ${name} website: “${excerpt}”`;
    let art = articles.find(x => x.slug === map[0]);
    if (!art) { art = { slug: map[0], title: map[1], topic: map[2], paragraphs: [], steps: null, source: h.url || null, evidence: 'observed_public' }; articles.push(art); }
    if (art.paragraphs.some(p => p.includes(excerpt))) continue;
    art.paragraphs.push(quote);
    art.observed = [...(art.observed || []), { kind: h.kind, title: h.title || null, headings: (Array.isArray(h.headings) ? h.headings : []).slice(0, 8), excerpt, url: h.url || null }];
    art.evidence = 'observed_public';
  }
}

export function searchHelp(articles, q) {
  const terms = String(q || '').toLowerCase().split(/\W+/).filter(t => t.length > 2);
  if (!terms.length) return [];
  return articles.map(a => { const text = `${a.title} ${a.paragraphs.join(' ')} ${(a.steps || []).join(' ')}`.toLowerCase(); return { a, score: terms.reduce((s, t) => s + (a.title.toLowerCase().includes(t) ? 3 : 0) + (text.includes(t) ? 1 : 0), 0) }; }).filter(x => x.score > 0).sort((x, y) => y.score - x.score).map(x => x.a);
}
