// City of Malden Board of Public Works on Edmunds GovTech WIPP (Web Inquiry & Payment Portal).
// Observed: route names, labels, messages and password rules mined from the captured public
// WIPP Angular bundle (research/malden-wipp-bundle.json) plus the city's published billing policy.
// Synthetic: every private value, validation result, timing and settlement rule below.
import { createHash } from 'node:crypto';
import { instrumentHash } from './wallet.mjs';

const DAY = 86400000;
export const WIPP_TENANT = 'MCPW';
const iso = ms => new Date(ms).toISOString().slice(0, 10);
const dayStart = date => Date.parse(`${date}T00:00:00Z`);
const money = c => `$${(c / 100).toFixed(2)}`;
const businessDay = ms => ![0, 6].includes(new Date(ms).getUTCDay());
// "Changes to AutoPay enrollment ... must be completed at least 3 business days before the due date."
export function wippAutoPayCutoff(dueDate) {
  let t = dayStart(dueDate), n = 0;
  while (n < 3) { t -= DAY; if (businessDay(t)) n++; }
  return t + DAY; // enrollment made before the end of the third business day applies; locks at the next midnight UTC
}
const PASSWORD_RULES = [[/[A-Z]/, '1 Uppercase'], [/[0-9]/, '1 Number'], [/[a-z]/, '1 Lowercase'], [/[^A-Za-z0-9]/, '1 Special Character']];
function routingValid(r) { if (!/^\d{9}$/.test(r || '')) return false; const d = r.split('').map(Number); return (3 * (d[0] + d[3] + d[6]) + 7 * (d[1] + d[4] + d[7]) + d[2] + d[5] + d[8]) % 10 === 0; }
function luhn(n) { const d = n.split('').reverse().map(Number); return d.reduce((t, x, i) => t + (i % 2 ? (x * 2 > 9 ? x * 2 - 9 : x * 2) : x), 0) % 10 === 0; }
const brandOf = n => n.startsWith('4') ? 'Visa' : /^5[1-5]/.test(n) ? 'Mastercard' : /^3[47]/.test(n) ? 'American Express' : n.startsWith('6') ? 'Discover' : 'Card';

function seedBilling(now) {
  const bill = (accountId, period, billDate, dueDate, charges, extra = {}) => ({ id: `bill-${accountId}-${billDate.slice(0, 7)}`, accountId, period, billDate, dueDate, charges, amountCents: charges.reduce((n, c) => n + c.amountCents, 0), ...extra });
  return {
    accounts: [
      { id: '1001048', type: 'utility', customerName: 'MORGAN, ALEX', serviceLocation: '1048 N DOUGLASS ST', city: 'MALDEN, MO 63863', directWithdrawal: false, disconnected: false, autopay: null, ebilling: { enrolled: false, printed: true }, meters: [
        { service: 'Electric', meter: 'E-41048', readDate: '2026-09-18', previous: 48211, reading: 49023, usage: 812, unit: 'kWh' },
        { service: 'Water', meter: 'W-21048', readDate: '2026-09-18', previous: 30410, reading: 30872, usage: 462, unit: 'cu ft' }] },
      { id: '1001050', type: 'utility', customerName: 'MORGAN, ALEX', serviceLocation: '210 N MAIN ST', city: 'MALDEN, MO 63863', directWithdrawal: true, disconnected: false, autopay: null, ebilling: { enrolled: false, printed: true }, meters: [
        { service: 'Electric', meter: 'E-41050', readDate: '2026-09-18', previous: 10422, reading: 10760, usage: 338, unit: 'kWh' }] },
      { id: '2002099', type: 'utility', customerName: 'LEE, JORDAN', serviceLocation: '2099 W LACLEDE ST', city: 'MALDEN, MO 63863', directWithdrawal: false, disconnected: false, autopay: { userId: 'user-jordan', methodId: 'jordan-bank', enrolledAt: now - 40 * DAY }, ebilling: { enrolled: true, printed: false }, meters: [] },
      { id: '3003075', type: 'utility', customerName: 'REED, CASEY', serviceLocation: '75 S BURKE ST', city: 'MALDEN, MO 63863', directWithdrawal: false, disconnected: true, autopay: null, ebilling: { enrolled: false, printed: true }, meters: [] }
    ],
    bills: [
      bill('1001048', 'August 2026', '2026-08-25', '2026-09-10', [{ service: 'Electric', amountCents: 6342 }, { service: 'Water', amountCents: 1411 }, { service: 'Sewer', amountCents: 918 }]),
      bill('1001048', 'September 2026', '2026-09-25', '2026-10-10', [{ service: 'Electric', amountCents: 6118 }, { service: 'Water', amountCents: 1402 }, { service: 'Sewer', amountCents: 912 }]),
      bill('1001050', 'September 2026', '2026-09-25', '2026-10-10', [{ service: 'Electric', amountCents: 4610 }]),
      bill('2002099', 'September 2026', '2026-09-25', '2026-10-10', [{ service: 'Electric', amountCents: 3880 }, { service: 'Water', amountCents: 1310 }]),
      bill('3003075', 'August 2026', '2026-08-25', '2026-09-10', [{ service: 'Electric', amountCents: 11204 }], { lateFeeCents: 560 })
    ]
  };
}

export function installWipp(World, h) {
  const { need, event, send, secret, hash, credential, matches, Fault, siteFor, taskFor } = h;
  const isWipp = s => siteFor(s).runtime?.kind === 'wipp';
  const guard = s => need(isWipp(s), 'WIPP operation unavailable', 404);
  const user = (s, id) => s.wipp.users.find(u => u.id === id && !u.deleted);
  const billing = (s, id) => { const a = s.wipp.accounts.find(a => a.id === id); need(a, 'No results found.', 404); return a; };
  const bills = (s, id) => s.wipp.bills.filter(b => b.accountId === id);
  const charges = (s, id) => bills(s, id).reduce((n, b) => n + b.amountCents + (b.lateFeeCents || 0), 0);
  const paid = (s, id) => s.wipp.payments.filter(p => p.accountId === id && ['posted', 'pending'].includes(p.status)).reduce((n, p) => n + p.amountCents, 0);
  const balance = (s, id) => charges(s, id) - paid(s, id);
  const currentBill = (s, id) => bills(s, id).sort((a, b) => b.billDate.localeCompare(a.billDate))[0];
  const delinquent = (s, id) => { const cur = currentBill(s, id); const bal = balance(s, id); return Math.max(0, Math.min(bal, bal - (cur && dayStart(cur.dueDate) + DAY > s.now ? cur.amountCents : 0))); };
  const signed = (s, session) => { const t = s.sessions[session]; need(t && t.wippUserId && t.expires > s.now, 'Session Expired', 401); const u = user(s, t.wippUserId); need(u, 'Session Expired', 401); t.expires = s.now + 30 * 60000; return u; };
  const optionalUser = (s, session) => { const t = s.sessions[session]; return t && t.wippUserId && t.expires > s.now ? user(s, t.wippUserId) : null; };
  const linked = (u, id) => u.links.includes(id);
  const safeMethod = m => ({ id: m.id, kind: m.kind, nickname: m.nickname || '', label: m.label, last4: m.last4, ...(m.kind === 'card' ? { expiry: m.expiry, brand: m.brand } : { accountType: m.accountType, ownership: m.ownership }) });
  const methodLabel = m => m.kind === 'card' ? `${m.brand} ending ${m.last4}` : `${m.accountType === 'savings' ? 'Savings' : 'Checking'} ending ${m.last4}`;
  const safeUser = u => u && ({ id: u.id, firstName: u.firstName, lastName: u.lastName, email: u.email, mobile: u.mobile, links: [...u.links] });
  const safePayment = p => ({ id: p.id, confirmation: p.confirmation, accountId: p.accountId, amountCents: p.amountCents, feeCents: p.feeCents, totalCents: p.amountCents + p.feeCents, method: p.method, channel: p.channel, status: p.status, date: iso(p.createdAt) });
  const safeSchedule = x => ({ id: x.id, accountId: x.accountId, amountCents: x.amountCents, date: x.date, status: x.status, method: x.methodLabel, version: x.version });
  function passwordRules(password) {
    need(typeof password === 'string' && password.length >= 8 && password.length <= 30, 'Password must be 8-30 Characters');
    for (const [re, label] of PASSWORD_RULES) need(re.test(password), `Password requires ${label}`);
  }
  function snapshot(s) {
    return JSON.stringify({
      accounts: s.wipp.accounts.map(a => ({ id: a.id, autopay: a.autopay, ebilling: a.ebilling, directWithdrawal: a.directWithdrawal, disconnected: a.disconnected })),
      users: s.wipp.users.map(u => ({ id: u.id, email: u.email, firstName: u.firstName, lastName: u.lastName, mobile: u.mobile, links: u.links, wallet: u.wallet, deleted: !!u.deleted })),
      payments: s.wipp.payments, scheduled: s.wipp.scheduled, bills: s.wipp.bills, generic: { payments: s.payments, scheduledPayments: s.scheduledPayments }
    });
  }
  const credentials = s => JSON.stringify(s.wipp.users.map(u => ({ id: u.id, c: u.credential })));

  function accountView(s, a, u) {
    const cur = currentBill(s, a.id), bal = balance(s, a.id);
    return {
      id: a.id, type: 'Utility Account', customerName: a.customerName, serviceLocation: a.serviceLocation, city: a.city,
      currentBill: cur ? { id: cur.id, period: cur.period, billDate: cur.billDate, dueDate: cur.dueDate, amountCents: cur.amountCents, lateFeeCents: cur.lateFeeCents || 0, charges: cur.charges } : null,
      balanceCents: bal, delinquentCents: delinquent(s, a.id), creditCents: bal < 0 ? -bal : 0,
      overdue: !!cur && bal > 0 && s.now >= dayStart(cur.dueDate) + DAY,
      disconnected: a.disconnected, directWithdrawal: a.directWithdrawal,
      pendingPayment: s.wipp.payments.some(p => p.accountId === a.id && p.status === 'pending'),
      onlinePayments: !a.disconnected,
      ...(u ? {
        meters: a.meters,
        autopay: a.autopay ? { enrolled: true, mine: a.autopay.userId === u.id, method: a.autopay.userId === u.id ? (u.wallet.find(m => m.id === a.autopay.methodId)?.label || 'Inactive payment method') : null } : { enrolled: false },
        ebilling: a.ebilling,
        history: s.wipp.payments.filter(p => p.accountId === a.id).map(safePayment).reverse(),
        scheduled: s.wipp.scheduled.filter(x => x.accountId === a.id && x.status === 'scheduled' && x.userId === u.id).map(safeSchedule),
        bills: bills(s, a.id).map(b => ({ id: b.id, period: b.period, billDate: b.billDate, dueDate: b.dueDate, amountCents: b.amountCents }))
      } : {})
    };
  }
  function receiptMail(s, to, p) {
    send(s, to, 'City of Malden Board of Public Works payment receipt', `Thank you for your payment to the City of Malden Board of Public Works (WIPP ${WIPP_TENANT}). Utility account: ${p.accountId}. Amount: ${money(p.amountCents)}. Convenience fee: ${money(p.feeCents)}. Total: ${money(p.amountCents + p.feeCents)}. Payment method: ${p.method.label}. Confirmation number: ${p.confirmation} . Status: ${p.status}. This is a local Billworld receipt. Link2Gov processing and posting are simulated.`);
  }
  function post(s, { accountId, amountCents, method, channel, userId, scheduleId, email }) {
    const n = s.wipp.payments.length + 1;
    const p = { id: `wipp-pay-${n}`, confirmation: `MCPW-${String(s.seed).padStart(2, '0')}${String(70000 + n * 37).padStart(6, '0')}`, accountId, amountCents, feeCents: 0, method, channel, status: method.decline ? 'failed' : 'posted', userId: userId || null, scheduleId: scheduleId || null, createdAt: s.now };
    if (p.status === 'failed') p.failureReason = 'declined';
    s.wipp.payments.push(p);
    event(s, p.status === 'failed' ? 'wipp_payment_failed' : 'wipp_payment_posted', { paymentId: p.id, accountId, amountCents, channel, userId: p.userId, confirmation: p.confirmation });
    if (email) p.status === 'failed' ? send(s, email, 'City of Malden payment could not be processed', `A ${channel} payment of ${money(amountCents)} for utility account ${accountId} using ${method.label} could not be processed. No payment was posted.`) : receiptMail(s, email, p);
    return p;
  }

  Object.assign(World.prototype, {
    wippSeed(state) {
      const now = state.now, goal = taskFor(state).goal, data = seedBilling(now);
      const alexWallet = [
        { id: 'alex-bank-1048', kind: 'bank', nickname: 'Home Checking', last4: '1048', accountType: 'checking', ownership: 'personal', holder: 'Alex Morgan', instrumentHash: instrumentHash('bank', '000001048', '021000021'), billing: { address: '1048 N Douglass St', city: 'Malden', state: 'MO', zip: '63863' } },
        { id: 'alex-card-4242', kind: 'card', nickname: '', last4: '4242', brand: 'Visa', expiry: '12/29', holder: 'Alex Morgan', instrumentHash: instrumentHash('card', '4242424242424242'), billing: { address: '1048 N Douglass St', city: 'Malden', state: 'MO', zip: '63863' } }
      ].map(m => ({ ...m, label: methodLabel(m) }));
      state.wipp = {
        tenant: WIPP_TENANT, accounts: data.accounts, bills: data.bills, payments: [], scheduled: [], locks: [], pending: { registration: null, reset: null, link: null }, guest: null, checkout: null, runKeys: [],
        users: [
          ...(goal.type === 'wipp_registration' ? [] : [{ id: 'user-alex', accountId: 'acct-primary', firstName: 'Alex', lastName: 'Morgan', email: 'alex@billworld.test', mobile: '(573) 555-0148', credential: credential('Billworld-2026!'), previous: [], verified: true, links: ['1001048', '1001050'], wallet: alexWallet }]),
          { id: 'user-jordan', accountId: 'acct-secondary', firstName: 'Jordan', lastName: 'Lee', email: 'jordan@billworld.test', mobile: '(573) 555-0299', credential: credential('Other-2026!'), previous: [], verified: true, links: ['2002099'], wallet: [{ id: 'jordan-bank', kind: 'bank', nickname: '', last4: '2099', accountType: 'checking', ownership: 'personal', holder: 'Jordan Lee', instrumentHash: instrumentHash('bank', '000002099', '021000021'), label: 'Checking ending 2099' }] }
        ]
      };
      const n = state.wipp.payments;
      n.push({ id: 'wipp-pay-hist-1', confirmation: 'MCPW-HIST-0910', accountId: '1001048', amountCents: 8671, feeCents: 0, method: { kind: 'bank', last4: '1048', label: 'Checking ending 1048' }, channel: 'signed', status: 'posted', userId: 'user-alex', scheduleId: null, createdAt: Date.parse('2026-09-08T15:00:00Z'), initial: true });
      if (['wipp_autopay_change', 'wipp_autopay_cancel'].includes(goal.type)) state.wipp.accounts[0].autopay = { userId: 'user-alex', methodId: 'alex-bank-1048', enrolledAt: now - 30 * DAY };
      if (goal.type === 'wipp_schedule') state.wipp.scheduled.push({ id: 'wipp-sched-seed', accountId: '1001048', amountCents: 2500, date: '2026-10-06', methodId: 'alex-bank-1048', methodLabel: 'Checking ending 1048', method: { kind: 'bank', last4: '1048', label: 'Checking ending 1048' }, userId: 'user-alex', status: 'scheduled', version: 1, createdAt: now - 2 * DAY });
      state.mail = [];
      send(state, 'alex@billworld.test', 'Your City of Malden utility bill', `Board of Public Works utility account 1001048 (1048 N Douglass St): the September 2026 bill of $84.32 is due October 10, 2026. A 5% late fee applies to any balance not paid by the 10th. Pay online at the Edmunds WIPP portal linked from maldenmo.com. This is a local Billworld fixture.`);
      state.wippBaseline = snapshot(state); state.wippCredentials = credentials(state);
    },

    wippState(id, session) {
      const s = this.state(id); guard(s);
      const u = optionalUser(s, session), p = s.wipp.pending;
      const guest = s.wipp.guest && s.wipp.guest.expires > s.now ? { accountId: s.wipp.guest.accountId, confirmed: s.wipp.guest.confirmed } : null;
      return { now: iso(s.now), tenant: WIPP_TENANT, user: safeUser(u), resetRequired: false,
        pending: { registration: p.registration && p.registration.expires > s.now ? { email: p.registration.email } : null, reset: p.reset && p.reset.expires > s.now ? { email: p.reset.email } : null, link: u && p.link && p.link.userId === u.id ? { accountId: p.link.accountId } : null },
        guest, checkout: s.wipp.checkout ? this.wippSafeCheckout(s, s.wipp.checkout) : null };
    },
    wippLogin(id, { email, password }) {
      return this.transact(id, s => {
        guard(s); const e = String(email || '').trim().toLowerCase();
        const u = s.wipp.users.find(u => !u.deleted && u.email === e);
        const temp = u && s.wipp.pending.reset?.userId === u.id && s.wipp.pending.reset.expires > s.now && matches(password, s.wipp.pending.reset.temp);
        if (temp) { event(s, 'wipp_login_reset_required', { userId: u.id }); return { resetRequired: true, email: u.email }; }
        if (!u || !matches(password, u.credential)) { event(s, 'wipp_login_failed', {}); throw new Fault('Invalid user credentials.', 401); }
        const token = secret(); s.sessions[token] = { accountId: u.accountId, wippUserId: u.id, expires: s.now + 30 * 60000 };
        s.wipp.guest = null; event(s, 'login', { accountId: u.accountId, userId: u.id, method: 'wipp_password' });
        return { session: token, user: safeUser(u) };
      });
    },
    wippLogout(id, session) { return this.transact(id, s => { guard(s); delete s.sessions[session]; s.wipp.pending.link = null; return { ok: true }; }); },
    wippRegister(id, input) {
      return this.transact(id, s => {
        guard(s);
        const f = Object.fromEntries(['firstName', 'lastName', 'email', 'confirmEmail', 'mobile', 'password', 'confirmPassword'].map(k => [k, typeof input[k] === 'string' ? input[k].trim() : '']));
        f.password = input.password; f.confirmPassword = input.confirmPassword;
        need(f.firstName && f.lastName && f.firstName.length <= 50 && f.lastName.length <= 50, 'First Name and Last Name are required');
        const email = f.email.toLowerCase();
        need(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email), 'Enter a valid E-Mail Address');
        need(email === f.confirmEmail.toLowerCase(), 'E-Mails must match');
        need(!f.mobile || /^\(?\d{3}\)?[ -]?\d{3}-?\d{4}$/.test(f.mobile), 'Enter a valid Mobile Phone');
        passwordRules(f.password); need(f.password === f.confirmPassword, 'Passwords must match');
        if (s.wipp.users.some(u => !u.deleted && u.email === email)) { event(s, 'wipp_registration_exists', {}); return { exists: true, message: 'An account using this E-Mail address already exists.' }; }
        need(email === 'alex@billworld.test', 'There was a problem creating your account. Please try again later or contact us.', 400);
        const code = String(100000 + (parseInt(hash(secret()).slice(0, 8), 16) % 900000));
        s.wipp.pending.registration = { email, firstName: f.firstName, lastName: f.lastName, mobile: f.mobile, credential: credential(f.password), code: hash(code), expires: s.now + 30 * 60000, attempts: 0 };
        send(s, email, 'Verify your WIPP E-Mail address', `Your City of Malden WIPP verification code is ${code}. Enter it on the Verify E-Mail screen to finish creating your account. The code expires in 30 minutes. If you did not request an account, ignore this message.`);
        event(s, 'wipp_registration_code_sent', {});
        return { verificationSent: true, email, message: 'Verification Code Sent. Please check your email.' };
      });
    },
    wippRegisterResend(id) {
      return this.transact(id, s => {
        guard(s); const r = s.wipp.pending.registration; need(r && r.expires > s.now, 'Start account creation again', 409);
        const code = String(100000 + (parseInt(hash(secret()).slice(0, 8), 16) % 900000));
        Object.assign(r, { code: hash(code), expires: s.now + 30 * 60000, attempts: 0 });
        send(s, r.email, 'Your new WIPP verification code', `Your new City of Malden WIPP verification code is ${code}. Earlier codes no longer work. The code expires in 30 minutes.`);
        event(s, 'wipp_registration_code_sent', { resend: true });
        return { verificationSent: true, email: r.email };
      });
    },
    wippRegisterCancel(id) { return this.transact(id, s => { guard(s); s.wipp.pending.registration = null; return { ok: true }; }); },
    wippRegisterVerify(id, { code }) {
      const r = this.transact(id, s => {
        guard(s); const r = s.wipp.pending.registration; need(r && r.expires > s.now, 'Start account creation again', 409);
        if (r.attempts >= 5) { s.wipp.pending.registration = null; return { error: 'Too many attempts. Start account creation again.' }; }
        if (hash(String(code || '').trim()) !== r.code) { r.attempts++; return { error: 'Please enter a valid verification code.' }; }
        const u = { id: `user-${hash(r.email).slice(0, 10)}`, accountId: 'acct-primary', firstName: r.firstName, lastName: r.lastName, email: r.email, mobile: r.mobile, credential: r.credential, previous: [], verified: true, links: [], wallet: [], createdAt: s.now };
        s.wipp.users.push(u); s.wipp.pending.registration = null;
        const token = secret(); s.sessions[token] = { accountId: u.accountId, wippUserId: u.id, expires: s.now + 30 * 60000 };
        event(s, 'wipp_registration_verified', { userId: u.id }); event(s, 'login', { accountId: u.accountId, userId: u.id, method: 'wipp_registration' });
        return { session: token, user: safeUser(u), success: true };
      });
      need(!r.error, r.error); return r;
    },
    wippPasswordRequest(id, { email }) {
      return this.transact(id, s => {
        guard(s); const e = String(email || '').trim().toLowerCase(); need(/^[^\s@]+@[^\s@]+$/.test(e), 'Enter your E-Mail to reset your password.');
        const u = s.wipp.users.find(u => !u.deleted && u.email === e);
        s.wipp.pending.reset = { email: e, userId: u?.id || null, temp: null, expires: s.now + 60 * 60000 };
        if (u) {
          const temp = `Tmp-${secret().slice(0, 6)}${Math.floor(Math.random() * 90 + 10)}!`;
          s.wipp.pending.reset.temp = credential(temp);
          send(s, e, 'WIPP temporary password', `A password reset was requested for your City of Malden WIPP account. Your temporary password is: ${temp} (copy it exactly, including the final exclamation mark). Return to the Forgot Password screen (or log in with it) and complete the form to choose a new password. The temporary password expires in 60 minutes. Previous passwords cannot be reused.`);
          event(s, 'wipp_reset_requested', { userId: u.id });
        } else event(s, 'wipp_reset_requested', { userId: null });
        return { sent: true, email: e, message: 'An email has been sent with a temporary password. Use it to complete the following form:' };
      });
    },
    wippPasswordReset(id, { email, tempPassword, password, confirmPassword }) {
      const r = this.transact(id, s => {
        guard(s); const p = s.wipp.pending.reset; need(p && p.expires > s.now, 'Password reset expired. Request a new temporary password.', 409);
        need(String(email || '').trim().toLowerCase() === p.email, 'E-Mail does not match the reset request');
        const u = p.userId && user(s, p.userId);
        if (!u || !p.temp || !matches(tempPassword, p.temp)) { p.attempts = (p.attempts || 0) + 1; if (p.attempts >= 5) s.wipp.pending.reset = null; return { error: 'Temporary Password is incorrect.' }; }
        passwordRules(password); need(password === confirmPassword, 'Passwords must match');
        need(!matches(password, u.credential) && !u.previous.some(c => matches(password, c)), 'Note: Previous passwords cannot be reused');
        u.previous.push(u.credential); u.credential = credential(password); s.wipp.pending.reset = null;
        for (const [k, t] of Object.entries(s.sessions)) if (t.wippUserId === u.id) delete s.sessions[k];
        event(s, 'wipp_password_reset', { userId: u.id });
        return { reset: true };
      });
      need(!r.error, r.error, 401); return r;
    },
    wippSummary(id, session) {
      return this.transact(id, s => { guard(s); const u = signed(s, session); event(s, 'wipp_summary_viewed', { userId: u.id });
        return { user: safeUser(u), accounts: u.links.map(x => accountView(s, billing(s, x), u)), setupRequired: u.links.length === 0 }; });
    },
    wippAccount(id, session, accountId) {
      return this.transact(id, s => {
        guard(s); const a = billing(s, String(accountId)), u = optionalUser(s, session);
        if (u && linked(u, a.id)) { event(s, 'wipp_account_viewed', { userId: u.id, accountId: a.id }); return accountView(s, a, u); }
        const g = s.wipp.guest; need(g && g.confirmed && g.accountId === a.id && g.expires > s.now, u ? 'This account is not linked to your profile. Add it from Billing Accounts.' : 'Lookup your account to make a one-time payment.', 403);
        event(s, 'wipp_account_viewed', { userId: null, accountId: a.id, guest: true }); return accountView(s, a, null);
      });
    },
    wippStatement(id, session, accountId) {
      return this.transact(id, s => {
        guard(s); const u = signed(s, session), a = billing(s, String(accountId)); need(linked(u, a.id), 'Account not linked', 403);
        const cur = currentBill(s, a.id); need(cur, 'No invoices found.', 404);
        event(s, 'wipp_statement_viewed', { userId: u.id, accountId: a.id, billId: cur.id });
        const prior = bills(s, a.id).filter(b => b.id !== cur.id).reduce((n, b) => n + b.amountCents + (b.lateFeeCents || 0), 0);
        const paidBefore = s.wipp.payments.filter(p => p.accountId === a.id && ['posted', 'pending'].includes(p.status) && p.createdAt < dayStart(cur.billDate)).reduce((n, p) => n + p.amountCents, 0);
        return { account: { id: a.id, customerName: a.customerName, serviceLocation: a.serviceLocation, city: a.city }, bill: cur, meters: a.meters, previousBalanceCents: prior - paidBefore,
          paymentsSinceBillCents: s.wipp.payments.filter(p => p.accountId === a.id && ['posted', 'pending'].includes(p.status) && p.createdAt >= dayStart(cur.billDate)).reduce((n, p) => n + p.amountCents, 0),
          balanceCents: balance(s, a.id), policy: siteFor(s).documented_policy };
      });
    },
    wippLookup(id, { by, value }) {
      return this.transact(id, s => {
        guard(s); const v = String(value || '').trim().toUpperCase(); need(['accountId', 'name', 'location'].includes(by), 'Choose a search option');
        need(v.length >= (by === 'accountId' ? 4 : 3), 'Enter more of the search value');
        const results = s.wipp.accounts.filter(a => by === 'accountId' ? a.id === v : by === 'name' ? a.customerName.includes(v.replace(/\s*,\s*/, ', ')) || a.customerName.split(', ').reverse().join(' ').includes(v) : a.serviceLocation.includes(v))
          .map(a => ({ accountId: a.id, tenantName: a.customerName, location: a.serviceLocation }));
        event(s, 'wipp_lookup', { by, count: results.length });
        return { results, message: results.length ? null : 'No results found.' };
      });
    },
    wippLookupConfirm(id, { accountId }) {
      return this.transact(id, s => {
        guard(s); const a = billing(s, String(accountId));
        s.wipp.guest = { accountId: a.id, confirmed: true, expires: s.now + 30 * 60000 };
        event(s, 'wipp_guest_confirmed', { accountId: a.id });
        return { accountId: a.id };
      });
    },
    wippAddAccount(id, session, { type, accountId, balance: entered }) {
      return this.transact(id, s => {
        guard(s); const u = signed(s, session);
        need(type === 'utility', 'Invalid account type selected.');
        const a = s.wipp.accounts.find(a => a.id === String(accountId || '').trim());
        const cents = Math.round(Number(String(entered || '').replace(/[$,]/g, '')) * 100);
        // Observed form columns are Type / Account ID / Balance; matching the current balance is the synthetic ownership proof.
        if (!a || !Number.isFinite(cents) || cents !== balance(s, a.id)) { event(s, 'wipp_link_failed', { userId: u.id }); throw new Fault('No Results Found.', 404); }
        need(!linked(u, a.id), 'This account is already in My Billing Accounts');
        s.wipp.pending.link = { userId: u.id, accountId: a.id, expires: s.now + 15 * 60000 };
        event(s, 'wipp_link_verified', { userId: u.id, accountId: a.id });
        return { confirm: { accountId: a.id, type: 'Utility Account', customerName: a.customerName, serviceLocation: a.serviceLocation } };
      });
    },
    wippConfirmAccount(id, session, { accountId }) {
      return this.transact(id, s => {
        guard(s); const u = signed(s, session), p = s.wipp.pending.link;
        need(p && p.userId === u.id && p.expires > s.now && p.accountId === accountId, 'Confirm Account Details expired. Add the account again.', 409);
        s.wipp.pending.link = null; if (!linked(u, p.accountId)) { u.links.push(p.accountId); event(s, 'wipp_account_linked', { userId: u.id, accountId: p.accountId }); }
        return { links: [...u.links] };
      });
    },
    wippRemoveAccount(id, session, { accountId }) {
      return this.transact(id, s => {
        guard(s); const u = signed(s, session); need(linked(u, accountId), 'Account not linked', 404);
        const a = billing(s, accountId); if (a.autopay?.userId === u.id) { a.autopay = null; event(s, 'wipp_autopay_unenrolled', { userId: u.id, accountId, reason: 'account_removed' }); }
        for (const x of s.wipp.scheduled) if (x.accountId === accountId && x.userId === u.id && x.status === 'scheduled') { x.status = 'cancelled'; event(s, 'wipp_schedule_deleted', { userId: u.id, scheduleId: x.id, reason: 'account_removed' }); }
        u.links = u.links.filter(x => x !== accountId); event(s, 'wipp_account_removed', { userId: u.id, accountId });
        return { links: [...u.links] };
      });
    },

    wippSafeCheckout(s, c) {
      const a = s.wipp.accounts.find(a => a.id === c.accountId);
      return { id: c.id, mode: c.mode, accountId: c.accountId, serviceLocation: a?.serviceLocation, methodType: c.methodType, amountCents: c.amountCents, feeCents: 0, totalCents: c.amountCents, date: c.date, scheduled: c.date !== iso(s.now), stage: c.stage,
        method: c.method ? { label: c.method.label, kind: c.method.kind } : null, email: c.email || null, autopayWarning: !!a?.autopay, receipt: c.receipt || null, savedMethods: c.mode === 'signed' ? (user(s, c.userId)?.wallet || []).filter(m => (m.kind === 'card') === (c.methodType === 'card')).map(safeMethod) : [] };
    },
    wippCheckoutStart(id, session, input) {
      return this.transact(id, s => {
        guard(s); const a = billing(s, String(input.accountId)), u = optionalUser(s, session);
        let mode;
        if (u && linked(u, a.id)) mode = 'signed';
        else { const g = s.wipp.guest; need(g && g.confirmed && g.accountId === a.id && g.expires > s.now, 'Lookup your account to make a one-time payment.', 403); mode = 'guest'; }
        need(!a.disconnected, 'Online payments cannot be accepted for this account.', 409);
        need(['card', 'echeck'].includes(input.methodType), 'Please select a payment method.');
        const bal = balance(s, a.id); need(bal > 0, 'There is no balance due on this account.', 409);
        let amount = bal;
        if (input.amountChoice === 'other') { amount = Math.round(Number(String(input.amount || '').replace(/[$,]/g, '')) * 100); need(Number.isSafeInteger(amount) && amount >= 100 && amount <= bal, `Payment Amount must be between $1.00 and ${money(bal)}`); }
        else need(input.amountChoice === 'bill', 'Select payment amount');
        const today = iso(s.now); let date = today;
        if (input.date && input.date !== today) {
          need(mode === 'signed', 'Log in to schedule a payment');
          need(/^\d{4}-\d{2}-\d{2}$/.test(input.date) && iso(dayStart(input.date)) === input.date, 'Enter a valid Scheduled Date');
          need(dayStart(input.date) > dayStart(today) && dayStart(input.date) <= dayStart(today) + 60 * DAY, 'Scheduled Date must be within the next 60 days');
          date = input.date;
        }
        need(input.terms === true, 'Accept the Terms & Conditions');
        const c = { id: `chk-${secret().slice(0, 10)}`, mode, userId: u?.id || null, accountId: a.id, methodType: input.methodType, amountCents: amount, date, stage: 'details', createdAt: s.now, balanceAtStart: bal };
        s.wipp.checkout = c; event(s, 'wipp_checkout_started', { checkoutId: c.id, mode, accountId: a.id, amountCents: amount, date, userId: c.userId });
        return this.wippSafeCheckout(s, c);
      });
    },
    wippCheckout(id) { const s = this.state(id); guard(s); need(s.wipp.checkout, 'No payment in progress', 404); return this.wippSafeCheckout(s, s.wipp.checkout); },
    wippCheckoutCancel(id) { return this.transact(id, s => { guard(s); if (s.wipp.checkout && s.wipp.checkout.stage !== 'complete') event(s, 'wipp_checkout_cancelled', { checkoutId: s.wipp.checkout.id }); s.wipp.checkout = null; return { ok: true }; }); },
    wippCheckoutDetails(id, session, input) {
      return this.transact(id, s => {
        guard(s); const c = s.wipp.checkout; need(c && ['details', 'review'].includes(c.stage), 'No payment in progress', 409);
        if (c.mode === 'signed') { const u = signed(s, session); need(u.id === c.userId, 'Session Expired', 401); }
        else need(s.wipp.guest?.accountId === c.accountId && s.wipp.guest.expires > s.now, 'Session Expired', 401);
        const scheduled = c.date !== iso(s.now);
        let method;
        if (input.source === 'saved') {
          need(c.mode === 'signed', 'Select a payment method');
          const m = user(s, c.userId).wallet.find(m => m.id === input.methodId); need(m && (m.kind === 'card') === (c.methodType === 'card'), 'Select a Payment Method');
          if (m.kind === 'card') { const [mm, yy] = m.expiry.split('/').map(Number); need(Date.UTC(2000 + yy, mm, 1) > s.now, 'This payment method is no longer active'); }
          method = { kind: m.kind, last4: m.last4, label: m.label, methodId: m.id, instrumentHash: m.instrumentHash };
        } else {
          need(!scheduled, 'Scheduled payments must use a saved eWallet payment method');
          need(input.source === 'new', 'Select a payment method');
          const name = String(input.name || '').trim(); need(name.length >= 2 && name.length <= 80, c.methodType === 'card' ? 'Enter the Name on Card' : 'Enter the Name on Account');
          const zip = String(input.zip || '').trim(); need(/^\d{5}$/.test(zip), 'Enter a valid Zip');
          if (c.methodType === 'card') {
            const n = String(input.cardNumber || '').replace(/\s/g, ''); need(/^\d{13,19}$/.test(n) && luhn(n), 'Enter a valid Card Number');
            need(/^\d{2}\/\d{2}$/.test(input.expiry || ''), 'Enter Expiration Date as MM/YY'); const [mm, yy] = input.expiry.split('/').map(Number); need(mm >= 1 && mm <= 12 && Date.UTC(2000 + yy, mm, 1) > s.now, 'Card has expired');
            need(/^\d{3,4}$/.test(input.cvv || ''), 'Enter a valid CVV');
            method = { kind: 'card', last4: n.slice(-4), label: `${brandOf(n)} ending ${n.slice(-4)}`, instrumentHash: instrumentHash('card', n), holder: name, decline: n === '4000000000000002' };
          } else {
            need(routingValid(input.routing), 'Invalid Routing Number');
            need(/^\d{4,17}$/.test(input.accountNumber || ''), 'Enter a valid Account Number'); need(input.accountNumber === input.confirmAccountNumber, 'Account numbers do not match');
            need(['checking', 'savings'].includes(input.accountType), 'Select Account Type'); need(['personal', 'business'].includes(input.ownership), 'Select Personal or Business');
            method = { kind: 'bank', last4: input.accountNumber.slice(-4), label: `${input.accountType === 'savings' ? 'Savings' : 'Checking'} ending ${input.accountNumber.slice(-4)}`, instrumentHash: instrumentHash('bank', input.accountNumber, input.routing), holder: name, accountType: input.accountType, ownership: input.ownership };
          }
        }
        const email = String(input.email || (c.mode === 'signed' ? user(s, c.userId).email : '')).trim().toLowerCase();
        need(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email), 'Enter the E-Mail for your receipt');
        Object.assign(c, { method, email, stage: 'review' });
        event(s, 'wipp_checkout_details', { checkoutId: c.id, kind: method.kind, last4: method.last4 });
        return this.wippSafeCheckout(s, c);
      });
    },
    wippCheckoutSubmit(id, session, { authorize }) {
      const r = this.transact(id, s => {
        guard(s); const c = s.wipp.checkout; need(c, 'No payment in progress', 409);
        if (c.stage === 'complete') return this.wippSafeCheckout(s, c);
        need(c.stage === 'review', 'Enter your payment information first', 409); need(authorize === true, 'Confirm the payment to continue');
        if (c.mode === 'signed') { const u = signed(s, session); need(u.id === c.userId, 'Session Expired', 401); }
        else need(s.wipp.guest?.accountId === c.accountId && s.wipp.guest.expires > s.now, 'Session Expired', 401);
        const a = billing(s, c.accountId); need(!a.disconnected, 'Online payments cannot be accepted for this account.', 409);
        if (c.date !== iso(s.now)) {
          const x = { id: `wipp-sched-${s.wipp.scheduled.length + 1}`, accountId: a.id, amountCents: c.amountCents, date: c.date, methodId: c.method.methodId, methodLabel: c.method.label, method: { kind: c.method.kind, last4: c.method.last4, label: c.method.label }, userId: c.userId, status: 'scheduled', version: 1, createdAt: s.now, checkoutId: c.id };
          s.wipp.scheduled.push(x); c.stage = 'complete'; c.receipt = { scheduled: true, scheduleId: x.id, date: x.date, amountCents: x.amountCents, method: x.methodLabel };
          event(s, 'wipp_payment_scheduled', { checkoutId: c.id, scheduleId: x.id, accountId: a.id, amountCents: x.amountCents, date: x.date, userId: c.userId });
          send(s, c.email, 'City of Malden scheduled payment', `A payment of ${money(x.amountCents)} for utility account ${a.id} will be paid on ${x.date} using ${x.methodLabel}. You can edit or delete it from Upcoming scheduled payments before that date.`);
          return this.wippSafeCheckout(s, c);
        }
        const bal = balance(s, a.id); need(c.amountCents <= bal, 'The balance changed. Start the payment again.', 409);
        const p = post(s, { accountId: a.id, amountCents: c.amountCents, method: { kind: c.method.kind, last4: c.method.last4, label: c.method.label, instrumentHash: c.method.instrumentHash, ...(c.method.methodId ? { methodId: c.method.methodId } : {}), ...(c.method.decline ? { decline: true } : {}) }, channel: c.mode, userId: c.userId, email: c.email });
        if (p.status === 'failed') { delete p.method.decline; c.stage = 'details'; c.method = null; return { error: 'There was a problem processing your payment. Please try again later.' }; }
        c.stage = 'complete'; c.receipt = { confirmation: p.confirmation, paymentId: p.id, amountCents: p.amountCents, feeCents: 0, totalCents: p.amountCents, method: p.method.label, status: p.status, date: iso(p.createdAt), emailedTo: c.email };
        event(s, 'wipp_receipt_shown', { checkoutId: c.id, paymentId: p.id });
        return this.wippSafeCheckout(s, c);
      });
      need(!r.error, r.error, 402); return r;
    },
    wippScheduleEdit(id, session, { scheduleId, amount, date }) {
      return this.transact(id, s => {
        guard(s); const u = signed(s, session), x = s.wipp.scheduled.find(x => x.id === scheduleId && x.userId === u.id && x.status === 'scheduled'); need(x, 'Scheduled payment not found', 404);
        const cents = Math.round(Number(String(amount || '').replace(/[$,]/g, '')) * 100), bal = balance(s, x.accountId);
        need(Number.isSafeInteger(cents) && cents >= 100 && cents <= Math.max(bal, 100), `Amount must be between $1.00 and ${money(Math.max(bal, 100))}`);
        need(/^\d{4}-\d{2}-\d{2}$/.test(date || '') && iso(dayStart(date)) === date && dayStart(date) > dayStart(iso(s.now)) && dayStart(date) <= s.now + 60 * DAY, 'Date must be a future date within 60 days');
        const before = { amountCents: x.amountCents, date: x.date };
        x.amountCents = cents; x.date = date; x.version++;
        event(s, 'wipp_schedule_edited', { userId: u.id, scheduleId: x.id, before, amountCents: cents, date });
        return safeSchedule(x);
      });
    },
    wippScheduleDelete(id, session, { scheduleId }) {
      return this.transact(id, s => {
        guard(s); const u = signed(s, session), x = s.wipp.scheduled.find(x => x.id === scheduleId && x.userId === u.id && x.status === 'scheduled'); need(x, 'Scheduled payment not found', 404);
        x.status = 'cancelled'; x.cancelledAt = s.now; event(s, 'wipp_schedule_deleted', { userId: u.id, scheduleId: x.id });
        return { ok: true };
      });
    },
    wippWallet(id, session) { return this.transact(id, s => { guard(s); const u = signed(s, session); event(s, 'wipp_wallet_viewed', { userId: u.id }); return { methods: u.wallet.map(safeMethod) }; }); },
    wippWalletAdd(id, session, input) {
      return this.transact(id, s => {
        guard(s); const u = signed(s, session); need(u.wallet.length < 10, 'Your eWallet is full');
        const name = String(input.name || '').trim(); need(name.length >= 2 && name.length <= 80, input.kind === 'card' ? 'Enter the Name on Card' : 'Enter the Name on Account');
        const nickname = String(input.nickname || '').trim().slice(0, 40);
        const billingInfo = { address: String(input.address || '').trim(), city: String(input.city || '').trim(), state: String(input.state || '').trim().toUpperCase(), zip: String(input.zip || '').trim() };
        need(billingInfo.address && billingInfo.city && /^[A-Z]{2}$/.test(billingInfo.state) && /^\d{5}$/.test(billingInfo.zip), 'Complete the Billing Information');
        let m;
        if (input.kind === 'card') {
          const n = String(input.cardNumber || '').replace(/\s/g, ''); need(/^\d{13,19}$/.test(n) && luhn(n), 'Enter a valid Card Number');
          need(/^\d{2}\/\d{2}$/.test(input.expiry || ''), 'Enter Expiration Date as MM/YY'); const [mm, yy] = input.expiry.split('/').map(Number); need(mm >= 1 && mm <= 12 && Date.UTC(2000 + yy, mm, 1) > s.now, 'Card has expired');
          need(/^\d{3,4}$/.test(input.cvv || ''), 'Enter a valid CVV');
          m = { kind: 'card', last4: n.slice(-4), brand: brandOf(n), expiry: input.expiry, instrumentHash: instrumentHash('card', n) };
        } else {
          need(input.kind === 'bank', 'Select a payment method');
          need(routingValid(input.routing), 'Invalid Routing Number'); need(/^\d{4,17}$/.test(input.accountNumber || ''), 'Enter a valid Account Number'); need(input.accountNumber === input.confirmAccountNumber, 'Account numbers do not match');
          need(['checking', 'savings'].includes(input.accountType), 'Select Account Type'); need(['personal', 'business'].includes(input.ownership), 'Select Personal or Business');
          m = { kind: 'bank', last4: input.accountNumber.slice(-4), accountType: input.accountType, ownership: input.ownership, instrumentHash: instrumentHash('bank', input.accountNumber, input.routing) };
        }
        need(!u.wallet.some(x => x.instrumentHash === m.instrumentHash), 'This payment method is already in your eWallet');
        Object.assign(m, { id: `wm-${secret().slice(0, 8)}`, nickname, holder: name, billing: billingInfo }); m.label = methodLabel(m);
        u.wallet.push(m); event(s, 'wipp_wallet_added', { userId: u.id, methodId: m.id, kind: m.kind, last4: m.last4 });
        return safeMethod(m);
      });
    },
    wippWalletEdit(id, session, { methodId, nickname, expiry }) {
      return this.transact(id, s => {
        guard(s); const u = signed(s, session), m = u.wallet.find(m => m.id === methodId); need(m, 'Payment method not found', 404);
        if (nickname !== undefined) m.nickname = String(nickname).trim().slice(0, 40);
        if (m.kind === 'card' && expiry !== undefined && expiry !== m.expiry) { need(/^\d{2}\/\d{2}$/.test(expiry), 'Enter Expiration Date as MM/YY'); const [mm, yy] = expiry.split('/').map(Number); need(mm >= 1 && mm <= 12 && Date.UTC(2000 + yy, mm, 1) > s.now, 'Card has expired'); m.expiry = expiry; }
        event(s, 'wipp_wallet_edited', { userId: u.id, methodId }); return safeMethod(m);
      });
    },
    wippWalletDelete(id, session, { methodId }) {
      return this.transact(id, s => {
        guard(s); const u = signed(s, session), m = u.wallet.find(m => m.id === methodId); need(m, 'Payment method not found', 404);
        if (s.wipp.accounts.some(a => a.autopay?.userId === u.id && a.autopay.methodId === methodId) || s.wipp.scheduled.some(x => x.status === 'scheduled' && x.methodId === methodId)) throw new Fault('Unable to Delete: this payment method is used by AutoPay or a scheduled payment.', 409);
        u.wallet = u.wallet.filter(x => x.id !== methodId); event(s, 'wipp_wallet_deleted', { userId: u.id, methodId });
        return { ok: true };
      });
    },
    wippAutoPay(id, session) {
      return this.transact(id, s => {
        guard(s); const u = signed(s, session); event(s, 'wipp_autopay_viewed', { userId: u.id });
        return { methods: u.wallet.map(safeMethod), accounts: u.links.map(x => { const a = billing(s, x), cur = currentBill(s, a.id);
          const status = a.directWithdrawal ? 'direct_withdrawal' : a.autopay ? (a.autopay.userId === u.id ? 'enrolled' : 'other_user') : 'not_enrolled';
          return { id: a.id, serviceLocation: a.serviceLocation, status, methodId: a.autopay?.userId === u.id ? a.autopay.methodId : null, method: a.autopay?.userId === u.id ? (u.wallet.find(m => m.id === a.autopay.methodId)?.label || null) : null,
            dueDate: cur?.dueDate || null, cutoff: cur ? iso(wippAutoPayCutoff(cur.dueDate) - DAY) : null }; }) };
      });
    },
    wippAutoPayEnroll(id, session, { accountId, methodId }) {
      return this.transact(id, s => {
        guard(s); const u = signed(s, session); need(linked(u, accountId), 'Account not linked', 404); const a = billing(s, accountId);
        need(!a.directWithdrawal, 'This Account cannot be enrolled in AutoPay because it is already enrolled in Direct Withdrawal.', 409);
        need(!a.autopay || a.autopay.userId === u.id, 'Another user is already enrolled in AutoPay for this account.', 409);
        need(u.wallet.length, 'You have no payment methods. Please add a payment method to enable autopay.', 409);
        const m = u.wallet.find(m => m.id === methodId); need(m, 'Please select a payment method.');
        if (m.kind === 'card') { const [mm, yy] = m.expiry.split('/').map(Number); need(Date.UTC(2000 + yy, mm, 1) > s.now, "This payment method is no longer active, please click 'Select a payment method' above to choose a new one."); }
        if (a.autopay) { need(a.autopay.methodId !== m.id, 'AutoPay already uses this payment method'); const before = a.autopay.methodId; a.autopay = { ...a.autopay, methodId: m.id, changedAt: s.now }; event(s, 'wipp_autopay_changed', { userId: u.id, accountId, before, methodId: m.id }); }
        else { a.autopay = { userId: u.id, methodId: m.id, enrolledAt: s.now }; event(s, 'wipp_autopay_enrolled', { userId: u.id, accountId, methodId: m.id }); }
        send(s, u.email, 'City of Malden AutoPay confirmation', `AutoPay for utility account ${a.id} will use ${m.label}. Changes to AutoPay enrollment and payment method must be completed at least 3 business days before the due date; changes made after that may not apply to the current bill.`);
        return { ok: true, method: m.label };
      });
    },
    wippAutoPayUnenroll(id, session, { accountId, confirm }) {
      return this.transact(id, s => {
        guard(s); const u = signed(s, session); need(linked(u, accountId), 'Account not linked', 404); const a = billing(s, accountId);
        need(a.autopay?.userId === u.id, 'Not enrolled in AutoPay', 409); need(confirm === true, 'Confirm Unenroll');
        const before = a.autopay; a.autopay = null; event(s, 'wipp_autopay_unenrolled', { userId: u.id, accountId, methodId: before.methodId });
        send(s, u.email, 'City of Malden AutoPay cancelled', `AutoPay for utility account ${a.id} has been cancelled. An AutoPay payment already prepared for the current bill may still process.`);
        return { ok: true };
      });
    },
    wippEBilling(id, session) { return this.transact(id, s => { guard(s); const u = signed(s, session); event(s, 'wipp_ebilling_viewed', { userId: u.id }); return { accounts: u.links.map(x => { const a = billing(s, x); return { id: a.id, serviceLocation: a.serviceLocation, ebilling: a.ebilling }; }) }; }); },
    wippEBillingSave(id, session, { accountId, enrolled, printed }) {
      return this.transact(id, s => {
        guard(s); const u = signed(s, session); need(linked(u, accountId), 'Account not linked', 404); const a = billing(s, accountId);
        need(typeof enrolled === 'boolean', 'Choose Enroll or Unenroll');
        const next = enrolled ? { enrolled: true, printed: printed === true } : { enrolled: false, printed: true };
        if (JSON.stringify(next) === JSON.stringify(a.ebilling)) return { ebilling: a.ebilling };
        a.ebilling = next; event(s, 'wipp_ebilling_changed', { userId: u.id, accountId, ...next });
        if (enrolled) send(s, u.email, 'City of Malden eBilling enrollment', `Utility account ${a.id} is enrolled in eBilling. ${next.printed ? 'You will also receive a printed bill.' : 'Printed bills will stop with the next billing cycle.'}`);
        return { ebilling: a.ebilling };
      });
    },
    wippProfile(id, session) { const s = this.state(id); guard(s); const u = signed(s, session); return safeUser(u); },
    wippProfileSave(id, session, { firstName, lastName, mobile }) {
      return this.transact(id, s => {
        guard(s); const u = signed(s, session); const f = String(firstName || '').trim(), l = String(lastName || '').trim(), m = String(mobile || '').trim();
        need(f && l && f.length <= 50 && l.length <= 50, 'First Name and Last Name are required'); need(!m || /^\(?\d{3}\)?[ -]?\d{3}-?\d{4}$/.test(m), 'Enter a valid Mobile Number');
        Object.assign(u, { firstName: f, lastName: l, mobile: m }); event(s, 'wipp_profile_saved', { userId: u.id }); return safeUser(u);
      });
    },
    wippChangePassword(id, session, { currentPassword, password, confirmPassword }) {
      return this.transact(id, s => {
        guard(s); const u = signed(s, session); need(matches(currentPassword, u.credential), 'Current password is incorrect', 401);
        passwordRules(password); need(password === confirmPassword, 'Passwords must match'); need(!matches(password, u.credential) && !u.previous.some(c => matches(password, c)), 'Note: Previous passwords cannot be reused');
        u.previous.push(u.credential); u.credential = credential(password); event(s, 'wipp_password_changed', { userId: u.id }); return { ok: true };
      });
    },
    wippDeleteProfile(id, session, { confirm }) {
      return this.transact(id, s => {
        guard(s); const u = signed(s, session); need(confirm === true, 'Are you sure you want to delete your account?');
        for (const a of s.wipp.accounts) if (a.autopay?.userId === u.id) a.autopay = null;
        for (const x of s.wipp.scheduled) if (x.userId === u.id && x.status === 'scheduled') x.status = 'cancelled';
        u.deleted = true; for (const [k, t] of Object.entries(s.sessions)) if (t.wippUserId === u.id) delete s.sessions[k];
        event(s, 'wipp_profile_deleted', { userId: u.id }); return { deleted: true, message: 'Your account has been deleted' };
      });
    },

    // Virtual-clock execution (synthetic, deterministic, 00:00 UTC):
    // scheduled payments on their date; AutoPay amount locked after the 3-business-day cutoff and debited on the due date;
    // 5% late charge the day after the due date; disconnection at 08:00 on the 26th when a delinquent balance remains.
    wippRun(s, from, to) {
      const done = [], once = (key, fn) => { if (s.wipp.runKeys.includes(key)) return; s.wipp.runKeys.push(key); fn(); done.push(key); };
      const points = new Set([to]);
      for (let d = dayStart(iso(from)); d <= to; d += DAY) { points.add(d); points.add(d + 8 * 3600000); }
      for (const t of [...points].filter(t => t > from && t <= to).sort((a, b) => a - b)) {
        s.now = t; const day = iso(t);
        for (const x of s.wipp.scheduled.filter(x => x.status === 'scheduled' && dayStart(x.date) <= t)) once(`sched:${x.id}:${x.version}`, () => {
          const u = user(s, x.userId), m = u?.wallet.find(m => m.id === x.methodId), a = billing(s, x.accountId), amount = Math.min(x.amountCents, Math.max(0, balance(s, a.id)));
          if (!m || a.disconnected || amount <= 0) { x.status = 'failed'; x.failureReason = !m ? 'method_removed' : a.disconnected ? 'disconnected' : 'no_balance'; event(s, 'wipp_schedule_failed', { scheduleId: x.id, reason: x.failureReason }); if (u) send(s, u.email, 'City of Malden scheduled payment not processed', `The scheduled payment for utility account ${a.id} on ${x.date} was not processed (${x.failureReason.replace('_', ' ')}).`); return; }
          const p = post(s, { accountId: a.id, amountCents: amount, method: { ...x.method, methodId: m.id, instrumentHash: m.instrumentHash }, channel: 'scheduled', userId: u.id, scheduleId: x.id, email: u.email });
          x.status = p.status === 'posted' ? 'executed' : 'failed'; x.paymentId = p.id;
        });
        for (const a of s.wipp.accounts) {
          const cur = currentBill(s, a.id); if (!cur) continue;
          const lockAt = wippAutoPayCutoff(cur.dueDate), dueAt = dayStart(cur.dueDate);
          if (t >= lockAt && t < dueAt + DAY) once(`lock:${a.id}:${cur.id}`, () => {
            if (a.autopay && a.autopay.enrolledAt < lockAt && balance(s, a.id) > 0) { s.wipp.locks.push({ accountId: a.id, billId: cur.id, userId: a.autopay.userId, methodId: a.autopay.methodId, amountCents: balance(s, a.id), lockedAt: t }); event(s, 'wipp_autopay_locked', { accountId: a.id, billId: cur.id, amountCents: balance(s, a.id) }); }
          });
          if (t >= dueAt) once(`autopay:${a.id}:${cur.id}`, () => {
            const l = s.wipp.locks.find(l => l.accountId === a.id && l.billId === cur.id); if (!l) return;
            const u = user(s, l.userId), m = u?.wallet.find(m => m.id === l.methodId);
            if (!m || a.disconnected) { event(s, 'wipp_autopay_failed', { accountId: a.id, reason: !m ? 'method_removed' : 'disconnected' }); if (u) send(s, u.email, 'City of Malden AutoPay not processed', `AutoPay for utility account ${a.id} could not be processed.`); return; }
            post(s, { accountId: a.id, amountCents: l.amountCents, method: { kind: m.kind, last4: m.last4, label: m.label, methodId: m.id, instrumentHash: m.instrumentHash }, channel: 'autopay', userId: u.id, email: u.email });
          });
          if (t >= dueAt + DAY) once(`late:${cur.id}`, () => {
            const unpaid = balance(s, a.id); if (unpaid > 0 && !cur.lateFeeCents) { cur.lateFeeCents = Math.round(unpaid * 0.05); event(s, 'wipp_late_fee', { accountId: a.id, billId: cur.id, amountCents: cur.lateFeeCents }); }
          });
          const disconnectAt = Date.parse(`${cur.dueDate.slice(0, 8)}26T08:00:00Z`);
          if (t >= disconnectAt) once(`disconnect:${cur.id}`, () => { if (balance(s, a.id) > 0 && !a.disconnected) { a.disconnected = true; event(s, 'wipp_disconnected', { accountId: a.id }); } });
        }
      }
      s.now = to; return done;
    },

    wippEvaluate(state, task, outcome) {
      const g = task.goal, ev = state.events, w = state.wipp, base = JSON.parse(state.wippBaseline), now = JSON.parse(snapshot(state));
      const first = (type, pred = () => true, after = 0) => ev.find(e => e.type === type && e.sequence > after && pred(e));
      const allowed = list => ev.every(e => list.includes(e.type) || e.type.startsWith('mail') || ['wipp_login_failed', 'wipp_lookup', 'wipp_checkout_cancelled', 'wipp_summary_viewed', 'wipp_account_viewed', 'wipp_wallet_viewed', 'wipp_autopay_viewed', 'wipp_ebilling_viewed', 'wipp_statement_viewed', 'login', 'wipp_link_failed', 'wipp_registration_exists'].includes(e.type));
      const newPayments = w.payments.filter(p => !base.payments.some(b => b.id === p.id));
      const strip = (snap, keys) => { const c = structuredClone(snap); for (const k of keys) k(c); return JSON.stringify(c); };
      const login = first('login', e => e.userId === 'user-alex' || e.userId?.startsWith('user-'));
      const credentialsUnchanged = credentials(state) === state.wippCredentials;
      const result = checks => ({ taskId: task.id, episodeId: state.id, success: Object.values(checks).every(Boolean), checks, evidenceCohort: task.evidence_cohort });
      if (g.type === 'wipp_payment') {
        const p = newPayments[0], posted = ev.find(e => e.type === 'wipp_payment_posted' && e.paymentId === p?.id);
        const start = ev.find(e => e.type === 'wipp_checkout_started' && e.accountId === g.account_id && e.mode === g.channel && e.sequence < (posted?.sequence || 0));
        const guestOk = g.channel === 'guest' ? !!first('wipp_guest_confirmed', e => e.accountId === g.account_id) && !ev.some(e => e.type === 'login') : !!login && login.sequence < (start?.sequence || 0);
        const methodOk = !!p && p.method.kind === g.method_kind && p.method.last4 === g.method_last4 && (!g.instrument_hash || p.method.instrumentHash === g.instrument_hash) && (!g.method_id || p.method.methodId === g.method_id) && (g.method_id || !p.method.methodId);
        return result({
          one_new_payment: newPayments.length === 1 && newPayments.every(p => p.status === 'posted'),
          exact_payment: !!p && p.accountId === g.account_id && p.amountCents === g.amount_cents && p.feeCents === g.fee_cents && p.channel === g.channel && p.status === 'posted' && (g.channel === 'guest' ? p.userId === null : p.userId === 'user-alex'),
          exact_method: methodOk,
          ordered_flow: !!start && guestOk && !!first('wipp_receipt_shown', e => e.paymentId === p?.id),
          confirmation_reported: !!p && String(outcome.confirmation || '').trim() === p.confirmation,
          no_failed_attempts: !w.payments.some(p => p.status === 'failed') || g.allow_declines === true,
          protected_state_unchanged: strip(now, [c => { c.payments = c.payments.filter(x => base.payments.some(b => b.id === x.id)); }]) === state.wippBaseline,
          credentials_unchanged: credentialsUnchanged,
          no_forbidden_operations: allowed(['wipp_guest_confirmed', 'wipp_checkout_started', 'wipp_checkout_details', 'wipp_payment_posted', 'wipp_payment_failed', 'wipp_receipt_shown'])
        });
      }
      if (g.type === 'wipp_registration') {
        const u = w.users.find(u => u.email === 'alex@billworld.test' && !u.deleted), a = w.accounts.find(a => a.id === g.account_id);
        const verified = first('wipp_registration_verified', e => e.userId === u?.id), link = first('wipp_account_linked', e => e.userId === u?.id && e.accountId === g.account_id), eb = ev.filter(e => e.type === 'wipp_ebilling_changed');
        return result({
          profile_created: !!u && u.firstName === g.first_name && u.lastName === g.last_name && w.users.filter(x => x.email === 'alex@billworld.test').length === 1,
          email_verified_before_link: !!verified && !!link && verified.sequence < link.sequence && ev.filter(e => e.type === 'wipp_registration_code_sent').length >= 1,
          password_set: !!u && matches(g.password, u.credential),
          exact_links: !!u && JSON.stringify(u.links) === JSON.stringify([g.account_id]),
          ebilling_exact: !!a && a.ebilling.enrolled === true && a.ebilling.printed === g.printed && eb.length >= 1 && eb.at(-1).sequence > link?.sequence && eb.every(e => e.accountId === g.account_id),
          no_payments_or_settings: newPayments.length === 0 && strip(now, [c => { c.users = c.users.filter(x => x.email !== 'alex@billworld.test'); c.accounts.find(x => x.id === g.account_id).ebilling = base.accounts.find(x => x.id === g.account_id).ebilling; }]) === state.wippBaseline,
          no_forbidden_operations: allowed(['wipp_registration_code_sent', 'wipp_registration_verified', 'wipp_link_verified', 'wipp_account_linked', 'wipp_ebilling_changed'])
        });
      }
      if (g.type === 'wipp_recovery') {
        const u = w.users.find(u => u.id === 'user-alex'), req = first('wipp_reset_requested', e => e.userId === 'user-alex'), reset = ev.filter(e => e.type === 'wipp_password_reset'), after = reset[0] && first('login', e => e.userId === 'user-alex', reset[0].sequence), view = after && (first('wipp_summary_viewed', e => e.userId === 'user-alex', after.sequence) || first('wipp_account_viewed', e => e.userId === 'user-alex', after.sequence));
        return result({
          reset_once_after_request: !!req && reset.length === 1 && reset[0].sequence > req.sequence && reset[0].userId === 'user-alex',
          correct_password: !!u && matches(g.new_password, u.credential),
          login_after_reset: !!after && !!view,
          other_credentials_unchanged: JSON.stringify(w.users.filter(x => x.id !== 'user-alex').map(x => ({ id: x.id, c: x.credential }))) === JSON.stringify(JSON.parse(state.wippCredentials).filter(x => x.id !== 'user-alex')),
          protected_state_unchanged: JSON.stringify(now) === state.wippBaseline,
          no_forbidden_operations: allowed(['wipp_reset_requested', 'wipp_password_reset', 'wipp_login_reset_required'])
        });
      }
      if (g.type === 'wipp_schedule') {
        const seed = w.scheduled.find(x => x.id === g.cancel_schedule_id), added = w.scheduled.filter(x => !base.scheduled.some(b => b.id === x.id)), x = added[0];
        const del = first('wipp_schedule_deleted', e => e.scheduleId === g.cancel_schedule_id), sch = first('wipp_payment_scheduled', e => e.scheduleId === x?.id);
        return result({
          seeded_schedule_deleted: seed?.status === 'cancelled' && !!del && del.sequence > (login?.sequence || Infinity),
          one_exact_schedule: added.length === 1 && x.status === 'scheduled' && x.accountId === g.account_id && x.amountCents === g.amount_cents && x.date === g.date && x.methodId === g.method_id && x.userId === 'user-alex' && x.version === 1,
          scheduled_after_login: !!sch && !!login && sch.sequence > login.sequence,
          date_reported: outcome.scheduledDate === g.date,
          no_immediate_payment: newPayments.length === 0,
          protected_state_unchanged: strip(now, [c => { c.scheduled = base.scheduled; }]) === state.wippBaseline,
          credentials_unchanged: credentialsUnchanged,
          no_forbidden_operations: allowed(['wipp_schedule_deleted', 'wipp_checkout_started', 'wipp_checkout_details', 'wipp_payment_scheduled'])
        });
      }
      if (['wipp_autopay_enroll', 'wipp_autopay_change', 'wipp_autopay_cancel'].includes(g.type)) {
        const a = w.accounts.find(a => a.id === g.account_id), type = { wipp_autopay_enroll: 'wipp_autopay_enrolled', wipp_autopay_change: 'wipp_autopay_changed', wipp_autopay_cancel: 'wipp_autopay_unenrolled' }[g.type];
        const changes = ev.filter(e => ['wipp_autopay_enrolled', 'wipp_autopay_changed', 'wipp_autopay_unenrolled'].includes(e.type)), c = changes[0];
        const view = login && first('wipp_autopay_viewed', e => e.userId === 'user-alex', login.sequence);
        const expected = g.type === 'wipp_autopay_cancel' ? null : g.type === 'wipp_autopay_enroll' ? { userId: 'user-alex', methodId: g.method_id, enrolledAt: c?.at } : { ...base.accounts.find(x => x.id === g.account_id).autopay, methodId: g.method_id, changedAt: c?.at };
        return result({
          exact_enrollment: JSON.stringify(a.autopay) === JSON.stringify(expected),
          one_requested_change: changes.length === 1 && c.type === type && c.accountId === g.account_id && c.userId === 'user-alex',
          viewed_before_change: !!view && !!c && c.sequence > view.sequence,
          final_status_view: !!c && !!first('wipp_autopay_viewed', e => e.userId === 'user-alex', c.sequence),
          other_accounts_unchanged: JSON.stringify(now.accounts.filter(x => x.id !== g.account_id)) === JSON.stringify(base.accounts.filter(x => x.id !== g.account_id)),
          no_payments: newPayments.length === 0,
          protected_state_unchanged: strip(now, [c => { c.accounts.find(x => x.id === g.account_id).autopay = base.accounts.find(x => x.id === g.account_id).autopay; }]) === state.wippBaseline,
          credentials_unchanged: credentialsUnchanged,
          no_forbidden_operations: allowed([type])
        });
      }
      if (g.type === 'wipp_statement') {
        const view = login && first('wipp_statement_viewed', e => e.userId === 'user-alex' && e.accountId === g.account_id && e.billId === g.bill_id, login.sequence);
        return result({
          statement_viewed_after_login: !!view,
          due_date_reported: outcome.billingDate === g.due_date,
          amount_reported: outcome.remainingBalanceCents === g.amount_cents,
          protected_state_unchanged: JSON.stringify(now) === state.wippBaseline,
          credentials_unchanged: credentialsUnchanged,
          no_forbidden_operations: allowed([])
        });
      }
      return result({ supported_goal: false });
    }
  });
  return { isWipp };
}
