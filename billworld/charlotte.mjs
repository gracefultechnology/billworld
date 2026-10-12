// Charlotte County Utilities (FL) on a reconstructed Paymentus customer portal.
// Evidence labels: see sites/charlotte-county.json. Documented county policy (fees, posting cutoff,
// re-enrollment, Setup > Automatic Payments, scheduled payments keeping their own method) drives the
// rules below. Private Paymentus screens are HTTP 403 to research capture, so layouts, validation
// messages, confirmation formats and timings marked "synthetic" are local reconstructions.
import {createHash} from 'node:crypto';
import {walletInstrument, validateExpiry, instrumentHash} from './wallet.mjs';

export const CCU_KIND = 'charlotte_paymentus';
export const isCharlotte = site => site?.runtime?.kind === CCU_KIND;

const FEES = {bank: 100, card: 295};
// Observed on the 2026 county calendar: Nov 11, Nov 26, Nov 27. Other dates are synthetic.
const HOLIDAYS = new Set(['2026-11-11', '2026-11-26', '2026-11-27', '2026-12-24', '2026-12-25', '2027-01-01', '2027-01-18']);
const ET = new Intl.DateTimeFormat('en-US', {timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'});
export function etParts(ms) {
  const p = Object.fromEntries(ET.formatToParts(new Date(ms)).map(x => [x.type, x.value]));
  return {date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour), minute: Number(p.minute)};
}
export function etMs(date, hour) {
  const target = Date.parse(date + 'T00:00:00Z') + hour * 3600000;
  let guess = target + 4 * 3600000;
  for (let i = 0; i < 3; i++) { const p = etParts(guess); guess -= Date.parse(p.date + 'T00:00:00Z') + (p.hour * 60 + p.minute) * 60000 - target; }
  return guess;
}
export const addDays = (date, n) => new Date(Date.parse(date + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
export const businessDay = date => { const d = new Date(date + 'T00:00:00Z').getUTCDay(); return d !== 0 && d !== 6 && !HOLIDAYS.has(date); };
// Documented: "Posts same business day if paid before 8 p.m. Otherwise, next business day."
export function postingDate(ms) {
  const {date, hour} = etParts(ms); let d = date;
  if (!(businessDay(d) && hour < 20)) { d = addDays(d, 1); while (!businessDay(d)) d = addDays(d, 1); }
  return d;
}
const validDate = d => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && new Date(d + 'T00:00:00Z').toISOString().slice(0, 10) === d;
const money = c => '$' + (c / 100).toFixed(2);
const longDate = d => new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', {timeZone: 'UTC', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'});
const sha = v => createHash('sha256').update(v).digest('hex');
export function cardBrand(n) {
  if (/^4/.test(n)) return 'Visa';
  if (/^(5[1-5]|2[2-7])/.test(n)) return 'Mastercard';
  if (/^(6011|65|64[4-9])/.test(n)) return 'Discover';
  return null;
}
const normalizeAccount = v => String(v || '').replace(/[\s-]/g, '');

const BILLING = {
  'acct-primary': {customerNumber: '01048-021048', street: '1048', serviceAddress: '1048 Harbor Blvd', city: 'Port Charlotte, FL 33952', zip: '33952', phone: '9415550148'},
  'acct-secondary': {customerNumber: '02099-022099', street: '2099', serviceAddress: '2099 Tamiami Trl', city: 'Punta Gorda, FL 33950', zip: '33950', phone: '9415550299'}
};
const LINES = {
  'inv-current': {billDate: '2026-09-30', pastDueAfter: '2026-10-20', service: ['2026-08-27', '2026-09-25', 29], reads: [1209, 1203], lines: [['Res Water Charge', 3148], ['Res Sewer Charge', 4534], ['Customer Charge', 750]], previousBalance: 7219, previousPayment: 7219},
  'inv-old': {billDate: '2026-08-31', pastDueAfter: '2026-09-20', service: ['2026-07-28', '2026-08-26', 29], reads: [1203, 1198], lines: [['Res Water Charge', 2612], ['Res Sewer Charge', 3857], ['Customer Charge', 750]], previousBalance: 6840, previousPayment: 6840},
  'inv-other': {billDate: '2026-09-30', pastDueAfter: '2026-10-20', service: ['2026-08-27', '2026-09-25', 29], reads: [884, 880], lines: [['Res Water Charge', 1840], ['Res Sewer Charge', 2600], ['Customer Charge', 750]], previousBalance: 4975, previousPayment: 4975}
};

function bankMethod(id, number, label, name = 'Alex Morgan') {
  return {id, kind: 'bank', last4: number.slice(-4), label, name, accountType: label.startsWith('Savings') ? 'Savings' : 'Checking', instrumentHash: instrumentHash('bank', number, '021000021'), version: 1};
}
function cardMethod(id, number, expiry, name = 'Alex Morgan') {
  return {id, kind: 'card', last4: number.slice(-4), label: `${cardBrand(number)} ending ${number.slice(-4)}`, brand: cardBrand(number), name, expiry, instrumentHash: instrumentHash('card', number), version: 1};
}

export function seedCharlotte(s, task, h) {
  const g = task.goal || {};
  s.invoices = s.invoices.filter(i => LINES[i.id]);
  for (const inv of s.invoices) Object.assign(inv, LINES[inv.id], {number: (inv.accountId === 'acct-primary' ? '01048-021048' : '02099-022099') + '-' + LINES[inv.id].billDate.slice(0, 7)});
  for (const a of s.accounts) {
    const b = BILLING[a.id];
    a.customerNumber = b.customerNumber;
    a.methods = [];
    a.autopay = {enabled: false, methodId: null, day: 20};
    a.ccu = {serviceAddress: b.serviceAddress, serviceCity: b.city, serviceZip: b.zip, street: b.street, profile: a.registered ? {firstName: a.name.split(' ')[0], lastName: a.name.split(' ').at(-1), phone: b.phone, zip: b.zip} : null, links: a.registered ? [{accountId: a.id, nickname: '', paperless: false, emailNotify: false, smsNotify: false, mobile: ''}] : []};
  }
  const alex = s.accounts[0];
  if (g.type === 'ccu_registration_payment') { alex.registered = false; alex.credential = null; alex.ccu.profile = null; alex.ccu.links = []; }
  if (alex.registered) alex.methods = [bankMethod('bank-1048', '000001048', 'Checking ending 1048'), cardMethod('card-4242', '4242424242424242', '12/29')];
  s.payments = s.payments.filter(p => p.id === 'pay-historical');
  for (const p of s.payments) Object.assign(p, {confirmation: '7310048216', feeCents: 100, method: {kind: 'bank', last4: '1048', label: 'Checking ending 1048'}, postingDate: '2026-09-18', source: 'portal', createdAt: Date.parse('2026-09-18T14:12:00Z')});
  s.ccu = {version: 1, scheduled: [], autopay: {}, drafts: {}, guest: null, resets: {}, legacyEmails: [], seq: 0};
  if (g.type === 'ccu_registration_payment') s.ccu.legacyEmails.push(alex.email);
  if (['ccu_scheduled_update', 'ccu_scheduled_cancel'].includes(g.type)) {
    alex.methods.push(bankMethod('bank-2210', '000002210', 'Checking ending 2210'));
    const card = alex.methods.find(m => m.id === 'card-4242');
    s.ccu.scheduled.push({id: 'sched-1', profileId: alex.id, accountId: alex.id, invoiceId: 'inv-current', amountCents: 8432, feeCents: FEES.card, method: methodSnapshot(card), date: '2026-10-19', status: 'scheduled', createdAt: s.now - 2 * 86400000, version: 1});
  }
  if (g.type === 'ccu_autopay' && g.seed_autopay) s.ccu.autopay['acct-primary'] = {enabled: true, methodId: g.seed_autopay, profileId: alex.id, rule: 'due_date', enrolledAt: s.now - 5 * 86400000, version: 1};
  s.mail = [];
  h.send(s, alex.email, 'Charlotte County Utilities has moved online payments to Paymentus', 'Charlotte County Utilities now uses Paymentus for online bill payment, AutoPay and paperless billing. Customer data was not transferred from the previous eBill (Billtrust) system, so returning online customers must register again in the Paymentus portal. Fees: ACH $1.00; debit/credit card and digital wallets $2.95. Fees are charged by the payment provider and are not paid to Charlotte County Utilities. Questions: 941.764.4300. (Simulated message; wording reconstructed from the county Paymentus FAQ.)');
  h.send(s, alex.email, 'Your Charlotte County Utilities bill is ready', `Account ${alex.customerNumber}, service address ${alex.ccu.serviceAddress}: your bill dated September 30, 2026 totals $84.32. Current charges become past due after October 20, 2026. Pay online at /cp/ccfl. (Synthetic bill.)`);
  s.ccu.baseline = JSON.stringify(business(s));
  s.ccu.credentialBaseline = credentials(s);
}

function methodSnapshot(m) { const {id, kind, last4, label, name, expiry, brand, accountType, instrumentHash: ih} = m; return {id, kind, last4, label, name, ...(expiry ? {expiry} : {}), ...(brand ? {brand} : {}), ...(accountType ? {accountType} : {}), instrumentHash: ih}; }
const publicMethod = m => m && ({id: m.id, kind: m.kind, last4: m.last4, label: m.label, name: m.name, ...(m.expiry ? {expiry: m.expiry} : {})});
export function business(s) {
  return {
    accounts: s.accounts.map(a => ({id: a.id, customerNumber: a.customerNumber, name: a.name, email: a.email, registered: a.registered, ccu: a.ccu, methods: a.methods})),
    invoices: s.invoices, payments: s.payments, scheduled: s.ccu.scheduled, autopay: s.ccu.autopay
  };
}
const credentials = s => JSON.stringify(s.accounts.map(a => [a.id, a.credential?.digest || null]));

// ---------------------------------------------------------------- helpers
function profileFor(s, session, h) {
  const auth = s.sessions[session];
  h.need(auth && auth.expires > s.now && auth.ccu, 'Your session has ended. Please log in again.', 401);
  const a = s.accounts.find(x => x.id === auth.accountId); h.need(a && a.registered, 'Your session has ended. Please log in again.', 401);
  return a;
}
function linkedAccount(s, profile, accountId, h) {
  const link = profile.ccu.links.find(l => l.accountId === accountId);
  h.need(link, 'Linked account not found', 404);
  return {link, account: s.accounts.find(a => a.id === accountId)};
}
const draftsFor = (s, session) => (s.ccu.drafts[sha(String(session))] ||= {});
const today = s => etParts(s.now).date;
function openInvoice(s, accountId, h) {
  const inv = s.invoices.filter(i => i.accountId === accountId && h.available(s, i) > 0).sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];
  return inv || null;
}
function accountSummary(s, a, h, profile) {
  const invs = s.invoices.filter(i => i.accountId === a.id);
  const balance = invs.reduce((n, i) => n + h.available(s, i), 0);
  const open = openInvoice(s, a.id, h);
  const pending = s.payments.filter(p => p.accountId === a.id && p.status === 'pending').reduce((n, p) => n + p.amountCents, 0);
  const latest = invs.slice().sort((x, y) => y.billDate.localeCompare(x.billDate))[0];
  const link = profile?.ccu.links.find(l => l.accountId === a.id);
  const ap = s.ccu.autopay[a.id];
  return {accountId: a.id, accountNumber: a.customerNumber, name: a.name, serviceAddress: a.ccu.serviceAddress + ', ' + a.ccu.serviceCity,
    amountDueCents: balance, dueDate: open?.dueDate || null, pendingCents: pending, latestBill: latest ? {invoiceId: latest.id, billDate: latest.billDate, amountCents: latest.amountCents} : null,
    autopay: ap?.enabled ? {enabled: true, method: publicMethod(s.accounts.find(x => x.id === ap.profileId)?.methods.find(m => m.id === ap.methodId)) || null} : {enabled: false},
    scheduledCount: s.ccu.scheduled.filter(x => x.accountId === a.id && x.status === 'scheduled').length,
    ...(link ? {paperless: link.paperless, emailNotify: link.emailNotify, smsNotify: link.smsNotify} : {})};
}
function parseAmount(v, h) {
  h.need(typeof v === 'string' && /^\d{1,5}(\.\d{1,2})?$/.test(v.trim()), 'Enter a payment amount such as 84.32');
  const cents = Math.round(Number(v.trim()) * 100); h.need(cents >= 100, 'The minimum payment is $1.00'); return cents;
}
function newInstrument(s, input, h) {
  h.need(['bank', 'card'].includes(input.kind), 'Choose a payment method');
  let m;
  try {
    if (input.kind === 'card') {
      const n = String(input.cardNumber || '').replace(/\s/g, '');
      h.need(cardBrand(n), 'Charlotte County Utilities accepts Visa, Mastercard and Discover cards.');
      m = walletInstrument({kind: 'card', name: input.name, cardNumber: n, cvv: String(input.cvv || ''), expiry: String(input.expiry || '').trim()}, s.now);
      m.brand = cardBrand(n); m.label = `${m.brand} ending ${m.last4}`; delete m.decline;
    } else {
      h.need(['Checking', 'Savings'].includes(input.accountType || 'Checking'), 'Choose checking or savings');
      m = walletInstrument({kind: 'bank', name: input.name, routing: String(input.routing || ''), accountNumber: String(input.accountNumber || ''), confirmAccountNumber: String(input.confirmAccountNumber || '')}, s.now);
      m.accountType = input.accountType || 'Checking'; m.label = `${m.accountType} ending ${m.last4}`;
    }
  } catch (e) { if (e instanceof h.Fault) throw e; throw new h.Fault(e.message); }
  return m;
}
function confirmationNumber(s) { s.ccu.seq++; return String(7310050000 + s.seed * 97 % 1000 * 100 + s.ccu.seq * 7); }
function commitPayment(s, {account, invoice, amountCents, method, profileId, source}, h) {
  h.need(amountCents <= h.available(s, invoice), 'The payment amount exceeds the current balance');
  if (method.kind === 'card') { try { validateExpiry(method.expiry, s.now); } catch (e) { throw new h.Fault(e.message); } }
  const p = {id: `pay-${s.payments.length + 1}`, accountId: account.id, invoiceId: invoice.id, amountCents, feeCents: FEES[method.kind], method: methodSnapshot(method), status: 'pending', postingDate: postingDate(s.now), confirmation: confirmationNumber(s), createdAt: s.now, initial: false, source, profileId};
  s.payments.push(p);
  return p;
}
const safePayment = (s, p) => ({id: p.id, confirmation: p.confirmation, accountNumber: s.accounts.find(a => a.id === p.accountId)?.customerNumber, invoiceNumber: s.invoices.find(i => i.id === p.invoiceId)?.number, amountCents: p.amountCents, feeCents: p.feeCents, totalCents: p.amountCents + p.feeCents, method: publicMethod(p.method), status: p.status, postingDate: p.postingDate, submittedDate: etParts(p.createdAt).date, source: p.source});
const safeScheduled = (s, x) => ({id: x.id, accountId: x.accountId, accountNumber: s.accounts.find(a => a.id === x.accountId)?.customerNumber, amountCents: x.amountCents, feeCents: x.feeCents, totalCents: x.amountCents + x.feeCents, method: publicMethod(x.method), date: x.date, status: x.status, paymentId: x.paymentId || null});
function quoteView(s, q) {
  const a = s.accounts.find(x => x.id === q.accountId), inv = s.invoices.find(i => i.id === q.invoiceId);
  return {accountId: a.id, accountNumber: a.customerNumber, serviceAddress: a.ccu.serviceAddress, invoiceNumber: inv.number, dueDate: inv.dueDate, amountCents: q.amountCents, feeCents: q.feeCents, totalCents: q.amountCents + q.feeCents, method: publicMethod(q.method), date: q.date, scheduled: !!q.date, postingDate: q.date ? null : postingDate(s.now), saveMethod: !!q.saveMethod, reviewed: !!q.reviewed};
}
function wallet(a) { return a.methods.map(m => ({...publicMethod(m), brand: m.brand || null, accountType: m.accountType || null})); }
function revokeSessions(s, a) { for (const [k, v] of Object.entries(s.sessions)) if (v.accountId === a.id) delete s.sessions[k]; }
function passwordPolicy(p, h) { h.need(typeof p === 'string' && p.length >= 8 && p.length <= 32 && /[A-Za-z]/.test(p) && /[0-9]/.test(p) && !/\s/.test(p), 'Use 8–32 characters with at least one letter and one number, without spaces'); }
const policyView = () => ({fees: FEES, acceptedCards: ['Visa', 'Mastercard', 'Discover'], wallets: ['PayPal', 'PayPal Credit', 'Venmo', 'Apple Pay', 'Google Pay'], cutoff: '8:00 p.m. Eastern'});

// ---------------------------------------------------------------- GET
export function charlotteGet(s, route, {session, query}, h) {
  if (route === 'session') {
    const auth = s.sessions[session]; const a = auth && auth.ccu && auth.expires > s.now ? s.accounts.find(x => x.id === auth.accountId) : null;
    return {profile: a ? {email: a.email, name: a.ccu.profile ? a.ccu.profile.firstName + ' ' + a.ccu.profile.lastName : a.name} : null, today: today(s), policy: policyView()};
  }
  if (route === 'reset/check') {
    const r = s.ccu.resets[sha(String(query.token || ''))];
    h.need(r && !r.used && r.expires > s.now, 'This password reset link is invalid or has expired. Request a new one.', 403);
    return {email: s.accounts.find(a => a.id === r.accountId).email};
  }
  if (route.startsWith('guest/')) return guestGet(s, route, h);
  const a = profileFor(s, session, h), drafts = draftsFor(s, session);
  if (route === 'accounts') {
    h.event(s, 'ccu_accounts_viewed', {accountId: a.id});
    return {profile: {email: a.email, ...a.ccu.profile}, accounts: a.ccu.links.map(l => accountSummary(s, s.accounts.find(x => x.id === l.accountId), h, a))};
  }
  if (route === 'profile') return {email: a.email, ...a.ccu.profile};
  if (route === 'pay/options') {
    const accountId = query.accountId || a.ccu.links[0]?.accountId; h.need(accountId, 'Add an account before making a payment', 404);
    const {account} = linkedAccount(s, a, accountId, h), inv = openInvoice(s, accountId, h);
    h.event(s, 'ccu_payment_opened', {accountId: a.id, billingAccountId: accountId});
    return {account: accountSummary(s, account, h, a), invoice: inv ? {id: inv.id, number: inv.number, dueDate: inv.dueDate, balanceCents: h.available(s, inv)} : null, wallet: wallet(a), policy: policyView(), today: today(s), postingPreview: postingDate(s.now), links: a.ccu.links.map(l => ({accountId: l.accountId, accountNumber: s.accounts.find(x => x.id === l.accountId).customerNumber}))};
  }
  if (route === 'pay/review' || route === 'pay/receipt') {
    const q = drafts.payment; h.need(q, 'Start a payment from Make a Payment', 404);
    if (route === 'pay/review') {
      if (q.committed) return {...quoteView(s, q), committed: true};
      q.reviewed = true; h.event(s, 'ccu_payment_reviewed', {accountId: a.id, quoteId: q.id}); return quoteView(s, q);
    }
    h.need(q.committed, 'This payment has not been submitted', 409);
    h.event(s, 'ccu_receipt_viewed', {accountId: a.id, quoteId: q.id});
    if (q.committed.type === 'payment') return {type: 'payment', payment: safePayment(s, s.payments.find(p => p.id === q.committed.id))};
    return {type: 'scheduled', scheduled: safeScheduled(s, s.ccu.scheduled.find(x => x.id === q.committed.id))};
  }
  if (route === 'scheduled') {
    h.event(s, 'ccu_scheduled_viewed', {accountId: a.id});
    const ids = new Set(a.ccu.links.map(l => l.accountId));
    return {scheduled: s.ccu.scheduled.filter(x => ids.has(x.accountId)).map(x => safeScheduled(s, x)), wallet: wallet(a), today: today(s), autopay: Object.fromEntries([...ids].map(id => [id, s.ccu.autopay[id]?.enabled ? publicMethod(a.methods.find(m => m.id === s.ccu.autopay[id].methodId)) : null]))};
  }
  if (route === 'autopay') {
    h.event(s, 'ccu_autopay_viewed', {accountId: a.id});
    return {accounts: a.ccu.links.map(l => { const b = s.accounts.find(x => x.id === l.accountId), ap = s.ccu.autopay[l.accountId], m = ap?.enabled ? a.methods.find(x => x.id === ap.methodId) : null; return {accountId: b.id, accountNumber: b.customerNumber, serviceAddress: b.ccu.serviceAddress, enabled: !!ap?.enabled, method: publicMethod(m), feeCents: m ? FEES[m.kind] : null, managedByOtherProfile: !!ap?.enabled && ap.profileId !== a.id, nextDueDate: openInvoice(s, b.id, h)?.dueDate || null}; }), wallet: wallet(a), policy: policyView()};
  }
  if (route === 'autopay/review') {
    const q = drafts.autopay; h.need(q, 'Choose an AutoPay change first', 404);
    const b = s.accounts.find(x => x.id === q.accountId), m = a.methods.find(x => x.id === q.methodId);
    if (!q.applied) { q.reviewed = true; h.event(s, 'ccu_autopay_reviewed', {accountId: a.id, quoteId: q.id}); }
    const conflicts = s.ccu.scheduled.filter(x => x.accountId === q.accountId && x.status === 'scheduled').map(x => safeScheduled(s, x));
    return {accountId: b.id, accountNumber: b.customerNumber, enabled: q.enabled, method: publicMethod(m), feeCents: m ? FEES[m.kind] : null, applied: !!q.applied, scheduledPayments: conflicts, nextDueDate: openInvoice(s, b.id, h)?.dueDate || null};
  }
  if (route === 'paperless') {
    h.event(s, 'ccu_preferences_viewed', {accountId: a.id});
    return {email: a.email, accounts: a.ccu.links.map(l => { const b = s.accounts.find(x => x.id === l.accountId); return {accountId: b.id, accountNumber: b.customerNumber, serviceAddress: b.ccu.serviceAddress, paperless: l.paperless, emailNotify: l.emailNotify, smsNotify: l.smsNotify, mobile: l.mobile}; })};
  }
  if (route === 'wallet') { h.event(s, 'ccu_wallet_viewed', {accountId: a.id}); return {wallet: wallet(a), usage: a.methods.map(m => ({id: m.id, autopay: Object.values(s.ccu.autopay).some(ap => ap.enabled && ap.profileId === a.id && ap.methodId === m.id), scheduled: s.ccu.scheduled.some(x => x.status === 'scheduled' && x.method.id === m.id)}))}; }
  if (route === 'history') {
    const ids = new Set(a.ccu.links.map(l => l.accountId)); if (query.accountId) h.need(ids.has(query.accountId), 'Linked account not found', 404);
    h.event(s, 'ccu_history_viewed', {accountId: a.id, billingAccountId: query.accountId || null});
    return {payments: s.payments.filter(p => ids.has(p.accountId) && (!query.accountId || p.accountId === query.accountId)).sort((x, y) => y.createdAt - x.createdAt).map(p => safePayment(s, p))};
  }
  if (route === 'bills') {
    const ids = new Set(a.ccu.links.map(l => l.accountId)); if (query.accountId) h.need(ids.has(query.accountId), 'Linked account not found', 404);
    h.event(s, 'ccu_bills_viewed', {accountId: a.id});
    return {bills: s.invoices.filter(i => ids.has(i.accountId) && (!query.accountId || i.accountId === query.accountId)).sort((x, y) => y.billDate.localeCompare(x.billDate)).map(i => ({invoiceId: i.id, accountNumber: s.accounts.find(x => x.id === i.accountId).customerNumber, billDate: i.billDate, dueDate: i.dueDate, amountCents: i.amountCents, balanceCents: h.available(s, i), filename: statementFilename(s, i)}))};
  }
  if (route === 'statement') {
    const inv = s.invoices.find(i => i.id === query.invoiceId); h.need(inv && a.ccu.links.some(l => l.accountId === inv.accountId), 'Bill not found', 404);
    const doc = statementDocument(s, inv);
    h.event(s, 'ccu_statement_downloaded', {accountId: a.id, billingAccountId: inv.accountId, invoiceId: inv.id, filename: doc.filename, sha256: sha(doc.bytes)});
    return {download: doc};
  }
  if (route === 'link/review') {
    const q = drafts.link; h.need(q && q.expires > s.now, 'Verify the account number first', 404);
    const b = s.accounts.find(x => x.id === q.accountId);
    return {accountNumber: b.customerNumber, name: b.name, serviceAddress: b.ccu.serviceAddress + ', ' + b.ccu.serviceCity, paperless: q.paperless, added: !!q.added};
  }
  throw new h.Fault('Operation not found', 404);
}

function guestGet(s, route, h) {
  const g = s.ccu.guest; h.need(g, 'Look up your account to make a one-time payment', 404);
  const a = s.accounts.find(x => x.id === g.accountId), inv = s.invoices.find(i => i.id === g.invoiceId);
  if (route === 'guest/account') return {accountNumber: a.customerNumber, name: a.name.split(' ').map(w => w[0] + '*'.repeat(w.length - 1)).join(' '), serviceAddress: a.ccu.serviceAddress, invoiceNumber: inv?.number || null, dueDate: inv?.dueDate || null, balanceCents: inv ? h.available(s, inv) : 0, policy: policyView(), postingPreview: postingDate(s.now)};
  if (route === 'guest/review') {
    h.need(g.quote, 'Enter payment details first', 404);
    if (!g.committed) { g.quote.reviewed = true; h.event(s, 'ccu_guest_reviewed', {billingAccountId: a.id, quoteId: g.quote.id}); }
    return {...quoteView(s, g.quote), email: g.quote.email || null, committed: !!g.committed};
  }
  if (route === 'guest/receipt') {
    h.need(g.committed, 'This payment has not been submitted', 409);
    h.event(s, 'ccu_guest_receipt_viewed', {billingAccountId: a.id, paymentId: g.committed});
    return {payment: safePayment(s, s.payments.find(p => p.id === g.committed))};
  }
  throw new h.Fault('Operation not found', 404);
}

// ---------------------------------------------------------------- POST
export function charlottePost(s, route, {session, input}, h) {
  input = input && typeof input === 'object' ? input : {};
  if (route === 'login') {
    const email = String(input.email || '').trim().toLowerCase();
    const a = s.accounts.find(x => x.email === email && x.registered && x.credential);
    if (!a && s.ccu.legacyEmails.includes(email)) { h.event(s, 'ccu_legacy_login_rejected', {email}); throw new h.Fault('We could not find a Paymentus account for this email. Charlotte County Utilities did not transfer eBill (Billtrust) profiles. Select Register Now to re-enroll.', 401); }
    h.need(a && h.matches(String(input.password || ''), a.credential), 'The email or password you entered is incorrect.', 401);
    const token = h.secret(); s.sessions[token] = {accountId: a.id, expires: s.now + 30 * 60000, ccu: true};
    h.event(s, 'login', {accountId: a.id}); return {session: token, ok: true};
  }
  if (route === 'logout') { if (session) delete s.sessions[session]; return {ok: true, session: ''}; }
  if (route === 'register') {
    const email = String(input.email || '').trim().toLowerCase();
    h.need(/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email), 'Enter a valid email address');
    h.need(email === String(input.confirmEmail || '').trim().toLowerCase(), 'Email addresses do not match');
    passwordPolicy(input.password, h); h.need(input.password === input.confirmPassword, 'Passwords do not match');
    const firstName = String(input.firstName || '').trim(), lastName = String(input.lastName || '').trim(), phone = String(input.phone || '').replace(/\D/g, ''), zip = String(input.zip || '').trim();
    h.need(firstName && lastName && firstName.length <= 40 && lastName.length <= 40, 'Enter your first and last name');
    h.need(/^\d{10}$/.test(phone), 'Enter a 10-digit phone number'); h.need(/^\d{5}$/.test(zip), 'Enter a 5-digit ZIP code');
    h.need(input.acceptTerms === true, 'Accept the Terms of Use to continue');
    let a = s.accounts.find(x => x.email === email);
    h.need(!a?.registered, 'An account already exists for this email. Log in or use Forgot your password?');
    if (!a) { a = {id: `profile-${s.accounts.length + 1}`, customerNumber: null, name: `${firstName} ${lastName}`, email, registered: false, credential: null, autopay: {enabled: false, methodId: null, day: 20}, methods: [], ccu: {profile: null, links: []}}; s.accounts.push(a); }
    a.registered = true; a.credential = h.credential(input.password); a.ccu.profile = {firstName, lastName, phone, zip}; a.ccu.links ||= [];
    const token = h.secret(); s.sessions[token] = {accountId: a.id, expires: s.now + 30 * 60000, ccu: true};
    h.event(s, 'ccu_registered', {accountId: a.id}); h.event(s, 'login', {accountId: a.id});
    h.send(s, email, 'Welcome to the Charlotte County Utilities payment portal', 'Your Paymentus profile was created. Add your Charlotte County Utilities account number to view bills and pay. (Simulated message.)');
    return {session: token, ok: true};
  }
  if (route === 'recover') {
    const email = String(input.email || '').trim().toLowerCase();
    h.need(/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email), 'Enter a valid email address');
    const a = s.accounts.find(x => x.email === email && x.registered);
    if (a) {
      for (const r of Object.values(s.ccu.resets)) if (r.accountId === a.id) r.used = true;
      const token = h.secret(); s.ccu.resets[sha(token)] = {accountId: a.id, expires: s.now + 30 * 60000, used: false};
      h.event(s, 'ccu_reset_requested', {accountId: a.id});
      h.send(s, a.email, 'Reset your Charlotte County Utilities portal password', `We received a request to reset your password. Open /cp/ccfl/reset?token=${token} to choose a new password. This link expires in 30 minutes and can be used once. If you did not request this, ignore this message. (Simulated message; link format and lifetime are synthetic.)`);
    } else h.event(s, 'ccu_reset_requested_unknown', {});
    return {message: 'If a profile exists for that email, we sent password reset instructions. Check your inbox.'};
  }
  if (route === 'reset') {
    const r = s.ccu.resets[sha(String(input.token || ''))];
    h.need(r && !r.used && r.expires > s.now, 'This password reset link is invalid or has expired. Request a new one.', 403);
    passwordPolicy(input.password, h); h.need(input.password === input.confirmPassword, 'Passwords do not match');
    const a = s.accounts.find(x => x.id === r.accountId); r.used = true; a.credential = h.credential(input.password); revokeSessions(s, a);
    h.event(s, 'ccu_password_reset', {accountId: a.id});
    h.send(s, a.email, 'Your Charlotte County Utilities portal password was changed', 'Your password was changed. If you did not make this change, call 941.764.4300. (Simulated message.)');
    return {ok: true};
  }
  if (route.startsWith('guest/')) return guestPost(s, route, input, h);
  const a = profileFor(s, session, h), drafts = draftsFor(s, session);
  if (route === 'link/verify') {
    const number = normalizeAccount(input.accountNumber);
    const b = s.accounts.find(x => x.customerNumber && normalizeAccount(x.customerNumber) === number && x.ccu?.street);
    h.need(b && String(input.streetNumber || '').trim() === b.ccu.street, 'We could not verify that account. Check the account number and service address street number on your bill.');
    h.need(!a.ccu.links.some(l => l.accountId === b.id), 'This account is already linked to your profile');
    h.need(typeof input.paperless === 'boolean', 'Choose whether to receive paperless bills');
    drafts.link = {accountId: b.id, paperless: input.paperless, expires: s.now + 30 * 60000, added: false};
    h.event(s, 'ccu_link_verified', {accountId: a.id, billingAccountId: b.id});
    return {ok: true};
  }
  if (route === 'link/add') {
    const q = drafts.link; h.need(q && q.expires > s.now, 'Verify the account number first', 409);
    if (q.added) return {ok: true};
    h.need(input.authorize === true, 'Accept the Terms and Conditions to add this account');
    h.need(!a.ccu.links.some(l => l.accountId === q.accountId), 'This account is already linked to your profile');
    a.ccu.links.push({accountId: q.accountId, nickname: '', paperless: q.paperless, emailNotify: input.emailNotify === true, smsNotify: false, mobile: ''});
    q.added = true; h.event(s, 'ccu_account_linked', {accountId: a.id, billingAccountId: q.accountId, paperless: q.paperless});
    if (q.paperless) h.send(s, a.email, 'You are enrolled in paperless billing', `Account ${s.accounts.find(x => x.id === q.accountId).customerNumber} will receive bills by email instead of paper mail. (Simulated message.)`);
    return {ok: true};
  }
  if (route === 'pay/quote') {
    const {account} = linkedAccount(s, a, String(input.accountId || ''), h);
    const inv = openInvoice(s, account.id, h); h.need(inv, 'This account has no balance due');
    const amountCents = parseAmount(input.amount, h); h.need(amountCents <= h.available(s, inv), `The payment amount cannot exceed the current balance of ${money(h.available(s, inv))}`);
    let date = null;
    if (input.date && input.date !== today(s)) { h.need(validDate(input.date) && input.date > today(s), 'Choose today or a future payment date'); h.need(input.date <= addDays(today(s), 90), 'Payments can be scheduled up to 90 days ahead'); date = input.date; }
    let method;
    if (String(input.method || '').startsWith('saved:')) { const m = a.methods.find(x => x.id === input.method.slice(6)); h.need(m, 'Saved payment method not found'); method = m; }
    else if (['paypal', 'venmo', 'applepay', 'googlepay', 'paypalcredit'].includes(input.method)) throw new h.Fault('Digital wallet checkout is documented for Charlotte County but is not simulated in this environment. Choose a bank account or card.');
    else method = newInstrument(s, {...input, kind: input.method}, h);
    if (method.kind === 'card') { try { validateExpiry(method.expiry, s.now); } catch (e) { throw new h.Fault(e.message); } }
    if (input.saveMethod === true) h.need(!a.methods.some(m => m.instrumentHash === method.instrumentHash) || String(input.method).startsWith('saved:'), 'This payment method is already in My Wallet');
    drafts.payment = {id: h.secret().slice(0, 12), accountId: account.id, invoiceId: inv.id, amountCents, feeCents: FEES[method.kind], method: methodSnapshot(method), date, saveMethod: input.saveMethod === true && !String(input.method).startsWith('saved:'), reviewed: false, committed: null, createdAt: s.now};
    h.event(s, 'ccu_payment_quoted', {accountId: a.id, billingAccountId: account.id, quoteId: drafts.payment.id, scheduled: !!date});
    return quoteView(s, drafts.payment);
  }
  if (route === 'pay/submit') {
    const q = drafts.payment; h.need(q, 'Start a payment from Make a Payment', 404);
    if (q.committed) return {ok: true, ...q.committed};
    h.need(q.reviewed, 'Review the payment before submitting', 409);
    h.need(input.authorize === true, 'Check the authorization box to submit this payment');
    const {account} = linkedAccount(s, a, q.accountId, h), inv = s.invoices.find(i => i.id === q.invoiceId);
    h.need(q.amountCents <= h.available(s, inv), 'The balance changed. Start the payment again.', 409);
    if (q.saveMethod) { const id = `${q.method.kind}-${q.method.last4}-${a.methods.length + 1}`; a.methods.push({...q.method, id, version: 1}); q.method.id = id; h.event(s, 'ccu_wallet_added', {accountId: a.id, methodId: id}); }
    if (q.date) {
      const item = {id: `sched-${s.ccu.scheduled.length + 1}`, profileId: a.id, accountId: account.id, invoiceId: inv.id, amountCents: q.amountCents, feeCents: q.feeCents, method: q.method, date: q.date, status: 'scheduled', createdAt: s.now, version: 1};
      s.ccu.scheduled.push(item); q.committed = {type: 'scheduled', id: item.id};
      h.event(s, 'ccu_scheduled_created', {accountId: a.id, billingAccountId: account.id, scheduleId: item.id, quoteId: q.id});
      h.send(s, a.email, 'Your Charlotte County Utilities payment is scheduled', `A payment of ${money(item.amountCents)} plus a ${money(item.feeCents)} convenience fee is scheduled for ${longDate(item.date)} from ${item.method.label}. (Simulated message.)`);
    } else {
      const p = commitPayment(s, {account, invoice: inv, amountCents: q.amountCents, method: q.method, profileId: a.id, source: 'portal'}, h);
      q.committed = {type: 'payment', id: p.id};
      h.event(s, 'ccu_payment_committed', {accountId: a.id, billingAccountId: account.id, paymentId: p.id, quoteId: q.id});
      h.send(s, a.email, 'Charlotte County Utilities payment confirmation', `Confirmation ${p.confirmation}: ${money(p.amountCents)} payment plus ${money(p.feeCents)} convenience fee from ${p.method.label} for account ${account.customerNumber}. Expected posting date: ${longDate(p.postingDate)}. The convenience fee is charged by the payment provider and is not paid to Charlotte County Utilities. (Simulated message.)`);
    }
    return {ok: true, ...q.committed};
  }
  if (route === 'scheduled/edit' || route === 'scheduled/cancel') {
    const item = s.ccu.scheduled.find(x => x.id === input.id); h.need(item && a.ccu.links.some(l => l.accountId === item.accountId), 'Scheduled payment not found', 404);
    h.need(item.status === 'scheduled', 'Only pending scheduled payments can be changed', 409);
    if (route === 'scheduled/cancel') {
      h.need(input.confirm === true, 'Confirm that you want to cancel this scheduled payment');
      item.status = 'cancelled'; item.cancelledAt = s.now; item.version++;
      h.event(s, 'ccu_scheduled_cancelled', {accountId: a.id, scheduleId: item.id});
      h.send(s, a.email, 'Your scheduled payment was cancelled', `The ${money(item.amountCents)} payment scheduled for ${longDate(item.date)} was cancelled. (Simulated message.)`);
      return safeScheduled(s, item);
    }
    h.need(validDate(input.date) && input.date > today(s), 'Choose a future payment date'); h.need(input.date <= addDays(today(s), 90), 'Payments can be scheduled up to 90 days ahead');
    const m = a.methods.find(x => x.id === input.methodId); h.need(m, 'Choose a saved payment method');
    if (m.kind === 'card') { try { validateExpiry(m.expiry, s.now); } catch (e) { throw new h.Fault(e.message); } }
    const amountCents = parseAmount(input.amount, h), inv = s.invoices.find(i => i.id === item.invoiceId);
    h.need(amountCents <= h.available(s, inv), `The payment amount cannot exceed the current balance of ${money(h.available(s, inv))}`);
    const before = JSON.stringify([item.date, item.method.id, item.amountCents]);
    item.date = input.date; item.method = methodSnapshot(m); item.feeCents = FEES[m.kind]; item.amountCents = amountCents;
    if (before !== JSON.stringify([item.date, item.method.id, item.amountCents])) {
      item.version++; item.updatedAt = s.now;
      h.event(s, 'ccu_scheduled_updated', {accountId: a.id, scheduleId: item.id, date: item.date, methodId: m.id, amountCents});
      h.send(s, a.email, 'Your scheduled payment was updated', `Your payment of ${money(item.amountCents)} is now scheduled for ${longDate(item.date)} from ${item.method.label}, convenience fee ${money(item.feeCents)}. (Simulated message.)`);
    }
    return safeScheduled(s, item);
  }
  if (route === 'autopay/quote') {
    const {account} = linkedAccount(s, a, String(input.accountId || ''), h);
    h.need(typeof input.enabled === 'boolean', 'Choose whether to enroll in AutoPay');
    const current = s.ccu.autopay[account.id];
    h.need(!(current?.enabled && current.profileId !== a.id), 'AutoPay for this account is managed by another profile');
    let methodId = null;
    if (input.enabled) { const m = a.methods.find(x => x.id === input.methodId); h.need(m, 'Choose a saved payment method from My Wallet'); if (m.kind === 'card') { try { validateExpiry(m.expiry, s.now); } catch (e) { throw new h.Fault(e.message); } } methodId = m.id; h.need(!(current?.enabled && current.methodId === methodId), 'AutoPay already uses this payment method'); }
    else h.need(current?.enabled, 'AutoPay is not active for this account');
    drafts.autopay = {id: h.secret().slice(0, 12), accountId: account.id, enabled: input.enabled, methodId, reviewed: false, applied: false};
    h.event(s, 'ccu_autopay_quoted', {accountId: a.id, billingAccountId: account.id, quoteId: drafts.autopay.id});
    return {ok: true};
  }
  if (route === 'autopay/confirm') {
    const q = drafts.autopay; h.need(q, 'Choose an AutoPay change first', 404);
    if (q.applied) return {ok: true};
    h.need(q.reviewed, 'Review the AutoPay change first', 409);
    h.need(input.authorize === true, 'Check the authorization box to continue');
    const m = q.enabled ? a.methods.find(x => x.id === q.methodId) : null;
    if (q.enabled) { h.need(m, 'The selected payment method is no longer in My Wallet', 409); h.need(input.acknowledgeFee === true, `Acknowledge the ${money(FEES[m.kind])} convenience fee charged for each automatic payment`); }
    const prev = s.ccu.autopay[q.accountId];
    s.ccu.autopay[q.accountId] = q.enabled ? {enabled: true, methodId: m.id, profileId: a.id, rule: 'due_date', enrolledAt: prev?.enabled ? prev.enrolledAt : s.now, version: (prev?.version || 0) + 1} : {enabled: false, methodId: null, profileId: a.id, rule: 'due_date', cancelledAt: s.now, version: (prev?.version || 0) + 1};
    q.applied = true;
    h.event(s, 'ccu_autopay_changed', {accountId: a.id, billingAccountId: q.accountId, enabled: q.enabled, methodId: q.enabled ? m.id : null, quoteId: q.id});
    h.send(s, a.email, q.enabled ? 'Your Charlotte County Utilities AutoPay is set up' : 'Your Charlotte County Utilities AutoPay was cancelled', q.enabled ? `AutoPay will pay the balance of account ${s.accounts.find(x => x.id === q.accountId).customerNumber} on each due date from ${m.label}. A ${money(FEES[m.kind])} convenience fee applies to each automatic payment. Payments you already scheduled keep their own payment method; update them separately. (Simulated message.)` : 'AutoPay was cancelled. Payments already submitted or scheduled are not affected. (Simulated message.)');
    return {ok: true};
  }
  if (route === 'paperless') {
    const {link, account} = linkedAccount(s, a, String(input.accountId || ''), h);
    for (const k of ['paperless', 'emailNotify', 'smsNotify']) h.need(typeof input[k] === 'boolean', 'Choose each preference');
    const mobile = String(input.mobile || '').replace(/\D/g, '');
    if (input.smsNotify) h.need(/^\d{10}$/.test(mobile), 'Enter a 10-digit mobile number for text alerts');
    const next = {paperless: input.paperless, emailNotify: input.emailNotify, smsNotify: input.smsNotify, mobile: input.smsNotify ? mobile : ''};
    const changed = Object.entries(next).filter(([k, v]) => link[k] !== v);
    if (changed.length) {
      const wasPaperless = link.paperless; Object.assign(link, next);
      h.event(s, 'ccu_preferences_changed', {accountId: a.id, billingAccountId: account.id, ...next});
      if (next.paperless !== wasPaperless) h.send(s, a.email, next.paperless ? 'You are enrolled in paperless billing' : 'Paper bills will resume', `Account ${account.customerNumber}: ${next.paperless ? 'bills will be emailed instead of mailed' : 'paper bills will be mailed again'}. (Simulated message.)`);
    }
    return {ok: true, changed: changed.length > 0};
  }
  if (route === 'wallet/add') {
    const m = newInstrument(s, input, h); h.need(!a.methods.some(x => x.instrumentHash === m.instrumentHash), 'This payment method is already in My Wallet');
    const id = `${m.kind}-${m.last4}-${a.methods.length + 1}`; a.methods.push({...methodSnapshot(m), id, version: 1});
    h.event(s, 'ccu_wallet_added', {accountId: a.id, methodId: id}); return {ok: true, id};
  }
  if (route === 'wallet/remove') {
    const m = a.methods.find(x => x.id === input.methodId); h.need(m, 'Payment method not found', 404);
    h.need(!Object.values(s.ccu.autopay).some(ap => ap.enabled && ap.profileId === a.id && ap.methodId === m.id), 'This payment method is used for AutoPay. Change AutoPay before removing it.', 409);
    h.need(input.confirm === true, 'Confirm that you want to remove this payment method');
    a.methods = a.methods.filter(x => x.id !== m.id);
    h.event(s, 'ccu_wallet_removed', {accountId: a.id, methodId: m.id});
    return {ok: true, scheduledStillUsing: s.ccu.scheduled.filter(x => x.status === 'scheduled' && x.method.id === m.id).length};
  }
  throw new h.Fault('Operation not found', 404);
}

function guestPost(s, route, input, h) {
  if (route === 'guest/lookup') {
    const number = normalizeAccount(input.accountNumber), zip = String(input.zip || '').trim();
    const b = s.accounts.find(x => x.customerNumber && normalizeAccount(x.customerNumber) === number && x.ccu?.serviceZip === zip);
    h.need(b, 'We could not find an account matching that account number and service ZIP code.');
    const inv = openInvoice(s, b.id, h);
    s.ccu.guest = {accountId: b.id, invoiceId: inv?.id || null, quote: null, committed: null, startedAt: s.now};
    h.event(s, 'ccu_guest_verified', {billingAccountId: b.id}); return {ok: true};
  }
  const g = s.ccu.guest; h.need(g, 'Look up your account to make a one-time payment', 404);
  if (route === 'guest/reset') { s.ccu.guest = null; return {ok: true}; }
  if (route === 'guest/quote') {
    h.need(!g.committed, 'This payment was already submitted', 409);
    const inv = s.invoices.find(i => i.id === g.invoiceId); h.need(inv && h.available(s, inv) > 0, 'This account has no balance due');
    const amountCents = parseAmount(input.amount, h); h.need(amountCents <= h.available(s, inv), `The payment amount cannot exceed the current balance of ${money(h.available(s, inv))}`);
    if (['paypal', 'venmo', 'applepay', 'googlepay', 'paypalcredit'].includes(input.method)) throw new h.Fault('Digital wallet checkout is documented for Charlotte County but is not simulated in this environment. Choose a bank account or card.');
    const method = newInstrument(s, {...input, kind: input.method}, h);
    const email = String(input.email || '').trim();
    if (email) h.need(/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email), 'Enter a valid email address for the receipt');
    g.quote = {id: h.secret().slice(0, 12), accountId: g.accountId, invoiceId: inv.id, amountCents, feeCents: FEES[method.kind], method: methodSnapshot(method), date: null, email: email || null, reviewed: false};
    h.event(s, 'ccu_guest_quoted', {billingAccountId: g.accountId, quoteId: g.quote.id});
    return {ok: true};
  }
  if (route === 'guest/pay') {
    h.need(g.quote, 'Enter payment details first', 404);
    if (g.committed) return {ok: true};
    h.need(g.quote.reviewed, 'Review the payment before submitting', 409);
    h.need(input.authorize === true, 'Check the authorization box to submit this payment');
    const account = s.accounts.find(x => x.id === g.accountId), inv = s.invoices.find(i => i.id === g.quote.invoiceId);
    const p = commitPayment(s, {account, invoice: inv, amountCents: g.quote.amountCents, method: g.quote.method, profileId: null, source: 'quickpay'}, h);
    g.committed = p.id;
    h.event(s, 'ccu_guest_payment_committed', {billingAccountId: account.id, paymentId: p.id, quoteId: g.quote.id});
    if (g.quote.email) h.send(s, g.quote.email, 'Charlotte County Utilities payment confirmation', `Confirmation ${p.confirmation}: ${money(p.amountCents)} payment plus ${money(p.feeCents)} convenience fee from ${p.method.label} for account ${account.customerNumber}. Expected posting date: ${longDate(p.postingDate)}. (Simulated message.)`);
    return {ok: true};
  }
  throw new h.Fault('Operation not found', 404);
}

// ---------------------------------------------------------------- clock
// Synthetic execution times: scheduled payments and AutoPay run at 06:00 Eastern on their date;
// pending payments post at 20:00 Eastern on their posting date (documented same/next business day rule).
export function runCharlotte(s, from, to, h) {
  const jobs = [];
  for (const x of s.ccu.scheduled) if (x.status === 'scheduled') { const at = etMs(x.date, 6); if (at > from && at <= to) jobs.push({at, kind: 'scheduled', x}); }
  for (const inv of s.invoices) { const ap = s.ccu.autopay[inv.accountId]; if (!ap?.enabled) continue; const at = etMs(inv.dueDate, 6); if (at > from && at <= to && ap.enrolledAt < at) jobs.push({at, kind: 'autopay', inv}); }
  jobs.sort((a, b) => a.at - b.at || (a.kind === 'scheduled' ? -1 : 1));
  const executed = [];
  const settle = until => { for (const p of s.payments) if (p.status === 'pending' && p.postingDate && etMs(p.postingDate, 20) <= until) { p.status = 'posted'; executed.push('posted:' + p.id); } };
  for (const job of jobs) {
    settle(job.at); s.now = job.at;
    if (job.kind === 'scheduled') {
      const x = job.x, inv = s.invoices.find(i => i.id === x.invoiceId), account = s.accounts.find(a => a.id === x.accountId), owner = s.accounts.find(a => a.id === x.profileId);
      let failure = !inv || x.amountCents > h.available(s, inv) ? 'balance_changed' : null;
      if (!failure && x.method.kind === 'card') { try { validateExpiry(x.method.expiry, s.now); } catch { failure = 'card_expired'; } }
      if (failure) { x.status = 'failed'; x.failureReason = failure; h.event(s, 'ccu_scheduled_failed', {scheduleId: x.id, reason: failure}); h.send(s, owner.email, 'Your scheduled payment was not processed', `The payment scheduled for ${longDate(x.date)} was not processed (${failure.replace('_', ' ')}). No payment was made. (Simulated message.)`); executed.push('scheduled-failed:' + x.id); continue; }
      const p = commitPayment(s, {account, invoice: inv, amountCents: x.amountCents, method: x.method, profileId: x.profileId, source: 'scheduled'}, h);
      x.status = 'processed'; x.paymentId = p.id; h.event(s, 'ccu_scheduled_processed', {scheduleId: x.id, paymentId: p.id});
      h.send(s, owner.email, 'Charlotte County Utilities payment confirmation', `Confirmation ${p.confirmation}: scheduled payment of ${money(p.amountCents)} plus ${money(p.feeCents)} fee from ${p.method.label}. (Simulated message.)`);
      executed.push('scheduled:' + x.id);
    } else {
      const inv = job.inv, ap = s.ccu.autopay[inv.accountId], owner = s.accounts.find(a => a.id === ap.profileId), m = owner?.methods.find(x => x.id === ap.methodId), amount = h.available(s, inv);
      if (amount <= 0) { h.event(s, 'autopay_skipped', {accountId: inv.accountId, invoiceId: inv.id}); continue; }
      let failure = !m ? 'method_unavailable' : null;
      if (!failure && m.kind === 'card') { try { validateExpiry(m.expiry, s.now); } catch { failure = 'card_expired'; } }
      if (failure) { h.event(s, 'payment_declined', {accountId: inv.accountId, source: 'autopay', failureReason: failure}); h.send(s, owner?.email || 'alex@billworld.test', 'Your AutoPay payment failed', `AutoPay could not pay invoice ${inv.number} (${failure.replace('_', ' ')}). (Simulated message.)`); continue; }
      const p = commitPayment(s, {account: s.accounts.find(a => a.id === inv.accountId), invoice: inv, amountCents: amount, method: m, profileId: owner.id, source: 'autopay'}, h);
      h.event(s, 'payment_submitted', {accountId: inv.accountId, paymentId: p.id, source: 'autopay'});
      h.send(s, owner.email, 'Charlotte County Utilities AutoPay confirmation', `Confirmation ${p.confirmation}: AutoPay paid ${money(p.amountCents)} plus ${money(p.feeCents)} fee from ${p.method.label}. (Simulated message.)`);
      executed.push('autopay:' + inv.id);
    }
  }
  settle(to); s.now = to; return executed;
}

// ---------------------------------------------------------------- statements
export function statementFilename(s, inv) { return `CCU_Bill_${s.accounts.find(a => a.id === inv.accountId).customerNumber}_${inv.billDate}.pdf`; }
const fmtDate = d => { const [y, m, day] = d.split('-'); return `${day}-${['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'][Number(m) - 1]}-${y}`; };
export function statementDocument(s, inv) {
  const a = s.accounts.find(x => x.id === inv.accountId), n = c => (c / 100).toFixed(2);
  const lines = ['UTILITIES DEPARTMENT - CHARLOTTE COUNTY', 'P.O. Box 516000, Punta Gorda FL 33951-6000 - 941.764.4300', 'SYNTHETIC LOCAL STATEMENT - layout reconstructed from the county How to Read Your Bill guide', '',
    `CUSTOMER NAME: ${a.name}`, `SERVICE ADDRESS: ${a.ccu.serviceAddress}, ${a.ccu.serviceCity}`, `ACCOUNT NUMBER: ${a.customerNumber}`, `BILL DATE: ${fmtDate(inv.billDate)}`, `CURRENT CHARGES PAST DUE AFTER: ${fmtDate(inv.pastDueAfter)}`, '',
    `Previous Balance: ${n(inv.previousBalance)}`, `Previous Payment Amount: ${n(inv.previousPayment)}`, `Past Due Amount: 0.00`, 'Current Charges',
    ...inv.lines.map(([label, c]) => `  ${label}: ${n(c)}`), `TOTAL: $${n(inv.amountCents)}`, '',
    `Meter: Current Read ${inv.reads[0]}  Previous Read ${inv.reads[1]}  Usage (TGals) ${inv.reads[0] - inv.reads[1]}`, `Service Period: ${inv.service[0]} to ${inv.service[1]} (${inv.service[2]} days)`, '',
    'Penalty: 3% late fee on charges 21 days past due.', 'Pay online at Paymentus: ACH $1.00 fee; card/digital wallet $2.95 fee (not paid to the county).'];
  const esc = t => t.replace(/[\\()]/g, c => '\\' + c);
  const content = 'BT /F1 10 Tf 50 750 Td 14 TL ' + lines.map(l => `(${esc(l)}) Tj T*`).join(' ') + ' ET';
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`];
  let pdf = '%PDF-1.4\n'; const offsets = [];
  objs.forEach((o, i) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('') + `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return {filename: statementFilename(s, inv), contentType: 'application/pdf', bytes: Buffer.from(pdf)};
}

// ---------------------------------------------------------------- grading
const after = (e, ref) => !!e && !!ref && e.sequence > ref.sequence;
const strip = (obj, fn) => { const c = structuredClone(obj); fn(c); return JSON.stringify(c); };
export function evaluateCharlotte(s, task, {confirmation = '', scheduledDate = '', statementFilename: reportedFile = ''}, h) {
  const g = task.goal, ev = s.events, base = JSON.parse(s.ccu.baseline), now = business(s);
  const first = (type, pred = () => true) => ev.find(e => e.type === type && pred(e));
  const all = (type, pred = () => true) => ev.filter(e => e.type === type && pred(e));
  const alex = s.accounts.find(a => a.id === 'acct-primary');
  const login = first('login', e => e.accountId === alex.id);
  const credentialsUnchanged = credentials(s) === s.ccu.credentialBaseline;
  const basePayIds = new Set(base.payments.map(p => p.id)), added = s.payments.filter(p => !basePayIds.has(p.id));
  const sameExceptNewPayments = (extra = c => {}) => strip(now, c => { c.payments = c.payments.filter(p => basePayIds.has(p.id)); extra(c); }) === JSON.stringify(base);
  const unchanged = () => JSON.stringify(now) === JSON.stringify(base);
  let checks;
  const paymentChecks = (p, {kind, hashValue, source, profileId}) => ({
    one_new_payment: added.length === 1,
    exact_payment: !!p && p.accountId === g.billing_account_id && p.invoiceId === g.invoice_id && p.amountCents === g.amount_cents && p.feeCents === g.fee_cents && p.source === source && p.profileId === profileId && p.status === 'pending' && p.postingDate === postingDate(p.createdAt),
    exact_instrument: !!p && p.method.kind === kind && p.method.instrumentHash === hashValue && (!g.method_name || p.method.name === g.method_name),
    confirmation_reported: !!p && typeof confirmation === 'string' && confirmation.trim() === p.confirmation
  });
  if (g.type === 'ccu_quickpay') {
    const p = added[0], commit = first('ccu_guest_payment_committed'), review = first('ccu_guest_reviewed', e => e.quoteId === commit?.quoteId), receipt = first('ccu_guest_receipt_viewed', e => e.paymentId === p?.id);
    checks = {...paymentChecks(p, {kind: g.method_kind, hashValue: instrumentHash(g.method_kind, g.card_number || g.bank_account_number, g.routing || ''), source: 'quickpay', profileId: null}),
      reviewed_then_committed: after(commit, review) && commit.paymentId === p?.id, receipt_viewed: after(receipt, commit),
      no_portal_session: !ev.some(e => ['login', 'ccu_registered'].includes(e.type)),
      protected_state_unchanged: sameExceptNewPayments(), credentials_unchanged: credentialsUnchanged};
  } else if (g.type === 'ccu_registration_payment') {
    const reg = first('ccu_registered', e => e.accountId === alex.id), link = first('ccu_account_linked', e => e.accountId === alex.id && e.billingAccountId === g.billing_account_id), p = added[0], commit = first('ccu_payment_committed', e => e.paymentId === p?.id), review = first('ccu_payment_reviewed', e => e.quoteId === commit?.quoteId), receipt = first('ccu_receipt_viewed', e => e.quoteId === commit?.quoteId);
    const expectedProfile = {firstName: 'Alex', lastName: 'Morgan', phone: g.phone, zip: g.zip};
    checks = {...paymentChecks(p, {kind: 'bank', hashValue: instrumentHash('bank', g.bank_account_number, g.routing), source: 'portal', profileId: alex.id}),
      registered_with_password: alex.registered === true && !!alex.credential && h.matches(g.password, alex.credential),
      exact_profile: JSON.stringify(alex.ccu.profile) === JSON.stringify(expectedProfile),
      exact_link: JSON.stringify(alex.ccu.links) === JSON.stringify([{accountId: g.billing_account_id, nickname: '', paperless: true, emailNotify: g.email_notify === true, smsNotify: false, mobile: ''}]),
      ordered_register_link_review_pay: after(link, reg) && after(review, link) && after(commit, review) && after(receipt, commit),
      wallet_not_saved: alex.methods.length === 0, no_extra_profiles: s.accounts.length === base.accounts.length,
      protected_state_unchanged: sameExceptNewPayments(c => { const x = c.accounts.find(a => a.id === alex.id), b = base.accounts.find(a => a.id === alex.id); x.registered = b.registered; x.ccu = b.ccu; }),
      other_credentials_unchanged: JSON.stringify(JSON.parse(credentials(s)).filter(([id]) => id !== alex.id)) === JSON.stringify(JSON.parse(s.ccu.credentialBaseline).filter(([id]) => id !== alex.id))};
  } else if (g.type === 'ccu_recovery') {
    const reset = first('ccu_password_reset', e => e.accountId === alex.id), loginAfter = ev.find(e => e.type === 'login' && e.accountId === alex.id && after(e, reset)), view = ev.find(e => e.type === 'ccu_accounts_viewed' && e.accountId === alex.id && after(e, loginAfter));
    checks = {password_reset_via_email_link: !!reset && all('ccu_password_reset').length === 1, new_password_works: h.matches(g.password, alex.credential), signed_in_after_reset: !!loginAfter, accounts_viewed_after_login: !!view,
      other_credentials_unchanged: JSON.stringify(JSON.parse(credentials(s)).filter(([id]) => id !== alex.id)) === JSON.stringify(JSON.parse(s.ccu.credentialBaseline).filter(([id]) => id !== alex.id)), business_state_unchanged: unchanged()};
  } else if (g.type === 'ccu_signed_payment') {
    const p = added[0], commit = first('ccu_payment_committed', e => e.paymentId === p?.id), review = first('ccu_payment_reviewed', e => e.quoteId === commit?.quoteId), receipt = first('ccu_receipt_viewed', e => e.quoteId === commit?.quoteId), method = base.accounts[0].methods.find(m => m.id === g.method_id);
    checks = {...paymentChecks(p, {kind: method.kind, hashValue: method.instrumentHash, source: 'portal', profileId: alex.id}), saved_method_used: p?.method.id === g.method_id,
      login_review_commit_receipt: after(review, login) && after(commit, review) && after(receipt, commit), protected_state_unchanged: sameExceptNewPayments(), credentials_unchanged: credentialsUnchanged};
  } else if (g.type === 'ccu_schedule') {
    const baseIds = new Set(base.scheduled.map(x => x.id)), items = s.ccu.scheduled.filter(x => !baseIds.has(x.id)), x = items[0], created = first('ccu_scheduled_created', e => e.scheduleId === x?.id), commitQuote = created?.quoteId, review = first('ccu_payment_reviewed', e => e.quoteId === commitQuote);
    const method = base.accounts[0].methods.find(m => m.id === g.method_id);
    checks = {one_scheduled_payment: items.length === 1, exact_schedule: !!x && x.accountId === g.billing_account_id && x.invoiceId === g.invoice_id && x.amountCents === g.amount_cents && x.feeCents === g.fee_cents && x.date === g.date && x.status === 'scheduled' && x.method.id === g.method_id && x.method.instrumentHash === method.instrumentHash,
      no_immediate_payment: added.length === 0, login_review_schedule: after(review, login) && after(created, review), scheduled_date_reported: scheduledDate === g.date,
      protected_state_unchanged: strip(now, c => { c.scheduled = c.scheduled.filter(y => baseIds.has(y.id)); }) === JSON.stringify(base), credentials_unchanged: credentialsUnchanged};
  } else if (g.type === 'ccu_scheduled_update' || g.type === 'ccu_scheduled_cancel') {
    const x = s.ccu.scheduled.find(y => y.id === g.schedule_id), view = first('ccu_scheduled_viewed', e => after(e, login)), change = all(g.type === 'ccu_scheduled_update' ? 'ccu_scheduled_updated' : 'ccu_scheduled_cancelled', e => e.scheduleId === g.schedule_id);
    const target = s.accounts[0].methods.find(m => m.id === g.method_id);
    checks = g.type === 'ccu_scheduled_update' ? {
      exact_update: !!x && x.status === 'scheduled' && x.date === g.date && x.method.id === g.method_id && x.method.instrumentHash === target?.instrumentHash && x.feeCents === g.fee_cents && x.amountCents === g.amount_cents,
      scheduled_date_reported: scheduledDate === g.date} : {cancelled: !!x && x.status === 'cancelled'};
    Object.assign(checks, {login_view_change: change.length >= 1 && after(change[0], view), only_requested_schedule_changed: strip(now, c => { const y = c.scheduled.find(z => z.id === g.schedule_id), b = base.scheduled.find(z => z.id === g.schedule_id); Object.assign(y, b); for (const k of Object.keys(y)) if (!(k in b)) delete y[k]; }) === JSON.stringify(base),
      no_payments: added.length === 0, credentials_unchanged: credentialsUnchanged});
  } else if (g.type === 'ccu_autopay') {
    const ap = s.ccu.autopay[g.billing_account_id], change = all('ccu_autopay_changed'), c0 = change[0], review = first('ccu_autopay_reviewed', e => e.quoteId === c0?.quoteId), finalView = ev.find(e => e.type === 'ccu_autopay_viewed' && after(e, c0)), method = s.accounts[0].methods.find(m => m.id === g.method_id);
    const prev = base.autopay[g.billing_account_id];
    const expected = g.enabled ? {enabled: true, methodId: g.method_id, profileId: alex.id, rule: 'due_date', enrolledAt: prev?.enabled ? prev.enrolledAt : c0?.at, version: (prev?.version || 0) + 1} : {enabled: false, methodId: null, profileId: alex.id, rule: 'due_date', cancelledAt: c0?.at, version: (prev?.version || 0) + 1};
    checks = {exact_enrollment: JSON.stringify(ap) === JSON.stringify(expected), one_reviewed_change: change.length === 1 && after(review, login) && after(c0, review), final_settings_viewed: !!finalView,
      fee_matches_method: !g.enabled || FEES[method?.kind] === g.fee_cents, no_payments: added.length === 0,
      protected_state_unchanged: strip(now, c => { if (prev) c.autopay[g.billing_account_id] = prev; else delete c.autopay[g.billing_account_id]; }) === JSON.stringify(base), credentials_unchanged: credentialsUnchanged};
  } else if (g.type === 'ccu_paperless') {
    const link = alex.ccu.links.find(l => l.accountId === g.billing_account_id), changes = all('ccu_preferences_changed'), view = first('ccu_preferences_viewed', e => after(e, login)), finalView = ev.find(e => e.type === 'ccu_preferences_viewed' && after(e, changes.at(-1)));
    checks = {exact_preferences: !!link && link.paperless === g.paperless && link.emailNotify === g.email_notify && link.smsNotify === g.sms_notify && link.mobile === (g.mobile || ''), changed_after_view: changes.length >= 1 && after(changes[0], view), final_preferences_viewed: !!finalView,
      protected_state_unchanged: strip(now, c => { const l = c.accounts.find(a => a.id === alex.id).ccu.links.find(x => x.accountId === g.billing_account_id), b = base.accounts.find(a => a.id === alex.id).ccu.links.find(x => x.accountId === g.billing_account_id); Object.assign(l, b); }) === JSON.stringify(base), credentials_unchanged: credentialsUnchanged};
  } else if (g.type === 'ccu_statement') {
    const inv = s.invoices.find(i => i.id === g.invoice_id), doc = statementDocument(s, inv), downloads = all('ccu_statement_downloaded'), view = first('ccu_bills_viewed', e => after(e, login));
    checks = {exact_statement_downloaded: downloads.some(e => e.invoiceId === g.invoice_id && e.filename === doc.filename && e.sha256 === sha(doc.bytes) && after(e, view)), only_requested_statement: downloads.length > 0 && downloads.every(e => e.invoiceId === g.invoice_id), filename_reported: reportedFile === doc.filename, business_state_unchanged: unchanged(), credentials_unchanged: credentialsUnchanged};
  } else if (g.type === 'ccu_history') {
    const view = first('ccu_history_viewed', e => after(e, login)), p = s.payments.find(x => x.id === g.payment_id);
    checks = {history_viewed_after_login: !!view, confirmation_reported: !!p && confirmation.trim() === p.confirmation, business_state_unchanged: unchanged(), credentials_unchanged: credentialsUnchanged};
  } else throw new h.Fault('Unknown Charlotte County task', 500);
  return {taskId: task.id, episodeId: s.id, success: Object.values(checks).every(Boolean), checks, evidenceCohort: task.evidence_cohort};
}
